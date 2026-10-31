// 4.2 Pause one agent with Face ID: the CFO stops one agent, not all. Pausing really revokes the agent's Metal mandate
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
import { executePauseChange, paused, resumedSince, syncPauses, type PauseChain } from "../src/policy/pause.js";
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

  it("pausing revokes the agent's Metal mandate, freezes its card, and refuses its payments before signing", async () => {
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

describe("a mandate change after a resume", () => {
  // The resumed mandate's spend on chain starts at nothing; a replace would carry only that, so the budgets of a new
  // plan would no longer count what was spent before the pause. Until that is handled, code refuses it outright.
  it("is refused before anything is issued or signed", async () => {
    process.env.KIT11_AGENTS = "on";
    const db = openDb(":memory:");
    await pause(db, "sourcing", "on");
    await pause(db, "sourcing", "off");
    const { refuseAfterResume } = await import("../src/policy/pause.js");
    expect(() => refuseAfterResume(db, ["sourcing", "treasury"])).toThrow(/resumed after a pause/);
    expect(() => refuseAfterResume(db, ["treasury", "support"])).not.toThrow();
    delete process.env.KIT11_AGENTS;
  });
});
