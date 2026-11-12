// npm run chain:soak -- [--runs 20] [--max-usd 25] [--seed 7000] [--out <dir for per-run records>]: the AP chain soak
// (master-list line 402, src/evals/chainSoak.ts). Claude live, the rails stand-ins. Spends from the `soak` block of the
// Claude budget only (src/claude/budget.ts): every call goes through a spend guard that refuses one whose worst cost does
// not fit in what is left under --max-usd, the soak block's cap and the $140 stop. Each run's cost is recorded with its run
// id. A run already on file in --out is not run again. Writes docs/runs/<date>-chain-soak.md and .json.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUDGET_BLOCKS, BUDGET_STOP_USD, budgetStatus, recordSpend, spendRefusal } from "../claude/budget.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import { CODER_MODEL } from "../ap/coderCore.js";
import { runSoakRun, summarise, type SoakRun } from "../evals/chainSoak.js";
import { soakMarkdown } from "../evals/chainSoakDoc.js";
import { spendGuard } from "../evals/coderSpend.js";

const ROOT = resolve(import.meta.dirname, "../..");
const SPEND = join(ROOT, "docs/runs/api-budget.jsonl");
const args = process.argv.slice(2);
const flag = (name: string, d: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1]! : d; };
const runs = Number(flag("runs", "20"));
const maxUsd = Number(flag("max-usd", "25"));
const seedBase = Number(flag("seed", "7000"));
const date = new Date().toISOString().slice(0, 10);
const outDir = resolve(flag("out", join(ROOT, "..", "chain-soak-records", date)));
const fail = (why: string): never => { console.error(`REFUSED: ${why}`); process.exit(2); };

if (!Number.isInteger(runs) || runs < 1 || runs > 50) fail("--runs is 1 to 50");
if (!(maxUsd > 0) || maxUsd > BUDGET_BLOCKS.soak) fail(`--max-usd is more than 0 and at most the soak block's $${BUDGET_BLOCKS.soak}`);
const inner = claudeClient();
if (!inner) fail("KIT11_ANTHROPIC_API_KEY is not set: the soak needs Claude live");
const refusal = spendRefusal(SPEND, "soak");
if (refusal) fail(refusal);
process.env.KIT11_AP_AGENTS = "on";
mkdirSync(outDir, { recursive: true });

const micros = (usd: number) => Math.round(usd * 1e6);
const room = () => {
  const s = budgetStatus(SPEND);
  return Math.min(micros(maxUsd) - micros(soakSpentHere), micros(BUDGET_BLOCKS.soak - s.blocks.soak.spentUsd), micros(BUDGET_STOP_USD - s.totalUsd));
};
let soakSpentHere = 0;
const results: SoakRun[] = [];
let stopped: string | null = null;
for (let i = 1; i <= runs; i++) {
  const run = `soak-${date}-${String(i).padStart(2, "0")}`;
  const file = join(outDir, `${run}.json`);
  if (existsSync(file)) { results.push(JSON.parse(readFileSync(file, "utf8")) as SoakRun); console.log(`${run}: on file, not run again`); continue; }
  // A new guard per run: it counts this run's calls; room() already holds what earlier runs recorded.
  const guard = spendGuard(inner!, room);
  const t0 = Date.now();
  const r = await runSoakRun(run, seedBase + i, { client: guard.client, now: new Date() });
  const spent = guard.used();
  soakSpentHere += spent / 1e6;
  if (spent > 0) recordSpend(SPEND, { block: "soak", usd_micros: Math.round(spent), what: `chain soak ${run} (Claude live, rails stand-in)`, run });
  writeFileSync(file, `${JSON.stringify(r, null, 1)}\n`);
  results.push(r);
  console.log(`${run} seed ${seedBase + i}: ${r.gate.pass ? "PASS" : "FAIL"} ${r.gate.failures.join("; ")} · ${r.record.documents.length} docs · $${(spent / 1e6).toFixed(4)} · ${Math.round((Date.now() - t0) / 1000)} s`);
  if (guard.refused()) { stopped = `stopped after ${run}: ${guard.refused()}`; break; }
}

const s = summarise(results);
const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const spentTotal = results.reduce((a, r) => a + r.cost_usd_micros, 0) / 1e6;
const budgetLine = `Budget: at most $${maxUsd} from the soak block ($${BUDGET_BLOCKS.soak}); this soak's calls cost $${spentTotal.toFixed(4)} by the API's own token counts, recorded per run in docs/runs/api-budget.jsonl.${stopped ? ` ${stopped}.` : ""}`;
const models = `classifier ${MODELS.classify}, reader ${MODELS.act}, coder ${CODER_MODEL}, review note ${MODELS.review} (the models main ships)`;
const md = soakMarkdown(results, s, { date, commit, models, budgetLine });
writeFileSync(join(ROOT, `docs/runs/${date}-chain-soak.md`), md);
writeFileSync(join(ROOT, `docs/runs/${date}-chain-soak.json`), `${JSON.stringify({ date, commit, models, summary: s, stopped, runs: results.map((r) => ({ record: r.record, gate: r.gate, executed: r.executed, cost_usd_micros: r.cost_usd_micros, approval_note: r.approval_note, not_planned: r.not_planned })) }, null, 1)}\n`);
console.log(`\n${s.passed} of ${s.runs} runs pass the gate; ${s.total.claude_pct}% Claude; ${s.total.unsafe} unsafe; ${s.total.double_payments} double; $${spentTotal.toFixed(4)}`);
