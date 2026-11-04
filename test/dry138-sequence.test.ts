// dry-138, kept as a fixed case (Max, 2 November). The order of events that stalled the shop: Stockline's price rises
// over the Sourcing agent's cap; Sourcing pauses buying and asks Treasury for a higher cap; Treasury wakes before any
// customer is turned away, so code holds its rebalance ("no need"); then customers are turned away, the third one wakes
// Treasury, and now code lets the design through to the CFO. Breaks if Treasury can design on Sourcing's word alone,
// if the turned-away customers do not wake it, or if code still says "no need" once they are on record.
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/open.js";
import { sendMessage, pending } from "../src/autonomy/bus.js";
import { wake } from "../src/autonomy/runtime.js";
import { SourcingAgent } from "../src/agents/sourcing.js";

vi.mock("../src/agents/treasury.js", async (orig) => ({ ...(await orig<object>()), mandatesNow: async () => new Map([
  ["sourcing", { now: { agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 2 } }],
  ["support", { now: { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 } }],
  ["treasury", { now: { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 0 } }],
]) }));
const { treasuryProfile, setSupplierPrice } = await import("../src/autonomy/teamProfiles.js");

function designing(): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (i++ === 0) return { content: [{ type: "tool_use", id: "t1", name: "design_rebalance", input: { reason: "Sourcing asked for a 0.04 cap" } }], stop_reason: "tool_use", model: "claude-opus-5-5", usage };
    return { content: [{ type: "tool_use", id: "t2", name: "finish", input: { summary: "done" } }], stop_reason: "tool_use", model: "claude-opus-5-5", usage };
  } } } } as unknown as Anthropic;
}

const env = { ...process.env };
beforeEach(() => { process.env.KIT11_AGENTS = "on"; process.env.KIT11_AUTONOMY = "on"; });
afterEach(() => { process.env = { ...env }; });

describe("dry-138's order of events", () => {
  it("holds Treasury's rebalance on Sourcing's word, wakes it when customers are turned away, then lets it through", async () => {
    const db = openDb(":memory:");
    setSupplierPrice(db, "stockline", "0.04");
    // Sourcing pauses buying and asks for a higher cap.
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('sourcing.buy_policy', ?, ?)").run(JSON.stringify({ supplier: "none", max_price: null, cache_seconds: 0, set_by: "sourcing", reason: "Stockline over my cap" }), new Date().toISOString());
    sendMessage(db, "sourcing", "treasury", "Stockline is at 0.04, over my 0.03 cap; please raise it to 0.04.", new Date(), "claude");

    // Treasury wakes on the message, before any customer was turned away: code holds the design.
    const first = await wake(db, treasuryProfile(), { client: designing() });
    expect(first!.run!.calls[0]).toMatchObject({ tool: "design_rebalance", blocked: "no need" });

    // The shop runs on: three customers are turned away, and the third wakes Treasury.
    const shop = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
    for (const seq of [1, 2, 3]) await shop.buy(seq);
    expect(pending(db, "treasury").events.map((e) => e.kind)).toContain("customers.turned_away");

    // Now code's evidence is on record: the design is no longer held as "no need" (it goes on to plan the options).
    const second = await wake(db, treasuryProfile(), { client: designing() });
    expect(second!.run!.calls[0]!.tool).toBe("design_rebalance");
    expect(second!.run!.calls[0]!.blocked).not.toBe("no need");
  });
});
