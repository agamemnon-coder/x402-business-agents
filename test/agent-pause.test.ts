// 4.2 Pause one agent with Face ID: the CFO stops one agent, not all. Pausing really revokes the agent's Alta mandate
// on chain and freezes its Airwallex card; Purser refuses its payments before signing. Resuming re-grants spending
// power, so it is a mandate change: four eyes when that is on, and the chain is restored before the switch goes off.
// Only with the agents switch on. Fake chain here; the real one is checked on testnet in a dry run.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { decide, type ProposalRow } from "../src/policy/approvals.js";
import { capRefusal, loosens, rules } from "../src/policy/rules.js";
import { policyLoosens } from "../src/approve/client.js";
import { fourEyes } from "../src/policy/fourEyes.js";
import { wantCardStatus } from "../src/policy/cards.js";
import { carriedCents, chainBudgetCents, checkCarried, lifetime, moveTargets, executePauseChange, latestRevoked, paused, pausesNotRevoked, resumeExpiresIn, resumedSince, syncPauses, type PauseChain } from "../src/policy/pause.js";
import { health } from "../src/ops/health.js";
import { setupCards } from "../src/policy/cards.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { buyPlan } from "../src/agents/cardBuyer.js";

const now = new Date("2026-11-03T10:00:00Z");
const row = (db: DB, id: string) => db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as ProposalRow;
const events = (db: DB, e: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(e) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);
const approve = (db: DB, id: string) => decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: row(db, id).terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);

function chain(fail: Partial<Record<"revoke" | "resume", string>> = {}): PauseChain & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    revoke: async (agent) => { calls.push(`revoke ${agent}`); if (fail.revoke) throw new Error(fail.revoke); return { tx: `0x${"1".repeat(64)}`, credential_hash: "0xold" }; },
    resume: async (agent) => { calls.push(`resume ${agent}`); if (fail.resume) throw new Error(fail.resume); return { tx: `0x${"2".repeat(64)}`, credential_hash: "0xnew", spent_before: "0.15", budget: "3.85" }; },
  };
}

async function pause(db: DB, agent: string, to: "on" | "off", c = chain()) {
  const p = proposePolicyChange(db, { changes: [{ key: `pause.${agent}`, to }], reason: to === "on" ? "pause this agent" : "resume" }, "human", now);
  approve(db, p.proposal_id);
  await executePauseChange(db, p.proposal_id, c, now);
  return p.proposal_id;
}

