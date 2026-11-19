// npm run eval:adversarial-v4 [-- --check]: the adversarial eval v4 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 and v3, in v4's world: src/evals/adversarialV4.ts) over the 100 held-out cases of
// src/evals/adversarialV4Cases.ts, written after the second round of fixes (against v3's misses) and committed alone
// before anything ran on them. Offline: no model, no network, no key, no money. Writes docs/evals/adversarial-v4.json
// (every row, totals, per category) and docs/evals/adversarial-v4.md. --check writes nothing and fails when the
// committed record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, advMarkdown, type AdvResult } from "../evals/adversarialV2.js";
import { V4_WORLD } from "../evals/adversarialV4.js";
import { ADV_V4_CASES } from "../evals/adversarialV4Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
const RECORD = "docs/evals/adversarial-v4.json";
const DOC = "docs/evals/adversarial-v4.md";
/** The commit that added the case file alone, before anything ran on it. */
export const V4_CASES_COMMIT = "727d99d1";

const r = await adversarialV2(ADV_V4_CASES, V4_WORLD);
const line = advLine(r.totals);
console.log(line);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(40)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
  if (!committed || scored(committed) !== scored(r)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v4 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v4: 100 held-out invoice cases (src/evals/adversarialV4Cases.ts, written after the second round of fixes against v3's misses and committed alone before any run), with eleven suppliers on file, through Purser with a script that always says pay in the model's place (fields as handed over, and fields from Purser's own parser) and a payer with no rules. Scored by plain code against each case's ground truth. Offline, test data only.",
    held_out: true, ran_at, commit, dirty, cases_commit: V4_CASES_COMMIT, command: "npm run eval:adversarial-v4", line, totals: r.totals, by_category: r.by_category, rows: r.rows,
  }, null, 2)}\n`);
  writeFileSync(resolve(ROOT, DOC), advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v4", cases: ADV_V4_CASES, case_file: "src/evals/adversarialV4Cases.ts", cases_commit: V4_CASES_COMMIT, command: "npm run eval:adversarial-v4",
    on_file: "eleven suppliers on file (v2's five, and a French, a Spanish, an Italian, a second American, a second British and a second German one)",
    held_out: `**Held out.** Written on 19 Nov after the second round of fixes, made against [v3](adversarial-v3.md)'s misses, committed alone (commit ${V4_CASES_COMMIT}) before anything ran on them, then run once. This is the measurement of Purser's rules after that round on invoices they were not written for. Every miss is listed below; none was fixed before this record.`,
  }));
  console.log(`wrote ${RECORD}, ${DOC}`);
}
