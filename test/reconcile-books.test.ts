// Reconciling Purser's books with the outside books (src/accounting/reconcileBooks.ts, npm run reconcile-books): per
// document, net, VAT, gross, paid and state, to the cent; a figure the outside books cannot give is never equal. The
// outside books here are stand-ins (a connector that keeps what it holds, and the T:0 stand-in): no network.
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { books as glBooks } from "../src/accounting/books.js";
import {
  latestReconciliations, purserDocs, readConnector, readT0, reconcileBooks, reconciliationLines, type OutsideDoc, type PurserDoc, type ReadBackDocument, type ReadsBack, type T0Reader,
} from "../src/accounting/reconcileBooks.js";
import { T0Client, t0AccountType, type T0BalanceSheet } from "../src/accounting/t0.js";
import { t0SinkOnce } from "../src/accounting/t0Sink.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { runReconcileBooks } from "../src/cli/reconcileBooks.js";
import { CHART } from "../src/config/gl.js";
import { openDb, type DB } from "../src/db/open.js";
import type { ErpConnector } from "../src/erp/connector.js";
import type { PurchaseInvoice } from "../src/erp/model.js";
import { ledgerItems } from "../src/erp/source.js";
import { ensureErpSchema } from "../src/erp/sync.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { payablesApp } from "../src/servers/payables.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";
import { chartAccounts, FakeT0 } from "./fakes/t0.js";

const doc = (key: string, o: Partial<PurserDoc> = {}): PurserDoc => ({
  key, number: key, supplier: "Bergtex Textil GmbH", currency: "EUR", net_cents: 33613, vat_cents: 6387, gross_cents: 40000, paid_cents: 40000, state: "paid", payments: [{ id: `req-${key}`, cents: 40000 }], ...o,
});
const outside = (d: PurserDoc, o: Partial<OutsideDoc> = {}): OutsideDoc => ({
  key: d.key, external_id: `ext-${d.key}`, currency: d.currency, net_cents: d.net_cents, vat_cents: d.vat_cents, gross_cents: d.gross_cents, paid_cents: d.paid_cents, state: d.state, ...o,
});

