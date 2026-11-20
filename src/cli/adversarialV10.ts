// npm run eval:adversarial-v10 [-- --check]: the adversarial eval v10 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v9, in v10's world: src/evals/adversarialV10.ts) over the 129 held-out cases of
// src/evals/adversarialV10Cases.ts, written after the fixes that followed eval v9 and committed alone before anything ran
// on them (V10_CASES_COMMIT), with the pre-registration in that file's header. Offline: no model, no network, no key, no
// money. Writes docs/evals/adversarial-v10.json (every row, totals, per category, the pre-registered hypotheses as the
// rows bear them out, and the legitimate invoices sent to the CFO because of text Purser cannot read) and
// docs/evals/adversarial-v10.md. The same run also measures v9 on today's code, no longer held out (its first record,
// docs/evals/adversarial-v9.json, is kept as it was), and reports it beside v10, clearly labelled. --check writes nothing
// and fails when the committed record's rows or totals (v10's, and v9's on today's code) no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADV_ARM_WORDS, adversarialV2, advLine, advMarkdown, missTable, type AdvResult } from "../evals/adversarialV2.js";
import { unreadCost, V9_CASES_COMMIT, V9_WORLD } from "../evals/adversarialV9.js";
import { ADV_V9_CASES } from "../evals/adversarialV9Cases.js";
import { V10_CASES_COMMIT, V10_WORLD, v10Hypotheses, type V10Hypothesis } from "../evals/adversarialV10.js";
import { ADV_V10_CASES } from "../evals/adversarialV10Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
const RECORD = "docs/evals/adversarial-v10.json";
const DOC = "docs/evals/adversarial-v10.md";
/** v9's held-out record before the fixes, kept as it was. */
const V9_BEFORE = "docs/evals/adversarial-v9.json";

const r = await adversarialV2(ADV_V10_CASES, V10_WORLD);
const v9 = await adversarialV2(ADV_V9_CASES, V9_WORLD);
const line = advLine(r.totals);
const v9Line = advLine(v9.totals, "");
const hypotheses = v10Hypotheses(ADV_V10_CASES, r.rows);
const cost = { purser_script: unreadCost(r.rows, "purser_script"), purser_script_parser: unreadCost(r.rows, "purser_script_parser") };
console.log(line);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : x.to_cfo_not_held ? "to the CFO, not held" : x.cfo_not_needed ? "to the CFO, could be paid alone" : "other"} (${x.decided_by})`);
}
for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);
console.log(`  legitimate invoices sent to the CFO for text Purser cannot read: ${cost.purser_script.length} (parser: ${cost.purser_script_parser.length})`);
console.log(`v9 on today's code (not held out any more): ${v9Line}`);

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult & { v9_on_this_code: AdvResult } : null;
  if (!committed || scored(committed) !== scored(r) || scored(committed.v9_on_this_code) !== scored(v9)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v10 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const before9 = JSON.parse(readFileSync(resolve(ROOT, V9_BEFORE), "utf8")) as AdvResult & { ran_at: string; commit: string; line: string };
  // The run's own files, which come in the commit that records it.
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v10: 129 held-out invoice cases (src/evals/adversarialV10Cases.ts, written after the fixes that followed eval v9, committed alone before any run, with its pre-registration), with sixty-six suppliers on file, through Purser with a script that always says pay in the model's place (fields as handed over, and fields from Purser's own parser) and a payer with no rules. Scored by plain code against each case's ground truth. Also v9's 140 cases on the same code, no longer held out (v9_on_this_code). Offline, test data only.",
    held_out: true, ran_at, commit, dirty, cases_commit: V10_CASES_COMMIT, command: "npm run eval:adversarial-v10", line, totals: r.totals, by_category: r.by_category,
    hypotheses,
    sent_to_cfo_unread_where_pay: cost,
    v9_on_this_code: { held_out: false, cases_commit: V9_CASES_COMMIT, before: V9_BEFORE, line: v9Line, totals: v9.totals, by_category: v9.by_category, rows: v9.rows },
    rows: r.rows,
  }, null, 2)}\n`);
  const md = advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v10", cases: ADV_V10_CASES, case_file: "src/evals/adversarialV10Cases.ts", cases_commit: V10_CASES_COMMIT, command: "npm run eval:adversarial-v10",
    on_file: "sixty-six suppliers on file (v9's fifty-four, and twelve whose names are in Yoruba, Hausa, Somali, Tigrinya, Uyghur, Sorani Kurdish, Nepali, Marathi, Tamazight, Albanian, Afrikaans and Luxembourgish)",
    held_out: `**Held out.** Written on 20 Nov after the fixes that followed [v9](adversarial-v9.md), committed alone (commit ${V10_CASES_COMMIT}) with its pre-registration in the case file's header, before anything ran on them, then run once. This is the measurement of Purser's rules on invoices they were not written for: twelve suppliers named in Yoruba, Hausa, Somali, Tigrinya, Uyghur, Sorani Kurdish, Nepali, Marathi, Tamazight, Albanian, Afrikaans and Luxembourgish; injections and pressure in those languages and in Kapampangan, Scots, Asturian, Low German, Greenlandic and Ladino; approval claims and pressure in English, Spanish, Italian, Dutch and German worded anew; and hard negatives. Every miss is listed below, including invoices sent to the CFO where they had to be held or could have been paid alone; none was fixed before this record, and no rule was changed in the branch that recorded it. The same run measured v9 again on this code: [below](#v9-on-this-code-not-held-out-any-more), labelled as what it is.`,
  });
  writeFileSync(resolve(ROOT, DOC), `${md.trimEnd()}\n\n${hypothesesSection(hypotheses)}\n\n${costSection(cost)}\n\n${v9Section(v9, before9)}\n`);
  console.log(`wrote ${RECORD}, ${DOC}`);
}

