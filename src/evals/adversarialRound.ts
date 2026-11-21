// One round of the held-out adversarial evals from v11 on (20 Nov): the same runner and scorer as v2 to v10
// (src/evals/adversarialV2.ts), and the same method as v9 and v10 (src/cli/adversarialV10.ts): a fresh case set,
// committed alone with its pre-registration before any run; one run on the code of the commit that adds its runner,
// recorded as it is (docs/evals/adversarial-vN.json and .md, held out); then, if the rules are fixed after reading its
// misses, a run on the fixed code recorded apart and labelled not held out (docs/evals/adversarial-vN-after.json), the
// held-out record never written again. What every round shares is here: the pre-registered hypotheses worked out from
// the rows, the cost of sending text Purser cannot read to the CFO, the report's extra sections and the command itself.
// Offline: no model, no network, no key, no money.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADV_ARM_WORDS, adversarialV2, advLine, advMarkdown, missTable, type AdvResult, type AdvWorldAdapter, type AnyAdvCase } from "./adversarialV2.js";
import { evalCommit } from "./commit.js";

/** What breaks a hypothesis on a row: a wrong payment, a false hold, or anything not held (pay or ask_cfo). */
export type Breaks = "wrong_payment" | "false_hold" | "not_held";
/** A hypothesis of a round's pre-registration, as stated before the run: the cases it is about and what breaks it. */
export interface HypothesisDef { id: string; says: string; ids: readonly string[]; breaks: Breaks }
/** A hypothesis as the run bears it out, per Purser arm. */
export interface RoundHypothesis {
  id: string;
  says: string;
  cases: string[];
  purser_script: { held: boolean; broken_by: string[] };
  purser_script_parser: { held: boolean; broken_by: string[] };
}
type Row = { arm: string; case: string; truth: string; outcome: string; wrong_payment: boolean; false_hold: boolean; decided_by: string };

/** The pre-registered hypotheses, worked out from the rows of a run (as plain code, no judgement). */
export function roundHypotheses(defs: readonly HypothesisDef[], rows: readonly Row[]): RoundHypothesis[] {
  const broken = (b: Breaks, x: Row) => (b === "wrong_payment" ? x.wrong_payment : b === "false_hold" ? x.false_hold : x.outcome !== "hold" && x.outcome !== "reject");
  return defs.map((h) => {
    const arm = (a: "purser_script" | "purser_script_parser") => {
      const broken_by = h.ids.filter((id) => { const x = rows.find((y) => y.arm === a && y.case === id); return !!x && broken(h.breaks, x); });
      return { held: broken_by.length === 0, broken_by };
    };
    return { id: h.id, says: h.says, cases: [...h.ids], purser_script: arm("purser_script"), purser_script_parser: arm("purser_script_parser") };
  });
}

/** The legitimate cases (truth pay) that code sent to the CFO because of text it cannot read: the cost of that rule. */
export function unreadCost(rows: readonly Row[], arm: "purser_script" | "purser_script_parser"): string[] {
  return rows.filter((x) => x.arm === arm && x.truth === "pay" && x.outcome === "ask_cfo" && x.decided_by === "text_not_read").map((x) => x.case);
}

/** The legitimate cases (truth pay) that code sent to the CFO for any reason: a signature more than needed. */
export function cfoNotNeeded(rows: readonly Row[], arm: "purser_script" | "purser_script_parser"): { case: string; by: string }[] {
  return rows.filter((x) => x.arm === arm && x.truth === "pay" && x.outcome === "ask_cfo").map((x) => ({ case: x.case, by: x.decided_by }));
}

/** A round as its command runs it: the set, its world, its pre-registration and the round before it. */
export interface Round {
  /** "v11". */
  version: string;
  cases: readonly AnyAdvCase[];
  world: AdvWorldAdapter;
  case_file: string;
  /** The commit that added the case file alone, before anything ran on it. */
  cases_commit: string;
  hypotheses: readonly HypothesisDef[];
  /** The suppliers on file, in words, for the report. */
  on_file: string;
  /** What the set is, for the held-out report's first paragraph (after "This is the measurement of Purser's rules on invoices they were not written for: "). */
  about: string;
  /** The day the cases were written, for the held-out report ("21 Nov"); default "20 Nov", the day of v11 to v14. */
  written?: string;
  /** What the fixes after this round's first run were, once there are any: the after-fix record says so. */
  fixes?: string;
  /** The round before, measured again on the same code and labelled not held out. */
  previous: { version: string; cases: readonly AnyAdvCase[]; world: AdvWorldAdapter; cases_commit: string };
}