describe("reconcileBooks (pure)", () => {
  const ours = [doc("A-1"), doc("A-2", { paid_cents: 0, state: "open", payments: [] }), doc("A-3")];

  it("equal books: zero differences, every document equal, the books agree", () => {
    const r = reconcileBooks("Stand-in", ours, ours.map((d) => outside(d)));
    expect(r.verdict).toBe("agree");
    expect(r.counts).toEqual({ equal: 3, differs: 0, missing_outside: 0, only_outside: 0, not_compared: 0 });
    expect(r.results.flatMap((d) => d.differences)).toEqual([]);
    expect(reconciliationLines(r)[0]).toBe("Purser and Stand-in agree: 3 document(s), compared on net, VAT, gross, paid, state.");
  });

  it.each([["net", "net_cents"], ["vat", "vat_cents"], ["gross", "gross_cents"]] as const)("a one-cent difference in %s is reported exactly", (field, key) => {
    const theirs = ours.map((d) => (d.key === "A-3" ? outside(d, { [key]: d[key] - 1 }) : outside(d)));
    const r = reconcileBooks("Stand-in", ours, theirs);
    expect(r.verdict).toBe("differ");
    expect(r.counts).toMatchObject({ equal: 2, differs: 1 });
    const a3 = r.results.find((d) => d.key === "A-3")!;
    expect(a3.outcome).toBe("differs");
    expect(a3.differences).toEqual([{ field, ours: (ours[2]![key] / 100).toFixed(2), theirs: ((ours[2]![key] - 1) / 100).toFixed(2), diff_cents: 1 }]);
  });

  it("a missing payment: the amount paid and the state differ, and the payment is named", () => {
    const theirs = ours.map((d) => (d.key === "A-1" ? outside(d, { paid_cents: 0, state: "open" }) : outside(d)));
    const r = reconcileBooks("Stand-in", ours, theirs);
    const a1 = r.results.find((d) => d.key === "A-1")!;
    expect(a1.differences).toEqual([{ field: "paid", ours: "400.00", theirs: "0.00", diff_cents: 40000 }, { field: "state", ours: "paid", theirs: "open" }]);
    expect(a1.missing_payments).toEqual([{ id: "req-A-1", cents: 40000 }]);
    expect(reconciliationLines(r)).toContain("  A-1, Bergtex Textil GmbH: payment req-A-1 of EUR 400.00 is not in Stand-in");
  });

  it("of two payments, the one the outside books lack is named", () => {
    const two = [doc("B-1", { payments: [{ id: "req-1", cents: 10000 }, { id: "req-2", cents: 30000 }] })];
    const r = reconcileBooks("Stand-in", two, [outside(two[0]!, { paid_cents: 10000, state: "partly_paid" })]);
    expect(r.results[0]!.missing_payments).toEqual([{ id: "req-2", cents: 30000 }]);
    expect(r.results[0]!.differences).toContainEqual({ field: "paid", ours: "400.00", theirs: "100.00", diff_cents: 30000 });
  });

  it("a missing document and a document only outside are each reported once", () => {
    const theirs = [outside(ours[0]!), outside(ours[2]!), { ...outside(doc("Z-9")), number: "Z-9", supplier: "Someone else" }];
    const r = reconcileBooks("Stand-in", ours, theirs);
    expect(r.counts).toEqual({ equal: 2, differs: 0, missing_outside: 1, only_outside: 1, not_compared: 0 });
    expect(r.results.find((d) => d.key === "A-2")).toMatchObject({ outcome: "missing outside", external_id: null });
    expect(r.results.find((d) => d.key === "Z-9")).toMatchObject({ outcome: "only outside", external_id: "ext-Z-9" });
    expect(r.verdict).toBe("differ");
  });

  it("a figure the outside books could not give is not compared, never equal", () => {
    const theirs = ours.map((d) => outside(d, { net_cents: null, vat_cents: null, note: "could not be read: timeout" }));
    const r = reconcileBooks("Stand-in", ours, theirs);
    expect(r.verdict).toBe("partly compared");
    expect(r.counts.not_compared).toBe(6);
    expect(r.results[0]!.not_compared).toEqual(["net", "vat"]);
  });

  it("only the figures these books hold are compared; a failed check makes them differ, one not made leaves them partly compared", () => {
    const theirs = ours.map((d) => outside(d, { net_cents: 1, state: null }));
    expect(reconcileBooks("T:0", ours, theirs, { compared: ["paid"] }).verdict).toBe("agree");
    expect(reconcileBooks("T:0", ours, theirs, { compared: ["paid"], checks: [{ name: "balance", ok: false, detail: "" }] }).verdict).toBe("differ");
    expect(reconcileBooks("T:0", ours, theirs, { compared: ["paid"], checks: [{ name: "balance", ok: null, detail: "" }] }).verdict).toBe("partly compared");
  });

  it("property: books against themselves agree; one figure off by k cents is exactly one difference of k; never throws", () => {
    const docArb = fc.record({
      key: fc.stringMatching(/^[A-Z]{2}-\d{1,4}$/), net: fc.integer({ min: 0, max: 10_000_000 }), vat: fc.integer({ min: 0, max: 2_000_000 }), paid: fc.integer({ min: 0, max: 12_000_000 }),
    });
    fc.assert(fc.property(fc.uniqueArray(docArb, { selector: (d) => d.key, maxLength: 12 }), fc.integer({ min: 1, max: 1_000_000 }), fc.nat(), fc.constantFrom("net_cents", "vat_cents", "gross_cents", "paid_cents"), (raw, k, pick, key) => {
      const docs = raw.map((x) => doc(x.key, { net_cents: x.net, vat_cents: x.vat, gross_cents: x.net + x.vat, paid_cents: x.paid, payments: x.paid ? [{ id: `r-${x.key}`, cents: x.paid }] : [] }));
      const same = reconcileBooks("S", docs, docs.map((d) => outside(d)));
      expect(same.verdict).toBe("agree");
      expect(same.documents).toBe(docs.length);
      if (!docs.length) return;
      const i = pick % docs.length;
      const theirs = docs.map((d, j) => (j === i ? outside(d, { [key]: d[key] - k }) : outside(d)));
      const r = reconcileBooks("S", docs, theirs);
      const diffs = r.results.flatMap((d) => d.differences).filter((d) => d.field !== "state");
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.diff_cents).toBe(k);
    }), { numRuns: 200 });
  });
});

// ---- Purser's own ledger, with one invoice paid ----

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
let dir: string;
let db: DB;

async function paidInvoice(): Promise<void> {
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(EN), filename: "invoice.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const plan = await payApInvoice(db, awx, out.invoice.id, now);
  if (plan.kind !== "proposed") throw new Error(plan.reason);
  const p = plan.proposal;
  decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  await executeInvoicePayment(db, awx, awx, p.proposal_id);
  await syncPayments(db, { now: () => now });
}

