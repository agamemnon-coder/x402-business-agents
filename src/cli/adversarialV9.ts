// npm run eval:adversarial-v9 [-- --check]: the adversarial eval v9 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v8, in v9's world: src/evals/adversarialV9.ts) over the 140 held-out cases of
// src/evals/adversarialV9Cases.ts, written after the fixes that followed eval v8 and after the rule that sends text Purser
// cannot read to the CFO (src/policy/readable.ts), and committed alone before anything ran on them (V9_CASES_COMMIT),
// with the pre-registration in that file's header. Offline: no model, no network, no key, no money. Writes
// docs/evals/adversarial-v9.json (every row, totals, per category, the pre-registered hypotheses as the rows bear them
// out, and the legitimate invoices sent to the CFO because of text Purser cannot read) and docs/evals/adversarial-v9.md.
// The same run also measures v8 on today's code, no longer held out (its first record, docs/evals/adversarial-v8.json, is
// kept as it was), and reports it beside v9, clearly labelled. --check writes nothing and fails when the committed
// record's rows or totals (v9's, and v8's on today's code) no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADV_ARM_WORDS, adversarialV2, advLine, advMarkdown, missTable, type AdvResult } from "../evals/adversarialV2.js";
import { V8_WORLD } from "../evals/adversarialV8.js";
import { ADV_V8_CASES } from "../evals/adversarialV8Cases.js";
import { unreadCost, V9_CASES_COMMIT, V9_WORLD, v9Hypotheses, type V9Hypothesis } from "../evals/adversarialV9.js";
import { ADV_V9_CASES } from "../evals/adversarialV9Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
const RECORD = "docs/evals/adversarial-v9.json";
const DOC = "docs/evals/adversarial-v9.md";
/** v8's held-out record before the fixes, kept as it was. */
const V8_BEFORE = "docs/evals/adversarial-v8.json";
const V8_CASES_COMMIT = "7fabd5262";

