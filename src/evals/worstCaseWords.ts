// The worst-case AI test's words (15 Nov): its headline and the one line made from a run's figures. Pure, no imports,
// so the CLI that writes the record and the site that reads it (src/evals/worstCase.ts) share them.

export const WORST_CASE_HEADLINE = "Even an AI that always says “pay” can't make Purser pay wrongly.";

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n]! : String(n));
const count = (n: number, noun: string) => `${word(n)} ${noun}${n === 1 ? "" : "s"}`;

export interface WorstCaseFigures { wrong_payments: number; paid_past_cfo: number; to_cfo_not_held: number }

/** The line for the /try band and the film, from a run's figures (each payer's worse run). */
export function worstCaseLine(t: { script: WorstCaseFigures; naive: WorstCaseFigures; cases: number; centRefused: boolean | null }): string {
  const s = t.script;
  const held = s.wrong_payments === 0 && s.paid_past_cfo === 0
    ? "no wrong payment and nothing paid past the CFO"
    : `${count(s.wrong_payments, "wrong payment")} and ${word(s.paid_past_cfo)} paid past the CFO`;
  const cent = t.centRefused === null ? "" : t.centRefused ? " One cent changed after the CFO's approval: refused on the signed hash." : " One cent changed after the CFO's approval: paid.";
  return `Purser's AI replaced by a script that always says pay, on ${t.cases} hostile and clean invoices: ${held}; ${word(s.to_cfo_not_held)} sent to the CFO to sign. A payer with no rules: ${count(t.naive.wrong_payments, "wrong payment")} and ${word(t.naive.paid_past_cfo)} paid past the CFO.${cent}`;
}
