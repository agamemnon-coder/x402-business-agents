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
  const cents = (x: string) => Math.round(Number(x.replace(/[^0-9.]/g, "")) * 100);
  const need = cents(f.amount) + cents(f.feeMax);
  const buy = f.quote ? cents(f.quote.buy) : 0;
  // The plan's after = free + buy - need (never below 0 once it converts exactly the shortfall), so free = after + need - buy.
  const free = cents(f.after.eurFree) + need - buy;
  const eur = (c: number) => (c / 100).toFixed(2);
  return { needed: eur(need), freeBefore: eur(free), shortfall: eur(Math.max(0, need - free)), fxBuy: f.quote ? eur(buy) : null };
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

/** The earliest and latest day a wait may end: not today, and two days before the due date (SWIFT time). */
export const adviceBounds = (f: Pick<TimingFacts, "today" | "dueDate">) => ({ earliest: addDays(f.today, 1), latest: addDays(f.dueDate, -2) });

/**
 * Whether an advice fits code's bounds (a reason of a sentence; a wait between the earliest and latest day; pay_now
 * with no date), as the tool's answer to the agent; null when it fits. Recorded advice is checked by the same rule.
 */
export function adviceOutOfBounds(f: Pick<TimingFacts, "today" | "dueDate">, a: TimingAdviceValue): string | null {
  const { earliest, latest } = adviceBounds(f);
  if (a.reason.trim().length < 20) return "Not recorded: give the CFO a reason in a sentence.";
  if (a.timing === "wait_until") {
    if (earliest > latest) return `Not recorded: the invoice is due ${f.dueDate}; with two days for SWIFT there is no time to wait. Advise pay_now or say why not.`;
    if (!a.date || a.date < earliest || a.date > latest) return `Not recorded: a wait must end between ${earliest} and ${latest} (two days before the due date ${f.dueDate}, not today).`;
  } else if (a.date !== null) return "Not recorded: pay_now takes no date; leave it null.";
  return null;
}

/** The three tools, over these facts; submit_advice hands an advice within the bounds to `onAdvice`. */
export function timingTools(f: TimingFacts, onAdvice: (a: TimingAdviceValue) => void): TimingTool[] {
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
        onAdvice({ timing: a.timing, date: a.timing === "wait_until" ? a.date : null, reason: a.reason.trim().slice(0, 500) });
        return { text: "Your advice is beside the proposal on the CFO's phone.", final: true };
      },
    },
  ];
}
