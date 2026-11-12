// SPIKE (branch spike-do-lead, the tech lead's check): the two probes joined. The cloud Worker (cloud/src/worker.ts,
// unchanged) with one Durable Object per company in front, and in that object the REAL engine on its own SQLite:
//   the chain of spike-do-chain (ingest, checks, propose, passkey approval over the exact terms, execute, syncPayments,
//   syncLedger), but with the engine's real PDF text reader (spike-do-runtime's inline reader, no stand-in),
//   then batchesFor -> the cloud's own applySync on the D1 and R2 bindings (no HTTP, no sync key),
//   then the vault (syncVault, pdfkit) into R2,
// and the result read back through the console's own API with a session. Stand-ins, for the outside world only: the
// parser instead of Claude, the tests' in-memory Airwallex, a software passkey (made inside the object here).
import { DurableObject } from "cloudflare:workers";
import * as pdfkit from "pdfkit";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";
import HelveticaOblique from "pdfkit/standard-fonts/HelveticaOblique";
import cloud, { type Bindings } from "../../cloud/src/worker.js";
import { ensureSchema } from "../../cloud/src/app.js";
import { AuthError, callerOf, need, sessionToken } from "../../cloud/src/auth.js";
import { d1Sql, r2Blobs, type Blobs, type Sql } from "../../cloud/src/store.js";
import { applySync, SyncBatch } from "../../cloud/src/sync.js";
import { TenantDb } from "../../cloud/src/tenant.js";
import { seedTreasury } from "../../src/agents/euroBill.js";
import { useDocStore } from "../../src/ap/docStore.js";
import { ingestDocument } from "../../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../../src/ap/pay.js";
import { usePdfReader } from "../../src/ap/pdfText.js";
import { readPdfInline } from "../../src/ap/pdfTextInline.js";
import type { Asker } from "../../src/ap/read.js";
import { apInvoice } from "../../src/ap/store.js";
import { verifyAuditChain } from "../../src/audit/log.js";
import { batchesFor, type CloudState } from "../../src/cloudsync/client.js";
import { DoDatabase, type DoStorage } from "../../src/db/doSql.js";
import LEDGER from "../../src/db/ledger.sql";
import { prepareDb } from "../../src/db/migrate.js";
import type { DB } from "../../src/db/open.js";
import SCHEMA from "../../src/db/schema.sql";
import { execute } from "../../src/executors/index.js";
import { verifyLedger } from "../../src/ledger/core.js";
import { syncLedger } from "../../src/ledger/feed.js";
import { sha256Hex } from "../../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../../src/passkey/process.js";
import { challengeFor } from "../../src/passkey/webauthn.js";
import { FakeAirwallex } from "../../src/redteam/airwallex.js";
import { FakeAuthenticator } from "../../src/redteam/authenticator.js";
import { syncVault } from "../../src/vault/build.js";
import { sha256 as sha256Of, type VaultSink } from "../../src/vault/sink.js";
import invoicePdf from "./fixtures/bergtex.pdf";
import bankChangePdf from "./fixtures/bankchange.pdf";
import renumberedPdf from "./fixtures/renumbered.pdf";
import big200 from "./fixtures/big-200p.pdf";
import big201 from "./fixtures/big-201p.pdf";
import { pdfText } from "../../src/ap/pdfText.js";

interface EngineStub { runChain(tenantId: string, opts?: { bigDoc?: boolean }): Promise<unknown>; catches(tenantId: string): Promise<unknown>; bigPdf(): Promise<unknown>; again(tenantId: string): Promise<unknown>; rows(): Promise<unknown> }
interface Env extends Bindings { ENGINE: { idFromName(name: string): { toString(): string }; get(id: unknown): EngineStub } }

const parserOnly = { ask: async (_a: unknown, fallback: () => unknown) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as unknown as Asker;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 1), { status, headers: { "content-type": "application/json" } });
const CHUNK = 1024 * 1024;

