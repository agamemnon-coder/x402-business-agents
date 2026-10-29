// Velocity limits (security item 2): an agent that pays too often or too much in a short time is stopped by code,
// on its own, and only the CFO's Face ID lifts the stop. The other agents keep working.
import { beforeEach, describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { ingestCardTransaction, setupCards, syncCardsIfChanged } from "../src/policy/cards.js";
import { capRefusal, loosens } from "../src/policy/rules.js";
import { policyLoosens } from "../src/approve/client.js";
import { stopped, velocityGate, velocityObserve } from "../src/policy/velocity.js";
import { VELOCITY } from "../src/config/policy.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { executeSweep } from "../src/agents/sweep.js";
import { buyPlan } from "../src/agents/cardBuyer.js";

const t0 = new Date("2026-11-03T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const events = (db: DB, e: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(e) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);

function approveAndRun(db: DB, id: string, now: Date) {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
  executePolicyChange(db, id, now);
}

describe("velocity limits", () => {
  let db: DB;
  beforeEach(() => { db = openDb(":memory:"); });

  it("lets payments under the limits through and counts them", () => {
    for (let i = 0; i < VELOCITY.sourcing.perMinute; i++) expect(velocityGate(db, "sourcing", "metal", 4, at(i * 100))).toBeNull();
    expect(stopped(db, "sourcing")).toBe(false);
    expect((db.prepare("SELECT COUNT(*) AS n FROM velocity_events WHERE agent = 'sourcing'").get() as { n: number }).n).toBe(VELOCITY.sourcing.perMinute);
  });

  it("stops the agent on one payment too many in a minute, and refuses everything it tries after that", () => {
    const max = VELOCITY.sourcing.perMinute;
    for (let i = 0; i < max; i++) velocityGate(db, "sourcing", "metal", 4, at(i * 100));
    const r = velocityGate(db, "sourcing", "metal", 4, at(max * 100));
    expect(r).toMatch(new RegExp(`^velocity_exceeded: ${max + 1} payments in a minute, the limit is ${max}`));
    expect(stopped(db, "sourcing")).toBe(true);
    expect(events(db, "velocity.tripped")).toEqual([expect.objectContaining({ agent: "sourcing", rail: "metal", reason: expect.stringMatching(/payments in a minute/) })]);
    // Stopped: refused before signing, by the gate and by the policy check, also an hour later.
    expect(velocityGate(db, "sourcing", "metal", 1, at(3_600_000))).toMatch(/^stopped_by_velocity/);
    expect(capRefusal(db, "sourcing", 1)).toMatch(/^stopped_by_velocity/);
    // The refused payment was not counted as made.
    expect((db.prepare("SELECT COUNT(*) AS n FROM velocity_events WHERE agent = 'sourcing'").get() as { n: number }).n).toBe(max);
    // The other agents keep working.
    expect(capRefusal(db, "support", 1)).toBeNull();
    expect(velocityGate(db, "treasury", "metal", 100, at(max * 100))).toBeNull();
  });

  it("counts a minute as a sliding window", () => {
    const max = VELOCITY.sourcing.perMinute;
    for (let i = 0; i < max; i++) velocityGate(db, "sourcing", "metal", 4, at(i * 1000));
    expect(velocityGate(db, "sourcing", "metal", 4, at(60_000 + 1))).toBeNull();
    expect(stopped(db, "sourcing")).toBe(false);
  });

  it("stops the agent when its amount in an hour goes over the limit", () => {
    const limit = VELOCITY.treasury.usdzPerHourCents;
    expect(velocityGate(db, "treasury", "metal", limit - 100, at(0))).toBeNull();
    expect(velocityGate(db, "treasury", "metal", 100, at(10 * 60_000))).toBeNull();
    const r = velocityGate(db, "treasury", "metal", 1, at(20 * 60_000));
    expect(r).toMatch(/^velocity_exceeded: .* in an hour, the limit is /);
    expect(stopped(db, "treasury")).toBe(true);
  });

  it("watches card charges as Airwallex reports them, and freezes only that agent's card at Airwallex", async () => {
    const awx = new FakeIssuing();
    awx.clock = () => t0.getTime();
    await setupCards(db, awx, t0);
    const limit = VELOCITY.support.eurPerHourCents;
    expect(velocityObserve(db, "support", limit, true, at(0))).toBeNull();
    // A declined attempt moves no money and is not counted (else anyone with the card number could stop the agent).
    expect(velocityObserve(db, "support", 9999, false, at(1000))).toBeNull();
    expect(velocityObserve(db, "support", 1, true, at(2000))).toMatch(/^velocity_exceeded: .* in an hour/);
    expect(stopped(db, "support")).toBe(true);
    expect(await syncCardsIfChanged(db, awx, at(3000))).toEqual(["support"]);
    const support = db.prepare("SELECT card_id FROM cards WHERE agent = 'support'").get() as { card_id: string };
    expect(awx.cards.find((c) => c.cardId === support.card_id)!.status).toBe("INACTIVE");
    expect(awx.cards.filter((c) => c.status === "ACTIVE")).toHaveLength(2);
  });

  it("is fed by every card transaction the runner ingests", async () => {
    const awx = new FakeIssuing();
    awx.clock = () => t0.getTime();
    await setupCards(db, awx, t0);
    const card = db.prepare("SELECT card_id FROM cards WHERE agent = 'treasury'").get() as { card_id: string };
    for (let i = 0; i <= VELOCITY.treasury.perMinute; i++) {
      // Different amounts: the same card, amount and moment would be one authorisation reported twice.
      const t = await awx.simulateCardCharge({ cardId: card.card_id, amountCents: 100 + i, currency: "EUR", merchant: "Ledgerly", mcc: "5734" });
      ingestCardTransaction(db, t, "simulation", at(i * 1000));
    }
    expect(stopped(db, "treasury")).toBe(true);
  });

  it("refuses a stopped agent's Metal payment before anything is signed", async () => {
    for (let i = 0; i <= VELOCITY.treasury.perMinute; i++) velocityGate(db, "treasury", "metal", 1, at(i * 100));
    // No chain is reachable in this test: a refusal must come before any call to it.
    const r = await executeSweep(db, "sweep-1", 100, "0x00000000000000000000000000000000000000aa");
    expect(r).toMatchObject({ outcome: "REFUSED", tx: null, reason: expect.stringMatching(/^stopped_by_velocity/) });
  });

  it("catches a burst that is reported out of order", () => {
    const max = VELOCITY.treasury.perMinute;
    // Later charges reported first (a poll holds back fresh approvals; webhooks come in any order).
    for (let i = 1; i <= max; i++) expect(velocityObserve(db, "treasury", 100, true, at(i * 10_000))).toBeNull();
    expect(velocityObserve(db, "treasury", 100, true, at(5_000))).toMatch(/payments in a minute/);
    expect(stopped(db, "treasury")).toBe(true);
  });

  it("never stops an agent on declined card attempts alone", () => {
    for (let i = 0; i < 50; i++) expect(velocityObserve(db, "treasury", 100, false, at(i * 100))).toBeNull();
    expect(stopped(db, "treasury")).toBe(false);
  });

  it("counts a retry under the same payment id once", () => {
    for (let i = 0; i < 20; i++) expect(velocityGate(db, "support", "metal", 7, at(i * 100), "refund-42")).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM velocity_events").get() as { n: number }).n).toBe(1);
  });

  it("keeps a sweep that was already sent as it is when the agent is stopped, so it is never swept twice", async () => {
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES ('sweep-1', 100, 'PENDING', ?)").run(t0.toISOString());
    for (let i = 0; i <= VELOCITY.treasury.perMinute; i++) velocityGate(db, "treasury", "metal", 1, at(i * 100));
    const r = await executeSweep(db, "sweep-1", 100, "0x00000000000000000000000000000000000000aa");
    expect(r).toMatchObject({ outcome: "PENDING", reason: expect.stringMatching(/^stopped_by_velocity/) });
    expect(db.prepare("SELECT outcome FROM sweeps WHERE payment_id = 'sweep-1'").get()).toEqual({ outcome: "PENDING" });
  });

  it("refuses a stopped agent's card purchase in code, before the card is frozen at Airwallex", async () => {
    const awx = new FakeIssuing();
    awx.clock = () => t0.getTime();
    await setupCards(db, awx, t0);
    for (let i = 0; i <= VELOCITY.sourcing.perMinute; i++) velocityGate(db, "sourcing", "metal", 1, at(i * 100));
    await expect(buyPlan(db, awx, "packwise-starter", at(5000))).rejects.toThrow(/stopped automatically/);
    expect(awx.txs).toHaveLength(0);
  });

  it("is lifted only by an approved policy change: a loosening, which the phone never sends", () => {
    for (const f of [loosens, policyLoosens]) {
      expect(f({ key: "stop.sourcing", from: "off", to: "on" })).toBe(false);
      expect(f({ key: "stop.sourcing", from: "on", to: "off" })).toBe(true);
    }
    for (let i = 0; i <= VELOCITY.sourcing.perMinute; i++) velocityGate(db, "sourcing", "metal", 4, at(i * 100));
    expect(stopped(db, "sourcing")).toBe(true);
    const s = buildSnapshot(db, at(10_000));
    expect(s.stopped).toEqual([expect.objectContaining({ agent: "sourcing", reason: expect.stringMatching(/payments in a minute/) })]);
    const p = proposePolicyChange(db, { changes: [{ key: "stop.sourcing", to: "off" }], reason: "checked: a retry loop, fixed" }, "human", at(20_000));
    approveAndRun(db, p.proposal_id, at(30_000));
    expect(stopped(db, "sourcing")).toBe(false);
    expect(buildSnapshot(db, at(40_000)).stopped).toEqual([]);
    // Lifted, the agent starts from a clean minute: the old burst does not trip it again.
    expect(velocityGate(db, "sourcing", "metal", 4, at(40_000))).toBeNull();
  });
});
