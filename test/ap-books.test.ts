// Payables, part 4: the books (every entry balances; the accrual on receipt, the payment and the fee Airwallex really
// charged once paid), the exports a bookkeeping package imports, the sink that receives entries as they happen, and the
// insight panel's figures, each from the ledger.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { apJournal, CsvFileSink, invoicesCsv, journalCsv, type ApEntry } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { insights } from "../src/ap/insights.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice, apInvoices } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { toCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-books-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = async (text: string, name: string) => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
async function payInFull(id: string) {
  const out = await payApInvoice(db, awx, id, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { terms_sha256: string };
  decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
  await syncPayments(db, deps);
}
const sum = (es: ApEntry[], k: "debit" | "credit") => es.reduce((n, e) => n + (e[k] ? toCents(e[k]) : 0), 0);

describe("the books", () => {
  it("books a checked invoice on receipt: expense and input VAT against what we owe, and the two sides balance", async () => {
    const id = await add(EN, "en.pdf");
    const es = apJournal(db).filter((e) => e.invoice_id === id);
    expect(es.map((e) => [e.event, e.account, e.debit, e.credit])).toEqual([
      ["accrual", "6200", "1554.62", ""],
      // Bergtex is German (VAT id DE…) and charged 19%: Germany's VAT, to reclaim through the EU refund (1515), not 5b.
      ["accrual", "1515", "295.38", ""],
      ["accrual", "2100", "", "1850.00"],
    ]);
    expect(sum(es, "debit")).toBe(sum(es, "credit"));
    expect(es[1]!.account_name).toMatch(/Foreign VAT/);
  });

  it("books the payment and the SWIFT fee Airwallex charged once it is paid", async () => {
    const id = await add(EN, "en.pdf");
    await payInFull(id);
    expect(apInvoice(db, id)!.status).toBe("paid");
    const pay = apJournal(db).filter((e) => e.invoice_id === id && e.event === "payment");
    expect(pay.map((e) => [e.account, e.debit, e.credit])).toEqual([
      ["2100", "1850.00", ""], ["1200", "", "1850.00"], ["6800", "13.40", ""], ["1200", "", "13.40"],
    ]);
    expect(sum(apJournal(db), "debit")).toBe(sum(apJournal(db), "credit"));
  });

  it("leaves blocked and waiting invoices out of the books", async () => {
    await add(NL, "nl.pdf");
    await add(EN.replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00"), "bad.pdf");
    expect(apJournal(db)).toEqual([]);
  });

  it("exports the journal and the invoices as CSV with fixed columns", async () => {
    await add(EN, "en.pdf");
    const j = journalCsv(apJournal(db)).split("\n");
    expect(j[0]).toBe("date,invoice_id,event,account,account_name,debit,credit,currency,memo,doc_sha256");
    expect(j).toHaveLength(5);
    const i = invoicesCsv(apInvoices(db)).split("\n");
    expect(i[0]).toBe("id,vendor,invoice_no,issue_date,due_date,currency,subtotal,tax,total,gl_account,cost_centre,status,read_by,received_at,paid_at,doc_sha256");
    expect(i[1]).toMatch(/^AP-0001,Bergtex Textil GmbH,BTX-2026-21,2026-11-02,2026-11-16,EUR,1554.62,295.38,1850.00,6200,CC300,ready,parser,/);
  });

  it("hands each event's entries to the sink as it happens; the CSV file gets one header", async () => {
    const path = join(dir, "journal.csv");
    deps.sink = new CsvFileSink(path);
    const id = await add(EN, "en.pdf");
    expect(existsSync(path)).toBe(true);
    await payInFull(id);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines.filter((l) => l.startsWith("date,"))).toHaveLength(1);
    expect(lines).toHaveLength(1 + 3 + 4);
  });

  it("a sink that fails does not stop the inbox; the failure is in the audit log", async () => {
    deps.sink = { name: "broken", push: () => { throw new Error("down"); } };
    await add(EN, "en.pdf");
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ap.sink_failed'").get()).toEqual({ n: 1 });
  });
});

describe("insight", () => {
  it("open payables, due soon, overdue, blocked with reasons, spend per supplier, a price rise, time to pay and fees", async () => {
    const strip = (t: string) => t.replace("Subtotal EUR 1,554.62\nVAT 19% EUR 295.38\n", "");
    await add(strip(EN).replace(/BTX-2026-21/g, "BTX-1").replace("16 November 2026", "1 November 2026"), "1.pdf");
    // Another invoice for the same amount, two months apart (dated within 45 days it would be a possible duplicate).
    await add(strip(EN).replace(/BTX-2026-21/g, "BTX-2").replace("Invoice date: 2 November 2026", "Invoice date: 2 September 2026"), "2.pdf");
    await add(strip(EN).replace(/BTX-2026-21/g, "BTX-3").replace("1,850.00", "2,220.00").replace("16 November 2026", "1 December 2027"), "3.pdf");
    await add(NL, "nl.pdf");
    await add(EN.replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00").replace(/BTX-2026-21/g, "BTX-9"), "bad.pdf");
    await payInFull("AP-0002");
    const day = (d: string) => new Date(`${d}T12:00:00Z`);
    const x = insights(db, day("2026-11-10"));
    expect(x.open).toEqual([{ currency: "EUR", total: "4554.00", count: 3 }]);
    expect(x.overdue).toEqual([{ currency: "EUR", total: "1850.00", count: 1 }]);
    expect(x.due_7).toEqual([{ currency: "EUR", total: "484.00", count: 1 }]);
    expect(x.due_30).toEqual([{ currency: "EUR", total: "484.00", count: 1 }]);
    expect(x.waiting).toEqual({ needs_vendor: 1, needs_review: 0, waiting_cfo: 0 });
    expect(x.blocked).toEqual({ count: 1, reasons: [{ code: "sum_mismatch", count: 1 }] });
    expect(x.spend_90d[0]).toEqual({ vendor: "Bergtex Textil GmbH", currency: "EUR", total: "5920.00", count: 3 });
    expect(x.price_rises).toEqual([{ vendor: "Bergtex Textil GmbH", currency: "EUR", last: "2220.00", usual: "1850.00", change_pct: 20 }]);
    expect(x.time_to_pay.paid).toBe(1);
    expect(x.costs.swift_fees).toEqual([{ currency: "EUR", total: "13.40", count: 1 }]);
    expect(x.costs.fx).toMatchObject({ conversions: 1, bought: "EUR 370.00" });
  });
});
