// Ask Purser (G), step 2: single-use cards at the Issuing port, and a task card's limits in the CFO policy.
import { describe, expect, it } from "vitest";
import { toCard } from "../src/airwallex/issuing.js";
import { openDb } from "../src/db/open.js";
import { cardControls } from "../src/policy/cards.js";
import { cardLimits, policyValue } from "../src/policy/rules.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const now = new Date("2026-10-30T10:00:00Z");

describe("single-use cards", () => {
  it("reads SINGLE back from Airwallex as single-use, and MULTIPLE as not", () => {
    const base = { card_id: "c", cardholder_id: "h", card_status: "ACTIVE", authorization_controls: { allowed_merchant_categories: ["4511"], allowed_currencies: ["EUR"] } };
    expect(toCard({ ...base, authorization_controls: { ...base.authorization_controls, allowed_transaction_count: "SINGLE" } }).controls?.singleUse).toBe(true);
    expect(toCard({ ...base, authorization_controls: { ...base.authorization_controls, allowed_transaction_count: "MULTIPLE" } }).controls?.singleUse).toBeUndefined();
  });

  // The fake declines a second approved charge on a single-use card, as Airwallex documents ("only 1 successful
  // debit transaction"); the decline reason is a placeholder until the sandbox shows its own.
  it("the fake declines a second charge on a single-use card, and a declined first try does not use it up", async () => {
    const awx = new FakeIssuing();
    const card = await awx.createCard({ cardholderId: "h", nickname: "t", createdBy: "x", limits: { currency: "EUR", perTxCents: 25000, monthlyCents: 25000 }, controls: { mccs: ["4511"], currencies: ["EUR"], activeTo: null, singleUse: true } });
    expect(card.controls?.singleUse).toBe(true);
    expect((await awx.simulateCardCharge({ cardId: card.cardId, amountCents: 30000, currency: "EUR", merchant: "Skyline Air", mcc: "4511" })).approved).toBe(false);
    expect((await awx.simulateCardCharge({ cardId: card.cardId, amountCents: 18900, currency: "EUR", merchant: "Skyline Air", mcc: "4511" })).approved).toBe(true);
    const again = await awx.simulateCardCharge({ cardId: card.cardId, amountCents: 1000, currency: "EUR", merchant: "Skyline Air", mcc: "4511" });
    expect(again).toMatchObject({ approved: false, failureReason: "SINGLE_USE_SPENT" });
  });
});

describe("a task card in the CFO policy", () => {
  it("has limits equal to the approved amount and the task's controls, single-use, until its end", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO task_cards (task_id, proposal_id, kind, purpose, mccs, amount_cents, valid_until, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)")
      .run("task:P-0007", "P-0007", "flight", "Berlin trade fair", "4511", 25000, "2026-11-12T23:59:59.000Z", now.toISOString());
    expect(cardLimits(db, "task:P-0007")).toEqual({ currency: "EUR", perTxCents: 25000, monthlyCents: 25000 });
    expect(policyValue(db, "stop.task:P-0007")).toBe("off");
    expect(cardControls("task:P-0007", now, db)).toEqual({ mccs: ["4511"], currencies: ["EUR"], activeTo: "2026-11-12T23:59:59.000Z", singleUse: true });
  });
});
