// The Payer agent on the runner (KIT11_AP_AGENTS=on): once an invoice is ready, Claude proposes how and when it is
// paid (the rail, the day, the currency it is paid from) with its own tools, and code enforces the boundary. The
// agent, its tools and the boundary are src/ap/payerCore.ts, which a Worker runs too; this module runs that core
// through the runner's loop (src/agents/loop.ts: its cost caps, the client's timeout, one nudge when the agent stops
// without proposing) and writes the decision row. The engine has planned the payment first, as always (the route, the
// fee reserve, the floors, a locked quote for a shortfall): the agent proposes on that very plan (payerGate), so what
// it reasons about is what the CFO would sign. Code then decides: a proposal that breaks a floor is held, one for a
// later day is not filed today, and anything else is filed for the CFO's Face ID on the engine's exact terms. When
// Claude is unavailable, over its cost cap or does not propose, code's own plan stands, labelled as the fallback.

import type Anthropic from "@anthropic-ai/sdk";
import type { Json } from "@metalntwx/metal-pay/mandates";
import type { z } from "zod";
import { runAgent, type AgentRun, type AgentTool } from "../agents/loop.js";
import { audit } from "../audit/log.js";
import { claudeClient } from "../claude/reader.js";
import { COMPANY } from "../config/brand.js";
import type { DB } from "../db/open.js";
import type { GateAnswer, PlanGate, PlannedPayment } from "../payouts/planGate.js";
import { parseOrigin } from "../provenance/origin.js";
import { runProvenance, type RunProvenance } from "./agentRun.js";
import { apInvoice } from "./store.js";
import {
  answerPayerTool, enforceProposal, fallbackProposal, PAYER_EFFORT, PAYER_MODEL, PAYER_MAX_TURNS, PAYER_SYSTEM, PAYER_UNFINISHED, payerInputs, payerPrompt, payerTools, railFromRoute,
  type EnforcedProposal, type PaymentCase, type PaymentProposal, type PayerToolName,
} from "./payerCore.js";

/** The agent's name in the audit chain, and the row its proposal is recorded in. */
export const PAYER_AGENT = "payer" as const;
export const PAYER_DECISION = "ap.payer_proposed";
/** The model the runner gives the Payer: the core's, chosen by the live eval (src/ap/payerCore.ts PAYER_MODEL). */
export const PAYER_RUNNER_MODEL: string = PAYER_MODEL;
/** The finding an invoice carries while the Payer's day for it is still to come. */
export const PAY_LATER = "payment_planned_later";

/** What follows from the enforced proposal: filed for the CFO today, left for the day the agent named, or held. */
export type PayerNext = "file_for_cfo" | "pay_later" | "hold";

export interface PayerOutcome {
  /** Who proposed: Claude, or code's own plan when Claude was unavailable or did not propose. */
  source: "claude" | "fallback";
  proposal: PaymentProposal;
  enforced: EnforcedProposal;
  /** Whether code stopped what Claude proposed (a hold). Sending it to the CFO is the rule for every payment, not an override. */
  overridden: boolean;
  next: PayerNext;
  run: AgentRun;
  task: string;
  provenance: RunProvenance;
}

export interface PayerOptions {
  /** The run's name in the audit chain ("ap.pay.<invoice>"). */
  task: string;
  /** The Claude client; null: no key, so code's plan stands. Default: the runner's own (KIT11_ANTHROPIC_API_KEY). */
  claude?: Anthropic | null;
  model?: string;
}

/** What the agent is told when it proposes a second time: its first proposal stands. */
export const ALREADY_PROPOSED = "Not recorded: your proposal is already recorded, and the first one stands. Nothing more was done.";

