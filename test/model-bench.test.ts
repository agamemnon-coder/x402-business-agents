// The model benchmark (npm run model-bench): the same eval cases with each model in each role, scored only on
// readings the model itself produced. A case the deterministic parser rescued does not count for the model.
// No test here calls the real Anthropic API: the clients are stand-ins.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MODELS, ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb } from "../src/db/open.js";
import { BENCH_CONFIGS, summariseBench } from "../src/evals/bench.js";
import { runEvals, type EvalResult } from "../src/evals/cases.js";

function recordingClient(seen: { model: string; betas?: string[] }[], reply: unknown): Anthropic {
  return { beta: { messages: { parse: async (p: { model: string; betas?: string[] }) => {
    seen.push({ model: p.model, betas: p.betas });
    return { model: p.model, stop_reason: "end_turn", stop_details: null, parsed_output: reply, usage: { input_tokens: 10, output_tokens: 5 } };
  } } } } as unknown as Anthropic;
}

describe("a model per role, chosen for the benchmark", () => {
  // Breaks if the override is ignored, or if Haiku is sent the server-side fallback it does not support.
  it("uses the override's model for a role, and sends Haiku no server-side fallback", async () => {
    const db = openDb(":memory:");
    const seen: { model: string; betas?: string[] }[] = [];
    const reader = new ClaudeReader(db, recordingClient(seen, { kind: "invoice", confidence: "high" }), Date.now, { classify: MODELS.review, act: MODELS.classify });
    const schema = z.object({ kind: z.string(), confidence: z.string() });
    const fallback = () => ({ kind: "other", confidence: "low" });
    await reader.ask({ task: "t1", role: "classify", actor: "system", schema, instruction: "i", document: "x" }, fallback);
    await reader.ask({ task: "t2", role: "act", actor: "system", schema, instruction: "i", document: "y" }, fallback);
    expect(seen.map((s) => s.model)).toEqual([MODELS.review, MODELS.classify]);
    expect(seen[0]!.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(seen[1]!.betas).toBeUndefined();
  });

  it("keeps Purser's split when there is no override", async () => {
    const db = openDb(":memory:");
    const seen: { model: string; betas?: string[] }[] = [];
    await new Tools(db, new ClaudeReader(db, recordingClient(seen, { kind: "invoice", confidence: "high" }))).classify("x");
    expect(seen[0]!.model).toBe(MODELS.classify);
  });
});

describe("the benchmark's score", () => {
  // Breaks if a case the parser rescued is credited to the model.
  it("does not count a case the parser rescued, and counts every fallback", async () => {
    const failing = { beta: { messages: { parse: async () => { throw new Error("stand-in outage"); } } } } as unknown as Anthropic;
    const results = await runEvals(failing);
    expect(results.every((r) => r.pass)).toBe(true); // the parsers keep the demo's decisions the same
    expect(results.every((r) => r.fallbacks > 0 && r.calls.length === 0)).toBe(true);
    const row = summariseBench(BENCH_CONFIGS[0]!, [results]);
    expect(row).toMatchObject({ cases: 6, passed_by_model: 0, cost_usd_micros: 0 });
    expect(row.fallbacks).toBeGreaterThanOrEqual(6);
  });

  it("adds cost and calls over runs and takes the median latency", () => {
    const r = (id: string, pass: boolean, fallbacks: number, calls: EvalResult["calls"]): EvalResult =>
      ({ id, title: id, pass, models: [], outcome: "", why: "", problems: [], fallbacks, calls });
    const run1 = [r("a", true, 0, [{ model: "m", latency_ms: 100, cost_usd_micros: 40 }, { model: "m", latency_ms: 300, cost_usd_micros: 60 }]), r("b", false, 0, [{ model: "m", latency_ms: 200, cost_usd_micros: 10 }])];
    const run2 = [r("a", true, 1, [{ model: "m", latency_ms: 400, cost_usd_micros: 5 }]), r("b", true, 0, [{ model: "m", latency_ms: 500, cost_usd_micros: null }])];
    expect(summariseBench(BENCH_CONFIGS[1]!, [run1, run2])).toMatchObject({
      id: BENCH_CONFIGS[1]!.id, runs: 2, cases: 4, passed_by_model: 2, fallbacks: 1, calls: 5,
      cost_usd_micros: 115, cost_per_run_usd_micros: 58, p50_latency_ms: 300, unpriced_calls: 1,
    });
  });

  it("compares Purser's split with one model for every role", () => {
    expect(BENCH_CONFIGS.map((c) => c.id)).toEqual(["purser", "haiku", "sonnet", "opus"]);
    expect(BENCH_CONFIGS[0]!.models).toEqual({});
    for (const c of BENCH_CONFIGS.slice(1)) expect(new Set(Object.values(c.models)).size).toBe(1);
  });
});
