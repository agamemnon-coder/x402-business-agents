// The engine in a Durable Object, for real: the cloud Worker's entry point (cloud/src/entry.ts) bundled by wrangler
// with the settings of cloud/wrangler.jsonc (the object and its migration, the define, the alias, the module rules)
// and run in local workerd with a SQLite-backed object per company, local D1 and local R2. Everything goes through
// the cloud's own routes with an owner's session: one supplier invoice from upload to paid on the stand-in bank (test
// money), booked, archived and in the read model; the catches; a refusal in the inbox's own words across the object's
// stub; and two companies that stay apart.
//
// Runs only with CLOUD_DB=d1 (npm run test:d1), where wrangler's toolchain is installed (npm ci --prefix worker).
// Local only: no network, no Cloudflare account, nothing kept (the stores are in memory and thrown away).
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionToken } from "../cloud/src/auth.js";
import type { EngineNamespace } from "../cloud/src/engine/client.js";
import type { D1Like, R2Like } from "../cloud/src/store.js";
import { sha256Hex } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ADMIN_TOKEN, ORIGIN, RP } from "./support/cloud.js";
import { aliasOf, cloudWranglerConfig, fromConfig } from "./support/wranglerConfig.js";

interface Workerd { ready: Promise<void>; fetch(url: string, init?: RequestInit): Promise<Response>; dispose(): Promise<void> }
interface Wrangler { unstable_startWorker(options: { config: string; dev: Record<string, unknown> }): Promise<Workerd> }
interface Proposal { id: string; kind: string; status: string; terms_sha256: string; challenge: string; facts: [string, string][]; warnings: string[] }
interface Invoice { id: string; status: string; payable: boolean; findings: { code: string }[]; proposal: Proposal | null }
interface Settled { invoice_status: string | null; transfer_status: string | null; ledger_entries: number; vault_added: string[]; fed: boolean; error: string | null }
interface Company { id: string; owner: string; session: string }
type Answer = { status: number; json: Record<string, unknown> & { error?: string }; res: Response };

const D1 = process.env.CLOUD_DB === "d1";
/** Test values, not secrets: the session secret of this local Worker and the hash of the tests' admin token. */
const SESSION_SECRET = "s".repeat(48);
const ADMIN_TOKEN_SHA256 = createHash("sha256").update(ADMIN_TOKEN).digest("hex");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const EN_COPY = EN.replace(/BTX-2026-21/g, "BTX-2026-21A");
/** Another invoice of the same supplier: another number, another amount. */
const EN_NEXT = EN.replace(/BTX-2026-21/g, "BTX-2026-22").replace("1,554.62", "1,000.00").replace("295.38", "190.00").replace("1,850.00", "1,190.00").replace("2 November", "3 November").replace("16 November", "17 November");
/** Local workerd drops an idle object's memory after about 10 s (measured here on 12 November 2026 with a temporary time stamp in the host: the same after 5 s idle, a new one after 12 s). */
const IDLE_MS = 12_000;

