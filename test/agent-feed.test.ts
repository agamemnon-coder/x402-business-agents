// What the CFO sees of the agents in the dashboard's feed: each agent's own words where it decided, in plain
// sentences with its model, and every call code refused; never a raw event name. Breaks if an agent row reaches the
// feed as "agent.tool …" (CLI text) or if a refused call stays hidden.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";

function world() {
  const db = openDb(":memory:");
  audit(db, "sourcing", "agent.tool", "price_rise.meet", { agent: "sourcing", model: "claude-haiku-5-5", tool: "check_offer", input: {}, result: "Live offer 0.04" });
  audit(db, "sourcing", "agent.tool", "price_rise.meet", { agent: "sourcing", model: "claude-haiku-5-5", tool: "try_purchase", input: {}, result: "refused", blocked_by: "Metal mandate" });
  audit(db, "sourcing", "agent.run", "price_rise.meet", { agent: "sourcing", model: "claude-haiku-5-5", status: "done", turns: 3, tools: ["check_offer", "try_purchase", "notify_treasury"], said: "", cost_usd_micros: 500, latency_ms: 6000 });
  audit(db, "sourcing", "price_rise.met", "41", { source: "claude", model: "claude-haiku-5-5", tried: true, refusal: "mandate_cap_exceeded", message: "Stockline now charges 0.04; my cap is 0.03, so Metal refused #41. I need a cap of 0.04." });
  audit(db, "treasury", "agent.run", "price_rise.plan", { agent: "treasury", model: "claude-opus-5-5", status: "done", turns: 1, tools: ["submit_plan"], said: "Here is my plan.", cost_usd_micros: 20000, latency_ms: 9000 });
  audit(db, "treasury", "price_rise.plan", null, { source: "claude", attempts: 1, model: "claude-opus-5-5", budgets: ["sourcing 12.00 (cap 0.04)", "treasury 4.00 (cap 4.00)", "support 4.00 (cap 0.10)"], options: ["A keep the price 0.05", "B raise the price 0.07"], advice: "Option B keeps the 0.03 margin." });
  audit(db, "support", "agent.tool", "dispute.D-1", { agent: "support", model: "claude-sonnet-5-5", tool: "refund", input: { seq: 5 }, result: "Refused", blocked_by: "no evidence of wrong data" });
  audit(db, "support", "dispute.settled_by_agent", "D-1", { source: "claude", model: "claude-sonnet-5-5", refunded: ["#7", "#10", "#13"], escalated: { proposal: "P-0004", sales: ["#5", "#6"] }, said: "I refunded the three wrong checks and sent the rest to the CFO." });
  return db;
}

describe("the agents in the CFO's feed", () => {
  it("shows each agent's decision in its own words, with its model", () => {
    const feed = buildSnapshot(world()).feed;
    const sourcing = feed.find((f) => f.event === "price_rise.met")!;
    expect(sourcing).toMatchObject({ model: "Haiku", text: expect.stringMatching(/^The Sourcing agent told the Treasury agent: "Stockline now charges 0\.04/) });
    const treasury = feed.find((f) => f.event === "price_rise.plan")!;
    expect(treasury).toMatchObject({ model: "Opus", text: expect.stringMatching(/Treasury agent planned .*12\.00.*accepted by code.*"Option B keeps the 0\.03 margin\."/) });
    const support = feed.find((f) => f.event === "dispute.settled_by_agent")!;
    expect(support).toMatchObject({ model: "Sonnet", text: expect.stringMatching(/Support agent refunded #7, #10, #13 itself and sent 2 to the CFO \(P-0004\)/) });
  });

  it("shows every call code refused, and hides the ones that simply went through", () => {
    const feed = buildSnapshot(world()).feed;
    const tools = feed.filter((f) => f.event === "agent.tool");
    expect(tools.map((t) => t.text)).toEqual([
      "Code refused the Support agent's refund: no evidence of wrong data",
      "Metal refused the Sourcing agent's purchase against its on-chain mandate",
    ]);
    expect(tools.every((t) => t.tone === "refusal")).toBe(true);
  });

  it("never shows a raw agent event name", () => {
    for (const f of buildSnapshot(world()).feed) expect(f.text).not.toMatch(/agent\.(run|tool)|price_rise\.|dispute\.settled/);
  });

  it("counts each agent's decisions and what they cost, for the dashboard", () => {
    const c = buildSnapshot(world()).claude;
    expect(c.agents).toEqual([
      { agent: "sourcing", model: "Haiku", runs: 1, cost_usd_micros: 500, median_latency_ms: 6000 },
      { agent: "treasury", model: "Opus", runs: 1, cost_usd_micros: 20000, median_latency_ms: 9000 },
    ]);
    expect(c.cost_usd_micros).toBe(20500);
  });
});
