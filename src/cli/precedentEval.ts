// npm run precedent-eval -- [--model claude-haiku-5-5] [--max-usd 6] [--case a,b] [--concurrency 4]
// The Checker with and without precedent from the CFO's past decisions, on the payables eval set, with real Claude calls
// (src/evals/precedentEval.ts). Never in CI. Without KIT11_ANTHROPIC_API_KEY it says "not run" and writes nothing.
// Writes docs/evals/precedent.json: every row, the summary, the model, the commit and the time.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { claudeClient } from "../claude/reader.js";
import { AP_AGENT_CASES } from "../evals/apAgentCases.js";
import { evalCommit } from "../evals/commit.js";
import { labelledFromEval, precedentRow, summariseArms, withPrecedent, type PrecedentRow } from "../evals/precedentEval.js";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(ROOT, "docs/evals/precedent.json");
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const model = opt("--model") ?? "claude-haiku-5-5";
const maxUsd = Number(opt("--max-usd") ?? "6");
const only = opt("--case")?.split(",");
const concurrency = Number(opt("--concurrency") ?? "4");

const client = claudeClient();
if (!client) {
  console.log("precedent eval: not run (no KIT11_ANTHROPIC_API_KEY). Nothing is published.");
  process.exit(0);
}
const cases = AP_AGENT_CASES.filter((k) => !only || only.includes(k.id));
const labelled = labelledFromEval(AP_AGENT_CASES);
const jobs = cases.flatMap((k) => [{ k, arm: "without" as const }, { k: withPrecedent(k, labelled), arm: "with" as const }]);
const rows: PrecedentRow[] = [];
let spent = 0, stopped = false;
async function worker() {
  for (;;) {
    const j = jobs.shift();
    if (!j || stopped) return;
    if (spent > maxUsd * 1e6) { stopped = true; return; }
    const r = await precedentRow(j.k, j.arm, model, client);
    spent += r.cost_usd_micros;
    rows.push(r);
    console.log(`${r.arm.padEnd(7)} ${r.case.padEnd(28)} expected ${r.expected.padEnd(7)} claude ${String(r.raw).padEnd(7)} after ${r.outcome.padEnd(7)} ${r.right ? "right" : "WRONG"} (${r.precedents} precedents)`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
// Only cases both arms finished are compared.
const done = new Set(rows.filter((r) => r.arm === "without").map((r) => r.case).filter((c) => rows.some((r) => r.arm === "with" && r.case === c)));
const paired = rows.filter((r) => done.has(r.case)).sort((a, b) => a.case.localeCompare(b.case) || a.arm.localeCompare(b.arm));
const summary = summariseArms(paired);
const record = {
  what: "The Checker on the payables eval set, without and with precedent: the CFO's outcomes on the most similar other cases (leave one out). Agreement with the case's recorded outcome. In-context learning only; no model is trained.",
  model, ran_at: new Date().toISOString(), commit: evalCommit(["docs/evals/precedent.json"]), stopped_by_budget: stopped, cost_usd: Number((spent / 1e6).toFixed(4)),
  summary, rows: paired,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ summary, cost_usd: record.cost_usd, stopped_by_budget: stopped }, null, 2));
