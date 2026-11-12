// The engine's feed of the cloud's read model (src/engine/feed.ts): after an engine action the read model holds what
// the ledger holds, through the code a runner's push uses (batchesFor, then the cloud's own applySync), and a feed
// costs the cloud's database only for what changed. Here: an EngineHost on better-sqlite3 in memory (the stand-in
// bank on test money, the parser as reader, a software passkey) and the test cloud. Nothing reaches the network.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cloudTarget } from "../cloud/src/engine/target.js";
import type { Sql } from "../cloud/src/store.js";
import { syncState } from "../cloud/src/sync.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { openDb, type DB } from "../src/db/open.js";
import { feedCloud, type FeedTarget } from "../src/engine/feed.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { transactionRegister } from "../src/money/register.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

// The engine runs on the real clock, as in test/engine-host.test.ts (the executor takes no clock from its host); the
// test cloud has its own (test/support/cloud.ts). A feed is stamped with the time it is given.
const NOW = new Date();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const count = (db: DB, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
/** A later invoice of the same supplier: another number, another amount, later dates. */
const EN_NEXT = EN.replace(/BTX-2026-21/g, "BTX-2026-34").replace("2 November 2026", "6 November 2026").replace("16 November 2026", "20 November 2026")
  .replace("1,554.62", "1,000.00").replace("295.38", "190.00").replace("1,850.00", "1,190.00");
const NOTHING = { documents: 0, vendors: 0, invoices: 0, payments: 0, transactions: 0, ledger_entries: 0, audit_rows: 0 };

/** The ledger's documents in memory: no file is written anywhere. */
function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return {
    put: (sha, bytes) => { if (!kept.has(`mem:${sha}`)) kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; },
    get: (path) => { const b = kept.get(path); if (!b) throw new Error(`no document at ${path}`); return b; },
  };
}

/** The cloud's Sql with every call counted (a batch is one call, as it is one round trip to D1). */
function counted(inner: Sql): { sql: Sql; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    sql: {
      all: (q, p) => { n += 1; return inner.all(q, p); },
      first: (q, p) => { n += 1; return inner.first(q, p); },
      run: (q, p) => { n += 1; return inner.run(q, p); },
      batch: (s) => { n += 1; return inner.batch(s); },
      exec: (x) => { n += 1; return inner.exec(x); },
    },
  };
}

let c: TestCloud;
let tenant: TestTenant;
let sql: ReturnType<typeof counted>;
let tdb: TenantDb;
let target: FeedTarget;

beforeEach(async () => {
  c = testCloud();
  tenant = await c.tenant("northwind");
  sql = counted(c.env.sql);
  tdb = new TenantDb(sql.sql, tenant.id);
  target = cloudTarget(tdb, c.env.blobs, () => c.clock.now);
});
afterEach(() => c.close());

/** A company's ledger and a host over it; `feed: true` wires the feed into the host, as the cloud's engine does. */
function world(opts: { feed?: boolean } = {}) {
  const db = openDb(":memory:");
  useDocStore(db, memoryDocs());
  const store = { text: null as string | null, load() { return this.text; }, save(text: string) { this.text = text; } };
  const bank = standInBank(store);
  const phone = new FakeAuthenticator();
  const host = new EngineHost({
    db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: () => store.save(bankToText(bank)), rp: { rpId: RP, origin: ORIGIN },
    company: { name: "Engine Feed Co", lang: "en" }, vault: null, feed: opts.feed ? (d, now) => feedCloud(d, target, now) : null,
  });
  return { db, bank, host, phone };
}
type World = ReturnType<typeof world>;

/** The passkey set up (once per world). */
async function passkey(w: World): Promise<void> {
  const start = await w.host.passkeyStart();
  const done = await w.host.passkeyFinish({ code: start.code, credential: w.phone.register({ challenge: start.challenge, origin: ORIGIN, rpId: RP }), label: "Test Owner" });
  if (!done.ok) throw new Error(done.reason);
}