/** The stand-in bank's whole state as text, and back: so it can live in the object's SQLite and survive an eviction. */
function bankToText(awx: FakeAirwallex): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(awx as unknown as Record<string, unknown>)) {
    if (typeof v === "function") continue;
    out[k] = v instanceof Map ? { __map: [...v.entries()] } : v;
  }
  return JSON.stringify(out);
}
function bankFromText(text: string): FakeAirwallex {
  const awx = new FakeAirwallex();
  for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, unknown>)) {
    (awx as unknown as Record<string, unknown>)[k] = v && typeof v === "object" && "__map" in (v as object) ? new Map((v as { __map: [unknown, unknown][] }).__map) : v;
  }
  return awx;
}

let fontsReady = false;

/** One company's engine: the real one, on this object's own SQLite. Named by the company's tenant id. */
export class Engine extends DurableObject<Env> {
  private db: DB | null = null;
  private shim: DoDatabase | null = null;
  private awx: FakeAirwallex | null = null;

  private get storage() { return (this.ctx as { storage: DoStorage & { sql: { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[]; one(): Record<string, unknown> }; databaseSize: number } } }).storage; }

  private open(): { db: DB; awx: FakeAirwallex; fresh: boolean } {
    if (this.db && this.awx) return { db: this.db, awx: this.awx, fresh: false };
    const storage = this.storage;
    const shim = (this.shim = new DoDatabase(storage, "company"));
    const db = shim as unknown as DB;
    prepareDb(db, SCHEMA, LEDGER);
    // Documents: this object's own SQLite, in 1 MB pieces (a row has a size limit; an invoice may be 15 MB).
    storage.sql.exec("CREATE TABLE IF NOT EXISTS do_doc_chunks (sha256 TEXT NOT NULL, n INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (sha256, n)) WITHOUT ROWID");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS do_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    useDocStore(db, {
      put: (sha, bytes) => {
        const have = storage.sql.exec("SELECT COUNT(*) AS n FROM do_doc_chunks WHERE sha256 = ?", sha).one().n as number;
        if (!have) for (let i = 0, n = 0; i < bytes.byteLength; i += CHUNK, n++) storage.sql.exec("INSERT INTO do_doc_chunks (sha256, n, bytes) VALUES (?, ?, ?)", sha, n, bytes.buffer.slice(bytes.byteOffset + i, bytes.byteOffset + Math.min(i + CHUNK, bytes.byteLength)));
        return `do:${sha}`;
      },
      get: (path) => Buffer.concat(storage.sql.exec("SELECT bytes FROM do_doc_chunks WHERE sha256 = ? ORDER BY n", path.slice(3)).toArray().map((r) => Buffer.from(r.bytes as ArrayBuffer))),
    });
    // The engine's real PDF text reader, on this thread (a Durable Object has no worker threads).
    usePdfReader(readPdfInline);
    if (!fontsReady) { (pdfkit as unknown as { registerStdFonts(...f: unknown[]): void }).registerStdFonts(Helvetica, HelveticaBold, HelveticaOblique); fontsReady = true; }
    // The stand-in bank: restored from this object's SQLite when it has been here before.
    const kept = storage.sql.exec("SELECT value FROM do_state WHERE key = 'bank'").toArray()[0]?.value as string | undefined;
    this.awx = kept ? bankFromText(kept) : new FakeAirwallex();
    this.db = db;
    return { db, awx: this.awx, fresh: !kept };
  }
  private keepBank(): void { this.storage.sql.exec("INSERT INTO do_state (key, value) VALUES ('bank', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", bankToText(this.awx!)); }

  /** Where the cloud's copy stands (what GET /v1/sync/state answers), then everything new through applySync. */
  private async feed(db: DB, tenantId: string, now: Date) {
    const calls = { d1: 0, d1_statements: 0, r2: 0 };
    const inner = d1Sql(this.env.DB);
    const sql: Sql = {
      all: (q, p) => { calls.d1++; calls.d1_statements++; return inner.all(q, p); }, first: (q, p) => { calls.d1++; calls.d1_statements++; return inner.first(q, p); },
      run: (q, p) => { calls.d1++; calls.d1_statements++; return inner.run(q, p); }, batch: (st) => { calls.d1++; calls.d1_statements += st.length; return inner.batch(st); }, exec: (x) => inner.exec(x),
    };
    const bucket = r2Blobs(this.env.DOCS);
    const blobs: Blobs = { ...bucket, put: (k, b, m) => { calls.r2++; return bucket.put(k, b, m); }, has: (k) => { calls.r2++; return bucket.has!(k); } };
    const t = new TenantDb(sql, tenantId);
    const t0 = performance.now();
    const a = (await t.select<{ seq: number; row_hash: string }>("audit_rows", {}, { order: ["seq"], desc: true, limit: 1 }))[0];
    const l = (await t.select<{ entry_id: number; entry_hash: string }>("ledger_entries", {}, { order: ["entry_id"], desc: true, limit: 1 }))[0];
    const docs = await t.select<{ sha256: string }>("documents", {}, { order: ["sha256"] });
    const state: CloudState = { audit: { seq: a?.seq ?? 0, hash: a?.row_hash ?? null }, ledger: { entry_id: l?.entry_id ?? 0, hash: l?.entry_hash ?? null }, documents: docs.map((d) => d.sha256) };
    const batches = batchesFor(db, state, { now });
    const applied = [];
    for (const b of batches) applied.push(await applySync(t, blobs, SyncBatch.parse(b), now));
    return { batches: batches.length, batch_bytes: JSON.stringify(batches).length, applied, ms: Math.round(performance.now() - t0), calls };
  }

  /** The vault's sink over R2: files written once under the company's own prefix; a year's index.json may be rewritten. */
  private vaultSink(tenantId: string, written: string[]): VaultSink {
    const blobs = r2Blobs(this.env.DOCS);
    const key = (path: string) => `t/${tenantId}/vault/${path}`;
    return {
      name: "r2",
      stat: async (path) => { const b = await blobs.get(key(path)); return b ? { sha256: sha256Of(Buffer.from(b)), bytes: b.length } : null; },
      create: async (path, bytes, hash, mime) => { if (await blobs.has!(key(path))) throw new Error(`${path} is already in the vault`); await blobs.put(key(path), bytes, { sha256: hash, mime: mime ?? "application/pdf" }); written.push(path); },
      readIndex: async (path) => { const b = await blobs.get(key(path)); return b ? new TextDecoder().decode(b) : null; },
      writeIndex: async (path, text) => { await blobs.put(key(path), new TextEncoder().encode(text), { mime: "application/json" }); },
      read: async (path) => { const b = await blobs.get(key(path)); return b ? Buffer.from(b) : null; },
    };
  }

  async runChain(tenantId: string, opts: { bigDoc?: boolean } = {}): Promise<unknown> {
    const out: Record<string, unknown> = {};
    const timed = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      const t = performance.now(), s0 = { ...this.shim?.stats };
      const v = await fn();
      const s = this.shim!.stats;
      out[name] = { ms: Math.round((performance.now() - t) * 10) / 10, statements: s.statements - (s0.statements ?? 0), shim_added: s.added - (s0.added ?? 0), rows_read: s.rowsRead - (s0.rowsRead ?? 0), rows_written: s.rowsWritten - (s0.rowsWritten ?? 0), value: v };
      return v;
    };
    const now = () => new Date();
    const rp = this.env.RP_ID, origin = this.env.ORIGIN;
    const { db, awx } = await timed("open", () => { const o = this.open(); return o; }).then((o) => { (out.open as { value: unknown }).value = { fresh: o.fresh, tables: (o.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n }; return o; });

    await timed("seed", async () => { const t = await seedTreasury(db, awx, awx); return { usd: t.usdAvailableCents, eur: t.eurAvailableCents }; });
    // The CFO's passkey: a software one made here (the product: the browser's WebAuthn), enrolled by the engine's own code.
    const phone = new FakeAuthenticator();
    await timed("enrol", async () => {
      const { window, code } = openEnrolment(db, { rpId: rp, origin }, now());
      const item: InboxItem = { ticket: "lead-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: phone.register({ challenge: window.challenge, origin, rpId: rp }) }), received_at: now().toISOString() };
      const r = await processRegistration(db, item, { label: "software passkey (not Face ID)" }, now());
      if (r.status !== "pending") throw new Error(`not enrolled: ${JSON.stringify(r)}`);
      return { status: r.status, confirmed: confirmPasskey(db, fingerprintOf(phone.spkiSha256), now()) };
    });
    // The invoice, read by the engine's REAL PDF text reader inside this object.
    const bytes = Buffer.from(invoicePdf);
    const inv = await timed("ingest_real_pdf_reader", async () => {
      const r = await ingestDocument(db, { dir: "/do", reader: parserOnly, now }, { bytes, filename: "bergtex-BTX-2026-21.pdf", source: "upload" });
      if (r.kind !== "invoice") throw new Error(r.kind);
      const i = r.invoice;
      return { id: i.id, status: i.status, vendor: i.vendor, invoice_no: i.invoice_no, total: i.total, currency: i.currency, read_by: i.read_by, findings: i.findings.map((f) => `${f.level}:${f.code}`), text_chars: (db.prepare("SELECT text_chars FROM ap_documents WHERE sha256 = ?").get(i.doc_sha256) as { text_chars: number }).text_chars };
    });
    const p = await timed("propose", async () => {
      const r = await payApInvoice(db, awx, inv.id, now());
      if (r.kind !== "proposed") throw new Error(r.reason);
      const row = db.prepare("SELECT proposal_id, kind, status, terms_sha256 FROM proposals WHERE proposal_id = ?").get(r.proposal.proposal_id) as { proposal_id: string; kind: string; status: string; terms_sha256: string };
      return { ...row, invoice_status: apInvoice(db, inv.id)?.status };
    });
    const assertion = (challenge: string, counter: number): InboxItem => ({ ticket: `lead-${p.proposal_id}-${counter}`, kind: "assertion", proposal_id: p.proposal_id, body: JSON.stringify({ proposal_id: p.proposal_id, terms_sha256: p.terms_sha256, credential: phone.sign({ challenge, origin, rpId: rp, counter }) }), received_at: now().toISOString() });
    await timed("approve_signature_over_other_terms", async () => { const r = await processAssertion(db, assertion(challengeFor(sha256Hex("other terms")), 1), now()); return { status: r.status, message: r.message }; });
    await timed("approve_signature_over_these_terms", async () => { const r = await processAssertion(db, assertion(challengeFor(p.terms_sha256), 2), now()); return { status: r.status, message: r.message }; });
    await timed("execute", async () => {
      await execute(db, p.proposal_id, undefined, undefined, { rail: awx, sim: awx });
      return { proposal: (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.proposal_id) as { status: string }).status, transfers: db.prepare("SELECT status, amount, currency, fee_actual FROM transfers").all() };
    });
    this.keepBank();
    await timed("syncPayments", async () => (await syncPayments(db, { now })).map((i) => ({ id: i.id, status: i.status })));
    await timed("syncLedger", () => ({ result: syncLedger(db, now()), entries: (db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }).n }));
    await timed("feed_read_model_with_applySync", () => this.feed(db, tenantId, now()));
    // The archive: the vault's own builder (original PDF, payment receipt, suppliers list), into R2.
    const written: string[] = [];
    await timed("vault_into_r2", async () => { const r = await syncVault(db, this.vaultSink(tenantId, written), { company: "Lead Probe (test)", lang: "en", now: now() }); return { added: r.added.map((a) => `${a.kind}: ${a.path}`), unchanged: r.unchanged, r2_objects: written.length }; });
    await timed("vault_again_adds_nothing", async () => { const r = await syncVault(db, this.vaultSink(tenantId, written), { company: "Lead Probe (test)", lang: "en", now: now() }); return { added: r.added.length, unchanged: r.unchanged }; });
    await timed("feed_again_only_what_is_new", () => this.feed(db, tenantId, now()));
    if (opts.bigDoc) {
      // A row's size limit, and a document in pieces: 5 MB in one row, then through the document store.
      await timed("one_row_of_5MB", () => { try { this.storage.sql.exec("CREATE TABLE IF NOT EXISTS do_big (b BLOB)"); this.storage.sql.exec("INSERT INTO do_big (b) VALUES (?)", new Uint8Array(5 * CHUNK).buffer); return "accepted"; } catch (e) { return `refused: ${(e as Error).message.slice(0, 160)}`; } });
      await timed("document_of_15MB_in_pieces", () => {
        const big = new Uint8Array(15 * CHUNK); for (let i = 0; i < big.length; i += 4096) big[i] = i & 255;
        const sha = sha256Of(Buffer.from(big));
        const store = { put: (s: string, b: Uint8Array) => { for (let i = 0, n = 0; i < b.byteLength; i += CHUNK, n++) this.storage.sql.exec("INSERT INTO do_doc_chunks (sha256, n, bytes) VALUES (?, ?, ?)", s, n, b.buffer.slice(i, Math.min(i + CHUNK, b.byteLength))); } };
        store.put(sha, big);
        const back = Buffer.concat(this.storage.sql.exec("SELECT bytes FROM do_doc_chunks WHERE sha256 = ? ORDER BY n", sha).toArray().map((r) => Buffer.from(r.bytes as ArrayBuffer)));
        return { pieces: this.storage.sql.exec("SELECT COUNT(*) AS n FROM do_doc_chunks WHERE sha256 = ?", sha).one().n, same_bytes_back: sha256Of(back) === sha };
      });
    }
    out.chains = { audit: verifyAuditChain(db), ledger: verifyLedger(db) };
    out.sqlite_bytes = this.storage.sql.databaseSize;
    out.shim_totals = { ...this.shim!.stats, perStatement: undefined };
    return out;
  }

  /** The catches, by the engine's own checks in this object: the same file again, a renumbered copy, changed bank details. */
  async catches(tenantId: string): Promise<unknown> {
    const { db, awx } = this.open();
    const now = () => new Date();
    const file = async (bytes: ArrayBuffer, filename: string) => {
      const r = await ingestDocument(db, { dir: "/do", reader: parserOnly, now }, { bytes: Buffer.from(bytes), filename, source: "upload" });
      if (r.kind !== "invoice") return { kind: r.kind };
      const i = r.invoice;
      return { kind: r.kind, id: i.id, status: i.status, invoice_no: i.invoice_no, findings: i.findings.map((f) => `${f.level}:${f.code}`) };
    };
    const out: Record<string, unknown> = {};
    out.same_file_again = await file(invoicePdf, "bergtex-BTX-2026-21 (copy).pdf");
    out.renumbered_copy_same_total = await file(renumberedPdf, "bergtex-BTX-2026-17.pdf");
    const changed = (out.changed_bank_details = await file(bankChangePdf, "bergtex-BTX-2027-01.pdf")) as { id?: string };
    // Paying the stopped one: the engine refuses before any proposal exists.
    if (changed.id) out.pay_the_stopped_invoice = await payApInvoice(db, awx, changed.id, now()).then((r) => (r.kind === "proposed" ? { kind: r.kind } : { kind: r.kind, reason: r.reason.slice(0, 200) }), (e: Error) => ({ threw: e.message.slice(0, 200) }));
    out.proposals = (db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n;
    this.keepBank();
    syncLedger(db, now());
    out.feed = await this.feed(db, tenantId, now());
    out.chains = { audit: verifyAuditChain(db), ledger: verifyLedger(db) };
    return out;
  }

  /** The reader's largest job: 200 pages (the engine's limit) on this thread, and one page more, which it refuses. */
  async bigPdf(): Promise<unknown> {
    this.open();
    const read = async (bytes: ArrayBuffer) => {
      const t = performance.now();
      try { const r = await pdfText(new Uint8Array(bytes)); return { bytes: bytes.byteLength, pages: r.pages, text_chars: r.text.length, ms: Math.round(performance.now() - t) }; }
      catch (e) { return { bytes: bytes.byteLength, refused: (e as Error).message.slice(0, 160), ms: Math.round(performance.now() - t) }; }
    };
    return { pages_200: await read(big200), pages_200_again: await read(big200), pages_201: await read(big201) };
  }

  /** As after an eviction: the handle and the bank are dropped and rebuilt from this object's SQLite; then the engine goes on. */
  async again(tenantId: string): Promise<unknown> {
    this.db = null; this.shim = null; this.awx = null;
    const t = performance.now();
    const { db, awx, fresh } = this.open();
    const reopened_ms = Math.round((performance.now() - t) * 10) / 10;
    const now = new Date();
    const changed = await syncPayments(db, { now: () => now });
    const balances = await awx.balances();
    const led = syncLedger(db, now);
    const feed = await this.feed(db, tenantId, now);
    return { bank_restored_from_sqlite: !fresh, reopened_ms, transfers_the_bank_still_knows: awx.transfers.length, bank_eur_available_cents: balances.EUR?.availableCents, syncPayments_changed: changed.length, syncLedger: led, feed, invoice: apInvoice(db, "AP-0001")?.status, chains: { audit: verifyAuditChain(db), ledger: verifyLedger(db) } };
  }

  async rows(): Promise<unknown> {
    const names = this.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'").toArray().map((r) => r.name as string);
    const out: Record<string, number> = {};
    for (const n of names) { const c = this.storage.sql.exec(`SELECT COUNT(*) AS n FROM "${n}"`).one().n as number; if (c) out[n] = c; }
    return out;
  }
}

