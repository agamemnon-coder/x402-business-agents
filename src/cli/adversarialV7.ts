// npm run eval:adversarial-v7 [-- --check]: the adversarial eval v7 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v6, in v7's world: src/evals/adversarialV7.ts) over the 117 cases of src/evals/adversarialV7Cases.ts,
// written after the fixes that followed eval v6 and committed alone before anything ran on them (commit 34f502070), with
// the pre-registration in that file's header. Offline: no model, no network, no key, no money.
// 19 Nov, after its first run: v7 found 15 wrong payments and 6 false holds (4 more with the parser's fields), and the
// shared rules were fixed at their root causes (test/i18n-v7-root-causes.test.ts), so v7 is no longer held out. Its first
// run is kept exactly as it was recorded (docs/evals/adversarial-v7.json, with v6's run of that day in it, and the report
// docs/evals/adversarial-v7.md): this never writes them again. It writes the run on today's code beside them
// (docs/evals/adversarial-v7-after.json); the report of that run is in the held-out set that followed, v8
// (docs/evals/adversarial-v8.md, npm run eval:adversarial-v8). --check writes nothing and fails when the committed
// after-fix record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, type AdvResult } from "../evals/adversarialV2.js";
import { V7_WORLD, v7Hypotheses } from "../evals/adversarialV7.js";
import { ADV_V7_CASES } from "../evals/adversarialV7Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
/** The first run, held out, before the fixes: kept as it was recorded, never written again. */
export const V7_BEFORE = "docs/evals/adversarial-v7.json";
/** The run on today's code, no longer held out. */
export const V7_AFTER = "docs/evals/adversarial-v7-after.json";
const RECORD = V7_AFTER;
/** The commit that added the case file alone, before anything ran on it. */
export const V7_CASES_COMMIT = "34f502070";

const r = await adversarialV2(ADV_V7_CASES, V7_WORLD);
const line = advLine(r.totals, "");
const hypotheses = v7Hypotheses(ADV_V7_CASES, r.rows);
console.log(`v7 after the fixes (no longer held out): ${line}`);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}
for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
  if (!committed || scored(committed) !== scored(r)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v7 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const { commit, dirty } = evalCommit([RECORD]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v7 after the fixes that followed its first run (soft hyphens, zero-width spaces, direction marks and tatweel stripped where a script's orthography puts them, and still flagged inside Latin words and numbers; every script's digits in account numbers; an amount above the total below the total line, whatever the language; a person's name as holder at a company on file in any script; the Ukrainian romanisation and legal forms before a name; a customer's number quoted when paying; injections, pressure and bank details changed in Georgian, Armenian, Bengali, Tamil, Amharic, Urdu and Khmer): the same 117 invoice cases (src/evals/adversarialV7Cases.ts, committed alone before any run, unchanged), with thirty suppliers on file, on today's code. No longer held out: the fixes were made after reading this set's misses. The held-out run before them is docs/evals/adversarial-v7.json; the held-out set after them is v8. Offline, test data only.",
    held_out: false, ran_at, commit, dirty, cases_commit: V7_CASES_COMMIT, before: V7_BEFORE, command: "npm run eval:adversarial-v7", line, totals: r.totals, by_category: r.by_category, hypotheses, rows: r.rows,
  }, null, 2)}\n`);
  console.log(`wrote ${RECORD} (${V7_BEFORE} and docs/evals/adversarial-v7.md kept as recorded)`);
}
