// npm run eval:adversarial-v8 [-- --check]: the adversarial eval v8 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v7, in v8's world: src/evals/adversarialV8.ts) over the 140 cases of src/evals/adversarialV8Cases.ts,
// written after the fixes that followed eval v7 and committed alone before anything ran on them (commit 7fabd5262), with
// the pre-registration in that file's header. Offline: no model, no network, no key, no money.
// 20 Nov, after its first run: v8 found 20 wrong payments and 6 false holds (the same with the parser's fields), and the
// shared rules were fixed at their root causes (test/i18n-v8-root-causes.test.ts), so v8 is no longer held out. Its first
// run is kept exactly as it was recorded (docs/evals/adversarial-v8.json, with v7's run of that day in it, and the report
// docs/evals/adversarial-v8.md, which has a dated note on top): this never writes them again. It writes the run on
// today's code beside them (docs/evals/adversarial-v8-after.json), labelled not held out. --check writes nothing and
// fails when the committed after-fix record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, type AdvResult } from "../evals/adversarialV2.js";
import { V8_WORLD, v8Hypotheses } from "../evals/adversarialV8.js";
import { ADV_V8_CASES } from "../evals/adversarialV8Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
/** The first run, held out, before the fixes: kept as it was recorded, never written again. */
export const V8_BEFORE = "docs/evals/adversarial-v8.json";
/** The run on today's code, no longer held out. */
export const V8_AFTER = "docs/evals/adversarial-v8-after.json";
const RECORD = V8_AFTER;
/** The commit that added the case file alone, before anything ran on it. */
export const V8_CASES_COMMIT = "7fabd5262";

const r = await adversarialV2(ADV_V8_CASES, V8_WORLD);
const line = advLine(r.totals, "");
const hypotheses = v8Hypotheses(ADV_V8_CASES, r.rows);
console.log(`v8 after the fixes (no longer held out): ${line}`);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}
for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
  if (!committed || scored(committed) !== scored(r)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v8 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const { commit, dirty } = evalCommit([RECORD]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v8 after the fixes that followed its first run (Malayalam's chillu letters in the older encoding and Yiddish's ligatures as the letters they are; Mongolian, Kazakh and other Cyrillic letters romanised as their banks write them, Mongolian ХХК as a legal form, and a name in plain ASCII as the name on file spelled without its letters no mark makes; a number its own label calls a registration, tax or telephone number is no account; a document valid without a signature is no claim about approval; a currency as its own script abbreviates it; a heading that names an AI among another script's words; injections, pressure and bank details changed in Sinhala, Lao, Mongolian, Burmese, Gujarati, Malayalam, Telugu, Kannada, Yiddish, Tibetan, Syriac, Inuktitut syllabics and Javanese): the same 140 invoice cases (src/evals/adversarialV8Cases.ts, committed alone before any run, unchanged), with forty-two suppliers on file, on today's code. No longer held out: the fixes were made after reading this set's misses. The held-out run before them is docs/evals/adversarial-v8.json. Offline, test data only.",
    held_out: false, ran_at, commit, dirty, cases_commit: V8_CASES_COMMIT, before: V8_BEFORE, command: "npm run eval:adversarial-v8", line, totals: r.totals, by_category: r.by_category, hypotheses, rows: r.rows,
  }, null, 2)}\n`);
  console.log(`wrote ${RECORD} (${V8_BEFORE} and docs/evals/adversarial-v8.md kept as recorded)`);
}
