// Purser Cloud's Agents view (cloud/src/consoleData.ts agentsOf, GET /v1/agents): each agent the company's records name,
// with its card as issued (and a raised limit), its status from the newest card row (frozen is paused, closed is
// revoked), the Claude models its own rows name, its runs without a model, and its newest decisions with who decided and
// what each came to. Read only; built from the company's own rows.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentsOf, outcomeOf } from "../cloud/src/consoleData.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

let c: TestCloud, t: TestTenant, db: TenantDb, seq = 0;
const row = (ts: string, actor: string, event: string, subject: string | null, payload: Record<string, unknown>) => {
  seq++;
  return db.insert("audit_rows", { seq, ts, actor, event, subject, payload_json: JSON.stringify(payload), prev_hash: "0", row_hash: `h${seq}` });
};
type Agent = { id: string; status: string; status_since: string | null; models: string[]; card: { last4: string; per_purchase: string | null; per_month: string | null; pays_for: string } | null; runs: { total: number; without_model: number }; decisions: { text: string; decided_by: string | null; outcome: string }[]; may: string[] };

beforeEach(async () => {
  c = testCloud();
  t = await c.tenant("acme");
  db = new TenantDb(c.env.sql, t.id);
  seq = 0;
});
afterEach(() => c.close());

describe("the Agents view", () => {
  it("names each agent once, in the console's order, with its card, status and who decided", async () => {
    await db.apply([
      row("2026-11-01T10:00:00Z", "system", "card.issued", "support", { agent: "support", last4: "1111", limits: "60.00 / 150.00", currency: "EUR", nickname: "support agent: helpdesk software (Zendesk)" }),
      row("2026-11-01T10:00:01Z", "system", "card.issued", "sourcing", { agent: "sourcing", last4: "2222", limits: "30.00 / 100.00", currency: "EUR", nickname: "sourcing agent: data" }),
      row("2026-11-02T09:00:00Z", "sourcing", "card.limit_changed", "sourcing", { agent: "sourcing", per_purchase: "40.00" }),
      row("2026-11-03T09:00:00Z", "system", "card.frozen", "support", { agent: "support", last4: "1111", why: "velocity limit" }),
      row("2026-11-04T09:00:00Z", "system", "card.issued", "treasury", { agent: "treasury", last4: "3333", limits: "25.00 / 50.00" }),
      row("2026-11-04T09:00:01Z", "system", "card.closed", "treasury", { agent: "treasury" }),
      row("2026-11-05T09:00:00Z", "sourcing", "agent.run", null, { agent: "sourcing", model: "claude-haiku-4-5", claude_calls: [] }),
      row("2026-11-05T09:00:01Z", "sourcing", "agent.run", null, { agent: "sourcing", model: "claude-haiku-4-5", claude_calls: ["req_1"] }),
      row("2026-11-05T09:01:00Z", "sourcing", "card.decline_met", null, { agent: "sourcing", source: "claude", model: "claude-haiku-4-5", reason: "LIMIT_EXCEEDED", proposal_id: "P-0001" }),
      row("2026-11-05T09:02:00Z", "sourcing", "card.decline_met", null, { agent: "sourcing", source: "fallback", reason: "LIMIT_EXCEEDED" }),
      row("2026-11-05T09:03:00Z", "awx-executor", "card.charge_approved", "ctx_1", { agent: "sourcing", amount: "12.00", merchant: "Data Co", last4: "2222" }),
      row("2026-11-05T09:03:00Z", "outsider", "agent.decision", null, { source: "claude" }),
    ]);
    const v = await agentsOf(db) as { agents: Agent[]; controls: string };
    expect(v.agents.map((a) => a.id)).toEqual(["sourcing", "support", "treasury"]);
    const [sourcing, support, treasury] = v.agents as [Agent, Agent, Agent];
    expect(sourcing.status).toBe("active");
    expect(sourcing.card).toMatchObject({ last4: "2222", per_purchase: "40.00", per_month: "100.00", pays_for: "data" });
    expect(sourcing.models).toEqual(["claude-haiku-4-5"]);
    expect(sourcing.runs).toEqual({ total: 2, without_model: 1 });
    expect(sourcing.decisions.map((d) => [d.decided_by, d.outcome])).toEqual([[null, "paid"], ["Purser's code (fallback: no model answered)", "note"], ["Claude (claude-haiku-4-5)", "asked"]]);
    expect(sourcing.may.length).toBeGreaterThan(0);
    expect(support).toMatchObject({ status: "paused", status_since: "2026-11-03T09:00:00Z" });
    expect(support.card!.pays_for).toBe("helpdesk software");
    expect(treasury.status).toBe("revoked");
    expect(v.controls).toMatch(/signed with Face ID/);
  });

  it("an agent with no card shows none, and a company with no rows has no agents", async () => {
    expect(((await agentsOf(db)) as { agents: Agent[] }).agents).toEqual([]);
    await db.apply([row("2026-11-05T09:00:00Z", "checker", "agent.decision", null, { agent: "checker", source: "claude", summary: "hold it" })]);
    const v = await agentsOf(db) as { agents: Agent[] };
    expect(v.agents.map((a) => a.id)).toEqual(["checker"]);
    expect(v.agents[0]!.card).toBeNull();
    expect(v.agents[0]!.status_since).toBeNull();
  });

  it("is what GET /v1/agents answers to a key that may read", async () => {
    await db.apply([row("2026-11-01T10:00:00Z", "system", "card.issued", "sourcing", { agent: "sourcing", last4: "2222", limits: "30.00 / 100.00" })]);
    const r = await c.req("GET", "/v1/agents", { key: t.key });
    expect(r.status).toBe(200);
    expect((r.json.agents as Agent[]).map((a) => a.id)).toEqual(["sourcing"]);
  });
});

describe("what a decision came to", () => {
  it("paid, declined, the CFO asked, or a note", () => {
    const o = (event: string, payload: Record<string, unknown> = {}) => outcomeOf({ event, payload_json: JSON.stringify(payload) });
    expect(o("card.charge_approved")).toBe("paid");
    expect(o("card.charge_declined")).toBe("declined");
    expect(o("proposal.created")).toBe("asked");
    expect(o("card.decline_met", { proposal_id: "P-1" })).toBe("asked");
    expect(o("card.decline_met", {})).toBe("note");
    expect(o("ap.status", { to: "waiting_cfo" })).toBe("asked");
    expect(o("ap.status", { to: "paid" })).toBe("note");
    expect(outcomeOf({ event: "agent.decision", payload_json: "{not json" })).toBe("note");
  });
});
