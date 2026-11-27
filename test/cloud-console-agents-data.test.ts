// The console's agents view (cloud/src/consoleData.ts agentsOf) from a company's own audit rows: an agent shows only
// when the records name it; its card as issued, a raised limit, frozen (paused) or closed (revoked); its models from
// its runs; who decided each of its newest decisions (Claude with its model, or Purser's code when no model answered);
// its runs without a model counted. And what each decision came to (outcomeOf), and an invoice's journal (journalOf).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentsOf, journalOf, outcomeOf } from "../cloud/src/consoleData.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

let c: TestCloud, t: TestTenant, seq = 0;
beforeEach(async () => { c = testCloud(); t = await c.tenant("agents"); seq = 0; });
afterEach(() => { c.close(); });

async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  const cols = await c.env.sql.all<{ name: string; type: string; notnull: number; dflt_value: unknown }>(`PRAGMA table_info(${table})`, []);
  const full: Record<string, unknown> = {};
  for (const col of cols) if (col.notnull && col.dflt_value === null) full[col.name] = /INT/i.test(col.type) ? 0 : "x";
  Object.assign(full, row);
  const keys = Object.keys(full);
  await c.env.sql.run(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => full[k]) as never);
}
const audit = (ts: string, actor: string, event: string, payload: unknown, subject: string | null = null) =>
  insert("audit_rows", { tenant_id: t.id, seq: ++seq, ts, actor, event, subject, payload_json: typeof payload === "string" ? payload : JSON.stringify(payload), row_hash: `h${seq}`, prev_hash: `h${seq - 1}` });
type Agent = { id: string; status: string; status_since: string | null; models: string[]; card: { per_purchase: string | null; per_month: string | null; pays_for: string; month: string | null; spent_month: string | null } | null; runs: { total: number; without_model: number }; decisions: { decided_by: string | null; outcome: string }[]; may: string[] };