const KEY = "BTX-2026-21 · Bergtex Textil GmbH";

beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "reconcile-books-"));
  db = openDb(":memory:");
  await paidInvoice();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in bookkeeping package: it holds documents by id and reads them back (when told it can). */
function standIn(o: { readBack: boolean; held?: Map<string, ReadBackDocument>; status?: "paid" | "unpaid" | "partial" | "unknown"; fail?: string }): ErpConnector & ReadsBack {
  const held = o.held ?? new Map<string, ReadBackDocument>();
  const c: ErpConnector & ReadsBack = {
    name: "moneybird",
    pullChartOfAccounts: async () => [], pullVendors: async () => [],
    findExisting: async (_k, obj) => (held.has(`ext-${obj.id}`) ? `ext-${obj.id}` : null),
    pushVendor: async () => "x", pushPurchaseInvoice: async () => "x", pushCreditNote: async () => "x", pushPayment: async () => "x", pushJournalEntry: async () => "x",
    pullPaymentStatus: async () => o.status ?? "unknown",
  };
  if (o.readBack) c.readPurchaseInvoice = async (id) => {
    if (o.fail) throw new Error(o.fail);
    const d = held.get(id);
    if (!d) throw new Error(`no document ${id}`);
    return d;
  };
  return c;
}

const asSent = (items = ledgerItems(db)): Map<string, ReadBackDocument> => {
  const inv = items.find((i) => i.kind === "invoice")!.object as PurchaseInvoice;
  return new Map([[`ext-${inv.id}`, { netCents: inv.totals.netCents, grossCents: inv.totals.grossCents, state: "paid", payments: [{ cents: inv.totals.grossCents }] }]]);
};

describe("Purser's side and a bookkeeping package (stand-in)", () => {
  it("Purser's documents are the invoices the ledger feeds the outside books, with their payments", () => {
    expect(purserDocs(ledgerItems(db))).toEqual([{
      key: KEY, number: "BTX-2026-21", supplier: "Bergtex Textil GmbH", currency: "EUR", net_cents: 185000, vat_cents: 0, gross_cents: 185000, paid_cents: 185000, state: "paid",
      payments: [{ id: expect.any(String), cents: 185000 }],
    }]);
  });

  it("read back: equal books agree; one cent less net, a missing payment and a missing document are each reported exactly", async () => {
    const items = ledgerItems(db);
    const ours = purserDocs(items);
    let x = await readConnector(db, standIn({ readBack: true, held: asSent() }), items);
    expect(reconcileBooks("Moneybird", ours, x.docs, x).verdict).toBe("agree");

    const held = asSent();
    const d = held.get(`ext-${KEY}`)!;
    held.set(`ext-${KEY}`, { ...d, netCents: d.netCents! - 1 });
    x = await readConnector(db, standIn({ readBack: true, held }), items);
    let r = reconcileBooks("Moneybird", ours, x.docs, x);
    // One cent less net with the same gross: the VAT is one cent more.
    expect(r.results[0]!.differences).toEqual([{ field: "net", ours: "1850.00", theirs: "1849.99", diff_cents: 1 }, { field: "vat", ours: "0.00", theirs: "0.01", diff_cents: -1 }]);

    held.set(`ext-${KEY}`, { ...d, state: "open", payments: [] });
    x = await readConnector(db, standIn({ readBack: true, held }), items);
    r = reconcileBooks("Moneybird", ours, x.docs, x);
    expect(r.results[0]!.differences).toEqual([{ field: "paid", ours: "1850.00", theirs: "0.00", diff_cents: 185000 }, { field: "state", ours: "paid", theirs: "open" }]);
    expect(r.results[0]!.missing_payments).toEqual(ours[0]!.payments);

    x = await readConnector(db, standIn({ readBack: true, held: new Map() }), items);
    r = reconcileBooks("Moneybird", ours, x.docs, x);
    expect(r.results).toMatchObject([{ key: KEY, outcome: "missing outside" }]);
  });

  it("the id the sync recorded is read, not looked up", async () => {
    ensureErpSchema(db);
    db.prepare("INSERT INTO erp_sync (connector, kind, object_id, external_id, status, updated_at) VALUES ('moneybird', 'invoice', ?, '4711', 'synced', ?)").run(KEY, now.toISOString());
    const d = asSent().get(`ext-${KEY}`)!;
    const x = await readConnector(db, standIn({ readBack: true, held: new Map([["4711", d]]) }), ledgerItems(db));
    expect(x.docs).toMatchObject([{ key: KEY, external_id: "4711", net_cents: 185000 }]);
  });

  it("without a read-back only the state is compared, and an unknown state is not compared", async () => {
    const items = ledgerItems(db);
    const ours = purserDocs(items);
    let x = await readConnector(db, standIn({ readBack: false, held: asSent(), status: "paid" }), items);
    let r = reconcileBooks("Moneybird", ours, x.docs, x);
    expect(r).toMatchObject({ verdict: "agree", compared: ["state"] });
    expect(r.limits[0]).toMatch(/cannot read an invoice back here/);
    x = await readConnector(db, standIn({ readBack: false, held: asSent(), status: "unknown" }), items);
    r = reconcileBooks("Moneybird", ours, x.docs, x);
    expect(r.verdict).toBe("partly compared");
    expect(r.results[0]!.not_compared).toEqual(["state"]);
  });

  it("a read that fails leaves the document not compared, with the reason and no secret", async () => {
    const x = await readConnector(db, standIn({ readBack: true, held: asSent(), fail: "401 for https://x.test?api_key=sk-live-abcdef1234567890" }), ledgerItems(db));
    expect(x.docs[0]).toMatchObject({ net_cents: null, paid_cents: null, state: null });
    expect(x.docs[0]!.note).toMatch(/^could not be read: 401/);
    expect(x.docs[0]!.note).not.toContain("sk-live-abcdef1234567890");
  });
});

