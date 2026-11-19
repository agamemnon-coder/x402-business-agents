// npm run eval:adversarial-v2 [-- --check]: the adversarial eval v2 (src/evals/adversarialV2.ts) over the 100 cases of
// src/evals/adversarialV2Cases.ts, committed before the runner. Offline: no model, no network, no key, no money.
// 19 Nov: v2 found gaps, and rules were added against its misses, so it is no longer held out. Its first run is kept as
// it was recorded (docs/evals/adversarial-v2.json, "before the fixes"); this writes the run on today's code beside it
// (docs/evals/adversarial-v2-after.json; since the fourth round of 19 Nov kept as recorded, and the run on today's code is
// docs/evals/adversarial-v2-rerun-2026-11-19.json) and the report with both (docs/evals/adversarial-v2.md). The held-out set
// after the fixes is v3 (npm run eval:adversarial-v3). --check writes nothing and fails when the committed after-fix
// record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, advMarkdown, type AdvResult } from "../evals/adversarialV2.js";
import { ADV_V2_CASES } from "../evals/adversarialV2Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
/** The first run, before the fixes: kept as it was recorded, never written again. */
const BEFORE = "docs/evals/adversarial-v2.json";
/**
 * 19 Nov, fourth round: the run after the earlier rounds of fixes, kept as it was recorded, never written again. The run
 * on today's code (after the fourth round too) is its own dated record beside it (RECORD).
 */
const PREVIOUS_AFTER = "docs/evals/adversarial-v2-after.json";
const RECORD = "docs/evals/adversarial-v2-rerun-2026-11-19.json";
const DOC = "docs/evals/adversarial-v2.md";
/** The commit that added the case file alone, before the runner existed. */
const CASES_COMMIT = "fe5fc388";

const r = await adversarialV2(ADV_V2_CASES);
const line = advLine(r.totals, "");
console.log(`v2 after the fixes (no longer held out): ${line}`);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(40)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
  if (!committed || scored(committed) !== scored(r)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v2 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const before = JSON.parse(readFileSync(resolve(ROOT, BEFORE), "utf8")) as AdvResult & { ran_at: string; commit: string };
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v2 after the fixes of 19 Nov: the same 100 invoice cases (src/evals/adversarialV2Cases.ts, committed before the runner, unchanged), on today's code. No longer held out: the rules were written against this set's misses. The held-out run before the fixes is docs/evals/adversarial-v2.json. Since the fourth round of 19 Nov (an amount above its contract or purchase order is held, one below it is no mismatch; the screen reads a claimed sign-off), on the code with it too: a dated re-run, not held out; the run after the earlier rounds is kept as it was recorded (docs/evals/adversarial-v2-after.json). Offline, test data only.",
    held_out: false, ran_at, commit, dirty, cases_commit: CASES_COMMIT, before: BEFORE, previous_after: PREVIOUS_AFTER, command: "npm run eval:adversarial-v2", line, totals: r.totals, by_category: r.by_category, rows: r.rows,
  }, null, 2)}\n`);
  writeFileSync(resolve(ROOT, DOC), advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v2", cases: ADV_V2_CASES, case_file: "src/evals/adversarialV2Cases.ts", cases_commit: CASES_COMMIT, command: "npm run eval:adversarial-v2",
    before: { result: before, ran_at: before.ran_at, commit: before.commit, record: BEFORE },
    held_out: "**v2 is no longer held out.** Its first run found gaps in Purser's rules; on 19 Nov rules were added against exactly those misses (split invoices, words the screen flags, hidden characters and the payment reference, near-duplicates, legal forms in names). The numbers before the fixes are the held-out measurement; the numbers after them show the fixes work on the cases they were written for, nothing more. The held-out measurement after the fixes is [v3](adversarial-v3.md), 100 new cases committed before they were run; a second round of rules followed against v3's misses, and the after-fix numbers here are on the code with both rounds. The held-out measurement after the second round is [v4](adversarial-v4.md); a third round of rules followed against v4's misses, and the after-fix numbers here are on the code with it too. The case file is unchanged since its commit (`git diff fe5fc388 -- src/evals/adversarialV2Cases.ts` is empty). A fourth round of 19 Nov, against the after-fix runs' last outcomes looser or stricter than their cases and the hostile-model eval's (an amount above its contract or purchase order is held, one below it is no mismatch; the injection screen reads a claimed sign-off, an order to Purser's agents and a German note to machines; test/eval-fourth-round.test.ts), is in the after-fix numbers too; the after-fix run before it is kept as it was recorded: [adversarial-v2-after.json](adversarial-v2-after.json).",
    next: "[v3](adversarial-v3.md), then [v4](adversarial-v4.md)",
  }));
  console.log(`wrote ${RECORD}, ${DOC} (${BEFORE} kept as recorded)`);
}