describe("pause one agent (agents on)", () => {
  let db: DB;
  beforeEach(() => { process.env.KIT11_AGENTS = "on"; db = openDb(":memory:"); });
  afterEach(() => { delete process.env.KIT11_AGENTS; });

  it("pausing revokes the agent's Alta mandate, freezes its card, and refuses its payments before signing", async () => {
    const c = chain();
    await pause(db, "support", "on", c);
    expect(c.calls).toEqual(["revoke support"]);
    expect(paused(db, "support")).toBe(true);
    expect(capRefusal(db, "support", 5)).toMatch(/^paused_by_cfo:/);
    expect(wantCardStatus(db, "support")).toBe("INACTIVE");
    expect(events(db, "mandate.revoked")[0]).toMatchObject({ agent: "support", tx: `0x${"1".repeat(64)}` });
  });

  it("refuses a paused agent's card purchase in code, before Airwallex sees it", async () => {
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    await pause(db, "support", "on");
    await expect(buyPlan(db, awx, "replyhub-starter", now)).rejects.toThrow(/paused by the CFO/);
    expect(awx.txs).toHaveLength(0);
  });

  it("stops only that agent: the others keep paying and keep their cards", async () => {
    await pause(db, "support", "on");
    expect(capRefusal(db, "sourcing", 2)).toBeNull();
    expect(wantCardStatus(db, "sourcing")).toBe("ACTIVE");
  });

  it("resuming restores the mandate on chain before the switch goes off", async () => {
    await pause(db, "support", "on");
    const c = chain();
    await pause(db, "support", "off", c);
    expect(c.calls).toEqual(["resume support"]);
    expect(paused(db, "support")).toBe(false);
    expect(capRefusal(db, "support", 5)).toBeNull();
    // Testnet (dry-18 world, 31 Oct): a revoked mandate cannot be replaced, only a fresh one bound; its spend starts at
    // nothing. So the fresh one gets what was left of the budget: the lifetime limit on chain stays the same.
    expect(events(db, "mandate.resumed")[0]).toMatchObject({ agent: "support", tx: `0x${"2".repeat(64)}`, spent_before: "0.15", budget: "3.85" });
    expect(resumedSince(db, "support")).toBe(true);
    expect(resumedSince(db, "sourcing")).toBe(false);
  });

  it("a failed resume leaves the agent paused (nothing re-granted) and the proposal failed", async () => {
    await pause(db, "support", "on");
    await expect(pause(db, "support", "off", chain({ resume: "rpc down" }))).rejects.toThrow(/rpc down/);
    expect(paused(db, "support")).toBe(true);
    const id = (db.prepare("SELECT proposal_id FROM proposals ORDER BY created_at DESC, proposal_id DESC LIMIT 1").get() as { proposal_id: string }).proposal_id;
    expect(row(db, id).status).toBe("FAILED");
  });

  it("a failed revoke still leaves the agent paused in Purser (it signs nothing), and says so", async () => {
    await expect(pause(db, "support", "on", chain({ revoke: "rpc down" }))).rejects.toThrow(/rpc down/);
    expect(paused(db, "support")).toBe(true);
    expect(capRefusal(db, "support", 5)).toMatch(/^paused_by_cfo:/);
    expect(events(db, "mandate.revoke_failed")[0]).toMatchObject({ agent: "support", error: expect.stringMatching(/rpc down/) });
  });

  it("a failed revoke is finished later by the sync, once; a sync with nothing to do changes nothing", async () => {
    await expect(pause(db, "support", "on", chain({ revoke: "rpc down" }))).rejects.toThrow();
    const c = chain();
    expect(await syncPauses(db, c, now)).toEqual(["support"]);
    expect(c.calls).toEqual(["revoke support"]);
    expect(events(db, "mandate.revoked")).toHaveLength(1);
    const again = chain();
    expect(await syncPauses(db, again, now)).toEqual([]);
    expect(again.calls).toEqual([]);
  });

  it("pausing tightens (the phone may do it); resuming loosens", () => {
    for (const f of [loosens, policyLoosens]) {
      expect(f({ key: "pause.support", from: "off", to: "on" })).toBe(false);
      expect(f({ key: "pause.support", from: "on", to: "off" })).toBe(true);
    }
  });

  it("with four eyes on, resuming needs two people; pausing needs one", async () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', '1000.00', ?)").run(now.toISOString());
    const on = proposePolicyChange(db, { changes: [{ key: "pause.support", to: "on" }], reason: "pause" }, "human", now);
    expect(fourEyes(db, row(db, on.proposal_id))).toBe(false);
    approve(db, on.proposal_id);
    await executePauseChange(db, on.proposal_id, chain(), now);
    const off = proposePolicyChange(db, { changes: [{ key: "pause.support", to: "off" }], reason: "resume" }, "human", now);
    expect(fourEyes(db, row(db, off.proposal_id))).toBe(true);
  });

  it("a pause never runs without the chain: the plain policy executor refuses it", () => {
    const p = proposePolicyChange(db, { changes: [{ key: "pause.support", to: "on" }], reason: "pause" }, "human", now);
    approve(db, p.proposal_id);
    expect(() => executePolicyChange(db, p.proposal_id, now)).toThrow(/chain/);
    expect(paused(db, "support")).toBe(false);
  });
});

describe("pause one agent (agents off)", () => {
  it("does not exist: no rule, and a proposal for it is refused", () => {
    delete process.env.KIT11_AGENTS;
    const db = openDb(":memory:");
    expect(rules(db).some((r) => r.key.startsWith("pause."))).toBe(false);
    expect(() => proposePolicyChange(db, { changes: [{ key: "pause.support", to: "on" }], reason: "x" }, "human", now)).toThrow();
  });
});


describe("review of 4.2 (31 October)", () => {
  beforeEach(() => { process.env.KIT11_AGENTS = "on"; });
  afterEach(() => { delete process.env.KIT11_AGENTS; });

  // A retried revoke whose first try landed on chain must record the mandate the pause revoked: the revoked one bound
  // last. A rebalance also revokes its predecessor, and those come earlier.
  it("picks the revoked mandate bound last, not the first one in file order", () => {
    expect(latestRevoked([
      { hash: "0xold-replaced", bound: true, revoked: true, boundBlock: 10n },
      { hash: "0xpaused", bound: true, revoked: true, boundBlock: 50n },
      { hash: "0xnever", bound: false, revoked: false, boundBlock: 0n },
    ])?.hash).toBe("0xpaused");
  });



  it("raises a health alarm while a paused agent's mandate is not revoked yet", async () => {
    const db = openDb(":memory:");
    await expect(pause(db, "support", "on", chain({ revoke: "rpc down" }))).rejects.toThrow();
    expect(pausesNotRevoked(db)).toEqual(["support"]);
    expect(health(db, now).alerts.map((a) => a.code)).toContain("pause_not_revoked");
    await syncPauses(db, chain(), now);
    expect(pausesNotRevoked(db)).toEqual([]);
  });

  it("keeps the revoked mandate's expiry on resume, and refuses one that has expired", () => {
    expect(resumeExpiresIn(1_000_000 + 3600, 1_000_000)).toBe(3600);
    expect(() => resumeExpiresIn(1_000_000 - 1, 1_000_000)).toThrow(/expired/);
  });

  it("records a resume only when a fresh mandate was bound; a revoke that never happened blocks no rebalance", async () => {
    const db = openDb(":memory:");
    await expect(pause(db, "support", "on", chain({ revoke: "rpc down" }))).rejects.toThrow();
    const c = chain();
    c.resume = async (agent) => { c.calls.push(`resume ${agent}`); return { tx: null, credential_hash: "0xstill", bound: false }; };
    await pause(db, "support", "off", c);
    expect(events(db, "mandate.resumed")).toEqual([]);
    expect(resumedSince(db, "support")).toBe(false);
    expect(paused(db, "support")).toBe(false);
  });

  it("keeps the pause rule while an agent is paused, even with the agents switched off, so it can be resumed", async () => {
    const db = openDb(":memory:");
    await pause(db, "support", "on");
    delete process.env.KIT11_AGENTS;
    expect(rules(db).some((r) => r.key === "pause.support")).toBe(true);
    expect(rules(db).some((r) => r.key === "pause.sourcing")).toBe(false);
  });
});

