// The emergency stop (E2): one Face ID freezes every agent payment and every company card at Airwallex. Turning it
// on tightens the policy (allowed from the phone); turning it off loosens it (a proposal, approved with Face ID).
import { beforeEach, describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { proposePolicyChange, executePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { setupCards, syncCardsAfterPolicy, syncCardsIfChanged } from "../src/policy/cards.js";
import { capRefusal, frozen, loosens } from "../src/policy/rules.js";
import { policyLoosens } from "../src/approve/client.js";
import { buyPlan } from "../src/agents/cardBuyer.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const now = new Date("2026-11-03T10:00:00Z");
function approveAndRun(db: DB, id: string) {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
  executePolicyChange(db, id, now);
}

describe("the emergency stop", () => {
  let db: DB;
  let awx: FakeIssuing;
  beforeEach(async () => {
    db = openDb(":memory:");
    awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
  });

  it("is off by default, and turning it on tightens while turning it off loosens (the same on phone and runner)", () => {
    expect(frozen(db)).toBe(false);
    for (const f of [loosens, policyLoosens]) {
      expect(f({ key: "freeze", from: "off", to: "on" })).toBe(false);
      expect(f({ key: "freeze", from: "on", to: "off" })).toBe(true);
    }
  });

  it("stops every agent payment before signing, and freezes every card at Airwallex", async () => {
    const p = proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "suspicious activity" }, "human", now);
    approveAndRun(db, p.proposal_id);
    expect(frozen(db)).toBe(true);
    for (const agent of ["sourcing", "support", "treasury"] as const) expect(capRefusal(db, agent, 1)).toMatch(/^frozen_by_cfo/);
    expect(await syncCardsAfterPolicy(db, p.proposal_id, awx, now)).toEqual(["sourcing", "support", "treasury"]);
    expect(awx.cards.map((c) => c.status)).toEqual(["INACTIVE", "INACTIVE", "INACTIVE"]);
    const t = await buyPlan(db, awx, "packwise-starter", now);
    expect(t).toMatchObject({ approved: false, failureReason: "CARD_INACTIVE" });
    const s = buildSnapshot(db, now);
    expect(s.frozen).toMatchObject({ by: "Max", proposal_id: p.proposal_id, reason: "suspicious activity" });
    expect(s.cards.every((c) => c.frozen)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'card.frozen'").get()).toEqual({ n: 3 });
  });

  it("unfreezes only through an approved proposal, and the cards follow", async () => {
    approveAndRun(db, proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "stop" }, "human", now).proposal_id);
    await syncCardsIfChanged(db, awx, now);
    const off = proposePolicyChange(db, { changes: [{ key: "freeze", to: "off" }], reason: "checked, all clear" }, "human", now);
    approveAndRun(db, off.proposal_id);
    await syncCardsAfterPolicy(db, off.proposal_id, awx, now);
    expect(awx.cards.map((c) => c.status)).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
    expect(capRefusal(db, "sourcing", 1)).toBeNull();
    expect(buildSnapshot(db, now).frozen).toBeNull();
    expect((await buyPlan(db, awx, "packwise-starter", now)).approved).toBe(true);
  });

  it("keeps the freeze on a card the runner could not reach yet: the next stock check retries", async () => {
    approveAndRun(db, proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "stop" }, "human", now).proposal_id);
    const real = awx.setCardStatus.bind(awx);
    awx.setCardStatus = async () => { throw new Error("socket hang up"); };
    await expect(syncCardsIfChanged(db, awx, now)).rejects.toThrow(/socket hang up/);
    awx.setCardStatus = real;
    expect(await syncCardsIfChanged(db, awx, now)).toEqual(["sourcing", "support", "treasury"]);
    audit(db, "system", "noop", null, {});
  });
});
