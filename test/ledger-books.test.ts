// Documents, VAT, reports, closing and stock on the stored ledger (bookkeeping core, decisions 3 to 7).
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { ledgerRows, LedgerRefused, postEntry, verifyLedger } from "../src/ledger/core.js";
import { purchaseInvoice, salesInvoice, settleOpenItem } from "../src/ledger/documents.js";
import { ageing, balanceSheet, cashByCurrency, profitAndLoss, trialBalance, vatOverview } from "../src/ledger/reports.js";
import { closeMonth, closeYear } from "../src/ledger/close.js";
import { buyGoods, sellGoods, stockOnHand } from "../src/ledger/stock.js";
import { VAT_NOTICE, vatOn } from "../src/ledger/vat.js";

const NOW = new Date("2026-11-30T12:00:00Z");
const fresh = (): DB => openDb(":memory:");
const balanceOf = (db: DB, account: string, currency = "EUR") => trialBalance(db).find((r) => r.account === account && r.currency === currency)?.balance_cents ?? 0;

describe("VAT amounts", () => {
  it("rounds half away from zero per line and keeps the sign of a credit note", () => {
    expect(vatOn(10_000, "S21")).toBe(2_100);
    expect(vatOn(1_050, "S9")).toBe(95); // 94.5 cents rounds up
    expect(vatOn(-1_050, "S9")).toBe(-95);
    expect(vatOn(10_000, "SEU")).toBe(0);
    expect(() => vatOn(1, "NOPE")).toThrow(/NOPE/);
  });
});

describe("documents", () => {
  it("books a purchase invoice: expense and input VAT against payables, with the supplier, document and due date", () => {
    const db = fresh();
    purchaseInvoice(db, { date: "2026-10-05", supplier: "Bergtex Textil GmbH", doc_ref: "BTX-1", due_date: "2026-11-04", currency: "EUR", created_by: "test",
      lines: [{ account: "6900", net_cents: 100_000, vat_code: "P21", cost_centre: "CC300" }] }, NOW);
    expect(balanceOf(db, "6900")).toBe(100_000);
    expect(balanceOf(db, "1510")).toBe(21_000);
    expect(balanceOf(db, "2100")).toBe(-121_000);
    const payable = ledgerRows(db)[0]!.lines.find((l) => l.account === "2100")!;
    expect(payable).toMatchObject({ party: "Bergtex Textil GmbH", doc_ref: "BTX-1", due_date: "2026-11-04" });
  });

  it("books a reverse-charge purchase from the EU: VAT both owed and reclaimed, nothing extra to pay the supplier", () => {
    const db = fresh();
    purchaseInvoice(db, { date: "2026-10-05", supplier: "Lager AB", doc_ref: "LG-9", due_date: "2026-11-04", currency: "EUR", created_by: "test",
      lines: [{ account: "6900", net_cents: 50_000, vat_code: "PRC_EU" }] }, NOW);
    expect(balanceOf(db, "1510")).toBe(10_500);
    expect(balanceOf(db, "2210")).toBe(-10_500);
    expect(balanceOf(db, "2100")).toBe(-50_000);
  });

  it("books a sales invoice and its payment; the open item disappears from the ageing once paid", () => {
    const db = fresh();
    salesInvoice(db, { date: "2026-10-10", customer: "Trailhead Retail", doc_ref: "NW-100", due_date: "2026-10-24", currency: "EUR", created_by: "test",
      lines: [{ account: "4200", net_cents: 20_000, vat_code: "S21" }] }, NOW);
    expect(balanceOf(db, "1300")).toBe(24_200);
    expect(balanceOf(db, "2210")).toBe(-4_200);
    expect(ageing(db, "receivables", "2026-11-30").items).toEqual([expect.objectContaining({ party: "Trailhead Retail", doc_ref: "NW-100", open_cents: 24_200, days_overdue: 37, bucket: "31-60" })]);
    settleOpenItem(db, { kind: "receive", party: "Trailhead Retail", doc_ref: "NW-100", amount_cents: 24_200, currency: "EUR", bank: "1200", date: "2026-11-02", created_by: "test" }, NOW);
    expect(ageing(db, "receivables", "2026-11-30").items).toEqual([]);
    expect(balanceOf(db, "1200")).toBe(24_200);
  });

  it("refuses to settle more than is open, or an item that does not exist", () => {
    const db = fresh();
    purchaseInvoice(db, { date: "2026-10-05", supplier: "S", doc_ref: "S-1", due_date: "2026-11-04", currency: "EUR", created_by: "test", lines: [{ account: "6900", net_cents: 1_000, vat_code: "P0" }] }, NOW);
    expect(() => settleOpenItem(db, { kind: "pay", party: "S", doc_ref: "S-1", amount_cents: 1_001, currency: "EUR", bank: "1200", date: "2026-11-01", created_by: "test" }, NOW)).toThrow(LedgerRefused);
    expect(() => settleOpenItem(db, { kind: "pay", party: "S", doc_ref: "nope", amount_cents: 1, currency: "EUR", bank: "1200", date: "2026-11-01", created_by: "test" }, NOW)).toThrow(LedgerRefused);
  });
});

