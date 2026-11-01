// Block 5.3: the Treasury agent (Opus) advises when to pay a planned euro invoice (the licence). Code has already
// planned the payment: the FX quote is locked for the shortfall, the floors are checked, the proposal waits for Face ID.
// The agent reads the live position and the quote and advises paying now or waiting until a date. Advisory only: the
// advice cannot change the terms; the quote's validity and the CFO's Face ID stay the rules. Code bounds the advice: a
// wait ends at least two days before the due date (SWIFT time) and not today, with a reason.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { runAgent, type AgentRun } from "./loop.js";

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
}

export interface TimingAdvice { source: "claude" | "fallback"; timing: "pay_now" | "wait_until" | null; date: string | null; reason: string; run: AgentRun }

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const SYSTEM = [
  "You are the Treasury agent of Northwind Outdoor. Code has planned a euro invoice payment: the FX quote for the shortfall is locked and the floors are checked; it waits for the CFO's Face ID.",
  "Read the position with read_position and the quote with read_quote, then advise with submit_advice: pay_now, or wait_until a date, with one or two sentences for the CFO on why.",
  "You advise; you cannot change the payment, its amount or its quote. The CFO decides with Face ID.",
].join("\n");

export async function adviseTiming(db: DB, f: TimingFacts, client: Anthropic | null = claudeClient(), model: string = MODELS.review): Promise<TimingAdvice> {
  let timing: TimingAdvice["timing"] = null, date: string | null = null, reason = "";
  const earliest = addDays(f.today, 1), latest = addDays(f.dueDate, -2);
  const run = await runAgent(db, {
    agent: "treasury", task: `licence.timing.${f.proposalId}`, model, system: SYSTEM, maxTurns: 5, effort: "medium",
    unfinished: () => (timing ? null : "you have not advised yet: call submit_advice with pay_now or wait_until."),
    prompt: `Invoice ${f.invoiceNo} from ${f.vendor}: EUR ${f.amount}, due ${f.dueDate}. Today is ${f.today}. The payment is planned as ${f.proposalId}.`,
    tools: [
      {
        name: "read_position", description: "Live balances at Airwallex, the CFO's floors and obligations, and the position after the payment as planned.",
        input: z.strictObject({}),
        run: async () => ({ text: `EUR available ${f.eurAvailable} (floor ${f.eurFloor}, obligations ${f.eurObligations}); USD available ${f.usdAvailable} (floor ${f.usdFloor}). After the payment as planned: EUR free ${f.after.eurFree}, USD ${f.after.usdAvailable}.` }),
      },
      {
        name: "read_quote", description: "The locked FX quote for the shortfall, if any, and how long it is valid.",
        input: z.strictObject({}),
        run: async () => ({ text: f.quote
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
        run: async (a: { timing: "pay_now" | "wait_until"; date: string | null; reason: string }) => {
          if (a.reason.trim().length < 20) return { text: "Not recorded: give the CFO a reason in a sentence.", blocked: "advice bounds" };
          if (a.timing === "wait_until") {
            if (earliest > latest) return { text: `Not recorded: the invoice is due ${f.dueDate}; with two days for SWIFT there is no time to wait. Advise pay_now or say why not.`, blocked: "advice bounds" };
            if (!a.date || a.date < earliest || a.date > latest) return { text: `Not recorded: a wait must end between ${earliest} and ${latest} (two days before the due date ${f.dueDate}, not today).`, blocked: "advice bounds" };
          } else if (a.date !== null) return { text: "Not recorded: pay_now takes no date; leave it null.", blocked: "advice bounds" };
          timing = a.timing; date = a.timing === "wait_until" ? a.date : null; reason = a.reason.trim().slice(0, 500);
          return { text: "Your advice is beside the proposal on the CFO's phone.", final: true };
        },
      },
    ],
  }, client);
  const source = timing ? "claude" : "fallback";
  if (timing) audit(db, "treasury", "licence.timing_advised", f.proposalId, { proposal_id: f.proposalId, timing, date, reason, source, model: run.model, invoice_no: f.invoiceNo });
  return { source, timing, date, reason, run };
}