/** Runs the Payer on a case and enforces what it proposed (enforceProposal: the rail, the day, the floors, the limit). */
export async function runPayer(db: DB, c: PaymentCase, opts: PayerOptions): Promise<PayerOutcome> {
  let proposed: PaymentProposal | null = null;
  const describe = new Map(payerTools.map((t) => [t.name, t.description]));
  const tools = (Object.keys(payerInputs) as PayerToolName[]).map((name): AgentTool<z.ZodType> => ({
    name, description: describe.get(name)!, input: payerInputs[name],
    run: async (input) => {
      // The first proposal recorded is the agent's answer (review round 1: of two in one turn, the last one counted).
      if (name === "propose_payment" && proposed) return { text: ALREADY_PROPOSED, blocked: "already proposed" };
      const a = answerPayerTool(c, { name, input });
      if (a.proposal) proposed = a.proposal;
      return { text: a.text, ...(a.blocked ? { blocked: a.blocked } : {}), ...(a.final ? { final: true } : {}) };
    },
  }));
  const run = await runAgent(db, {
    agent: PAYER_AGENT, task: opts.task, model: opts.model ?? PAYER_RUNNER_MODEL, system: PAYER_SYSTEM, prompt: payerPrompt(c),
    maxTurns: PAYER_MAX_TURNS, effort: PAYER_EFFORT, unfinished: () => (proposed ? null : PAYER_UNFINISHED), tools,
  }, opts.claude === undefined ? claudeClient() : opts.claude);
  const own = proposed as PaymentProposal | null;
  const source = own ? "claude" : "fallback";
  const { source: _label, ...plan } = fallbackProposal(c);
  const proposal = own ?? plan;
  const enforced = enforceProposal(c, proposal);
  const next: PayerNext = enforced.outcome === "hold" || !enforced.terms ? "hold" : enforced.terms.pay_on > c.today ? "pay_later" : "file_for_cfo";
  const provenance = runProvenance(db, PAYER_AGENT, opts.task, run, source === "claude", "the engine's own payment plan stands (the Payer agent was unavailable or did not propose)");
  return { source, proposal, enforced, overridden: source === "claude" && next === "hold", next, run, task: opts.task, provenance };
}

/**
 * The payment case of a plan the engine worked out: the same balances, floors, fee reserve and quote, and the one
 * rail the supplier's account on file is paid by. No payment is made without the CFO's Face ID, so the agent has no
 * limit to pay alone, and the CFO's policy has no rule that allows paying after the due date.
 */
export function paymentCase(plan: PlannedPayment, about: { invoiceId: string | null; invoiceNo: string; today: string }): PaymentCase {
  return {
    invoice: { id: about.invoiceId, invoiceNo: about.invoiceNo, payee: plan.payee, iban: plan.account, amount: plan.amount, currency: plan.currency, dueDate: plan.due_date },
    company: { name: process.env.KIT11_COMPANY ?? COMPANY },
    balances: plan.balances,
    spokenFor: plan.spoken_for,
    policy: { aloneLimit: null, cashFloors: plan.floors, payLate: null },
    rails: [railFromRoute({ method: plan.method, currency: plan.currency, ...(plan.clearing ? { clearing: plan.clearing } : {}) }, plan.fee_reserve)],
    fx: plan.quote && { quoteId: plan.quote.quote_id, sellCurrency: plan.quote.sell_currency, sellAmount: plan.quote.sell_amount, buyCurrency: plan.quote.buy_currency, buyAmount: plan.quote.buy_amount, rate: plan.quote.client_rate, validTo: plan.quote.valid_to },
    today: about.today,
  };
}

/** The decision row: who proposed, the agent's reason, the enforced outcome with code's reason, and what follows. */
export function recordProposed(db: DB, about: { invoiceId: string; invoiceNo: string }, out: PayerOutcome, now: Date, extra: Record<string, Json> = {}): void {
  audit(db, PAYER_AGENT, PAYER_DECISION, about.invoiceId, {
    invoice_id: about.invoiceId, invoice_no: about.invoiceNo, source: out.source, model: out.source === "claude" ? out.run.model : null,
    rail: out.proposal.rail, pay_on: out.proposal.pay_on, pay_currency: out.proposal.pay_currency, reason: out.proposal.reason,
    outcome: out.enforced.outcome, overridden_by: out.enforced.overridden_by, overridden: out.overridden, why: out.enforced.why, next: out.next,
    terms: out.enforced.terms as unknown as Json,
    task: out.task, run_id: out.provenance.run_id, request_ids: out.provenance.request_ids, origin: out.provenance.origin as Json | null,
    ...(out.run.note ? { note: out.run.note } : {}),
    ...extra,
  }, now);
}

