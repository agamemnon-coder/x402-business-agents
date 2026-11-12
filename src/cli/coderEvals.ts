// npm run coder-evals -- [--models haiku,sonnet] [--runs N] [--max-usd N] [--cases a,b]: the Coder agent's evals with
// real models (src/evals/coderCases.ts). Per model, every case is filed through the real inbox on a fresh in-memory
// ledger and coded by the runner's own Coder (src/ap/coderAgent.ts codeInvoice) with that model. Writes
// docs/evals/coder.json (the run record) and the Coder section of docs/agent-evals.md (rendered from it by
// src/evals/coderReport.ts). Needs KIT11_ANTHROPIC_API_KEY; spends real money, recorded in the coder block of the API
// budget (docs/runs/api-budget.jsonl), and stops before a call could take the run over --max-usd or the block over its
// cap (src/evals/coderSpend.ts checks the worst cost of every call). Without a key, or when every call fails, it says so and writes no numbers. Never part of npm test.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codeInvoice } from "../ap/coderAgent.js";
import { CODER_MODEL } from "../ap/coderCore.js";
import { BUDGET_BLOCKS, budgetStatus, recordSpend } from "../claude/budget.js";
import { claudeClient } from "../claude/reader.js";
import { openDb } from "../db/open.js";
import { CODER_CASES, fileCoderCase, scoreCoding } from "../evals/coderCases.js";
import { coderSummary, withCoderSection, type CoderEvalRecord, type CoderEvalRow } from "../evals/coderReport.js";
import { spendGuard } from "../evals/coderSpend.js";

const ALL = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" } as const;
const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? "" : null);
const fail = (why: string): never => { console.error(why); process.exit(2); };

const runs = Number(arg("--runs") ?? 1);
if (!Number.isSafeInteger(runs) || runs < 1) fail("--runs takes a whole number of 1 or more");
const maxUsd = Number(arg("--max-usd") ?? 1);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) fail("--max-usd takes an amount in dollars above 0");
const names = (arg("--models") ?? "haiku,sonnet").split(",").map((s) => s.trim());
const badModel = names.filter((n) => !(n in ALL));
if (badModel.length) fail(`no such model: ${badModel.join(", ")} (use ${Object.keys(ALL).join(", ")})`);
const only = arg("--cases")?.split(",").map((s) => s.trim()) ?? null;
const unknown = only?.filter((c) => !CODER_CASES.some((x) => x.id === c)) ?? [];
if (unknown.length) fail(`no such case: ${unknown.join(", ")}`);
const cases = CODER_CASES.filter((c) => !only || only.includes(c.id));

const client = claudeClient() ?? fail("KIT11_ANTHROPIC_API_KEY is not set: no live run, and nothing written");

const ROOT = resolve(import.meta.dirname, "../..");
const SPEND = join(ROOT, "docs/runs/api-budget.jsonl");
const CAP_MICROS = BUDGET_BLOCKS.coder * 1_000_000;
const MAX_MICROS = Math.round(maxUsd * 1_000_000);
const blockMicros = () => Math.round(budgetStatus(SPEND).blocks.coder.spentUsd * 1_000_000);
if (blockMicros() >= CAP_MICROS) fail("the coder block of the API budget is spent (npm run budget): no live run");

// The code the rows ran: the commit, and whether the checkout had changes outside this run's own files.
const git = (a: string[]) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return ""; } };
const COMMIT = git(["rev-parse", "--short=12", "HEAD"]) || "unknown";
const DIRTY = git(["status", "--porcelain", "--", ".", ":!docs/evals/coder.json", ":!docs/agent-evals.md", ":!docs/runs/api-budget.jsonl"]) !== "";

