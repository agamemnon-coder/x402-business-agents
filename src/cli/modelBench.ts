// npm run model-bench: the agents' eval set with Purser's split of Claude's models against one model for every role,
// MODEL_BENCH_RUNS times each (default 3). Needs KIT11_ANTHROPIC_API_KEY; throwaway worlds only, nothing reaches
// Airwallex, Metal or a phone. Writes docs/evals/model-benchmark.json and docs/model-benchmark.md; --render rewrites
// the report from the saved results without calling a model.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeClient, MODELS } from "../claude/reader.js";
import { BENCH_CONFIGS, benchConfig, type BenchRow } from "../evals/bench.js";
import { CASES } from "../evals/cases.js";
import { redactSecrets } from "../lib/redact.js";

const root = resolve(import.meta.dirname, "../..");
const jsonFile = resolve(root, "docs/evals/model-benchmark.json");
// --render rewrites the report from the saved results, calling no model.
const saved = process.argv.includes("--render") ? (JSON.parse(readFileSync(jsonFile, "utf8")) as { ran_at: string; runs: number; rows: BenchRow[] }) : null;
const client = saved ? null : claudeClient();
if (!saved && !client) { console.error("KIT11_ANTHROPIC_API_KEY is not set: the benchmark needs the real models. Nothing was run."); process.exit(2); }
const runs = saved?.runs ?? Math.max(1, Number(process.env.MODEL_BENCH_RUNS ?? 3));

const rows: BenchRow[] = saved?.rows ?? [];
for (const c of saved ? [] : BENCH_CONFIGS) {
  console.log(`${c.label}: ${runs} run(s) of ${CASES.length} cases …`);
  const row = await benchConfig(client!, c, runs);
  rows.push(row);
  console.log(`  ${row.passed_by_model}/${row.cases} by the model, ${row.fallbacks} parser reading(s), USD ${(row.cost_per_run_usd_micros / 1e6).toFixed(4)} a run, p50 ${row.p50_latency_ms ?? "-"} ms`);
}

const usd = (micros: number) => `USD ${(micros / 1e6).toFixed(4)}`;

/** The plain reading of the table: is Purser's split worth its cost on these cases? Written from the numbers. */
function verdict(rs: BenchRow[]): string[] {
  const purser = rs.find((r) => r.id === "purser")!;
  const best = Math.max(...rs.map((r) => r.passed_by_model));
  const cheapest = rs.filter((r) => r.passed_by_model === best).sort((a, b) => a.cost_per_run_usd_micros - b.cost_per_run_usd_micros)[0]!;
  if (cheapest.id === "purser") return [`Purser's split passes the most cases (${purser.passed_by_model} of ${purser.cases}) at the lowest cost among the setups that do.`];
  return [
    `${cheapest.label} passes as many cases as Purser's split (${cheapest.passed_by_model} of ${cheapest.cases}), at ${usd(cheapest.cost_per_run_usd_micros)} a run against ${usd(purser.cost_per_run_usd_micros)}.`,
    "So these cases do not show that Sonnet or Opus are needed: they are easy for every model. Purser keeps Sonnet for reading and Opus for the CFO's risk review as a margin for harder documents, not because these cases prove it. A harder eval set (messier invoices, longer disputes) is the next step before choosing.",
  ];
}
const ranAt = saved?.ran_at ?? new Date().toISOString();
mkdirSync(resolve(root, "docs/evals"), { recursive: true });
if (!saved) writeFileSync(jsonFile, JSON.stringify({ ran_at: ranAt, runs, cases: CASES.map((c) => c.id), models: MODELS, rows }, null, 2) + "\n");

const md = [
  "# Model benchmark: which Claude model for which job",
  "",
  `Run on ${ranAt.slice(0, 10)} with \`npm run model-bench\`: the agents' ${CASES.length} eval cases (src/evals/cases.ts), ${runs} run(s) per row, real Claude models, throwaway worlds (nothing reached Airwallex, Metal or a phone). Raw results: [evals/model-benchmark.json](evals/model-benchmark.json).`,
  "",
  "A case counts for a model only if it passed with every reading from the model itself. When a model fails, Purser's deterministic parsers take over so the decision stays the same; here that counts against the model. In every row the code decides: no case can approve or pay.",
  "",
  "| Setup | Passed by the model | Parser readings | Calls | Cost per run (list price) | Median latency per call |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.label} | ${r.passed_by_model} of ${r.cases} | ${r.fallbacks} | ${r.calls} | ${usd(r.cost_per_run_usd_micros)}${r.unpriced_calls ? ` (${r.unpriced_calls} unpriced)` : ""} | ${r.p50_latency_ms ?? "-"} ms |`),
  "",
  "## What this shows",
  "",
  ...verdict(rows),
  "",
  "## What failed",
  "",
  ...(rows.some((r) => r.problems.length) ? rows.flatMap((r) => r.problems.length ? [`- **${r.label}:**`, ...[...new Set(r.problems.map((p) => `${p.id}: ${redactSecrets(p.problem)}`))].map((p) => `  - ${p}`)] : []) : ["Nothing: every case passed in every row."]),
  "",
  "Prices: Anthropic's list prices in src/claude/pricing.ts. Latency includes the network from the build container.",
  "",
].join("\n");
writeFileSync(resolve(root, "docs/model-benchmark.md"), md);
console.log("\nWritten: docs/model-benchmark.md and docs/evals/model-benchmark.json");
process.exit(0);