const stubFor = (env: Env, tenantId: string) => env.ENGINE.get(env.ENGINE.idFromName(tenantId));
let sqlOfIsolate: Sql | null = null;

async function engineRoute(req: Request, env: Env): Promise<Response> {
  const sql = (sqlOfIsolate ??= d1Sql(env.DB));
  await ensureSchema(sql);
  let caller;
  try { caller = await callerOf(sql, env.SESSION_SECRET, req.headers.get("authorization"), new Date()); }
  catch (e) { return json({ error: (e as Error).message }, e instanceof AuthError ? 401 : 500); }
  const url = new URL(req.url);
  try {
    if (url.pathname === "/v1/engine/run" && req.method === "POST") { need(caller, "admin"); return json(await stubFor(env, caller.tenantId).runChain(caller.tenantId, { bigDoc: url.searchParams.get("big") === "1" })); }
    if (url.pathname === "/v1/engine/catches" && req.method === "POST") { need(caller, "admin"); return json(await stubFor(env, caller.tenantId).catches(caller.tenantId)); }
    if (url.pathname === "/v1/engine/bigpdf" && req.method === "POST") { need(caller, "admin"); return json(await stubFor(env, caller.tenantId).bigPdf()); }
    if (url.pathname === "/v1/engine/again" && req.method === "POST") { need(caller, "admin"); return json(await stubFor(env, caller.tenantId).again(caller.tenantId)); }
    if (url.pathname === "/v1/engine/rows") { need(caller, "read"); return json(await stubFor(env, caller.tenantId).rows()); }
  } catch (e) { return json({ error: (e as Error).message, stack: String((e as Error).stack).split("\n").slice(0, 10) }, e instanceof AuthError ? 403 : 500); }
  return json({ error: "no such engine route" }, 404);
}

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/") return scenario(env);
    if (path.startsWith("/v1/engine/")) return engineRoute(req, env);
    return cloud.fetch(req, env);
  },
  scheduled: cloud.scheduled,
};
export default worker;

