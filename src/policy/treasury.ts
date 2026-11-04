// Euro-bill planning (scenario S3). Pure functions over balances the caller has just read.
// Only available amounts count: pending conversions, reserved payouts and unfinalised sweeps never do.

import { SWIFT_FEE_MAX_EUR_CENTS } from "../config/policy.js";
import { fromCents } from "../lib/money.js";

export interface TreasuryState {
  eurAvailableCents: number;
  eurFloorCents: number;
  /** EUR already committed to other bills in the next 30 days. */
  eurObligationsCents: number;
  usdAvailableCents: number;
  usdFloorCents: number;
  /** EUR payouts written but not yet at Airwallex: not yet out of its available balance, but spoken for. */
  eurInFlightCents?: number;
}

export function freeEurCents(s: TreasuryState): number {
  return s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents - (s.eurInFlightCents ?? 0);
}

export type InvoicePlan =
  | { kind: "underfunded"; needEurCents: number; freeEurCents: number }
  | { kind: "pay_from_eur"; needEurCents: number; freeEurCents: number }
  | { kind: "convert_shortfall"; needEurCents: number; freeEurCents: number; buyEurCents: number };

/**
 * EUR needed is the invoice plus the SWIFT fee ceiling; convert only what free EUR does not cover.
 * If EUR is already below its floor plus commitments, no plan is made: restoring the reserve is a decision of
 * its own, and a plan that ignored the gap would be refused by the executor's check anyway.
 */
export function planInvoice(invoiceEurCents: number, s: TreasuryState): InvoicePlan {
  if (!Number.isSafeInteger(invoiceEurCents) || invoiceEurCents <= 0) throw new Error(`bad invoice amount: ${invoiceEurCents}`);
  const need = invoiceEurCents + SWIFT_FEE_MAX_EUR_CENTS;
  const free = freeEurCents(s);
  if (free < 0) return { kind: "underfunded", needEurCents: need, freeEurCents: free };
  if (free >= need) return { kind: "pay_from_eur", needEurCents: need, freeEurCents: free };
  return { kind: "convert_shortfall", needEurCents: need, freeEurCents: free, buyEurCents: need - free };
}

const signed = (cents: number) => (cents < 0 ? `-${fromCents(-cents)}` : fromCents(cents));

export type QuoteCheck = { ok: true; usdAfterCents: number } | { ok: false; reason: string; usdAfterCents: number };

/** A locked quote is usable only if selling its USD keeps the USD balance at or above its floor. */
export function checkQuoteAgainstFloor(sellUsdCents: number, s: TreasuryState): QuoteCheck {
  const after = s.usdAvailableCents - sellUsdCents;
  if (after < s.usdFloorCents) {
    return { ok: false, usdAfterCents: after, reason: `USD would drop to ${signed(after)}, under its floor of ${fromCents(s.usdFloorCents)}` };
  }
  return { ok: true, usdAfterCents: after };
}

/** A proposal expires at its TTL or 30 s before the quote does, whichever comes first. */
export function proposalExpiry(nowMs: number, ttlMs: number, quoteValidToMs?: number, safetyMs = 30_000): number {
  const byTtl = nowMs + ttlMs;
  return quoteValidToMs === undefined ? byTtl : Math.min(byTtl, quoteValidToMs - safetyMs);
}
