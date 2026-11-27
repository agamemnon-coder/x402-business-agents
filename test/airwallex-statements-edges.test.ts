// Airwallex's statements and transfer words read strictly (src/airwallex/balanceHistory.ts, src/airwallex/deposits.ts,
// src/airwallex/approvals.ts): lines and deposits with fields left out read as zero or empty; a list without items, a
// full page without has_more and more pages than allowed stop with what is wrong; a currency asked for is sent; a
// deposit is labelled as one, never with its payer or reference (they are not recorded); the sandbox answering no
// deposit id is refused; every transfer status has its words, and a transfer Purser did not make is never followed. A
// recording stand-in; no network.
import { describe, expect, it } from "vitest";
import { describeTransferStatus, followTransfer, inAirwallexApproval } from "../src/airwallex/approvals.js";
import { listBalanceHistory, toBalanceLine } from "../src/airwallex/balanceHistory.js";
import { listDeposits, recordDeposits, settledDeposits, simulateDeposit, toDeposit } from "../src/airwallex/deposits.js";
import { openDb } from "../src/db/open.js";

const api = (...answers: unknown[]) => {
  const calls: { path: string; query?: Record<string, string> }[] = [];
  let i = 0;
  const call = async <T>(_m: string, path: string, _b?: unknown, query?: Record<string, string>): Promise<T> => { calls.push({ path, query }); return answers[Math.min(i++, answers.length - 1)] as T; };
  return { calls, call };
};
const W = { from: "2026-11-19T00:00:00Z", to: "2026-11-20T00:00:00Z" };

describe("the balance statement", () => {
  it("a line with fields left out reads as zero and empty", () => {
    expect(toBalanceLine({})).toEqual({ id: "", currency: "", amountCents: 0, balanceCents: 0, feeCents: 0, source: null, sourceType: "", transactionType: "", postedAt: "", description: "" });
  });

  it("asks for the currency given, refuses a list without items, and stops after ten pages", async () => {
    const one = api({ items: [], has_more: false });
    expect(await listBalanceHistory(one, { ...W, currency: "EUR" })).toEqual([]);
    expect(one.calls[0]!.query).toMatchObject({ currency: "EUR", from_post_at: W.from });
    await expect(listBalanceHistory(api({}), W)).rejects.toThrow("Airwallex's balance history came without items");
    const endless = api({ items: [{ id: "l" }], has_more: true, page_after: "next" });
    await expect(listBalanceHistory(endless, W)).rejects.toThrow(`more than 10 pages of balance history in ${W.from} … ${W.to}; narrow the window`);
    expect(endless.calls[1]!.query).toMatchObject({ page: "next" });
  });
});

describe("deposits", () => {
  it("one with fields left out reads as empty; a payer is read from either field", () => {
    expect(toDeposit({ id: "d1" })).toEqual({ id: "d1", globalAccountId: null, currency: "", amountCents: 0, status: "", payer: null, reference: null, createdAt: null });
    expect(toDeposit({ id: "d2", payer: { name: "Ridgeline" } }).payer).toBe("Ridgeline");
  });

  it("a list without items, a full page without has_more, and more than five pages are refused", async () => {
    await expect(listDeposits(api(null), W)).rejects.toThrow("Airwallex's deposits came without items");
    await expect(listDeposits(api({ items: Array.from({ length: 100 }, (_, i) => ({ id: `d${i}` })) }), W)).rejects.toThrow("Airwallex's deposits came as a full page without has_more; nothing is concluded");
    await expect(listDeposits(api({ items: [{ id: "d" }], has_more: true }), W)).rejects.toThrow(`more than 5 pages of deposits in ${W.from} … ${W.to}; narrow the window`);
  });

  it("a settled deposit is labelled as a deposit, never with its payer or reference: they are not recorded", () => {
    const db = openDb(":memory:");
    const d = (id: string, payer: string | null, reference: string | null) => ({ id, globalAccountId: "ga_1", currency: "USD", amountCents: 100, status: "SETTLED", payer, reference, createdAt: null });
    recordDeposits(db, [d("d1", null, null), d("d2", "Ridgeline", null), d("d3", null, "NW-1")]);
    expect(settledDeposits(db).map((x) => x.label)).toEqual(["deposit", "deposit", "deposit"]);
  });

  it("the sandbox answering no deposit id is refused", async () => {
    await expect(simulateDeposit(api({}), { globalAccountId: "ga_1", amount: "5.00", payer: "Ridgeline", reference: "NW-1" })).rejects.toThrow("the sandbox answered no deposit id");
    await expect(simulateDeposit(api(null), { globalAccountId: "ga_1", amount: "5.00", payer: "Ridgeline", reference: "NW-1" })).rejects.toThrow("the sandbox answered no deposit id");
  });
});

describe("a transfer's status in words", () => {
  it("every status Airwallex sends, and one it may send later", () => {
    expect(["IN_APPROVAL", "APPROVAL_REJECTED", "APPROVAL_RECALLED", "APPROVAL_BLOCKED", "SCHEDULED", "PROCESSING", "SENT", "PAID", "FAILED", "CANCELLED", "ON_HOLD"].map(describeTransferStatus)).toEqual([
      "waiting for Airwallex approval", "rejected in Airwallex's approval workflow; not paid", "recalled from Airwallex's approval workflow; not paid",
      "blocked in Airwallex's approval workflow (no next approver); not paid", "approved at Airwallex, scheduled", "processing at Airwallex", "sent by Airwallex", "paid",
      "failed at Airwallex; not paid", "cancelled; not paid", "on_hold",
    ]);
    expect([inAirwallexApproval("IN_APPROVAL"), inAirwallexApproval(null), inAirwallexApproval(undefined), inAirwallexApproval("PAID")]).toEqual([true, false, false, false]);
  });

  it("a transfer Purser did not make is never followed", async () => {
    const db = openDb(":memory:");
    let asked = false;
    await expect(followTransfer(db, { getTransfer: async () => { asked = true; throw new Error("no"); } }, "tr_unknown")).rejects.toThrow("transfer tr_unknown is not one Purser made; nothing is recorded");
    expect(asked).toBe(false);
  });
});