describe("the engine in a Durable Object per company, behind the cloud's routes (local workerd)", () => {
  if (!D1) {
    it.skip("skipped in the plain run: it needs wrangler's toolchain and runs with npm run test:d1", () => undefined);
    return;
  }

  const config = cloudWranglerConfig();
  let dir: string;
  let workerd: Workerd | undefined;
  let A: Company;
  let B: Company;
  let bytes: Buffer;
  let proposal: Proposal;
  const phone = new FakeAuthenticator();

  const req = async (method: string, path: string, o: { key?: string; body?: unknown } = {}): Promise<Answer> => {
    const headers: Record<string, string> = {};
    if (o.key) headers.authorization = `Bearer ${o.key}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await workerd!.fetch(`${ORIGIN}${path}`, { method, headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
    const text = await res.clone().text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* a document */ }
    return { status: res.status, json, res };
  };
  /** A company made by the cloud's own admin route, and its owner's session, signed with this Worker's test secret. */
  const company = async (slug: string): Promise<Company> => {
    const r = await req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug, name: `${slug} test company`, owner: { display_name: "Owner" } } });
    if (r.status !== 201) throw new Error(`company ${slug}: ${r.status} ${JSON.stringify(r.json)}`);
    const id = (r.json.tenant as { id: string }).id, owner = (r.json.owner as { id: string }).id;
    return { id, owner, session: await sessionToken(SESSION_SECRET, { tenantId: id, userId: owner, role: "owner", gen: 0 }, new Date()) };
  };

  beforeAll(async () => {
    // Nothing here may leave the machine: no proxy, no metrics, no request of Miniflare's own.
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "all_proxy"]) delete process.env[k];
    process.env.WRANGLER_SEND_METRICS = "false";
    process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
    // wrangler is pinned in worker/ (the relay's toolchain): it bundles the Worker as a deploy would.
    const wrangler = createRequire(resolve("worker/package.json"))("wrangler") as Wrangler;
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-engine-"));
    // cloud/wrangler.jsonc itself, with its paths made absolute, local stores, and this test's values for the vars
    // and the two secrets. ENGINE_MODE is the switch that turns the engine routes on.
    writeFileSync(join(dir, "wrangler.json"), JSON.stringify({
      name: config.name, main: fromConfig(config.main), compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags,
      durable_objects: config.durable_objects, migrations: config.migrations, define: config.define, alias: aliasOf(config), rules: config.rules,
      d1_databases: [{ binding: config.d1_databases[0]!.binding, database_name: config.d1_databases[0]!.database_name, database_id: "00000000-0000-0000-0000-000000000001" }],
      r2_buckets: [{ binding: config.r2_buckets[0]!.binding, bucket_name: config.r2_buckets[0]!.bucket_name }],
      vars: { RP_ID: RP, ORIGIN, ENGINE_MODE: "test_money", SESSION_SECRET, ADMIN_TOKEN_SHA256 },
    }));
    workerd = await wrangler.unstable_startWorker({ config: join(dir, "wrangler.json"), dev: { persist: false, watch: false, remote: false, inspector: false, logLevel: "error", server: { hostname: "127.0.0.1", port: 0 } } });
    await workerd.ready;
    A = await company("northwind");
    B = await company("bravo");
    expect((await req("POST", "/v1/company", { key: A.session, body: { language: "en" } })).status).toBe(200);
    bytes = await pdfOf(EN);
  }, 240_000);

  afterAll(async () => {
    await Promise.race([workerd?.dispose().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("starts as the cloud it was: health answers, and the read model is empty", async () => {
    expect((await req("GET", "/v1/health")).status).toBe(200);
    expect((await req("GET", "/v1/invoices", { key: A.session })).json.items).toEqual([]);
  });

  it("says where the engine stands on its first call: test money, seeded, no passkey, both chains whole", async () => {
    const r = await req("GET", "/v1/engine", { key: A.session });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ mode: "test_money", passkey: null, chains: { audit: true, ledger: true } });
    expect(Number((r.json.balances as Record<string, string>).EUR)).toBeGreaterThan(0);
  });

  it("takes the upload across the object's stub: the bytes arrive whole, read by the engine's own PDF reader", async () => {
    const r = await req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex-BTX-2026-21.pdf", mime: "application/pdf", base64: b64(bytes) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ kind: "invoice", sha256: sha256(bytes) });
    expect(r.json.invoice).toMatchObject({ id: "AP-0001", status: "ready", status_words: "Ready to pay", payable: true, vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", currency: "EUR", total: "1850.00", read_by: "parser", findings: [], doc_sha256: sha256(bytes), proposal: null });
  });

  it("refuses what is not an invoice in the inbox's own words, unchanged across the stub (400, never 500)", async () => {
    const r = await req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "notes.txt", base64: b64(Buffer.from("just some words")) } });
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(r.json.error).toMatch(/^notes\.txt is not a PDF.*nothing was filed$/);
    expect(((await req("GET", "/v1/engine/invoices", { key: A.session })).json.items as Invoice[]).map((i) => `${i.id} ${i.status}`)).toEqual(["AP-0001 ready"]);
  });

  it("files the payment for approval, once", async () => {
    const r = await req("POST", "/v1/engine/invoices/AP-0001/pay", { key: A.session });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    proposal = r.json.proposal as Proposal;
    expect(proposal).toMatchObject({ id: "P-0001", kind: "invoice_payment", status: "PENDING_APPROVAL", terms_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), warnings: [] });
    expect(proposal.challenge).toBe(challengeFor(proposal.terms_sha256));
    expect(proposal.facts).toEqual(expect.arrayContaining([["Amount", "EUR 1,850.00"], ["Payee", "Bergtex Textil GmbH, IBAN …3000"]]));
    const twice = await req("POST", "/v1/engine/invoices/AP-0001/pay", { key: A.session });
    expect(twice.status).toBe(409);
    expect(twice.json.error).toMatch(/^AP-0001 is waiting cfo, not ready to pay/);
  });

  it("sets up the approval passkey of the signed-in person", async () => {
    const start = await req("POST", "/v1/engine/passkey/start", { key: A.session });
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    expect(start.json).toMatchObject({ rp: { id: RP, name: "Purser" }, user: { id: A.owner, name: "Owner", displayName: "Owner" }, exclude: [] });
    const done = await req("POST", "/v1/engine/passkey/finish", { key: A.session, body: { code: start.json.code, credential: phone.register({ challenge: start.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json).toEqual({ credential_id: phone.credentialId });
    expect((await req("GET", "/v1/engine", { key: A.session })).json.passkey).toEqual({ credential_id: phone.credentialId, label: "Owner" });
  });

  it("refuses a signature over other terms: nothing is paid", async () => {
    const r = await req("POST", "/v1/engine/proposals/P-0001/approve", { key: A.session, body: { terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: challengeFor(sha256Hex("other terms")), origin: ORIGIN, rpId: RP, counter: 1 }) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ status: "refused", settled: null });
    expect(((await req("GET", "/v1/engine/invoices", { key: A.session })).json.items as Invoice[])[0]).toMatchObject({ id: "AP-0001", status: "waiting_cfo" });
    expect((await req("GET", "/v1/payments", { key: A.session })).json.items).toEqual([]);
  });

  it("pays on the right signature: paid on the stand-in bank, booked, archived, and the read model shows it", async () => {
    const r = await req("POST", "/v1/engine/proposals/P-0001/approve", { key: A.session, body: { terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 2 }) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ status: "approved", message: expect.stringContaining("P-0001 approved") });
    const settled = r.json.settled as Settled;
    expect(settled).toMatchObject({ invoice_status: "paid", transfer_status: "PAID", ledger_entries: 7, fed: true, error: null });
    expect(settled.vault_added).toHaveLength(3);

    // The read model (D1 and R2), through the routes every console screen uses.
    const invoices = (await req("GET", "/v1/invoices", { key: A.session })).json.items as { id: string; status: string }[];
    expect(invoices.find((i) => i.id === "AP-0001")).toMatchObject({ status: "paid", vendor: "Bergtex Textil GmbH", total: "1850.00" });
    const doc = await req("GET", "/v1/invoices/AP-0001/document", { key: A.session });
    expect(doc.status).toBe(200);
    expect(Buffer.from(await doc.res.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await req("GET", "/v1/ledger/entries", { key: A.session })).json.items).toHaveLength(7);
    expect(((await req("GET", "/v1/payments", { key: A.session })).json.items as { status: string }[]).map((p) => p.status)).toEqual(["PAID"]);
    expect((await req("GET", "/v1/engine", { key: A.session })).json.chains).toEqual({ audit: true, ledger: true });
  });

  it("lists the archive's three files and hands each out whole across the stub", async () => {
    const r = await req("GET", "/v1/engine/vault", { key: A.session });
    expect(r.status).toBe(200);
    const files = r.json.files as { path: string; kind: string; bytes: number; sha256: string }[];
    expect(files.map((f) => f.kind).sort()).toEqual(["invoice", "receipt", "suppliers"]);
    for (const f of files) {
      const got = await req("GET", `/v1/engine/vault/file?path=${encodeURIComponent(f.path)}`, { key: A.session });
      expect(got.status, f.path).toBe(200);
      const body = Buffer.from(await got.res.arrayBuffer());
      expect(body.length, f.path).toBe(f.bytes);
      expect(sha256(body), f.path).toBe(f.sha256);
      expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }
    expect(files.find((f) => f.kind === "invoice")!.sha256).toBe(sha256(bytes));
    expect((await req("GET", `/v1/engine/vault/file?path=${encodeURIComponent(`${files[0]!.path}x`)}`, { key: A.session })).status).toBe(404);
  });

  it("follows, books, archives and feeds again on request, and adds nothing", async () => {
    const r = await req("POST", "/v1/engine/sync", { key: A.session });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ invoice_status: null, transfer_status: null, ledger_entries: 7, vault_added: [], fed: true, error: null });
  });

  it("catches the same file again and a renumbered copy, and files no payment for a held invoice", async () => {
    const again = await req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "again.pdf", base64: b64(bytes) } });
    expect(again.json).toMatchObject({ kind: "duplicate_document", sha256: sha256(bytes), invoice: { id: "AP-0001" } });
    const copy = await req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "copy.pdf", base64: b64(await pdfOf(EN_COPY)) } });
    expect(copy.status, JSON.stringify(copy.json)).toBe(200);
    const held = copy.json.invoice as Invoice;
    expect(held).toMatchObject({ id: "AP-0002", status: "needs_review", payable: false });
    expect(held.findings.map((f) => f.code)).toContain("possible_duplicate");
    const pay = await req("POST", "/v1/engine/invoices/AP-0002/pay", { key: A.session });
    expect(pay.status).toBe(409);
    expect(pay.json.error).toMatch(/^AP-0002 is needs review, not ready to pay/);
  });

  it("keeps companies apart: the other company finds nothing of this one, and its own engine is empty", async () => {
    const path = ((await req("GET", "/v1/engine/vault", { key: A.session })).json.files as { path: string }[])[0]!.path;
    expect((await req("POST", "/v1/engine/invoices/AP-0001/pay", { key: B.session })).status).toBe(404);
    expect((await req("GET", "/v1/engine/proposals/P-0001", { key: B.session })).status).toBe(404);
    expect((await req("GET", `/v1/engine/vault/file?path=${encodeURIComponent(path)}`, { key: B.session })).status).toBe(404);
    expect((await req("GET", "/v1/engine/invoices", { key: B.session })).json).toEqual({ items: [] });
    expect((await req("GET", "/v1/engine/vault", { key: B.session })).json).toEqual({ files: [] });
    expect((await req("GET", "/v1/engine", { key: B.session })).json).toMatchObject({ mode: "test_money", passkey: null, chains: { audit: true, ledger: true } });
    expect((await req("GET", "/v1/invoices", { key: B.session })).json.items).toEqual([]);
    const events = (await req("GET", "/v1/engine/events", { key: B.session })).json.items as { event: string; subject: string | null }[];
    expect(events.map((e) => e.event)).toContain("treasury.seeded");
    expect(events.filter((e) => e.subject === "AP-0001")).toEqual([]);
  });

  it("goes on from its own SQLite after the object's memory was dropped: the stand-in bank, the passkey and a payment waiting for its approval", async () => {
    const up = await req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex-BTX-2026-22.pdf", base64: b64(await pdfOf(EN_NEXT)) } });
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    const next = up.json.invoice as Invoice;
    expect(next, JSON.stringify(next)).toMatchObject({ status: "ready", payable: true, findings: [] });
    // Filing the payment locks a quote at the stand-in bank; the approval comes after the object was idle.
    const filed = await req("POST", `/v1/engine/invoices/${next.id}/pay`, { key: A.session });
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    const waiting = filed.json.proposal as Proposal;
    const before = (await req("GET", "/v1/engine", { key: A.session })).json;
    const entries = ((await req("POST", "/v1/engine/sync", { key: A.session })).json as unknown as Settled).ledger_entries;

    await new Promise((r) => setTimeout(r, IDLE_MS));

    expect((await req("GET", "/v1/engine", { key: A.session })).json).toEqual(before);
    // Seeded once in the object's life, not once per start.
    const events = (await req("GET", "/v1/engine/events?limit=200", { key: A.session })).json.items as { event: string }[];
    expect(events.filter((e) => e.event === "treasury.seeded")).toHaveLength(1);
    // Nothing is booked twice. (The archive's new files are not compared: once a day has a second suppliers list, the
    // vault files another one on every sync, in Node as here; that is the vault's own matter, src/vault/build.ts.)
    expect((await req("POST", "/v1/engine/sync", { key: A.session })).json).toMatchObject({ invoice_status: null, transfer_status: null, ledger_entries: entries, fed: true, error: null });
    const r = await req("POST", `/v1/engine/proposals/${waiting.id}/approve`, { key: A.session, body: { terms_sha256: waiting.terms_sha256, credential: phone.sign({ challenge: waiting.challenge, origin: ORIGIN, rpId: RP, counter: 3 }) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json, JSON.stringify(r.json)).toMatchObject({ status: "approved", settled: { invoice_status: "paid", transfer_status: "PAID", fed: true, error: null } });
    expect((r.json.settled as Settled).ledger_entries).toBeGreaterThan(entries);
    expect((await req("GET", "/v1/engine", { key: A.session })).json.chains).toEqual({ audit: true, ledger: true });
    const paid = ((await req("GET", "/v1/invoices", { key: A.session })).json.items as { id: string; status: string }[]).filter((i) => i.status === "paid").map((i) => i.id).sort();
    expect(paid).toEqual(["AP-0001", next.id]);
  }, 90_000);

  describe("the switch, on the Worker itself (cloud/src/worker.ts in this process, over local D1 and R2)", () => {
    const asked: string[] = [];
    const ENGINE: EngineNamespace = {
      idFromName: (name) => name,
      get: (id) => ({ call: async (tenantId, method) => { asked.push(`${String(id)} ${tenantId} ${method}`); return { ok: true, value: { mode: "test_money", passkey: null, balances: {}, chains: { audit: true, ledger: true } } }; } }),
    };

    it("turns the engine routes on only with the ENGINE binding and ENGINE_MODE test_money", async () => {
      const { default: worker } = await import("../cloud/src/worker.js");
      const base = { DB: globalThis.__cloudD1!.next() as D1Like, DOCS: globalThis.__cloudR2 as R2Like, SESSION_SECRET, ADMIN_TOKEN_SHA256, RP_ID: RP, ORIGIN };
      const made = await worker.fetch(new Request(`${ORIGIN}/v1/admin/tenants`, { method: "POST", headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ slug: "switch", name: "Switch test company", owner: { display_name: "Owner" } }) }), base);
      expect(made.status).toBe(201);
      const t = (await made.json()) as { tenant: { id: string }; owner: { id: string } };
      const session = await sessionToken(SESSION_SECRET, { tenantId: t.tenant.id, userId: t.owner.id, role: "owner", gen: 0 }, new Date());
      const engine = (b: Record<string, unknown>) => worker.fetch(new Request(`${ORIGIN}/v1/engine`, { headers: { authorization: `Bearer ${session}` } }), { ...base, ...b });
      expect((await engine({})).status).toBe(404);
      expect((await engine({ ENGINE })).status).toBe(404);
      expect((await engine({ ENGINE_MODE: "test_money" })).status).toBe(404);
      expect((await engine({ ENGINE, ENGINE_MODE: "live" })).status).toBe(404);
      expect(asked).toEqual([]);
      const on = await engine({ ENGINE, ENGINE_MODE: "test_money" });
      expect(on.status).toBe(200);
      expect(await on.json()).toMatchObject({ mode: "test_money" });
      expect(asked).toEqual([`${t.tenant.id} ${t.tenant.id} status`]);
    });
  });
});
