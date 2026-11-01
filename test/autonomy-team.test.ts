// D19 block 4: the autonomous Treasury and Support agents. Treasury designs a rebalance only when an agent is blocked by
// its mandate (a refusal over a cap) and nothing already waits for the CFO; it may also decide to do nothing. Support
// settles a dispute once. Breaks if Treasury can stack proposals or act on nothing, or Support settles twice.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/open.js";
import { audit } from "../src/audit/log.js";
import { publish, sendMessage } from "../src/autonomy/bus.js";
import { wake } from "../src/autonomy/runtime.js";
import { createProposal } from "../src/policy/approvals.js";
import { TERMS_SCHEMA } from "../src/lib/terms.js";

vi.mock("../src/agents/treasury.js", async (orig) => ({ ...(await orig<object>()), mandatesNow: async () => new Map([
  ["sourcing", { now: { agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 80 } }],
  ["support", { now: { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 } }],
  ["treasury", { now: { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 0 } }],
]) }));
const { supportProfile, treasuryProfile } = await import("../src/autonomy/teamProfiles.js");

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-opus-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-opus-5-5", usage };
  } } } } as unknown as Anthropic;
}
const T0 = new Date();
const finish = (s: string) => ({ name: "finish", input: { summary: s } });

describe("the autonomous Treasury agent", () => {
  it("designs no rebalance when no agent is blocked by its mandate, and may decide to do nothing", async () => {
    const db = openDb(":memory:");
    sendMessage(db, "sourcing", "treasury", "All fine, just saying hello.", T0);
    const w = await wake(db, treasuryProfile(), { client: fake([[{ name: "design_rebalance", input: { reason: "why not" } }], [finish("Nothing to do: no agent is blocked.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ blocked: "no need" });
    expect(w).toMatchObject({ source: "claude", summary: "Nothing to do: no agent is blocked." });
  });

  it("does not stack a rebalance on one already waiting for the CFO", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', 'mandate_cap_exceeded: 0.04 is over the sourcing mandate''s 0.03 a payment', ?)").run(T0.toISOString());
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: "P-0001", expires_at: new Date(T0.getTime() + 900_000).toISOString().replace(/\.\d{3}Z$/, "Z") }, createdBy: "treasury" }, T0);
    sendMessage(db, "sourcing", "treasury", "Stockline is at 0.04, over my cap.", T0);
    const w = await wake(db, treasuryProfile(), { client: fake([[{ name: "design_rebalance", input: { reason: "Sourcing is blocked" } }], [finish("P-0001 already waits.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ blocked: "already waiting" });
  });
});

describe("the autonomous Support agent", () => {
  it("does not settle a dispute twice in half an hour", async () => {
    const db = openDb(":memory:");
    audit(db, "support", "dispute.settled_by_agent", "D-1", { source: "claude" }, T0);
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    const w = await wake(db, supportProfile(), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Already settled.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ blocked: "already settled" });
  });
});
