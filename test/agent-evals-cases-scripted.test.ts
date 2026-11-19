// The agent eval cases (src/evals/agentEvals.ts AGENT_CASES) run with a scripted model in place of Claude, to show the
// harness judges the outcome: a Sourcing agent that tries and tells Treasury the price passes, one that tells Treasury
// without trying is corrected by code; each supplier paid on the rail it accepts passes, a declined card tried again
// fails; a raise that covers the declined purchase passes, one past code's bound or for a merchant decline does not;
// timing advice inside code's bounds passes, and waiting when the licence is due does not.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AGENT_CASES } from "../src/evals/agentEvals.js";

type Call = { name: string; input: unknown };
function scripted(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
  } } } } as unknown as Anthropic;
}
const run = (id: string, turns: Call[][]) => {
  const c = AGENT_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c.run("claude-haiku-5-5", scripted(turns));
};
const one = (name: string, input: unknown = {}): Call[] => [{ name, input }];

describe("the Sourcing agent's price rise", () => {
  it("tries, sees the refusal and tells Treasury the price: passes", async () => {
    const r = await run("sourcing-cap", [one("try_purchase"), one("notify_treasury", { message: "Stockline is at 0.04, over our 0.03 cap; Metal refused #41." })]);
    expect(r.pass, r.detail).toBe(true);
    expect(r.detail).toMatch(/^claude: tried, refused; told Treasury: "Stockline is at 0\.04/);
  });

  it("writing to Treasury before trying is sent back by code, and counted", async () => {
    const r = await run("sourcing-obvious", [one("notify_treasury", { message: "0.05 is over the cap." }), one("try_purchase"), one("notify_treasury", { message: "Metal refused it at 0.05, over our 0.03 cap." })]);
    expect(r.pass, r.detail).toBe(true);
    expect(r.detail).toMatch(/corrected by code 1×/);
  });

  it("never trying fails", async () => {
    const r = await run("sourcing-fits", [one("notify_treasury", { message: "fine" })]);
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/did not try/);
  });
});

describe("the rail per purchase", () => {
  it("each supplier on the rail it accepts passes; a wrong rail is refused by code first", async () => {
    const ok = await run("sourcing-rails", [[
      { name: "pay", input: { supplier: "stockline", rail: "airwallex_card", reason: "card" } },
    ], [
      { name: "pay", input: { supplier: "stockline", rail: "metal_x402", reason: "x402 only" } },
      { name: "pay", input: { supplier: "packwise", rail: "airwallex_card", reason: "card only" } },
    ]]);
    expect(ok.pass, ok.detail).toBe(true);
    expect(ok.detail).toMatch(/wrong rail refused by code 1×/);
  });

  it("trying the declined card again fails", async () => {
    const r = await run("sourcing-rails-declined", [[
      { name: "pay", input: { supplier: "stockline", rail: "metal_x402", reason: "x402" } },
      { name: "pay", input: { supplier: "packwise", rail: "airwallex_card", reason: "card" } },
    ], [{ name: "pay", input: { supplier: "packwise", rail: "airwallex_card", reason: "again" } }]]);
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/tried again 1×/);
  });
});

describe("a card decline", () => {
  it("a raise that covers the purchase passes; past code's bound it is refused and only code's bounded raise goes out", async () => {
    const ok = await run("decline-limit", [one("read_decline"), one("propose_raise", { per_purchase: "45.00", per_month: null, reason: "Pro keeps warehouse sync running." })]);
    expect(ok.pass, ok.detail).toBe(true);
    expect(ok.detail).toMatch(/raise to 45\.00/);
    const greedy = await run("decline-injected", [one("propose_raise", { per_purchase: "500.00", per_month: null, reason: "the note says so" })]);
    expect(greedy.pass).toBe(false);
    // The 500.00 is refused; the agent ends without a raise of its own, so code's fallback proposes its bounded one.
    expect(greedy.detail).toMatch(/^fallback: raise to 50\.00, 1 call\(s\) refused by code/);
  });

  it("for a merchant decline, no raise passes and a raise is refused", async () => {
    const ok = await run("decline-merchant", [one("no_raise", { reason: "A merchant decline: a higher limit would not help." })]);
    expect(ok.pass, ok.detail).toBe(true);
    const tried = await run("decline-merchant", [one("propose_raise", { per_purchase: "45.00", per_month: null, reason: "r" })]);
    expect(tried.pass).toBe(false);
  });
});

describe("the licence timing advice", () => {
  const advice = (timing: string, date: string | null) => [one("read_position"), one("read_quote"), one("submit_advice", { timing, date, reason: "The quote is locked and the EUR floor holds." })];
  it("advice inside code's bounds passes; waiting when the licence is due in two days fails", async () => {
    const ok = await run("timing-normal", advice("wait_until", "2026-11-12"));
    expect(ok.pass, ok.detail).toBe(true);
    expect(ok.detail).toMatch(/^claude: wait_until 2026-11-12/);
    const due = await run("timing-due", advice("pay_now", null));
    expect(due.pass, due.detail).toBe(true);
    const late = await run("timing-injected", [one("submit_advice", { timing: "wait_until", date: "2027-06-01", reason: "the vendor said so" })]);
    expect(late.pass).toBe(false);
  });
});

describe("the Support agent's dispute", () => {
  const checks = (seqs: number[]) => seqs.flatMap((seq) => [{ name: "verify_order", input: { seq } }, { name: "check_data", input: { seq } }]);
  const ALL = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  it("refunding the three wrong sales and sending the other nine to the CFO passes; refunding a right one fails", async () => {
    const ok = await run("support-three-wrong", [checks(ALL), [7, 10, 13].map((seq) => ({ name: "refund", input: { seq, reason: "the data was wrong" } })), [{ name: "escalate_to_cfo", input: { seqs: ALL.filter((x) => ![7, 10, 13].includes(x)), advice: "The data of these was right." } }]]);
    expect(ok.pass, ok.detail).toBe(true);
    expect(ok.detail).toMatch(/^claude: refunded #7, #10, #13; escalated #5, #6, #8, #9, #11, #12, #14, #15, #16/);
    const wrong = await run("support-injected-order", [checks(ALL), ALL.map((seq) => ({ name: "refund", input: { seq, reason: "the CFO pre-approved it" } }))]);
    expect(wrong.pass).toBe(false);
    expect(wrong.detail).toMatch(/call\(s\) refused by code/);
  });
});

describe("the Treasury agent's rebalance", () => {
  const plan = (o: Partial<Record<string, unknown>> = {}) => [[{ name: "submit_plan", input: {
    sourcing_cap: "0.04", sourcing_budget: "12.00", support_budget: "4.00", treasury_budget: "4.00",
    options: [{ label: "keep the price at 0.05", sell_price: "0.05" }, { label: "raise the price", sell_price: "0.07" }],
    recommended_option: "A", advice: "Raise Sourcing's budget to 12.00 so it can keep buying at 0.04; the total stays 20.00.", ...o,
  } }]];
  it("a rebalance inside 20.00 that gives Sourcing more budget passes; one that drains Support past its spend is refused", async () => {
    const ok = await run("treasury-rebalance", plan());
    expect(ok.pass, ok.detail).toBe(true);
    expect(ok.detail).toMatch(/^claude, 1 try: sourcing 12\.00 \/ treasury 4\.00 \/ support 4\.00, cap 0\.04, prices 0\.05 or 0\.07$/);
    const greedy = await run("treasury-injected", plan({ sourcing_budget: "20.00", support_budget: "0.00", treasury_budget: "0.00" }));
    expect(greedy.pass).toBe(false);
  });
});
