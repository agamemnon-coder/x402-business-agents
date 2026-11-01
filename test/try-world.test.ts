// D21: /try "change the world". The visitor picks a world change; the Sourcing agent decides with the same brief, rules,
// tool schema and code check as the autonomy runtime. Here the model is a STAND-IN (test only, never the real API): it
// plays scripted tool calls, so these tests check what code does with them, not what Claude would decide.
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/agents/sourcing.js";
import { apiInputSchema } from "../src/agents/toolSchema.js";
import { BUY_POLICY_INPUT, SOURCING_DISPLAY, SOURCING_GOAL, SOURCING_RULES, sourcingBrief, systemFor } from "../src/autonomy/sourcingCore.js";
import { SAME, suppliersOf } from "../src/autonomy/worldSpecs.js";
import { START_POLICY, tryWorld, WORLD_CHANGES, worldChange, type AgentAsk, type AgentRequest } from "../src/try/world.js";

const NOW = new Date("2026-11-05T10:00:00Z");
type Use = { name: string; input: Record<string, unknown> };

/** A stand-in model: each call answers with the next scripted tool calls (test only). */
function scripted(turns: Use[][], seen: AgentRequest[] = []): AgentAsk {
  let i = 0;
  return async (req) => {
    seen.push(structuredClone(req));
    const uses = turns[i++] ?? [];
    return {
      content: uses.map((u, k) => ({ type: "tool_use" as const, id: `t${i}-${k}`, name: u.name, input: u.input })),
      stop_reason: uses.length ? "tool_use" : "end_turn", model: "stand-in", ms: 1, costUsd: 0.0001,
    };
  };
}
const finish = (summary = "done"): Use => ({ name: "finish", input: { summary } });

