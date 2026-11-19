// npm run eval:adversarial-v6 [-- --check]: the adversarial eval v6 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v5, in v6's world: src/evals/adversarialV6.ts) over the 108 held-out cases of
// src/evals/adversarialV6Cases.ts, written after the fixes that followed eval v5 (non-Latin supplier names, orders in other
// languages and scripts) and committed alone before anything ran on them, with the pre-registration in that file's
// header. Offline: no model, no network, no key, no money. Writes docs/evals/adversarial-v6.json (every row, totals, per
// category, the pre-registered hypotheses as the rows bear them out) and docs/evals/adversarial-v6.md. The same run also
// measures v5 on the fixed code, no longer held out (its first record, docs/evals/adversarial-v5.json, is kept as it
// was), and reports it beside v6, clearly labelled. --check writes nothing and fails when the committed record's rows or
// totals (v6's, and v5's after the fixes) no longer match this run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADV_ARM_WORDS, ADV_ARMS, adversarialV2, advLine, advMarkdown, CATEGORY_WORDS, missTable, type AdvResult, type AdvRow, type AdvTotals } from "../evals/adversarialV2.js";
import { ADV_V2_CATEGORIES } from "../evals/adversarialV2Cases.js";
import { V5_WORLD } from "../evals/adversarialV5.js";
import { ADV_V5_CASES } from "../evals/adversarialV5Cases.js";
import { V6_WORLD, v6Hypotheses, type V6Hypothesis } from "../evals/adversarialV6.js";
import { ADV_V6_CASES } from "../evals/adversarialV6Cases.js";
import { evalCommit } from "../evals/commit.js";

const ROOT = resolve(import.meta.dirname, "../..");
const RECORD = "docs/evals/adversarial-v6.json";
const DOC = "docs/evals/adversarial-v6.md";
/** v5's held-out record before the fixes, kept as it was; and its run on the fixed code (npm run eval:adversarial-v5). */
const V5_BEFORE = "docs/evals/adversarial-v5.json";
const V5_AFTER = "docs/evals/adversarial-v5-after.json";
/** The commit that added the case file alone, before anything ran on it. */
export const V6_CASES_COMMIT = "a7d9dfa06";
const V5_CASES_COMMIT = "9e8d59c1";

const r = await adversarialV2(ADV_V6_CASES, V6_WORLD);
const v5 = await adversarialV2(ADV_V5_CASES, V5_WORLD);
const line = advLine(r.totals);
const v5Line = advLine(v5.totals, "");
const hypotheses = v6Hypotheses(ADV_V6_CASES, r.rows);
console.log(line);
for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
  console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(44)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : "looser/other"} (${x.decided_by})`);
}
for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);
console.log(`v5 after the fixes (not held out any more): ${v5Line}`);

const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
if (process.argv.includes("--check")) {
  const file = resolve(ROOT, RECORD);
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult & { v5_after_fixes: AdvResult } : null;
  if (!committed || scored(committed) !== scored(r) || scored(committed.v5_after_fixes) !== scored(v5)) {
    console.error(`${RECORD} no longer matches this run: run npm run eval:adversarial-v6 and commit it`);
    process.exitCode = 1;
  } else console.log(`${RECORD} matches this run`);
} else {
  const before5 = JSON.parse(readFileSync(resolve(ROOT, V5_BEFORE), "utf8")) as AdvResult & { ran_at: string; commit: string; line: string };
  // The run's own files, and v5's after-fix record and report note, which come in the same commit as this record.
  const { commit, dirty } = evalCommit([RECORD, DOC, V5_AFTER, "docs/evals/adversarial-v5.md"]);
  const ran_at = new Date().toISOString();
  writeFileSync(resolve(ROOT, RECORD), `${JSON.stringify({
    what: "Adversarial eval v6: 108 held-out invoice cases (src/evals/adversarialV6Cases.ts, written after the fixes that followed eval v5 and committed alone before any run, with its pre-registration), with twenty-one suppliers on file, through Purser with a script that always says pay in the model's place (fields as handed over, and fields from Purser's own parser) and a payer with no rules. Scored by plain code against each case's ground truth. Also v5's 100 cases on the same code, no longer held out (v5_after_fixes). Offline, test data only.",
    held_out: true, ran_at, commit, dirty, cases_commit: V6_CASES_COMMIT, command: "npm run eval:adversarial-v6", line, totals: r.totals, by_category: r.by_category,
    hypotheses,
    v5_after_fixes: { held_out: false, cases_commit: V5_CASES_COMMIT, before: V5_BEFORE, line: v5Line, totals: v5.totals, by_category: v5.by_category, rows: v5.rows },
    rows: r.rows,
  }, null, 2)}\n`);
  const md = advMarkdown(r, { ran_at, commit, dirty, record: RECORD }, {
    version: "v6", cases: ADV_V6_CASES, case_file: "src/evals/adversarialV6Cases.ts", cases_commit: V6_CASES_COMMIT, command: "npm run eval:adversarial-v6",
    on_file: "twenty-one suppliers on file (v5's thirteen, and eight whose names are in Turkish, Chinese, Hebrew, Devanagari, Korean, Thai, Vietnamese and Japanese letters)",
    held_out: `**Held out.** Written on 19 Nov after the fixes that followed [v5](adversarial-v5.md) (non-Latin supplier names held as fraud; orders in Chinese, Japanese and Arabic paid), committed alone (commit ${V6_CASES_COMMIT}) with its pre-registration in the case file's header, before anything ran on them, then run once. This is the measurement of Purser's rules after those fixes on invoices they were not written for: eight suppliers named in Hebrew, Thai, Devanagari, Hangul, Han with kana, Han, Turkish and Vietnamese letters; injections in Hebrew, Thai, Hindi, Korean, Turkish, Vietnamese, Persian and Japanese; direction overrides, zero-width joiners, full-width and Arabic-Indic digits, Armenian and Cherokee letters inside Latin names; holder lines as banks romanise them; and hard negatives. Every miss is listed below; none was fixed before this record, and no rule was changed in the branch that recorded it. The same run measured v5 again on the fixed code: [below](#v5-after-the-fixes-not-held-out-any-more), labelled as what it is.`,
  });
  writeFileSync(resolve(ROOT, DOC), `${md.trimEnd()}\n\n${hypothesesSection(hypotheses)}\n\n${v5Section(v5, before5)}\n`);
  console.log(`wrote ${RECORD}, ${DOC}`);
}

