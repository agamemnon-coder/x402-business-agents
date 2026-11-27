// Red team (runner, 27 Nov, finding 6): the CFO's emergency stop ("all agent payments and cards") did not stop an
// approved task card from being issued: executeTaskCard's preconditions checked only the kind and that no card existed.
// With the stop on, the card was created live (ACTIVE) and charged at a merchant before any card sync ran. Now the
// execution refuses while the policy does not let the task's card pay (policyAllowsCard: the stop, a pause or stop, a
// revoked identity), and nothing is issued. Test money only, no network.
import { describe, expect, it } from "vitest";
import { executeTaskCard, proposeTaskCard } from "../src/agents/askPurser.js";
import { openDb } from "../src/db/open.js";
import { decide } from "../src/policy/approvals.js";
import { frozen } from "../src/policy/rules.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const NOW = new Date("2026-11-27T10:00:00Z");

function approvedCard() {
  const db = openDb(":memory:");
  const p = proposeTaskCard(db, { kind: "flight", label: "Flight", purpose: "flight to Berlin", mccs: ["4511"], amountCents: 25_000, validUntil: new Date(NOW.getTime() + 3 * 86_400_000).toISOString() } as never, "Book a flight to Berlin, at most €250", NOW);
  decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW);
  return { db, id: p.proposal_id };
}

describe("the emergency stop and an approved task card (runner finding 6)", () => {
  it("under the stop, the approved card is not issued and nothing can be charged", async () => {
    const { db, id } = approvedCard();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?) ON CONFLICT(key) DO UPDATE SET value = 'on'").run(NOW.toISOString());
    expect(frozen(db)).toBe(true);
    const iss = new FakeIssuing();
    await expect(executeTaskCard(db, iss, id, NOW)).rejects.toThrow(/emergency stop|does not let/);
    expect(iss.cards).toHaveLength(0);
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status).toBe("APPROVED");
  });

  it("without the stop, the approved card is issued as before", async () => {
    const { db, id } = approvedCard();
    const iss = new FakeIssuing();
    await executeTaskCard(db, iss, id, NOW);
    expect(iss.cards).toHaveLength(1);
  });
});
