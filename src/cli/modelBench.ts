// npm run model-bench: the agents' eval set with Purser's split of Claude's models against one model for every role,
// MODEL_BENCH_RUNS times each (default 3). Needs KIT11_ANTHROPIC_API_KEY; throwaway worlds only, nothing reaches
// Airwallex, Metal or a phone. Writes docs/evals/model-benchmark.json and docs/model-benchmark.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeClient, MODELS } from "../claude/reader.js";
import { BENCH_CONFIGS, benchConfig, type BenchRow } from "../evals/bench.js";
import { CASES } from "../evals/cases.js";
import { redactSecrets } from "../lib/redact.js";

const client = claudeClient();
if (!client) { console.error("KIT11_ANTHROPIC_API_KEY is not set: the benchmark needs the real models. Nothing was run."); process.exit(2); }
const runs = Math.max(1, Number(process.env.MODEL_BENCH_RUNS ?? 3));

const rows: BenchRow[] = [];
for (const c of BENCH_CONFIGS) {
  console.log(`${c.label}: ${runs} run(s) of ${CASES.length} cases …`);
  const row = await benchConfig(client, c, runs);
  rows.push(row);
  console.log(`  ${row.passed_by_model}/${row.cases} by the model, ${row.fallbacks} parser reading(s), USD ${(row.cost_per_run_usd_micros / 1e6).toFixed(4)} a run, p50 ${row.p50_latency_ms ?? "-"} ms`);
}

const usd = (micros: number) => `USD ${(micros / 1e6).toFixed(4)}`;
const ranAt = new Date().toISOString();
const root = resolve(import.meta.dirname, "../..");
mkdirSync(resolve(root, "docs/evals"), { recursive: true });
writeFileSync(resolve(root, "docs/evals/model-benchmark.json"), JSON.stringify({ ran_at: ranAt, runs, cases: CASES.map((c) => c.id), models: MODELS, rows }, null, 2) + "\n");

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
