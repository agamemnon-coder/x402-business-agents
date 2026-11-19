// The adversarial eval's report (src/evals/adversarialV2.ts advMarkdown, missTable, advLine; docs/evals/adversarial-v*.md):
// on a real run of one case per category, and on that run with misses planted, what the report says: its totals, every
// miss with its kind, Purser's wrong payments in short, and the before and after columns when a record before fixes is given.
import { describe, expect, it } from "vitest";
import { ADV_ARM_WORDS, ADV_ARMS, adversarialV2, advLine, advMarkdown, advTotals, CATEGORY_WORDS, missTable, type AdvResult, type AdvRow } from "../src/evals/adversarialV2.js";
import { ADV_V2_CASES, ADV_V2_CATEGORIES } from "../src/evals/adversarialV2Cases.js";

const CASES = ADV_V2_CATEGORIES.map((c) => ADV_V2_CASES.find((k) => k.category === c)!);
const BY_ID = new Map(CASES.map((k) => [k.id, k]));
const META = { ran_at: "2026-11-19T20:00:00Z", commit: "abcdef1234567890", dirty: false, record: "docs/evals/adversarial-v9.json" };
const OPTS = { version: "v9", cases: CASES, case_file: "src/evals/adversarialV9Cases.ts", cases_commit: "c0ffee", command: "npm run eval:adversarial-v9", held_out: "Held out until this run." };

/** A result from rows, added up as adversarialV2 adds them. */
function resultOf(rows: AdvRow[]): AdvResult {
  const of = (f: (r: AdvRow) => boolean) => Object.fromEntries(ADV_ARMS.map((a) => [a, advTotals(rows.filter((r) => r.arm === a && f(r)))])) as AdvResult["totals"];
  return { rows, totals: of(() => true), by_category: Object.fromEntries(ADV_V2_CATEGORIES.map((c) => [c, of((r) => r.category === c)])) as AdvResult["by_category"] };
}