describe("block 6: a rebalance after a resume counts what was spent before the pause", () => {
  // After a resume the chain's spend restarted at nothing; the CFO's budgets are lifetime budgets. So the plan works on
  // lifetime figures (chain + carried), and the credential on chain gets the lifetime target minus what was carried.
  beforeEach(() => { process.env.KIT11_AGENTS = "on"; });
  afterEach(() => { delete process.env.KIT11_AGENTS; });

  it("adds up what each resume carried (spent before the pause)", async () => {
    const db = openDb(":memory:");
    expect(carriedCents(db, "support")).toBe(0);
    await pause(db, "support", "on");
    await pause(db, "support", "off");
    expect(carriedCents(db, "support")).toBe(15);
    expect(carriedCents(db, "sourcing")).toBe(0);
  });

  it("plans on lifetime figures and puts the lifetime target minus the carried spend on chain", () => {
    const life = lifetime({ agent: "support", capCents: 10, budgetCents: 385, spentCents: 5 }, 15);
    expect(life).toEqual({ agent: "support", capCents: 10, budgetCents: 400, spentCents: 20 });
    expect(chainBudgetCents(450, 15, 5)).toBe(435);
    expect(() => chainBudgetCents(18, 15, 5)).toThrow(/must stay above/);
  });

  it("refuses a rebalance if another resume happened after it was proposed", async () => {
    const db = openDb(":memory:");
    expect(() => checkCarried(db, [{ agent: "support", spent_before_pause: "0.00" }])).not.toThrow();
    await pause(db, "support", "on");
    await pause(db, "support", "off");
    expect(() => checkCarried(db, [{ agent: "support", spent_before_pause: "0.00" }])).toThrow(/resumed since/);
    expect(() => checkCarried(db, [{ agent: "support", spent_before_pause: "0.15" }])).not.toThrow();
    expect(() => checkCarried(db, [{ agent: "support" }])).toThrow(/resumed since/);
  });
});

describe("block 6: the rebalance the dry run proposes after a resume", () => {
  it("moves an amount from one agent's lifetime budget to another's; the giver's cap comes down to its new budget (dry-95), others untouched", () => {
    const current = [
      { agent: "sourcing" as const, capCents: 4, budgetCents: 1400, spentCents: 120 },
      { agent: "treasury" as const, capCents: 200, budgetCents: 200, spentCents: 135 },
      { agent: "support" as const, capCents: 10, budgetCents: 400, spentCents: 15 },
    ];
    expect(moveTargets(current, { from: "treasury", to: "support", cents: 50 })).toEqual([
      { agent: "sourcing", capCents: 4, budgetCents: 1400 },
      { agent: "treasury", capCents: 150, budgetCents: 150 },
      { agent: "support", capCents: 10, budgetCents: 450 },
    ]);
  });

  it("refuses a move that leaves the giver at or below what it spent, or moves nothing", () => {
    const current = [
      { agent: "treasury" as const, capCents: 200, budgetCents: 200, spentCents: 135 },
      { agent: "support" as const, capCents: 10, budgetCents: 400, spentCents: 15 },
    ];
    expect(() => moveTargets(current, { from: "treasury", to: "support", cents: 65 })).toThrow(/above what it spent/);
    expect(() => moveTargets(current, { from: "treasury", to: "support", cents: 0 })).toThrow(/positive/);
    expect(() => moveTargets(current, { from: "treasury", to: "treasury", cents: 10 })).toThrow(/two different agents/);
  });
});
