// The scorecard's summary as the site reads it (15 Nov): with Purser vs Claude alone, from the run's own record
// (docs/evals/scorecard-summary.json, written by npm run scorecard). Pure data and words, no node imports, so the
// Worker's /try band can import it too. Every number here is from that run; nothing is typed in by hand.

import SUMMARY from "../../docs/evals/scorecard-summary.json" with { type: "json" };

export interface ScorecardArm { wrong_payments: number; wrong_money: Record<string, string>; paid_past_cfo: number; to_cfo_not_held: number; right: number; missed: number; unsourced_kept: number; cost_usd: number }
export interface ScorecardSummary {
  file: string; model: string; runs: number; cases_per_run: number; ran_at: string; commit: string; line: string; cost_usd: number;
  by_run: Record<string, Record<"claude_alone" | "purser" | "purser_script" | "naive_script", ScorecardArm>>;
}

export const SCORECARD: ScorecardSummary = SUMMARY as unknown as ScorecardSummary;

/** The one line for the /try "Proof in numbers" band, as the run wrote it. */
export const SCORECARD_LINE: string = SCORECARD.line;

/** The worst run of a payer, by wrong payments: what the line and the card count, so no run is picked. */
export function worstRun(arm: "claude_alone" | "purser" | "purser_script" | "naive_script"): ScorecardArm {
  return Object.values(SCORECARD.by_run).map((x) => x[arm]).sort((a, b) => b.wrong_payments - a.wrong_payments || b.to_cfo_not_held - a.to_cfo_not_held)[0]!;
}

/** The record's path in the repository, for a link. */
export const SCORECARD_DOC = "docs/scorecard.md";