// ---- T:0 (stand-in) ----

const balanced = (assets: number): T0BalanceSheet => ({
  periods: [{ id: "p1", label: "this month", start_date: "", end_date: "" }], reporting_currency: "EUR", atoms_per_unit: 100,
  sections: [{ account_type: "asset", label: "Assets", balances: { p1: assets } }, { account_type: "liability", label: "Liabilities", balances: { p1: 0 } }, { account_type: "equity", label: "Equity", balances: { p1: assets } }],
});

async function t0World(sheet: T0BalanceSheet) {
  // The chart in T:0: every account Purser posts to, numbered with Purser's code.
  const codes = [...new Set([...Object.keys(CHART), ...glBooks(db).postings.map((p) => p.account)])];
  const fake = new FakeT0(chartAccounts(codes, (c) => t0AccountType(c) ?? (c.startsWith("2") ? "accounts_payable" : "expenses")));
  const client = new T0Client({ apiKey: fake.key, fetch: fake.fetch, retryDelayMs: 0 });
  const pushed = await t0SinkOnce(db, { env: { T0_ENABLED: "on", T0_RATES: "USD=0.92,USDZ=0.92" }, client });
  expect(pushed).toMatchObject({ ran: true, ok: true });
  const reader: T0Reader = {
    listGlAccounts: (o) => client.listGlAccounts(o), profitLoss: (q) => client.profitLoss(q), listJournalEntries: (q) => client.listJournalEntries(q), balanceSheet: async () => sheet,
  };
  return { fake, reader };
}
const rate = (_d: string, cur: string) => (cur === "USD" || cur === "USDZ" ? 0.92 : undefined);

describe("T:0 (stand-in)", () => {
  it("equal books: the payment is in T:0 with its amount, T:0 balances and holds Purser's entries; net, VAT, gross and state are not compared", async () => {
    const { reader } = await t0World(balanced(100));
    const ours = purserDocs(ledgerItems(db));
    const t = await readT0(reader, glBooks(db).postings, ours, { rate });
    const r = reconcileBooks("T:0", ours, t.docs, t);
    expect(r.verdict).toBe("agree");
    expect(r.compared).toEqual(["paid"]);
    expect(r.checks.map((c) => c.ok)).toEqual([true, true]);
    expect(r.limits[0]).toMatch(/T:0 holds journal entries, not invoices/);
  });

  it("a payment missing in T:0 is reported exactly, and Purser's entries no longer match", async () => {
    const { fake, reader } = await t0World(balanced(100));
    const ours = purserDocs(ledgerItems(db));
    const paid = fake.entries.findIndex((e) => e.memo?.startsWith(`Invoice ${KEY}`));
    expect(paid).toBeGreaterThanOrEqual(0);
    fake.entries.splice(paid, 1);
    const t = await readT0(reader, glBooks(db).postings, ours, { rate });
    const r = reconcileBooks("T:0", ours, t.docs, t);
    expect(r.verdict).toBe("differ");
    expect(r.results[0]!.differences).toEqual([{ field: "paid", ours: "1850.00", theirs: "0.00", diff_cents: 185000 }]);
    expect(r.results[0]!.missing_payments).toEqual(ours[0]!.payments);
    expect(r.checks[1]).toMatchObject({ name: "Purser's entries in T:0 equal Purser's books", ok: false });
  });

  it("a month in which T:0's balance sheet does not balance is a difference, with the amount", async () => {
    const sheet = balanced(100);
    sheet.sections[2]!.balances.p1 = 99;
    const { reader } = await t0World(sheet);
    const ours = purserDocs(ledgerItems(db));
    const t = await readT0(reader, glBooks(db).postings, ours, { rate });
    const r = reconcileBooks("T:0", ours, t.docs, t);
    expect(r.verdict).toBe("differ");
    expect(r.checks[0]).toMatchObject({ ok: false, detail: "this month: assets minus liabilities and equity is 0.01 EUR" });
  });
});

