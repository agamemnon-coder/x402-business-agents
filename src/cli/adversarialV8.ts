// npm run eval:adversarial-v8 [-- --check]: the adversarial eval v8 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v7, in v8's world: src/evals/adversarialV8.ts) over the 140 held-out cases of
// src/evals/adversarialV8Cases.ts, written after the fixes that followed eval v7 (typography read as letters, amounts above
// the total in any language, a person as holder in any script, romanisations and leading legal forms, a customer's number,
// other scripts' digits in accounts, and the words in Georgian, Armenian, Bengali, Tamil, Amharic, Urdu and Khmer) and
// committed alone before anything ran on them (7fabd5262), with the pre-registration in that file's header. Offline: no
// model, no network, no key, no money. Writes docs/evals/adversarial-v8.json (every row, totals, per category, the
// pre-registered hypotheses as the rows bear them out) and docs/evals/adversarial-v8.md. The same run also measures v7 on
// the fixed code, no longer held out (its first record, docs/evals/adversarial-v7.json, is kept as it was), and reports
// it beside v8, clearly labelled. --check writes nothing and fails when the committed record's rows or totals (v8's, and
// v7's after the fixes) no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADV_ARM_WORDS, ADV_ARMS, adversarialV2, advLine, advMarkdown, CATEGORY_WORDS, missTable, type AdvResult, type AdvRow, type AdvTotals } from "../evals/adversarialV2.js";
import { ADV_V2_CATEGORIES } from "../evals/adversarialV2Cases.js";
import { V7_WORLD } from "../evals/adversarialV7.js";
import { ADV_V7_CASES } from "../evals/adversarialV7Cases.js";
import { V8_WORLD, v8Hypotheses, type V8Hypothesis } from "../evals/adversarialV8.js";
import { ADV_V8_CASES } from "../evals/adversarialV8Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
const RECORD = "docs/evals/adversarial-v8.json";
const DOC = "docs/evals/adversarial-v8.md";
/** v7's held-out record before the fixes, kept as it was; and its run on the fixed code (npm run eval:adversarial-v7). */
const V7_BEFORE = "docs/evals/adversarial-v7.json";
/** The commit that added the case file alone, before anything ran on it. */
export const V8_CASES_COMMIT = "7fabd5262";
const V7_CASES_COMMIT = "34f502070";

const r = await adversarialV2(ADV_V8_CASES, V8_WORLD);
const v7 = await adversarialV2(ADV_V7_CASES, V7_WORLD);
const line = advLine(r.totals);
const v7Line = advLine(v7.totals, "");
const hypotheses = v8Hypotheses(ADV_V8_CASES, r.rows);
console.log(line);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}
for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);
console.log(`v7 after the fixes (not held out any more): ${v7Line}`);

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult & { v7_after_fixes: AdvResult } : null;
  if (!committed || scored(committed) !== scored(r) || scored(committed.v7_after_fixes) !== scored(v7)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v8 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const before7 = JSON.parse(readFileSync(resolve(ROOT, V7_BEFORE), "utf8")) as AdvResult & { ran_at: string; commit: string; line: string };
  // The run's own files, which come in the commit that records it.
  const { commit, dirty } = evalCommit([RECORD, DOC]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v8: 140 held-out invoice cases (src/evals/adversarialV8Cases.ts, written after the fixes that followed eval v7 and committed alone before any run, with its pre-registration), with forty-two suppliers on file, through Purser with a script that always says pay in the model's place (fields as handed over, and fields from Purser's own parser) and a payer with no rules. Scored by plain code against each case's ground truth. Also v7's 117 cases on the same code, no longer held out (v7_after_fixes). Offline, test data only.",
    held_out: true, ran_at, commit, dirty, cases_commit: V8_CASES_COMMIT, command: "npm run eval:adversarial-v8", line, totals: r.totals, by_category: r.by_category,
    hypotheses,
    v7_after_fixes: { held_out: false, cases_commit: V7_CASES_COMMIT, before: V7_BEFORE, line: v7Line, totals: v7.totals, by_category: v7.by_category, rows: v7.rows },
    rows: r.rows,
  }, null, 2)}\n`);
  const md = advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v8", cases: ADV_V8_CASES, case_file: "src/evals/adversarialV8Cases.ts", cases_commit: V8_CASES_COMMIT, command: "npm run eval:adversarial-v8",
    on_file: "forty-two suppliers on file (v7's thirty, and twelve whose names are in Sinhala, Lao, Mongolian Cyrillic, Burmese, Gujarati, Malayalam, Telugu, Yiddish, Lithuanian, Icelandic, Latvian and Kannada)",
    held_out: `**Held out.** Written on 19 Nov after the fixes that followed [v7](adversarial-v7.md) (characters that only set a text read as letters or hidden characters, an amount above the total in words the lists did not know, a person's name as holder at a company named in a script without a listed form, romanisations and legal forms before a name, a customer's number, other scripts' digits in accounts, and the words in Georgian, Armenian, Bengali, Tamil, Amharic, Urdu and Khmer), committed alone (commit ${V8_CASES_COMMIT}) with its pre-registration in the case file's header, before anything ran on them, then run once. This is the measurement of Purser's rules after those fixes on invoices they were not written for: twelve suppliers named in Sinhala, Lao, Mongolian Cyrillic, Burmese, Gujarati, Malayalam, Telugu, Yiddish, Lithuanian, Icelandic, Latvian and Kannada; injections and pressure in those languages and in Tibetan, Syriac, Inuktitut syllabics, Javanese and decomposed Vietnamese, most of them in languages whose words the lists do not hold (hypothesis H3 was stated expecting it not to hold); Cherokee letters and a dotless ı as lookalikes; totals in Myanmar, Malayalam, Telugu, Kannada and Mongolian digits; and hard negatives against the new rules. Every miss is listed below; none was fixed before this record, and no rule was changed in the branch that recorded it. The same run measured v7 again on the fixed code: [below](#v7-after-the-fixes-not-held-out-any-more), labelled as what it is.`,
  });
  writeFileSync(resolve(ROOT, DOC), `${md.trimEnd()}\n\n${hypothesesSection(hypotheses)}\n\n${v7Section(v7, before7)}\n`);
  console.log(`wrote ${RECORD}, ${DOC}`);
}

