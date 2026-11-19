// npm run eval:adversarial-v3 [-- --check]: the adversarial eval v3 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2) over the 100 cases of src/evals/adversarialV3Cases.ts, written after the fixes against v2's misses and
// committed alone before anything ran on them. Offline: no model, no network, no key, no money.
// 19 Nov, second round: v3 found gaps, and rules were added against its misses, so it is no longer held out. Its first
// run is kept as it was recorded (docs/evals/adversarial-v3.json, "before the second round of fixes"); this writes the
// run on today's code beside it (docs/evals/adversarial-v3-after.json; since the fourth round of 19 Nov kept as recorded, and the run on today's code is
// docs/evals/adversarial-v3-rerun-2026-11-19.json) and the report with both
// (docs/evals/adversarial-v3.md). The held-out set after the second round is v4 (npm run eval:adversarial-v4); the third
// round (against v4's misses) is in today's code too. --check
// writes nothing and fails when the committed after-fix record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, advMarkdown, type AdvResult } from "../evals/adversarialV2.js";
import { ADV_V3_CASES } from "../evals/adversarialV3Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
/** The first run, held out, before the second round of fixes: kept as it was recorded, never written again. */
const BEFORE = "docs/evals/adversarial-v3.json";
/**
 * 19 Nov, fourth round: the run after the earlier rounds of fixes, kept as it was recorded, never written again. The run
 * on today's code (after the fourth round too) is its own dated record beside it (RECORD).
 */
const PREVIOUS_AFTER = "docs/evals/adversarial-v3-after.json";
const RECORD = "docs/evals/adversarial-v3-rerun-2026-11-19.json";
const DOC = "docs/evals/adversarial-v3.md";
/** The commit that added the case file alone, before anything ran on it. */
export const V3_CASES_COMMIT = "1013ecc8";

const r = await adversarialV2(ADV_V3_CASES);
const line = advLine(r.totals, "");
console.log(`v3 after the second round of fixes (no longer held out): ${line}`);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(40)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
  if (!committed || scored(committed) !== scored(r)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v3 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const before = JSON.parse(readFileSync(resolve(ROOT, BEFORE), "utf8")) as AdvResult & { ran_at: string; commit: string };
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v3 after the second round of fixes of 19 Nov: the same 100 invoice cases (src/evals/adversarialV3Cases.ts, committed alone before any run, unchanged), on today's code (since the third round of 19 Nov, against v4's misses, with it too). No longer held out: the rules were written against this set's misses. The held-out run before them is docs/evals/adversarial-v3.json. Since the fourth round of 19 Nov (an amount above its contract or purchase order is held, one below it is no mismatch; the screen reads a claimed sign-off), on the code with it too: a dated re-run, not held out; the run after the earlier rounds is kept as it was recorded (docs/evals/adversarial-v3-after.json). Offline, test data only.",
    held_out: false, ran_at, commit, dirty, cases_commit: V3_CASES_COMMIT, before: BEFORE, previous_after: PREVIOUS_AFTER, command: "npm run eval:adversarial-v3", line, totals: r.totals, by_category: r.by_category, rows: r.rows,
  }, null, 2)}\n`);
  writeFileSync(resolve(ROOT, DOC), advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v3", cases: ADV_V3_CASES, case_file: "src/evals/adversarialV3Cases.ts", cases_commit: V3_CASES_COMMIT, command: "npm run eval:adversarial-v3",
    before: { result: before, ran_at: before.ran_at, commit: before.commit, record: BEFORE },
    fixes: "the second round of fixes",
    next: "[v4](adversarial-v4.md)",
    held_out: `**v3 is no longer held out.** It was written after the fixes against [v2](adversarial-v2.md)'s misses, committed alone (commit ${V3_CASES_COMMIT}) before anything ran on it, and its first run found gaps; on 19 Nov a second round of rules was added against exactly those misses (words asking to pay another account anywhere in the document, the account holder under its Dutch, German, French and Spanish labels, a US account's routing number, the injection screen in Spanish, Portuguese and Italian, JSON-like and key = value orders, base64, forged role headers and notes to automated reviewers, requests to get around the checks, and the split and duplicate windows) and words of speed alone no longer hold an invoice. The numbers before the second round are the held-out measurement; the numbers after it show those fixes work on the cases they were written for, nothing more. The held-out measurement after the second round is [v4](adversarial-v4.md); a third round of rules followed against v4's misses, and the after-fix numbers here are on the code with it too (it also holds v3-dup-lagerhaus-plus-two, a copy EUR 2.00 dearer on the same day with the same lines). The case file is unchanged since its commit (\`git diff ${V3_CASES_COMMIT} -- src/evals/adversarialV3Cases.ts\` is empty; its SHA-256 is pinned in test/adversarial-v3.test.ts). A fourth round of 19 Nov, against the after-fix runs' last outcomes looser or stricter than their cases and the hostile-model eval's (an amount above its contract or purchase order is held, one below it is no mismatch; the injection screen reads a claimed sign-off, an order to Purser's agents and a German note to machines; test/eval-fourth-round.test.ts), is in the after-fix numbers too; the after-fix run before it is kept as it was recorded: [adversarial-v3-after.json](adversarial-v3-after.json).`,
  }));
  console.log(`wrote ${RECORD}, ${DOC} (${BEFORE} kept as recorded)`);
}