const dir = mkdtempSync(join(tmpdir(), "coder-evals-"));
const rows: CoderEvalRow[] = [];
let spent = 0;
let stopped: string | null = null;
try {
  outer: for (const name of names) {
    const model = ALL[name as keyof typeof ALL];
    for (const c of cases) {
      for (let run = 1; run <= runs; run++) {
        // Checked before every call of the case: the room left under the run's own limit and under the block's cap,
        // with what is already recorded in it. A call that could take either over is not made.
        const blockAtStart = blockMicros();
        const guard = spendGuard(client, () => Math.min(MAX_MICROS - spent, CAP_MICROS - blockAtStart));
        const db = openDb(":memory:");
        const filed = await fileCoderCase(db, join(dir, `${name}-${c.id}-${run}`), c, new Date());
        const t0 = Date.now();
        const out = await codeInvoice(db, filed.inv, filed.text, { client: guard.client, model });
        const latency = Date.now() - t0;
        db.close();
        const cost = out.run?.costMicros ?? 0;
        spent += cost;
        if (cost > 0) recordSpend(SPEND, { block: "coder", usd_micros: cost, what: `coder-evals ${c.id} ${name} run ${run}` });
        // A case the guard cut short measures nothing about the model: its money is recorded above, its row is not kept.
        const refused = guard.refused();
        if (refused) { stopped = `${c.id} on ${model}: ${refused} under --max-usd ${maxUsd} or the coder block's cap of ${BUDGET_BLOCKS.coder} USD`; break outer; }
        const lines = out.coding.lines.map((l) => ({ line_no: l.line_no, account: l.account, vat_code: l.vat_code, cost_centre: l.cost_centre }));
        const row: CoderEvalRow = {
          case: c.id, model, run, expected: c.expect, raw: out.raw,
          enforced: { status: out.coding.status, source: out.coding.source, overridden_by: out.coding.overridden_by, refused_because: out.coding.refused_because, lines },
          no_answer: out.raw === null, run_status: out.run?.status ?? "not_run", run_note: out.run?.note ?? null, turns: out.run?.turns ?? 0,
          cost_usd_micros: cost, latency_ms: latency, correct: scoreCoding(c, lines),
        };
        rows.push(row);
        const ok = row.correct.account && row.correct.vat_code && row.correct.cost_centre;
        console.log(`${ok ? "right" : "WRONG"}  ${c.id.padEnd(28)} ${name.padEnd(7)} ${row.enforced.source.padEnd(8)} ${(row.enforced.overridden_by ?? "").padEnd(22)} ${(cost / 1e6).toFixed(4)} USD  ${(latency / 1000).toFixed(1)} s  ${row.run_status}${row.run_note ? `: ${row.run_note.slice(0, 120)}` : ""}`);
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (stopped) console.error(`stopped: ${stopped}`);
if (rows.length === 0) fail("no case ran: nothing written");
// No model answered at all (the API failed on every call): there is nothing to measure, so no numbers are written.
if (rows.every((r) => r.no_answer && r.run_status === "unavailable" && r.cost_usd_micros === 0)) {
  fail(`the API failed on every call (${rows[0]!.run_note ?? "no note"}): nothing written`);
}

const record: CoderEvalRecord = {
  ran_at: new Date().toISOString(), commit: COMMIT, dirty: DIRTY, runs, max_usd: maxUsd, models: names.map((n) => ALL[n as keyof typeof ALL]),
  cases: cases.map((c) => c.id), all_cases: CODER_CASES.length, coder_model: CODER_MODEL, stopped, rows,
};
mkdirSync(join(ROOT, "docs/evals"), { recursive: true });
writeFileSync(join(ROOT, "docs/evals/coder.json"), JSON.stringify(record, null, 2) + "\n");
const mdPath = join(ROOT, "docs/agent-evals.md");
writeFileSync(mdPath, withCoderSection(readFileSync(mdPath, "utf8"), record));

const s = coderSummary(record);
for (const m of s.models) {
  console.log(`\n${m.model}: account ${(m.account * 100).toFixed(1)}%, VAT code ${(m.vat_code * 100).toFixed(1)}%, cost centre ${(m.cost_centre * 100).toFixed(1)}%, refused ${JSON.stringify(m.refused)}, no answer ${m.no_answer}, ${(m.cost_per_invoice_micros / 1e6).toFixed(4)} USD per invoice, p50 ${(m.p50_ms / 1000).toFixed(1)} s, p95 ${(m.p95_ms / 1000).toFixed(1)} s${m.complete ? "" : " (not every case ran)"}`);
}
console.log(`\nthis run spent ${(spent / 1e6).toFixed(4)} USD; default model by the 95% bar: ${s.chosen ?? `none (CODER_MODEL stays ${CODER_MODEL})`}`);
