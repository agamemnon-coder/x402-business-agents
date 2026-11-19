// Freeze by default (19 Nov, red team hidden-payment). An agent's card is INACTIVE at Airwallex except for the moments
// Purser opens a window for a purchase it approved under the policy: thawed for that one charge, frozen again as soon
// as Airwallex answers, or when the window runs out, whichever comes first. A charge that reaches the card outside a
// window (a merchant or a leaked card number charging it by itself) is declined by Airwallex with CARD_INACTIVE: no
// money moves, so there is nothing for the reconciliation to find afterwards.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { buyPlan } from "../src/agents/cardBuyer.js";
import { CARD_WINDOW_MS, cardOf, chargeInWindow, ingestCardTransaction, openCardWindow, setupCards, syncCardsIfChanged, wantCardStatus } from "../src/policy/cards.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { ATTACKS, runAttack } from "../src/redteam/attacks.js";
import { redTeamWorld } from "../src/redteam/world.js";

const t0 = new Date("2026-11-03T10:00:00Z");
const events = (db: DB, e: string) => (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?").get(e) as { n: number }).n;

describe("agent cards are frozen by default", () => {
  let db: DB;
  let awx: FakeIssuing;
  let at: number;
  const now = () => new Date(at);
  beforeEach(async () => {
    at = t0.getTime();
    db = openDb(":memory:");
    awx = new FakeIssuing();
    awx.clock = () => at;
    await setupCards(db, awx, now());
  });

  it("issues every agent's card frozen at Airwallex, and the ledger and the policy agree", () => {
    expect(awx.cards.map((c) => c.status)).toEqual(["INACTIVE", "INACTIVE", "INACTIVE"]);
    for (const a of ["sourcing", "support", "treasury"]) {
      expect(cardOf(db, a)!.status).toBe("INACTIVE");
      expect(wantCardStatus(db, a, now())).toBe("INACTIVE");
    }
  });

  it("declines a charge Purser did not open a window for, before any money moves", async () => {
    const card = cardOf(db, "sourcing")!;
    const t = await awx.simulateCardCharge({ cardId: card.card_id, amountCents: 4200, currency: "EUR", merchant: "Somewhere", mcc: "5734" });
    expect(t).toMatchObject({ approved: false, failureReason: "CARD_INACTIVE" });
  });

  it("thaws the card for an approved purchase only, then freezes it again right after Airwallex answers", async () => {
    const t = await buyPlan(db, awx, "packwise-starter", now());
    expect(t.approved).toBe(true);
    expect(awx.cards[0]!.status).toBe("INACTIVE");
    expect(cardOf(db, "sourcing")!.status).toBe("INACTIVE");
    expect(events(db, "card.window_opened")).toBe(1);
    expect(events(db, "card.window_closed")).toBe(1);
    // The order at Airwallex: thawed, charged, frozen.
    expect(awx.calls.slice(-3)).toEqual(["setCardStatus", "charge", "setCardStatus"]);
    // A merchant charging again a moment later meets a frozen card.
    const again = await awx.simulateCardCharge({ cardId: awx.cards[0]!.cardId, amountCents: 1900, currency: "EUR", merchant: "Packwise", mcc: "5734" });
    expect(again).toMatchObject({ approved: false, failureReason: "CARD_INACTIVE" });
  });

  it("keeps Airwallex's own decline inside a window (over the limit is still LIMIT_EXCEEDED) and refreezes after it", async () => {
    const card = cardOf(db, "sourcing")!;
    const t = await chargeInWindow(db, awx, "sourcing", { cardId: card.card_id, amountCents: card.per_tx_cents + 1, currency: "EUR", merchant: "Packwise", mcc: "5734" }, now());
    expect(t).toMatchObject({ approved: false, failureReason: "LIMIT_EXCEEDED" });
    expect(awx.cards[0]!.status).toBe("INACTIVE");
  });

  it("refreezes when a window runs out, even if the purchase never came back (a crash mid-purchase)", async () => {
    await openCardWindow(db, awx, "sourcing", { amountCents: 1900, merchant: "Packwise", why: "test" }, now());
    expect(awx.cards[0]!.status).toBe("ACTIVE");
    expect(wantCardStatus(db, "sourcing", now())).toBe("ACTIVE");
    // The runner's sync inside the window leaves it open.
    expect(await syncCardsIfChanged(db, awx, now())).toEqual([]);
    at += CARD_WINDOW_MS + 1000;
    expect(wantCardStatus(db, "sourcing", now())).toBe("INACTIVE");
    expect(await syncCardsIfChanged(db, awx, now())).toEqual(["sourcing"]);
    expect(awx.cards[0]!.status).toBe("INACTIVE");
  });

  it("closes the window and refreezes on any authorisation it did not expect", async () => {
    await openCardWindow(db, awx, "sourcing", { amountCents: 1900, merchant: "Packwise", why: "test" }, now());
    // A different charge lands on the thawed card (a race inside the window) and arrives by webhook.
    const raced = await awx.simulateCardCharge({ cardId: awx.cards[0]!.cardId, amountCents: 1000, currency: "EUR", merchant: "Somewhere", mcc: "5734" });
    expect(raced.approved).toBe(true);
    ingestCardTransaction(db, raced, "webhook", now());
    expect(events(db, "card.unexpected_authorization")).toBe(1);
    expect(wantCardStatus(db, "sourcing", now())).toBe("INACTIVE");
    expect(await syncCardsIfChanged(db, awx, now())).toEqual(["sourcing"]);
    expect(awx.cards[0]!.status).toBe("INACTIVE");
  });

  it("does not open a window while the policy has the card frozen (the emergency stop wins)", async () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(now().toISOString());
    const card = cardOf(db, "sourcing")!;
    const t = await chargeInWindow(db, awx, "sourcing", { cardId: card.card_id, amountCents: 1900, currency: "EUR", merchant: "Packwise", mcc: "5734" }, now());
    expect(t).toMatchObject({ approved: false, failureReason: "CARD_INACTIVE" });
    expect(events(db, "card.window_opened")).toBe(0);
  });
});

describe("the red team's hidden-payment attack", () => {
  it("is refused before money moves, not found afterwards", async () => {
    const attack = ATTACKS.find((a) => a.id === "hidden-payment")!;
    const r = await runAttack(await redTeamWorld(), attack);
    expect(r.outcome).toBe("blocked");
    expect(r.caught).toBe("before");
    expect(r.evidence).toMatch(/CARD_INACTIVE/);
  });
});
