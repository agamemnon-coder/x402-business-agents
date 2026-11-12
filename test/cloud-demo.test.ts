// Purser Cloud's public demo mode (cloud/src/demo.ts; docs/cloud.md, "Public demo mode"). A deployment variable switches
// it on, for a deployment that holds seeded test companies only. Here a real world is built first through the normal
// API: three companies whose runners push a paid invoice each, one of them NOT a demo company, with keys, sessions, an
// invite, a webhook secret, queued mail and a staged export in the database. Then every route in the route table is
// walked in demo mode: only the intended reads answer, only for the demo companies; the other company does not exist;
// nothing is written; no answer carries a secret. With the variable unset the same world answers as it always did.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { DEMO_BROWSER_SEC, DEMO_DOCUMENT_BROWSER_SEC, DEMO_DOCUMENT_ROUTES, DEMO_HEALTH_SEC, DEMO_MAX_DOCUMENT_BYTES, DEMO_OPEN, DEMO_RATE, DEMO_READS, DEMO_TTL_SEC, demoEnv, type DemoCache } from "../cloud/src/demo.js";
import type { Sql, SqlValue } from "../cloud/src/store.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { ADMIN_TOKEN, ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { world } from "./support/rt4World.js";

/**
 * What every route does on a public demo, written out by hand: a new route fails this file until someone decides.
 * read: answers under /v1/demo/{company}/…, for a demo company. open: answers at its own path, for no company.
 * off: 403 demo_read_only, wherever it is asked.
 */
const DEMO: Record<string, "read" | "open" | "off"> = {
  "GET /v1/health": "open",
  "GET /v1/status": "off",
  "POST /v1/health/report": "off",
  "GET /v1/integrations": "off",
  "GET /v1/webhook": "off",
  "POST /v1/webhook": "off",
  "DELETE /v1/webhook": "off",
  "GET /v1/airwallex/account": "off",
  "POST /v1/airwallex/account": "off",
  "GET /v1/airwallex/binding": "off",
  "POST /v1/airwallex/onboarding-link": "off",
  "POST /v1/airwallex/webhook": "off",
  "GET /v1/openapi.json": "open",
  "GET /v1/admin/companies": "off",
  "POST /v1/admin/tenants": "off",
  "POST /v1/admin/tenants/{id}/recovery": "off",
  "POST /v1/auth/challenge": "off",
  "POST /v1/auth/login": "off",
  "POST /v1/auth/enrol": "off",
  "POST /v1/auth/invite": "off",
  "POST /v1/auth/logout": "off",
  "GET /v1/me": "read",
  "POST /v1/company": "off",
  "POST /v1/me/language": "off",
  "GET /v1/invoices": "read",
  "GET /v1/invoices/{id}": "read",
  "GET /v1/invoices/{id}/document": "read",
  "GET /v1/vendors": "read",
  "GET /v1/payments": "read",
  "GET /v1/transactions": "read",
  "GET /v1/transactions/summary": "read",
  "GET /v1/transactions/export.csv": "read",
  "GET /v1/transactions/{id}": "read",
  "GET /v1/ledger/entries": "read",
  "GET /v1/reports/{name}": "read",
  "GET /v1/insights": "read",
  "GET /v1/documents/{sha256}": "read",
  "POST /v1/sync": "off",
  "GET /v1/sync/state": "off",
  "GET /v1/mail": "off",
  "GET /v1/mail/{id}/raw": "off",
  "POST /v1/mail/{id}/done": "off",
  "GET /v1/security/events": "off",
  "GET /v1/keys": "off",
  "POST /v1/keys": "off",
  "DELETE /v1/keys/{id}": "off",
  "GET /v1/users": "off",
  "POST /v1/users/{id}/enrolment": "off",
  "GET /v1/users/{id}/passkeys": "off",
  "DELETE /v1/users/{id}/passkeys/{credential}": "off",
  "POST /v1/users": "off",
  "POST /v1/users/{id}/erase": "off",
  "GET /v1/export": "off",
  "POST /v1/export/staged": "off",
  "GET /v1/export/staged/{id}": "off",
  "GET /v1/export/download/{id}/{part}": "off",
  "POST /v1/close": "off",
};
const label = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

/** The harness clock's start (test/support/cloud.ts). */
const NOW = new Date("2026-11-08T12:00:00Z");
/** A second Bergtex invoice (another number and amount), so two demo companies hold different invoices. */
const SECOND = EN.replaceAll("BTX-2026-21", "BTX-2026-24").replace("Subtotal EUR 1,554.62", "Subtotal EUR 1,100.00").replace("VAT 19% EUR 295.38", "VAT 19% EUR 209.00").replace("Total due EUR 1,850.00", "Total due EUR 1,309.00");

interface Co { slug: string; t: TestTenant; invoice: string; sha: string; tx: string; readKeyId: string; person: string; mail: string; exportId: string; download: string }

let c: TestCloud;
let alder: Co;
let birch: Co;
/** A real company in the same database that is not a demo company. */
let hidden: Co;
/** Every key, session, one-time secret and stored hash the database holds, and what would give the other company away. */
const needles: string[] = [];

