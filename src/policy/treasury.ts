// Euro-bill planning (scenario S3). Pure functions over balances the caller has just read.
// Only available amounts count: pending conversions, reserved payouts and unfinalised sweeps never do.

import { SWIFT_FEE_MAX_EUR_CENTS } from "../config/policy.js";

export interface TreasuryState {
  eurAvailableCents: number;
  eurFloorCents: number;
  /** EUR already committed to other bills in the next 30 days. */
  eurObligationsCents: number;
  usdAvailableCents: number;
  usdFloorCents: number;
}

export function freeEurCents(s: TreasuryState): number {
  return s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents;
}

export type InvoicePlan =
  | { kind: "pay_from_eur"; needEurCents: number; freeEurCents: number }
  | { kind: "convert_shortfall"; needEurCents: number; freeEurCents: number; buyEurCents: number };

/** EUR needed is the invoice plus the SWIFT fee ceiling; convert only what free EUR does not cover. */
export function planInvoice(invoiceEurCents: number, s: TreasuryState): InvoicePlan {
  if (!Number.isSafeInteger(invoiceEurCents) || invoiceEurCents <= 0) throw new Error(`bad invoice amount: ${invoiceEurCents}`);
  const need = invoiceEurCents + SWIFT_FEE_MAX_EUR_CENTS;
  const free = Math.max(0, freeEurCents(s));
  if (free >= need) return { kind: "pay_from_eur", needEurCents: need, freeEurCents: free };
  return { kind: "convert_shortfall", needEurCents: need, freeEurCents: free, buyEurCents: need - free };
}

export type QuoteCheck = { ok: true; usdAfterCents: number } | { ok: false; reason: string; usdAfterCents: number };

/** A locked quote is usable only if selling its USD keeps the USD balance at or above its floor. */
export function checkQuoteAgainstFloor(sellUsdCents: number, s: TreasuryState): QuoteCheck {
  const after = s.usdAvailableCents - sellUsdCents;
  if (after < s.usdFloorCents) {
    return { ok: false, usdAfterCents: after, reason: `USD would drop to ${after} cents, under the ${s.usdFloorCents} cent floor` };
  }
  return { ok: true, usdAfterCents: after };
}

/** A proposal expires at its TTL or 30 s before the quote does, whichever comes first. */
export function proposalExpiry(nowMs: number, ttlMs: number, quoteValidToMs?: number, safetyMs = 30_000): number {
  const byTtl = nowMs + ttlMs;
  return quoteValidToMs === undefined ? byTtl : Math.min(byTtl, quoteValidToMs - safetyMs);
}
