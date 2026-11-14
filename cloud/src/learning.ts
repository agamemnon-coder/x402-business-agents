// The Agents tab's learning (14 Nov): what each agent learns from the CFO's past decisions, from the company's own
// records (src/learning/precedent.ts). In-context learning from signed outcomes: the cases are given to Claude as
// precedent when it decides; no model is trained, and no limit changes without the CFO's Face ID. Every figure is
// counted from the rows; nothing is estimated. Read only.

import {
  calibration, casesFromAudit, centsOf, OUTCOME_WORDS, CATEGORY_WORDS, precedentsFor, suggestions,
  type AuditLike, type Category, type LabelledCase, type ProposalFacts, type SettingNow,
} from "../../src/learning/precedent.js";

interface TxLike { counterparty?: string; amount?: string; currency?: string; approval?: { proposal_id?: string | null } | null; invoice?: { ap_id?: string | null; vendor?: string } | null }
interface InvoiceLike { id: string; vendor: string; total: string; currency: string; proposal_id: string | null }

/** Each proposal's supplier and amount, from the payment that carried it out or the invoice it paid. */
export function factsFrom(txs: readonly TxLike[], invoices: readonly InvoiceLike[]): (ref: string) => ProposalFacts | null {
  const byProposal = new Map<string, ProposalFacts>();
  for (const i of invoices) if (i.proposal_id) byProposal.set(i.proposal_id, { counterparty: i.vendor || null, currency: i.currency || null, amountCents: centsOf(i.total), invoice: i.id });
  for (const t of txs) {
    const p = t.approval?.proposal_id;
    if (p && !byProposal.has(p)) byProposal.set(p, { counterparty: t.counterparty ?? t.invoice?.vendor ?? null, currency: t.currency ?? null, amountCents: centsOf(t.amount), invoice: t.invoice?.ap_id ?? null });
  }
  const byInvoice = new Map(invoices.map((i) => [i.id, { counterparty: i.vendor || null, currency: i.currency || null, amountCents: centsOf(i.total), invoice: i.id }]));
  return (ref) => byProposal.get(ref) ?? byInvoice.get(ref) ?? null;
}

const caseOut = (c: LabelledCase) => ({
  ref: c.ref, at: c.at, counterparty: c.counterparty, amount: c.amountCents !== null && c.currency ? `${c.currency} ${(c.amountCents / 100).toFixed(2)}` : null,
  kind: CATEGORY_WORDS[c.category], outcome: c.outcome, outcome_words: OUTCOME_WORDS[c.outcome], reason: c.reason, invoice: c.invoice,
});

export interface AgentLearning {
  cases: number;
  calibration: { kind: string; category: Category; month: string; last_month: string; this_month: { signed: number; rejected: number; rate: number | null }; last: { signed: number; rejected: number; rate: number | null }; all_time: { signed: number; rejected: number; expired: number; refused: number; overridden: number; rate: number | null } }[];
  suggestions: { key: string | null; from: string | null; to: string | null; text: string; evidence: string[] }[];
}

/**
 * For one agent: its labelled cases, its calibration in `month` and the month before, and the patterns in the CFO's
 * signatures. `precedentOf` gives a decision's precedent: the cases Claude was given (`learned_from`, recorded on the
 * decision row), or else the similar earlier cases the agent would be given next time (`similar`).
 */
export function learningOf(cases: readonly LabelledCase[], agent: string, month: string, settings: readonly SettingNow[], nameOf?: (agent: string) => string): AgentLearning {
  const mine = cases.filter((c) => c.agent === agent);
  const prev = (() => { const [y, m] = month.split("-").map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
  return {
    cases: mine.filter((c) => c.outcome !== "waiting").length,
    calibration: calibration(mine, month).map((r) => ({
      kind: CATEGORY_WORDS[r.category], category: r.category, month, last_month: prev,
      this_month: { signed: r.this_month.signed, rejected: r.this_month.rejected, rate: r.this_month.rate },
      last: { signed: r.last_month.signed, rejected: r.last_month.rejected, rate: r.last_month.rate },
      all_time: { signed: r.all_time.signed, rejected: r.all_time.rejected, expired: r.all_time.expired, refused: r.all_time.refused, overridden: r.all_time.overridden, rate: r.all_time.rate },
    })),
    suggestions: suggestions(mine, settings, nameOf).map((s) => ({ key: s.key, from: s.from, to: s.to, text: s.text, evidence: s.evidence })),
  };
}

/** A decision's precedent, for the Agents tab. */
export function precedentOf(cases: readonly LabelledCase[], row: AuditLike, payload: Record<string, unknown>): { mode: "learned_from" | "similar"; cases: ReturnType<typeof caseOut>[] } | null {
  // Recorded on the decision row: the cases Claude was given when it decided.
  if (Array.isArray(payload.precedents) && payload.precedents.length) {
    const refs = new Set(payload.precedents.filter((x): x is string => typeof x === "string"));
    return { mode: "learned_from", cases: cases.filter((c) => refs.has(c.ref)).map(caseOut) };
  }
  // A proposal: the similar earlier cases, as the agent is given them when it decides on such a case.
  if (row.event !== "proposal.created" || !row.subject) return null;
  const self = cases.find((c) => c.ref === row.subject);
  if (!self) return null;
  const ps = precedentsFor(cases, { agent: self.agent, category: self.category, counterparty: self.counterparty, currency: self.currency, amountCents: self.amountCents, ref: self.ref, invoice: self.invoice, at: row.ts });
  return ps.length ? { mode: "similar", cases: ps.map((p) => ({ ...caseOut(p.case), why: p.why })) } : null;
}

export { casesFromAudit };
