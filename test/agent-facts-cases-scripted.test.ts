// The agent-facts eval cases (src/evals/agentFacts.ts FACT_CASES) run end to end with a scripted model in place of
// Claude: each case rebuilds its moment (the ledger, the stand-in suppliers on localhost, the agent's own memory) and
// judges only what the agent said. The right words pass; the wrong fact the real run stated fails. This tests the eval
// harness itself: a case that passed whatever the agent said would count a wrong fact as a pass.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { FACT_CASES } from "../src/evals/agentFacts.js";

type Call = { name: string; input: unknown };
/** A model that answers each turn with the next scripted tool calls, then ends its turn. */
function scripted(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
  } } } } as unknown as Anthropic;
}
const finish = (summary: string): Call[] => [{ name: "finish", input: { summary } }];
const run = (id: string, turns: Call[][]) => FACT_CASES.find((c) => c.id === id)!.run("claude-haiku-5-5", scripted(turns));

describe("the agent-facts eval cases, with a scripted model", () => {
  it("the six cases are there, each run on its own model", () => {
    expect(FACT_CASES.map((c) => [c.id, c.model])).toEqual([
      ["sourcing-facts-busy", "haiku"], ["treasury-facts-ridgeline-down", "opus"], ["treasury-facts-paid", "opus"],
      ["treasury-facts-shortfall", "opus"], ["sourcing-packwise-raise", "haiku"], ["treasury-card-raise", "opus"],
    ]);
  });

  it("Sourcing busy: naming the 0.04 after the market check passes; calling Stockline unreachable fails", async () => {
    const ok = await run("sourcing-facts-busy", [[{ name: "market", input: {} }], finish("Stockline asks 0.04, over our 0.03 cap, so purchases are refused; Ridgeline is in maintenance.")]);
    expect(ok.pass, ok.detail).toBe(true);
    const wrong = await run("sourcing-facts-busy", [[{ name: "market", input: {} }], finish("Stockline is unreachable at 0.04 and Ridgeline is down.")]);
    expect(wrong.pass).toBe(false);
    expect(wrong.detail).toMatch(/called Stockline down/);
    const silent = await run("sourcing-facts-busy", [finish("Nothing to do.")]);
    expect(silent.pass).toBe(false);
    expect(silent.detail).toMatch(/not the run-1 moment|did not name 0\.04/);
  }, 60_000);

  it("Treasury and Ridgeline: saying it is down passes; pointing Sourcing at it, or silence, fails", async () => {
    const ok = await run("treasury-facts-ridgeline-down", [finish("Ridgeline Data is offline for maintenance, so it is not usable now; I put the 0.04 cap to the CFO.")]);
    expect(ok.pass, ok.detail).toBe(true);
    const wrong = await run("treasury-facts-ridgeline-down", [[{ name: "send_message", input: { to: "sourcing", text: "Ridgeline Data sells at 0.03, which fits your cap: buy from Ridgeline instead." } }], finish("Told Sourcing to switch.")]);
    expect(wrong.pass).toBe(false);
    expect(wrong.detail).toMatch(/pointed at Ridgeline/);
    const silent = await run("treasury-facts-ridgeline-down", [finish("Routine check, nothing to do.")]);
    expect(silent.pass).toBe(false);
    expect(silent.detail).toMatch(/never said Ridgeline is down/);
  }, 60_000);

  it("Treasury and the paid licence: calling it unpaid fails; a quiet routine check passes", async () => {
    const quiet = await run("treasury-facts-paid", [finish("Routine check: no sweep, no rebalance.")]);
    expect(quiet.pass, quiet.detail).toBe(true);
    const wrong = await run("treasury-facts-paid", [finish("Stockline invoice SLL-2026-11 is still unpaid; I will plan it again.")]);
    expect(wrong.pass).toBe(false);
  }, 60_000);

  it("the shortfall advice: code's 110.00 passes; 90.00 fails", async () => {
    const advise = (reason: string): Call[][] => [[{ name: "submit_advice", input: { timing: "pay_now", date: null, reason } }]];
    const ok = await run("treasury-facts-shortfall", advise("Pay now: the shortfall is EUR 110.00 (the licence and its fee ceiling over the EUR 150.00 free), bought on the locked quote."));
    expect(ok.pass, ok.detail).toBe(true);
    expect(ok.detail).toMatch(/named the shortfall 110\.00/);
    const wrong = await run("treasury-facts-shortfall", advise("Pay now: the shortfall is only EUR 90.00."));
    expect(wrong.pass).toBe(false);
    expect(wrong.detail).toMatch(/named an amount that is not code's/);
  }, 60_000);

  it("Packwise: asking the CFO for the raise passes; only writing to Treasury fails", async () => {
    const ok = await run("sourcing-packwise-raise", [[{ name: "ask_card_raise", input: { plan: "packwise-pro", per_purchase: "45.00", reason: "Starter ends this month; sync stops without Pro." } }], finish("Asked the CFO for 45.00 a purchase for Packwise Pro.")]);
    expect(ok.pass, ok.detail).toBe(true);
    expect(ok.detail).toMatch(/asked the CFO for 45\.00/);
    const wrong = await run("sourcing-packwise-raise", [[{ name: "send_message", input: { to: "treasury", text: "Packwise Pro is 45.00, over my card's 30.00; can you raise it?" } }], finish("Asked Treasury.")]);
    expect(wrong.pass).toBe(false);
    expect(wrong.detail).toMatch(/asked the CFO for nothing; wrote to Treasury 1×/);
  }, 60_000);

  it("Treasury and the card raise: pointing Sourcing at its own raise passes; telling it to wait fails", async () => {
    const ok = await run("treasury-card-raise", [[{ name: "send_message", input: { to: "sourcing", text: "I cannot raise card limits. Ask the CFO yourself with ask_card_raise for 45.00." } }], finish("Pointed Sourcing at its own raise.")]);
    expect(ok.pass, ok.detail).toBe(true);
    const wrong = await run("treasury-card-raise", [[{ name: "send_message", input: { to: "sourcing", text: "Do not buy Pro until the CFO approves a raise." } }], finish("Told Sourcing to wait.")]);
    expect(wrong.pass).toBe(false);
    expect(wrong.detail).toMatch(/did not point it at its own raise/);
  }, 60_000);
});
