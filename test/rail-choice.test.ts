// Block 5.1: the Sourcing agent picks the rail per purchase. Two purchases: a stock check from Stockline (x402 on Metal
// only) and Packwise's Starter plan (its card checkout only: a monthly subscription, so the agent's own Airwallex card,
// not a single-use one). Code checks that the supplier accepts the rail before anything is paid; a wrong rail is
// refused with the reason, and the agent can try again. Breaks if a wrong rail reaches a payment, if a supplier is paid
// twice, if an unfinished run counts as the agent's, or if code's fallback picks another rail than the registry's.
// Fake client only.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { checkRail, chooseRails, type RailDeps } from "../src/agents/railChoice.js";
import { SUPPLIER_RAILS } from "../src/config/policy.js";

type Call = { name: string; input: unknown };

function fake(turns: Call[][], last = "Stock check on Metal, Packwise on my card."): Anthropic {
  let i = 0;
  return {
    beta: {
      messages: {
        create: async () => {
          const t = turns[i++];
          const usage = { input_tokens: 800, output_tokens: 100 };
          if (!t) return { content: [{ type: "text", text: last }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
          return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
        },
      },
    },
  } as unknown as Anthropic;
}

function deps(over: Partial<RailDeps> = {}) {
  const paid: string[] = [];
  const d: RailDeps = {
    payStockline: async () => { paid.push("stockline"); return { ok: true, text: "stock check #51 bought for 0.03", ref: "0xabc" }; },
    payPackwise: async () => { paid.push("packwise"); return { ok: true, text: "19.99 EUR approved by Airwallex", ref: "awx-1" }; },
    ...over,
  };
  return { d, paid };
}

const pay = (supplier: string, rail: string) => ({ name: "pay", input: { supplier, rail, reason: "its checkout" } });
const terms = (supplier: string) => ({ name: "supplier_terms", input: { supplier } });

function events(db: ReturnType<typeof openDb>, event: string) {
  return (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { subject: string; payload_json: string }[])
    .map((r) => ({ subject: r.subject, ...(JSON.parse(r.payload_json) as Record<string, unknown>) }) as Record<string, unknown>);
}

describe("the registry: which rail each supplier accepts", () => {
  it("Stockline takes x402 on Metal only, Packwise its card checkout only", () => {
    expect(SUPPLIER_RAILS.stockline.rails).toEqual(["metal_x402"]);
    expect(SUPPLIER_RAILS.packwise.rails).toEqual(["airwallex_card"]);
    expect(checkRail("stockline", "metal_x402")).toBeNull();
    expect(checkRail("packwise", "airwallex_card")).toBeNull();
    expect(checkRail("stockline", "airwallex_card")).toMatch(/Stockline accepts only x402 on Metal/);
    expect(checkRail("packwise", "metal_x402")).toMatch(/Packwise accepts only a card/);
  });
});

describe("the Sourcing agent picks the rail", () => {
  it("pays each supplier on the rail it accepts; the choice is logged as the agent's", async () => {
    const db = openDb(":memory:");
    const { d, paid } = deps();
    const r = await chooseRails(db, d, fake([[terms("stockline"), terms("packwise")], [pay("stockline", "metal_x402"), pay("packwise", "airwallex_card")]]));
    expect(r.source).toBe("claude");
    expect(paid).toEqual(["stockline", "packwise"]);
    expect(r.purchases).toEqual([
      expect.objectContaining({ supplier: "stockline", rail: "metal_x402", by: "claude", ok: true, ref: "0xabc" }),
      expect.objectContaining({ supplier: "packwise", rail: "airwallex_card", by: "claude", ok: true, ref: "awx-1" }),
    ]);
    expect(events(db, "purchase.rail_chosen").map((e) => [e.subject, e.rail, e.by])).toEqual([["stockline", "metal_x402", "claude"], ["packwise", "airwallex_card", "claude"]]);
  });

  it("refuses a rail the supplier does not accept, before anything is paid, and lets the agent correct it", async () => {
    const db = openDb(":memory:");
    const { d, paid } = deps();
    const r = await chooseRails(db, d, fake([[pay("stockline", "airwallex_card")], [pay("stockline", "metal_x402")], [pay("packwise", "airwallex_card")]]));
    const wrong = r.run.calls[0]!;
    expect(wrong).toMatchObject({ tool: "pay", blocked: "supplier's rails" });
    expect(wrong.text).toMatch(/Not paid: Stockline accepts only x402 on Metal/);
    expect(paid).toEqual(["stockline", "packwise"]);
    expect(events(db, "purchase.rail_refused")).toEqual([expect.objectContaining({ subject: "stockline", rail: "airwallex_card" })]);
    expect(r.source).toBe("claude");
  });

  it("never pays a supplier twice", async () => {
    const db = openDb(":memory:");
    const { d, paid } = deps();
    const r = await chooseRails(db, d, fake([[pay("stockline", "metal_x402"), pay("stockline", "metal_x402")], [pay("packwise", "airwallex_card")]]));
    expect(paid).toEqual(["stockline", "packwise"]);
    expect(r.run.calls[1]).toMatchObject({ blocked: "paid already" });
  });

  it("reports a refusal by the rail itself (a declined card) as that rail's answer, and does not try again", async () => {
    const db = openDb(":memory:");
    const { d, paid } = deps({ payPackwise: async () => { paid.push("packwise"); return { ok: false, text: "declined by Airwallex (CARD_INACTIVE)", ref: "awx-2" }; } });
    const r = await chooseRails(db, d, fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card")], [pay("packwise", "airwallex_card")]]));
    expect(r.run.calls[1]).toMatchObject({ blocked: "Airwallex card" });
    expect(r.run.calls[2]).toMatchObject({ blocked: "paid already" });
    expect(paid).toEqual(["stockline", "packwise"]);
    expect(r.purchases.find((p) => p.supplier === "packwise")).toMatchObject({ ok: false, by: "claude" });
  });

  it("a payment that throws (a paused agent) is refused, and the reason goes back to the agent", async () => {
    const db = openDb(":memory:");
    const { d } = deps({ payStockline: async () => { throw new Error("the sourcing agent is paused by the CFO"); } });
    const r = await chooseRails(db, d, fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card")]]));
    expect(r.run.calls[0]).toMatchObject({ blocked: "Metal x402" });
    expect(r.run.calls[0]!.text).toMatch(/paused by the CFO/);
    expect(r.purchases.find((p) => p.supplier === "stockline")).toMatchObject({ ok: false });
  });

  it("sends the agent back once when it stops with a purchase left; still unfinished, code pays the rest on the registry's rail", async () => {
    const db = openDb(":memory:");
    const { d, paid } = deps();
    const r = await chooseRails(db, d, fake([[pay("stockline", "metal_x402")]]));
    expect(events(db, "agent.nudged")).toHaveLength(1);
    expect(r.source).toBe("fallback");
    expect(paid).toEqual(["stockline", "packwise"]);
    expect(r.purchases.find((p) => p.supplier === "packwise")).toMatchObject({ rail: "airwallex_card", by: "code" });
  });

  it("counts as the agent's choice when it paid both, even if its run then fails (review of 5.1)", async () => {
    const db = openDb(":memory:");
    const { d, paid } = deps();
    let i = 0;
    const client = { beta: { messages: { create: async () => {
      if (i++ > 0) throw new Error("overloaded");
      return { content: [{ type: "tool_use", id: "a", name: "pay", input: { supplier: "stockline", rail: "metal_x402", reason: "x402" } }, { type: "tool_use", id: "b", name: "pay", input: { supplier: "packwise", rail: "airwallex_card", reason: "card" } }], stop_reason: "tool_use", model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 1 } };
    } } } } as unknown as Anthropic;
    const r = await chooseRails(db, d, client);
    expect(r.run.status).toBe("unavailable");
    expect(r.source).toBe("claude");
    expect(paid).toEqual(["stockline", "packwise"]);
  });

  it("without Claude, code pays both on the registry's rails", async () => {
    const db = openDb(":memory:");
    const { d, paid } = deps();
    const r = await chooseRails(db, d, null);
    expect(r.source).toBe("fallback");
    expect(paid).toEqual(["stockline", "packwise"]);
    expect(r.purchases.map((p) => [p.supplier, p.rail, p.by])).toEqual([["stockline", "metal_x402", "code"], ["packwise", "airwallex_card", "code"]]);
  });

  it("rejects a supplier or rail outside the lists (strict tool schema)", async () => {
    const db = openDb(":memory:");
    const { d, paid } = deps();
    const r = await chooseRails(db, d, fake([[pay("bergtex", "swift")], [pay("stockline", "metal_x402"), pay("packwise", "airwallex_card")]]));
    expect(r.run.calls[0]!.text).toMatch(/invalid|Invalid/);
    expect(paid).toEqual(["stockline", "packwise"]);
  });
});

describe("the rail choice on the dashboard", () => {
  it("has its own trace: each pay call, what it paid (chain tx or Airwallex id), then the decision", async () => {
    const { agentTraces } = await import("../src/dashboard/trace.js");
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    const db = openDb(":memory:");
    const tx = `0x${"cd".repeat(32)}`;
    const { d } = deps({ payStockline: async () => ({ ok: true, text: "stock check #51 bought", ref: tx }) });
    await chooseRails(db, d, fake([[pay("packwise", "metal_x402")], [pay("stockline", "metal_x402"), pay("packwise", "airwallex_card")]]));
    const [t] = agentTraces(db);
    expect(t).toMatchObject({ agent: "sourcing", task: "purchase.rails" });
    expect(t!.steps.map((s) => s.event)).toEqual(["purchase.rail_refused", "agent.tool", "purchase.rail_chosen", "agent.tool", "purchase.rail_chosen", "agent.tool", "agent.run", "purchase.rails_chosen"]);
    expect(t!.steps.find((s) => s.event === "purchase.rail_chosen" && s.tx)).toMatchObject({ tx });
    expect(t!.steps.find((s) => s.event === "purchase.rail_chosen" && s.awx_id)).toMatchObject({ awx_id: "awx-1" });
    expect(t!.steps[1]).toMatchObject({ kind: "tool", blocked: true, check: "supplier's rails" });
    const feed = buildSnapshot(db).feed.map((f) => f.text);
    expect(feed).toContainEqual(expect.stringMatching(/^Code refused the Sourcing agent's payment to Packwise: Packwise accepts only a card/));
    expect(feed).toContainEqual(expect.stringMatching(/^The Sourcing agent picked the rail per purchase: Stockline on x402 on Metal, Packwise on the card/));
  });
});
