// The runner's push into Purser Cloud: everything a real ledger records arrives, once; the cloud recomputes both hash
// chains with the runner's own formulas; reports in the cloud equal the runner's to the cent; a posted record that
// comes back changed, or a document whose bytes do not match its hash, is refused.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditRowHash, ledgerEntryHash } from "../cloud/src/chains.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { audit } from "../src/audit/log.js";
import { batchesFor, pushToCloud } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { ledgerRows, postEntry, reverseEntry } from "../src/ledger/core.js";
import { balanceSheet, profitAndLoss, trialBalance, vatOverview } from "../src/ledger/reports.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-08T12:00:00Z");

let c: TestCloud;
let db: DB;
let dir: string;
let tenant: { id: string; key: string; owner: string };
const target = () => ({ url: "https://cloud.test", key: tenant.key, fetch: c.fetch });

async function world(): Promise<void> {
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(EN), filename: "bergtex.pdf", source: "upload" });
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(NL), filename: "zeeland.pdf", source: "upload" });
  postEntry(db, { date: "2026-10-03", description: "Sale to a retailer", created_by: "test", lines: [
    { account: "1200", debit: 12_100, currency: "EUR" }, { account: "4000", credit: 10_000, currency: "EUR", vat_code: "S21", vat_cents: 2_100 }, { account: "2210", credit: 2_100, currency: "EUR" }] }, NOW);
  postEntry(db, { date: "2026-10-09", description: "Software", created_by: "test", lines: [
    { account: "6100", debit: 5_000, currency: "EUR", vat_code: "P21", vat_cents: 1_050 }, { account: "1510", debit: 1_050, currency: "EUR" }, { account: "1200", credit: 6_050, currency: "EUR" }] }, NOW);
  const third = postEntry(db, { date: "2026-11-02", description: "Data in USD", created_by: "test", lines: [
    { account: "5000", debit: 300, currency: "USD" }, { account: "1201", credit: 300, currency: "USD" }] }, NOW);
  reverseEntry(db, third.entry_id, "booked twice", "test", NOW);
  audit(db, "human", "test.note", "x", { note: "a row the cloud must keep" }, NOW);
}

beforeEach(async () => {
  c = testCloud();
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-sync-"));
  db = openDb(":memory:");
  tenant = await c.tenant("northwind");
  await world();
});
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });

describe("the hash chains", () => {
  it("are recomputed in the cloud exactly as the runner computes them", async () => {
    const rows = db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as Parameters<typeof auditRowHash>[0][];
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(await auditRowHash(r)).toBe(r.row_hash);
    for (const e of ledgerRows(db)) expect(await ledgerEntryHash(e)).toBe(e.entry_hash);
  });
});

