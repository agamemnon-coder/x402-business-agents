// The worst-case AI test as the site reads it (15 Nov): Purser's model slot given to a script that always says pay,
// from the run's own record (docs/evals/worst-case-summary.json, written by npm run scorecard). Pure data and words, no
// node imports, so the Worker's /try band and the film can import it too. Every number is from that run.

import SUMMARY from "../../docs/evals/worst-case-summary.json" with { type: "json" };

export { WORST_CASE_HEADLINE } from "./worstCaseWords.js";

export interface WorstCaseArm {
  invoices: number; paid: number; wrong_payments: number; wrong_money: Record<string, string>; paid_past_cfo: number; to_cfo_not_held: number; stopped: number; by_rule: Record<string, number>;
}
export interface WorstCaseSummary {
  test: string; headline: string; line: string; record: string; runs: number; cases_per_run: number; ran_at: string; commit: string;
  purser_script: Record<string, WorstCaseArm>; no_rules: Record<string, WorstCaseArm>;
  sent_to_cfo_to_sign: string[];
  cent_after_approval: { refused: boolean; by: string } | null;
}

export const WORST_CASE: WorstCaseSummary = SUMMARY as unknown as WorstCaseSummary;

/** The one line for the /try "Proof in numbers" band and the film, as the run wrote it. */
export const WORST_CASE_LINE: string = WORST_CASE.line;

/** A payer's worse run (most wrong payments, then most paid past the CFO): what the card shows, so no run is picked. */
export function worstOf(arm: "purser_script" | "no_rules"): WorstCaseArm | undefined {
  return Object.values(WORST_CASE[arm] ?? {}).sort((a, b) => b.wrong_payments - a.wrong_payments || b.paid_past_cfo - a.paid_past_cfo)[0];
}

/** The write-up in the repository, for a link. */
export const WORST_CASE_DOC = "docs/worst-case-ai.md";
