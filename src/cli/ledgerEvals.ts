// npm run ledger-evals -- [--agents controller,books] [--models sonnet,haiku] [--max-usd N] [--cases a,b]: the ledger
// agents' evals with real models, plus code's fallback on the same cases. Writes docs/evals/ledger-agents.json and
// docs/agent-evals-ledger.md (rendered from it). Needs KIT11_ANTHROPIC_API_KEY; spends real money, recorded case by
// case in the ledger-agents block of the API budget (docs/runs/api-budget.jsonl), and stops before a call could take
// the run over --max-usd or the block over its cap (the worst cost of every call is checked, src/evals/coderSpend.ts).
// Without a key it says so and writes nothing. Never part of npm test.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUDGET_BLOCKS, budgetStatus, recordSpend } from "../claude/budget.js";
import { claudeClient } from "../claude/reader.js";
import { BOOKS_CASES, CONTROLLER_CASES } from "../evals/ledgerAgentCases.js";
import { ledgerEvalsDoc, runBooksCase, runControllerCase, type EvalRow, type LedgerEvalRecord } from "../evals/ledgerAgentEvals.js";
import { spendGuard } from "../evals/coderSpend.js";
import { MODELS } from "../claude/reader.js";

const ALL = { haiku: MODELS.classify, sonnet: MODELS.act, opus: MODELS.review } as const;
const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? "" : null);
const fail = (why: string): never => { console.error(why); process.exit(2); };

const maxUsd = Number(arg("--max-usd") ?? 3);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) fail("--max-usd takes an amount in dollars above 0");
const names = (arg("--models") ?? "sonnet").split(",").map((s) => s.trim());
if (names.some((n) => !(n in ALL))) fail(`--models takes ${Object.keys(ALL).join(", ")}`);
const agents = (arg("--agents") ?? "controller,books").split(",").map((s) => s.trim());
if (agents.some((a) => a !== "controller" && a !== "books")) fail("--agents takes controller, books");
const only = arg("--cases")?.split(",").map((s) => s.trim()) ?? null;

const inner = claudeClient() ?? fail("KIT11_ANTHROPIC_API_KEY is not set: no live run, and nothing written");
const ROOT = resolve(import.meta.dirname, "../..");
const SPEND = join(ROOT, "docs/runs/api-budget.jsonl");
const CAP_MICROS = BUDGET_BLOCKS["ledger-agents"] * 1_000_000;
const MAX_MICROS = Math.round(maxUsd * 1_000_000);
const blockMicros = () => Math.round(budgetStatus(SPEND).blocks["ledger-agents"].spentUsd * 1_000_000);
if (blockMicros() >= CAP_MICROS) fail("the ledger-agents block of the API budget is spent (npm run budget): no live run");

const git = (a: string[]) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return ""; } };
const COMMIT = git(["rev-parse", "--short=12", "HEAD"]) || "unknown";
const DIRTY = git(["status", "--porcelain", "--", "src"]) !== "";

const rows: EvalRow[] = [];
let spent = 0;
let stopped: string | null = null;
const guard = spendGuard(inner, () => Math.min(MAX_MICROS - spent, CAP_MICROS - blockMicros()));

type Job = { agent: "controller" | "books"; id: string; run: (model: string | null) => Promise<EvalRow> };
const jobs: Job[] = [
  ...(agents.includes("controller") ? CONTROLLER_CASES.map((c): Job => ({ agent: "controller", id: c.id, run: (m) => runControllerCase(c, m ? guard.client : null, m ?? "none") })) : []),
  ...(agents.includes("books") ? BOOKS_CASES.map((c): Job => ({ agent: "books", id: c.id, run: (m) => runBooksCase(c, m ? guard.client : null, m ?? "none") })) : []),
].filter((j) => !only || only.includes(j.id));

outer: for (const name of names) {
  const model = ALL[name as keyof typeof ALL];
  for (const j of jobs) {
    const before = guard.used();
    const row = await j.run(model);
    const cost = guard.used() - before;
    spent += cost;
    if (cost > 0) recordSpend(SPEND, { block: "ledger-agents", usd_micros: cost, what: `ledger-evals ${j.agent} ${j.id} ${name}` });
    rows.push(row);
    console.log(`${row.passed ? "pass" : "FAIL"} ${j.agent} ${j.id} ${name} $${(cost / 1e6).toFixed(4)} ${row.mistakes.join("; ")}`);
    if (guard.refused()) { stopped = guard.refused(); break outer; }
  }
}
// Code's fallback on the same cases: no model, no cost.
for (const j of jobs) rows.push(await j.run(null));

if (!rows.some((r) => r.source === "claude")) fail("no case was decided by Claude (every call failed): nothing written");
const record: LedgerEvalRecord = { ran_at: new Date().toISOString(), commit: COMMIT, dirty: DIRTY, max_usd: maxUsd, spent_usd_micros: spent, stopped, rows };
mkdirSync(join(ROOT, "docs/evals"), { recursive: true });
writeFileSync(join(ROOT, "docs/evals/ledger-agents.json"), `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(join(ROOT, "docs/agent-evals-ledger.md"), ledgerEvalsDoc(record));
console.log(`spent ${(spent / 1e6).toFixed(4)} USD; ${rows.filter((r) => r.passed).length}/${rows.length} rows passed${stopped ? `; stopped: ${stopped}` : ""}`);
