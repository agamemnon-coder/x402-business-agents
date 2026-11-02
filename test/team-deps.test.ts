// D26: the Treasury and Support agents take their chain and flow calls as dependencies, so the variation test can run
// them on simulated rails with every check of code in place. Breaks if a tool or a fallback still reaches the chain, a
// key or a child process when stand-ins are given, or if the rebalance design ignores the client it was handed.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { publish, sendMessage } from "../src/autonomy/bus.js";
import { wake } from "../src/autonomy/runtime.js";
import { supportProfile, treasuryProfile } from "../src/autonomy/teamProfiles.js";
import type { MandateNow } from "../src/policy/mandates.js";

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic & { asked: number } {
  const f = { asked: 0, beta: { messages: { create: async () => {
    const t = turns[f.asked++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-opus-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${f.asked}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-opus-5-5", usage };
  } } } };
  return f as unknown as Anthropic & { asked: number };
}
const T0 = new Date();
const finish = (s: string) => ({ name: "finish", input: { summary: s } });
const MANDATES: MandateNow[] = [
  { agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 80 },
  { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 },
  { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 0 },
];
const noFlow = () => { throw new Error("no child process in the sim"); };

describe("Treasury on injected rails (D26)", () => {
  it("designs a rebalance with the given client and mandates, and files it through the given stand-in", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', 'mandate_cap_exceeded: 0.04 is over the sourcing mandate''s 0.03 a payment', ?)").run(T0.toISOString());
    sendMessage(db, "sourcing", "treasury", "Stockline is at 0.04, over my cap.", T0);
    const filed: number[] = [];
    // The design's own Claude run gets this client: it submits nothing, so code's fixed plan is used (labelled).
    const design = fake([]);
    const w = await wake(db, treasuryProfile(30 * 60_000, {
      runFlow: noFlow, mandates: async () => MANDATES, client: design,
      proposePriceRise: async (_db, sell, ev) => { filed.push(sell, ev.liveOfferCents); return [{ proposal_id: "P-0001" }, { proposal_id: "P-0002" }]; },
    }), { client: fake([[{ name: "design_rebalance", input: { reason: "Sourcing is blocked" } }], [finish("Sent options to the CFO.")]]), now: T0 });
    expect(w!.run!.calls[0]!.text).toContain("P-0001 and P-0002");
    expect(design.asked).toBeGreaterThan(0);
    expect(filed).toEqual([5, 2]);
  });

  it("its fallback answers a refusal through the stand-ins too", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', 'mandate_cap_exceeded: 0.04 is over the sourcing mandate''s 0.03 a payment', ?)").run(T0.toISOString());
    sendMessage(db, "sourcing", "treasury", "Refused over my cap.", T0);
    const w = await wake(db, treasuryProfile(30 * 60_000, { runFlow: noFlow, mandates: async () => MANDATES, client: null, proposePriceRise: async () => [{ proposal_id: "P-0009" }] }), { client: null, now: T0 });
    expect(w).toMatchObject({ source: "fallback", summary: "code's fixed plan went to the CFO as P-0009" });
  });
});

describe("Support on injected rails (D26)", () => {
  it("settle_dispute and the fallback run the given settlement, not the s2 child process", async () => {
    const db = openDb(":memory:");
    const by: string[] = [];
    const settle = async (_db: unknown, who: "agent" | "code") => { by.push(who); return { ok: true, text: "refunded #7" }; };
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    const w = await wake(db, supportProfile(30 * 60_000, { settle }), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Settled.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ text: "refunded #7" });
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", new Date(T0.getTime() + 1));
    const f = await wake(db, supportProfile(30 * 60_000, { settle }), { client: null, now: T0 });
    expect(f).toMatchObject({ source: "fallback", summary: "code settled the dispute (the agent did not decide)" });
    expect(by).toEqual(["agent", "code"]);
  });
});
