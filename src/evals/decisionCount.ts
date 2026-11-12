// How many of the agents' decisions Claude made, and how many fell back to code (master-list line 79), counted from the
// committed records only: the live and dry runs (docs/runs) and the evals (docs/evals). A record that does not say who
// decided is not counted. The target is at least 95% Claude; the fallback share is the dashboard's (fallbackPct in
// src/dashboard/agentStats.ts).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fallbackPct } from "../dashboard/agentStats.js";

export const CLAUDE_TARGET_PCT = 95;

export interface SourceCount { source: string; kind: "run" | "eval"; agent: string; by_claude: number; fallback: number }

/** docs/runs/2026-11-01-soak.md: the per-agent table ("| Sourcing | Haiku | 202 | 0 (0%) | …"). */
export function fromSoakTable(md: string, source: string): SourceCount[] {
  const out: SourceCount[] = [];
  for (const m of md.matchAll(/^\|\s*(Sourcing|Support|Treasury)\s*\|\s*\w+\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\(/gm)) {
    const decisions = Number(m[2]), fallback = Number(m[3]);
    out.push({ source, kind: "run", agent: m[1]!.toLowerCase(), by_claude: decisions - fallback, fallback });
  }
  return out;
}

/** docs/runs/2026-11-07-awx-1.md: one decision per agent run in its Claude-calls table, counted only when the record
 *  states "0 fallbacks". */
export function fromAwx1(md: string, source: string): SourceCount[] {
  if (!/\b0 fallbacks\b/.test(md)) return [];
  const runs = new Map<string, Set<string>>();
  for (const m of md.matchAll(/^\|\s*`(run-([a-z]+)-\d+-[0-9a-f]+)`/gm)) {
    const set = runs.get(m[2]!) ?? new Set<string>();
    set.add(m[1]!);
    runs.set(m[2]!, set);
  }
  return [...runs].map(([agent, ids]) => ({ source, kind: "run", agent, by_claude: ids.size, fallback: 0 }));
}

/** docs/evals/agents.json: each detail line starts "pass: claude" or "FAIL: fallback". */
export function fromAgentEvals(j: { rows: { agent: string; details: string[] }[] }, source: string): SourceCount[] {
  const by = new Map<string, SourceCount>();
  for (const r of j.rows) {
    const c = by.get(r.agent) ?? { source, kind: "eval" as const, agent: r.agent, by_claude: 0, fallback: 0 };
    for (const d of r.details) {
      const who = /^\w+: (claude|fallback)\b/.exec(d)?.[1];
      if (who === "claude") c.by_claude++;
      else if (who === "fallback") c.fallback++;
    }
    by.set(r.agent, c);
  }
  return [...by.values()];
}

/** autonomy-variation.json and autonomy-redteam.json: the Sourcing agent, one decision per entry with its `source`. */
export function fromSourceList(entries: { source: string }[], source: string, agent: string): SourceCount[] {
  return [{ source, kind: "eval", agent, by_claude: entries.filter((e) => e.source === "claude").length, fallback: entries.filter((e) => e.source === "fallback").length }];
}

/** docs/evals/coder.json: a row without the agent's answer is code's fallback. */
export function fromCoder(j: { rows: { no_answer: boolean }[] }, source: string): SourceCount[] {
  return [{ source, kind: "eval", agent: "coder", by_claude: j.rows.filter((r) => !r.no_answer).length, fallback: j.rows.filter((r) => r.no_answer).length }];
}

/** docs/runs/<date>-chain-soak.json: the AP chain soak's decisions per step and run. */
export function fromChainSoak(j: { runs: { record: { decisions: { agent: string; by_claude: number; fallback: number }[] } }[] }, source: string): SourceCount[] {
  const by = new Map<string, SourceCount>();
  for (const r of j.runs) for (const d of r.record.decisions) {
    const agent = `payables ${d.agent}`;
    const c = by.get(agent) ?? { source, kind: "run" as const, agent, by_claude: 0, fallback: 0 };
    c.by_claude += d.by_claude;
    c.fallback += d.fallback;
    by.set(agent, c);
  }
  return [...by.values()];
}

/** Every record the count reads, from the repository root. */
export function collect(root: string): SourceCount[] {
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const json = <T>(p: string) => JSON.parse(read(p)) as T;
  const has = (p: string) => existsSync(join(root, p));
  const out: SourceCount[] = [];
  if (has("docs/runs/2026-11-01-soak.md")) out.push(...fromSoakTable(read("docs/runs/2026-11-01-soak.md"), "docs/runs/2026-11-01-soak.md"));
  if (has("docs/runs/2026-11-07-awx-1.md")) out.push(...fromAwx1(read("docs/runs/2026-11-07-awx-1.md"), "docs/runs/2026-11-07-awx-1.md"));
  for (const f of readdirSync(join(root, "docs/runs")).filter((x) => /^\d{4}-\d{2}-\d{2}-chain-soak\.json$/.test(x)).sort()) out.push(...fromChainSoak(json(`docs/runs/${f}`), `docs/runs/${f}`));
  if (has("docs/evals/agents.json")) out.push(...fromAgentEvals(json("docs/evals/agents.json"), "docs/evals/agents.json"));
  if (has("docs/evals/autonomy-variation.json")) {
    const v = json<{ same_world: { source: string }[]; other_worlds: { source: string }[] }>("docs/evals/autonomy-variation.json");
    out.push(...fromSourceList([...v.same_world, ...v.other_worlds], "docs/evals/autonomy-variation.json", "sourcing"));
  }
  if (has("docs/evals/autonomy-redteam.json")) out.push(...fromSourceList(json<{ results: { source: string }[] }>("docs/evals/autonomy-redteam.json").results, "docs/evals/autonomy-redteam.json", "sourcing"));
  if (has("docs/evals/coder.json")) out.push(...fromCoder(json("docs/evals/coder.json"), "docs/evals/coder.json"));
  return out.filter((c) => c.by_claude + c.fallback > 0);
}

export interface Tally { decisions: number; by_claude: number; fallback: number; fallback_pct: number; claude_pct: number; meets_target: boolean }
const tally = (cs: SourceCount[]): Tally => {
  const by = cs.reduce((a, c) => a + c.by_claude, 0), fb = cs.reduce((a, c) => a + c.fallback, 0), n = by + fb;
  const f = fallbackPct(fb, n);
  return { decisions: n, by_claude: by, fallback: fb, fallback_pct: f, claude_pct: n ? Math.round((100 - f) * 10) / 10 : 0, meets_target: n > 0 && by * 100 >= CLAUDE_TARGET_PCT * n };
};

export interface DecisionCount {
  target_claude_pct: number;
  total: Tally;
  runs: Tally;
  evals: Tally;
  per_agent: (Tally & { agent: string })[];
  sources: SourceCount[];
  not_counted: string[];
}

export function decisionCount(sources: SourceCount[]): DecisionCount {
  const agents = [...new Set(sources.map((s) => s.agent))].sort();
  return {
    target_claude_pct: CLAUDE_TARGET_PCT,
    total: tally(sources), runs: tally(sources.filter((s) => s.kind === "run")), evals: tally(sources.filter((s) => s.kind === "eval")),
    per_agent: agents.map((agent) => ({ agent, ...tally(sources.filter((s) => s.agent === agent)) })),
    sources,
    not_counted: [
      "docs/evals/report.json and docs/evals/model-benchmark.json: reader and model comparisons, not agent decisions",
      "docs/evals/agent-facts-before.json and agent-was-wrong-2026-10-31.json: single cases kept for their lesson",
    ],
  };
}
