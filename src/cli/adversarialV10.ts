// npm run eval:adversarial-v10 [-- --check]: the adversarial eval v10 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v9, in v10's world: src/evals/adversarialV10.ts) over the 129 cases of src/evals/adversarialV10Cases.ts,
// written after the fixes that followed eval v9 and the rule that sends text Purser cannot read to the CFO, and committed
// alone before anything ran on them (V10_CASES_COMMIT), with the pre-registration in that file's header. Offline: no
// model, no network, no key, no money.
// 20 Nov, after its first run: v10 found 15 wrong payments and 7 false holds (8 with the parser's fields) (the same with the parser's fields), and the
// shared rules were fixed at their root causes (test/i18n-v10-root-causes.test.ts), so v10 is no longer held out. Its first
// run is kept exactly as it was recorded (docs/evals/adversarial-v10.json, with v9's run of that day in it, and the report
// docs/evals/adversarial-v10.md, which has a dated note on top): this never writes them again. It writes the run on
// today's code beside them (docs/evals/adversarial-v10-after.json), labelled not held out. --check writes nothing and
// fails when the committed after-fix record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, type AdvResult } from "../evals/adversarialV2.js";
import { unreadCost, V10_CASES_COMMIT, V10_WORLD, v10Hypotheses } from "../evals/adversarialV10.js";
import { ADV_V10_CASES } from "../evals/adversarialV10Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
/** The first run, held out, before the fixes: kept as it was recorded, never written again. */
export const V10_BEFORE = "docs/evals/adversarial-v10.json";
/** The run on today's code, no longer held out. */
export const V10_AFTER = "docs/evals/adversarial-v10-after.json";
const RECORD = V10_AFTER;

const r = await adversarialV2(ADV_V10_CASES, V10_WORLD);
const line = advLine(r.totals, "");
const hypotheses = v10Hypotheses(ADV_V10_CASES, r.rows);
const cost = { purser_script: unreadCost(r.rows, "purser_script"), purser_script_parser: unreadCost(r.rows, "purser_script_parser") };
console.log(`v10 after the fixes (no longer held out): ${line}`);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : x.to_cfo_not_held ? "to the CFO, not held" : x.cfo_not_needed ? "to the CFO, could be paid alone" : "other"} (${x.decided_by})`);
}
for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);
console.log(`  legitimate invoices sent to the CFO for text Purser cannot read: ${cost.purser_script.length} (parser: ${cost.purser_script_parser.length})`);

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
  if (!committed || scored(committed) !== scored(r)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v10 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const { commit, dirty } = evalCommit([RECORD]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v10 after the fixes that followed its first run (words compared with their accents; short words close languages share no longer outweigh a language's own; Croatian, Bosnian and Serbian in Latin letters, Slovenian, the Pacific and West African creoles and more African and Philippine languages known as languages the lists do not hold; a claim that the buyer's own people approved, and a check skipped with words between, in English, German, French, Spanish, Dutch, Italian and Portuguese; the MD and office deadlines; Central Asian legal forms romanised; a company's capital and local currency abbreviations): the same 129 invoice cases (src/evals/adversarialV10Cases.ts, committed alone before any run, unchanged), with sixty-six suppliers on file, on today's code. No longer held out: the fixes were made after reading this set's misses. The held-out run before them is docs/evals/adversarial-v10.json. Offline, test data only.",
    held_out: false, ran_at, commit, dirty, cases_commit: V10_CASES_COMMIT, before: V10_BEFORE, command: "npm run eval:adversarial-v10", line, totals: r.totals, by_category: r.by_category, hypotheses,
    sent_to_cfo_unread_where_pay: cost, rows: r.rows,
  }, null, 2)}\n`);
  console.log(`wrote ${RECORD} (${V10_BEFORE} and docs/evals/adversarial-v10.md kept as recorded)`);
}
