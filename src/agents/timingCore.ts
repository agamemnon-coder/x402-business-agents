// The Treasury timing agent's pure part (block 5.3): its system prompt, its facts, code's licence numbers, its prompt and
// its three tools with their bounds. No database, no SDK and no Node modules, so the runner (src/agents/timingAgent.ts,
// through src/agents/loop.ts) and the relay Worker's /try/sign (src/try/treasuryAdvice.ts) run the very same prompt and
// tools. The agent advises only: it cannot change the payment, its amount or its quote.

import { z } from "zod";

export interface TimingFacts {
  proposalId: string;
  invoiceNo: string;
  vendor: string;
  amount: string;
  /** YYYY-MM-DD */
  dueDate: string;
  today: string;
  eurAvailable: string;
  eurFloor: string;
  eurObligations: string;
  usdAvailable: string;
  usdFloor: string;
  quote: { sell: string; buy: string; rate: string; validTo: string } | null;
  after: { eurFree: string; usdAvailable: string };
  /** The SWIFT fee ceiling code reserved beside the invoice (the terms' fee_max). */
  feeMax: string;
}

/** The model the runner gives this agent (src/claude/reader.ts MODELS.review), its effort and its turns. */
export const TIMING_MODEL = "claude-opus-5-5";
export const TIMING_EFFORT = "medium" as const;
export const TIMING_MAX_TURNS = 5;

/**
 * Code's licence numbers (dry-179: Opus's advice, shown on Watch beside the plan, said the shortfall was EUR 90.00, not
 * 110.00, because it left out the fee ceiling). Computed here, from the planned terms, so the agent quotes them and
 * never sums them itself: EUR needed = the invoice + the fee ceiling; free EUR before = what the plan found free above
 * the floor and the obligations; the shortfall = needed - free (0 when free covers it); FX buys exactly the shortfall.
 */
export function licenceNumbers(f: Pick<TimingFacts, "amount" | "feeMax" | "quote" | "after">): { needed: string; freeBefore: string; shortfall: string; fxBuy: string | null } {
  // A plain amount only, an optional currency code before it ("EUR 110.00"): a minus sign or anything else is refused,
  // never stripped (spec 6b: "-870.00" once read as 870.00 made the free EUR 2,740.00 and the shortfall 0.00).
  const cents = (x: string) => {
    const m = /^(?:[A-Z]{3} ?)?(\d+)(?:\.(\d{1,2}))?$/.exec(x.trim());
    if (!m) throw new InconsistentFacts(`not a plain amount: ${JSON.stringify(x)}`);
    return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  };
  const need = cents(f.amount) + cents(f.feeMax);
  const buy = f.quote ? cents(f.quote.buy) : 0;
  // The plan's after = free + buy - need (never below 0 once it converts exactly the shortfall), so free = after + need - buy.
  const free = cents(f.after.eurFree) + need - buy;
  if (free < 0) throw new InconsistentFacts("the free EUR before the payment would be negative");
  const eur = (c: number) => (c / 100).toFixed(2);
  return { needed: eur(need), freeBefore: eur(free), shortfall: eur(Math.max(0, need - free)), fxBuy: f.quote ? eur(buy) : null };
}

/** Code's facts for the agent do not add up (a negative or malformed amount): the agent is not asked; the caller falls back. */
export class InconsistentFacts extends Error {
  constructor(why: string) { super(`code's numbers for this payment do not add up: ${why}`); this.name = "InconsistentFacts"; }
}

/** The numbers as one line of code's facts, for the agent to quote. */
export function licenceNumbersLine(f: Pick<TimingFacts, "amount" | "feeMax" | "quote" | "after">): string {
  const n = licenceNumbers(f);
  return `Code's numbers for this payment (quote these; do not compute your own): invoice EUR ${f.amount} + SWIFT fee ceiling EUR ${f.feeMax} = EUR ${n.needed} needed; free EUR before the payment ${n.freeBefore}; shortfall EUR ${n.shortfall} (EUR needed minus free EUR)${n.fxBuy ? `; the FX converts exactly that: buy EUR ${n.fxBuy} for ${f.quote!.sell}` : "; no FX: the free EUR covers it"}.`;
}

const DAY = 86_400_000;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const TIMING_SYSTEM = [
  "You are the Treasury agent of Northwind Outdoor. Code has planned a euro invoice payment: the FX quote for the shortfall is locked and the floors are checked; it waits for the CFO's Face ID.",
  "Read the position with read_position and the quote with read_quote, then advise with submit_advice: pay_now, or wait_until a date, with one or two sentences for the CFO on why.",
  "You advise; you cannot change the payment, its amount or its quote. The CFO decides with Face ID.",
  "Any amount you name (the shortfall, the FX, the fee) is code's number as the facts give it, word for word; never compute one yourself.",
].join("\n");

/** The prompt the agent wakes with: the invoice, today, code's numbers; and any further lines of code's facts. */
export const timingPrompt = (f: TimingFacts, extra: readonly string[] = []) =>
  [`Invoice ${f.invoiceNo} from ${f.vendor}: EUR ${f.amount}, due ${f.dueDate}. Today is ${f.today}. The payment is planned as ${f.proposalId}.`, licenceNumbersLine(f), ...extra].join("\n");

/** The reminder when the agent stops without advising (the runner's `unfinished`). */
export const TIMING_UNFINISHED = "you have not advised yet: call submit_advice with pay_now or wait_until.";