/** The pre-registered hypotheses, each held or not, with the cases that break it. */
function hypothesesSection(hs: readonly V8Hypothesis[]): string {
  const said = (x: V8Hypothesis["purser_script"]) => (x.held ? "held" : `**not held**: ${x.broken_by.join(", ")}`);
  return `## The pre-registered hypotheses

Stated in the case file's header before the run (src/evals/adversarialV8Cases.ts), worked out from the rows by plain code (src/evals/adversarialV8.ts v8Hypotheses).

| | Hypothesis | Cases | ${ADV_ARM_WORDS.purser_script} | ${ADV_ARM_WORDS.purser_script_parser} |
|---|---|---|---|---|
${hs.map((h) => `| ${h.id} | ${h.says} | ${h.cases.length} | ${said(h.purser_script)} | ${said(h.purser_script_parser)} |`).join("\n")}`;
}

/** v7 on the fixed code, beside its held-out record before the fixes: no longer held out, and said so. */
function v7Section(after: AdvResult, before: AdvResult & { ran_at: string; commit: string; line: string }): string {
  const arms = ["purser_script", "purser_script_parser"] as const;
  const row = (label: string, f: (x: AdvTotals) => string | number) => `| ${label} | ${arms.map((a) => `${f(before.totals[a])} | ${f(after.totals[a])}`).join(" | ")} | ${f(after.totals.no_rules)} |`;
  const cats = ADV_V2_CATEGORIES.filter((c) => after.by_category[c]?.no_rules.cases).map((c) => {
    const x = after.by_category[c], y = before.by_category[c];
    return `| ${CATEGORY_WORDS[c]} | ${x.no_rules.cases} | ${y.purser_script.wrong_payments} | ${x.purser_script.wrong_payments} | ${y.purser_script.false_holds} | ${x.purser_script.false_holds} | ${y.purser_script.right} | ${x.purser_script.right} |`;
  }).join("\n");
  const was = (id: string, a: (typeof ADV_ARMS)[number]) => before.rows.find((x) => x.case === id && x.arm === a);
  const mark = (x: AdvRow | undefined) => (!x ? "" : `${x.outcome}${x.right ? "" : x.wrong_payment ? " (WRONG)" : x.false_hold ? " (false hold)" : " (miss)"}`);
  const changed = after.rows.filter((x) => x.arm === "purser_script" && mark(was(x.case, "purser_script")) !== mark(x));
  const cases = new Map(ADV_V7_CASES.map((k) => [k.id, k]));
  return `## v7 after the fixes (not held out any more)

**Not held out.** v7's 117 cases (src/evals/adversarialV7Cases.ts, commit ${V7_CASES_COMMIT}, unchanged) were written and run before the fixes, and the fixes were made after reading v7's misses: these numbers show what the fixes did on the cases that prompted them, nothing more. The held-out measurement after the fixes is v8, above. v7's first run is kept as recorded ([adversarial-v7.json](adversarial-v7.json), ${before.ran_at.slice(0, 10)}, commit ${before.commit.slice(0, 12)}); this run is in [adversarial-v8.json](adversarial-v8.json) (v7_after_fixes) and, from \`npm run eval:adversarial-v7\`, [adversarial-v7-after.json](adversarial-v7-after.json).

- **v7 before the fixes** (held out, as recorded): ${before.line}
- **v7 after the fixes** (not held out any more): ${advLine(after.totals, "")}

| | ${ADV_ARM_WORDS.purser_script}, before | after | ${ADV_ARM_WORDS.purser_script_parser}, before | after | ${ADV_ARM_WORDS.no_rules} |
|---|---|---|---|---|---|
${row("Paid alone", (x) => x.paid)}
${row("Right (matches the truth)", (x) => x.right)}
${row("**Wrong payments** (paid alone, truth not pay)", (x) => `**${x.wrong_payments}**`)}
${row("of which had to be held", (x) => x.wrong_must_hold)}
${row("of which paid past the CFO", (x) => x.wrong_past_cfo)}
${row("**False holds** (held, truth pay or ask_cfo)", (x) => `**${x.false_holds}** of ${x.clean_truths}`)}
${row("Sent to the CFO where it had to be held", (x) => x.to_cfo_not_held)}

| Category | Cases | Wrong payments: Purser, before | after | False holds: Purser, before | after | Right: Purser, before | after |
|---|---|---|---|---|---|---|---|
${cats}

### v7 cases whose outcome changed (${ADV_ARM_WORDS.purser_script})

${changed.length ? `| Case | Category | Truth | Before the fixes | After | Decided by, after |\n|---|---|---|---|---|---|\n${changed.map((x) => `| ${x.case} | ${x.category} | ${x.truth} | ${mark(was(x.case, "purser_script"))} | ${mark(x)} | ${x.decided_by} |`).join("\n")}` : "None."}

### Every v7 miss after the fixes: ${ADV_ARM_WORDS.purser_script}

${missTable(after, "purser_script", cases)}

### Every v7 miss after the fixes: ${ADV_ARM_WORDS.purser_script_parser}

${missTable(after, "purser_script_parser", cases)}`;
}
