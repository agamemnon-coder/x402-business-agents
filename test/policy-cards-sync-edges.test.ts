// Keeping the agents' cards to the policy (src/policy/cards.ts) when Airwallex does not do as asked: a freeze, a thaw,
// controls or limits it refuses or answers with something else are errors that name what the card has and what it
// should have; a refreeze it refuses is recorded, not thrown; a purchase window on a card a stop now blocks is closed
// for good; a charge later reversed is recorded as such; a date Airwallex sends that is not one counts at the time it
// was recorded. Against the red team's Issuing double, made to misbehave; no network.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import type { Card, CardControls, CardLimits, CardTransaction } from "../src/airwallex/issuing.js";
import {
  cardControls, cardOf, closeBlockedWindow, closeCardWindow, ingestCardTransaction, openCardWindow, setupCards, storeCard, syncCardsAfterPolicy, syncOne, wantCardStatus,
} from "../src/policy/cards.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const t0 = new Date("2026-11-03T10:00:00Z");
const events = (db: DB, e: string) => db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(e) as { subject: string; payload_json: string }[];
const setting = (db: DB, key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, t0.toISOString());

/** The Issuing double with each answer overridable: a throw, or a card other than the one asked for. */
class Misbehaving extends FakeIssuing {
  statusAnswer: ((cardId: string, s: "ACTIVE" | "INACTIVE") => Promise<Card>) | null = null;
  controlsAnswer: ((cardId: string, c: Pick<CardControls, "mccs" | "currencies">) => Promise<Card>) | null = null;
  limitsAnswer: ((cardId: string, l: CardLimits) => Promise<Card>) | null = null;
  override async setCardStatus(cardId: string, s: "ACTIVE" | "INACTIVE") { return this.statusAnswer ? this.statusAnswer(cardId, s) : super.setCardStatus(cardId, s); }
  override async setCardControls(cardId: string, c: Pick<CardControls, "mccs" | "currencies">) { return this.controlsAnswer ? this.controlsAnswer(cardId, c) : super.setCardControls(cardId, c); }
  override async setCardLimits(cardId: string, l: CardLimits) { return this.limitsAnswer ? this.limitsAnswer(cardId, l) : super.setCardLimits(cardId, l); }
}

let db: DB;
let awx: Misbehaving;
beforeEach(async () => {
  db = openDb(":memory:");
  awx = new Misbehaving();
  awx.clock = () => t0.getTime();
  await setupCards(db, awx, t0);
});
const cardAt = async (agent: string) => awx.getCard(cardOf(db, agent)!.card_id);

