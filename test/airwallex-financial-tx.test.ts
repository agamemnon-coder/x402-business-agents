// Reconciliation from Airwallex's financial transactions (src/finance/awxFinancialTx.ts). Breaks if a cent's difference
// passes, if a payout or conversion Airwallex booked but the ledger lacks goes unreported, if paging stops early or runs
// on without end, or if a negative or sub-cent amount is misread. No network: a stand-in client only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { ledgerMovementsFromDb, ledgerMovementsFromRunRecord, listFinancialTransactions, MAX_PAGES, reconcileFinancialTransactions, recordReconciliation, signedCents, toFinancialTx, type FinancialTx } from "../src/finance/awxFinancialTx.js";

const ft = (o: Partial<FinancialTx> & { sourceId: string; currency: string; amountCents: number }): FinancialTx =>
  ({ id: `ft_${Math.random()}`, sourceType: "PAYOUT", transactionType: "PAYOUT", feeCents: 0, netCents: o.amountCents, status: "SETTLED", createdAt: null, settledAt: null, ...o });

describe("Airwallex's financial transactions against the ledger", () => {
  const payout = { kind: "payout" as const, sourceId: "tr_1", label: "SLL-2026-11", currency: "EUR", amountCents: 24_000, feeCents: 1_350 };
  const conversion = { kind: "conversion" as const, sourceId: "cv_1", label: "conv", buyCurrency: "EUR", buyCents: 62_350, sellCurrency: "USD", sellCents: 70_445 };

  it("agrees to the cent as the sandbox books a payout: a PAYOUT row and a FEE row under the transfer id", () => {
    const rows = [ft({ sourceId: "tr_1", currency: "EUR", amountCents: -24_000 }), ft({ sourceId: "tr_1", currency: "EUR", amountCents: -1_350, sourceType: "FEE", transactionType: "FEE" })];
    expect(reconcileFinancialTransactions([payout], rows).movements[0]).toMatchObject({ agrees: true, how: "a PAYOUT row for the amount and a FEE row for the fee, both under the transfer id" });
    rows[1]!.amountCents = -1_351;
    expect(reconcileFinancialTransactions([payout], rows).movements[0]).toMatchObject({ agrees: false, how: "amounts differ" });
  });

  it("also agrees with the fee in its own field, or inside the gross amount", () => {
    expect(reconcileFinancialTransactions([payout], [ft({ sourceId: "tr_1", currency: "EUR", amountCents: -24_000, feeCents: -1_350 })]).movements[0]).toMatchObject({ agrees: true, how: "amount and fee in their own fields of one row" });
    expect(reconcileFinancialTransactions([payout], [ft({ sourceId: "tr_1", currency: "EUR", amountCents: -25_350 })]).movements[0]).toMatchObject({ agrees: true, how: "fee included in the gross amount" });
  });

  it("reports one cent's difference, a missing payout and a cancelled row as differences", () => {
    const r = reconcileFinancialTransactions([payout, conversion], [
      ft({ sourceId: "tr_1", currency: "EUR", amountCents: -24_001, feeCents: -1_350 }),
      ft({ sourceId: "cv_1", currency: "EUR", amountCents: 62_350, sourceType: "CONVERSION", status: "CANCELLED" }),
    ]);
    expect(r.differences.map((d) => [d.sourceId, d.how])).toEqual([["tr_1", "amounts differ"], ["cv_1", "no rows for this conversion"]]);
  });

  it("checks both legs of a conversion, and lists payouts Airwallex booked that the ledger lacks; cards are out of scope", () => {
    const r = reconcileFinancialTransactions([conversion], [
      ft({ sourceId: "cv_1", currency: "EUR", amountCents: 62_350, sourceType: "CONVERSION", transactionType: "CONVERSION_BUY" }),
      ft({ sourceId: "cv_1", currency: "USD", amountCents: -70_445, sourceType: "CONVERSION", transactionType: "CONVERSION_SELL" }),
      ft({ sourceId: "tr_other", currency: "EUR", amountCents: -9_900 }),
      ft({ sourceId: "tr_other", currency: "EUR", amountCents: -1_340, sourceType: "FEE", transactionType: "FEE" }),
      ft({ sourceId: "card_1", currency: "EUR", amountCents: -1_999, sourceType: "CARD_PURCHASE" }),
    ]);
    expect(r.agree).toBe(1);
    expect(r.unknownAtAirwallex).toEqual([expect.objectContaining({ sourceId: "tr_other", amount: "EUR -99.00" }), expect.objectContaining({ sourceId: "tr_other", sourceType: "FEE", amount: "EUR -13.40" })]);
    expect(r.outOfScope).toEqual({ CARD_PURCHASE: 1 });
  });

  it("reads amounts exactly: negatives, numbers and strings; refuses a fraction of a cent", () => {
    expect([signedCents(-253.5), signedCents("-0.01"), signedCents(1850), signedCents("0.00")]).toEqual([-25_350, -1, 185_000, 0]);
    expect(() => signedCents("1.001")).toThrow(/finer than a cent/);
    expect(toFinancialTx({ id: "x", source_id: "s", source_type: "PAYOUT", transaction_type: "PAYOUT", currency: "EUR", amount: -240, fee: -13.5, net: -253.5, status: "SETTLED" }))
      .toMatchObject({ amountCents: -24_000, feeCents: -1_350, netCents: -25_350 });
  });

  it("reads every page and stops at has_more false; refuses a window wider than MAX_PAGES", async () => {
    const queries: Record<string, string>[] = [];
    const api = { call: async (_m: string, _p: string, _b: unknown, q: Record<string, string>) => { queries.push(q); return { items: [{ id: `f${q.page_num}`, amount: 1, currency: "EUR" }], has_more: q.page_num !== "2" }; } };
    const got = await listFinancialTransactions(api as never, { from: "2026-11-07T12:00:00Z", to: "2026-11-07T12:30:00Z" });
    expect(got.map((g) => g.id)).toEqual(["f0", "f1", "f2"]);
    expect(queries[0]).toMatchObject({ from_created_at: "2026-11-07T12:00:00Z", to_created_at: "2026-11-07T12:30:00Z", page_size: "1000", page_num: "0" });
    const endless = { call: async () => ({ items: [], has_more: true }) };
    await expect(listFinancialTransactions(endless as never, { from: "a", to: "b" })).rejects.toThrow(new RegExp(`more than ${MAX_PAGES} pages`));
  });

  it("takes the ledger from the database or from the committed awx-1 run record, and records the result", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('X-1', 'V', '240.00', 'EUR', '2026-12-01', 'i', 'B', 'd', 'PAID')").run();
    db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES ('tr_1', 'rq', 'X-1', '240.00', 'EUR', 'SWIFT', '20.00', 'EUR 13.50', 'PAID', 'h', 'now')").run();
    expect(ledgerMovementsFromDb(db)).toEqual([{ kind: "payout", sourceId: "tr_1", label: "X-1", currency: "EUR", amountCents: 24_000, feeCents: 1_350 }]);
    const rec = JSON.parse(readFileSync(new URL("../docs/demo/airwallex-run.json", import.meta.url), "utf8"));
    const m = ledgerMovementsFromRunRecord(rec);
    expect(m.map((x) => x.kind)).toEqual(["payout", "payout", "conversion"]);
    expect(m[2]).toMatchObject({ sourceId: "fafcc208-bd1e-43d9-bd09-69191a8aa81f", buyCents: 62_350, sellCents: 70_445 });
    recordReconciliation(db, reconcileFinancialTransactions(m, []), { from: "a", to: "b" });
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'awx_ft.reconciled'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ checked: 3, agree: 0, differences: 3 });
  });
});
