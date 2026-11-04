import { describe, expect, it } from "vitest";
import { toCard, toCardTransaction } from "../src/airwallex/issuing.js";

// Shapes as the sandbox returned them on 2026-10-29 (ids shortened).
const listed = {
  billing_amount: -19.99, billing_currency: "EUR", card_id: "card-1",
  card_transaction_data: { card_transaction_event_id: "ev-1", card_transaction_id: "ct-1", card_transaction_lifecycle_id: "lc-1" },
  masked_card_number: "************8366", merchant: { category_code: "5734", name: "Datafeed SaaS Ltd________" },
  status: "PENDING", transaction_amount: -19.99, transaction_currency: "EUR", transaction_date: "2026-10-29T14:45:24.042+0000",
  transaction_id: "legacy-1", transaction_type: "AUTHORIZATION",
};
const simulatedDecline = {
  card_transaction_event_id: "ev-2", card_transaction_id: "ct-2", card_transaction_lifecycle_id: "lc-2", type: "AUTHORIZATION",
  process_result: "DECLINED", transacted_at: "2026-10-29T15:55:28.852+0000", card_id: "card-1", transaction_amount: 99,
  transaction_currency: "EUR", merchant: { name: "Probe____________________", category_code: "5734" }, failure_reason: "LIMIT_EXCEEDED",
};
const simulatedApproval = { ...simulatedDecline, card_transaction_id: "ct-3", process_result: "APPROVED", transaction_amount: 1.5, failure_reason: undefined };

describe("Airwallex Issuing shapes", () => {
  it("reads a listed transaction by its card transaction id, as a positive amount", () => {
    expect(toCardTransaction(listed as never)).toEqual({
      transactionId: "ct-1", legacyId: "legacy-1", cardId: "card-1", amountCents: 1999, currency: "EUR", status: "PENDING", approved: true,
      failureReason: null, merchant: "Datafeed SaaS Ltd", mcc: "5734", type: "AUTHORIZATION", occurredAt: "2026-10-29T14:45:24.042Z",
    });
  });
  it("reads the simulation's answer (a transaction event) the same way, declined or approved", () => {
    expect(toCardTransaction(simulatedDecline as never)).toMatchObject({ transactionId: "ct-2", amountCents: 9900, status: "DECLINED", approved: false, failureReason: "LIMIT_EXCEEDED", merchant: "Probe" });
    expect(toCardTransaction(simulatedApproval as never)).toMatchObject({ transactionId: "ct-3", amountCents: 150, status: "APPROVED", approved: true, failureReason: null });
  });
  it("keeps only the last four digits of a card", () => {
    const c = toCard({ card_id: "c", cardholder_id: "h", card_number: "************8366", card_status: "ACTIVE", nick_name: "n",
      authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: 50, interval: "PER_TRANSACTION" }, { amount: 100, interval: "MONTHLY" }] } } });
    expect(c).toEqual({ cardId: "c", cardholderId: "h", last4: "8366", status: "ACTIVE", nickname: "n", limits: { currency: "EUR", perTxCents: 5000, monthlyCents: 10000 },
      controls: { mccs: [], currencies: [], activeTo: null } });
  });
  it("reads the card's controls as the sandbox returned them on 2026-10-30", () => {
    const c = toCard({ card_id: "c", cardholder_id: "h", card_status: "ACTIVE", authorization_controls: { active_to: "2026-11-28T21:04:03.902+00:00", allowed_currencies: ["EUR"], allowed_merchant_categories: ["7311"],
      transaction_limits: { currency: "EUR", limits: [{ amount: 50, interval: "PER_TRANSACTION" }, { amount: 200, interval: "MONTHLY" }] } } } as never);
    expect(c.controls).toEqual({ mccs: ["7311"], currencies: ["EUR"], activeTo: "2026-11-28T21:04:03.902Z" });
  });
});
