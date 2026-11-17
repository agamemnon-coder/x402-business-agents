// A supplier payout that does not stay paid (17 Nov). Airwallex: "PAID is not always final. A transfer can still move
// to FAILED after PAID if it is later rejected by the local clearing system or the recipient bank" (Transfer statuses,
// "Late failures after PAID"); the amount less the transfer fee comes back ("Handle failed transfers"). Purser reads a
// paid payout again when a payout.transfer.failed webhook asks (never trusting its body), sends the invoice to a
// person, takes the payment back in the books (the fee stays: Airwallex keeps it), corrects the ERP without deleting,
// and never sends anything again under the old approval. A payout that fails after SENT, before PAID, no longer leaves
// its invoice waiting for good. The sandbox run of 17 Nov (docs/runs/2026-11-17-airwallex-late-failure.json) ran the
// read again, the person and the no-resend live; taking a booked payment back in the books is held here only.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { journal } from "../src/accounting/gl.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { apJournal, CsvFileSink, type ApEntry } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { insights } from "../src/ap/insights.js";
import { towerView } from "../src/dashboard/tower.js";
import { openDb, type DB } from "../src/db/open.js";
import { ledgerItems } from "../src/erp/source.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { toCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { checkEvent } from "../src/policy/airwallexEvents.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "payout-returned-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** One invoice through the inbox, signed by the CFO and executed; settled in the sandbox when `settle`. */
async function paidInvoice(settle = true): Promise<{ id: string; proposalId: string; transferId: string }> {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(EN), filename: "en.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const id = out.invoice.id;
  const filed = await payApInvoice(db, awx, id, now);
  if (filed.kind !== "proposed") throw new Error(filed.reason);
  const proposalId = filed.proposal.proposal_id;
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string };
  decide(db, { proposalId, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  const r = await executeInvoicePayment(db, awx, settle ? awx : null, proposalId);
  return { id, proposalId, transferId: r.transfer.id };
}
const events = (event: string, subject: string) => db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(event, subject) as { payload_json: string }[];
const sum = (es: ApEntry[], k: "debit" | "credit", account?: string) => es.filter((e) => !account || e.account === account).reduce((n, e) => n + (e[k] ? toCents(e[k]) : 0), 0);

describe("a payout that came back after Airwallex had it PAID", () => {
  it("is not re-read without a webhook asking: PAID stays PAID in the ledger until Airwallex says otherwise", async () => {
    const { id, transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx });
    expect(apInvoice(db, id)!.status).toBe("paid");
    await awx.transitionTransfer(transferId, "FAILED");
    const reads = awx.calls.length;
    await syncPayments(db, { ...deps, rail: awx });
    // No webhook yet: nothing re-reads a paid payout on every sync (that would be an Airwallex call per payout, per sync).
    expect(apInvoice(db, id)!.status).toBe("paid");
    expect(awx.calls.length).toBe(reads);
  });

  it("a payout.transfer.failed webhook only asks; the follow-up reads Airwallex, records the return and sends the invoice to a person", async () => {
    const { id, proposalId, transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx });
    await awx.transitionTransfer(transferId, "FAILED");
    // The webhook: a disagreement with the ledger, recorded; it changes no status itself.
    const c = checkEvent(db, "payout.transfer.failed", { id: transferId, status: "FAILED" }, now);
    expect(c.agrees).toBe(false);
    expect((db.prepare("SELECT status FROM transfers WHERE transfer_id = ?").get(transferId) as { status: string }).status).toBe("PAID");
    expect(events("transfer.recheck_requested", transferId)).toHaveLength(1);

    await syncPayments(db, { ...deps, rail: awx });
    const t = db.prepare("SELECT status, failure_type FROM transfers WHERE transfer_id = ?").get(transferId) as { status: string; failure_type: string };
    expect(t).toEqual({ status: "CANCELLED", failure_type: "BENEFICIARY_BANK_RETURNED" });
    const ret = events("transfer.returned_after_paid", transferId).map((e) => JSON.parse(e.payload_json) as Record<string, unknown>);
    expect(ret).toHaveLength(1);
    expect(ret[0]).toMatchObject({ proposal_id: proposalId, failure_type: "BENEFICIARY_BANK_RETURNED" });
    const inv = apInvoice(db, id)!;
    expect(inv.status).toBe("needs_review");
    const why = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'ap.status' AND subject = ? ORDER BY seq DESC LIMIT 1").get(id) as { payload_json: string }).payload_json) as { reason: string };
    expect(why.reason).toMatch(/came back after Airwallex had it PAID \(BENEFICIARY_BANK_RETURNED\); Purser sends nothing again for this invoice/);

    // A second sync and a second webhook record nothing twice.
    checkEvent(db, "payout.transfer.cancelled", { id: transferId, status: "CANCELLED" }, now);
    await syncPayments(db, { ...deps, rail: awx });
    expect(events("transfer.returned_after_paid", transferId)).toHaveLength(1);
  });

  it("the books take the payment back: the supplier is owed again, and the transfer fee stays booked (Airwallex keeps it)", async () => {
    const { id, transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx });
    await awx.transitionTransfer(transferId, "FAILED");
    checkEvent(db, "payout.transfer.failed", { id: transferId, status: "FAILED" }, now);
    await syncPayments(db, { ...deps, rail: awx });

    const es = apJournal(db).filter((e) => e.invoice_id === id);
    expect(es.map((e) => e.event)).toEqual(["accrual", "accrual", "accrual", "payment", "payment", "payment", "payment", "return", "return"]);
    expect(es.filter((e) => e.event === "return").map((e) => [e.account, e.debit, e.credit])).toEqual([["1200", "1850.00", ""], ["2100", "", "1850.00"]]);
    // Owed again: 2100 is credited by the accrual and the return, debited once by the payment.
    expect(sum(es, "credit", "2100") - sum(es, "debit", "2100")).toBe(185000);
    // The fee: paid out and not refunded.
    expect(sum(es, "debit", "6800")).toBe(1340);
    expect(sum(es, "debit")).toBe(sum(es, "credit"));
  });

  it("keeps the fee's line as it was booked when paid: same day, same words, so the ERP entry that holds it is unchanged", async () => {
    const { transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx });
    const feeOf = () => ledgerItems(db).filter((i) => i.kind === "journal" && (i.object as { id: string }).id.startsWith("transfer-fee:")).map((i) => JSON.stringify(i.object));
    const glFee = () => journal(db).filter((l) => l.proof === transferId && l.gl_account === "6800").map((l) => [l.date.slice(0, 10), l.description, l.amount]);
    const before = { erp: feeOf(), gl: glFee() };
    expect(before.gl).toHaveLength(1);
    await awx.transitionTransfer(transferId, "FAILED");
    checkEvent(db, "payout.transfer.failed", { id: transferId, status: "FAILED" }, now);
    // The return is read a month later: nothing about the fee may move with it.
    await syncPayments(db, { ...deps, rail: awx, now: () => new Date(now.getTime() + 35 * 86_400_000) });
    expect(glFee()).toEqual(before.gl);
    expect(feeOf()).toEqual(before.erp);
  });

  it("a sink that was down when the payout came back gets the return on a later sync, once", async () => {
    const path = join(dir, "flaky.csv");
    const csv = new CsvFileSink(path);
    let down = false;
    const sink = { name: "csv", push: (es: ApEntry[]) => { if (down && es.some((e) => e.event === "return")) throw new Error("sink down"); csv.push(es); } };
    const { id, transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx, sink });
    await awx.transitionTransfer(transferId, "FAILED");
    checkEvent(db, "payout.transfer.failed", { id: transferId, status: "FAILED" }, now);
    down = true;
    await syncPayments(db, { ...deps, rail: awx, sink });
    expect(apInvoice(db, id)!.status).toBe("needs_review");
    expect(readFileSync(path, "utf8").split("\n").filter((l) => l.includes(",return,"))).toHaveLength(0);
    down = false;
    await syncPayments(db, { ...deps, rail: awx, sink });
    await syncPayments(db, { ...deps, rail: awx, sink });
    expect(readFileSync(path, "utf8").split("\n").filter((l) => l.includes(",return,"))).toHaveLength(2);
  });

  it("the sink that took the payment gets the return, once", async () => {
    const path = join(dir, "journal.csv");
    const sink = new CsvFileSink(path);
    const { transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx, sink });
    await awx.transitionTransfer(transferId, "FAILED");
    checkEvent(db, "payout.transfer.failed", { id: transferId, status: "FAILED" }, now);
    await syncPayments(db, { ...deps, rail: awx, sink });
    await syncPayments(db, { ...deps, rail: awx, sink });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const ret = lines.filter((l) => l.includes(",return,"));
    expect(ret).toHaveLength(2);
    expect(ret.join("\n")).toMatch(/returned by the supplier's bank \(BENEFICIARY_BANK_RETURNED\); the amount is refunded, the transfer fee is not/);
  });

  it("nothing is sent again under the old approval: running it again sends no payout", async () => {
    const { proposalId, transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx });
    await awx.transitionTransfer(transferId, "FAILED");
    checkEvent(db, "payout.transfer.failed", { id: transferId, status: "FAILED" }, now);
    await syncPayments(db, { ...deps, rail: awx });
    const creates = awx.calls.filter((c) => c === "createTransfer").length;
    await executeInvoicePayment(db, awx, awx, proposalId).catch(() => null);
    expect(awx.calls.filter((c) => c === "createTransfer").length).toBe(creates);
  });

  it("the general ledger drops the payout but keeps its fee; the ERP keeps the payment and gets a journal entry that takes it back", async () => {
    const { transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx });
    const before = journal(db).filter((l) => l.proof === transferId).map((l) => l.description);
    await awx.transitionTransfer(transferId, "FAILED");
    checkEvent(db, "payout.transfer.failed", { id: transferId, status: "FAILED" }, now);
    await syncPayments(db, { ...deps, rail: awx });
    const after = journal(db).filter((l) => l.proof === transferId);
    if (before.length) {
      // Wherever the ledger books this payout, its fee is the only line left once it came back.
      expect(after.map((l) => l.gl_account)).toEqual(["6800"]);
    }
    const items = ledgerItems(db);
    const pay = items.filter((i) => i.kind === "payment" && (i.object as { airwallexTransferId?: string }).airwallexTransferId === transferId);
    const back = items.filter((i) => i.kind === "journal" && (i.object as { id: string }).id.startsWith("payment-return:"));
    if (pay.length) {
      expect(back).toHaveLength(1);
      const j = back[0]!.object as { lines: { glAccount: string; debitCents: number; creditCents: number }[] };
      expect(j.lines.map((l) => [l.glAccount, l.debitCents, l.creditCents])).toEqual([["1200", 185000, 0], ["2100", 0, 185000]]);
    } else {
      expect(back).toHaveLength(0);
    }
  });
});

