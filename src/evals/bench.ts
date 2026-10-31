// The model benchmark: the agents' eval set (src/evals/cases.ts) with Purser's split of Claude's models against one
// model for every role. A case counts for a model only if it passed with no reading from the deterministic parser:
// the parser keeps the demo's decisions the same when a model fails, so it must not hide that failure here.
// Costs are at Anthropic's list prices (src/claude/pricing.ts); latency is per call, as the audit log records it.

import type Anthropic from "@anthropic-ai/sdk";
import { MODELS, type Role } from "../claude/reader.js";
import { runEvals, type EvalResult } from "./cases.js";

export interface BenchConfig { id: string; label: string; models: Partial<Record<Role, string>> }

const every = (model: string): Partial<Record<Role, string>> => ({ classify: model, act: model, review: model });

export const BENCH_CONFIGS: BenchConfig[] = [
  { id: "purser", label: "Purser's split: Haiku sorts, Sonnet reads, Opus reviews", models: {} },
  { id: "haiku", label: "Haiku for every role", models: every(MODELS.classify) },
  { id: "sonnet", label: "Sonnet for every role", models: every(MODELS.act) },
  { id: "opus", label: "Opus for every role", models: every(MODELS.review) },
];

export interface BenchRow {
  id: string;
  label: string;
  runs: number;
  /** Case runs: cases × runs. */
  cases: number;
  /** Case runs that passed with every reading from the model itself. */
  passed_by_model: number;
  fallbacks: number;
  calls: number;
  cost_usd_micros: number;
  cost_per_run_usd_micros: number;
  p50_latency_ms: number | null;
  /** Calls whose model has no known price; their cost is not in the total. */
  unpriced_calls: number;
  /** The checks that failed, per case, over all runs. */
  problems: { id: string; problem: string }[];
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
};

export function summariseBench(config: BenchConfig, runs: EvalResult[][]): BenchRow {
  const all = runs.flat();
  const calls = all.flatMap((r) => r.calls);
  const cost = calls.reduce((n, c) => n + (c.cost_usd_micros ?? 0), 0);
  return {
    id: config.id, label: config.label, runs: runs.length, cases: all.length,
    passed_by_model: all.filter((r) => r.pass && r.fallbacks === 0).length,
    fallbacks: all.reduce((n, r) => n + r.fallbacks, 0),
    calls: calls.length,
    cost_usd_micros: cost,
    cost_per_run_usd_micros: runs.length ? Math.ceil(cost / runs.length) : 0,
    p50_latency_ms: median(calls.map((c) => c.latency_ms)),
    unpriced_calls: calls.filter((c) => c.cost_usd_micros === null).length,
    problems: all.flatMap((r) => [...r.problems, ...(r.pass && r.fallbacks ? [`${r.fallbacks} reading(s) from the parser`] : [])].map((problem) => ({ id: r.id, problem }))),
  };
}

export async function benchConfig(client: Anthropic, config: BenchConfig, runs: number): Promise<BenchRow> {
  const results: EvalResult[][] = [];
  for (let i = 0; i < runs; i++) results.push(await runEvals(client, config.models));
  return summariseBench(config, results);
}
