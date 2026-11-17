// The cash check on the agent's own payment (17 Nov, judging: "financial context influences what the agent decides").
// Within the CFO's limit to pay alone, an agent pays an invoice alone only from the invoice's own currency, and only when
// that balance stays at or above its cash floor once the payment and the money already spoken for are out:
//   available = balance − spoken for (bills already committed, payouts in flight and holds: src/policy/available.ts
//               eurInFlightCents)
//   after     = available − (the invoice + the rail's fee reserve)
//   after ≥ floor: the agent may pay it alone; below: held, and nothing is sent. Exactly at the floor is allowed, as in
//   the Payer's boundary (src/ap/payerCore.ts positionOf: only `after < floor` holds).
// Selling another currency to cover the gap is a treasury decision: the engine plans that conversion as before, and the
// CFO signs it with a passkey (src/ap/pay.ts payAlone declines to pay it alone).
//
// No new boundary: the decision is the Payer's own (payerCore enforceProposal) over a case of these figures with no
// conversion offered, so whatever the agent proposes (pay now, any reason), code holds a payment that breaks the floor.

import { fromCents } from "../lib/money.js";
import { plainCents } from "./checkerCore.js";
import { enforceProposal, fallbackProposal, type PayerRule, type PaymentCase, type PaymentProposal } from "./payerCore.js";

/** One currency's position as the treasury reads it: each a two-decimal amount. */
export interface CashPosition {
  currency: string;
  /** What the account holds (the bank's available balance). */
  balance: string;
  /** Bills already committed (the treasury's commitments). */
  committed: string;
  /** Payouts written but not yet at the bank, and money held for payments being made now. */
  inFlight: string;
  /** The balance this currency may not go below. */
  floor: string;
}

export interface CashCheckInput {
  invoice: { id: string | null; invoiceNo: string; payee: string; iban: string; amount: string; currency: string; dueDate: string };
  position: CashPosition;
  /** What the engine holds back for the bank's fee on the rail (two decimals). */
  feeReserve: string;
  aloneLimit: { currency: string; amount: string } | null;
  /** YYYY-MM-DD. */
  today: string;
  /** What the agent proposed; absent: code's own plan (pay today from the invoice's currency). */
  proposal?: PaymentProposal;
  company?: string;
}

/** The financial context of one payment and what code decided, in figures a page shows as they are. */
export interface CashView {
  currency: string;
  balance: string;
  committed: string;
  in_flight: string;
  /** committed + in_flight. */
  spoken_for: string;
  /** balance − spoken_for; "-" first when negative. */
  available: string;
  floor: string;
  amount: string;
  fee_reserve: string;
  /** amount + fee_reserve. */
  need: string;
  /** available − need; "-" first when negative. */
  after: string;
  /** How far below the floor `after` is; "0.00" when it is not. */
  short_by: string;
  due_date: string;
  /** Days from today to the due date; null when the invoice names none. */
  days_to_due: number | null;
  /** pay: the agent may pay it alone now; hold: code holds it, nothing is sent. */
  outcome: "pay" | "hold";
  /** The Payer boundary's rule that holds it (below_floor, not_enough_money, ...), or null. */
  rule: PayerRule | null;
  /** Code's reason, in code's words and numbers. */
  why: string;
  /** Who decided: always Purser's code, whatever was proposed. */
  decided_by: "code";
}

const signed = (cents: number) => (cents < 0 ? `-${fromCents(-cents)}` : fromCents(cents));
const DAY_MS = 86_400_000;

/** The case the Payer's boundary judges: these balances, this floor, one rail, no conversion on offer. */
export function cashCase(i: CashCheckInput): PaymentCase {
  const p = i.position;
  const spoken = (plainCents(p.committed) ?? 0) + (plainCents(p.inFlight) ?? 0);
  return {
    invoice: { ...i.invoice },
    company: { name: i.company ?? "the test company" },
    balances: { [p.currency]: p.balance },
    spokenFor: { [p.currency]: fromCents(Math.max(0, spoken)) },
    policy: { aloneLimit: i.aloneLimit && { ...i.aloneLimit }, cashFloors: { [p.currency]: p.floor }, payLate: null },
    rails: [{ rail: "bank_swift", currency: i.invoice.currency, feeReserve: i.feeReserve }],
    fx: null,
    today: i.today,
  };
}

/**
 * Code's decision on paying this invoice alone now, with the figures behind it. The proposal (the agent's, or code's
 * own plan) goes through enforceProposal: "hold" when the balance would go below its floor or there is not enough.
 * Never throws: figures code cannot read are a hold.
 */
export function cashCheck(i: CashCheckInput): CashView {
  const p = i.position;
  const c = cashCase(i);
  const proposal: PaymentProposal = i.proposal ?? (({ source: _s, ...rest }) => rest)(fallbackProposal(c));
  const enforced = enforceProposal(c, proposal);
  const cents = (s: string) => plainCents(s) ?? 0;
  const spoken = cents(p.committed) + cents(p.inFlight);
  const available = cents(p.balance) - spoken;
  const need = cents(i.invoice.amount) + cents(i.feeReserve);
  const after = available - need;
  const short = Math.max(0, cents(p.floor) - after);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(i.invoice.dueDate) ? i.invoice.dueDate : "";
  const days = due && /^\d{4}-\d{2}-\d{2}$/.test(i.today) ? Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${i.today}T00:00:00Z`)) / DAY_MS) : null;
  const hold = enforced.outcome === "hold";
  return {
    currency: p.currency, balance: p.balance, committed: p.committed, in_flight: p.inFlight, spoken_for: fromCents(Math.max(0, spoken)),
    available: signed(available), floor: p.floor, amount: i.invoice.amount, fee_reserve: i.feeReserve, need: fromCents(Math.max(0, need)),
    after: signed(after), short_by: fromCents(hold ? short : 0), due_date: due, days_to_due: days,
    outcome: hold ? "hold" : "pay", rule: hold ? enforced.overridden_by : null, why: enforced.why, decided_by: "code",
  };
}
