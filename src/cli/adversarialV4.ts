// npm run eval:adversarial-v4 [-- --check]: the adversarial eval v4 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 and v3, in v4's world: src/evals/adversarialV4.ts) over the 100 cases of src/evals/adversarialV4Cases.ts,
// written after the second round of fixes (against v3's misses) and committed alone before anything ran on them.
// Offline: no model, no network, no key, no money.
// 19 Nov, third round: v4 found gaps, and rules were added against its misses (test/eval-v4-gaps.test.ts), so it is no
// longer held out. Its first run is kept as it was recorded (docs/evals/adversarial-v4.json, "before the third round of
// fixes"); this writes the run on today's code beside it (docs/evals/adversarial-v4-after.json) and the report with both
// (docs/evals/adversarial-v4.md). The held-out set after the third round is v5 (src/cli/adversarialV5.ts). --check writes nothing and fails
// when the committed after-fix record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, advMarkdown, type AdvResult } from "../evals/adversarialV2.js";
import { V4_WORLD } from "../evals/adversarialV4.js";
import { ADV_V4_CASES } from "../evals/adversarialV4Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
/** The first run, held out, before the third round of fixes: kept as it was recorded, never written again. */
const BEFORE = "docs/evals/adversarial-v4.json";
const RECORD = "docs/evals/adversarial-v4-after.json";
const DOC = "docs/evals/adversarial-v4.md";
/** The commit that added the case file alone, before anything ran on it. */
export const V4_CASES_COMMIT = "727d99d1";

const r = await adversarialV2(ADV_V4_CASES, V4_WORLD);
const line = advLine(r.totals, "");
console.log(`v4 after the third round of fixes (no longer held out): ${line}`);
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
  const before = JSON.parse(readFileSync(resolve(ROOT, BEFORE), "utf8")) as AdvResult & { ran_at: string; commit: string };
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v4 after the third round of fixes of 19 Nov: the same 100 invoice cases (src/evals/adversarialV4Cases.ts, committed alone before any run, unchanged), with eleven suppliers on file, on today's code. No longer held out: the rules were written against this set's misses (test/eval-v4-gaps.test.ts). The held-out run before them is docs/evals/adversarial-v4.json. Offline, test data only.",
    held_out: false, ran_at, commit, dirty, cases_commit: V4_CASES_COMMIT, before: BEFORE, command: "npm run eval:adversarial-v4", line, totals: r.totals, by_category: r.by_category, rows: r.rows,
  }, null, 2)}\n`);
  writeFileSync(resolve(ROOT, DOC), advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v4", cases: ADV_V4_CASES, case_file: "src/evals/adversarialV4Cases.ts", cases_commit: V4_CASES_COMMIT, command: "npm run eval:adversarial-v4",
    on_file: "eleven suppliers on file (v2's five, and a French, a Spanish, an Italian, a second American, a second British and a second German one)",
    before: { result: before, ran_at: before.ran_at, commit: before.commit, record: BEFORE },
    fixes: "the third round of fixes",
    held_out: `**v4 is no longer held out.** It was written after the second round of fixes, made against [v3](adversarial-v3.md)'s misses, committed alone (commit ${V4_CASES_COMMIT}) before anything ran on it, and its first run found gaps; on 19 Nov a third round of rules was added against exactly those misses, each test written first (test/eval-v4-gaps.test.ts): bank details given in an attached mail or as an "updated account", a link to pay through, a messaging app around the numbers on file ("solo por WhatsApp"), an account of the supplier's frozen or blocked, the injection screen reading YAML, hex, ROT13, full-width and lookalike letters and a link's title, the split window (27 days), a copy a few euros dearer on the same invoice date with the same lines, and, against its false holds, a supplier's name with umlauts written out or "und" for "&", a trade name after "dba" and a holder cut short by the bank, the last two at the account on file only. The numbers before the third round are the held-out measurement; the numbers after it show those fixes work on the cases they were written for, nothing more. The held-out set after the third round is [v5](adversarial-v5.md). The case file is unchanged since its commit (\`git diff ${V4_CASES_COMMIT} -- src/evals/adversarialV4Cases.ts\` is empty; its SHA-256 is pinned in test/adversarial-v4.test.ts).`,
  }));
  console.log(`wrote ${RECORD}, ${DOC} (${BEFORE} kept as recorded)`);
}