describe("/try: the visitor changes the world, the Sourcing agent decides", () => {
  it("offers five world changes, each one of the variation eval's worlds", () => {
    expect(WORLD_CHANGES.map((w) => w.id)).toEqual(["price-rise", "ridgeline-flaky", "cap-raised", "stockline-back", "ridgeline-cheap-fresh"]);
    expect(worldChange("price-rise")!.spec).toEqual(SAME);
    expect(worldChange("drain-the-treasury")).toBeUndefined();
    expect(START_POLICY).toEqual(DEFAULT_POLICY);
  });

  it("asks in the runtime's own words: its system prompt, its brief, the event, the tool schema", async () => {
    const seen: AgentRequest[] = [];
    await tryWorld("price-rise", scripted([[finish()]], seen), NOW, "");
    const req = seen[0]!;
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.system).toBe(systemFor(SOURCING_DISPLAY, SOURCING_GOAL, SOURCING_RULES));
    const first = req.messages[0]!.content as string;
    expect(first).toContain(sourcingBrief({ suppliers: suppliersOf(SAME), capCents: 3, budgetLeftCents: 900, sellCents: 5, policy: DEFAULT_POLICY, card: null }));
    expect(first).toContain("- event #1 upstream.refused: ");
    expect(first).toContain("mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment");
    expect(req.tools.find((t) => t.name === "set_buy_policy")!.input_schema).toEqual(apiInputSchema(BUY_POLICY_INPUT));
    expect(req.tools.map((t) => t.name)).toEqual(["market", "set_buy_policy", "send_message", "finish"]);
  });

  it("applies a policy code allows, shows each tool call and the message to Treasury", async () => {
    const r = await tryWorld("price-rise", scripted([
      [{ name: "market", input: {} }],
      [{ name: "set_buy_policy", input: { supplier: "ridgeline", max_price: "0.03", cache_seconds: 120, reason: "Stockline is over my cap" } },
        { name: "send_message", input: { to: "treasury", text: "Stockline now costs 0.04; my cap is 0.03." } }],
      [finish("Switched to Ridgeline and told Treasury.")],
    ]), NOW, "");
    expect(r.source).toBe("claude");
    expect(r.steps.map((s) => [s.tool, s.blocked])).toEqual([["market", null], ["set_buy_policy", null], ["send_message", null], ["finish", null]]);
    expect(r.policy_before).toBe("buy from Stockline up to the mandate's cap, no cache");
    expect(r.policy_after).toBe("buy from Ridgeline Data up to 0.03, serve a cached stock check up to 120 s old");
    expect(r.messages).toEqual([{ to: "treasury", text: "Stockline now costs 0.04; my cap is 0.03." }]);
    expect(r.summary).toBe("Switched to Ridgeline and told Treasury.");
    expect(r.demo).toMatch(/demo world.*no money/i);
  });

  it("red team: a policy over the cap or under the margin is refused by the same code check, and nothing changes", async () => {
    const r = await tryWorld("price-rise", scripted([
      [{ name: "set_buy_policy", input: { supplier: "stockline", max_price: "0.04", cache_seconds: 0, reason: "keep Stockline" } }],
      [{ name: "set_buy_policy", input: { supplier: "stockline", max_price: null, cache_seconds: 0, reason: "x" } }],
      [finish()],
    ]), NOW, "");
    expect(r.steps[0]).toMatchObject({ tool: "set_buy_policy", blocked: "over the cap" });
    expect(r.policy_after).toBe(r.policy_before);
    const thin = await tryWorld("cap-raised", scripted([[{ name: "set_buy_policy", input: { supplier: "stockline", max_price: "0.04", cache_seconds: 0, reason: "x" } }], [finish()]]), NOW, "");
    expect(thin.steps[0]!.blocked).toBeNull();
  });

  it("red team: an input outside the schema runs nothing", async () => {
    const r = await tryWorld("price-rise", scripted([
      [{ name: "set_buy_policy", input: { supplier: "ridgeline", max_price: "0.03", cache_seconds: 99_999, reason: "long cache" } }],
      [{ name: "drain_treasury", input: {} }],
      [finish()],
    ]), NOW, "");
    expect(r.steps.slice(0, 2).map((s) => s.blocked)).toEqual(["schema", "unknown tool"]);
    expect(r.policy_after).toBe(r.policy_before);
  });

  it("two messages per wake at most, as in the runtime", async () => {
    const msg = (t: string): Use => ({ name: "send_message", input: { to: "treasury", text: t } });
    const r = await tryWorld("price-rise", scripted([[msg("a"), msg("b"), msg("c")], [finish()]]), NOW, "");
    expect(r.messages.map((m) => m.text)).toEqual(["a", "b"]);
    expect(r.steps[2]!.blocked).toBe("message limit");
  });

  it("without a model, code decides as the runtime's fallback does, and says why", async () => {
    const r = await tryWorld("price-rise", null, NOW, "today's budget for model calls is spent");
    expect(r).toMatchObject({ source: "code", why: "today's budget for model calls is spent", summary: "kept the buy policy and told the Treasury agent about the refusal (code's message)", costUsd: 0 });
    expect(r.messages[0]!.text).toMatch(/^A purchase was refused over my mandate's cap/);
    const calm = await tryWorld("stockline-back", null, NOW, "no key");
    expect(calm).toMatchObject({ source: "code", summary: "kept the buy policy as it was", messages: [] });
  });

  it("a model that never finishes, or fails, falls back to code; what it already set stays (as in the runtime)", async () => {
    const loops = await tryWorld("price-rise", scripted(Array.from({ length: 10 }, () => [{ name: "market", input: {} }])), NOW, "");
    expect(loops.source).toBe("code");
    expect(loops.calls).toBe(5);
    const boom: AgentAsk = async () => { throw new Error("the model answered HTTP 529"); };
    const failed = await tryWorld("price-rise", boom, NOW, "");
    expect(failed).toMatchObject({ source: "code", why: "the model answered HTTP 529" });
  });
});

describe("the real call behind it (fetch), checked against a fake fetch (test only)", () => {
  it("asks as the runtime does: strict tools, the system prompt cached, effort medium; reads tool calls and the cost", async () => {
    const { claudeAgentAsk } = await import("../src/try/claude.js");
    let sent: Record<string, unknown> = {};
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 100 },
        content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "x1", name: "finish", input: { summary: "ok" } }, { type: "server_thing", foo: 1 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await claudeAgentAsk("k", fake)({ model: "claude-haiku-5-5", system: "S", tools: [{ name: "finish", description: "d", input_schema: { type: "object" } }], messages: [{ role: "user", content: "hi" }] });
    expect(sent).toMatchObject({ model: "claude-haiku-5-5", system: [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }], tools: [{ name: "finish", strict: true }], output_config: { effort: "medium" } });
    expect(r.content).toEqual([{ type: "text", text: "Checking." }, { type: "tool_use", id: "x1", name: "finish", input: { summary: "ok" } }]);
    expect(r.costUsd).toBeGreaterThan(0);
    const down = (async () => new Response("{}", { status: 529 })) as unknown as typeof fetch;
    await expect(claudeAgentAsk("k", down)({ model: "m", system: "S", tools: [], messages: [] })).rejects.toThrow("HTTP 529");
  });
});
