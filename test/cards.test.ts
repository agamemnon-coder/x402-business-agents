import { beforeEach, describe, expect, it } from "vitest";
import { buyPlan, proposeCardRaise } from "../src/agents/cardBuyer.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { cardSpendCents, ingestCardTransaction, pollCardTransactions, setupCards, syncCardsAfterPolicy, syncCards, syncCardsIfChanged } from "../src/policy/cards.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

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

  it("lets each card pay only its own kind of merchant, in euros, until an end date (governance: what, in which currency, until when)", async () => {
    await setupCards(db, awx, now);
    const end = new Date(now.getTime() + 90 * 86_400_000).toISOString();
    expect(awx.cards.map((c) => c.controls)).toEqual([
      { mccs: ["5734"], currencies: ["EUR"], activeTo: end },
      { mccs: ["7311"], currencies: ["EUR"], activeTo: end },
      { mccs: ["5734"], currencies: ["EUR"], activeTo: end },
    ]);
    expect(db.prepare("SELECT agent, allowed_mccs, allowed_currencies, active_to FROM cards ORDER BY agent").all()).toEqual([
      { agent: "sourcing", allowed_mccs: "5734", allowed_currencies: "EUR", active_to: end },
      { agent: "support", allowed_mccs: "7311", allowed_currencies: "EUR", active_to: end },
      { agent: "treasury", allowed_mccs: "5734", allowed_currencies: "EUR", active_to: end },
    ]);
    // The marketing agent's card is for ads: warehouse software on it is declined by the card issuer itself.
    const t = await buyPlan(db, awx, "packwise-on-marketing-card", now);
    expect(t).toMatchObject({ approved: false, failureReason: "MERCHANT_CATEGORY_NOT_ALLOWED" });
  });

  it("brings an adopted card's merchant categories and currencies back to the policy", async () => {
    const h = await awx.createCardholder({ email: "agents+support@northwind-outdoor.example", firstName: "Marketing", lastName: "Agent" });
    await awx.createCard({ cardholderId: h.id, nickname: "marketing agent: ads", createdBy: "x", limits: { currency: "EUR", perTxCents: 6000, monthlyCents: 15000 } });
    await setupCards(db, awx, now);
    expect(awx.cards[0]!.controls).toMatchObject({ mccs: ["7311"], currencies: ["EUR"] });
    expect(events(db, "card.controls_synced")[0]).toMatchObject({ agent: "support", from: "any merchant, any currency", to: "MCC 7311, EUR" });
  });

  it("issues one virtual card per agent with the CFO policy's limits, and only once", async () => {
    await setupCards(db, awx, now);
    await setupCards(db, awx, now);
    expect(awx.holders).toHaveLength(3);
    expect(awx.cards.map((c) => [c.nickname, c.limits?.perTxCents, c.limits?.monthlyCents])).toEqual([
      ["operations agent: warehouse software", 3000, 10000],
      ["marketing agent: ads", 6000, 15000],
      ["finance agent: bookkeeping", 2500, 5000],
    ]);
    const rows = db.prepare("SELECT agent, last4, per_tx_cents FROM cards ORDER BY agent").all();
    expect(rows).toHaveLength(3);
    expect(events(db, "card.issued").map((e) => e.agent)).toEqual(["sourcing", "support", "treasury"]);
  });

  it("gives each world its own cards, named after its business account", async () => {
    db.prepare("INSERT INTO metal_accounts (address, role) VALUES ('0x00000000000000000000000000000000000AbC12', 'business')").run();
    await setupCards(db, awx, now);
    expect(awx.cards[0]!.nickname).toBe("operations agent: warehouse software (0abc12)");
    const other = openDb(":memory:");
    other.prepare("INSERT INTO metal_accounts (address, role) VALUES ('0x00000000000000000000000000000000000DeF34', 'business')").run();
    await setupCards(other, awx, now);
    expect(awx.cards).toHaveLength(6);
    expect(awx.holders).toHaveLength(3);
  });

  it("adopts a card that already exists at Airwallex and brings its limits back to the policy", async () => {
    const h = await awx.createCardholder({ email: "agents+sourcing@northwind-outdoor.example", firstName: "Sourcing", lastName: "Agent" });
    await awx.createCard({ cardholderId: h.id, nickname: "operations agent: warehouse software", createdBy: "x", limits: { currency: "EUR", perTxCents: 5000, monthlyCents: 10000 } });
    await setupCards(db, awx, now);
    expect(awx.cards.filter((c) => c.nickname.startsWith("operations"))).toHaveLength(1);
    expect(awx.cards[0]!.limits).toEqual({ currency: "EUR", perTxCents: 3000, monthlyCents: 10000 });
    expect(events(db, "card.limits_synced")[0]).toMatchObject({ agent: "sourcing", from: "50.00 / 100.00", to: "30.00 / 100.00" });
  });

  it("declines over the limit at Airwallex, and the agent asks the CFO for a raise", async () => {
    await setupCards(db, awx, now);
    const ok = await buyPlan(db, awx, "packwise-starter", now);
    expect(ok).toMatchObject({ approved: true, amountCents: 1999 });
    const no = await buyPlan(db, awx, "packwise-pro", now);
    expect(no).toMatchObject({ approved: false, failureReason: "LIMIT_EXCEEDED" });
    expect(events(db, "card.charge").map((e) => [e.event, e.agent, e.amount, e.reason ?? null])).toEqual([
      ["card.charge_approved", "sourcing", "19.99", null],
      ["card.charge_declined", "sourcing", "45.00", "LIMIT_EXCEEDED"],
    ]);

    const p = proposeCardRaise(db, "sourcing", { perTx: "50.00" }, "the Pro plan costs 45.00 EUR", now);
    expect(p.status).toBe("PENDING_APPROVAL");
    expect(Date.parse(p.expires_at) - now.getTime()).toBe(60 * 60 * 1000);
    expect(JSON.parse(p.terms_json).changes).toEqual([{ key: "card.sourcing.per_tx", label: "Operations agent's card: most per purchase", from: "30.00", to: "50.00" }]);
    // Approving changes the policy; the card at Airwallex follows.
    approve(db, p.proposal_id);
    executePolicyChange(db, p.proposal_id, now);
    await syncCardsAfterPolicy(db, p.proposal_id, awx, now);
    expect(awx.cards[0]!.limits?.perTxCents).toBe(5000);
    expect(await buyPlan(db, awx, "packwise-pro", now)).toMatchObject({ approved: true });
    expect(cardSpendCents(db, "sourcing", now)).toBe(1999 + 4500);
  });

  it("stops a policy change it cannot sync with a clear error, and syncs it on the next stock check", async () => {
    await setupCards(db, awx, now);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('card.support.monthly', '100.00', ?)").run(now.toISOString());
    const real = awx.setCardLimits.bind(awx);
    awx.setCardLimits = async () => { throw new Error("socket hang up"); };
    await expect(syncCardsIfChanged(db, awx, now)).rejects.toThrow(/support.*socket hang up/);
    awx.setCardLimits = real;
    awx.calls = [];
    expect(await syncCardsIfChanged(db, awx, now)).toEqual(["support"]);
    expect(awx.cards[1]!.limits?.monthlyCents).toBe(10000);
    // Nothing differs any more: the stock check makes no call at all.
    awx.calls = [];
    expect(await syncCardsIfChanged(db, awx, now)).toEqual([]);
    expect(awx.calls).toEqual([]);
  });

  it("records each Airwallex transaction once, however it arrives", async () => {
    await setupCards(db, awx, now);
    const t = await buyPlan(db, awx, "adwave-starter", now);
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

  it("knows a decline is the same one when Airwallex names it by two different ids", async () => {
    await setupCards(db, awx, now);
    const card = awx.cards[1]!.cardId;
    const base = { cardId: card, amountCents: 6100, currency: "EUR", status: "FAILED", approved: false, failureReason: "LIMIT_EXCEEDED", merchant: "Adwave", mcc: "5734", type: "AUTHORIZATION", occurredAt: "2026-11-03T10:00:00.990Z" };
    expect(ingestCardTransaction(db, { ...base, transactionId: "legacy-id" }, "poll", now)).toBe(true);
    expect(ingestCardTransaction(db, { ...base, transactionId: "card-transaction-id", status: "DECLINED" }, "webhook", now)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM card_transactions").get()).toEqual({ n: 1 });
    // Two real charges of the same amount at different moments stay two.
    expect(ingestCardTransaction(db, { ...base, transactionId: "another", occurredAt: "2026-11-03T10:05:00.000Z" }, "poll", now)).toBe(true);
  });

  it("records an approval once when Airwallex lists it before its card transaction id is filled in", async () => {
    await setupCards(db, awx, now);
    const base = { cardId: awx.cards[0]!.cardId, amountCents: 1900, currency: "EUR", status: "PENDING", approved: true, failureReason: null, merchant: "TrailData Reports", mcc: "5734", type: "AUTHORIZATION" };
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM card_transactions").get() as { n: number }).n;
    // A moment after the charge, the list has only the older id: the poll leaves it for the next round.
    awx.txs = [{ ...base, transactionId: "c84-legacy", legacyId: "c84-legacy", occurredAt: "2026-11-03T09:59:59.735Z" }];
    expect(await pollCardTransactions(db, awx, now)).toBe(0);
    // The webhook names it by its card transaction id, at a slightly different moment.
    expect(ingestCardTransaction(db, { ...base, transactionId: "01a1-cti", occurredAt: "2026-11-03T10:00:00.396Z" }, "webhook", now)).toBe(true);
    // Then the list carries both ids: still one.
    awx.txs = [{ ...base, transactionId: "01a1-cti", legacyId: "c84-legacy", occurredAt: "2026-11-03T09:59:59.735Z" }];
    expect(await pollCardTransactions(db, awx, now)).toBe(0);
    expect(count()).toBe(1);
    expect(cardSpendCents(db, "sourcing", now)).toBe(1900);
    // An old entry with only the older id (Airwallex never filled it in) is recorded all the same.
    awx.txs = [{ ...base, amountCents: 500, transactionId: "old-legacy", legacyId: "old-legacy", occurredAt: "2026-11-03T09:50:00.000Z" }];
    expect(await pollCardTransactions(db, awx, now)).toBe(1);
  });

  it("merges an approval recorded under both ids, and re-keys one recorded under its older id", async () => {
    await setupCards(db, awx, now);
    const base = { cardId: awx.cards[0]!.cardId, amountCents: 1900, currency: "EUR", status: "PENDING", approved: true, failureReason: null, merchant: "TrailData Reports", mcc: "5734", type: "AUTHORIZATION" };
    const ids = () => (db.prepare("SELECT transaction_id FROM card_transactions ORDER BY transaction_id").all() as { transaction_id: string }[]).map((r) => r.transaction_id);
    // As it happened live: once under the older id (an early poll), once under the card transaction id (the webhook).
    ingestCardTransaction(db, { ...base, transactionId: "c84", legacyId: "c84", occurredAt: "2026-11-03T09:50:00.735Z" }, "poll", now);
    ingestCardTransaction(db, { ...base, transactionId: "01a1", occurredAt: "2026-11-03T09:50:01.396Z" }, "webhook", now);
    expect(ids()).toEqual(["01a1", "c84"]);
    expect(ingestCardTransaction(db, { ...base, transactionId: "01a1", legacyId: "c84", occurredAt: "2026-11-03T09:50:00.735Z" }, "poll", now)).toBe(false);
    expect(ids()).toEqual(["01a1"]);
    expect(events(db, "card.duplicate_merged")).toEqual([expect.objectContaining({ kept: "01a1", amount: "19.00" })]);
    expect(cardSpendCents(db, "sourcing", now)).toBe(1900);
    // Recorded only under the older id: it takes the card transaction id, so the webhook finds it.
    ingestCardTransaction(db, { ...base, amountCents: 700, transactionId: "x-legacy", legacyId: "x-legacy", occurredAt: "2026-11-03T09:55:00.000Z" }, "poll", now);
    ingestCardTransaction(db, { ...base, amountCents: 700, transactionId: "x-cti", legacyId: "x-legacy", occurredAt: "2026-11-03T09:55:00.000Z" }, "poll", now);
    expect(ingestCardTransaction(db, { ...base, amountCents: 700, transactionId: "x-cti", occurredAt: "2026-11-03T09:55:00.500Z" }, "webhook", now)).toBe(false);
    expect(ids()).toEqual(["01a1", "x-cti"]);
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
