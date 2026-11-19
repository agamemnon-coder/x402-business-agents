// npm run eval:adversarial-v2 [-- --check]: the adversarial eval v2 (src/evals/adversarialV2.ts) over the 100 held-out
// cases of src/evals/adversarialV2Cases.ts, committed before this runner. Offline: no model, no network, no key, no
// money. Writes docs/evals/adversarial-v2.json (every row, totals, per category) and docs/evals/adversarial-v2.md.
// --check writes nothing and fails when the committed record's rows or totals no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adversarialV2, advLine, advMarkdown, type AdvResult } from "../evals/adversarialV2.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
const RECORD = "docs/evals/adversarial-v2.json";
const DOC = "docs/evals/adversarial-v2.md";
/** The commit that added the case file alone, before this runner existed. */
const CASES_COMMIT = "fe5fc388";

const r = await adversarialV2();
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
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v2 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v2: 100 held-out invoice cases (src/evals/adversarialV2Cases.ts, committed before the runner), through Purser with a script that always says pay in the model's place (fields as handed over, and fields from Purser's own parser) and a payer with no rules. Scored by plain code against each case's ground truth. Offline, test data only.",
    ran_at, commit, dirty, cases_commit: CASES_COMMIT, command: "npm run eval:adversarial-v2", line, totals: r.totals, by_category: r.by_category, rows: r.rows,
  }, null, 2)}\n`);
  writeFileSync(resolve(ROOT, DOC), advMarkdown(r, { ran_at, commit, dirty, cases_commit: CASES_COMMIT, record: RECORD }));
  console.log(`wrote ${RECORD}, ${DOC}`);
}