/** The pre-registered hypotheses, each held or not, with the cases that break it. */
function hypothesesSection(hs: readonly V6Hypothesis[]): string {
  const said = (x: V6Hypothesis["purser_script"]) => (x.held ? "held" : `**not held**: ${x.broken_by.join(", ")}`);
  return `## The pre-registered hypotheses

Stated in the case file's header before the run (src/evals/adversarialV6Cases.ts), worked out from the rows by plain code (src/evals/adversarialV6.ts v6Hypotheses).

| | Hypothesis | Cases | ${ADV_ARM_WORDS.purser_script} | ${ADV_ARM_WORDS.purser_script_parser} |
|---|---|---|---|---|
${hs.map((h) => `| ${h.id} | ${h.says} | ${h.cases.length} | ${said(h.purser_script)} | ${said(h.purser_script_parser)} |`).join("\n")}`;
}

/** v5 on the fixed code, beside its held-out record before the fixes: no longer held out, and said so. */
function v5Section(after: AdvResult, before: AdvResult & { ran_at: string; commit: string; line: string }): string {
  const arms = ["purser_script", "purser_script_parser"] as const;
  const row = (label: string, f: (x: AdvTotals) => string | number) => `| ${label} | ${arms.map((a) => `${f(before.totals[a])} | ${f(after.totals[a])}`).join(" | ")} | ${f(after.totals.no_rules)} |`;
  const cats = ADV_V2_CATEGORIES.filter((c) => after.by_category[c]?.no_rules.cases).map((c) => {
    const x = after.by_category[c], y = before.by_category[c];
    return `| ${CATEGORY_WORDS[c]} | ${x.no_rules.cases} | ${y.purser_script.wrong_payments} | ${x.purser_script.wrong_payments} | ${y.purser_script.false_holds} | ${x.purser_script.false_holds} | ${y.purser_script.right} | ${x.purser_script.right} |`;
  }).join("\n");
  const was = (id: string, a: (typeof ADV_ARMS)[number]) => before.rows.find((x) => x.case === id && x.arm === a);
  const mark = (x: AdvRow | undefined) => (!x ? "" : `${x.outcome}${x.right ? "" : x.wrong_payment ? " (WRONG)" : x.false_hold ? " (false hold)" : " (miss)"}`);
  const changed = after.rows.filter((x) => x.arm === "purser_script" && mark(was(x.case, "purser_script")) !== mark(x));
  const cases = new Map(ADV_V5_CASES.map((k) => [k.id, k]));
  return `## v5 after the fixes (not held out any more)

**Not held out.** v5's 100 cases (src/evals/adversarialV5Cases.ts, commit ${V5_CASES_COMMIT}, unchanged) were written and run before the fixes, and the fixes were made after reading v5's misses: these numbers show what the fixes did on the cases that prompted them, nothing more. The held-out measurement after the fixes is v6, above. v5's first run is kept as recorded ([adversarial-v5.json](adversarial-v5.json), ${before.ran_at.slice(0, 10)}, commit ${before.commit.slice(0, 12)}); this run is in [adversarial-v6.json](adversarial-v6.json) (v5_after_fixes) and, from \`npm run eval:adversarial-v5\`, [adversarial-v5-after.json](adversarial-v5-after.json).

- **v5 before the fixes** (held out, as recorded): ${before.line}
- **v5 after the fixes** (not held out any more): ${advLine(after.totals, "")}

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

### v5 cases whose outcome changed (${ADV_ARM_WORDS.purser_script})

${changed.length ? `| Case | Category | Truth | Before the fixes | After | Decided by, after |\n|---|---|---|---|---|---|\n${changed.map((x) => `| ${x.case} | ${x.category} | ${x.truth} | ${mark(was(x.case, "purser_script"))} | ${mark(x)} | ${x.decided_by} |`).join("\n")}` : "None."}

### Every v5 miss after the fixes: ${ADV_ARM_WORDS.purser_script}

${missTable(after, "purser_script", cases)}

### Every v5 miss after the fixes: ${ADV_ARM_WORDS.purser_script_parser}

${missTable(after, "purser_script_parser", cases)}`;
}
