// /try's "Proof in numbers" carries the scorecard's summary in short (15 Nov, scorecard #363): built here from the run's
// own record (src/evals/scorecardSummary.ts, docs/evals/scorecard-summary.json), never typed by hand, and linked to
// docs/scorecard.md. Only while the record says the same for every run: Purser sent none of the must-hold invoices to
// the CFO, and Claude alone the same number each run. Otherwise there is no short line (the long one is the record's).
import { SCORECARD, SCORECARD_DOC } from "../../../src/evals/scorecardSummary.js";
import { REPO_BLOB } from "../../../src/redesign/metalStory.js";

const WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const word = (n: number) => WORDS[n] ?? String(n);

export function scorecardShort(s = SCORECARD): string | null {
  const runs = Object.values(s.by_run);
  if (!runs.length || runs.length !== s.runs) return null;
  const alone = runs.map((r) => r.claude_alone?.to_cfo_not_held), purser = runs.map((r) => r.purser?.to_cfo_not_held);
  if (alone.some((n) => typeof n !== "number") || new Set(alone).size !== 1 || purser.some((n) => n !== 0) || !alone[0]) return null;
  return `With Purser: none of the must-hold invoices reached the CFO; Claude alone sent ${word(alone[0]!)} a run (${s.cases_per_run} cases, ${word(s.runs)} runs, real Claude)`;
}

export const SCORECARD_SHORT = scorecardShort();
export const SCORECARD_HREF = `${REPO_BLOB}${SCORECARD_DOC}`;
