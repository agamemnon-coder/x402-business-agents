// D19 block 3: the autonomous Sourcing agent has real choices (two suppliers, cache, not buying) and sets the buy policy
// that code follows per query. Code refuses a policy over the mandate's cap or below the goal margin, and a supplier it
// does not have. Without Claude the policy stays and a refusal over the cap goes to Treasury in code's words. Breaks if
// a policy outside those bounds is stored, or the agent can reach its mandate. Fake client and a stand-in world.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { pending, publish } from "../src/autonomy/bus.js";
import { wake } from "../src/autonomy/runtime.js";
import { sourcingProfile, type SourcingWorld } from "../src/autonomy/sourcingProfile.js";
import { buyPolicy } from "../src/agents/sourcing.js";

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
  } } } } as unknown as Anthropic;
}
const world = (stockline = 4): SourcingWorld => ({
  suppliers: async () => [
    { id: "stockline", name: "Stockline", price_cents: stockline, data_age_seconds: 5, available: true, last20: { paid: 40, refused: 1, unavailable: 0 } },
    { id: "ridgeline", name: "Ridgeline Data", price_cents: 3, data_age_seconds: 900, available: true, last20: { paid: 0, refused: 0, unavailable: 0 } },
  ],
  mandate: async () => ({ capCents: 3, budgetLeftCents: 920 }),
  sellCents: () => 5,
});
const T0 = new Date("2026-11-03T10:00:00Z");
const policy = (supplier: string, max: string | null, cache: number) => ({ name: "set_buy_policy", input: { supplier, max_price: max, cache_seconds: cache, reason: "Stockline is over my cap; Ridgeline fits." } });
const finish = { name: "finish", input: { summary: "Switched to Ridgeline with a 60 s cache; asked Treasury for a 0.04 cap." } };

describe("the autonomous Sourcing agent", () => {
  it("meets a refusal by choosing: switches supplier within its cap, caches, and asks Treasury", async () => {
    const db = openDb(":memory:");
    publish(db, "upstream.refused", { seq: 41, supplier: "stockline", reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment" }, "sourcing", "system", T0);
    const w = await wake(db, sourcingProfile(world()), { client: fake([[{ name: "market", input: {} }], [policy("ridgeline", "0.03", 60), { name: "send_message", input: { to: "treasury", text: "Stockline is at 0.04, over my 0.03 cap; I moved to Ridgeline (15-min-old data). A 0.04 cap would let me buy fresh again." } }], [finish]]), now: T0 });
    expect(w!.source).toBe("claude");
    expect(buyPolicy(db)).toMatchObject({ supplier: "ridgeline", max_price: "0.03", cache_seconds: 60, set_by: "sourcing" });
    expect(pending(db, "treasury").messages[0]!.text).toMatch(/0\.04/);
  });

  it("refuses a policy over the mandate's cap, or one that would buy below the goal margin", async () => {
    const db = openDb(":memory:");
    const w = await wake(db, sourcingProfile(world(5)), { client: fake([[policy("stockline", "0.05", 0)], [policy("stockline", null, 0)], [finish]]), now: T0, force: true });
    expect(w!.run!.calls.map((c) => c.blocked ?? "ok")).toEqual(["over the cap", "ok", "ok"]);
    const db2 = openDb(":memory:");
    const tight: SourcingWorld = { ...world(5), mandate: async () => ({ capCents: 5, budgetLeftCents: 900 }) };
    const w2 = await wake(db2, sourcingProfile(tight), { client: fake([[policy("stockline", "0.05", 0)], [finish]]), now: T0, force: true });
    expect(w2!.run!.calls[0]).toMatchObject({ blocked: "margin" });
    expect(buyPolicy(db2).supplier).toBe("stockline");
    expect(buyPolicy(db2).set_by).toBeUndefined();
  });

  it("may choose not to buy at all, or to serve from the cache", async () => {
    const db = openDb(":memory:");
    await wake(db, sourcingProfile(world()), { client: fake([[policy("none", null, 300)], [finish]]), now: T0, force: true });
    expect(buyPolicy(db)).toMatchObject({ supplier: "none", cache_seconds: 300 });
  });

  it("without Claude keeps the policy and tells Treasury about a refusal over the cap, labelled code", async () => {
    const db = openDb(":memory:");
    publish(db, "upstream.refused", { seq: 41, reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment" }, "sourcing", "system", T0);
    const w = await wake(db, sourcingProfile(world()), { client: null, now: T0 });
    expect(w).toMatchObject({ source: "fallback" });
    expect(pending(db, "treasury").messages).toHaveLength(1);
    expect(buyPolicy(db).set_by).toBeUndefined();
  });
});
