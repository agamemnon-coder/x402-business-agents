// Ask Purser (G), as Max specified it: within the CFO policy a task card is issued at once; above it, Face ID;
// Opus reviews each proposal; the card closes after its one purchase; an agent may ask too, but never gets one at once.
import { describe, expect, it } from "vitest";
import { askPurser, bookOnTaskCard } from "../src/agents/askPurser.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb, type DB } from "../src/db/open.js";
import { cardOf, syncCards, wantCardStatus } from "../src/policy/cards.js";
import { loosens, policyValue } from "../src/policy/rules.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const now = new Date("2026-10-30T10:00:00Z");
const tools = (db: DB) => new Tools(db, new ClaudeReader(db, null));
const taskCount = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM task_cards").get() as { n: number }).n;

describe("within the CFO policy: issued at once", () => {
  it("issues a card up to the policy's threshold at once, with no proposal, and says so", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    expect(policyValue(db, "approval.task_card_eur")).toBe("300.00");
    const r = await askPurser(db, tools(db), "Book a flight to Berlin on 12 November, at most €250", now, { rail: awx, from: "runner" });
    expect(r.proposalId).toBeNull();
    expect(r.taskId).toMatch(/^task:T-\d{4}$/);
    expect(r.reply).toMatch(/within your policy.*•••• \d{4}/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    expect(cardOf(db, r.taskId!)).toMatchObject({ per_tx_cents: 25000, allowed_mccs: "4511" });
    expect(awx.cards[0]?.controls).toMatchObject({ singleUse: true, mccs: ["4511"] });
  });

  it("asks for Face ID above the threshold, and without Airwallex keys", async () => {
    const db = openDb(":memory:");
    const above = await askPurser(db, tools(db), "Hotel in Munich, at most €600", now, { rail: new FakeIssuing() });
    expect(above).toMatchObject({ proposalId: "P-0001", taskId: null });
    const noKeys = await askPurser(db, tools(db), "Flight to Berlin, at most €250", now);
    expect(noKeys).toMatchObject({ proposalId: "P-0002", taskId: null });
    expect(taskCount(db)).toBe(0);
  });

  // Breaks if raising the threshold could be done from the phone without Face ID.
  it("treats a higher threshold as loosening the policy", () => {
    expect(loosens({ key: "approval.task_card_eur", from: "300.00", to: "1000.00" })).toBe(true);
    expect(loosens({ key: "approval.task_card_eur", from: "300.00", to: "100.00" })).toBe(false);
  });

  it("has Opus review each proposal; the review is advice beside it, outside the hash", async () => {
    const db = openDb(":memory:");
    const r = await askPurser(db, tools(db), "Hotel in Munich, at most €600", now);
    const p = db.prepare("SELECT explanation FROM proposals WHERE proposal_id = ?").get(r.proposalId) as { explanation: string | null };
    expect(p.explanation).toMatch(/^\[no model\] /);
  });
});

describe("an agent asking", () => {
  // Breaks if an agent's own request is issued at once: only the CFO's words may be within-policy.
  it("always becomes a proposal for the CFO, made by that agent", async () => {
    const db = openDb(":memory:");
    const r = await askPurser(db, tools(db), "I need a train ticket to Antwerp, at most €40", now, { rail: new FakeIssuing(), asker: "ext:trailbot" });
    expect(r).toMatchObject({ proposalId: "P-0001", taskId: null });
    expect(db.prepare("SELECT created_by FROM proposals").get()).toEqual({ created_by: "ext:trailbot" });
  });
});

describe("closing the card after its one purchase", () => {
  // Breaks if a used task card stays open at Airwallex, or a later sync opens it again.
  it("closes the card after the approved charge, and syncing keeps it closed", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const { taskId } = await askPurser(db, tools(db), "Flight to Berlin, at most €250", now, { rail: awx, from: "runner" });
    await bookOnTaskCard(db, awx, taskId!, { merchant: "Skyline Air", amount: "189.00" }, now, awx);
    expect(awx.cards[0]?.status).toBe("INACTIVE");
    expect(wantCardStatus(db, taskId!)).toBe("INACTIVE");
    await syncCards(db, awx, now);
    expect(awx.cards[0]?.status).toBe("INACTIVE");
    const again = await bookOnTaskCard(db, awx, taskId!, { merchant: "Skyline Air", amount: "40.00" }, now, awx);
    expect(again).toMatchObject({ approved: false, failureReason: "CARD_INACTIVE" });
  });

  it("leaves the card open after a declined try", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const { taskId } = await askPurser(db, tools(db), "Flight to Berlin, at most €250", now, { rail: awx, from: "runner" });
    await bookOnTaskCard(db, awx, taskId!, { merchant: "Skyline Air", amount: "260.00" }, now, awx);
    expect(awx.cards[0]?.status).toBe("ACTIVE");
  });
});

describe("the threshold as a CFO setting", () => {
  // Breaks if the task card threshold disappears from the policy the phone's policy page shows.
  it("is on the CFO policy page, at 300.00 EUR to start", async () => {
    const { currentPolicy } = await import("../src/policy/rules.js");
    const e = currentPolicy(openDb(":memory:")).find((r) => r.key === "approval.task_card_eur");
    expect(e).toMatchObject({ label: "Task cards up to this are issued without Face ID", value: "300.00", display: "300.00 EUR" });
  });
});