describe("pushing a ledger", () => {
  it("brings everything over once; a second push changes nothing", async () => {
    const first = await pushToCloud(db, target(), NOW);
    expect(first.length).toBeGreaterThanOrEqual(2);
    const count = async (t: string) => (await c.env.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = ?`, [tenant.id]))!.n;
    expect(await count("documents")).toBe(2);
    expect(await count("invoices")).toBe(2);
    expect(await count("vendors")).toBe((db.prepare("SELECT COUNT(*) AS n FROM beneficiaries").get() as { n: number }).n);
    expect(await count("ledger_entries")).toBe(ledgerRows(db).length);
    expect(await count("audit_rows")).toBe((db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n);

    const again = await pushToCloud(db, target(), NOW) as { applied: Record<string, { added: number; changed: number }> }[];
    for (const r of again) for (const k of Object.values(r.applied)) expect(k.added + k.changed).toBe(0);
  });

  it("gives the same reports in the cloud as on the runner, to the cent", async () => {
    await pushToCloud(db, target(), NOW);
    const get = async (p: string) => (await c.req("GET", p, { key: tenant.key })).json;
    expect((await get("/v1/reports/trial?to=2026-12-31")).rows).toEqual(trialBalance(db, "2026-12-31"));
    expect((await get("/v1/reports/pnl?from=2026-01-01&to=2026-12-31")).by_currency).toEqual(profitAndLoss(db, { from: "2026-01-01", to: "2026-12-31" }));
    expect((await get("/v1/reports/balance?to=2026-12-31")).by_currency).toEqual(balanceSheet(db, "2026-12-31"));
    expect(await get("/v1/reports/vat?quarter=2026Q4")).toEqual(vatOverview(db, "2026Q4"));
  });

  it("serves the invoices, their documents and the payables picture", async () => {
    await pushToCloud(db, target(), NOW);
    const list = (await c.req("GET", "/v1/invoices?limit=1", { key: tenant.key })).json as { items: { id: string; vendor: string }[]; next_cursor: string | null };
    expect(list.items).toHaveLength(1);
    expect(list.next_cursor).toBeTruthy();
    const page2 = (await c.req("GET", `/v1/invoices?limit=1&cursor=${list.next_cursor!}`, { key: tenant.key })).json as { items: { id: string }[] };
    expect(page2.items[0]!.id).not.toBe(list.items[0]!.id);
    const doc = await c.req("GET", `/v1/invoices/${list.items[0]!.id}/document`, { key: tenant.key });
    expect(doc.res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await doc.res.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const ready = (await c.req("GET", "/v1/invoices?status=ready", { key: tenant.key })).json as { items: unknown[] };
    expect(ready.items.length).toBeGreaterThan(0);
    const ins = (await c.req("GET", "/v1/insights", { key: tenant.key })).json as { open_cents: Record<string, number> };
    expect(ins.open_cents.EUR).toBeGreaterThan(0);
    const entries = (await c.req("GET", "/v1/ledger/entries?from=2026-11-01", { key: tenant.key })).json as { items: { posting_date: string }[] };
    expect(entries.items.every((e) => e.posting_date >= "2026-11-01")).toBe(true);
  });

  it("keeps an invoice's earlier version when its status changes", async () => {
    await pushToCloud(db, target(), NOW);
    const id = (db.prepare("SELECT id FROM ap_invoices ORDER BY id LIMIT 1").get() as { id: string }).id;
    db.prepare("UPDATE ap_invoices SET status = 'rejected', updated_at = ? WHERE id = ?").run("2026-11-09T09:00:00.000Z", id);
    await pushToCloud(db, target(), NOW);
    const one = (await c.req("GET", `/v1/invoices/${id}`, { key: tenant.key })).json as { status: string; version: number; earlier_versions: unknown[] };
    expect(one).toMatchObject({ status: "rejected", version: 2 });
    expect(one.earlier_versions).toHaveLength(1);
  });
});

describe("what the cloud refuses", () => {
  it("a posted ledger entry that comes back changed, and an audit row that was edited", async () => {
    await pushToCloud(db, target(), NOW);
    const [entry] = ledgerRows(db);
    const changed = { ...entry!, description: "edited after posting" };
    const r1 = await c.req("POST", "/v1/sync", { key: tenant.key, body: { ledger_entries: [{ ...changed, entry_hash: "f".repeat(64) }] } });
    expect(r1.status).toBe(409);
    expect(r1.json.error).toMatch(/changed after it was pushed/);
    const row = db.prepare("SELECT seq, ts, actor, event, subject, payload_json, prev_hash, row_hash FROM audit_log ORDER BY seq LIMIT 1").get() as Record<string, unknown>;
    expect((await c.req("POST", "/v1/sync", { key: tenant.key, body: { audit_rows: [{ ...row, row_hash: "e".repeat(64) }] } })).status).toBe(409);
  });

  it("a ledger entry that does not continue the chain, or whose hash does not match its content", async () => {
    const all = ledgerRows(db);
    // Skipping the first entry breaks the sequence.
    expect((await c.req("POST", "/v1/sync", { key: tenant.key, body: { ledger_entries: [all[1]] } })).status).toBe(409);
    // The right number, the content changed: the recomputed hash differs.
    const r = await c.req("POST", "/v1/sync", { key: tenant.key, body: { ledger_entries: [{ ...all[0]!, description: "not what was hashed" }] } });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/hash does not match/);
  });

  it("a document whose bytes are not what its hash says, and an invoice without its document", async () => {
    const [b] = batchesFor(db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] });
    const doc = (b!.documents as { sha256: string; filename: string; mime: string; base64: string }[])[0]!;
    expect((await c.req("POST", "/v1/sync", { key: tenant.key, body: { documents: [{ ...doc, sha256: "a".repeat(64) }] } })).status).toBe(422);
    const all = batchesFor(db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] });
    const invoices = all.find((x) => "invoices" in x)!.invoices;
    const r = await c.req("POST", "/v1/sync", { key: tenant.key, body: { invoices } });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatch(/does not hold/);
  });

  it("an unbalanced entry, even with a hash that matches it", async () => {
    const { ledgerEntryHash: h } = await import("../cloud/src/chains.js");
    const e = { entry_id: 1, posting_date: "2026-11-01", doc_date: "2026-11-01", description: "x", source_key: null, doc_ref: null, doc_sha256: null, created_by: "t", reverses: null, created_at: NOW.toISOString(), prev_hash: "0".repeat(64), entry_hash: "",
      lines: [{ line_no: 1, account: "1200", debit_cents: 100, credit_cents: 0, currency: "EUR", cost_centre: null, vat_code: null, vat_cents: null, party: null, due_date: null, doc_ref: null, memo: null },
        { line_no: 2, account: "4000", debit_cents: 0, credit_cents: 99, currency: "EUR", cost_centre: null, vat_code: null, vat_cents: null, party: null, due_date: null, doc_ref: null, memo: null }] };
    e.entry_hash = await h(e);
    const r = await c.req("POST", "/v1/sync", { key: tenant.key, body: { ledger_entries: [e] } });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatch(/does not balance/);
  });
});
