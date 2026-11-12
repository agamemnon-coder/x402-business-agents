// "Finance this invoice" (master list 685), inside the token flow, not a separate agent. The steps:
//   1. a tokenized invoice (its token record says minted, not yet financed or settled) offers the action;
//   2. a proposal: discount, advance, cost and settlement date, computed in whole cents;
//   3. the CFO approves exactly those terms with Face ID, through the existing approval flow (createProposal, then the
//      phone's passkey over the terms hash, the same pattern as a limit raise);
//   4. the token goes to the financier: through beginExecution, which refuses terms that no longer hash to the signed
//      hash, so an advance changed after signing is refused before anything is sent.
//
// The financier is simulated on testnet, and the terms and every label say "Simulated financier (testnet)". The terms
// of the offer and the credit check come from the agents-rails stream (src/tokenize/financeProposal.ts), which has not
// landed yet: until it does they are read through FinanceSource, whose local default is a fixed discount from config
// and says plainly that no credit check was made.

import type { DB } from "../../src/db/open.js";
import { fromCents } from "../../src/lib/money.js";
import { termsHash, TERMS_SCHEMA, type Terms } from "../../src/lib/terms.js";
import { financingTerms, SIMULATED_FINANCIER } from "../../src/ledger/financing.js";
import { beginExecution, createProposal, finishExecution, type ProposalRow } from "../../src/policy/approvals.js";
import type { TokenStatus } from "./tokenStatus.js";

export const FINANCE_KIND = "token_financing";

/** The invoice behind a token, as the token record and the ledger give it. */
export interface TokenizedInvoice {
  invoice_no: string;
  /** The token id on chain (the document hash), from the token record. */
  token_id: string;
  currency: string;
  face_cents: number;
  /** The settlement date: the invoice's due date, YYYY-MM-DD. */
  due_date: string;
  document_sha256: string;
}

/** Where the offer's terms and the credit check come from. */
export interface FinanceSource {
  readonly name: string;
  offer(inv: TokenizedInvoice): { discount_bps: number; credit_check: { done: boolean; ok: boolean; note: string } };
}

/** The local default: a fixed discount from config (FINANCE_DISCOUNT_BPS, default 200 = 2%), no credit check. */
export function localFinanceSource(env: Record<string, string | undefined> = {}): FinanceSource {
  const raw = env.FINANCE_DISCOUNT_BPS ?? "200";
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > 9_999) throw new Error("FINANCE_DISCOUNT_BPS is 1 to 9999 basis points");
  const bps = Number(raw);
  return {
    name: "local default (fixed discount from config)",
    offer: () => ({ discount_bps: bps, credit_check: { done: false, ok: true, note: "no credit check: the local default only fixes the discount" } }),
  };
}

/** Whether the action may be offered: a token was minted and is neither financed nor settled. */
export function canFinance(status: TokenStatus | null): boolean {
  if (!status) return false;
  const done = (s: string) => status.steps.find((x) => x.step === s)?.done === true;
  return done("signed") && done("tokenized") && !done("financed") && !done("settled");
}

export interface FinanceTerms extends Terms {
  kind: typeof FINANCE_KIND;
  invoice_no: string;
  token_id: string;
  document_sha256: string;
  currency: string;
  face_value: string;
  discount_bps: string;
  advance: string;
  cost: string;
  settlement_date: string;
  financier: typeof SIMULATED_FINANCIER;
  terms_source: string;
  credit_check: string;
}

/** The proposal's terms, every amount computed in whole cents from the face value and the discount. */
export function financeTerms(inv: TokenizedInvoice, source: FinanceSource, proposalId: string, expiresAt: string): FinanceTerms {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.due_date)) throw new Error(`not a settlement date: ${inv.due_date}`);
  const offer = source.offer(inv);
  const t = financingTerms(inv.face_cents, offer.discount_bps);
  return {
    schema: TERMS_SCHEMA, kind: FINANCE_KIND, proposal_id: proposalId, expires_at: expiresAt,
    invoice_no: inv.invoice_no, token_id: inv.token_id, document_sha256: inv.document_sha256, currency: inv.currency,
    face_value: fromCents(t.face_cents), discount_bps: String(t.discount_bps), advance: fromCents(t.price_cents), cost: fromCents(t.discount_cents),
    settlement_date: inv.due_date, financier: SIMULATED_FINANCIER, terms_source: source.name, credit_check: offer.credit_check.note,
  };
}

export class FinanceRefused extends Error {
  constructor(message: string) { super(message); this.name = "FinanceRefused"; }
}

/** Files the proposal for the CFO's Face ID. Refused when the token is not ready to finance or the credit check says no. */
export function proposeFinancing(db: DB, inv: TokenizedInvoice, status: TokenStatus | null, source: FinanceSource, now = new Date(), ttlMs = 20 * 60_000): { proposal: ProposalRow; terms: FinanceTerms; terms_sha256: string } {
  if (!canFinance(status)) throw new FinanceRefused(`${inv.invoice_no} cannot be financed now: its token record does not show it minted and still unfinanced`);
  const offer = source.offer(inv);
  if (offer.credit_check.done && !offer.credit_check.ok) throw new FinanceRefused(`${inv.invoice_no}: the credit check said no (${offer.credit_check.note})`);
  const expires = new Date(Math.floor((now.getTime() + ttlMs) / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const terms = financeTerms(inv, source, "P-0000", expires);
  const proposal = createProposal(db, { terms, createdBy: "treasury", assignId: true, explanation: `Finance ${inv.invoice_no} with the ${SIMULATED_FINANCIER.toLowerCase()}` }, now);
  return { proposal, terms: JSON.parse(proposal.terms_json) as FinanceTerms, terms_sha256: proposal.terms_sha256 };
}

/** Sends the token to the (simulated) financier: the transfer is the caller's (the token flow's), given the signed terms. */
export type SendToFinancier = (terms: FinanceTerms) => Promise<{ tx_hash: string }>;

/**
 * Runs an approved financing: the terms are checked against the signed hash first (beginExecution), so a changed
 * advance is refused and nothing is sent. Returns the transaction the token flow reports.
 */
export async function executeFinancing(db: DB, proposalId: string, send: SendToFinancier, now = () => new Date()): Promise<{ tx_hash: string; terms_sha256: string }> {
  const terms = beginExecution<FinanceTerms>(db, proposalId, (t) => {
    if (t.kind !== FINANCE_KIND) throw new FinanceRefused(`${proposalId} is not a financing proposal`);
    if (t.financier !== SIMULATED_FINANCIER) throw new FinanceRefused(`${proposalId} names a financier this flow does not send to`);
  }, now());
  const sha = termsHash(terms);
  try {
    const r = await send(terms);
    finishExecution(db, proposalId, "EXECUTED", { tx_hash: r.tx_hash, financier: SIMULATED_FINANCIER }, now());
    return { tx_hash: r.tx_hash, terms_sha256: sha };
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message.slice(0, 300) }, now());
    throw e;
  }
}

/** What the proposal card shows: result first (the advance), then cost and date, the label next to the financier. */
export function proposalCard(t: FinanceTerms): { advance: string; cost: string; discount: string; settlement_date: string; currency: string; financier: string; source: string; credit_check: string } {
  return { advance: t.advance, cost: t.cost, discount: `${Math.floor(Number(t.discount_bps) / 100)}.${String(Number(t.discount_bps) % 100).padStart(2, "0")}%`, settlement_date: t.settlement_date, currency: t.currency, financier: t.financier, source: t.terms_source, credit_check: t.credit_check };
}