const ROOT = resolve(import.meta.dirname, "../..");
const scored = (x: Pick<AdvResult, "rows" | "totals" | "by_category">) => JSON.stringify({ rows: x.rows, totals: x.totals, by_category: x.by_category });
const said = (x: RoundHypothesis["purser_script"]) => (x.held ? "held" : `**not held**: ${x.broken_by.join(", ")}`);

/**
 * npm run eval:adversarial-vN [-- --check]. With no held-out record yet, the first run: writes the held-out record
 * (docs/evals/adversarial-vN.json, held_out: true, with the round before measured on the same code beside it) and its
 * report. Once that record is committed, it is never written again: the command then writes the run on today's code
 * beside it (docs/evals/adversarial-vN-after.json, held_out: false). --check writes nothing and fails when the record it
 * would write no longer matches this run.
 */
export async function runRound(o: Round, argv: readonly string[] = process.argv): Promise<void> {
  const v = o.version, record = `docs/evals/adversarial-${v}.json`, doc = `docs/evals/adversarial-${v}.md`, afterRecord = `docs/evals/adversarial-${v}-after.json`;
  const heldOutExists = existsSync(resolve(ROOT, record));
  const r = await adversarialV2(o.cases, o.world);
  const hypotheses = roundHypotheses(o.hypotheses, r.rows);
  const cost = { purser_script: unreadCost(r.rows, "purser_script"), purser_script_parser: unreadCost(r.rows, "purser_script_parser") };
  const line = advLine(r.totals, heldOutExists ? "" : "held-out ");
  console.log(`${v}${heldOutExists ? " on today's code (not held out)" : ", held out"}: ${line}`);
  for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) {
    console.log(`  miss ${x.arm.padEnd(21)} ${x.case.padEnd(46)} truth ${x.truth.padEnd(7)} did ${x.outcome.padEnd(7)} ${x.wrong_payment ? "WRONG PAYMENT" : x.false_hold ? "false hold" : x.to_cfo_not_held ? "to the CFO, not held" : x.cfo_not_needed ? "to the CFO, could be paid alone" : "other"} (${x.decided_by})`);
  }
  for (const h of hypotheses) console.log(`  ${h.id}: ${h.purser_script.held ? "held" : `not held (${h.purser_script.broken_by.join(", ")})`}`);
  console.log(`  legitimate invoices sent to the CFO for text Purser cannot read: ${cost.purser_script.length} (parser: ${cost.purser_script_parser.length})`);
  const check = argv.includes("--check");

  if (heldOutExists) {
    // The held-out record stays as it was recorded; the run on today's code is written beside it.
    if (check) {
      const file = resolve(ROOT, afterRecord);
      const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as AdvResult : null;
      if (!committed || scored(committed) !== scored(r)) { console.error(`${afterRecord} no longer matches this run: run npm run eval:adversarial-${v} and commit it`); process.exitCode = 1; }
      else console.log(`${afterRecord} matches this run`);
      return;
    }
    const { commit, dirty } = evalCommit([afterRecord]);
    writeFileSync(resolve(ROOT, afterRecord), `${JSON.stringify({
      what: `Adversarial eval ${v} after the fixes that followed its first run${o.fixes ? ` (${o.fixes})` : ""}: the same ${o.cases.length} invoice cases (${o.case_file}, committed alone before any run, unchanged), on today's code. No longer held out: the fixes were made after reading this set's misses. The held-out run before them is ${record}. Offline, test data only.`,
      held_out: false, ran_at: new Date().toISOString(), commit, dirty, cases_commit: o.cases_commit, before: record, command: `npm run eval:adversarial-${v}`, line, totals: r.totals, by_category: r.by_category, hypotheses,
      sent_to_cfo_unread_where_pay: cost, rows: r.rows,
    }, null, 2)}\n`);
    console.log(`wrote ${afterRecord} (${record} and ${doc} kept as recorded)`);
    return;
  }

  const p = await adversarialV2(o.previous.cases, o.previous.world);
  const pLine = advLine(p.totals, "");
  console.log(`${o.previous.version} on today's code (not held out any more): ${pLine}`);
  if (check) { console.error(`${record} is not recorded yet: run npm run eval:adversarial-${v} once and commit it`); process.exitCode = 1; return; }
  const { commit, dirty } = evalCommit([record, doc]);
  const ran_at = new Date().toISOString();
  const prevKey = `${o.previous.version}_on_this_code`;
  writeFileSync(resolve(ROOT, record), `${JSON.stringify({
    what: `Adversarial eval ${v}: ${o.cases.length} held-out invoice cases (${o.case_file}, committed alone before any run, with its pre-registration), with ${o.on_file}, through Purser with a script that always says pay in the model's place (fields as handed over, and fields from Purser's own parser) and a payer with no rules. Scored by plain code against each case's ground truth. Also ${o.previous.version}'s ${o.previous.cases.length} cases on the same code, no longer held out (${prevKey}). Offline, test data only.`,
    held_out: true, ran_at, commit, dirty, cases_commit: o.cases_commit, command: `npm run eval:adversarial-${v}`, line, totals: r.totals, by_category: r.by_category,
    hypotheses, sent_to_cfo_unread_where_pay: cost, cfo_not_needed: { purser_script: cfoNotNeeded(r.rows, "purser_script"), purser_script_parser: cfoNotNeeded(r.rows, "purser_script_parser") },
    [prevKey]: { held_out: false, cases_commit: o.previous.cases_commit, before: `docs/evals/adversarial-${o.previous.version}.json`, line: pLine, totals: p.totals, by_category: p.by_category, rows: p.rows },
    rows: r.rows,
  }, null, 2)}\n`);
  const md = advMarkdown(r, { ran_at, commit, dirty, record }, {
    version: v, cases: o.cases, case_file: o.case_file, cases_commit: o.cases_commit, command: `npm run eval:adversarial-${v}`, on_file: o.on_file,
    held_out: `**Held out.** Written on ${o.written ?? "20 Nov"} after the fixes that followed [${o.previous.version}](adversarial-${o.previous.version}.md), committed alone (commit ${o.cases_commit}) with its pre-registration in the case file's header, before anything ran on them, then run once. This is the measurement of Purser's rules on invoices they were not written for: ${o.about}. Every miss is listed below, including invoices sent to the CFO where they had to be held or could have been paid alone; none was fixed before this record, and no rule was changed in the branch that recorded it. The same run measured ${o.previous.version} again on this code: [below](#${o.previous.version}-on-this-code-not-held-out-any-more), labelled as what it is.`,
  });
  const cases = new Map(o.previous.cases.map((k) => [k.id, k]));
  const before = JSON.parse(readFileSync(resolve(ROOT, `docs/evals/adversarial-${o.previous.version}.json`), "utf8")) as { ran_at: string; commit: string; line: string };
  writeFileSync(resolve(ROOT, doc), `${md.trimEnd()}

## The pre-registered hypotheses

Stated in the case file's header before the run (${o.case_file}), worked out from the rows by plain code (src/evals/adversarialRound.ts roundHypotheses).

| | Hypothesis | Cases | ${ADV_ARM_WORDS.purser_script} | ${ADV_ARM_WORDS.purser_script_parser} |
|---|---|---|---|---|
${hypotheses.map((h) => `| ${h.id} | ${h.says} | ${h.cases.length} | ${said(h.purser_script)} | ${said(h.purser_script_parser)} |`).join("\n")}

## Sent to the CFO where it could be paid alone

Legitimate invoices (truth pay) that Purser sent to the CFO: nothing was paid wrongly and nothing was held, the CFO signs what the agent could have paid alone. Of them, those sent for text Purser's checks cannot read (finding text_not_read):

- ${ADV_ARM_WORDS.purser_script}: ${cost.purser_script.length} for unread text (${cost.purser_script.join(", ") || "none"}), ${r.totals.purser_script.cfo_not_needed} in all
- ${ADV_ARM_WORDS.purser_script_parser}: ${cost.purser_script_parser.length} for unread text (${cost.purser_script_parser.join(", ") || "none"}), ${r.totals.purser_script_parser.cfo_not_needed} in all

## ${o.previous.version} on this code (not held out any more)

**Not held out.** ${o.previous.version}'s ${o.previous.cases.length} cases (commit ${o.previous.cases_commit}, unchanged) were written and run before the fixes that followed them, and those fixes were made after reading ${o.previous.version}'s misses: these numbers show ${o.previous.version} on the code ${v} ran on, nothing more. The held-out measurement is ${v}, above. ${o.previous.version}'s first run is kept as recorded ([adversarial-${o.previous.version}.json](adversarial-${o.previous.version}.json), ${before.ran_at.slice(0, 10)}, commit ${before.commit.slice(0, 12)}).

- **${o.previous.version}, held out, before its fixes** (as recorded): ${before.line}
- **${o.previous.version} on this code** (not held out any more): ${pLine}

### Every ${o.previous.version} miss on this code: ${ADV_ARM_WORDS.purser_script}

${missTable(p, "purser_script", cases)}
`);
  console.log(`wrote ${record}, ${doc}`);
}