/** The pre-registered hypotheses, each held or not, with the cases that break it. */
function hypothesesSection(hs: readonly V10Hypothesis[]): string {
  const said = (x: V10Hypothesis["purser_script"]) => (x.held ? "held" : `**not held**: ${x.broken_by.join(", ")}`);
  return `## The pre-registered hypotheses

Stated in the case file's header before the run (src/evals/adversarialV10Cases.ts), worked out from the rows by plain code (src/evals/adversarialV10.ts v10Hypotheses).

| | Hypothesis | Cases | ${ADV_ARM_WORDS.purser_script} | ${ADV_ARM_WORDS.purser_script_parser} |
|---|---|---|---|---|
${hs.map((h) => `| ${h.id} | ${h.says} | ${h.cases.length} | ${said(h.purser_script)} | ${said(h.purser_script_parser)} |`).join("\n")}`;
}

/** What the rule that sends unread text to the CFO cost: legitimate invoices that could have been paid alone. */
function costSection(c: { purser_script: string[]; purser_script_parser: string[] }): string {
  const list = (ids: string[]) => (ids.length ? ids.join(", ") : "none");
  return `## The cost of sending unread text to the CFO

Legitimate invoices (truth pay) that Purser sent to the CFO because their text has a line in a language its checks cannot read (finding text_not_read). Nothing was paid wrongly and nothing was held: the CFO signs what the agent could have paid alone.

- ${ADV_ARM_WORDS.purser_script}: ${c.purser_script.length} (${list(c.purser_script)})
- ${ADV_ARM_WORDS.purser_script_parser}: ${c.purser_script_parser.length} (${list(c.purser_script_parser)})`;
}

/** v9 on this code, beside its held-out record before the fixes: no longer held out, and said so. */
function v9Section(after: AdvResult, before: AdvResult & { ran_at: string; commit: string; line: string }): string {
  const cases = new Map(ADV_V9_CASES.map((k) => [k.id, k]));
  return `## v9 on this code (not held out any more)

**Not held out.** v9's 140 cases (src/evals/adversarialV9Cases.ts, commit ${V9_CASES_COMMIT}, unchanged) were written and run before the fixes that followed them, and those fixes were made after reading v9's misses: these numbers show v9 on the code v10 ran on, nothing more. The held-out measurement is v10, above. v9's first run is kept as recorded ([adversarial-v9.json](adversarial-v9.json), ${before.ran_at.slice(0, 10)}, commit ${before.commit.slice(0, 12)}).

- **v9, held out, before its fixes** (as recorded): ${before.line}
- **v9 on this code** (not held out any more): ${advLine(after.totals, "")}

### Every v9 miss on this code: ${ADV_ARM_WORDS.purser_script}

${missTable(after, "purser_script", cases)}

### Every v9 miss on this code: ${ADV_ARM_WORDS.purser_script_parser}

${missTable(after, "purser_script_parser", cases)}`;
}
