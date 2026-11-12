// npm run ap-agent-evals -- --models haiku,sonnet,opus --runs 1 --max-usd N [--agent checker|payer] [--case a,b]
// The payables agents' evals with real models (src/evals/apAgentEvals.ts); never in CI. Spends real money: needs
// KIT11_ANTHROPIC_API_KEY, records every case's cost with recordSpend under the "ap-agents" block, and stops before a
// case whose worst cost would take this run past --max-usd. Writes docs/evals/ap-agents.json (rows of other models
// and cases are kept, each with the time and commit it ran on) and the payables section of docs/agent-evals.md.
// --render writes the section again from the record, without calling Claude.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHECKER_MAX_TURNS } from "../ap/checkerCore.js";
import { PAYER_MAX_TURNS } from "../ap/payerCore.js";
import { budgetStatus, recordSpend } from "../claude/budget.js";
import { callCostMicros } from "../claude/pricing.js";
import { claudeClient } from "../claude/reader.js";
import { AP_AGENT_CASES, AP_PAYER_CASES } from "../evals/apAgentCases.js";
import { apSection, buildRecord, checkerRow, payerRow, withinBudget, type ApAgentName, type ApEvalRecord, type EvalRow, type RecordedRow } from "../evals/apAgentEvals.js";
import { AP_SECTION_END, AP_SECTION_START, withApSection } from "../evals/agentEvalsDoc.js";
import { HOSTILE_RECORD } from "../evals/apHostile.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(ROOT, "docs/evals/ap-agents.json");
const MD = resolve(ROOT, "docs/agent-evals.md");
const SPEND = resolve(ROOT, "docs/runs/api-budget.jsonl");
const MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" } as const;
const IDS: Record<ApAgentName, readonly string[]> = { checker: AP_AGENT_CASES.map((k) => k.id), payer: AP_PAYER_CASES.map((k) => k.id) };

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const old: ApEvalRecord | null = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) as ApEvalRecord : null;
const hostile = (() => {
  const f = resolve(ROOT, HOSTILE_RECORD);
  if (!existsSync(f)) return undefined;
  const h = JSON.parse(readFileSync(f, "utf8")) as { line: string; commit: string };
  return { line: h.line, commit: h.commit };
})();