describe("the VAT overview", () => {
  it("adds up the quarter into the rubrics of the Dutch return and says it is not a filing", () => {
    const db = fresh();
    salesInvoice(db, { date: "2026-10-10", customer: "A", doc_ref: "1", due_date: "2026-10-24", currency: "EUR", created_by: "t", lines: [{ account: "4200", net_cents: 100_000, vat_code: "S21" }, { account: "4200", net_cents: 10_000, vat_code: "S9" }] }, NOW);
    salesInvoice(db, { date: "2026-11-10", customer: "B GmbH", doc_ref: "2", due_date: "2026-11-24", currency: "EUR", created_by: "t", lines: [{ account: "4200", net_cents: 30_000, vat_code: "SEU" }] }, NOW);
    purchaseInvoice(db, { date: "2026-11-11", supplier: "C", doc_ref: "3", due_date: "2026-12-11", currency: "EUR", created_by: "t", lines: [{ account: "6900", net_cents: 40_000, vat_code: "P21" }] }, NOW);
    purchaseInvoice(db, { date: "2026-12-01", supplier: "D AB", doc_ref: "4", due_date: "2026-12-31", currency: "EUR", created_by: "t", lines: [{ account: "6900", net_cents: 10_000, vat_code: "PRC_EU" }] }, NOW);
    purchaseInvoice(db, { date: "2026-09-30", supplier: "E", doc_ref: "5", due_date: "2026-10-30", currency: "EUR", created_by: "t", lines: [{ account: "6900", net_cents: 99_900, vat_code: "P21" }] }, NOW);
    const v = vatOverview(db, "2026Q4");
    expect(v.notice).toBe(VAT_NOTICE);
    expect(v.rubrics["1a"]).toEqual({ base_cents: 100_000, vat_cents: 21_000 });
    expect(v.rubrics["1b"]).toEqual({ base_cents: 10_000, vat_cents: 900 });
    expect(v.rubrics["3b"]).toEqual({ base_cents: 30_000, vat_cents: 0 });
    expect(v.rubrics["4b"]).toEqual({ base_cents: 10_000, vat_cents: 2_100 });
    expect(v.owed_5a_cents).toBe(21_000 + 900 + 2_100);
    expect(v.input_5b_cents).toBe(8_400 + 2_100);
    expect(v.balance_5c_cents).toBe(24_000 - 10_500);
  });

  it("lists P&L lines without a VAT code instead of guessing, and lines in another currency apart", () => {
    const db = fresh();
    purchaseInvoice(db, { date: "2026-10-01", supplier: "X", doc_ref: "x", due_date: "2026-10-31", currency: "USD", created_by: "t", lines: [{ account: "6900", net_cents: 5_000, vat_code: "P0" }] }, NOW);
    postEntry(db, { date: "2026-10-02", description: "Card spend, VAT not known", created_by: "t", lines: [{ account: "6100", debit: 999, currency: "EUR" }, { account: "1200", credit: 999, currency: "EUR" }] }, NOW);
    const v = vatOverview(db, "2026Q4");
    expect(v.other_currency_lines).toBe(1);
    expect(v.uncoded_lines).toBe(1);
    expect(v.input_5b_cents).toBe(0);
    expect(() => vatOverview(db, "2026Q5")).toThrow();
  });
});