describe("a card Airwallex will not set as asked", () => {
  it("a freeze refused, or answered with another status, stops with the card's own words", async () => {
    awx.cards[0]!.status = "ACTIVE"; // thawed outside any window: the policy wants it frozen
    awx.statusAnswer = async () => { throw new Error("Airwallex 503"); };
    await expect(syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).rejects.toThrow("the sourcing agent's card was not frozen at Airwallex: Airwallex 503");
    awx.statusAnswer = async (id) => ({ ...(await awx.getCard(id)), status: "ACTIVE" });
    await expect(syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).rejects.toThrow("the sourcing agent's card is ACTIVE at Airwallex, not INACTIVE");
  });

  it("a thaw for an open window refused: the card was not thawed", async () => {
    // The window is in the ledger, the card still frozen at Airwallex.
    awx.statusAnswer = async () => { throw new Error("Airwallex 400"); };
    await expect(openCardWindow(db, awx, "sourcing", { amountCents: 1900, merchant: "Packwise", why: "test" }, t0)).rejects.toThrow("the sourcing agent's card was not thawed for the purchase at Airwallex: Airwallex 400");
    // The window is closed at once, and the ledger keeps the card ACTIVE so the next sync reads it and freezes it.
    expect(JSON.parse(events(db, "card.window_closed").at(-1)!.payload_json)).toMatchObject({ why: "not thawed at Airwallex: Airwallex 400" });
    expect(cardOf(db, "sourcing")!.status).toBe("ACTIVE");
  });

  it("a thaw for an open window is recorded; a freeze between purchases says why", async () => {
    await openCardWindow(db, awx, "sourcing", { amountCents: 1900, merchant: "Packwise", why: "test" }, t0);
    awx.cards[0]!.status = "INACTIVE"; // frozen behind our back while the window is open
    expect(await syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).toBe(true);
    expect(events(db, "card.thawed").map((e) => e.subject)).toEqual(["sourcing"]);
    const later = new Date(t0.getTime() + 10 * 60_000);
    expect(await syncOne(db, awx, "sourcing", await cardAt("sourcing"), later)).toBe(true);
    expect(JSON.parse(events(db, "card.frozen").at(-1)!.payload_json)).toMatchObject({ why: "frozen by default between approved purchases" });
  });

  it("controls refused, or answered with others", async () => {
    awx.cards[0]!.controls = { mccs: [], currencies: [], activeTo: null };
    awx.controlsAnswer = async () => { throw new Error("Airwallex 400 invalid_argument"); };
    await expect(syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).rejects.toThrow("the sourcing agent's card controls were not updated at Airwallex: Airwallex 400 invalid_argument");
    awx.controlsAnswer = async (id) => ({ ...(await awx.getCard(id)), controls: { mccs: [], currencies: ["EUR"], activeTo: null } });
    await expect(syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).rejects.toThrow(/the sourcing agent's card allows any merchant, EUR at Airwallex, not MCC \d+/);
    awx.controlsAnswer = async (id) => ({ ...(await awx.getCard(id)), controls: { mccs: ["5734"], currencies: [], activeTo: null } });
    await expect(syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).rejects.toThrow("the sourcing agent's card allows MCC 5734, any currency at Airwallex");
    awx.controlsAnswer = async (id) => ({ ...(await awx.getCard(id)), controls: null });
    await expect(syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).rejects.toThrow("the sourcing agent's card allows any merchant, any currency at Airwallex");
  });

  it("limits answered with none: the card has none at Airwallex", async () => {
    awx.cards[0]!.limits = { currency: "EUR", perTxCents: 1, monthlyCents: 2 };
    awx.limitsAnswer = async (id) => ({ ...(await awx.getCard(id)), limits: null });
    await expect(syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).rejects.toThrow(/^the sourcing agent's card has none at Airwallex, not \d+\.\d{2} \/ \d+\.\d{2}$/);
  });
});

describe("storing a card and what a task card may pay", () => {
  it("a card without EUR limits is not stored; one without controls is stored as allowing anything", () => {
    const c: Card = { cardId: "c_x", cardholderId: "ch_x", last4: "9999", status: "ACTIVE", nickname: "x", limits: null, controls: null };
    expect(() => storeCard(db, "support", c, t0)).toThrow("the support agent's card has no EUR limits at Airwallex");
    storeCard(db, "support", { ...c, limits: { currency: "EUR", perTxCents: 100, monthlyCents: 200 } }, t0);
    expect(cardOf(db, "support")).toMatchObject({ allowed_mccs: "", allowed_currencies: "", active_to: null, per_tx_cents: 100 });
  });

  it("a task card that does not exist has no controls", () => {
    expect(() => cardControls("task:T-404", t0, db)).toThrow("no task card task:T-404");
  });
});

describe("purchase windows", () => {
  it("an agent with no card has no window to open, and none to close", async () => {
    db.prepare("DELETE FROM cards WHERE agent = 'support'").run();
    await expect(openCardWindow(db, awx, "support", { amountCents: 100, merchant: "m", why: "w" }, t0)).rejects.toThrow("the support agent has no card");
    await closeCardWindow(db, awx, "support", "done", t0);
    expect(events(db, "card.window_closed")).toEqual([]);
  });

  it("a refreeze Airwallex refuses is recorded, not thrown; a closed card is not refrozen", async () => {
    await openCardWindow(db, awx, "sourcing", { amountCents: 1900, merchant: "Packwise", why: "test" }, t0);
    awx.statusAnswer = async () => { throw new Error("Airwallex 500"); };
    await closeCardWindow(db, awx, "sourcing", "Airwallex answered", t0);
    expect(JSON.parse(events(db, "card.refreeze_failed")[0]!.payload_json)).toMatchObject({ agent: "sourcing", error: "Airwallex 500", next: "the runner's card sync freezes it" });
    db.prepare("UPDATE cards SET status = 'CLOSED' WHERE agent = 'support'").run();
    const calls = awx.calls.length;
    await closeCardWindow(db, awx, "support", "done", t0);
    expect(awx.calls.length).toBe(calls);
  });

  it("a stop on one agent closes its open window for good, and says it was that agent's stop", async () => {
    awx.statusAnswer = null;
    await openCardWindow(db, awx, "support", { amountCents: 500, merchant: "Helpdesk", why: "test" }, t0);
    setting(db, "pause.support", "on");
    expect(wantCardStatus(db, "support", t0)).toBe("INACTIVE");
    expect(closeBlockedWindow(db, "support", t0)).toBe(true);
    expect(JSON.parse(events(db, "card.window_closed").at(-1)!.payload_json)).toMatchObject({ why: "a stop on this agent cancelled the purchase" });
    expect(closeBlockedWindow(db, "support", t0)).toBe(false);
  });

  it("the emergency stop closes a window on a card the ledger no longer holds, by the agent's name alone", async () => {
    await openCardWindow(db, awx, "treasury", { amountCents: 500, merchant: "Bank", why: "test" }, t0);
    db.prepare("DELETE FROM cards WHERE agent = 'treasury'").run();
    setting(db, "freeze", "on");
    expect(closeBlockedWindow(db, "treasury", t0)).toBe(true);
    expect(JSON.parse(events(db, "card.window_closed").at(-1)!.payload_json)).toEqual({ agent: "treasury", last4: "", why: "the emergency stop cancelled the purchase" });
  });

  it("a thaw the sync must make for an open window, refused: the card was not thawed", async () => {
    await openCardWindow(db, awx, "sourcing", { amountCents: 1900, merchant: "Packwise", why: "test" }, t0);
    awx.cards[0]!.status = "INACTIVE";
    awx.statusAnswer = async () => { throw new Error("Airwallex 429"); };
    await expect(syncOne(db, awx, "sourcing", await cardAt("sourcing"), t0)).rejects.toThrow("the sourcing agent's card was not thawed at Airwallex: Airwallex 429");
  });
});

describe("after a policy change", () => {
  it("an unknown proposal touches no card; a card change without the sandbox keys says the card is not updated yet", async () => {
    expect(await syncCardsAfterPolicy(db, "P-9999", awx, t0)).toEqual([]);
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0001', 'policy_change', ?, ?, 'human', 'EXECUTED', '2026-11-04', '2026-11-03')")
      .run(JSON.stringify({ changes: [{ key: "card.sourcing.per_tx", from: "50.00", to: "40.00" }] }), "a".repeat(64));
    await expect(syncCardsAfterPolicy(db, "P-0001", null, t0)).rejects.toThrow("the policy changed, but the Airwallex sandbox keys are not set, so the card is not updated yet");
  });
});

describe("recording an authorisation", () => {
  const tx = (over: Partial<CardTransaction>): CardTransaction => ({
    transactionId: "ctx_1", cardId: cardOf(db, "support")!.card_id, amountCents: 900, currency: "EUR", status: "APPROVED", approved: true, failureReason: null,
    merchant: "", mcc: "5734", type: "AUTHORIZATION", occurredAt: t0.toISOString(), ...over,
  });

  it("an approval later reversed is recorded as a reversal, by the merchant, once", () => {
    expect(ingestCardTransaction(db, tx({}), "poll", t0)).toBe(true);
    const approved = JSON.parse(events(db, "card.charge_approved")[0]!.payload_json) as { origin: unknown };
    expect(approved.origin).toEqual({ actor: "external", party: "merchant", name: "a merchant" });
    expect(ingestCardTransaction(db, tx({ status: "REVERSED", approved: false }), "webhook", t0)).toBe(false);
    const rev = events(db, "card.charge_reversed");
    expect(rev).toHaveLength(1);
    expect(JSON.parse(rev[0]!.payload_json)).toMatchObject({ agent: "support", amount: "9.00", status: "REVERSED", source: "webhook", origin: { name: "a merchant" } });
    expect(db.prepare("SELECT status, approved FROM card_transactions WHERE transaction_id = 'ctx_1'").get()).toEqual({ status: "REVERSED", approved: 0 });
  });

  it("with the autonomous agents on, a decline Airwallex made is news for the agent whose card it is; its own reason or else its status", () => {
    const saved = { a: process.env.KIT11_AUTONOMY, g: process.env.KIT11_AGENTS };
    process.env.KIT11_AUTONOMY = "on";
    process.env.KIT11_AGENTS = "on";
    try {
      ingestCardTransaction(db, tx({ transactionId: "ctx_d1", status: "DECLINED", approved: false, failureReason: "LIMIT_EXCEEDED", merchant: "Packwise" }), "webhook", t0);
      ingestCardTransaction(db, tx({ transactionId: "ctx_d2", status: "FAILED", approved: false, amountCents: 901 }), "poll", t0);
      ingestCardTransaction(db, tx({ transactionId: "ctx_d3", status: "FAILED", approved: false, amountCents: 902 }), "simulation", t0);
    } finally {
      for (const [k, v] of [["KIT11_AUTONOMY", saved.a], ["KIT11_AGENTS", saved.g]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    const news = db.prepare("SELECT for_agent, payload_json FROM world_events WHERE kind = 'card.declined' ORDER BY id").all() as { for_agent: string; payload_json: string }[];
    expect(news.map((n) => n.for_agent)).toEqual(["support", "support"]);
    expect(news.map((n) => JSON.parse(n.payload_json) as Record<string, string>).map((p) => [p.transaction_id, p.reason, p.via])).toEqual([
      ["ctx_d1", "LIMIT_EXCEEDED", "Airwallex webhook"], ["ctx_d2", "FAILED", "Airwallex poll"],
    ]);
    expect(JSON.parse(events(db, "card.charge_declined")[1]!.payload_json)).toMatchObject({ reason: "FAILED" });
  });

  it("a date that is not a date is counted at the moment it was recorded", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(ingestCardTransaction(db, tx({ transactionId: "ctx_2", occurredAt: "not a date", merchant: "Somewhere" }), "poll", now)).toBe(true);
    expect(events(db, "card.unexpected_authorization").map((e) => e.subject)).toEqual(["ctx_2"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM card_transactions WHERE transaction_id = 'ctx_2'").get()).toEqual({ n: 1 });
  });
});