function write(rec: ApEvalRecord): void {
  writeFileSync(OUT, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(MD, withApSection(existsSync(MD) ? readFileSync(MD, "utf8") : "", apSection(rec, { start: AP_SECTION_START, end: AP_SECTION_END })));
}

if (args.includes("--render")) {
  if (!old) { console.error("no docs/evals/ap-agents.json yet"); process.exit(2); }
  write(buildRecord(old.rows, IDS, old.ran_at, hostile));
  console.log("docs/agent-evals.md: the payables section written from docs/evals/ap-agents.json");
  process.exit(0);
}

const maxUsd = Number(opt("--max-usd"));
if (!Number.isFinite(maxUsd) || maxUsd <= 0) { console.error("give --max-usd N: the most this run may spend, in USD"); process.exit(2); }
const runs = Math.max(1, Number(opt("--runs") ?? 1) || 1);
const names = (opt("--models") ?? "haiku,sonnet,opus").split(",") as (keyof typeof MODELS)[];
if (names.some((n) => !(n in MODELS))) { console.error(`--models takes ${Object.keys(MODELS).join(", ")}`); process.exit(2); }
const onlyAgent = opt("--agent") as ApAgentName | undefined;
const onlyCases = opt("--case")?.split(",");
const client = claudeClient();
if (!client) { console.error("KIT11_ANTHROPIC_API_KEY is not set"); process.exit(2); }
if (budgetStatus(SPEND).blocks["ap-agents"].over) { console.error("the ap-agents block of the API budget is spent (npm run budget)"); process.exit(2); }

const { commit, dirty } = evalCommit(["docs/evals/ap-agents.json", "docs/agent-evals.md", "docs/runs/api-budget.jsonl", HOSTILE_RECORD]);
const stamp = new Date().toISOString();
const fresh: RecordedRow[] = [];
let spent = 0;
let stopped: string | null = null;

/** The most one case could cost before any was measured: every turn with a long prompt and a long answer. */
const aPriori = (model: string, turns: number) => turns * (callCostMicros(model, { input: 12_000, output: 2_500, cache_read: 0, cache_write: 0 }) ?? 1_000_000);

type Job = { agent: ApAgentName; id: string; category: string; turns: number; run: (model: string) => Promise<EvalRow> };
const jobs: Job[] = [
  ...AP_AGENT_CASES.map((k): Job => ({ agent: "checker", id: k.id, category: k.category, turns: CHECKER_MAX_TURNS, run: (m) => checkerRow(k, m, client) })),
  ...AP_PAYER_CASES.map((k): Job => ({ agent: "payer", id: k.id, category: k.category, turns: PAYER_MAX_TURNS, run: (m) => payerRow(k, m, client) })),
].filter((j) => (!onlyAgent || j.agent === onlyAgent) && (!onlyCases || onlyCases.includes(j.id)));

outer: for (const name of names) {
  const model = MODELS[name];
  const seen: Record<ApAgentName, number> = { checker: 0, payer: 0 };
  for (const job of jobs) {
    for (let i = 0; i < runs; i++) {
      // The worst this case may cost: 1.5 times the dearest case of this agent and model so far, or the bound before any.
      const worst = seen[job.agent] > 0 ? Math.ceil(seen[job.agent] * 1.5) : aPriori(model, job.turns);
      if (!withinBudget(spent, worst, maxUsd) || budgetStatus(SPEND).blocks["ap-agents"].over) {
        stopped = `stopped before ${job.agent} ${job.id} on ${name}: ${(spent / 1e6).toFixed(4)} USD spent, the next case could cost up to ${(worst / 1e6).toFixed(4)} USD, the run may spend ${maxUsd} USD`;
        break outer;
      }
      const row = await job.run(model).catch((e: Error): EvalRow => ({
        agent: job.agent, case: job.id, category: job.category, model, expected: "", accept: [], raw: null, raw_unsafe: false, outcome: "error", right: false, unsafe_after: false,
        source: "fallback", note: `error: ${e.message.slice(0, 160)}`, cost_usd_micros: 0, ms: 0,
      }));
      spent += row.cost_usd_micros;
      seen[job.agent] = Math.max(seen[job.agent], row.cost_usd_micros);
      if (row.cost_usd_micros > 0) recordSpend(SPEND, { block: "ap-agents", usd_micros: row.cost_usd_micros, what: `ap-agent-evals ${job.agent} ${job.id} ${name}` });
      fresh.push({ ...row, ran_at: stamp, commit, dirty });
      console.log(`${row.right ? "right" : "WRONG"}  ${job.agent.padEnd(7)} ${job.id.padEnd(28)} ${name.padEnd(6)} ${row.source.padEnd(8)} raw ${String(row.raw).padEnd(30)} -> ${row.outcome.padEnd(7)} (expected ${row.expected})${row.raw_unsafe ? " FOOLED" : ""}${row.unsafe_after ? " UNSAFE" : ""}  ${(row.cost_usd_micros / 1e6).toFixed(4)} USD  ${(row.ms / 1000).toFixed(1)} s${row.note ? `  [${row.note}]` : ""}`);
    }
  }
}

// The rows measured now replace the same agent, case and model in the last record; the rest are kept as they ran.
const key = (r: EvalRow) => `${r.agent}|${r.case}|${r.model}`;
const now = new Set(fresh.map(key));
const known = new Set([...IDS.checker.map((id) => `checker|${id}`), ...IDS.payer.map((id) => `payer|${id}`)]);
const rows = [...(old?.rows ?? []).filter((r) => !now.has(key(r)) && known.has(`${r.agent}|${r.case}`)), ...fresh];
const rec = buildRecord(rows, IDS, stamp, hostile);
write(rec);
console.log(`\nspent ${(spent / 1e6).toFixed(4)} USD of ${maxUsd} USD${stopped ? `; ${stopped}` : ""}`);
for (const a of ["checker", "payer"] as const) {
  for (const [m, r] of Object.entries(rec.models[a])) {
    const s = r.summary;
    console.log(`${a} ${m}${r.complete ? "" : " (not all cases)"}: right ${s.right}/${s.cases}, not red team ${s.non_redteam.right}/${s.non_redteam.cases}; fooled ${s.fooled} (red team ${s.fooled_redteam}); unsafe after ${s.unsafe_after}; fallbacks ${s.fallbacks}; ${(s.cost_per_case_usd_micros / 1e6).toFixed(4)} USD per invoice; p50 ${s.p50_ms} ms, p95 ${s.p95_ms} ms`);
  }
}
console.log(`defaults: checker ${rec.defaults.checker ?? "none"}, payer ${rec.defaults.payer ?? "none"}`);
if (rows.some((r) => r.unsafe_after)) process.exitCode = 1;
