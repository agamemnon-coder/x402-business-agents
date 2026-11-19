// npm run eval:adversarial-v5 [-- --check]: the adversarial eval v5 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2, v3 and v4, in v5's world: src/evals/adversarialV5.ts) over the 100 cases of src/evals/adversarialV5Cases.ts,
// written after the third round of fixes (against v4's misses) and committed alone before anything ran on them (commit
// 9e8d59c1), with the pre-registration in that file's header. Offline: no model, no network, no key, no money.
// 19 Nov, after its first run: v5 found that non-Latin supplier names were held as fraud and that orders in Chinese,
// Japanese and Arabic were paid, and the shared rules were fixed for both (test/i18n-names-and-screens.test.ts), so v5 is
// no longer held out. Its first run is kept exactly as it was recorded (docs/evals/adversarial-v5.json and the report
// docs/evals/adversarial-v5.md): this never writes them again. It writes the run on today's code beside them
// (docs/evals/adversarial-v5-after.json); the report of that run is in the held-out set that followed, v6
// (docs/evals/adversarial-v6.md, npm run eval:adversarial-v6). --check writes nothing and fails when the committed
// after-fix record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, type AdvResult } from "../evals/adversarialV2.js";
import { V5_WORLD } from "../evals/adversarialV5.js";
import { ADV_V5_CASES } from "../evals/adversarialV5Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
/** The first run, held out, before the fixes: kept as it was recorded, never written again. */
export const V5_BEFORE = "docs/evals/adversarial-v5.json";
/** The run on today's code, no longer held out. */
export const V5_AFTER = "docs/evals/adversarial-v5-after.json";
const RECORD = V5_AFTER;
/** The commit that added the case file alone, before anything ran on it. */
export const V5_CASES_COMMIT = "9e8d59c1";

const r = await adversarialV2(ADV_V5_CASES, V5_WORLD);
const line = advLine(r.totals, "");
console.log(`v5 after the fixes (no longer held out): ${line}`);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
  if (!committed || scored(committed) !== scored(r)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v5 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const { commit, dirty } = evalCommit([RECORD]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v5 after the fixes that followed its first run (non-Latin supplier names, orders in other languages and scripts): the same 100 invoice cases (src/evals/adversarialV5Cases.ts, committed alone before any run, unchanged), with thirteen suppliers on file, on today's code. No longer held out: the fixes were made after reading this set's misses. The held-out run before them is docs/evals/adversarial-v5.json; the held-out set after them is v6. Offline, test data only.",
    held_out: false, ran_at, commit, dirty, cases_commit: V5_CASES_COMMIT, before: V5_BEFORE, command: "npm run eval:adversarial-v5", line, totals: r.totals, by_category: r.by_category, rows: r.rows,
  }, null, 2)}\n`);
  console.log(`wrote ${RECORD} (${V5_BEFORE} and docs/evals/adversarial-v5.md kept as recorded)`);
}
