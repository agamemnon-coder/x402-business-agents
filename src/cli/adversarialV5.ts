// npm run eval:adversarial-v5 [-- --check]: the adversarial eval v5 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2, v3 and v4, in v5's world: src/evals/adversarialV5.ts) over the 100 held-out cases of
// src/evals/adversarialV5Cases.ts, written after the third round of fixes (against v4's misses) and committed alone
// before anything ran on them (commit 9e8d59c1), with the pre-registration in that file's header. Offline: no model, no
// network, no key, no money. Writes docs/evals/adversarial-v5.json (every row, totals, per category) and
// docs/evals/adversarial-v5.md. --check writes nothing and fails when the committed record's rows or totals no longer
// match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, advMarkdown, type AdvResult } from "../evals/adversarialV2.js";
import { V5_WORLD } from "../evals/adversarialV5.js";
import { ADV_V5_CASES } from "../evals/adversarialV5Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
const RECORD = "docs/evals/adversarial-v5.json";
const DOC = "docs/evals/adversarial-v5.md";
/** The commit that added the case file alone, before anything ran on it. */
export const V5_CASES_COMMIT = "9e8d59c1";

const r = await adversarialV2(ADV_V5_CASES, V5_WORLD);
const line = advLine(r.totals);
console.log(line);
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
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v5: 100 held-out invoice cases (src/evals/adversarialV5Cases.ts, written after the third round of fixes against v4's misses and committed alone before any run, with its pre-registration), with thirteen suppliers on file, through Purser with a script that always says pay in the model's place (fields as handed over, and fields from Purser's own parser) and a payer with no rules. Scored by plain code against each case's ground truth. Offline, test data only.",
    held_out: true, ran_at, commit, dirty, cases_commit: V5_CASES_COMMIT, command: "npm run eval:adversarial-v5", line, totals: r.totals, by_category: r.by_category, rows: r.rows,
  }, null, 2)}\n`);
  writeFileSync(resolve(ROOT, DOC), advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v5", cases: ADV_V5_CASES, case_file: "src/evals/adversarialV5Cases.ts", cases_commit: V5_CASES_COMMIT, command: "npm run eval:adversarial-v5",
    on_file: "thirteen suppliers on file (v4's eleven, and a Greek and a Bulgarian one whose names are in Greek and Cyrillic letters)",
    held_out: `**Held out.** Written on 19 Nov after the third round of fixes, made against [v4](adversarial-v4.md)'s misses, committed alone (commit ${V5_CASES_COMMIT}) with its pre-registration in the case file's header, before anything ran on them, then run once. This is the measurement of Purser's rules after that round on invoices they were not written for: Dutch, German, French, Spanish, Greek and Bulgarian around the numbers, injections in Chinese, Japanese, Arabic, Greek and Bulgarian, new tricks (an EPC QR payload, a stablecoin wallet, a garnishment, a direct debit that also collects, a paid proforma, a statement of account, leetspeak, mathematical letters, URL-encoding, a forged tool call, a fake verification stamp) and hard negatives. Every miss is listed below; none was fixed before this record, and no rule was changed in the branch that recorded it.`,
  }));
  console.log(`wrote ${RECORD}, ${DOC}`);
}