/** The check: a company made by the cloud's own admin route, its engine run, and the console's own API read back. */
async function scenario(env: Env): Promise<Response> {
  const out: Record<string, unknown> = {};
  const origin = env.ORIGIN;
  const call = (path: string, init: RequestInit & { token?: string } = {}) => worker.fetch(new Request(`${origin}${path}`, { ...init, headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), origin, ...(init.body ? { "content-type": "application/json" } : {}) } }), env);
  const company = async (slug: string) => {
    const res = await call("/v1/admin/tenants", { method: "POST", token: "spike-admin-token", body: JSON.stringify({ slug, name: `${slug} (test)`, owner: { display_name: "Test Owner" } }) });
    const b = (await res.json()) as { tenant: { id: string }; owner: { id: string } };
    if (res.status !== 201) throw new Error(`tenant ${slug}: ${res.status} ${JSON.stringify(b)}`);
    return { tenantId: b.tenant.id, session: await sessionToken(env.SESSION_SECRET, { tenantId: b.tenant.id, userId: b.owner.id, role: "owner", gen: 0 }, new Date()) };
  };
  try {
    const suffix = crypto.randomUUID().slice(0, 6);
    const a = await company(`alpha-${suffix}`), b = await company(`beta-${suffix}`);
    const t0 = performance.now();
    const run = await call("/v1/engine/run?big=1", { method: "POST", token: a.session });
    out.engine_run = { status: run.status, ms: Math.round(performance.now() - t0), ...((await run.json()) as object) };
    const get = async (p: string, token = a.session) => { const r = await call(p, { token }); return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> & { items?: Record<string, unknown>[] } }; };
    const inv = await get("/v1/invoices");
    const first = inv.body.items?.[0] as { id: string; status: string; doc_sha256: string } | undefined;
    const doc = first ? await call(`/v1/invoices/${first.id}/document`, { token: a.session }) : null;
    const docBytes = doc ? new Uint8Array(await doc.arrayBuffer()) : new Uint8Array();
    const [one, entries, trial, tx, vendors, payments, me] = [first ? await get(`/v1/invoices/${first.id}`) : null, await get("/v1/ledger/entries"), await get("/v1/reports/trial"), await get("/v1/transactions"), await get("/v1/vendors"), await get("/v1/payments"), await get("/v1/me")];
    out.console_api_after_the_engine_fed_it = {
      invoices: inv.body.items?.map((i) => `${String(i.id)} ${String(i.status)} ${String(i.vendor)} ${String(i.currency)} ${String(i.total)}`),
      invoice_detail_status: one?.status, document: { status: doc?.status, bytes: docBytes.length, sha_matches_invoice: first ? sha256Of(Buffer.from(docBytes)) === first.doc_sha256 : false, same_bytes_as_uploaded: sha256Of(Buffer.from(docBytes)) === sha256Of(Buffer.from(invoicePdf)) },
      ledger_entries: entries.body.items?.length, trial_status: trial.status, trial_keys: Object.keys(trial.body).slice(0, 8), transactions: tx.body.items?.map((t) => `${String(t.rail)} ${String(t.direction)} ${String(t.currency)} ${String((t.body as { amount?: string } | undefined)?.amount ?? "")} ${String(t.reconciliation)}`),
      vendors: vendors.body.items?.length, payments: payments.body.items?.map((x) => String(x.status)), me_status: me.status,
    };
    out.other_company_sees = { invoices: (await get("/v1/invoices", b.session)).body.items?.length, engine_rows: (await get("/v1/engine/rows", b.session)).body };
    const vault = await r2Blobs(env.DOCS).list(`t/${a.tenantId}/vault/`);
    out.vault_objects_in_r2 = vault.map((k) => k.slice(`t/${a.tenantId}/vault/`.length));
    const caught = await call("/v1/engine/catches", { method: "POST", token: a.session });
    out.catches_by_the_engines_own_checks = { status: caught.status, ...((await caught.json()) as object) };
    out.console_invoices_with_the_catches = (await get("/v1/invoices")).body.items?.map((i) => `${String(i.id)} ${String(i.status)} ${String(i.invoice_no)}`);
    const tb = performance.now();
    const big = await call("/v1/engine/bigpdf", { method: "POST", token: a.session });
    out.reader_on_200_pages = { status: big.status, request_ms: Math.round(performance.now() - tb), ...((await big.json()) as object) };
    const again = await call("/v1/engine/again", { method: "POST", token: a.session });
    out.after_dropping_the_objects_memory = { status: again.status, ...((await again.json()) as object) };
    out.console_invoices_afterwards = (await get("/v1/invoices")).body.items?.map((i) => `${String(i.id)} ${String(i.status)}`);
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message, stack: String((e as Error).stack).split("\n").slice(0, 10), ...out }, 500);
  }
}