describe("reports and closing", () => {
  function world(db: DB) {
    salesInvoice(db, { date: "2026-11-10", customer: "A", doc_ref: "S1", due_date: "2026-11-24", currency: "EUR", created_by: "t", lines: [{ account: "4200", net_cents: 100_000, vat_code: "S21" }] }, NOW);
    settleOpenItem(db, { kind: "receive", party: "A", doc_ref: "S1", amount_cents: 121_000, currency: "EUR", bank: "1200", date: "2026-11-20", created_by: "t" }, NOW);
    purchaseInvoice(db, { date: "2026-11-11", supplier: "C", doc_ref: "P1", due_date: "2026-12-11", currency: "EUR", created_by: "t", lines: [{ account: "6100", net_cents: 30_000, vat_code: "P21" }] }, NOW);
  }

  it("the trial balance balances, P&L gives the result and the balance sheet balances per currency", () => {
    const db = fresh();
    world(db);
    expect(trialBalance(db).reduce((s, r) => s + r.balance_cents, 0)).toBe(0);
    const pl = profitAndLoss(db, { from: "2026-01-01", to: "2026-12-31" }).EUR!;
    expect(pl).toMatchObject({ revenue_cents: 100_000, expense_cents: 30_000, result_cents: 70_000 });
    const bs = balanceSheet(db, "2026-12-31").EUR!;
    expect(bs.balanced).toBe(true);
    expect(bs.assets_cents).toBe(bs.liabilities_cents + bs.equity_cents + bs.result_cents);
    expect(cashByCurrency(db)).toEqual([{ account: "1200", currency: "EUR", balance_cents: 121_000 }]);
    expect(ageing(db, "payables", "2026-12-20").items).toEqual([expect.objectContaining({ party: "C", open_cents: 36_300, days_overdue: 9, bucket: "1-30" })]);
  });

  it("a closed month cannot be posted into; a year close moves the result to retained earnings and locks the year", () => {
    const db = fresh();
    world(db);
    expect(closeMonth(db, "2026-11", "t", NOW).locked).toBe(true);
    const late = purchaseInvoice(db, { date: "2026-11-29", supplier: "Late", doc_ref: "L1", due_date: "2026-12-29", currency: "EUR", created_by: "t", lines: [{ account: "6100", net_cents: 100, vat_code: "P0" }] }, NOW);
    expect(late.posting_date).toBe("2026-12-01");
    const y = closeYear(db, 2026, "t", new Date("2027-01-05T09:00:00Z"));
    expect(y.locked_months).toHaveLength(12);
    expect(balanceOf(db, "3100")).toBe(-(70_000 - 100));
    // The year's own result still shows after the close (review of PR #108, finding 2): the closing entry is left out.
    expect(profitAndLoss(db, { from: "2026-01-01", to: "2026-12-31" }).EUR!.result_cents).toBe(70_000 - 100);
    expect(balanceSheet(db, "2026-12-31").EUR!.balanced).toBe(true);
    expect(() => closeYear(db, 2026, "t", new Date("2027-01-06T09:00:00Z"))).toThrow(/already closed/);
    expect(verifyLedger(db).ok).toBe(true);
  });
});