/** A company as it stands after a while: its runner pushed a paid invoice, and its owner made keys, an invite, a webhook and an export. */
async function company(slug: string, text: string, file: string, newSupplier = false): Promise<Co> {
  const t = await c.tenant(slug);
  // The runner's own clock is the real one: its approvals expire on it.
  const now = new Date();
  const w = await world(now);
  const id = await w.add(text, file);
  if (newSupplier) await w.addSupplier(id);
  await w.pay(id);
  await pushToCloud(w.db, { url: ORIGIN, key: t.key, fetch: c.fetch }, now);
  const read = (await c.req("POST", "/v1/keys", { key: t.key, body: { name: `${slug} reader`, scopes: ["read"] } })).json as { id: string; api_key: string };
  const person = (await c.req("POST", "/v1/users", { key: t.key, body: { display_name: `Casey Controller of ${slug}`, email: `casey@${slug}.example`, role: "accountant" } })).json.id as string;
  const invite = (await c.req("POST", `/v1/users/${person}/enrolment`, { key: t.key })).json as { token: string };
  const hook = (await c.req("POST", "/v1/webhook", { key: t.key, body: { url: `https://hooks.example/${slug}` } })).json as { secret: string };
  const mail = `m_${slug.replace(/-/g, "")}`;
  await c.env.blobs.put(`t/${t.id}/mail/${mail}.eml`, new TextEncoder().encode(`From: supplier@${slug}.example\r\nSubject: invoice\r\n\r\nSee attached.\r\n`));
  await c.env.sql.run("INSERT INTO inbound_mail (tenant_id, id, blob_key, sha256, size, received_at, status) VALUES (?, ?, ?, 'aa', 1, ?, 'queued')", [t.id, mail, `t/${t.id}/mail/${mail}.eml`, NOW.toISOString()]);
  const staged = (await c.req("POST", "/v1/export/staged", { key: t.key })).json as { id: string; manifest_url: string };
  const inv = ((await c.req("GET", "/v1/invoices", { key: t.key })).json.items as { id: string; doc_sha256: string }[])[0]!;
  const tx = ((await c.req("GET", "/v1/transactions", { key: t.key })).json.items as { id: string }[])[0]!;
  for (const s of [t.key, t.starter, t.session, read.api_key, invite.token, hook.secret]) {
    if (typeof s !== "string" || s.length < 20) throw new Error(`${slug}: a secret of the test world is missing`);
    needles.push(s);
  }
  needles.push(`casey@${slug}.example`, `Casey Controller of ${slug}`);
  return { slug, t, invoice: inv.id, sha: inv.doc_sha256, tx: tx.id, readKeyId: read.id, person, mail, exportId: staged.id, download: staged.manifest_url.slice(ORIGIN.length) };
}

/** A route's path with a company's real objects in it. */
function pathOf(path: string, co: Co): string {
  const filled: Record<string, string> = {
    "/v1/admin/tenants/{id}/recovery": `/v1/admin/tenants/${co.t.id}/recovery`,
    "/v1/invoices/{id}": `/v1/invoices/${co.invoice}`,
    "/v1/invoices/{id}/document": `/v1/invoices/${co.invoice}/document`,
    "/v1/transactions/{id}": `/v1/transactions/${encodeURIComponent(co.tx)}`,
    "/v1/reports/{name}": "/v1/reports/trial",
    "/v1/documents/{sha256}": `/v1/documents/${co.sha}`,
    "/v1/mail/{id}/raw": `/v1/mail/${co.mail}/raw`,
    "/v1/mail/{id}/done": `/v1/mail/${co.mail}/done`,
    "/v1/keys/{id}": `/v1/keys/${co.readKeyId}`,
    "/v1/users/{id}/enrolment": `/v1/users/${co.person}/enrolment`,
    "/v1/users/{id}/passkeys": `/v1/users/${co.t.owner}/passkeys`,
    "/v1/users/{id}/passkeys/{credential}": `/v1/users/${co.t.owner}/passkeys/${co.t.ownerPasskey.credential_id}`,
    "/v1/users/{id}/erase": `/v1/users/${co.person}/erase`,
    "/v1/export/staged/{id}": `/v1/export/staged/${co.exportId}`,
    "/v1/export/download/{id}/{part}": co.download,
  };
  const out = filled[path] ?? path;
  if (out.includes("{")) throw new Error(`no test object for ${path}`);
  return out;
}
/** The same path, read as a demo company: /v1/demo/{company}/… */
const mount = (slug: string, path: string) => `/v1/demo/${slug}${path.slice("/v1".length)}`;

/** Every statement the cloud sends to its database while this is on. */
function watchSql(sql: Sql): { seen: string[]; stop(): void } {
  const seen: string[] = [];
  const { all, first, run, batch, exec } = sql;
  sql.all = ((q: string, p?: SqlValue[]) => { seen.push(q); return all.call(sql, q, p); }) as Sql["all"];
  sql.first = ((q: string, p?: SqlValue[]) => { seen.push(q); return first.call(sql, q, p); }) as Sql["first"];
  sql.run = (q, p) => { seen.push(q); return run.call(sql, q, p); };
  sql.batch = (s) => { seen.push(...s.map((x) => x.sql)); return batch.call(sql, s); };
  sql.exec = (s) => { seen.push(s); return exec.call(sql, s); };
  return { seen, stop: () => { Object.assign(sql, { all, first, run, batch, exec }); } };
}