describe("the agents view, from the company's audit rows", () => {
  it("names only agents the records name; a card issued, raised, then frozen; Claude's and code's decisions", async () => {
    await audit("2026-11-01T09:00:00Z", "system", "card.issued", { agent: "sourcing", last4: "2441", currency: "EUR", limits: "30.00 / 100.00", nickname: "Sourcing agent: data and software (test)" }, "sourcing");
    await audit("2026-11-02T09:00:00Z", "sourcing", "agent.run", { model: "claude-sonnet-4-5", claude_calls: [{ id: "r1" }] });
    await audit("2026-11-02T10:00:00Z", "sourcing", "agent.run", { claude_calls: [] });
    await audit("2026-11-02T11:00:00Z", "sourcing", "card.charge_declined", { agent: "sourcing", source: "claude", model: "claude-sonnet-4-5", amount: "45.00" }, "sourcing");
    await audit("2026-11-02T12:00:00Z", "sourcing", "proposal.created", { agent: "sourcing", source: "fallback", proposal_id: "P-0001" }, "P-0001");
    await audit("2026-11-03T09:00:00Z", "system", "card.limit_changed", { agent: "sourcing", per_purchase: "50.00" }, "sourcing");
    await audit("2026-11-03T10:00:00Z", "system", "card.frozen", { agent: "sourcing" }, "sourcing");
    await audit("2026-11-03T11:00:00Z", "someone-else", "note", "{not json");
    const r = (await agentsOf(new TenantDb(c.env.sql, t.id))) as { agents: Agent[]; controls: string };
    expect(r.controls).toMatch(/signed with Face ID/);
    expect(r.agents.map((a) => a.id)).toEqual(["sourcing"]);
    const a = r.agents[0]!;
    expect(a).toMatchObject({ status: "paused", status_since: "2026-11-03T10:00:00Z", models: ["claude-sonnet-4-5"], runs: { total: 2, without_model: 1 } });
    expect(a.card).toMatchObject({ per_purchase: "50.00", per_month: "100.00", pays_for: "data and software" });
    // No movements: the month the records stand at is not known, so no month and no spend.
    expect(a.card).toMatchObject({ month: null, spent_month: null });
    expect(a.may.length).toBeGreaterThan(0);
    const by = a.decisions.map((d) => d.decided_by);
    expect(by).toContain("Purser's code (fallback: no model answered)");
    expect(by).toContain("Claude (claude-sonnet-4-5)");
  });

  it("a closed card is revoked; an agent with no card and no model shows none", async () => {
    await audit("2026-11-01T09:00:00Z", "system", "card.issued", { agent: "support", limits: "" }, "support");
    await audit("2026-11-02T09:00:00Z", "system", "card.closed", { agent: "support" }, "support");
    await audit("2026-11-02T10:00:00Z", "treasury", "agent.run", { claude_calls: [] });
    const r = (await agentsOf(new TenantDb(c.env.sql, t.id))) as { agents: Agent[] };
    const by = Object.fromEntries(r.agents.map((a) => [a.id, a]));
    expect(by.support).toMatchObject({ status: "revoked", status_since: "2026-11-02T09:00:00Z" });
    expect(by.support!.card).toMatchObject({ per_purchase: "", per_month: null });
    expect(by.treasury).toMatchObject({ status: "active", card: null, models: [], runs: { total: 1, without_model: 1 } });
  });

  // Review 153: a CFO pause writes no card event when the card already rests frozen (src/policy/cards.ts syncCard writes
  // only on a change), so the card's events alone showed a paused agent as active. The policy says it.
  it("an agent the CFO paused or stopped, or every agent under the emergency stop, is paused though its card writes nothing", async () => {
    for (const a of ["sourcing", "support", "treasury"]) {
      await audit("2026-11-01T09:00:00Z", "system", "card.issued", { agent: a, limits: "30.00 / 100.00" }, a);
      await audit("2026-11-01T09:01:00Z", "system", "card.frozen", { agent: a, why: "frozen by default between approved purchases" }, a);
    }
    const status = async () => Object.fromEntries(((await agentsOf(new TenantDb(c.env.sql, t.id))) as { agents: Agent[] }).agents.map((a) => [a.id, [a.status, a.status_since]]));
    expect(await status()).toEqual({ sourcing: ["active", "2026-11-01T09:00:00Z"], support: ["active", "2026-11-01T09:00:00Z"], treasury: ["active", "2026-11-01T09:00:00Z"] });
    await audit("2026-11-02T09:00:00Z", "human", "policy.changed", { key: "pause.sourcing", from: "off", to: "on", proposal_id: "P-0001" }, "pause.sourcing");
    await audit("2026-11-02T10:00:00Z", "human", "policy.changed", { key: "stop.support", from: "off", to: "on", proposal_id: "P-0002" }, "stop.support");
    expect(await status()).toEqual({ sourcing: ["paused", "2026-11-02T09:00:00Z"], support: ["paused", "2026-11-02T10:00:00Z"], treasury: ["active", "2026-11-01T09:00:00Z"] });
    // Resumed: the newest row is what holds.
    await audit("2026-11-03T09:00:00Z", "human", "policy.changed", { key: "pause.sourcing", from: "on", to: "off", proposal_id: "P-0003" }, "pause.sourcing");
    expect((await status()).sourcing).toEqual(["active", "2026-11-01T09:00:00Z"]);
    await audit("2026-11-04T09:00:00Z", "human", "policy.changed", { key: "freeze", from: "off", to: "on", proposal_id: "P-0004" }, "freeze");
    expect(await status()).toEqual({ sourcing: ["paused", "2026-11-04T09:00:00Z"], support: ["paused", "2026-11-02T10:00:00Z"], treasury: ["paused", "2026-11-04T09:00:00Z"] });
  });
});

describe("what a decision came to", () => {
  it("paid, declined, asked (a proposal, a decline met with a proposal, an invoice sent to the CFO) or a note", () => {
    const o = (event: string, p: unknown = {}) => outcomeOf({ event, payload_json: JSON.stringify(p) });
    expect(o("card.charge_approved")).toBe("paid");
    expect(o("card.charge_declined")).toBe("declined");
    expect(o("proposal.created")).toBe("asked");
    expect(o("card.decline_met", { proposal_id: "P-1" })).toBe("asked");
    expect(o("card.decline_met", {})).toBe("note");
    expect(o("ap.status", { to: "waiting_cfo" })).toBe("asked");
    expect(o("ap.status", { to: "paid" })).toBe("note");
    expect(outcomeOf({ event: "ap.status", payload_json: "not json" })).toBe("note");
  });
});

describe("an invoice's journal", () => {
  it("none for an invoice the company does not have; an empty list for one nothing books yet", async () => {
    const db = new TenantDb(c.env.sql, t.id);
    expect(await journalOf(db, "AP-NOPE")).toBeNull();
    await insert("invoices", { tenant_id: t.id, id: "AP-1", vendor: "V", total: "1.00", currency: "EUR", body_json: "{}", received_at: "2026-11-01T00:00:00Z" });
    expect(await journalOf(db, "AP-1")).toEqual([]);
  });
});
