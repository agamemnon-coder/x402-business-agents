// F, the Agents page: one profile per agent, read from the same CFO policy the agents are held to. Changing a limit
// in the policy changes the profile; nothing on the page has its own copy.
import { describe, expect, it } from "vitest";
import { agentProfiles } from "../src/agents/profiles.js";
import { audit } from "../src/audit/log.js";
import { CLAUDE_JOBS } from "../src/claude/tools.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { currentPolicy } from "../src/policy/rules.js";
import { readFileSync } from "node:fs";

const now = new Date("2026-10-30T10:00:00Z");
const change = (db: DB, key: string, to: string) => {
  const p = proposePolicyChange(db, { changes: [{ key, to }], reason: "test" }, "human", now);
  decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
  executePolicyChange(db, p.proposal_id, now);
};
const of = (db: DB, id: string) => agentProfiles(db, now).find((a) => a.id === id)!;

describe("agent profiles", () => {
  it("shows each agent's mandate as bound on chain, and the replacement once one is made", () => {
    const db = openDb(":memory:");
    // Before this fix every agent read "No mandate": the page looked in a table nothing writes (seen 31 Oct).
    expect(of(db, "sourcing").mandate).toBeNull();
    const bind = (agent: string, event: string, cap: string, budget: string) =>
      audit(db, "treasury", event, agent, { cap, budget, payee: "0x0000000000000000000000000000000000000001" }, now);
    bind("sourcing", "mandate.bound", "0.03", "4.00");
    bind("support", "mandate.bound", "0.10", "4.00");
    bind("sourcing", "mandate.replaced", "0.04", "4.00");
    expect(of(db, "sourcing").mandate).toEqual({ cap: "0.04", budget: "4.00", policy_cap: null });
    expect(of(db, "support").mandate).toEqual({ cap: "0.10", budget: "4.00", policy_cap: null });
    expect(of(db, "treasury").mandate).toBeNull();
  });

  it("has one profile per agent, with its job, card, mandate limit, velocity and settings", () => {
    const db = openDb(":memory:");
    const ps = agentProfiles(db, now);
    expect(ps.map((p) => [p.id, p.name])).toEqual([["sourcing", "Sourcing agent"], ["support", "Support agent"], ["treasury", "Treasury agent"]]);
    const ops = ps[0]!;
    expect(ops.card).toMatchObject({ per_tx: "30.00", monthly: "100.00", currency: "EUR" });
    expect(ops.card.merchants.join(" ")).toMatch(/Software \(MCC 5734\)/);
    expect(ops.velocity).toEqual({ per_minute: 30, usdz_per_hour: "4.00", eur_per_hour: "100.00" });
    expect(ops.status).toBe("working");
    expect(ops.settings.map((s) => s.key)).toEqual(expect.arrayContaining(["cap.sourcing", "card.sourcing.per_tx", "card.sourcing.monthly", "stop.sourcing"]));
  });

  // Breaks if the page keeps its own copy of a limit: the policy is the one source.
  it("follows the CFO policy: a tighter card limit shows at once", () => {
    const db = openDb(":memory:");
    change(db, "card.sourcing.per_tx", "25.00");
    expect(of(db, "sourcing").card.per_tx).toBe("25.00");
    const policy = new Map(currentPolicy(db).map((e) => [e.key, e.value]));
    for (const p of agentProfiles(db, now)) for (const s of p.settings) expect(s.value).toBe(policy.get(s.key));
  });

  it("says what each agent does alone and what waits for the CFO, with the policy's numbers", () => {
    const db = openDb(":memory:");
    change(db, "approval.refund_each", "0.08");
    const sales = of(db, "support");
    expect(sales.alone.join(" ")).toMatch(/refunds up to 0\.08/i);
    expect(sales.asks.join(" ")).toMatch(/above 0\.08/);
    expect(of(db, "treasury").asks.join(" ")).toMatch(/SWIFT/);
    expect(of(db, "treasury").settings.map((s) => s.key)).toContain("approval.task_card_eur");
  });

  it("names the Claude model for each job, from the same list the tools use", () => {
    const db = openDb(":memory:");
    const sales = of(db, "support");
    expect(sales.models).toContainEqual(expect.objectContaining({ model: "Claude Sonnet 5.5", job: expect.stringMatching(/dispute/i) }));
    for (const p of agentProfiles(db, now)) {
      expect(p.models).toContainEqual(expect.objectContaining({ model: "Claude Opus 5.5" }));
      expect(p.models).toContainEqual(expect.objectContaining({ model: "Claude Haiku 5.5" }));
    }
    // Every Claude call in the tools is in CLAUDE_JOBS: the page cannot miss or invent a job.
    const src = readFileSync(new URL("../src/claude/tools.ts", import.meta.url), "utf8").split("export class Tools")[1]!;
    const calls = [...src.matchAll(/task: "([a-z_]+)", role: "([a-z]+)", actor: "([a-z]+)"/g)].map((m) => `${m[1]}/${m[2]}/${m[3]}`).sort();
    expect(CLAUDE_JOBS.map((j) => `${j.task}/${j.role}/${j.actor}`).sort()).toEqual(calls);
  });

  it("shows a stopped agent and the emergency stop", () => {
    const db = openDb(":memory:");
    change(db, "stop.support", "on");
    expect(of(db, "support").status).toBe("stopped");
    expect(of(db, "sourcing").status).toBe("working");
    change(db, "freeze", "on");
    expect(agentProfiles(db, now).map((p) => p.status)).toEqual(["frozen", "frozen", "frozen"]);
  });

  it("includes an outside agent once the CFO approved its card", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO external_agents (agent_id, display_name, purpose, per_tx_cents, monthly_cents, status, created_at) VALUES ('ext:trailbot', 'Trailbot', 'buys route maps', 2000, 8000, 'ACTIVE', ?)").run(now.toISOString());
    const t = of(db, "ext:trailbot");
    expect(t).toMatchObject({ name: "Trailbot (outside agent)", job: "buys route maps", card: { per_tx: "20.00", monthly: "80.00" } });
    expect(t.asks.join(" ")).toMatch(/task card/);
  });

  it("is on the dashboard snapshot", () => {
    const db = openDb(":memory:");
    expect(buildSnapshot(db, now).agents.map((a) => a.id)).toEqual(["sourcing", "support", "treasury"]);
  });
});