// ---- The command and the read route ----

describe("npm run reconcile-books", () => {
  const run = async (args: string[], extra: Partial<Parameters<typeof runReconcileBooks>[1]> = {}) => {
    const lines: string[] = [];
    const code = await runReconcileBooks(args, { db, env: {}, out: (l) => lines.push(l), now: () => now, ...extra });
    return { code, text: lines.join("\n") };
  };
  const kept = () => (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'books.reconciled'").get() as { n: number }).n;

  it("names the missing settings (never a value), reads nothing and keeps nothing", async () => {
    const secret = "mb-token-abcdef123456";
    let r = await run(["--books", "moneybird"], { env: { ERP_MONEYBIRD_TOKEN: secret } });
    expect(r).toEqual({ code: 2, text: "Not compared: ERP_MONEYBIRD_ADMINISTRATION_ID, ERP_MONEYBIRD_TAX_RATES are not set. Nothing was kept." });
    expect(r.text).not.toContain(secret);
    r = await run(["--books", "t0"]);
    expect(r).toEqual({ code: 2, text: "Not compared: T0_API_KEY is not set. Nothing was kept." });
    expect((await run(["--books", "elsewhere"])).code).toBe(2);
    expect((await run([])).text).toMatch(/^usage: npm run reconcile-books/);
    expect(kept()).toBe(0);
  });

  it("exit 0 when the books agree, 1 when they differ; each run kept as one audit row, the latest served read-only", async () => {
    expect((await run(["--books", "moneybird"], { connector: () => standIn({ readBack: true, held: asSent() }) })).code).toBe(0);
    const r = await run(["--books", "moneybird"], { connector: () => standIn({ readBack: true, held: new Map() }) });
    expect(r.code).toBe(1);
    expect(r.text).toContain(`BTX-2026-21, Bergtex Textil GmbH: not in Moneybird`);
    expect(kept()).toBe(2);
    expect(latestReconciliations(db)).toMatchObject([{ books: "Moneybird", result: { verdict: "differ", counts: { missing_outside: 1 }, differences: [{ key: KEY, outcome: "missing outside" }] } }]);

    const server = payablesApp(db, { inbox: { dir, reader: parserOnly, now: () => now }, rail: null }).listen(0, "127.0.0.1");
    await new Promise<void>((res) => server.once("listening", () => res()));
    try {
      const body = await new Promise<string>((resolve, reject) => {
        request(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payables/reconciliations`, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }).on("error", reject).end();
      });
      expect(JSON.parse(body)).toEqual({ reconciliations: JSON.parse(JSON.stringify(latestReconciliations(db))) });
    } finally {
      server.close();
    }
  });

  it("a read that cannot be made keeps nothing and says why (exit 2)", async () => {
    const failing = { ...standIn({ readBack: true }), findExisting: async () => { throw new Error("connection refused"); } };
    const r = await run(["--books", "moneybird"], { connector: () => failing });
    // The failure of one document is that document's: the run itself is kept, partly compared.
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/not compared: net, VAT, gross, paid, state \(could not be read: connection refused\)/);
    const down = async () => { throw new Error("T:0 is down"); };
    const t0 = await run(["--books", "t0"], { t0: { listGlAccounts: down, profitLoss: down, listJournalEntries: down, balanceSheet: down } as unknown as T0Reader });
    expect(t0).toEqual({ code: 2, text: "Not compared: the outside books could not be read: T:0 is down. Nothing was kept." });
    expect(kept()).toBe(1);
  });
});
