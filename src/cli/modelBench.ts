// npm run model-bench: the agents' eval cases, and a harder set (src/evals/hard.ts), with Purser's split of Claude's
// models against one model for every role, MODEL_BENCH_RUNS times each (default 3). Needs KIT11_ANTHROPIC_API_KEY;
// throwaway worlds only, nothing reaches Airwallex, Metal or a phone. Writes docs/evals/model-benchmark.json and
// docs/model-benchmark.md; --render rewrites the report from the saved results without calling a model.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeClient, MODELS } from "../claude/reader.js";
import { BENCH_CONFIGS, benchConfig, type BenchRow } from "../evals/bench.js";
import { CASES, type Case } from "../evals/cases.js";
import { HARD_CASES } from "../evals/hard.js";
import { redactSecrets } from "../lib/redact.js";

interface SetResult { title: string; cases: string[]; rows: BenchRow[] }
const SETS: { id: "core" | "hard"; title: string; cases: Case[] }[] = [
  { id: "core", title: "The agents' eval cases (src/evals/cases.ts)", cases: CASES },
  { id: "hard", title: "Harder documents (src/evals/hard.ts): a long invoice with a discount line and closed old bank details, an invoice in German, an IBAN one digit off, a mixed-language dispute that leaves one order out of a range, a price notice in German", cases: HARD_CASES },
];

const root = resolve(import.meta.dirname, "../..");
const jsonFile = resolve(root, "docs/evals/model-benchmark.json");
// --render rewrites the report from the saved results, calling no model.
const saved = process.argv.includes("--render") ? (JSON.parse(readFileSync(jsonFile, "utf8")) as { ran_at: string; runs: number; sets: Record<string, SetResult> }) : null;
const client = saved ? null : claudeClient();
if (!saved && !client) { console.error("KIT11_ANTHROPIC_API_KEY is not set: the benchmark needs the real models. Nothing was run."); process.exit(2); }
const runs = saved?.runs ?? Math.max(1, Number(process.env.MODEL_BENCH_RUNS ?? 3));

const sets: Record<string, SetResult> = saved?.sets ?? {};
for (const set of saved ? [] : SETS) {
  const rows: BenchRow[] = [];
  for (const c of BENCH_CONFIGS) {
    console.log(`${set.id}: ${c.label}: ${runs} run(s) of ${set.cases.length} cases …`);
    const row = await benchConfig(client!, c, runs, set.cases);
    rows.push(row);
    console.log(`  ${row.passed_by_model}/${row.cases} by the model, ${row.fallbacks} parser reading(s), USD ${(row.cost_per_run_usd_micros / 1e6).toFixed(4)} a run, p50 ${row.p50_latency_ms ?? "-"} ms`);
  }
  sets[set.id] = { title: set.title, cases: set.cases.map((k) => k.id), rows };
}

const usd = (micros: number) => `USD ${(micros / 1e6).toFixed(4)}`;
const pct = (r: BenchRow) => `${r.passed_by_model} of ${r.cases}`;

/** The plain reading of one set: which setup passes most, and what it costs against Purser's split. */
function verdict(rs: BenchRow[]): string {
  const purser = rs.find((r) => r.id === "purser")!;
  const best = Math.max(...rs.map((r) => r.passed_by_model));
  const cheapest = rs.filter((r) => r.passed_by_model === best).sort((a, b) => a.cost_per_run_usd_micros - b.cost_per_run_usd_micros)[0]!;
  if (cheapest.id === "purser") return `Purser's split passes the most (${pct(purser)}), at the lowest cost among the setups that do.`;
  const behind = purser.passed_by_model < best ? `; Purser's split passes ${pct(purser)}` : ", as many as Purser's split";
  return `${cheapest.label} passes the most (${pct(cheapest)}${behind}), at ${usd(cheapest.cost_per_run_usd_micros)} a run against ${usd(purser.cost_per_run_usd_micros)}.`;
}

const ranAt = saved?.ran_at ?? new Date().toISOString();
mkdirSync(resolve(root, "docs/evals"), { recursive: true });
if (!saved) writeFileSync(jsonFile, JSON.stringify({ ran_at: ranAt, runs, models: MODELS, sets }, null, 2) + "\n");

const table = (s: SetResult) => [
  "| Setup | Passed by the model | Parser readings | Calls | Cost per run (list price) | Median latency per call |",
  "|---|---|---|---|---|---|",
  ...s.rows.map((r) => `| ${r.label} | ${pct(r)} | ${r.fallbacks} | ${r.calls} | ${usd(r.cost_per_run_usd_micros)}${r.unpriced_calls ? ` (${r.unpriced_calls} unpriced)` : ""} | ${r.p50_latency_ms ?? "-"} ms |`),
];
const failures = (s: SetResult) => (s.rows.some((r) => r.problems.length)
  ? s.rows.flatMap((r) => r.problems.length ? [`- **${r.label}:**`, ...[...new Set(r.problems.map((p) => `${p.id}: ${redactSecrets(p.problem)}`))].map((p) => `  - ${p}`)] : [])
  : ["Nothing: every case passed in every row."]);

const md = [
  "# Model benchmark: which Claude model for which job",
  "",
  `Run on ${ranAt.slice(0, 10)} with \`npm run model-bench\`: ${runs} run(s) per row, real Claude models, throwaway worlds (nothing reached Airwallex, Metal or a phone). Raw results: [evals/model-benchmark.json](evals/model-benchmark.json).`,
  "",
  "A case counts for a model only if it passed with every reading from the model itself. When a model fails, Purser's deterministic parsers take over so the decision stays the same; here that counts against the model. In every row the code decides: no case can approve or pay.",
  "",
  ...Object.entries(sets).flatMap(([id, s]) => [
    `## ${id === "hard" ? "Harder documents" : "The agents' eval cases"}`,
    "",
    `${s.title}; ${s.cases.length} cases.`,
    "",
    ...table(s),
    "",
    `**What this shows:** ${verdict(s.rows)}`,
    "",
    "**What failed:**",
    "",
    ...failures(s),
    "",
  ]),
  "Prices: Anthropic's list prices in src/claude/pricing.ts. Latency includes the network from the build container.",
  "",
].join("\n");
writeFileSync(resolve(root, "docs/model-benchmark.md"), md);
console.log("\nWritten: docs/model-benchmark.md and docs/evals/model-benchmark.json");
process.exit(0);