const r = await adversarialV2(ADV_V9_CASES, V9_WORLD);
const v8 = await adversarialV2(ADV_V8_CASES, V8_WORLD);
const line = advLine(r.totals);
const v8Line = advLine(v8.totals, "");
const hypotheses = v9Hypotheses(ADV_V9_CASES, r.rows);
const cost = { purser_script: unreadCost(r.rows, "purser_script"), purser_script_parser: unreadCost(r.rows, "purser_script_parser") };
console.log(line);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : x.to_cfo_not_held ? "to the CFO, not held" : x.cfo_not_needed ? "to the CFO, could be paid alone" : "other"} (${x.decided_by})`);
}
for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);
console.log(`  legitimate invoices sent to the CFO for text Purser cannot read: ${cost.purser_script.length} (parser: ${cost.purser_script_parser.length})`);
console.log(`v8 on today's code (not held out any more): ${v8Line}`);

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult & { v8_on_this_code: AdvResult } : null;
  if (!committed || scored(committed) !== scored(r) || scored(committed.v8_on_this_code) !== scored(v8)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v9 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const before8 = JSON.parse(readFileSync(resolve(ROOT, V8_BEFORE), "utf8")) as AdvResult & { ran_at: string; commit: string; line: string };
  // The run's own files, which come in the commit that records it.
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v9: 140 held-out invoice cases (src/evals/adversarialV9Cases.ts, written after the fixes that followed eval v8 and the rule that sends text Purser cannot read to the CFO, committed alone before any run, with its pre-registration), with fifty-four suppliers on file, through Purser with a script that always says pay in the model's place (fields as handed over, and fields from Purser's own parser) and a payer with no rules. Scored by plain code against each case's ground truth. Also v8's 140 cases on the same code, no longer held out (v8_on_this_code). Offline, test data only.",
    held_out: true, ran_at, commit, dirty, cases_commit: V9_CASES_COMMIT, command: "npm run eval:adversarial-v9", line, totals: r.totals, by_category: r.by_category,
    hypotheses,
    sent_to_cfo_unread_where_pay: cost,
    v8_on_this_code: { held_out: false, cases_commit: V8_CASES_COMMIT, before: V8_BEFORE, line: v8Line, totals: v8.totals, by_category: v8.by_category, rows: v8.rows },
    rows: r.rows,
  }, null, 2)}\n`);
  const md = advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v9", cases: ADV_V9_CASES, case_file: "src/evals/adversarialV9Cases.ts", cases_commit: V9_CASES_COMMIT, command: "npm run eval:adversarial-v9",
    on_file: "fifty-four suppliers on file (v8's forty-two, and twelve whose names are in Swahili, Dhivehi, Punjabi, Odia, Tagalog, Basque, Kazakh, Pashto, Welsh, Croatian, Maltese and Estonian)",
    held_out: `**Held out.** Written on 20 Nov after the fixes that followed [v8](adversarial-v8.md) and after the rule that sends a line Purser's word lists cannot read to the CFO instead of paying it alone (src/policy/readable.ts), committed alone (commit ${V9_CASES_COMMIT}) with its pre-registration in the case file's header, before anything ran on them, then run once. This is the measurement of Purser's rules on invoices they were not written for: twelve suppliers named in Swahili, Dhivehi, Punjabi, Odia, Tagalog, Basque, Kazakh, Pashto, Welsh, Croatian, Maltese and Estonian; injections and pressure in those languages and in Chichewa, Papiamento, Bislama, Uyghur, Assamese, Cantonese, Nepali and Hausa; orders and approval claims in English, German and French worded anew; and hard negatives. Every miss is listed below, including invoices sent to the CFO where they had to be held or could have been paid alone; none was fixed before this record, and no rule was changed in the branch that recorded it. The same run measured v8 again on this code: [below](#v8-on-this-code-not-held-out-any-more), labelled as what it is.`,
  });
  writeFileSync(resolve(ROOT, DOC), `${md.trimEnd()}\n\n${hypothesesSection(hypotheses)}\n\n${costSection(cost)}\n\n${v8Section(v8, before8)}\n`);
  console.log(`wrote ${RECORD}, ${DOC}`);
}

/** The pre-registered hypotheses, each held or not, with the cases that break it. */
function hypothesesSection(hs: readonly V9Hypothesis[]): string {
  const said = (x: V9Hypothesis["purser_script"]) => (x.held ? "held" : `**not held**: ${x.broken_by.join(", ")}`);
  return `## The pre-registered hypotheses

Stated in the case file's header before the run (src/evals/adversarialV9Cases.ts), worked out from the rows by plain code (src/evals/adversarialV9.ts v9Hypotheses).

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

/** v8 on this code, beside its held-out record before the fixes: no longer held out, and said so. */
function v8Section(after: AdvResult, before: AdvResult & { ran_at: string; commit: string; line: string }): string {
  const cases = new Map(ADV_V8_CASES.map((k) => [k.id, k]));
  return `## v8 on this code (not held out any more)

**Not held out.** v8's 140 cases (src/evals/adversarialV8Cases.ts, commit ${V8_CASES_COMMIT}, unchanged) were written and run before the fixes that followed them, and those fixes were made after reading v8's misses: these numbers show v8 on the code v9 ran on, nothing more. The held-out measurement is v9, above. v8's first run is kept as recorded ([adversarial-v8.json](adversarial-v8.json), ${before.ran_at.slice(0, 10)}, commit ${before.commit.slice(0, 12)}).

- **v8, held out, before its fixes** (as recorded): ${before.line}
- **v8 on this code** (not held out any more): ${advLine(after.totals, "")}

### Every v8 miss on this code: ${ADV_ARM_WORDS.purser_script}

${missTable(after, "purser_script", cases)}

### Every v8 miss on this code: ${ADV_ARM_WORDS.purser_script_parser}

${missTable(after, "purser_script_parser", cases)}`;
}
