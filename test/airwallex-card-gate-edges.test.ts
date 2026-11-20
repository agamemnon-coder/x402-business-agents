// The kit11 Worker's card gate (src/airwallex/cardGate.ts), shape by shape: limits that are not EUR, not exactly two,
// or carry anything besides an amount and an interval are refused; a write without a JSON body, a simulated purchase of
// another shape, a cardholder who is not a delegate and an allowed path with no known write are refused; what leaves the
// Worker about a card or a transaction keeps the last four digits only and falls back field by field to what Airwallex
// sends. Pure functions; no network.
import { describe, expect, it } from "vitest";
import { cardCallCheck, last4Of, safeCard, safeTx } from "../src/airwallex/cardGate.js";

const limits = (over: Record<string, unknown> = {}) => ({ currency: "EUR", limits: [{ amount: 100, interval: "PER_TRANSACTION" }, { amount: 500, interval: "MONTHLY" }], ...over });
const create = (tl: unknown) => ({ request_id: "req_0123456789abcdef", form_factor: "VIRTUAL", authorization_controls: { transaction_limits: tl } });
const refusedWith = (r: ReturnType<typeof cardCallCheck>) => ("refused" in r ? r.refused : "allowed");

describe("the limits a new card may carry", () => {
  it("EUR, one per purchase and one a month, each only an amount and an interval", () => {
    expect(refusedWith(cardCallCheck("POST", "/issuing/cards/create", create(limits())))).toBe("allowed");
    const bad = "a new card needs EUR limits within the ceilings";
    expect(refusedWith(cardCallCheck("POST", "/issuing/cards/create", create(limits({ currency: "USD" }))))).toBe(bad);
    expect(refusedWith(cardCallCheck("POST", "/issuing/cards/create", create(limits({ limits: [{ amount: 100, interval: "PER_TRANSACTION" }] }))))).toBe(bad);
    expect(refusedWith(cardCallCheck("POST", "/issuing/cards/create", create(limits({ limits: "two" }))))).toBe(bad);
    expect(refusedWith(cardCallCheck("POST", "/issuing/cards/create", create(null)))).toBe(bad);
    expect(refusedWith(cardCallCheck("POST", "/issuing/cards/create", create(limits({ limits: [{ amount: 100, interval: "PER_TRANSACTION", note: "x" }, { amount: 500, interval: "MONTHLY" }] }))))).toBe(bad);
    expect(refusedWith(cardCallCheck("POST", "/issuing/cards/create", create(limits({ limits: ["100", { amount: 500, interval: "MONTHLY" }] }))))).toBe(bad);
  });
});

describe("writes", () => {
  it("a read with a body, and a write without a JSON body, are refused", () => {
    expect(refusedWith(cardCallCheck("GET", "/issuing/cards", {}))).toBe("a read carries no body");
    expect(refusedWith(cardCallCheck("POST", "/issuing/cardholders/create"))).toBe("a write needs a JSON body");
    expect(refusedWith(cardCallCheck("POST", "/issuing/cardholders/create", [1]))).toBe("a write needs a JSON body");
  });

  it("a simulated purchase has a fixed shape", () => {
    expect(refusedWith(cardCallCheck("POST", "/simulation/issuing/create", { card_id: "c1", transaction_amount: 1 }))).toBe("a simulated purchase has a fixed shape");
    expect(refusedWith(cardCallCheck("POST", "/simulation/issuing/create", { card_id: "c1", transaction_amount: 12.5, transaction_currency: "EUR", merchant_category_code: "5734", merchant_info: "Packwise" }))).toBe("allowed");
  });

  it("only a delegate cardholder", () => {
    expect(refusedWith(cardCallCheck("POST", "/issuing/cardholders/create", { type: "DELEGATE" }))).toBe("allowed");
    expect(refusedWith(cardCallCheck("POST", "/issuing/cardholders/create", { type: "INDIVIDUAL" }))).toBe("only a delegate cardholder (an agent)");
  });
});

describe("what leaves the Worker", () => {
  it("the last four digits of a number, or none", () => {
    expect(last4Of("4111 1111 1111 4242")).toBe("4242");
    expect(last4Of("•••• 42")).toBeNull();
    expect(last4Of(4242)).toBeNull();
  });

  it("a card with its status under either name, or UNKNOWN", () => {
    expect(safeCard({ id: "c_1", status: "ACTIVE" })).toMatchObject({ card_id: "c_1", status: "ACTIVE", last4: null, limits: null });
    expect(safeCard({ card_id: "c_1" })).toMatchObject({ status: "UNKNOWN" });
    expect(safeCard({ card_id: "c_1", authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ interval: "PER_TRANSACTION", amount: "1e3" }, { interval: "MONTHLY", amount: 5 }] } } }))
      .toMatchObject({ limits: null });
  });

  it("a transaction from its billing fields when the transaction's are missing; nothing without an id, a card or a time", () => {
    expect(safeTx(null)).toBeNull();
    const t = safeTx({ id: "tx_1", card_id: "c_1", created_at: "2026-11-19T10:00:00Z", billing_amount: "-12.50", billing_currency: "EUR", process_result: "APPROVED", type: "AUTHORIZATION", merchant: { name: "Packwise__", category_code: "5734" } });
    expect(t).toEqual({ id: "tx_1", card_id: "c_1", at: "2026-11-19T10:00:00Z", amount_cents: 1250, currency: "EUR", status: "APPROVED", approved: true, failure_reason: null, merchant: "Packwise", mcc: "5734", type: "AUTHORIZATION" });
    expect(safeTx({ transaction_id: "tx_2", card_id: "c_1", transacted_at: "2026-11-19T10:00:00Z", transaction_amount: 3, transaction_currency: "EUR", failure_reason: "CARD_INACTIVE" }))
      .toMatchObject({ id: "tx_2", status: "DECLINED", approved: false, failure_reason: "CARD_INACTIVE", merchant: null, type: null });
    expect(safeTx({ id: "tx_3", card_id: "c_1", transaction_date: "2026-11-19", transaction_amount: "a lot", transaction_currency: "EUR" })).toBeNull();
    expect(safeTx({ id: "tx_4", card_id: "c_1", transaction_amount: 3, transaction_currency: "EUR" })).toBeNull();
  });
});
