import { beforeEach, describe, expect, it } from "vitest";
import { buyPlan } from "../src/agents/cardBuyer.js";
import { openDb, type DB } from "../src/db/open.js";
import { cardOf, ingestCardTransaction, setupCards } from "../src/policy/cards.js";
import { chargeUnderHold, heldCents, recoverHolds } from "../src/policy/holds.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const now = new Date("2026-11-03T10:00:00Z");
const holds = (db: DB) => db.prepare("SELECT agent, rail, cents, status, reason FROM holds ORDER BY created_at, cents").all();

describe("card holds", () => {
  let db: DB;
  let awx: FakeIssuing;
  beforeEach(async () => {
    db = openDb(":memory:");
    awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
  });

  it("settles the hold of an approved purchase and releases the one Airwallex declines (its limit stays the issuer's)", async () => {
    expect(await buyPlan(db, awx, "packwise-starter", now)).toMatchObject({ approved: true });
    // Over the card's limit: still sent to Airwallex, which declines it; the ledger does not decide it first.
    expect(await buyPlan(db, awx, "packwise-pro", now)).toMatchObject({ approved: false, failureReason: "LIMIT_EXCEEDED" });
    expect(holds(db)).toEqual([
      { agent: "sourcing", rail: "card", cents: 1999, status: "SETTLED", reason: null },
      { agent: "sourcing", rail: "card", cents: 4500, status: "RELEASED", reason: "declined by Airwallex: LIMIT_EXCEEDED" },
    ]);
    expect(heldCents(db, "sourcing", "card")).toBe(0);
  });

  it("charges nothing for a stopped agent", async () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('stop.sourcing', 'on', ?)").run(now.toISOString());
    let charged = false;
    await expect(chargeUnderHold(db, "sourcing", 1999, now, async () => { charged = true; throw new Error("not reached"); })).rejects.toThrow(/stopped/);
    expect(charged).toBe(false);
    expect(holds(db)).toEqual([]);
  });

  it("keeps the hold when the charge fails midway, and resolves it on restart from the card's transactions", async () => {
    await expect(chargeUnderHold(db, "sourcing", 1999, now, async () => { throw new Error("connection reset"); })).rejects.toThrow(/connection reset/);
    expect(heldCents(db, "sourcing", "card")).toBe(1999);
    expect(recoverHolds(db, now)).toEqual({ settled: 0, released: 0, open: 1 });
    // The authorisation did happen: the card's transactions show it.
    const card = cardOf(db, "sourcing")!;
    const t = await awx.simulateCardCharge({ cardId: card.card_id, amountCents: 1999, currency: "EUR", merchant: "Packwise", mcc: "5734" });
    ingestCardTransaction(db, t, "simulation", now);
    expect(recoverHolds(db, now)).toEqual({ settled: 1, released: 0, open: 0 });
    expect(heldCents(db, "sourcing", "card")).toBe(0);
  });
});
