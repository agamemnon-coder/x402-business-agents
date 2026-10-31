// The Treasury agent designs the rebalance after a supplier's price rise (Opus, with a tool), and code decides
// whether the plan may go to the CFO: the 20.00 total, the cap against the new price, room for what was already
// spent, Support's refund budget, Treasury's sweep, a positive margin. A rejected plan goes back with its reasons,
// at most three tries; then the fixed plan from code. Fake client only.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { checkPricePlan, designPriceRise, fallbackPricePlan, type PricePlanFacts } from "../src/agents/treasuryAgent.js";

const facts: PricePlanFacts = {
  sellCents: 5, oldUpstreamCents: 2, newUpstreamCents: 4, refusal: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment",
  mandates: [
    { agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 80 },
    { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 },
    { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 0 },
  ],
};
const good = { sourcing_cap: "0.04", sourcing_budget: "12.00", support_budget: "4.00", treasury_budget: "4.00", options: [{ label: "keep the price", sell_price: "0.05" }, { label: "raise the price", sell_price: "0.07" }], advice: "Raise to 0.07: it restores the 0.03 margin." };

function fake(inputs: unknown[]): { client: Anthropic; sent: { messages: { role: string; content: unknown }[] }[] } {
  const sent: { messages: { role: string; content: unknown }[] }[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        create: async (params: { messages: { role: string; content: unknown }[] }) => {
          sent.push(JSON.parse(JSON.stringify(params)));
          const input = inputs[i++];
          const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
          if (input === undefined) return { content: [{ type: "text", text: "I have nothing more to add." }], stop_reason: "end_turn", model: "claude-opus-5-5", usage };
          return { content: [{ type: "text", text: "Here is my plan." }, { type: "tool_use", id: `t${i}`, name: "submit_plan", input }], stop_reason: "tool_use", model: "claude-opus-5-5", usage };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

describe("the Treasury agent's plan, checked by code", () => {
  it("accepts a plan inside every limit", () => {
    expect(checkPricePlan(facts, fallbackPricePlan(facts))).toEqual([]);
  });

  it("refuses a plan over the 20.00 total", () => {
    const p = checkPricePlan(facts, { ...fallbackPricePlan(facts), targets: [{ agent: "sourcing", capCents: 4, budgetCents: 1300 }, { agent: "support", capCents: 10, budgetCents: 400 }, { agent: "treasury", capCents: 400, budgetCents: 400 }] });
    expect(p.join(" ")).toMatch(/20\.00/);
  });

  it("refuses a cap below the new price, and a budget that does not cover what was spent plus one purchase", () => {
    const low = checkPricePlan(facts, { ...fallbackPricePlan(facts), targets: [{ agent: "sourcing", capCents: 3, budgetCents: 1200 }, { agent: "support", capCents: 10, budgetCents: 400 }, { agent: "treasury", capCents: 400, budgetCents: 400 }] });
    expect(low.join(" ")).toMatch(/0\.04/);
    const spent = checkPricePlan(facts, { ...fallbackPricePlan(facts), targets: [{ agent: "sourcing", capCents: 4, budgetCents: 83 }, { agent: "support", capCents: 10, budgetCents: 400 }, { agent: "treasury", capCents: 400, budgetCents: 400 }] });
    expect(spent.join(" ")).toMatch(/already spent/);
  });

  it("keeps Support's refund budget and room for Treasury's sweep", () => {
    const support = checkPricePlan(facts, { ...fallbackPricePlan(facts), targets: [{ agent: "sourcing", capCents: 4, budgetCents: 1500 }, { agent: "support", capCents: 10, budgetCents: 100 }, { agent: "treasury", capCents: 400, budgetCents: 400 }] });
    expect(support.join(" ")).toMatch(/Support/);
    const treasury = checkPricePlan(facts, { ...fallbackPricePlan(facts), targets: [{ agent: "sourcing", capCents: 4, budgetCents: 1500 }, { agent: "support", capCents: 10, budgetCents: 400 }, { agent: "treasury", capCents: 100, budgetCents: 100 }] });
    expect(treasury.join(" ")).toMatch(/sweep/);
  });

  // dry-run evals: with Treasury's cap equal to its budget, "budget covers spent + one payment at its cap" could
  // never hold once Treasury had swept anything; Opus and Sonnet both said so. Treasury only needs room to sweep.
  it("accepts a plan once Treasury has already swept something", () => {
    const swept: PricePlanFacts = { ...facts, mandates: [{ agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 900 }, { agent: "support", capCents: 10, budgetCents: 400, spentCents: 15 }, { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 105 }] };
    expect(checkPricePlan(swept, { ...fallbackPricePlan(swept), targets: [{ agent: "sourcing", capCents: 4, budgetCents: 1200 }, { agent: "support", capCents: 10, budgetCents: 400 }, { agent: "treasury", capCents: 400, budgetCents: 400 }] })).toEqual([]);
  });

  it("sets Sourcing's cap at exactly the new price, so the next rise comes back to a person", () => {
    const p = checkPricePlan(facts, { ...fallbackPricePlan(facts), targets: [{ agent: "sourcing", capCents: 20, budgetCents: 1200 }, { agent: "support", capCents: 10, budgetCents: 400 }, { agent: "treasury", capCents: 400, budgetCents: 400 }] });
    expect(p.join(" ")).toMatch(/exactly Stockline's new price/);
  });

  it("keeps Support's budget exactly as it is: it neither shrinks nor grows", () => {
    const p = checkPricePlan(facts, { ...fallbackPricePlan(facts), targets: [{ agent: "sourcing", capCents: 4, budgetCents: 1000 }, { agent: "support", capCents: 10, budgetCents: 800 }, { agent: "treasury", capCents: 200, budgetCents: 200 }] });
    expect(p.join(" ")).toMatch(/Support's mandate stays as it is/);
  });

  it("never shrinks the Sourcing budget: it pays for every query", () => {
    const p = checkPricePlan(facts, { ...fallbackPricePlan(facts), targets: [{ agent: "sourcing", capCents: 4, budgetCents: 100 }, { agent: "support", capCents: 10, budgetCents: 400 }, { agent: "treasury", capCents: 600, budgetCents: 600 }] });
    expect(p.join(" ")).toMatch(/Sourcing's budget may not shrink/);
  });

  it("refuses an option that sells at a loss, or the same price twice", () => {
    const loss = checkPricePlan(facts, { ...fallbackPricePlan(facts), options: [{ id: "A", label: "cheap", sellCents: 4 }] });
    expect(loss.join(" ")).toMatch(/margin/);
    const twice = checkPricePlan(facts, { ...fallbackPricePlan(facts), options: [{ id: "A", label: "x", sellCents: 7 }, { id: "B", label: "y", sellCents: 7 }] });
    expect(twice.join(" ")).toMatch(/twice/);
  });
});

describe("designPriceRise", () => {
  it("uses Opus's plan when code accepts it, with Opus's advice", async () => {
    const db = openDb(":memory:");
    const d = await designPriceRise(db, facts, fake([good]).client);
    expect(d.source).toBe("claude");
    expect(d.plan.targets.find((t) => t.agent === "sourcing")).toEqual({ agent: "sourcing", capCents: 4, budgetCents: 1200 });
    expect(d.plan.options.map((o) => [o.id, o.sellCents])).toEqual([["A", 5], ["B", 7]]);
    expect(d.plan.advice).toMatch(/0\.07/);
  });

  it("sends a rejected plan back with code's reasons, and takes the corrected one", async () => {
    const db = openDb(":memory:");
    const { client, sent } = fake([{ ...good, sourcing_budget: "13.00" }, good]);
    const d = await designPriceRise(db, facts, client);
    expect(d.source).toBe("claude");
    expect(d.attempts).toBe(2);
    expect(JSON.stringify(sent[1]!.messages.at(-1))).toMatch(/20\.00/);
  });

  it("falls back to code's fixed plan after three rejected plans", async () => {
    const db = openDb(":memory:");
    const bad = { ...good, sourcing_cap: "0.03" };
    const d = await designPriceRise(db, facts, fake([bad, bad, bad, bad]).client);
    expect(d.source).toBe("fallback");
    expect(d.plan).toEqual(fallbackPricePlan(facts));
  });

  it("falls back to the fixed plan without a client", async () => {
    const db = openDb(":memory:");
    const d = await designPriceRise(db, facts, null);
    expect(d).toMatchObject({ source: "fallback", plan: fallbackPricePlan(facts) });
  });

  it("falls back when Opus ends without submitting a plan", async () => {
    const db = openDb(":memory:");
    const d = await designPriceRise(db, facts, fake([]).client);
    expect(d.source).toBe("fallback");
  });
});
