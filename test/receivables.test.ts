// The receivables agent (awards item 5): retailers pay Northwind's Airwallex Global Accounts; each payment is matched
// to its invoice by reference, booked once, and anything off (short, over, another currency, no invoice) is escalated.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { matchReceipt, openReceivable, receivablesView } from "../src/agents/receivables.js";
import { books } from "../src/accounting/books.js";

const at = (s: string) => new Date(`2026-10-30T${s}Z`);
function world() {
  const db = openDb(":memory:");
  openReceivable(db, { invoice_no: "NW-R-101", customer: "Alpenweg Sport AG", currency: "EUR", amount_cents: 124_000, due_date: "2026-11-29" }, at("09:00:00"));
  openReceivable(db, { invoice_no: "NW-R-102", customer: "Fellside Outdoor Ltd", currency: "GBP", amount_cents: 86_050, due_date: "2026-11-29" }, at("09:00:00"));
  openReceivable(db, { invoice_no: "NW-R-103", customer: "Kustlijn Buitensport BV", currency: "EUR", amount_cents: 51_000, due_date: "2026-11-29" }, at("09:00:00"));
  return db;
}
const dep = (id: string, currency: string, cents: number, reference: string) => ({ deposit_id: id, global_account_id: "ga", currency, amount_cents: cents, reference, payer: "a retailer", received_at: "2026-10-30T10:00:00Z" });

describe("the receivables agent", () => {
  it("matches an exact payment by its reference, even written differently, and books it once", () => {
    const db = world();
    expect(matchReceipt(db, dep("d1", "EUR", 124_000, "Payment nw-r-101 thanks"), at("10:00:00")).outcome).toBe("MATCHED");
    expect(matchReceipt(db, dep("d1", "EUR", 124_000, "Payment nw-r-101 thanks"), at("10:01:00")).outcome).toBe("MATCHED");
    expect(db.prepare("SELECT COUNT(*) AS n FROM receipts").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT status, paid_cents FROM receivables WHERE invoice_no = 'NW-R-101'").get()).toEqual({ status: "PAID", paid_cents: 124_000 });
  });

  it("escalates a short payment, an overpayment, another currency and a payment with no invoice", () => {
    const db = world();
    expect(matchReceipt(db, dep("d2", "EUR", 50_000, "NW-R-103"), at("10:00:00"))).toMatchObject({ outcome: "SHORT", detail: expect.stringMatching(/short by 10\.00 EUR/) });
    expect(matchReceipt(db, dep("d3", "EUR", 86_050, "NW-R-102"), at("10:00:00"))).toMatchObject({ outcome: "WRONG_CURRENCY" });
    expect(matchReceipt(db, dep("d4", "GBP", 90_000, "NW-R-102"), at("10:00:00"))).toMatchObject({ outcome: "OVER", detail: expect.stringMatching(/over by 39\.50 GBP/) });
    expect(matchReceipt(db, dep("d5", "EUR", 2_500, "deposit"), at("10:00:00"))).toMatchObject({ outcome: "UNMATCHED" });
    const v = receivablesView(db);
    expect(v.escalated).toBe(4);
    expect(v.open.map((r) => r.invoice_no)).toEqual(["NW-R-101", "NW-R-103"]);
  });

  it("books matched payments as wholesale revenue and unknown ones to suspense, per currency, balanced", () => {
    const db = world();
    matchReceipt(db, dep("d1", "EUR", 124_000, "NW-R-101"), at("10:00:00"));
    matchReceipt(db, dep("d4", "GBP", 86_050, "NW-R-102"), at("10:00:00"));
    matchReceipt(db, dep("d5", "EUR", 2_500, "deposit"), at("10:00:00"));
    const b = books(db);
    expect(b.balanced).toBe(true);
    const bal = (acc: string, cur: string) => b.trial.find((t) => t.account === acc && t.currency === cur)?.balance_cents;
    expect(bal("4200", "EUR")).toBe(-124_000);
    expect(bal("4200", "GBP")).toBe(-86_050);
    expect(bal("2900", "EUR")).toBe(-2_500);
    expect(bal("1202", "GBP")).toBe(86_050);
  });
});