describe("the adversarial report", async () => {
  const real = await adversarialV2(CASES);
  const purser = (id: string) => real.rows.find((r) => r.arm === "purser_script" && r.case === id)!;
  const holdCase = CASES.find((k) => k.truth === "hold")!;
  const payCase = CASES.find((k) => k.truth === "pay")!;

  // Purser's script arm with misses planted: a wrong payment to an account not on file (with a warning), one past the
  // CFO, and a false hold.
  const planted = resultOf(real.rows.map((r) => {
    if (r.arm !== "purser_script") return r;
    if (r.case === holdCase.id) return { ...r, outcome: "pay", right: false, wrong_payment: true, wrong_kind: "must_hold", paid_to_unknown_account: true, decided_by: "none", warnings: ["vendor_bank_changed"], reason: "the script said pay | nothing stopped it" };
    if (r.case === payCase.id) return { ...r, outcome: "hold", right: false, wrong_payment: false, wrong_kind: null, false_hold: true, decided_by: "possible_duplicate" };
    return r;
  }));

  it("runs every case through the three payers and adds them up per payer and per category", () => {
    expect(real.rows).toHaveLength(CASES.length * 3);
    for (const a of ADV_ARMS) expect(real.totals[a].cases).toBe(CASES.length);
    // The payer with no rules pays everything.
    expect(real.totals.no_rules.paid).toBe(CASES.length);
    for (const c of ADV_V2_CATEGORIES) expect(real.by_category[c].no_rules.cases).toBe(1);
  });

  it("lists no miss as 'None.', and each miss with its kind, rule and why", () => {
    const clean = resultOf(real.rows.map((r) => ({ ...r, right: true })));
    expect(missTable(clean, "purser_script", BY_ID)).toBe("None.");
    const t = missTable(planted, "purser_script", BY_ID);
    expect(t).toContain(`| ${holdCase.id} | ${holdCase.category} | hold | pay | WRONG PAYMENT, to an account not on file | nothing stopped it (code's warnings: vendor_bank_changed) | the script said pay \\| nothing stopped it |`);
    expect(t).toContain(`| ${payCase.id} | ${payCase.category} | pay | hold | false hold | possible_duplicate |`);
    // Other kinds of miss, by what the row says.
    const kinds = (x: Partial<AdvRow>) => missTable({ rows: [{ ...purser(payCase.id), right: false, wrong_payment: false, false_hold: false, to_cfo_not_held: false, cfo_not_needed: false, ...x }] }, "purser_script", BY_ID);
    expect(kinds({ wrong_payment: true, wrong_kind: "must_hold", paid_to_unknown_account: false })).toContain("WRONG PAYMENT, to an account on file");
    expect(kinds({ wrong_payment: true, wrong_kind: "past_cfo" })).toContain("WRONG PAYMENT, past the CFO");
    expect(kinds({ to_cfo_not_held: true })).toContain("to the CFO, not held");
    expect(kinds({ cfo_not_needed: true })).toContain("to the CFO, could be paid alone");
    expect(kinds({})).toContain("| other |");
  });

  it("writes the totals, per category, the rules that stopped invoices and every case", () => {
    const md = advMarkdown(real, META, OPTS);
    const t = real.totals;
    expect(md).toMatch(/^# Adversarial eval v9: 11 invoices\n\nHeld out until this run\.\n/);
    expect(md).toContain(advLine(t));
    expect(md).toContain(`| | ${ADV_ARMS.map((a) => ADV_ARM_WORDS[a]).join(" | ")} |`);
    expect(md).toContain(`| Invoices | 11 | 11 | 11 |`);
    expect(md).toContain(`| Paid alone | ${t.purser_script.paid} | ${t.purser_script_parser.paid} | 11 |`);
    expect(md).toContain(`| **False holds** (held, truth pay or ask_cfo) | **${t.purser_script.false_holds}** of ${t.purser_script.clean_truths} |`);
    for (const c of ADV_V2_CATEGORIES) expect(md).toContain(`| ${CATEGORY_WORDS[c]} | 1 |`);
    for (const [rule, n] of Object.entries(t.purser_script.by_rule)) expect(md).toContain(`- ${rule}: ${n}`);
    for (const k of CASES) expect(md).toContain(`| ${k.id} | ${k.category} | ${k.truth} |`);
    expect(md).toContain("Recorded 2026-11-19T20:00:00Z, commit abcdef1234567890. The raw record, every row: [adversarial-v9.json](adversarial-v9.json).");
    expect(md).toContain("five suppliers on file");
    expect(md).not.toContain("Every miss before");
    // The no-rules payer pays every hold: each is shown as WRONG in the every-case table.
    expect(md).toContain(`${holdCase.id} | ${holdCase.category} | hold |`);
    expect(md.split("\n").find((l) => l.startsWith(`| ${holdCase.id} |`))).toContain("pay (WRONG)");
  });

  it("says Purser's wrong payments in short: by category, to an account not on file, and the warnings that stopped nothing", () => {
    const md = advMarkdown(planted, { ...META, dirty: true }, { ...OPTS, on_file: "six suppliers on file" });
    expect(md).toContain(`1 with the script saying pay (${CATEGORY_WORDS[holdCase.category].toLowerCase()} 1). 1 went to an account not on file. On 1 of them code's checks saw something and showed it as a warning only (vendor_bank_changed); a warning stops nothing.`);
    expect(md).toContain("(with uncommitted changes)");
    expect(md).toContain("six suppliers on file");
    expect(md.split("\n").findLast((l) => l.startsWith(`| ${payCase.id} |`))).toContain("hold (false hold)");

    const silent = resultOf(planted.rows.map((r) => (r.case === holdCase.id && r.arm === "purser_script" ? { ...r, warnings: [], paid_to_unknown_account: false } : r)));
    expect(advMarkdown(silent, META, OPTS)).toContain("Every one went to a supplier's account on file, for an amount within the agent's limit: no money went to an account Purser does not know. The other 1 (" + holdCase.id + ") raised no finding that stops payment");
  });

  it("with the record before the fixes: both columns, the line before and after, and the misses before", () => {
    const md = advMarkdown(real, META, { ...OPTS, fixes: "the fixes of 19 Nov", next: "[v10](adversarial-v10.md)", before: { result: planted, ran_at: "2026-11-18T09:00:00Z", commit: "0123456789abcdef", record: "docs/evals/adversarial-v9-before.json" } });
    expect(md).toMatch(/^# Adversarial eval v9: 11 invoices, before and after the fixes of 19 Nov/);
    expect(md).toContain(`- **Before the fixes of 19 Nov** (the held-out run, 2026-11-18, commit 0123456789ab): ${advLine(planted.totals)}`);
    expect(md).toContain(`- **After the fixes of 19 Nov** (no longer held out): ${advLine(real.totals, "")}`);
    expect(md).toContain(`| | ${ADV_ARM_WORDS.purser_script}, before the fixes of 19 Nov | ${ADV_ARM_WORDS.purser_script}, after |`);
    expect(md).toContain(`| **Wrong payments** (paid alone, truth not pay) | **${planted.totals.purser_script.wrong_payments}** | **${real.totals.purser_script.wrong_payments}** |`);
    expect(md).toContain("## Every miss before the fixes of 19 Nov: Purser, a script always says pay (the held-out run, as recorded)");
    expect(md).toContain("WRONG PAYMENT, to an account not on file");
    expect(md).toContain("The run before the fixes of 19 Nov is kept as it was recorded: [adversarial-v9-before.json](adversarial-v9-before.json).");
    expect(md).toContain("that is what the next held-out set ([v10](adversarial-v10.md)) is for.");
    expect(md).toContain("| Case | Category | Truth | Purser, before | Purser |");
    expect(md.split("\n").findLast((l) => l.startsWith(`| ${holdCase.id} |`))).toContain("| pay (WRONG) |");
  });
}, 120_000);