/** The chain of engine-host: seeded, pdfOf(EN) uploaded, proposed, signed by the passkey, paid on the stand-in bank. */
async function paidChain(w: World): Promise<{ bytes: Buffer }> {
  await w.host.seed();
  const bytes = await pdfOf(EN);
  const up = await w.host.upload({ bytes, filename: "bergtex-BTX-2026-21.pdf" });
  await passkey(w);
  const out = await w.host.propose(up.invoice!.id);
  if (!out.ok) throw new Error(out.reason);
  const paid = await w.host.approve({ proposal_id: out.proposal.id, terms_sha256: out.proposal.terms_sha256, credential: w.phone.sign({ challenge: out.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) });
  if (paid.settled?.invoice_status !== "paid" || paid.settled.error) throw new Error(JSON.stringify(paid));
  return { bytes };
}

const invoices = async () => (await c.req("GET", "/v1/invoices", { key: tenant.key })).json.items as { id: string; status: string }[];

describe("after the chain and a feed, the read model holds what the ledger holds", () => {
  it("shows the invoice paid, the document's own bytes and the ledger's entries; a second feed sends nothing", async () => {
    const w = world();
    const { bytes } = await paidChain(w);
    expect(await invoices()).toEqual([]);

    const first = await feedCloud(w.db, target, NOW);
    expect(first.sent).toEqual({
      documents: 1, vendors: count(w.db, "beneficiaries"), invoices: 1, payments: 1, transactions: transactionRegister(w.db).rows.length, ledger_entries: 7, audit_rows: count(w.db, "audit_log"),
    });
    expect(first.sent.vendors).toBeGreaterThan(0);
    expect(first.sent.transactions).toBeGreaterThan(0);
    // The document goes first, in a request of its own; the rows follow in one.
    expect(first.batches).toBe(2);
    expect(first.applied).toHaveLength(2);
    expect(first.applied[1]).toMatchObject({ invoices: { added: 1, changed: 0, unchanged: 0 }, ledger_entries: { added: 7 }, audit_rows: { added: count(w.db, "audit_log") } });

    // The console's own API, with the company's key.
    expect(await invoices()).toEqual([expect.objectContaining({ id: "AP-0001", status: "paid", vendor: "Bergtex Textil GmbH", total: "1850.00" })]);
    const doc = await c.req("GET", "/v1/invoices/AP-0001/document", { key: tenant.key });
    expect(doc.status).toBe(200);
    expect(Buffer.from(await doc.res.arrayBuffer()).equals(bytes)).toBe(true);
    const entries = (await c.req("GET", "/v1/ledger/entries", { key: tenant.key })).json.items as unknown[];
    expect(entries).toHaveLength(7);
    expect(((await c.req("GET", "/v1/payments", { key: tenant.key })).json.items as { status: string }[]).map((p) => p.status)).toEqual(["PAID"]);

    // Where the cloud's copy stands is what a runner is told (GET /v1/sync/state): the heads of both chains, the documents.
    const state = await syncState(tdb);
    expect(state).toEqual((await c.req("GET", "/v1/sync/state", { key: tenant.key })).json);
    expect(state).toEqual({
      audit: { seq: count(w.db, "audit_log"), hash: (w.db.prepare("SELECT row_hash AS h FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { h: string }).h },
      ledger: { entry_id: 7, hash: (w.db.prepare("SELECT entry_hash AS h FROM ledger_entries ORDER BY entry_id DESC LIMIT 1").get() as { h: string }).h },
      documents: [sha256(bytes)],
    });

    // Again, later: nothing changed, so nothing is sent, and the cloud's database is asked only where it stands.
    const before = sql.calls();
    const rows = count(w.db, "audit_log");
    const second = await feedCloud(w.db, target, later(5));
    expect(second).toEqual({ batches: 0, sent: NOTHING, applied: [] });
    expect(sql.calls() - before).toBeLessThanOrEqual(3);
    expect(count(w.db, "audit_log")).toBe(rows);
  });

  it("a second invoice sends only that invoice, its document and the new chain rows", async () => {
    const w = world();
    await paidChain(w);
    await feedCloud(w.db, target, NOW);
    const audit = count(w.db, "audit_log");

    const next = await pdfOf(EN_NEXT);
    const up = await w.host.upload({ bytes: next, filename: "bergtex-BTX-2026-34.pdf" });
    expect(up.invoice).toMatchObject({ id: "AP-0002", status: "ready", invoice_no: "BTX-2026-34", total: "1190.00", findings: [] });
    const fed = await feedCloud(w.db, target, later(5));
    // The feed books first, as a runner's push does: the new invoice's accrual is one of the new ledger entries.
    const entries = count(w.db, "ledger_entries");
    expect(entries).toBeGreaterThan(7);
    expect(fed.sent).toEqual({ ...NOTHING, documents: 1, invoices: 1, ledger_entries: entries - 7, audit_rows: count(w.db, "audit_log") - audit });
    expect(fed.sent.audit_rows).toBeGreaterThan(0);
    expect(fed.batches).toBe(2);
    expect(fed.applied[0]).toMatchObject({ documents: { added: 1, unchanged: 0 } });
    expect(fed.applied[1]).toMatchObject({ invoices: { added: 1, changed: 0, unchanged: 0 }, vendors: { added: 0, changed: 0, unchanged: 0 }, payments: { added: 0, changed: 0, unchanged: 0 }, transactions: { added: 0, changed: 0, unchanged: 0 } });

    expect((await invoices()).map((i) => `${i.id} ${i.status}`).sort()).toEqual(["AP-0001 paid", "AP-0002 ready"]);
    const doc = await c.req("GET", "/v1/invoices/AP-0002/document", { key: tenant.key });
    expect(Buffer.from(await doc.res.arrayBuffer()).equals(next)).toBe(true);
    expect(await feedCloud(w.db, target, later(10))).toEqual({ batches: 0, sent: NOTHING, applied: [] });
  });
});

describe("a changed row travels as a new version", () => {
  it("the invoice's status, fed by the host after each action: ready, waiting for the CFO, paid; the earlier ones are kept", async () => {
    const w = world({ feed: true });
    await w.host.seed();
    const up = await w.host.upload({ bytes: await pdfOf(EN), filename: "bergtex-BTX-2026-21.pdf" });
    expect(await w.host.sync()).toMatchObject({ fed: true, error: null });
    expect(await invoices()).toEqual([expect.objectContaining({ id: "AP-0001", status: "ready" })]);

    await passkey(w);
    const out = await w.host.propose(up.invoice!.id);
    if (!out.ok) throw new Error(out.reason);
    expect(await w.host.sync()).toMatchObject({ fed: true, error: null });
    expect(await invoices()).toEqual([expect.objectContaining({ id: "AP-0001", status: "waiting_cfo" })]);

    const paid = await w.host.approve({ proposal_id: out.proposal.id, terms_sha256: out.proposal.terms_sha256, credential: w.phone.sign({ challenge: out.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) });
    expect(paid.settled).toMatchObject({ invoice_status: "paid", ledger_entries: 7, fed: true, error: null });
    expect(await invoices()).toEqual([expect.objectContaining({ id: "AP-0001", status: "paid" })]);

    expect(await tdb.one<{ version: number }>("invoices", { id: "AP-0001" })).toMatchObject({ version: 3, status: "paid" });
    const history = await tdb.select<{ version: number; body_json: string }>("object_history", { kind: "invoice", id: "AP-0001" }, { order: ["version"] });
    expect(history.map((h) => `${h.version} ${(JSON.parse(h.body_json) as { status: string }).status}`)).toEqual(["1 ready", "2 waiting_cfo"]);
    // The ledger in the cloud is the engine's, entry for entry, and the host's next sync has nothing to send.
    expect(await tdb.count("ledger_entries")).toBe(7);
    const before = sql.calls();
    expect(await w.host.sync()).toMatchObject({ fed: true, error: null });
    expect(sql.calls() - before).toBeLessThanOrEqual(3);
  });
});

describe("what was sent is remembered only once the cloud took it", () => {
  it("a feed the cloud refused is sent again in full; one it took is not", async () => {
    const w = world();
    await paidChain(w);
    let refuse = true;
    const flaky: FeedTarget = { state: () => target.state(), apply: async (b) => { if (refuse && !("documents" in b)) throw new Error("the read model is away"); return target.apply(b); } };
    await expect(feedCloud(w.db, flaky, NOW)).rejects.toThrow("the read model is away");
    // The document arrived (its request came first); no row did.
    expect(await invoices()).toEqual([]);
    expect(await tdb.count("documents")).toBe(1);

    refuse = false;
    const again = await feedCloud(w.db, flaky, later(1));
    expect(again.sent).toMatchObject({ documents: 0, invoices: 1, payments: 1, ledger_entries: 7, vendors: count(w.db, "beneficiaries") });
    expect(again.batches).toBe(1);
    expect(await invoices()).toEqual([expect.objectContaining({ id: "AP-0001", status: "paid" })]);
    expect(await feedCloud(w.db, flaky, later(2))).toEqual({ batches: 0, sent: NOTHING, applied: [] });
  });

  it("all: true sends every row again, and the cloud counts each as unchanged", async () => {
    const w = world();
    await paidChain(w);
    const first = await feedCloud(w.db, target, NOW);
    const all = await feedCloud(w.db, target, NOW, { all: true });
    // The chains and the documents are never sent twice: the cloud says where it stands, and only what continues it travels.
    expect(all.sent).toEqual({ ...first.sent, documents: 0, ledger_entries: 0, audit_rows: 0 });
    expect(all.batches).toBe(1);
    expect(all.applied[0]).toMatchObject({ invoices: { added: 0, changed: 0, unchanged: 1 }, payments: { added: 0, changed: 0, unchanged: 1 }, vendors: { added: 0, changed: 0, unchanged: first.sent.vendors }, transactions: { added: 0, changed: 0, unchanged: first.sent.transactions } });
    expect(await tdb.count("object_history")).toBe(0);
  });

  it("keeps its own small table in the company's ledger, and only there: a hash per row, never the row", async () => {
    const w = world();
    expect(w.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'cloud_feed_sent'").get()).toBeUndefined();
    await paidChain(w);
    await feedCloud(w.db, target, NOW);
    const rows = w.db.prepare("SELECT kind, id, sha256 FROM cloud_feed_sent ORDER BY kind, id").all() as { kind: string; id: string; sha256: string }[];
    expect([...new Set(rows.map((r) => r.kind))]).toEqual(["invoices", "payments", "transactions", "vendors"]);
    expect(rows.filter((r) => r.kind === "invoices").map((r) => r.id)).toEqual(["AP-0001"]);
    for (const r of rows) expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows).toHaveLength(1 + 1 + transactionRegister(w.db).rows.length + count(w.db, "beneficiaries"));
  });
});
