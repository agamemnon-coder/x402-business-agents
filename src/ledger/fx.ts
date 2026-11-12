// Realised FX differences (master list 126). An invoice in a foreign currency is carried at the rate it was booked at;
// when it is paid through a conversion, the functional currency that really left (the conversion's sell amount, in
// money in transit, 1590) differs from that booked value. On settlement the difference is realised: a loss when more
// was paid than booked, a gain when less. One entry in the functional currency, balanced, against 1590 and the FX
// differences account (7900), carrying the CFO's Face ID hash and the rail's id (the Airwallex conversion or transfer).
//
// Integer cents only. The booked value is the foreign amount times the booked rate, rounded half away from zero to a
// whole cent (the one rounding rule here; test/ledger-fx-financing.test.ts holds it with a property test).

import type { DB } from "../db/open.js";
import { FX_DIFFERENCES, MONEY_IN_TRANSIT } from "./accounts.js";
import { LedgerRefused, postEntry, type Posted } from "./core.js";

const RATE = /^\d{1,6}(\.\d{1,8})?$/;

/** `amountCents` of the foreign currency at `rate` (functional units per foreign unit, a decimal string), in whole functional cents. */
export function bookedCents(amountCents: number, rate: string): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new LedgerRefused("an amount is whole cents, not negative");
  if (!RATE.test(rate) || /^0+(\.0+)?$/.test(rate)) throw new LedgerRefused(`not a rate: ${rate}`);
  const [whole, frac = ""] = rate.split(".") as [string, string?];
  const scale = 10n ** BigInt(frac.length);
  const scaled = BigInt(whole) * scale + BigInt(frac || "0");
  const num = BigInt(amountCents) * scaled;
  // Half away from zero (amounts are never negative here, so half up).
  const out = (num * 2n + scale) / (2n * scale);
  // Past 2^53 cents a number is no longer whole cents exactly: refused, never rounded silently.
  if (out > BigInt(Number.MAX_SAFE_INTEGER)) throw new LedgerRefused("the booked value is too large to keep in whole cents");
  return Number(out);
}

export interface FxDifference {
  booked_cents: number;
  paid_cents: number;
  /** paid - booked: above zero a loss, below zero a gain. */
  difference_cents: number;
}

export function fxDifference(foreignCents: number, bookedRate: string, paidCents: number): FxDifference {
  if (!Number.isSafeInteger(paidCents) || paidCents < 0) throw new LedgerRefused("the amount paid is whole cents, not negative");
  const booked = bookedCents(foreignCents, bookedRate);
  return { booked_cents: booked, paid_cents: paidCents, difference_cents: paidCents - booked };
}

export interface FxSettlement {
  date: string;
  doc_ref: string;
  party?: string;
  /** What was settled, in the invoice's own currency. */
  foreign: { currency: string; amount_cents: number };
  /** The functional currency: the rate the invoice was booked at, and what the conversion really sold. */
  functional: { currency: string; booked_rate: string; paid_cents: number };
  /** The CFO's Face ID hash of the payment's terms. */
  approval_sha256: string;
  /** The Airwallex conversion or transfer id. */
  rail_ref: string;
  created_by: string;
  source_key?: string;
}

/** Posts the realised FX difference of a settlement, or returns null when there is none (nothing to post). */
export function postFxDifference(db: DB, s: FxSettlement, now = new Date()): (Posted & FxDifference) | null {
  if (s.foreign.currency === s.functional.currency) throw new LedgerRefused("an FX difference needs two currencies");
  if (!s.approval_sha256 || !s.rail_ref) throw new LedgerRefused("an FX entry carries the approval hash and the rail's id");
  const d = fxDifference(s.foreign.amount_cents, s.functional.booked_rate, s.functional.paid_cents);
  if (d.difference_cents === 0) return null;
  const amount = Math.abs(d.difference_cents);
  const cur = s.functional.currency;
  const loss = d.difference_cents > 0;
  const memo = `${s.foreign.currency} ${s.foreign.amount_cents} cents booked at ${s.functional.booked_rate} (${d.booked_cents} ${cur} cents), paid ${d.paid_cents} ${cur} cents`;
  const posted = postEntry(db, {
    date: s.date, description: `Realised FX ${loss ? "loss" : "gain"} on ${s.doc_ref}`, created_by: s.created_by, source_key: s.source_key ?? `fx-diff:${s.rail_ref}`,
    doc_ref: s.doc_ref, approval_sha256: s.approval_sha256, rail_ref: s.rail_ref,
    lines: loss
      ? [{ account: FX_DIFFERENCES, debit: amount, currency: cur, memo, doc_ref: s.doc_ref, ...(s.party ? { party: s.party } : {}) }, { account: MONEY_IN_TRANSIT, credit: amount, currency: cur, doc_ref: s.doc_ref }]
      : [{ account: MONEY_IN_TRANSIT, debit: amount, currency: cur, doc_ref: s.doc_ref }, { account: FX_DIFFERENCES, credit: amount, currency: cur, memo, doc_ref: s.doc_ref, ...(s.party ? { party: s.party } : {}) }],
  }, now);
  return { ...posted, ...d };
}