/** Every row of every table, as text. */
async function snapshot(): Promise<string> {
  const tables = (await c.env.sql.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name")).map((t) => t.name);
  const out: Record<string, string[]> = {};
  for (const t of tables) out[t] = (await c.env.sql.all(`SELECT * FROM ${t}`)).map((r) => JSON.stringify(r)).sort();
  return JSON.stringify(out);
}

const get = async (path: string, headers: Record<string, string> = {}) => {
  const r = await c.req("GET", path, { headers });
  return { status: r.status, json: r.json, headers: r.res.headers, bytes: new Uint8Array(await r.res.arrayBuffer()) };
};
const demoOn = (o: Parameters<typeof demoEnv>[1] = {}, slugs = ["alder", "birch"]) => { c.env.demo = demoEnv(slugs, { perMinute: 1_000_000, uncachedPerMinute: 1_000_000, ...o }); return c.env.demo; };

beforeAll(async () => {
  c = testCloud();
  alder = await company("alder", EN, "bergtex-21.pdf");
  birch = await company("birch", SECOND, "bergtex-24.pdf");
  hidden = await company("hidden-co", NL, "zeeland.pdf", true);
  // The other company's invoice under an id no demo company has: asking a demo company for it asks for that object only.
  await c.env.sql.run("UPDATE invoices SET id = 'AP-HIDDEN-1' WHERE tenant_id = ?", [hidden.t.id]);
  hidden.invoice = "AP-HIDDEN-1";
  expect(new Set([alder.tx, birch.tx, hidden.tx]).size).toBe(3);
  expect(new Set([alder.sha, birch.sha, hidden.sha]).size).toBe(3);
  for (const [table, column] of [["api_keys", "secret_sha256"], ["enrolments", "token_sha256"], ["webhooks", "secret"]] as const) {
    const rows = await c.env.sql.all<{ v: string }>(`SELECT ${column} AS v FROM ${table}`);
    expect(rows.length, table).toBeGreaterThanOrEqual(3);
    needles.push(...rows.map((r) => r.v));
  }
  needles.push(ADMIN_TOKEN, createHash("sha256").update(ADMIN_TOKEN).digest("hex"), c.env.sessionSecret, hidden.t.id, hidden.slug, hidden.sha, hidden.tx, "Zeeland", "ZV-4471", "AP-HIDDEN-1");
}, 180_000);
afterAll(() => c.close());
afterEach(() => { delete c.env.demo; c.clock.now = new Date(NOW); });

describe("the test world, before demo mode is switched on", () => {
  it("has a decision for every route in the route table", () => {
    expect(Object.keys(DEMO).sort()).toEqual(ROUTES.map(label).sort());
  });

  it("matches the demo's own short lists, and those name only routes that read: GET, and marked read or public in the route table", () => {
    const of = (what: string) => Object.entries(DEMO).filter(([, v]) => v === what).map(([k]) => k).sort();
    expect([...DEMO_READS].sort()).toEqual(of("read"));
    expect([...DEMO_OPEN].sort()).toEqual(of("open"));
    for (const r of ROUTES.filter((x) => DEMO_READS.has(label(x)))) expect([r.method, r.need], label(r)).toEqual(["GET", "read"]);
    for (const r of ROUTES.filter((x) => DEMO_OPEN.has(label(x)))) expect([r.method, r.need], label(r)).toEqual(["GET", "public"]);
    // The two reads that hand out a document's bytes are served by the demo's own, stricter code (a new read that
    // returns stored bytes belongs on that list too).
    expect([...DEMO_DOCUMENT_ROUTES].sort()).toEqual(["/v1/documents/{sha256}", "/v1/invoices/{id}/document"]);
    expect([...DEMO_DOCUMENT_ROUTES].every((p) => DEMO_READS.has(`GET ${p}`))).toBe(true);
  });

  it("answers every GET route for its owner: what demo mode refuses below, it refuses on its own account", async () => {
    for (const r of ROUTES.filter((x) => x.method === "GET")) {
      for (const co of [alder, birch, hidden]) {
        const res = await c.req("GET", pathOf(r.path, co), { key: r.need === "public" ? null : r.need === "platform" ? ADMIN_TOKEN : co.t.key });
        // The cloud here has no Airwallex platform configured: the binding answers 404 for everyone.
        expect(res.status, `${label(r)} for ${co.slug}`).toBe(r.path === "/v1/airwallex/binding" ? 404 : 200);
      }
    }
  });
});

describe("demo mode, every route in the route table", () => {
  interface Seen { route: string; what: "read" | "open" | "off"; method: string; where: string; status: number; code: unknown; text: string }
  const seen: Seen[] = [];
  let statements: string[] = [];
  let before = "";
  let after = "";

  beforeAll(async () => {
    demoOn();
    before = await snapshot();
    const watch = watchSql(c.env.sql);
    const ask = async (r: { method: string; path: string }, where: string, path: string, key: string | null = null) => {
      const res = await c.req(r.method, path, { key, ...(r.method === "POST" ? { body: {} } : {}) });
      const text = Buffer.from(await res.res.arrayBuffer()).toString("latin1");
      seen.push({ route: label(r), what: DEMO[label(r)]!, method: r.method, where, status: res.status, code: res.json.code, text });
    };
    for (const r of ROUTES) {
      // At its own path, for no company: with nothing, with a real owner's key, with a real session, with the platform token.
      await ask(r, "plain", pathOf(r.path, alder));
      await ask(r, "plain", pathOf(r.path, alder), alder.t.key);
      await ask(r, "plain", pathOf(r.path, alder), alder.t.session);
      await ask(r, "plain", pathOf(r.path, alder), ADMIN_TOKEN);
      // As each demo company, anonymously, and with a real key too.
      await ask(r, "demo company", mount("alder", pathOf(r.path, alder)));
      await ask(r, "demo company", mount("birch", pathOf(r.path, birch)));
      await ask(r, "demo company", mount("alder", pathOf(r.path, alder)), alder.t.key);
      // As the company that is not a demo company (with its own real objects and key), and as a company that does not exist.
      await ask(r, "other company", mount(hidden.slug, pathOf(r.path, hidden)));
      await ask(r, "other company", mount(hidden.slug, pathOf(r.path, hidden)), hidden.t.key);
      await ask(r, "no company", mount("nobody", pathOf(r.path, hidden)));
      // The other company's objects, asked of a demo company.
      if (r.path.includes("{") && r.path !== "/v1/reports/{name}") await ask(r, "other company's object", mount("alder", pathOf(r.path, hidden)));
    }
    watch.stop();
    statements = watch.seen;
    after = await snapshot();
    delete c.env.demo;
  }, 180_000);

  const wrong = (rows: Seen[], ok: (s: Seen) => boolean) => rows.filter((s) => !ok(s)).map((s) => `${s.route} (${s.where}): ${s.status} ${String(s.code ?? "")}`);
  const refused = (s: Seen) => s.status === 403 && s.code === "demo_read_only";

  it("asked every route, in every way", () => {
    expect(new Set(seen.map((s) => s.route)).size).toBe(ROUTES.length);
    expect(seen.length).toBeGreaterThan(ROUTES.length * 10);
  });

  it("answers 200 for exactly the intended reads, and only under a demo company", () => {
    const ok = seen.filter((s) => s.status === 200);
    expect(wrong(ok, (s) => (s.what === "read" && s.where === "demo company") || (s.what === "open" && s.where === "plain"))).toEqual([]);
    // And every intended read did answer, for both demo companies, with or without a key in the request.
    expect(wrong(seen.filter((s) => s.what === "read" && s.where === "demo company"), (s) => s.status === 200)).toEqual([]);
    expect(wrong(seen.filter((s) => s.what === "open" && s.where === "plain"), (s) => s.status === 200)).toEqual([]);
    expect(ok.filter((s) => s.where === "demo company").length).toBe(Object.values(DEMO).filter((v) => v === "read").length * 3);
  });

  it("refuses everything else with 403 demo_read_only: every other method, signing in, enrolling, recovering, keys, pushes, administering, mail, the platform's routes", () => {
    // At its own path nothing but the two open reads answers, whatever key, session or platform token comes with it.
    expect(wrong(seen.filter((s) => s.where === "plain" && s.what !== "open"), refused)).toEqual([]);
    // Under a demo company: everything that is not an intended read.
    expect(wrong(seen.filter((s) => s.where === "demo company" && s.what !== "read"), refused)).toEqual([]);
    // No method but GET does anything anywhere, also for a company that does not exist.
    expect(wrong(seen.filter((s) => s.method !== "GET"), refused)).toEqual([]);
    const sentence = seen.find(refused)!.text;
    expect(JSON.parse(sentence)).toMatchObject({ code: "demo_read_only", error: expect.stringMatching(/read-only demo/) });
  });

  it("does not know a company that is not a demo company: it answers exactly as for a company that does not exist", () => {
    const other = seen.filter((s) => s.where === "other company");
    const none = seen.filter((s) => s.where === "no company");
    expect(wrong(other.filter((s) => s.method === "GET"), (s) => s.status === 404 && s.code === "not_found")).toEqual([]);
    expect(wrong(none.filter((s) => s.method === "GET"), (s) => s.status === 404 && s.code === "not_found")).toEqual([]);
    for (const n of none) expect(other.filter((o) => o.route === n.route).map((o) => o.text), n.route).toEqual([n.text, n.text]);
    // And its objects are not found under a demo company either (never "exists but not yours").
    const objects = seen.filter((s) => s.where === "other company's object");
    expect(objects.length).toBeGreaterThanOrEqual(10);
    expect(wrong(objects.filter((s) => s.what === "read"), (s) => s.status === 404)).toEqual([]);
    expect(wrong(objects.filter((s) => s.what !== "read"), refused)).toEqual([]);
  });

  it("writes nothing: every statement is a SELECT, the schema script is not run, and the database is the same afterwards", () => {
    // At least one statement for each read of each demo company (the check below is not about an empty list).
    expect(statements.length).toBeGreaterThanOrEqual(Object.values(DEMO).filter((v) => v === "read").length * 2);
    expect(statements.filter((s) => !/^\s*SELECT\b/i.test(s))).toEqual([]);
    expect(after).toBe(before);
  });

  it("returns no secret, key hash or session, no person's name or e-mail, and nothing of the other company", () => {
    expect(needles.length).toBeGreaterThan(30);
    const all = seen.map((s) => s.text).join("\n");
    for (const n of needles) expect(all.includes(n), `an answer contains ${n.slice(0, 12)}…`).toBe(false);
    expect(all).not.toMatch(/pck_k[A-Za-z0-9]{12}_|pcs\.[A-Za-z0-9_-]{20,}\.|whsec_[A-Za-z0-9_-]{8,}|secret_sha256|token_sha256/);
    // The scan is not vacuous: the demo companies' own data is in what was read.
    expect(all).toContain("BTX-2026-21");
    expect(all).toContain("BTX-2026-24");
  });
});

describe("demo mode, what a visitor gets", () => {
  it("lists the demo companies for the console's switcher: slug, name and counts from the rows, in the configured order, labelled as a test world", async () => {
    // "ghost-co" is configured but was never seeded: it is left out.
    demoOn({}, ["birch", "alder", "ghost-co"]);
    const r = await get("/v1/demo/companies");
    expect(r.status).toBe(200);
    const body = r.json as { test_world: boolean; read_only: boolean; note: string; companies: { slug: string; name: string; language: string; counts: Record<string, number> }[] };
    expect(body).toMatchObject({ test_world: true, read_only: true });
    expect(body.note).toMatch(/test/i);
    expect(body.companies.map((x) => x.slug)).toEqual(["birch", "alder"]);
    expect(body.companies[1]).toMatchObject({ slug: "alder", name: "alder test company", language: "nl" });
    for (const co of [alder, birch]) {
      const n = async (table: string, extra = "") => (await c.env.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?${extra}`, [co.t.id]))!.n;
      const counts = body.companies.find((x) => x.slug === co.slug)!.counts;
      expect(counts).toEqual({ invoices: await n("invoices"), invoices_paid: await n("invoices", " AND status = 'paid'"), suppliers: await n("vendors"), payments: await n("payments"),
        transactions: await n("transactions"), documents: await n("documents"), ledger_entries: await n("ledger_entries") });
      expect(counts.invoices).toBe(1);
      expect(counts.invoices_paid).toBe(1);
      expect(counts.ledger_entries).toBeGreaterThan(0);
    }
    expect(JSON.stringify(body)).not.toContain(hidden.t.id);
  });

  it("leaves out a demo company that is closed, and does not answer for it", async () => {
    const cedar = await c.tenant("cedar");
    expect((await c.req("POST", "/v1/close", { key: cedar.key })).status).toBe(200);
    demoOn({}, ["alder", "cedar"]);
    expect(((await get("/v1/demo/companies")).json.companies as { slug: string }[]).map((x) => x.slug)).toEqual(["alder"]);
    const closed = await get("/v1/demo/cedar/invoices");
    const unknown = await get("/v1/demo/nobody/invoices");
    expect([closed.status, closed.json]).toEqual([404, unknown.json]);
  });

  it("says who is calling: an anonymous, read-only visitor of a test world, with no person, key or inbox behind it", async () => {
    c.env.mailDomain = "in.purser.test";
    try {
      demoOn();
      const me = (await get("/v1/demo/alder/me")).json;
      expect(me).toMatchObject({ tenant: { id: alder.t.id, slug: "alder", name: "alder test company" }, kind: "demo", principal: "demo", scopes: ["read"], role: "viewer", user: null, inbox: null,
        demo: { read_only: true, test_world: true } });
    } finally { delete c.env.mailDomain; }
  });

  it("describes itself: the OpenAPI document lists the demo's own routes and nothing else, and each of them answers", async () => {
    demoOn();
    const doc = (await get("/v1/openapi.json")).json as { info: { title: string; description: string }; paths: Record<string, Record<string, { security: unknown[] }>>; components: { securitySchemes?: unknown; schemas: { Error: { properties: { code: { enum: string[] } } } } } };
    const reads = Object.entries(DEMO).filter(([, v]) => v === "read").map(([k]) => `/v1/demo/{company}${k.split(" ")[1]!.slice("/v1".length)}`);
    expect(Object.keys(doc.paths).sort()).toEqual(["/v1/health", "/v1/openapi.json", "/v1/demo/companies", ...reads].sort());
    for (const [path, methods] of Object.entries(doc.paths)) {
      expect(Object.keys(methods), path).toEqual(["get"]);
      expect(methods.get!.security, path).toEqual([]);
    }
    expect(doc.info.description).toMatch(/read-only demo/);
    expect(doc.components.securitySchemes).toBeUndefined();
    expect(doc.components.schemas.Error.properties.code.enum).toContain("demo_read_only");
    for (const path of Object.keys(doc.paths)) {
      const real = path.startsWith("/v1/demo/{company}") ? mount("alder", pathOf(`/v1${path.slice("/v1/demo/{company}".length)}`, alder)) : path;
      expect((await get(real)).status, path).toBe(200);
    }
  });

  it("answers 404 for a path that is no route, and for a company's address that is not one", async () => {
    demoOn();
    for (const p of ["/v1/nothing", "/v1/demo", "/v1/demo/", "/v1/demo/alder", "/v1/demo/alder/", "/v1/demo/alder/nothing", "/v1/demo/alder/demo/companies", "/v1/demo/Alder/invoices", "/v1/demo/alder%2Finvoices", "/v1/demo/companies/x"]) {
      const r = await get(p);
      expect([r.status, r.json.code], p).toEqual([404, "not_found"]);
    }
  });
});

describe("demo mode, in docs/cloud.md", () => {
  it("is described as the code has it: the reads, the limits and the times are the code's own", () => {
    const doc = readFileSync("docs/cloud.md", "utf8");
    const section = doc.slice(doc.indexOf("## Public demo mode"), doc.indexOf("## Tested on D1 itself"));
    expect(section.length).toBeGreaterThan(500);
    // Every read the demo serves is named in the table, and no route that is off.
    const row = section.split("\n").find((l) => l.startsWith("| `GET /v1/demo/{company}/…`"))!;
    const named = new Set([...row.matchAll(/`([a-z][a-z/{}.0-9]*)`/g)].map((m) => `GET /v1/${m[1]!}`).filter((k) => k in DEMO));
    expect([...named].sort()).toEqual([...DEMO_READS].sort());
    for (const k of DEMO_OPEN) expect(section).toContain(`\`${k}\``);
    expect(section).toContain("`GET /v1/demo/companies`");
    expect(section).toContain("`demo_read_only`");
    // The numbers.
    expect(section).toContain(`Each address gets ${DEMO_RATE.perMinute} requests a minute`);
    expect(section).toContain(`at most ${DEMO_RATE.uncachedPerMinute} uncached reads`);
    expect(section).toContain(`remembered for ${DEMO_TTL_SEC} seconds`);
    expect(section).toContain(`browsers may keep it for ${DEMO_BROWSER_SEC} seconds`);
    expect(section).toContain(`a document by its hash for ${DEMO_DOCUMENT_BROWSER_SEC} seconds`);
    expect(section).toContain(`the health check for ${DEMO_HEALTH_SEC} seconds`);
    expect(section).toContain(`never\n  larger than ${DEMO_MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
    // It is not deployed, and says so.
    expect(section).toContain("**Not deployed yet.**");
  });
});

describe("demo mode, the log", () => {
  it("names each request by its route: never the company's address, an object's id or a key that came with it", async () => {
    const out: string[] = [];
    const sink = (line: unknown) => { out.push(String(line)); };
    vi.spyOn(console, "log").mockImplementation(sink);
    vi.spyOn(console, "warn").mockImplementation(sink);
    vi.spyOn(console, "error").mockImplementation(sink);
    try {
      demoOn();
      await get("/v1/demo/companies");
      await get(`/v1/demo/alder/invoices/${alder.invoice}`);
      await get(`/v1/demo/${hidden.slug}/invoices`);
      await c.req("POST", "/v1/keys", { key: alder.t.key, body: {} });
      await get("/v1/demo/alder/nothing");
      await get("/v1/health");
    } finally { vi.restoreAllMocks(); }
    const lines = out.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { event: string; method: string; route: string; status: number });
    expect(lines.filter((l) => l.event === "request").map((l) => `${l.method} ${l.route} ${l.status}`)).toEqual([
      "GET /v1/demo/companies 200", "GET /v1/demo/{company}/invoices/{id} 200", "GET /v1/demo/{company}/invoices 404", "POST /v1/keys 403", "GET /v1/demo/{company}/unknown 404", "GET /v1/health 200"]);
    const log = out.join("\n");
    for (const s of ["alder", hidden.slug, alder.invoice, alder.t.key]) expect(log).not.toContain(s);
  });
});

describe("demo mode, cost and abuse", () => {
  it("remembers an answer: the same read again touches neither the database nor the document store, and browsers may keep it", async () => {
    demoOn({ ttlSec: 300 });
    const watch = watchSql(c.env.sql);
    try {
      const first = await get("/v1/demo/alder/invoices?status=paid&limit=5");
      expect([first.status, first.headers.get("x-purser-cache")]).toEqual([200, "miss"]);
      expect(first.headers.get("cache-control")).toMatch(/^public, max-age=\d+$/);
      expect(first.headers.get("x-content-type-options")).toBe("nosniff");
      const n = watch.seen.length;
      expect(n).toBeGreaterThan(0);
      // The same read, its filters in another order.
      const again = await get("/v1/demo/alder/invoices?limit=5&status=paid");
      expect([again.status, again.headers.get("x-purser-cache")]).toEqual([200, "hit"]);
      expect(again.json).toEqual(first.json);
      expect(watch.seen.length).toBe(n);
      // Another company, another filter: its own answer.
      expect((await get("/v1/demo/birch/invoices?status=paid&limit=5")).headers.get("x-purser-cache")).toBe("miss");
      expect((await get("/v1/demo/alder/invoices?status=ready&limit=5")).headers.get("x-purser-cache")).toBe("miss");
      // Past its time the answer is made again.
      c.clock.now = new Date(NOW.getTime() + 301_000);
      expect((await get("/v1/demo/alder/invoices?status=paid&limit=5")).headers.get("x-purser-cache")).toBe("miss");
    } finally { watch.stop(); }
  });

  it("goes to the database as little as it can: the companies in one statement, and a company's id looked up once", async () => {
    demoOn({ ttlSec: 300 });
    const watch = watchSql(c.env.sql);
    try {
      expect((await get("/v1/demo/companies")).status).toBe(200);
      expect(watch.seen.length).toBe(1);
      const lookups = () => watch.seen.filter((q) => /FROM tenants WHERE slug = \?/.test(q)).length;
      for (const p of ["vendors", "payments", "insights", `documents/${alder.sha}`]) expect((await get(`/v1/demo/alder/${p}`)).headers.get("x-purser-cache"), p).toBe("miss");
      expect(lookups()).toBe(1);
      expect((await get("/v1/demo/birch/vendors")).status).toBe(200);
      expect(lookups()).toBe(2);
      // And asked again once the time an answer is kept has passed.
      c.clock.now = new Date(NOW.getTime() + 301_000);
      expect((await get("/v1/demo/alder/vendors")).headers.get("x-purser-cache")).toBe("miss");
      expect(lookups()).toBe(3);
    } finally { watch.stop(); }
  });

  it("remembers the health check and the API's description whatever is put after the question mark, the health check for half a minute", async () => {
    demoOn({ ttlSec: 300 });
    for (const p of ["/v1/health", "/v1/openapi.json", "/v1/demo/companies"]) {
      expect((await get(`${p}?fresh=1`)).headers.get("x-purser-cache"), p).toBe("miss");
      const again = await get(`${p}?fresh=2`);
      expect([again.status, again.headers.get("x-purser-cache")], p).toEqual([200, "hit"]);
    }
    expect((await get("/v1/health")).headers.get("cache-control")).toBe("public, max-age=30");
    c.clock.now = new Date(NOW.getTime() + 31_000);
    expect((await get("/v1/health")).headers.get("x-purser-cache")).toBe("miss");
    expect((await get("/v1/openapi.json")).headers.get("x-purser-cache")).toBe("hit");
    // A health check that fails is never remembered: the next one asks again.
    const real = c.env.sql.first.bind(c.env.sql);
    c.clock.now = new Date(NOW.getTime() + 120_000);
    c.env.sql.first = (async (q: string, p?: SqlValue[]) => { if (q.startsWith("SELECT 1")) throw new Error("D1 down"); return real(q, p); }) as Sql["first"];
    try { expect((await get("/v1/health")).status).toBe(503); } finally { c.env.sql.first = real; }
    const back = await get("/v1/health");
    expect([back.status, back.headers.get("x-purser-cache")]).toEqual([200, "miss"]);
  });

  it("remembers only good answers: a 404 or a 400 is made again each time and is never stored", async () => {
    demoOn();
    for (const p of ["/v1/demo/alder/invoices/AP-NOPE", "/v1/demo/alder/reports/secret", "/v1/demo/alder/invoices?status=NOT%20A%20WORD"]) {
      const a = await get(p);
      const b = await get(p);
      expect(a.status, p).toBeGreaterThanOrEqual(400);
      expect(b.status, p).toBe(a.status);
      expect(a.headers.get("cache-control"), p).toBe("no-store");
      expect(b.headers.get("x-purser-cache"), p).toBeNull();
    }
    // Filters without end are refused before anything is read.
    expect((await get(`/v1/demo/alder/invoices?cursor=${"x".repeat(300)}`)).status).toBe(400);
    expect((await get(`/v1/demo/alder/invoices?${Array.from({ length: 20 }, (_, i) => `p${i}=1`).join("&")}`)).status).toBe(400);
  });

  it("uses the edge cache where there is one: another isolate answers from it without the database", async () => {
    const store = new Map<string, { body: Uint8Array; headers: [string, string][] }>();
    const puts: string[] = [];
    const edge: DemoCache = {
      match: async (req) => { const e = store.get(req.url); return e ? new Response(e.body.slice(), { headers: e.headers }) : undefined; },
      put: async (req, res) => { puts.push(`${req.method} ${req.url} ${res.headers.get("cache-control")}`); store.set(req.url, { body: new Uint8Array(await res.arrayBuffer()), headers: [...res.headers] }); },
    };
    demoOn({ cache: edge, ttlSec: 300 });
    const first = await get("/v1/demo/alder/insights");
    expect(first.headers.get("x-purser-cache")).toBe("miss");
    expect(puts).toEqual([`GET ${ORIGIN}/v1/demo/alder/insights public, max-age=300`]);
    // A new isolate (nothing remembered) with the same edge cache.
    demoOn({ cache: edge, ttlSec: 300 });
    const watch = watchSql(c.env.sql);
    try {
      const second = await get("/v1/demo/alder/insights");
      expect([second.status, second.headers.get("x-purser-cache")]).toEqual([200, "edge"]);
      expect(second.json).toEqual(first.json);
      expect(second.headers.get("content-type")).toBe(first.headers.get("content-type"));
      expect(watch.seen).toEqual([]);
      // And from then on from this isolate's own memory.
      expect((await get("/v1/demo/alder/insights")).headers.get("x-purser-cache")).toBe("hit");
      expect(puts.length).toBe(1);
    } finally { watch.stop(); }
    // An edge cache that fails never fails the read.
    demoOn({ cache: { match: async () => { throw new Error("cache down"); }, put: async () => { throw new Error("cache down"); } } });
    expect((await get("/v1/demo/alder/insights")).status).toBe(200);
  });

  it("limits each address in memory: past the limit 429 until the minute is over, with no statement to the database", async () => {
    demoOn({ perMinute: 3 });
    const from = (ip: string) => get("/v1/demo/alder/vendors", { "cf-connecting-ip": ip });
    for (let i = 0; i < 3; i++) expect((await from("203.0.113.7")).status).toBe(200);
    const watch = watchSql(c.env.sql);
    try {
      const over = await from("203.0.113.7");
      expect([over.status, over.json.code]).toEqual([429, "rate_limited"]);
      expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(Number(over.headers.get("retry-after"))).toBeLessThanOrEqual(60);
      // A refused write counts too, and is answered 429 the same way.
      expect((await c.req("POST", "/v1/auth/challenge", { body: { tenant: "alder" }, headers: { "cf-connecting-ip": "203.0.113.7" } })).status).toBe(429);
      expect(watch.seen).toEqual([]);
    } finally { watch.stop(); }
    expect((await from("203.0.113.8")).status).toBe(200);
    c.clock.now = new Date(NOW.getTime() + 61_000);
    expect((await from("203.0.113.7")).status).toBe(200);
    // The database's own counters (the rate limiter outside demo mode) saw none of it.
    expect(await c.env.sql.all("SELECT bucket FROM rate_hits WHERE bucket LIKE '%203.0.113.%' OR bucket LIKE 'demo%'")).toEqual([]);
  });

  it("limits what reaches the database: past the budget of uncached reads, new reads wait a minute and remembered ones are still served", async () => {
    demoOn({ uncachedPerMinute: 2 });
    const a = await get("/v1/demo/alder/vendors", { "cf-connecting-ip": "198.51.100.1" });
    const b = await get("/v1/demo/alder/payments", { "cf-connecting-ip": "198.51.100.2" });
    expect([a.status, b.status]).toEqual([200, 200]);
    const busy = await get("/v1/demo/alder/invoices", { "cf-connecting-ip": "198.51.100.3" });
    expect([busy.status, busy.json.code]).toEqual([429, "rate_limited"]);
    expect(Number(busy.headers.get("retry-after"))).toBeGreaterThan(0);
    const kept = await get("/v1/demo/alder/vendors", { "cf-connecting-ip": "198.51.100.4" });
    expect([kept.status, kept.headers.get("x-purser-cache")]).toEqual([200, "hit"]);
    c.clock.now = new Date(NOW.getTime() + 61_000);
    expect((await get("/v1/demo/alder/invoices", { "cf-connecting-ip": "198.51.100.3" })).status).toBe(200);
  });
});

describe("demo mode, documents", () => {
  const CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";
  /** A document straight into the store and the table, as a seed would load it. */
  async function plant(co: Co, name: string, mime: string, bytes: Uint8Array, size = bytes.length): Promise<string> {
    const sha = createHash("sha256").update(bytes).digest("hex");
    await c.env.blobs.put(`t/${co.t.id}/docs/${sha}`, bytes);
    await c.env.sql.run("INSERT INTO documents (tenant_id, sha256, filename, mime, size, blob_key, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [co.t.id, sha, name, mime, size, `t/${co.t.id}/docs/${sha}`, NOW.toISOString()]);
    return sha;
  }

  it("serves an invoice's PDF with safe headers: its stored type, nosniff, no script, a download, and cacheable", async () => {
    demoOn();
    for (const path of [`/v1/demo/alder/documents/${alder.sha}`, `/v1/demo/alder/invoices/${alder.invoice}/document`]) {
      const r = await get(path);
      expect(r.status, path).toBe(200);
      expect(createHash("sha256").update(r.bytes).digest("hex"), path).toBe(alder.sha);
      expect(Buffer.from(r.bytes.slice(0, 5)).toString(), path).toBe("%PDF-");
      expect(r.headers.get("content-type"), path).toBe("application/pdf");
      expect(r.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(r.headers.get("content-security-policy"), path).toBe(CSP);
      expect(r.headers.get("content-disposition"), path).toBe('attachment; filename="bergtex-21.pdf"');
      expect(r.headers.get("cross-origin-resource-policy"), path).toBe("same-origin");
      expect(r.headers.get("cache-control"), path).toMatch(/^public, max-age=\d+/);
    }
    // By its hash a document never changes: a browser may keep it for a day.
    expect((await get(`/v1/demo/alder/documents/${alder.sha}`)).headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    // The same read again comes from memory, bytes and headers alike.
    const again = await get(`/v1/demo/alder/documents/${alder.sha}`);
    expect([again.headers.get("x-purser-cache"), again.headers.get("content-type"), again.headers.get("content-security-policy")]).toEqual(["hit", "application/pdf", CSP]);
    expect(createHash("sha256").update(again.bytes).digest("hex")).toBe(alder.sha);
  });

  it("takes the content type from the stored type, and serves any type a browser could run as plain bytes", async () => {
    const page = new TextEncoder().encode("<!doctype html><script>document.title='pwned'</script>");
    const cases: [string, string, string][] = [
      ["receipt.png", "image/png", "image/png"], ["photo.jpg", "image/jpeg", "image/jpeg"], ["note.txt", "text/plain", "text/plain; charset=utf-8"],
      ["index.json", "application/json", "application/json; charset=utf-8"], ["journal.csv", "text/csv", "text/csv; charset=utf-8"], ["upper.pdf", "Application/PDF; qs=1", "application/pdf"],
      ["page.html", "text/html", "application/octet-stream"], ["drawing.svg", "image/svg+xml", "application/octet-stream"], ["code.js", "text/javascript", "application/octet-stream"],
      ["page.xhtml", "application/xhtml+xml", "application/octet-stream"], ["unknown.bin", "", "application/octet-stream"],
      // A stored type that is the name of something every object has is a type like any other unknown one.
      ["odd-1.bin", "constructor", "application/octet-stream"], ["odd-2.bin", "__proto__", "application/octet-stream"], ["odd-3.bin", "toString", "application/octet-stream"],
    ];
    const shas: string[] = [];
    for (const [name, mime] of cases) shas.push(await plant(alder, name, mime, new Uint8Array([...page, ...new TextEncoder().encode(name)])));
    demoOn();
    for (const [i, [name, , served]] of cases.entries()) {
      const r = await get(`/v1/demo/alder/documents/${shas[i]!}`);
      expect([r.status, r.headers.get("content-type")], name).toEqual([200, served]);
      expect(r.headers.get("x-content-type-options"), name).toBe("nosniff");
      expect(r.headers.get("content-security-policy"), name).toBe(CSP);
      expect(r.headers.get("content-disposition"), name).toBe(`attachment; filename="${name}"`);
    }
    // A file name cannot break out of its header.
    const odd = await plant(alder, 'a"\r\nx-evil: 1\r\n.pdf', "application/pdf", new TextEncoder().encode("%PDF-1.4 odd name"));
    const r = await get(`/v1/demo/alder/documents/${odd}`);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="[\w.-]+"$/);
    expect(r.headers.get("x-evil")).toBeNull();
  });

  it("has a size cap: a document over it is refused, without reading it when its row says so", async () => {
    const small = new TextEncoder().encode("%PDF-1.4 small, but its row says it is huge");
    const lying = await plant(alder, "says-huge.pdf", "application/pdf", small, DEMO_MAX_DOCUMENT_BYTES + 1);
    const big = new Uint8Array(DEMO_MAX_DOCUMENT_BYTES + 1).fill(0x41);
    const huge = await plant(alder, "is-huge.pdf", "application/pdf", big, 10);
    const atCap = await plant(alder, "at-the-cap.pdf", "application/pdf", new Uint8Array(DEMO_MAX_DOCUMENT_BYTES).fill(0x42));
    demoOn();
    const real = c.env.blobs.get.bind(c.env.blobs);
    const fetched: string[] = [];
    c.env.blobs.get = async (key) => { fetched.push(key); return real(key); };
    try {
      const a = await get(`/v1/demo/alder/documents/${lying}`);
      expect([a.status, a.json.code]).toEqual([413, "too_large"]);
      expect(fetched).toEqual([]);
      const b = await get(`/v1/demo/alder/documents/${huge}`);
      expect([b.status, b.json.code]).toEqual([413, "too_large"]);
      expect(b.bytes.length).toBeLessThan(1000);
      const ok = await get(`/v1/demo/alder/documents/${atCap}`);
      expect([ok.status, ok.bytes.length]).toEqual([200, DEMO_MAX_DOCUMENT_BYTES]);
    } finally { c.env.blobs.get = real; }
  });
});

describe("with the variable unset, the same world answers as before", () => {
  it("has no demo routes, no anonymous reads and no public caching; keys, sessions and the platform token work", async () => {
    expect(c.env.demo).toBeUndefined();
    for (const p of ["/v1/demo/companies", "/v1/demo/alder/invoices", "/v1/demo/alder/me"]) {
      const r = await c.req("GET", p, { key: alder.t.key });
      expect([r.status, r.json.error], p).toEqual([404, "no such route"]);
    }
    expect((await c.req("GET", "/v1/invoices")).status).toBe(401);
    for (const key of [alder.t.key, alder.t.session]) {
      const r = await c.req("GET", "/v1/invoices", { key });
      expect(r.status).toBe(200);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      expect(r.res.headers.get("x-purser-cache")).toBeNull();
    }
    expect((await c.req("GET", "/v1/admin/companies", { key: ADMIN_TOKEN })).status).toBe(200);
    const doc = await c.req("GET", `/v1/documents/${alder.sha}`, { key: alder.t.key });
    expect([doc.status, doc.res.headers.get("cache-control"), doc.res.headers.get("content-security-policy")]).toEqual([200, "no-store", null]);
    const me = (await c.req("GET", "/v1/me", { key: alder.t.key })).json;
    expect(me).toMatchObject({ kind: "key", scopes: ["read", "sync", "admin"] });
    expect("demo" in me).toBe(false);
  });

  it("counts every request in the database, as it did (demo mode counts in memory instead)", async () => {
    const hits = async () => (await c.env.sql.first<{ n: number }>("SELECT COALESCE(SUM(count), 0) AS n FROM rate_hits"))!.n;
    const before = await hits();
    for (let i = 0; i < 3; i++) await c.req("GET", "/v1/invoices", { key: alder.t.key });
    expect(await hits()).toBe(before + 3);
    demoOn();
    for (let i = 0; i < 3; i++) await get("/v1/demo/alder/invoices");
    expect(await hits()).toBe(before + 3);
  });

  it("serves the API's own description, route for route, with no demo route in it", async () => {
    const doc = (await c.req("GET", "/v1/openapi.json")).json as { info: { title: string }; paths: Record<string, Record<string, unknown>>; components: { securitySchemes?: unknown; schemas: { Error: { properties: { code: { enum: string[] } } } } } };
    expect(Object.entries(doc.paths).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`)).sort()).toEqual(ROUTES.map(label).sort());
    expect(Object.keys(doc.paths).filter((p) => p.includes("/demo"))).toEqual([]);
    expect(doc.info.title).toBe("Purser Cloud API");
    expect(doc.components.securitySchemes).toBeDefined();
    expect(doc.components.schemas.Error.properties.code.enum).not.toContain("demo_read_only");
  });

  it("still changes things for a caller with the right key: demo mode was the only thing in the way", async () => {
    const made = await c.req("POST", "/v1/keys", { key: alder.t.key, body: { name: "after the demo", scopes: ["read"] } });
    expect(made.status).toBe(201);
    expect((await c.req("DELETE", `/v1/keys/${made.json.id as string}`, { key: alder.t.key })).status).toBe(200);
  });
});
