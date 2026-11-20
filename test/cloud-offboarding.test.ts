// Offboarding a company (outside audit, finding 3.4; docs/privacy/retention.md): only a signed-in owner with a fresh
// passkey offboards, and only after downloading the company's export. It closes the account and minimises the personal
// data around the books at once, keeps the bookkeeping (rows, documents, e-mails) byte for byte so both hash chains still
// verify, records itself in the security log, and touches no other company's rows or documents; the daily job purges the
// company only after its retention day. Expired owner-recovery requests are pruned by the daily job too.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { receiveEmail } from "../cloud/src/mail.js";
import type { EngineApi } from "../cloud/src/engine/api.js";
import { exportTenant, purgeExpired, STATUTORY_TABLES } from "../cloud/src/privacy.js";
import { ensureRecoveryTable, pruneRecoveryRequests } from "../cloud/src/recovery.js";
import { verifyChains } from "../cloud/src/restore.js";
import { readSecurityLog } from "../cloud/src/securityLog.js";
import { r2Blobs } from "../cloud/src/store.js";
import { TENANT_TABLES } from "../cloud/src/tenant.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { openDb } from "../src/db/open.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { emlWith, pdfOf } from "./fakes/pdf.js";
import { addPerson, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-08T12:00:00Z");
const DOMAIN = "in.purser.test";
let c: TestCloud, dir: string;

beforeEach(() => {
  c = testCloud();
  if (globalThis.__cloudR2) c.env.blobs = r2Blobs(globalThis.__cloudR2);
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-offboarding-"));
});
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });

/** A company with books pushed from its runner (a document, the ledger, the audit chain), an e-mailed invoice and a second person. */
async function company(slug: string): Promise<TestTenant> {
  const t = await c.tenant(slug);
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(EN), filename: `${slug}.pdf`, source: "upload" });
  await pushToCloud(db, { url: "https://cloud.test", key: t.key, fetch: c.fetch }, NOW);
  const raw = emlWith(await pdfOf(`${EN}\n${slug}`), "mail.pdf");
  const m = { from: "billing@bergtex.example", to: `${slug}@${DOMAIN}`, raw: new Uint8Array(raw), rawSize: raw.length, setReject() {} };
  expect(await receiveEmail(c.env.sql, c.env.blobs, m, { domain: DOMAIN, now: NOW })).toMatchObject({ queued: true });
  const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: `Accountant of ${slug}`, email: `acc@${slug}.example`, role: "accountant" } });
  expect(u.status).toBe(201);
  return t;
}

/** Every row the company has in every table, as JSON (the lazily made tables included), for a before-and-after compare. */
async function rowsOf(tenantId: string, tables: readonly string[] = [...TENANT_TABLES, "api_keys", "challenges", "sessions", "recovery_requests", "export_links_used"]): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    try { out[t] = await c.env.sql.all(`SELECT * FROM ${t} WHERE tenant_id = ? ORDER BY rowid`, [tenantId]); } catch { out[t] = []; }
  }
  return out;
}
const count = (rows: Record<string, unknown[]>) => Object.values(rows).reduce((n, r) => n + r.length, 0);

/** Each object the company has in R2 with its bytes as hex: documents, e-mails, the vault, staged exports. */
async function objectsOf(tenantId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const prefix of [`t/${tenantId}/`, `exports/${tenantId}/`]) {
    for (const k of await c.env.blobs.list(prefix)) out[k] = Buffer.from((await c.env.blobs.get(k))!).toString("hex");
  }
  return out;
}

/** A staged export, made and its manifest downloaded (which marks it downloaded). */
async function downloadedExport(t: TestTenant): Promise<string> {
  const s = await c.req("POST", "/v1/export/staged", { key: t.key });
  expect(s.status).toBe(201);
  const m = await c.fetch(s.json.manifest_url as string);
  expect(m.status).toBe(200);
  return s.json.id as string;
}