describe("stock at weighted average cost", () => {
  it("buys at two prices, sells at the average, and refuses to sell what is not there", () => {
    const db = fresh();
    buyGoods(db, { sku: "JKT-1", name: "Rain jacket", qty: 10, net_cents: 100_000, vat_code: "PRC_EU", supplier: "Bergtex Textil GmbH", doc_ref: "B1", date: "2026-11-01", due_date: "2026-12-01", currency: "EUR", created_by: "t" }, NOW);
    buyGoods(db, { sku: "JKT-1", name: "Rain jacket", qty: 10, net_cents: 140_000, vat_code: "PRC_EU", supplier: "Bergtex Textil GmbH", doc_ref: "B2", date: "2026-11-05", due_date: "2026-12-05", currency: "EUR", created_by: "t" }, NOW);
    expect(stockOnHand(db)).toEqual([{ sku: "JKT-1", name: "Rain jacket", currency: "EUR", qty: 20, value_cents: 240_000, average_cents: 12_000 }]);
    const s = sellGoods(db, { sku: "JKT-1", qty: 5, date: "2026-11-10", doc_ref: "NW-200", created_by: "t" }, NOW);
    expect(s.cost_cents).toBe(60_000);
    expect(balanceOf(db, "8000")).toBe(60_000);
    expect(balanceOf(db, "1700")).toBe(180_000);
    expect(stockOnHand(db)[0]).toMatchObject({ qty: 15, value_cents: 180_000 });
    expect(() => sellGoods(db, { sku: "JKT-1", qty: 16, date: "2026-11-11", doc_ref: "x", created_by: "t" }, NOW)).toThrow(LedgerRefused);
    expect(() => sellGoods(db, { sku: "NONE", qty: 1, date: "2026-11-11", doc_ref: "x", created_by: "t" }, NOW)).toThrow(LedgerRefused);
  });

  it("sells the last unit at exactly what is left, so stock value ends at zero", () => {
    const db = fresh();
    buyGoods(db, { sku: "S", name: "Sock", qty: 3, net_cents: 1_000, vat_code: "P21", supplier: "X", doc_ref: "1", date: "2026-11-01", due_date: "2026-12-01", currency: "EUR", created_by: "t" }, NOW);
    expect(sellGoods(db, { sku: "S", qty: 1, date: "2026-11-02", doc_ref: "a", created_by: "t" }, NOW).cost_cents).toBe(333);
    expect(sellGoods(db, { sku: "S", qty: 1, date: "2026-11-02", doc_ref: "b", created_by: "t" }, NOW).cost_cents).toBe(334);
    expect(sellGoods(db, { sku: "S", qty: 1, date: "2026-11-02", doc_ref: "c", created_by: "t" }, NOW).cost_cents).toBe(333);
    expect(stockOnHand(db)[0]).toMatchObject({ qty: 0, value_cents: 0 });
  });

  it("reversing a goods purchase takes the goods out of stock too, and refuses when they were sold", async () => {
    const { reverseEntry } = await import("../src/ledger/core.js");
    const db = fresh();
    const b1 = buyGoods(db, { sku: "A", name: "A", qty: 1000, net_cents: 100, vat_code: "P0", supplier: "X", doc_ref: "B1", date: "2026-11-01", due_date: "2026-12-01", currency: "EUR", created_by: "t" }, NOW);
    reverseEntry(db, b1.entry_id, "booked twice", "t", NOW);
    expect(balanceOf(db, "1700")).toBe(0);
    expect(stockOnHand(db)[0]).toMatchObject({ qty: 0, value_cents: 0 });
    expect(() => sellGoods(db, { sku: "A", qty: 1, date: "2026-11-02", doc_ref: "s", created_by: "t" }, NOW)).toThrow(LedgerRefused);
    const b2 = buyGoods(db, { sku: "A", name: "A", qty: 2, net_cents: 1_000, vat_code: "P0", supplier: "X", doc_ref: "B2", date: "2026-11-01", due_date: "2026-12-01", currency: "EUR", created_by: "t" }, NOW);
    sellGoods(db, { sku: "A", qty: 2, date: "2026-11-02", doc_ref: "s2", created_by: "t" }, NOW);
    expect(() => reverseEntry(db, b2.entry_id, "wrong", "t", NOW)).toThrow(LedgerRefused);
  });

  it("sells cheap stock whose share of the cost rounds to zero cents, once", () => {
    const db = fresh();
    buyGoods(db, { sku: "C", name: "Clip", qty: 1000, net_cents: 100, vat_code: "P0", supplier: "X", doc_ref: "B", date: "2026-11-01", due_date: "2026-12-01", currency: "EUR", created_by: "t" }, NOW);
    const s = sellGoods(db, { sku: "C", qty: 1, date: "2026-11-02", doc_ref: "s1", created_by: "t" }, NOW);
    expect(s.cost_cents).toBe(0);
    expect(sellGoods(db, { sku: "C", qty: 1, date: "2026-11-02", doc_ref: "s1", created_by: "t" }, NOW)).toMatchObject({ duplicate: true, cost_cents: 0 });
    expect(stockOnHand(db)[0]).toMatchObject({ qty: 999, value_cents: 100 });
    expect(sellGoods(db, { sku: "C", qty: 999, date: "2026-11-03", doc_ref: "s2", created_by: "t" }, NOW).cost_cents).toBe(100);
    expect(stockOnHand(db)[0]).toMatchObject({ qty: 0, value_cents: 0 });
    expect(balanceOf(db, "1700")).toBe(0);
  });
});

describe("settling and closing (review of PR #108)", () => {
  it("a retried payment with the same key is the same payment, not an error", () => {
    const db = fresh();
    purchaseInvoice(db, { date: "2026-10-05", supplier: "S", doc_ref: "S-1", due_date: "2026-11-04", currency: "EUR", created_by: "test", lines: [{ account: "6900", net_cents: 1_000, vat_code: "P0" }] }, NOW);
    const pay = { kind: "pay" as const, party: "S", doc_ref: "S-1", amount_cents: 1_000, currency: "EUR", bank: "1200", date: "2026-11-01", created_by: "test", source_key: "dep1" };
    const first = settleOpenItem(db, pay, NOW);
    expect(settleOpenItem(db, pay, NOW)).toEqual({ ...first, duplicate: true });
    expect(balanceOf(db, "1200")).toBe(-1_000);
  });

  it("closing a month closes every month before it", () => {
    const db = fresh();
    closeMonth(db, "2027-03", "t", NOW);
    const late = purchaseInvoice(db, { date: "2027-02-10", supplier: "L", doc_ref: "L1", due_date: "2027-03-10", currency: "EUR", created_by: "t", lines: [{ account: "6100", net_cents: 100, vat_code: "P0" }] }, NOW);
    expect(late.posting_date).toBe("2027-04-01");
  });
});