/**
 * The gate the engine's plan passes with KIT11_AP_AGENTS=on (src/payouts/planGate.ts). The Payer proposes on the plan;
 * code enforces it; the decision row is written; and the plan is filed for the CFO only when the enforced proposal
 * pays today on the plan's own route and funding. `last()` is what the gate decided, or null when the engine stopped
 * before the plan reached it.
 */
export function payerGate(db: DB, about: { invoiceId: string; invoiceNo: string; now: Date; claude?: Anthropic | null; planStands?: boolean }): { gate: PlanGate; last(): PayerOutcome | null } {
  let last: PayerOutcome | null = null;
  // The invoice as the pay call found it: ready, with the proposal it had (none).
  const before = apInvoice(db, about.invoiceId);
  const gate: PlanGate = async (plan): Promise<GateAnswer> => {
    const c = paymentCase(plan, { invoiceId: about.invoiceId, invoiceNo: about.invoiceNo, today: about.now.toISOString().slice(0, 10) });
    const out = await runPayer(db, c, { task: `ap.pay.${about.invoiceId}`, ...(about.claude !== undefined ? { claude: about.claude } : {}) });
    last = out;
    const who = out.source === "claude" ? "the Payer agent's proposal" : "code's own plan (the Payer agent was unavailable)";
    const terms = out.enforced.terms;
    const off = out.next === "hold" || !terms ? `${who} is held by code: ${out.enforced.why}`
      : out.next === "pay_later" ? `the Payer agent plans to pay it on ${terms.pay_on}, not today: ${out.proposal.reason} Nothing is filed for the CFO until then; pay it again on or after that day`
      // The terms the CFO signs are the engine's: the enforced proposal must be for that route and that funding.
      : terms.method !== plan.method || (terms.conversion !== null) !== (plan.quote !== null) ? `${who} does not match the engine's plan (${plan.method}${plan.quote ? ", with a conversion" : ""}), so nothing is filed`
      : null;
    // The cloud engine (task A6, 12 Nov): the agent may only propose within code's plan. Where its proposal is held or
    // off the plan, code's own plan stands and goes to the CFO's Face ID, labelled as code's: an agent never dead-ends Pay.
    recordProposed(db, about, out, about.now, off && about.planStands ? { plan_stands: true, plan_stands_why: off.slice(0, 600) } : {});
    if (off && !about.planStands) return { go: false, reason: off };
    // While the agent worked, a person may have rejected or held the invoice, or it was filed by another call (review
    // round 1, 12 Nov: a rejection made during the run was overwritten by "waiting_cfo"). Read again, with nothing
    // awaited between this answer and the filing (src/payouts/plan.ts), so a moved invoice is never filed.
    const current = apInvoice(db, about.invoiceId);
    if (!current || current.status !== "ready" || current.proposal_id !== (before?.proposal_id ?? null)) {
      return { go: false, reason: `the invoice is ${current ? current.status.replace(/_/g, " ") : "gone"} now, no longer ready as when the Payer agent started, so nothing is filed` };
    }
    // Code's own plan, under code's rule (the reason is in the decision row above; an origin's rule is at most 200 characters).
    if (off) return { go: true, origin: parseOrigin(JSON.stringify({ actor: "code", rule: "the engine's own plan stands: the Payer agent's proposal was held or off the plan", agent: PAYER_AGENT })) };
    return { go: true, origin: out.provenance.origin };
  };
  return { gate, last: () => last };
}
