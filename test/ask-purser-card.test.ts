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

  // The fake declines a second charge on a single-use card as the sandbox did live on 30 October: the card is closed
  // after its one successful debit, and later charges get CARD_CLOSED.
  it("the fake declines a second charge on a single-use card, and a declined first try does not use it up", async () => {
    const awx = new FakeIssuing();
    const card = await awx.createCard({ cardholderId: "h", nickname: "t", createdBy: "x", limits: { currency: "EUR", perTxCents: 25000, monthlyCents: 25000 }, controls: { mccs: ["4511"], currencies: ["EUR"], activeTo: null, singleUse: true } });
    expect(card.controls?.singleUse).toBe(true);
    expect((await awx.simulateCardCharge({ cardId: card.cardId, amountCents: 30000, currency: "EUR", merchant: "Skyline Air", mcc: "4511" })).approved).toBe(false);
    expect((await awx.simulateCardCharge({ cardId: card.cardId, amountCents: 18900, currency: "EUR", merchant: "Skyline Air", mcc: "4511" })).approved).toBe(true);
    const again = await awx.simulateCardCharge({ cardId: card.cardId, amountCents: 1000, currency: "EUR", merchant: "Skyline Air", mcc: "4511" });
    expect(again).toMatchObject({ approved: false, failureReason: "CARD_CLOSED" });
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

describe("a used single-use card, as the Airwallex sandbox handles it (live check, 30 October)", () => {
  // Live: SINGLE was accepted and read back; after one approved charge Airwallex closed the card itself, declined a
  // second charge with CARD_CLOSED, and refused to set the closed card INACTIVE (400 invalid_argument).
  it("closes itself after one purchase; Purser records it closed and does not try to freeze it", async () => {
    const { askPurser, bookOnTaskCard } = await import("../src/agents/askPurser.js");
    const { ClaudeReader } = await import("../src/claude/reader.js");
    const { Tools } = await import("../src/claude/tools.js");
    const { openDb } = await import("../src/db/open.js");
    const { cardOf, syncCards, syncCardsIfChanged } = await import("../src/policy/cards.js");
    const { FakeIssuing } = await import("../src/redteam/issuing.js");
    const now = new Date("2026-10-30T10:00:00Z");
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const { taskId } = await askPurser(db, new Tools(db, new ClaudeReader(db, null)), "Flight to Berlin, at most €150", now, { rail: awx, from: "runner" });
    expect((await bookOnTaskCard(db, awx, taskId!, { merchant: "Skyline Air", amount: "120.00" }, now, awx)).approved).toBe(true);
    expect(awx.cards[0]?.status).toBe("CLOSED");
    expect(cardOf(db, taskId!)?.status).toBe("CLOSED");
    expect(await bookOnTaskCard(db, awx, taskId!, { merchant: "Skyline Air", amount: "20.00" }, now)).toMatchObject({ approved: false, failureReason: "CARD_CLOSED" });
    expect(awx.calls.filter((c) => c === "setCardStatus")).toHaveLength(0);
    // The runner's card sync leaves a closed card alone: nothing can change it.
    expect(await syncCardsIfChanged(db, awx, now)).toEqual([]);
    await expect(syncCards(db, awx, now)).resolves.toEqual([]);
  });
});
