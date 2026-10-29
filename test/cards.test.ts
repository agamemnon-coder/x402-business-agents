import { beforeEach, describe, expect, it } from "vitest";
import { buyPlan, proposeCardRaise } from "../src/agents/cardBuyer.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { cardSpendCents, ingestCardTransaction, pollCardTransactions, setupCards, syncCardsAfterPolicy, syncCards, syncCardsIfChanged } from "../src/policy/cards.js";
import { FakeIssuing } from "./fakes/issuing.js";

const now = new Date("2026-11-03T10:00:00Z");
const events = (db: DB, prefix: string) =>
  (db.prepare("SELECT event, payload_json FROM audit_log WHERE event LIKE ? ORDER BY seq").all(`${prefix}%`) as { event: string; payload_json: string }[])
    .map((r) => ({ event: r.event, ...JSON.parse(r.payload_json) }));

function approve(db: DB, id: string) {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
}

describe("a company card per agent (K2)", () => {
  let db: DB;
  let awx: FakeIssuing;
  beforeEach(() => {
    db = openDb(":memory:");
    awx = new FakeIssuing();
    awx.clock = () => now.getTime();
  });

  it("issues one virtual card per agent with the CFO policy's limits, and only once", async () => {
    await setupCards(db, awx, now);
    await setupCards(db, awx, now);
    expect(awx.holders).toHaveLength(3);
    expect(awx.cards.map((c) => [c.nickname, c.limits?.perTxCents, c.limits?.monthlyCents])).toEqual([
      ["sourcing agent: market data", 3000, 10000],
      ["support agent: helpdesk tools", 6000, 15000],
      ["treasury agent: finance tools", 2500, 5000],
    ]);
    const rows = db.prepare("SELECT agent, last4, per_tx_cents FROM cards ORDER BY agent").all();
    expect(rows).toHaveLength(3);
    expect(events(db, "card.issued").map((e) => e.agent)).toEqual(["sourcing", "support", "treasury"]);
  });

  it("adopts a card that already exists at Airwallex and brings its limits back to the policy", async () => {
    const h = await awx.createCardholder({ email: "agents+sourcing@tidemark-data.example", firstName: "Sourcing", lastName: "Agent" });
    await awx.createCard({ cardholderId: h.id, nickname: "sourcing agent: market data", createdBy: "x", limits: { currency: "EUR", perTxCents: 5000, monthlyCents: 10000 } });
    await setupCards(db, awx, now);
    expect(awx.cards.filter((c) => c.nickname.startsWith("sourcing"))).toHaveLength(1);
    expect(awx.cards[0]!.limits).toEqual({ currency: "EUR", perTxCents: 3000, monthlyCents: 10000 });
    expect(events(db, "card.limits_synced")[0]).toMatchObject({ agent: "sourcing", from: "50.00 / 100.00", to: "30.00 / 100.00" });
  });

  it("declines over the limit at Airwallex, and the agent asks the CFO for a raise", async () => {
    await setupCards(db, awx, now);
    const ok = await buyPlan(db, awx, "market-data-starter", now);
    expect(ok).toMatchObject({ approved: true, amountCents: 1999 });
    const no = await buyPlan(db, awx, "market-data-pro", now);
    expect(no).toMatchObject({ approved: false, failureReason: "LIMIT_EXCEEDED" });
    expect(events(db, "card.charge").map((e) => [e.event, e.agent, e.amount, e.reason ?? null])).toEqual([
      ["card.charge_approved", "sourcing", "19.99", null],
      ["card.charge_declined", "sourcing", "45.00", "LIMIT_EXCEEDED"],
    ]);

    const p = proposeCardRaise(db, "sourcing", { perTx: "50.00" }, "the Pro plan costs 45.00 EUR", now);
    expect(p.status).toBe("PENDING_APPROVAL");
    expect(Date.parse(p.expires_at) - now.getTime()).toBe(60 * 60 * 1000);
    expect(JSON.parse(p.terms_json).changes).toEqual([{ key: "card.sourcing.per_tx", label: "Sourcing agent's card: most per purchase", from: "30.00", to: "50.00" }]);
    // Approving changes the policy; the card at Airwallex follows.
    approve(db, p.proposal_id);
    executePolicyChange(db, p.proposal_id, now);
    await syncCardsAfterPolicy(db, p.proposal_id, awx, now);
    expect(awx.cards[0]!.limits?.perTxCents).toBe(5000);
    expect(await buyPlan(db, awx, "market-data-pro", now)).toMatchObject({ approved: true });
    expect(cardSpendCents(db, "sourcing", now)).toBe(1999 + 4500);
  });

  it("stops a policy change it cannot sync with a clear error, and syncs it on the next tick", async () => {
    await setupCards(db, awx, now);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('card.support.monthly', '100.00', ?)").run(now.toISOString());
    const real = awx.setCardLimits.bind(awx);
    awx.setCardLimits = async () => { throw new Error("socket hang up"); };
    await expect(syncCardsIfChanged(db, awx, now)).rejects.toThrow(/support.*socket hang up/);
    awx.setCardLimits = real;
    awx.calls = [];
    expect(await syncCardsIfChanged(db, awx, now)).toEqual(["support"]);
    expect(awx.cards[1]!.limits?.monthlyCents).toBe(10000);
    // Nothing differs any more: the tick makes no call at all.
    awx.calls = [];
    expect(await syncCardsIfChanged(db, awx, now)).toEqual([]);
    expect(awx.calls).toEqual([]);
  });

  it("records each Airwallex transaction once, however it arrives", async () => {
    await setupCards(db, awx, now);
    const t = await buyPlan(db, awx, "helpdesk-2-seats", now);
    await pollCardTransactions(db, awx, now);
    ingestCardTransaction(db, t, "webhook", now);
    expect(db.prepare("SELECT COUNT(*) AS n FROM card_transactions").get()).toEqual({ n: 1 });
    expect(events(db, "card.charge")).toHaveLength(1);
    // A charge made outside our code (a merchant charging the card directly) is picked up by the poll.
    const support = awx.cards[1]!;
    await awx.simulateCardCharge({ cardId: support.cardId, amountCents: 9000, currency: "EUR", merchant: "Unknown merchant", mcc: "5734" });
    await pollCardTransactions(db, awx, now);
    expect(events(db, "card.charge").map((e) => [e.event, e.amount, e.source])).toEqual([
      ["card.charge_approved", "38.00", "simulation"],
      ["card.charge_declined", "90.00", "poll"],
    ]);
  });

  it("refuses a transaction for a card that is not one of ours", async () => {
    await setupCards(db, awx, now);
    expect(() => ingestCardTransaction(db, { transactionId: "t", cardId: "someone-else", amountCents: 1, currency: "EUR", status: "PENDING", approved: true, failureReason: null, merchant: "m", mcc: null, type: "AUTHORIZATION", occurredAt: now.toISOString() }, "webhook", now))
      .toThrow(/not an agent's card/);
  });

  it("syncs every card on demand and reports what it changed", async () => {
    await setupCards(db, awx, now);
    awx.cards[2]!.limits = { currency: "EUR", perTxCents: 99_900, monthlyCents: 99_900 };
    expect(await syncCards(db, awx, now)).toEqual(["treasury"]);
    expect(awx.cards[2]!.limits).toEqual({ currency: "EUR", perTxCents: 2500, monthlyCents: 5000 });
  });
});
