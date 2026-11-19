// npm run eval:adversarial-v6 [-- --check]: the adversarial eval v6 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v5, in v6's world: src/evals/adversarialV6.ts) over the 108 cases of src/evals/adversarialV6Cases.ts,
// written after the fixes that followed eval v5 and committed alone before anything ran on them (commit a7d9dfa06), with
// the pre-registration in that file's header. Offline: no model, no network, no key, no money.
// 19 Nov, after its first run: v6 found 7 wrong payments and 1 false hold (3 more with the parser's fields), and the
// shared rules were fixed at their root causes (test/i18n-v6-root-causes.test.ts), so v6 is no longer held out. Its first
// run is kept exactly as it was recorded (docs/evals/adversarial-v6.json, with v5's run of that day in it, and the report
// docs/evals/adversarial-v6.md): this never writes them again. It writes the run on today's code beside them
// (docs/evals/adversarial-v6-after.json); the report of that run is in the held-out set that followed, v7
// (docs/evals/adversarial-v7.md, npm run eval:adversarial-v7). --check writes nothing and fails when the committed
// after-fix record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, type AdvResult } from "../evals/adversarialV2.js";
import { V6_WORLD, v6Hypotheses } from "../evals/adversarialV6.js";
import { ADV_V6_CASES } from "../evals/adversarialV6Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
/** The first run, held out, before the fixes: kept as it was recorded, never written again. */
export const V6_BEFORE = "docs/evals/adversarial-v6.json";
/** The run on today's code, no longer held out. */
export const V6_AFTER = "docs/evals/adversarial-v6-after.json";
const RECORD = V6_AFTER;
/** The commit that added the case file alone, before anything ran on it. */
export const V6_CASES_COMMIT = "a7d9dfa06";

const r = await adversarialV2(ADV_V6_CASES, V6_WORLD);
const line = advLine(r.totals, "");
const hypotheses = v6Hypotheses(ADV_V6_CASES, r.rows);
console.log(`v6 after the fixes (no longer held out): ${line}`);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}
for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
  if (!committed || scored(committed) !== scored(r)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v6 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const { commit, dirty } = evalCommit([RECORD]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v6 after the fixes that followed its first run (a joiner a script needs read as hidden characters; totals in other scripts' digits and other languages' labels; words asking for more than the total; a person's name as holder of a company's account on file; another account number in the words; bank details changed, CEO pressure, secrecy and 'already checked' in more languages): the same 108 invoice cases (src/evals/adversarialV6Cases.ts, committed alone before any run, unchanged), with twenty-one suppliers on file, on today's code. No longer held out: the fixes were made after reading this set's misses. The held-out run before them is docs/evals/adversarial-v6.json; the held-out set after them is v7. Offline, test data only.",
    held_out: false, ran_at, commit, dirty, cases_commit: V6_CASES_COMMIT, before: V6_BEFORE, command: "npm run eval:adversarial-v6", line, totals: r.totals, by_category: r.by_category, hypotheses, rows: r.rows,
  }, null, 2)}\n`);
  console.log(`wrote ${RECORD} (${V6_BEFORE} and docs/evals/adversarial-v6.md kept as recorded)`);
}