describe("a payout that failed after it was sent, before PAID", () => {
  it("no longer leaves its invoice waiting for the CFO for good: it goes to a person, nothing is booked as paid", async () => {
    const { id, transferId } = await paidInvoice(false);
    await syncPayments(db, { ...deps, rail: awx });
    expect(apInvoice(db, id)!.status).toBe("waiting_cfo");
    await awx.transitionTransfer(transferId, "SENT");
    await awx.transitionTransfer(transferId, "FAILED");
    await syncPayments(db, { ...deps, rail: awx });
    const inv = apInvoice(db, id)!;
    expect(inv.status).toBe("needs_review");
    expect(events("transfer.returned_after_paid", transferId)).toHaveLength(0);
    expect(apJournal(db).filter((e) => e.invoice_id === id && (e.event === "payment" || e.event === "return"))).toEqual([]);
  });
});

describe("a ledger made before the return event", () => {
  it("is migrated on open: the sink's table takes a return, and every row it had is kept", () => {
    const path = join(dir, "old.db");
    const old = openDb(path);
    // As the table was until 17 Nov: no 'return' in its CHECK.
    old.exec(`DROP TABLE ap_sink_events;
      CREATE TABLE ap_sink_events (invoice_id TEXT NOT NULL REFERENCES ap_invoices(id),
        event TEXT NOT NULL CHECK (event IN ('accrual', 'payment', 'reversal')), sink TEXT NOT NULL, pushed_at TEXT NOT NULL,
        PRIMARY KEY (invoice_id, event, sink));`);
    old.close();
    const reopened = openDb(path);
    const sql = (reopened.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ap_sink_events'").get() as { sql: string }).sql;
    expect(sql).toContain("'return'");
    expect(reopened.prepare("SELECT name FROM sqlite_master WHERE name = 'ap_sink_events_old'").get()).toBeUndefined();
    reopened.close();
  });

  it("keeps the rows the old table held", async () => {
    const path = join(dir, "rows.db");
    const w = openDb(path);
    const saved = db;
    db = w;
    try {
      const sink = new CsvFileSink(join(dir, "rows.csv"));
      await seedTreasury(db, awx, awx);
      const { id } = await paidInvoice();
      await syncPayments(db, { ...deps, rail: awx, sink });
      const before = db.prepare("SELECT invoice_id, event, sink, pushed_at FROM ap_sink_events ORDER BY event").all();
      expect(before.length).toBeGreaterThan(0);
      // Back to the old CHECK, rows and all, as a ledger from before this change.
      db.exec(`ALTER TABLE ap_sink_events RENAME TO t;
        CREATE TABLE ap_sink_events (invoice_id TEXT NOT NULL REFERENCES ap_invoices(id),
          event TEXT NOT NULL CHECK (event IN ('accrual', 'payment', 'reversal')), sink TEXT NOT NULL, pushed_at TEXT NOT NULL,
          PRIMARY KEY (invoice_id, event, sink));
        INSERT INTO ap_sink_events SELECT * FROM t; DROP TABLE t;`);
      db.close();
      db = openDb(path);
      expect(db.prepare("SELECT invoice_id, event, sink, pushed_at FROM ap_sink_events ORDER BY event").all()).toEqual(before);
      expect(apInvoice(db, id)!.status).toBe("paid");
      db.close();
    } finally {
      db = saved;
    }
  });
});

// Review gap (17 Nov): the books keep a returned payout's transfer fee (src/accounting/gl.ts), but the payables insight
// panel and the control tower counted only PAID transfers' fees, so their totals were below the books' after a return.
describe("the dashboards count the fee the books keep", () => {
  /** The transfer fees the books hold, in cents: the 6800 lines of source "transfer". */
  const glFees = () => journal(db).filter((l) => l.source === "transfer" && l.gl_account === "6800").reduce((n, l) => n + toCents(l.amount.replace(/^-/, "")), 0);
  const returned = async () => {
    const { transferId } = await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx });
    await awx.transitionTransfer(transferId, "FAILED");
    checkEvent(db, "payout.transfer.failed", { id: transferId, status: "FAILED" }, now);
    await syncPayments(db, { ...deps, rail: awx });
    expect(events("transfer.returned_after_paid", transferId)).toHaveLength(1);
  };

  it("the payables insights: a returned payout's fee is in the SWIFT fees, which equal the books' transfer fees", async () => {
    await returned();
    expect(glFees()).toBe(1340);
    expect(insights(db, now).costs.swift_fees).toEqual([{ currency: "EUR", total: "13.40", count: 1 }]);
  });

  it("the control tower: a returned payout's fee is in the P&L's fees, which equal the books' transfer fees", async () => {
    await returned();
    const t = towerView(db, { budgets: [], cards: [] });
    expect(toCents(t.pnl.eur.fees)).toBe(glFees());
    expect(t.pnl.eur.fees).toBe("13.40");
    // The payout itself is no longer money out (it came back); its fee is.
    expect(t.pnl.eur.payouts).toBe("0.00");
  });
});
