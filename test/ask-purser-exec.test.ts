// Ask Purser (G), step 3: the task card proposal, the CFO's approval, and the card Airwallex issues.
import { describe, expect, it } from "vitest";
import { executeTaskCard, planTask, proposeTaskCard, readTaskFallback } from "../src/agents/askPurser.js";
import { summarize } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { cardOf, syncCards } from "../src/policy/cards.js";
import { decide } from "../src/policy/approvals.js";
import { fourEyes } from "../src/policy/fourEyes.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const now = new Date("2026-10-30T10:00:00Z");
const MSG = "Book a flight to Berlin for the trade fair on 12 November, at most €250";

function proposed(db: DB) {
  const plan = planTask(MSG, readTaskFallback(MSG, now), now);
  if (!plan.ok) throw new Error(plan.reply);
  return proposeTaskCard(db, plan.task, MSG, now);
}
const approve = (db: DB, id: string, sha: string) => decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "max", method: "cli" }, now);

describe("a task card proposal", () => {
  it("binds the exact card the CFO approves: kind, merchant categories, amount, end, single use, the message's hash", () => {
    const db = openDb(":memory:");
    const p = proposed(db);
    expect(p).toMatchObject({ kind: "task_card", status: "PENDING_APPROVAL", created_by: "treasury" });
    expect(JSON.parse(p.terms_json)).toMatchObject({
      kind: "task_card", task: "flight", merchant_categories: ["4511"], amount: "250.00", currency: "EUR",
      valid_until: "2026-11-12T23:59:59.000Z", single_use: true,
    });
    expect(JSON.parse(p.terms_json).message_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summarize("task_card", p.terms_json)).toBe("Flight card, one purchase of at most EUR 250.00 at merchant category 4511, until 2026-11-12: " + MSG.slice(0, 120));
  });

  it("needs two people above the four-eyes threshold", () => {
    const db = openDb(":memory:");
    const p = proposed(db);
    expect(fourEyes(db, p)).toBe(false);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run("approval.four_eyes_eur", "200.00", now.toISOString());
    expect(fourEyes(db, p)).toBe(true);
  });
});

describe("issuing the task card (executeTaskCard)", () => {
  // Breaks if the executor runs without an approval, or issues anything but the approved card.
  it("issues nothing before approval, then exactly the approved single-use card, and records it once", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const p = proposed(db);
    await expect(executeTaskCard(db, awx, p.proposal_id, now)).rejects.toThrow(/not approved/);
    expect(awx.cards).toHaveLength(0);
    approve(db, p.proposal_id, p.terms_sha256);
    await executeTaskCard(db, awx, p.proposal_id, now);
    expect(awx.cards).toHaveLength(1);
    expect(awx.cards[0]).toMatchObject({ limits: { currency: "EUR", perTxCents: 25000, monthlyCents: 25000 }, controls: { mccs: ["4511"], currencies: ["EUR"], activeTo: "2026-11-12T23:59:59.000Z", singleUse: true } });
    const card = cardOf(db, `task:${p.proposal_id}`);
    expect(card).toMatchObject({ per_tx_cents: 25000, monthly_cents: 25000, allowed_mccs: "4511", active_to: "2026-11-12T23:59:59.000Z" });
    expect(db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.proposal_id)).toEqual({ status: "EXECUTED" });
    // Syncing all cards leaves it as approved: its limits and controls come from the task, not from an agent's policy.
    expect(await syncCards(db, awx, now)).toEqual([]);
  });

  // Breaks if Airwallex's answer is trusted blindly: a card that came back multi-use is frozen and not recorded.
  it("freezes and does not record a card that Airwallex issued with other controls", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const real = awx.createCard.bind(awx);
    awx.createCard = async (a) => real({ ...a, controls: a.controls ? { ...a.controls, singleUse: false } : undefined });
    const p = proposed(db);
    approve(db, p.proposal_id, p.terms_sha256);
    await expect(executeTaskCard(db, awx, p.proposal_id, now)).rejects.toThrow(/not single-use/);
    expect(awx.cards[0]?.status).toBe("INACTIVE");
    expect(cardOf(db, `task:${p.proposal_id}`)).toBeUndefined();
    expect(db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.proposal_id)).toEqual({ status: "FAILED" });
  });

  it("adopts the card already issued when the first answer was lost, instead of issuing a second", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const p = proposed(db);
    approve(db, p.proposal_id, p.terms_sha256);
    const real = awx.createCard.bind(awx);
    let first = true;
    awx.createCard = async (a) => { const c = await real(a); if (first) { first = false; throw new Error("network: answer lost"); } return c; };
    await expect(executeTaskCard(db, awx, p.proposal_id, now)).rejects.toThrow(/answer lost/);
    await executeTaskCard(db, awx, p.proposal_id, now);
    expect(awx.cards).toHaveLength(1);
    expect(cardOf(db, `task:${p.proposal_id}`)).toBeDefined();
  });
});

describe("the phone's approval view of a task card", () => {
  // Breaks if the phone shows a task card as "cannot be approved", or hides what the card may pay and until when.
  it("says what the card may pay, how often and until when, with the amount large", async () => {
    const { describeTerms } = await import("../src/approve/client.js");
    const db = openDb(":memory:");
    const d = describeTerms(JSON.parse(proposed(db).terms_json), {});
    expect(d).toMatchObject({ approvable: true, title: "Task card", big: "250.00", unit: "EUR, one purchase", label: "Flight" });
    expect(d.sentence).toBe(`Issue a single-use virtual card at Airwallex for a flight: one purchase of at most 250.00 EUR at an airline (merchant category 4511), until 12 Nov 2026, 23:59 UTC. For: ${MSG}.`);
    expect(d.rows).toEqual(expect.arrayContaining([["Pays", "one purchase, then Airwallex declines"], ["Merchant category", "4511"], ["Ends", "12 Nov 2026, 23:59 UTC"]]));
  });
});
