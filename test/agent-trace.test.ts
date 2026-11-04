// 4.1 The agent trace: one timeline per agent decision, as LangSmith or Datadog would show it. Model, every tool call
// with its input, result and time, tokens, cost and latency, the check that let each call through or stopped it, the
// chain tx or Airwallex id it caused, and each row's hash in the audit chain; opened from the decision's feed line.
// Breaks if a call's own effect (a refusal on chain) is left out of its step, if a step's hash is not the audit row's,
// or if the feed line cannot open its trace. Fake client only.
import { withOrigin } from "../src/provenance/origin.js";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { runAgent } from "../src/agents/loop.js";
import { agentTraces } from "../src/dashboard/trace.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";

const TX = `0x${"ab".repeat(32)}`;

function fake(turns: { name: string; input: unknown }[][]): Anthropic {
  let i = 0;
  return {
    beta: {
      messages: {
        create: async () => {
          const t = turns[i++];
          const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 };
          if (!t) return { content: [{ type: "text", text: "Metal refused #41; I told Treasury." }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
          return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
        },
      },
    },
  } as unknown as Anthropic;
}

async function world() {
  const db = openDb(":memory:");
  audit(db, "sourcing", "upstream.paid", "40", { seq: 40 }); // before the run: not part of its trace
  const run = await runAgent(db, {
    agent: "sourcing", task: "price_rise.meet", model: "claude-haiku-5-5", system: "s", prompt: "p",
    tools: [
      { name: "check_offer", description: "d", input: z.object({}), run: async () => ({ text: "Live offer 0.04, cap 0.03" }) },
      { name: "try_purchase", description: "d", input: z.object({}), run: async () => {
        audit(db, "sourcing", "upstream.refused", "41", { seq: 41, reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", tx: TX });
        return { text: "Metal refused it", blocked: "Metal mandate" };
      } },
    ],
  }, fake([[{ name: "check_offer", input: {} }], [{ name: "try_purchase", input: {} }]]));
  audit(db, "sourcing", "price_rise.met", "41", { source: "claude", model: run.model, tried: true, message: "I need a cap of 0.04." });
  return db;
}

describe("the agent trace and money movements (D24)", () => {
  it("a movement code made while the agent's run was open is not part of the run's trace; the run's own refusal is", async () => {
    const db = openDb(":memory:");
    await runAgent(db, {
      agent: "sourcing", task: "price_rise.meet", model: "claude-haiku-5-5", system: "s", prompt: "p",
      tools: [{ name: "try_purchase", description: "d", input: z.object({}), run: async () => {
        // The world's per-query buyer, by code, writes during the run; then the tool's own refusal.
        withOrigin({ actor: "code", rule: "the default buy policy", agent: "sourcing" }, () => audit(db, "sourcing", "upstream.paid", "50", { seq: 50 }));
        audit(db, "sourcing", "upstream.refused", "51", { seq: 51, reason: "mandate_cap_exceeded: x", tx: TX });
        return { text: "refused", blocked: "Metal mandate" };
      } }],
    }, fake([[{ name: "try_purchase", input: {} }]]));
    const effects = agentTraces(db)[0]!.steps.map((s) => s.event);
    expect(effects).toContain("upstream.refused");
    expect(effects).not.toContain("upstream.paid");
  });
});

describe("the agent trace", () => {
  it("lays out one decision as a timeline: each call with what it caused, then the run, then the decision", async () => {
    const db = await world();
    const [t] = agentTraces(db);
    expect(t).toMatchObject({ agent: "sourcing", task: "price_rise.meet", model: "claude-haiku-5-5", status: "done", turns: 3 });
    expect(t!.steps.map((s) => s.kind)).toEqual(["tool", "effect", "tool", "run", "decision"]);
    expect(t!.steps.map((s) => s.event)).toEqual(["agent.tool", "upstream.refused", "agent.tool", "agent.run", "price_rise.met"]);
  });

  it("names the check behind each call: what let it through, or what stopped it", async () => {
    const [t] = agentTraces(await world());
    const [offer, , purchase] = t!.steps;
    expect(offer).toMatchObject({ tool: "check_offer", blocked: false, check: expect.stringMatching(/read only/i) });
    expect(purchase).toMatchObject({ tool: "try_purchase", blocked: true, check: "Metal mandate" });
  });

  it("carries the chain tx the call caused, and every row's own hash in the audit chain", async () => {
    const db = await world();
    const [t] = agentTraces(db);
    expect(t!.steps[1]).toMatchObject({ tx: TX });
    const hashes = new Map((db.prepare("SELECT seq, row_hash FROM audit_log").all() as { seq: number; row_hash: string }[]).map((r) => [r.seq, r.row_hash]));
    for (const s of t!.steps) expect(s.hash).toBe(hashes.get(s.seq));
  });

  it("counts tokens, cost and time: per run, and per tool call", async () => {
    const [t] = agentTraces(await world());
    expect(t!.tokens).toEqual({ input: 3000, output: 600, cache_read: 150, cache_write: 30 });
    expect(t!.cost_usd_micros).toBeGreaterThan(0);
    expect(t!.latency_ms).toBeGreaterThanOrEqual(0);
    expect(t!.steps.filter((s) => s.kind === "tool").every((s) => typeof s.ms === "number")).toBe(true);
  });

  it("leaves out a tool call of another task by the same agent (review of 4.2)", async () => {
    const db = openDb(":memory:");
    audit(db, "support", "agent.tool", "dispute.D-1", { tool: "refund", result: "x" });
    const t0 = (db.prepare("SELECT MAX(seq) AS s FROM audit_log").get() as { s: number }).s;
    audit(db, "support", "agent.tool", "dispute.D-2", { tool: "check_data", result: "y" });
    audit(db, "support", "agent.run", "dispute.D-2", { agent: "support", model: "m", status: "done", turns: 1, from_seq: t0 - 1 });
    const [t] = agentTraces(db);
    expect(t!.steps.filter((x) => x.kind === "tool").map((x) => x.tool)).toEqual(["check_data"]);
  });

  it("leaves rows from before the run out of it", async () => {
    const [t] = agentTraces(await world());
    expect(t!.steps.some((s) => s.event === "upstream.paid")).toBe(false);
  });

  it("is opened from the decision's feed line and from a refused call's line", async () => {
    const s = buildSnapshot(await world());
    const runSeq = s.traces[0]!.run_seq;
    expect(s.feed.find((f) => f.event === "price_rise.met")!.trace).toBe(runSeq);
    expect(s.feed.find((f) => f.event === "agent.tool")!.trace).toBe(runSeq);
    expect(s.feed.find((f) => f.event === "upstream.refused")!.trace).toBe(runSeq);
  });

  it("is empty when the agents never ran (the switch off): nothing new on the dashboard", () => {
    const db = openDb(":memory:");
    audit(db, "sourcing", "upstream.refused", "41", { seq: 41, reason: "mandate_cap_exceeded", tx: TX });
    const s = buildSnapshot(db);
    expect(s.traces).toEqual([]);
    expect(s.feed.every((f) => f.trace === null)).toBe(true);
  });
});
