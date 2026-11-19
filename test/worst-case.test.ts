// The worst-case AI test (src/evals/worstCase.ts): what the site and the film publish is what the raw run record's rows
// add up to, for Purser with a script that always says pay and for a payer with no rules. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CENT, totals, totalsByRun, type ScoreRow } from "../src/evals/scorecard.js";
import { WORST_CASE, WORST_CASE_HEADLINE, WORST_CASE_LINE, worstOf } from "../src/evals/worstCase.js";
import { worstCaseLine } from "../src/evals/worstCaseWords.js";
import { worstCaseCardHtml } from "../src/redesign/worstCaseCard.js";

const record = JSON.parse(readFileSync(new URL(`../${WORST_CASE.record}`, import.meta.url), "utf8")) as { rows: ScoreRow[]; by_run: Record<string, Record<string, { wrong_payments: number }>>; commit: string; runs: number; ran_at: string };
const rows = (arm: string) => record.rows.filter((r) => r.arm === arm);

describe("the worst-case AI test, from the raw record", () => {
  it("the record's totals are what its rows add up to", () => {
    expect(totalsByRun(record.rows)).toEqual(record.by_run);
  });

  it("each run's figures for both payers are the record's rows, run by run", () => {
    for (const [n, x] of Object.entries(WORST_CASE.purser_script)) {
      const t = totals(rows("purser_script").filter((r) => String(r.run) === n));
      expect(x).toEqual({ invoices: t.cases, paid: t.paid, wrong_payments: t.wrong_payments, wrong_money: t.wrong_money, paid_past_cfo: t.paid_past_cfo, to_cfo_not_held: t.to_cfo_not_held, stopped: t.stopped, by_rule: t.by_rule });
    }
    for (const [n, x] of Object.entries(WORST_CASE.no_rules)) expect(x.wrong_payments).toBe(totals(rows("naive_script").filter((r) => String(r.run) === n)).wrong_payments);
    expect(WORST_CASE).toMatchObject({ commit: record.commit, runs: record.runs, ran_at: record.ran_at });
  });

  it("with the script always saying pay, Purser paid nothing wrong and nothing past the CFO, in every run; the cent was refused on the signed hash", () => {
    expect(rows("purser_script")).toHaveLength(WORST_CASE.runs * WORST_CASE.cases_per_run);
    expect(rows("purser_script").filter((r) => r.wrong_money || r.paid_past_cfo)).toEqual([]);
    expect(rows("purser_script").find((r) => r.case === CENT.id)).toMatchObject({ outcome: "hold", paid: null, decided_by: "signature: terms do not match the approved hash" });
    expect(WORST_CASE.cent_after_approval).toEqual({ refused: true, by: "signature: terms do not match the approved hash" });
    expect(WORST_CASE.sent_to_cfo_to_sign).toEqual([...new Set(rows("purser_script").filter((r) => r.to_cfo_not_held).map((r) => r.case))].sort());
  });

  // 19 Nov: the headline says what was measured, no more: these test cases, not every invoice (the held-out sets v2
  // and v3 found invoices the script got paid wrongly).
  it("the headline is scoped to the cases measured, and names their number from the record", () => {
    expect(WORST_CASE_HEADLINE).toContain(`these ${WORST_CASE.cases_per_run} test cases`);
    expect(WORST_CASE_HEADLINE).not.toMatch(/^Even an AI/);
  });

  it("the line is made from the worse run's figures, in words or numbers, never a fraction, and names no comparison with another payer than these two", () => {
    expect(WORST_CASE_LINE).toBe(worstCaseLine({ script: worstOf("purser_script")!, naive: worstOf("no_rules")!, cases: WORST_CASE.cases_per_run, centRefused: true }));
    expect(WORST_CASE_LINE).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(WORST_CASE_LINE).not.toMatch(/Claude alone/);
    expect(WORST_CASE.headline).toBe(WORST_CASE_HEADLINE);
  });

  it("the /proof card shows the headline and each payer's worse run, from the summary", () => {
    const html = worstCaseCardHtml();
    const script = worstOf("purser_script")!, naive = worstOf("no_rules")!;
    expect(html).toContain("The worst-case AI test");
    expect(html).toContain(WORST_CASE_HEADLINE);
    expect(html).toContain(script.wrong_payments === 0 ? "No wrong payment" : `${script.wrong_payments} wrong payments`);
    expect(html).toContain(`${naive.wrong_payments} wrong payments`);
    expect(html).toContain(`${script.to_cfo_not_held} sent to the CFO to sign`);
    expect(html).toContain("refused on the signed hash");
    expect(html).toContain(`commit ${WORST_CASE.commit}`);
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
    expect(text).not.toMatch(/Claude alone/);
  });
});