const offboard = (t: TestTenant, key: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => c.req("POST", "/v1/offboarding", { key, body, headers });

describe("who may offboard a company", () => {
  it("a key, a CFO, an accountant and an owner whose passkey check is stale are refused; the company stays open", async () => {
    const a = await company("northwind");
    const exportId = await downloadedExport(a);
    const cfo = await addPerson(c, "northwind", a.session, "cfo");
    const accountant = await addPerson(c, "northwind", a.session, "accountant", "Second Accountant");
    const before = await rowsOf(a.id);
    const asKey = await offboard(a, a.key, { confirm: "northwind", export_id: exportId });
    expect(asKey.status).toBe(403);
    for (const person of [cfo, accountant]) expect((await offboard(a, person.session, { confirm: "northwind", export_id: exportId })).status).toBe(403);
    // The owner signed in six minutes ago: a fresh passkey check is asked for, always (not only when the setting is on).
    c.clock.now = new Date(c.clock.now.getTime() + 6 * 60_000);
    const stale = await offboard(a, a.session, { confirm: "northwind", export_id: exportId });
    expect(stale.status).toBe(403);
    expect(stale.json.code).toBe("step_up_required");
    expect((await c.env.sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [a.id]))!.closed_at).toBeNull();
    const after = await rowsOf(a.id);
    // Nothing of the company changed but the rate and security bookkeeping of the refusals themselves.
    for (const t of [...STATUTORY_TABLES, "users", "credentials", "api_keys", "webhooks", "exports"]) expect({ t, rows: after[t] }).toEqual({ t, rows: before[t] });
    // Each refusal is in the platform's security log.
    const denied = (await readSecurityLog(c.env.sql, { kind: "access.denied" })).items.filter((r) => r.route === "POST /v1/offboarding" && r.tenant_id === a.id);
    expect(denied.length).toBeGreaterThanOrEqual(4);
  });

  it("an owner must type the company's address and name an export they downloaded, still open", async () => {
    const a = await company("northwind");
    const s = await c.req("POST", "/v1/export/staged", { key: a.key });
    const id = s.json.id as string;
    expect((await offboard(a, a.session, { confirm: "northwind", export_id: id })).json.error).toMatch(/download the export first/);
    await c.fetch(s.json.manifest_url as string);
    expect((await offboard(a, a.session, { confirm: "not-northwind", export_id: id })).json.error).toMatch(/confirm with the company's address \(northwind\)/);
    expect((await offboard(a, a.session, { confirm: "northwind", export_id: "x_unknown" })).json.error).toMatch(/needs the company's export first/);
    expect((await offboard(a, a.session, { confirm: "northwind" })).status).toBe(400);
    expect((await c.env.sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [a.id]))!.closed_at).toBeNull();
  });
});

describe("offboarding a company", () => {
  it("closes it, pseudonymises its people, keeps its books and documents byte for byte, and leaves another company untouched", async () => {
    const a = await company("northwind");
    const b = await company("other");
    const exportId = await downloadedExport(a);
    await c.req("POST", "/v1/webhook", { key: a.key, body: { url: "https://hooks.northwind.example/purser" } });
    const aBooks = await rowsOf(a.id, STATUTORY_TABLES);
    expect(aBooks.audit_rows!.length).toBeGreaterThan(0);
    expect(aBooks.documents!.length).toBeGreaterThan(0);
    expect(aBooks.inbound_mail!.length).toBeGreaterThan(0);
    const aObjects = await objectsOf(a.id);
    expect(Object.keys(aObjects).some((k) => k.includes("/docs/"))).toBe(true);
    expect(Object.keys(aObjects).some((k) => k.includes("/mail/"))).toBe(true);
    const bRows = await rowsOf(b.id), bObjects = await objectsOf(b.id);
    expect(count(bRows)).toBeGreaterThan(0);
    expect(await verifyChains(await exportTenant(c.env.sql, a.id))).toBeNull();

    const r = await offboard(a, a.session, { confirm: "northwind", export_id: exportId });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ export_id: exportId, purge_after: "2033-12-31", people_pseudonymised: 2, keys_revoked: 1 });
    expect(r.json.kept_until_purge).toEqual([...STATUTORY_TABLES]);

    // Closed: the owner's session and key no longer work.
    expect((await c.env.sql.first<{ closed_at: string | null; purge_after: string }>("SELECT closed_at, purge_after FROM tenants WHERE id = ?", [a.id]))).toEqual({ closed_at: NOW.toISOString(), purge_after: "2033-12-31" });
    expect((await c.req("GET", "/v1/me", { key: a.session })).status).toBe(401);
    expect((await c.req("GET", "/v1/me", { key: a.key })).status).toBe(401);
    // The people: a pseudonym, no e-mail; no passkey, sign-in link, session or open invite; no message target.
    const people = await c.env.sql.all<{ id: string; display_name: string; email: string | null; erased_at: string | null }>("SELECT id, display_name, email, erased_at FROM users WHERE tenant_id = ?", [a.id]);
    expect(people.length).toBe(2);
    for (const p of people) expect(p).toEqual({ id: p.id, display_name: `Former member ${p.id}`, email: null, erased_at: NOW.toISOString() });
    const after = await rowsOf(a.id);
    for (const t of ["credentials", "identity_links", "sessions", "challenges", "recovery_requests", "webhooks", "alert_targets", "chat_hooks"]) expect({ t, n: after[t]!.length }).toEqual({ t, n: 0 });
    expect((after.api_keys as { revoked_at: string | null }[]).every((k) => k.revoked_at)).toBe(true);
    expect(JSON.stringify(await exportTenant(c.env.sql, a.id))).not.toMatch(/Accountant of northwind|acc@northwind\.example|hooks\.northwind\.example/);

    // The bookkeeping is kept as it was, and its documents and e-mails; both hash chains still verify.
    expect(await rowsOf(a.id, STATUTORY_TABLES)).toEqual(aBooks);
    const kept = await objectsOf(a.id);
    for (const [k, v] of Object.entries(aObjects)) if (!k.startsWith("exports/")) expect({ k, same: kept[k] === v }).toEqual({ k, same: true });
    expect(await verifyChains(await exportTenant(c.env.sql, a.id))).toBeNull();

    // The other company: every row and every object as it was, and its owner still signed in.
    expect(await rowsOf(b.id)).toEqual(bRows);
    expect(await objectsOf(b.id)).toEqual(bObjects);
    expect((await c.req("GET", "/v1/me", { key: b.session })).status).toBe(200);

    // Recorded: in the company's own security events and in the platform's security log, with counts and no name.
    expect((after.security_events as { kind: string; actor: string }[]).filter((e) => e.kind === "company.offboarded")).toEqual([expect.objectContaining({ actor: a.owner })]);
    const logged = (await readSecurityLog(c.env.sql, { kind: "access.change" })).items.filter((x) => x.route === "POST /v1/offboarding");
    expect(logged).toEqual([expect.objectContaining({ tenant_id: a.id, actor: a.owner, status: 200, detail: expect.objectContaining({ offboarding: true, export_id: exportId, purge_after: "2033-12-31", people_pseudonymised: 2 }) })]);
    expect(JSON.stringify(logged)).not.toMatch(/Accountant of northwind|acc@northwind/);

    // A second offboarding is refused: the account is closed (and the old session no longer signs in at all).
    expect((await offboard(a, a.session, { confirm: "northwind", export_id: exportId })).status).toBe(401);
  });

  it("revokes every person's approval passkey in the company's engine first; if the engine fails, nothing is closed", async () => {
    const a = await company("northwind");
    const exportId = await downloadedExport(a);
    const asked: string[] = [];
    let fail = true;
    c.env.engine = (tenantId) => ({
      forgetPasskey: async (person: string) => {
        if (fail) throw new Error("engine unreachable");
        asked.push(`${tenantId}:${person}`);
        return { revoked: 1 };
      },
    }) as unknown as EngineApi;
    const failed = await offboard(a, a.session, { confirm: "northwind", export_id: exportId });
    expect(failed.status).toBe(502);
    expect((await c.env.sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [a.id]))!.closed_at).toBeNull();
    fail = false;
    expect((await offboard(a, a.session, { confirm: "northwind", export_id: exportId })).status).toBe(200);
    const people = (await c.env.sql.all<{ id: string }>("SELECT id FROM users WHERE tenant_id = ? ORDER BY id", [a.id])).map((p) => `${a.id}:${p.id}`);
    expect(asked).toEqual(people);
  });

  it("is purged only after its retention day, rows, sessions and documents, and never another company's", async () => {
    const a = await company("northwind");
    const b = await company("other");
    const exportId = await downloadedExport(a);
    expect((await offboard(a, a.session, { confirm: "northwind", export_id: exportId })).status).toBe(200);
    // Rows the company keeps in tables made on first use, which the purge must reach as well.
    await ensureRecoveryTable(c.env.sql);
    await c.env.sql.run("INSERT INTO recovery_requests (id, tenant_id, owner_id, check_method, requested_by, requested_at, expires_at) VALUES ('rr_a', ?, ?, 'video_call', 'ops-first', ?, ?)", [a.id, a.owner, NOW.toISOString(), NOW.toISOString()]);
    const bRows = await rowsOf(b.id), bObjects = await objectsOf(b.id);
    expect(await purgeExpired(c.env.sql, c.env.blobs, new Date("2033-12-31T23:00:00Z"))).toEqual([]);
    expect((await rowsOf(a.id, STATUTORY_TABLES)).audit_rows!.length).toBeGreaterThan(0);
    expect(await purgeExpired(c.env.sql, c.env.blobs, new Date("2034-01-01T00:30:00Z"))).toEqual([a.id]);
    expect(count(await rowsOf(a.id))).toBe(0);
    expect(await objectsOf(a.id)).toEqual({});
    // The other company: every row and object as it was. Its sign-in challenges, spent and years past their expiry, are
    // the job's housekeeping for every company and not part of this comparison.
    const { challenges: _spent, ...bKept } = bRows;
    const { challenges: _gone, ...bNow } = await rowsOf(b.id);
    expect(bNow).toEqual(bKept);
    expect(await objectsOf(b.id)).toEqual(bObjects);
  });
});

