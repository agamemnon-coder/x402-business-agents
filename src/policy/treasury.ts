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

/** The buffer on the highest SWIFT fee Airwallex has charged, so a payment never comes up short (Max, 2 November). */
export const SWIFT_FEE_BUFFER = 1.25;

/**
 * What to reserve for the SWIFT fee: the highest fee Airwallex really charged plus 25%, rounded up, and never less
 * than the ceiling (Airwallex does not quote the fee in advance). Measured in the sandbox: EUR 13.41 to 13.48.
 */
export function feeReserveCents(measuredFeesCents: readonly number[]): number {
  const highest = measuredFeesCents.reduce((m, c) => Math.max(m, c), 0);
  return Math.max(SWIFT_FEE_MAX_EUR_CENTS, Math.ceil(highest * SWIFT_FEE_BUFFER));
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
export function planInvoice(invoiceEurCents: number, s: TreasuryState, feeReserve = SWIFT_FEE_MAX_EUR_CENTS): InvoicePlan {
  if (!Number.isSafeInteger(invoiceEurCents) || invoiceEurCents <= 0) throw new Error(`bad invoice amount: ${invoiceEurCents}`);
  if (!Number.isSafeInteger(feeReserve) || feeReserve < SWIFT_FEE_MAX_EUR_CENTS) throw new Error(`bad fee reserve: ${feeReserve}`);
  const need = invoiceEurCents + feeReserve;
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