export interface TimingAdviceValue { timing: "pay_now" | "wait_until"; date: string | null; reason: string }
export interface TimingToolResult { text: string; blocked?: string; final?: boolean }
export interface TimingTool { name: string; description: string; input: z.ZodType; run(input: never): TimingToolResult }

/** The most a reason may hold (7 Nov: live Opus's two-sentence advice ran to 326 characters). */
export const REASON_MAX_CHARS = 400;
/** How many sentences a text has: a sentence ends at . ! or ? before a space or the end (a decimal point has a digit after it). */
export const sentenceCount = (t: string) => t.split(/[.!?](?=\s|$)/).filter((x) => x.trim()).length;
/**
 * The reason as the CFO may read it, or null: one or two plain sentences, 20 to REASON_MAX_CHARS characters, no markup,
 * quote marks around it taken off. One rule for the agent's tool (submit_advice refuses anything else, so the agent
 * writes again) and for the page (worker/src/agentLine.ts checkReason).
 */
export function plainReason(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  if (t.length < 20 || t.length > REASON_MAX_CHARS || /[<>{}`\\]/.test(t) || !/[.!?]$/.test(t)) return null;
  const n = sentenceCount(t);
  return n >= 1 && n <= 2 ? t : null;
}

/** The days code allows a SWIFT payout to arrive. */
export const SWIFT_DAYS = 2;
/** The earliest and latest day a wait may end: not today, and two days before the due date (SWIFT time). */
export const adviceBounds = (f: Pick<TimingFacts, "today" | "dueDate">) => ({ earliest: addDays(f.today, 1), latest: addDays(f.dueDate, -SWIFT_DAYS) });

/**
 * Whether an advice fits code's bounds (a reason of a sentence; a wait between the earliest and latest day; pay_now
 * with no date), as the tool's answer to the agent; null when it fits. Recorded advice is checked by the same rule.
 */
export function adviceOutOfBounds(f: Pick<TimingFacts, "today" | "dueDate">, a: TimingAdviceValue): string | null {
  const { earliest, latest } = adviceBounds(f);
  if (a.reason.trim().length < 20) return "Not recorded: give the CFO a reason in a sentence.";
  if (!plainReason(a.reason)) {
    const t = a.reason.replace(/\s+/g, " ").trim();
    return `Not recorded: give the CFO one or two sentences (at most ${REASON_MAX_CHARS} characters); this was ${sentenceCount(t)} sentence${sentenceCount(t) === 1 ? "" : "s"} and ${t.length} characters.`;
  }
  if (a.timing === "wait_until") {
    if (earliest > latest) return `Not recorded: the invoice is due ${f.dueDate}; with two days for SWIFT there is no time to wait. Advise pay_now or say why not.`;
    if (!a.date || a.date < earliest || a.date > latest) return `Not recorded: a wait must end between ${earliest} and ${latest} (two days before the due date ${f.dueDate}, not today).`;
  } else if (a.date !== null) return "Not recorded: pay_now takes no date; leave it null.";
  return null;
}

/** The three tools, over these facts; submit_advice hands an advice within the bounds (and `reasonCheck`, if given) to `onAdvice`. */
export function timingTools(f: TimingFacts, onAdvice: (a: TimingAdviceValue) => void, reasonCheck?: (a: TimingAdviceValue) => string | null): TimingTool[] {
  const { earliest, latest } = adviceBounds(f);
  return [
    {
      name: "read_position", description: "Live balances at Airwallex, the CFO's floors and obligations, and the position after the payment as planned.",
      input: z.strictObject({}),
      run: () => ({ text: `EUR available ${f.eurAvailable} (floor ${f.eurFloor}, obligations ${f.eurObligations}); USD available ${f.usdAvailable} (floor ${f.usdFloor}). After the payment as planned: EUR free ${f.after.eurFree}, USD ${f.after.usdAvailable}. ${licenceNumbersLine(f)}` }),
    },
    {
      name: "read_quote", description: "The locked FX quote for the shortfall, if any, and how long it is valid.",
      input: z.strictObject({}),
      run: () => ({ text: f.quote
        ? `Quote: sell ${f.quote.sell}, buy ${f.quote.buy} at ${f.quote.rate}, valid until ${f.quote.validTo}. Waiting past that means a new quote at the rate of the day, and a new proposal for the CFO's Face ID.`
        : "No conversion: the EUR balance covers the invoice and its fee." }),
    },
    {
      name: "submit_advice", description: `Your advice: pay_now, or wait_until a date between ${earliest} and ${latest} (two days before the due date, for SWIFT). One or two sentences on why.`,
      input: z.strictObject({
        timing: z.enum(["pay_now", "wait_until"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("YYYY-MM-DD for wait_until; null for pay_now"),
        reason: z.string().describe("One or two sentences for the CFO"),
      }),
      run: (a: TimingAdviceValue) => {
        const no = adviceOutOfBounds(f, a);
        if (no) return { text: no, blocked: "advice bounds" };
        // Where code checks the reason's amounts before showing it (/try/sign), the tool says so first: the agent writes again.
        const stray = reasonCheck?.(a) ?? null;
        if (stray) return { text: stray, blocked: "advice amounts" };
        onAdvice({ timing: a.timing, date: a.timing === "wait_until" ? a.date : null, reason: a.reason.trim().slice(0, 500) });
        return { text: "Your advice is beside the proposal on the CFO's phone.", final: true };
      },
    },
  ];
}