describe("the daily job's housekeeping of owner recovery requests", () => {
  it("drops a request that expired unapproved after a day and an approved one after a year; keeps the rest", async () => {
    await ensureRecoveryTable(c.env.sql);
    const row = (id: string, expires: string, approved: string | null) => c.env.sql.run("INSERT INTO recovery_requests (id, tenant_id, owner_id, check_method, requested_by, requested_at, expires_at, approved_by, approved_at) VALUES (?, 't_acme0001', 'u_owner', 'video_call', 'ops-first', ?, ?, ?, ?)", [id, expires, expires, approved ? "ops-second" : null, approved]);
    await row("rr_old_open", "2026-11-06T00:00:00Z", null); // expired two days ago, never approved: goes
    await row("rr_open", "2026-11-09T00:00:00Z", null); // still waiting for its second admin: stays
    await row("rr_just_expired", "2026-11-08T00:00:00Z", null); // expired today: stays a day
    await row("rr_approved", "2026-06-01T00:00:00Z", "2026-05-31T12:00:00Z"); // approved this year: stays
    await row("rr_approved_old", "2025-10-01T00:00:00Z", "2025-09-30T12:00:00Z"); // approved over a year ago: goes
    expect(await pruneRecoveryRequests(c.env.sql, NOW)).toBe(2);
    expect((await c.env.sql.all<{ id: string }>("SELECT id FROM recovery_requests ORDER BY id")).map((r) => r.id)).toEqual(["rr_approved", "rr_just_expired", "rr_open"]);
  });
});
