// The fixes from the live card and stop drills of 20 November (docs/runs/2026-11-20-card-drill.md, -stop-drill.md):
// 1. a process killed between thaw and refreeze: the runner's start freezes the card (recoverCardWindows), and a thaw
//    that may have reached Airwallex is in the ledger before it is sent, so the cheap sync reads the card;
// 2. a second authorisation of the purchase's own amount inside its window is unexpected (a window expects one);
// 3. a stop closes the purchase windows it overrules, so lifting it does not thaw the cards that were mid-purchase.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { CARD_WINDOW_MS, cardOf, closeBlockedWindow, ingestCardTransaction, openCardWindow, openWindow, recoverCardWindows, setupCards, syncCardsAfterPolicy, syncCardsIfChanged } from "../src/policy/cards.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { velocityObserve } from "../src/policy/velocity.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { drillMcc } from "../src/e2e/cardDrill.js";

const t0 = new Date("2026-11-20T10:00:00Z");
const events = (db: DB, e: string) => (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?").get(e) as { n: number }).n;

describe("card drill fixes", () => {
  let db: DB;
  let awx: FakeIssuing;
  let at: number;
  const now = () => new Date(at);
  const card = (agent: string) => awx.cards.find((c) => c.cardId === cardOf(db, agent)!.card_id)!;
  beforeEach(async () => {
    at = t0.getTime();
    db = openDb(":memory:");
    awx = new FakeIssuing();
    awx.clock = () => at;
    await setupCards(db, awx, now());
  });

  describe("a process killed between thaw and refreeze", () => {
    it("after the thaw was recorded: the runner's start closes the window and freezes the card at once", async () => {
      await openCardWindow(db, awx, "treasury", { amountCents: 99, merchant: "x", why: "killed" }, now());
      expect(card("treasury").status).toBe("ACTIVE");
      // The cheap check alone leaves it thawed for the rest of the window (what a restart did before).
      expect(await syncCardsIfChanged(db, awx, now())).toEqual([]);
      at += 5_000;
      const r = await recoverCardWindows(db, awx, now());
      expect(r).toEqual({ closed: ["treasury"], changed: ["treasury"] });
      expect(card("treasury").status).toBe("INACTIVE");
      expect(openWindow(db, "treasury", now())).toBeUndefined();
      const t = await awx.simulateCardCharge({ cardId: card("treasury").cardId, amountCents: 103, currency: "EUR", merchant: "after", mcc: "5734" });
      expect(t).toMatchObject({ approved: false, failureReason: "CARD_INACTIVE" });
    });

    it("the moment Airwallex thawed it, before the ledger heard: the ledger already says thawed, so the sync reads and freezes it", async () => {
      // The process dies inside the thaw call, after Airwallex has done it.
      const dying = { setCardStatus: async (id: string, s: "ACTIVE" | "INACTIVE") => { await awx.setCardStatus(id, s); return new Promise<never>(() => undefined); } };
      void openCardWindow(db, dying, "support", { amountCents: 99, merchant: "x", why: "killed" }, now());
      await new Promise((r) => setImmediate(r));
      expect(card("support").status).toBe("ACTIVE");
      expect(cardOf(db, "support")!.status).toBe("ACTIVE");
      // Restarted after the window would have run out: the every-few-seconds check alone now freezes it too.
      at += CARD_WINDOW_MS + 5_000;
      expect(await syncCardsIfChanged(db, awx, now())).toEqual(["support"]);
      expect(card("support").status).toBe("INACTIVE");
    });

    it("the runner's start freezes such a card even within the window", async () => {
      const dying = { setCardStatus: async (id: string, s: "ACTIVE" | "INACTIVE") => { await awx.setCardStatus(id, s); return new Promise<never>(() => undefined); } };
      void openCardWindow(db, dying, "support", { amountCents: 99, merchant: "x", why: "killed" }, now());
      await new Promise((r) => setImmediate(r));
      expect((await recoverCardWindows(db, awx, now())).changed).toEqual(["support"]);
      expect(card("support").status).toBe("INACTIVE");
    });

    it("a thaw whose answer is lost leaves the ledger saying thawed, and the next sync freezes the card", async () => {
      const lost = { setCardStatus: async (id: string, s: "ACTIVE" | "INACTIVE") => { await awx.setCardStatus(id, s); throw new Error("socket hang up"); } };
      await expect(openCardWindow(db, lost, "sourcing", { amountCents: 100, merchant: "x", why: "t" }, now())).rejects.toThrow(/not thawed/);
      expect(card("sourcing").status).toBe("ACTIVE");
      expect(await syncCardsIfChanged(db, awx, now())).toEqual(["sourcing"]);
      expect(card("sourcing").status).toBe("INACTIVE");
    });

    it("a start with nothing left open changes nothing", async () => {
      expect(await recoverCardWindows(db, awx, now())).toEqual({ closed: [], changed: [] });
    });
  });

  describe("a window expects one authorisation", () => {
    const charge = async (agent: string, cents: number, merchant: string) => {
      at += 1_000;
      return awx.simulateCardCharge({ cardId: card(agent).cardId, amountCents: cents, currency: "EUR", merchant, mcc: drillMcc(agent as "sourcing") });
    };

    it("flags a second authorisation of the purchase's own amount inside its window, not the purchase", async () => {
      await openCardWindow(db, awx, "support", { amountCents: 100, merchant: "A", why: "t" }, now());
      const a = await charge("support", 100, "A");
      const b = await charge("support", 100, "B");
      ingestCardTransaction(db, a, "simulation", now());
      ingestCardTransaction(db, b, "poll", now());
      expect(events(db, "card.unexpected_authorization")).toBe(1);
      const row = db.prepare("SELECT subject FROM audit_log WHERE event = 'card.unexpected_authorization'").get() as { subject: string };
      expect(row.subject).toBe(b.transactionId);
    });

    it("also when the purchase itself arrives by the poll after the other one", async () => {
      await openCardWindow(db, awx, "support", { amountCents: 100, merchant: "A", why: "t" }, now());
      const a = await charge("support", 100, "A");
      const b = await charge("support", 100, "B");
      ingestCardTransaction(db, a, "poll", now());
      ingestCardTransaction(db, b, "poll", now());
      expect(events(db, "card.unexpected_authorization")).toBe(1);
    });

    it("expects two authorisations for two windows of the same amount", async () => {
      await openCardWindow(db, awx, "support", { amountCents: 100, merchant: "A", why: "t" }, now());
      const a = await charge("support", 100, "A");
      at += 1_000;
      await openCardWindow(db, awx, "support", { amountCents: 100, merchant: "A", why: "t again" }, now());
      const b = await charge("support", 100, "A");
      ingestCardTransaction(db, a, "poll", now());
      ingestCardTransaction(db, b, "poll", now());
      expect(events(db, "card.unexpected_authorization")).toBe(0);
    });

    it("still flags another amount inside the window", async () => {
      await openCardWindow(db, awx, "sourcing", { amountCents: 100, merchant: "A", why: "t" }, now());
      const a = await charge("sourcing", 100, "A");
      const b = await charge("sourcing", 137, "B");
      ingestCardTransaction(db, a, "simulation", now());
      ingestCardTransaction(db, b, "webhook", now());
      expect(events(db, "card.unexpected_authorization")).toBe(1);
    });
  });

  describe("a stop closes the windows it overrules", () => {
    const approveAndRun = (id: string) => {
      const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
      decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now());
      executePolicyChange(db, id, now());
      return id;
    };

    it("lifting the emergency stop within the windows' two minutes leaves every card frozen", async () => {
      for (const a of ["sourcing", "support", "treasury"]) await openCardWindow(db, awx, a, { amountCents: 500, merchant: "mid-purchase", why: "t" }, now());
      expect(awx.cards.map((c) => c.status)).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
      const on = approveAndRun(proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "stop" }, "human", now()).proposal_id);
      expect(await syncCardsAfterPolicy(db, on, awx, now())).toEqual(["sourcing", "support", "treasury"]);
      expect(events(db, "card.window_closed")).toBe(3);
      at += 20_000;
      const off = approveAndRun(proposePolicyChange(db, { changes: [{ key: "freeze", to: "off" }], reason: "clear" }, "human", now()).proposal_id);
      expect(await syncCardsAfterPolicy(db, off, awx, now())).toEqual([]);
      expect(awx.cards.map((c) => c.status)).toEqual(["INACTIVE", "INACTIVE", "INACTIVE"]);
      // The next approved purchase opens its own window as before.
      expect(await openCardWindow(db, awx, "sourcing", { amountCents: 100, merchant: "x", why: "t" }, now())).not.toBeNull();
    });

    it("a velocity stop closes its agent's window; the other agents' windows stay", async () => {
      await openCardWindow(db, awx, "treasury", { amountCents: 500, merchant: "x", why: "t" }, now());
      await openCardWindow(db, awx, "sourcing", { amountCents: 500, merchant: "x", why: "t" }, now());
      for (let i = 0; i < 6; i++) velocityObserve(db, "treasury", 10, true, new Date(at + i * 1000));
      expect(closeBlockedWindow(db, "treasury", now())).toBe(true);
      expect(closeBlockedWindow(db, "sourcing", now())).toBe(false);
      expect(openWindow(db, "sourcing", now())).toBeDefined();
      expect(await syncCardsIfChanged(db, awx, now())).toEqual(["treasury"]);
      expect(card("treasury").status).toBe("INACTIVE");
      expect(card("sourcing").status).toBe("ACTIVE");
    });
  });
});
