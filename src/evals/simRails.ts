// D26: the stand-ins for the only calls the variation test's simulated rails replace: Metal testnet and the Airwallex
// sandbox. Everything else (Purser's checks before signing, the holds, the buy-policy check, the dispute and refund
// gates, the invoice and fraud checks, the matching of money in) is the real code. Each stand-in answers the way the
// real rail answered in an earlier run; the source of each answer is named next to it, so a reviewer can check it.

import { createHash } from "node:crypto";
import type { AirwallexRail, Balance, MarketRate, Quote } from "../airwallex/port.js";
import type { Puller } from "../metal/pull.js";
import { SANDBOX_SWIFT_FEE_CENTS } from "../redteam/airwallex.js";
import { PLANS } from "../config/policy.js";

/** A deterministic stand-in transaction hash (never a real one): `0x` + 64 hex, from what it pays. */
export const simTx = (...parts: (string | number)[]) => `0x${createHash("sha256").update(`sim:${parts.join(":")}`).digest("hex")}`;

/** The addresses of the simulated world. Not keys: nothing here can sign. */
export const SIM_ADDR = {
  business: "0x5100000000000000000000000000000000000b01",
  customer: "0x5100000000000000000000000000000000000c01",
  stockline: "0x5100000000000000000000000000000000000501",
  ridgeline: "0x5100000000000000000000000000000000000502",
  /** The stand-in third supplier: not one of the Sourcing mandate's payees. */
  third: "0x5100000000000000000000000000000000000503",
  sweep: "0x5100000000000000000000000000000000000d01",
} as const;

/** The business account's float on simulated Metal: bootstrap moves 20.00 in (src/cli/bootstrap.ts, "the business owner moves 20.00 to its account"). */
export const SIM_BUSINESS_FLOAT_CENTS = 2000;

export interface RailSource { what: string; answer: string; source: string }

/** Where each stand-in's answer comes from (also written into every result file). */
export const RAIL_SOURCES: RailSource[] = [
  { what: "Metal: a purchase over the Sourcing mandate's cap", answer: "refused before signing by Purser's own check (`mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment`); Metal never sees it, nothing moves", source: "docs/runs/2026-10-31-dry-run.md (stock check #41), docs/runs/draaiboek-live-run.md step 3 (Metal QA, 1 November); the text is src/policy/holds.ts reserveSpend's own, which the sim runs" },
  { what: "Metal: a purchase within the cap", answer: "paid on chain, one transfer per purchase (tx hash recorded)", source: "docs/runs/2026-11-01-autonomy-dry-96-97.md (dry-97: Sourcing bought from Ridgeline within its 0.03 cap)" },
  { what: "Ridgeline Data unavailable", answer: "no offer before any payment (`supplier_unavailable: Ridgeline Data made no offer for stock check #N`)", source: "src/config/suppliers.ts (an outage costs nothing) and src/agents/sourcing.ts buyUnder" },
  { what: "Metal: a refund pull under the Support mandate", answer: "PAID with a tx; a second pull of the same payment id answers \"already paid, nothing sent\"", source: "docs/runs/2026-11-01-autonomy-dry-96-97.md (dry-97: #7, #10, #13 refunded, 0.15 *USDZ); src/executors/refunds.ts header" },
  { what: "Metal: the business account's balance (read by planSweep)", answer: "20.00 moved in at bootstrap, plus sales, less upstream purchases, refunds and sweeps", source: "src/cli/bootstrap.ts (the business owner moves 20.00 to its account); the ledger's own rows" },
  { what: "Metal: the Treasury sweep", answer: "paid to the sweep wallet after finality, the credit booked at Airwallex", source: "docs/runs/2026-11-01-autonomy-dry-96-97.md (dry-100: Treasury swept 0.09, final, booked)" },
  { what: "Airwallex: Packwise Pro, 45.00 EUR on a card with a 30.00 EUR per-purchase limit", answer: "declined, `LIMIT_EXCEEDED`; approved once the limit is 50.00", source: "docs/runs/2026-10-29-cards.md (15:54 declined LIMIT_EXCEEDED; 17:31:58 approved at 50.00)" },
  { what: "Airwallex: SWIFT fee on a EUR payout", answer: `EUR ${(SANDBOX_SWIFT_FEE_CENTS / 100).toFixed(2)} charged (a PAID transfer on record), the ceiling stays 20.00`, source: "the live sandbox this week (branch night-batch): 13.39 to 13.40 in the 2026-11-02 calibration (docs/runs/variation/2026-11-02/live-logs/dry-142.txt to dry-155.txt), 13.36 in dry-141, 13.37 in agent run 1 (P-0007, docs/runs/2026-11-02-agent-run-1.md); 13.47 on 2026-10-29 (docs/runs/2026-10-29-s3.md) was the stand-in's value before" },
  { what: "Airwallex: FX quote USD to EUR", answer: "370.00 EUR for 416.92 USD (client rate 1.126811)", source: "docs/runs/airwallex-readback.json (conversion 0650049f…, SETTLED)" },
  { what: "Airwallex: a retailer's deposit into the EUR Global Account", answer: "exact: MATCHED; short: SHORT by the difference, the rest stays open; no invoice in the reference: UNMATCHED, held in suspense", source: "docs/runs/2026-10-30-receivables.md (NW-R-101 matched, nw-r-103 short by 10.00, \"Payment\" unmatched)" },
];

/** The refund pull on simulated Metal: paid once per payment id; a repeat is "already paid" (the real metal-agent's answer). */
export function simPull(seed: number, pulls: Map<string, number>): Puller {
  return async (a) => {
    const n = (pulls.get(a.paymentId) ?? 0) + 1;
    pulls.set(a.paymentId, n);
    return { outcome: "PAID", tx: simTx(seed, a.paymentId), reason: null, already: n > 1 };
  };
}

/** Airwallex's answer to a card charge: over the per-purchase limit, LIMIT_EXCEEDED (docs/runs/2026-10-29-cards.md). */
export function simCardCharge(amountCents: number, card: { perTxCents: number; monthlyCents: number }): { approved: boolean; failureReason: string | null } {
  if (amountCents > card.perTxCents || amountCents > card.monthlyCents) return { approved: false, failureReason: "LIMIT_EXCEEDED" };
  return { approved: true, failureReason: null };
}
export const PRO_PLAN_CENTS = PLANS["packwise-pro"]!.amountCents;

/** The stand-in's SWIFT fee (SANDBOX_SWIFT_FEE_CENTS, sources there): written into the sim's ledger as an earlier PAID transfer. */
export const SWIFT_FEE_EUR = (SANDBOX_SWIFT_FEE_CENTS / 100).toFixed(2);
/** The real conversion's rate (docs/runs/airwallex-readback.json: 370 EUR for 416.92 USD). */
const RATE = 416.92 / 370;

/**
 * The Airwallex calls planning an invoice makes (balances, the market rate, a locked quote), answered as the sandbox
 * did. The rest of the port is never reached while planning; reaching it is an error, so nothing pays in the sim.
 */
export function simAirwallex(balances: { eurCents: number; usdCents: number }): AirwallexRail {
  const bal = (c: number): Balance => ({ availableCents: c, pendingCents: 0, reservedCents: 0 });
  const rate = (buyAmountCents: number): MarketRate => ({ rate: RATE.toFixed(6), sellAmountCents: Math.ceil(buyAmountCents * RATE), at: new Date().toISOString() });
  const port: Partial<AirwallexRail> = {
    balances: async () => ({ EUR: bal(balances.eurCents), USD: bal(balances.usdCents) }),
    currentRate: async (a) => rate(a.buyAmountCents),
    createQuote: async (a): Promise<Quote> => {
      const now = Date.now();
      return { quoteId: `sim-quote-${a.buyAmountCents}`, buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents, sellAmountCents: Math.ceil(a.buyAmountCents * RATE), clientRate: RATE.toFixed(6), validFrom: new Date(now).toISOString(), validTo: new Date(now + 15 * 60_000).toISOString() } as Quote;
    },
  };
  return new Proxy(port as AirwallexRail, {
    get: (t, k) => (k in t ? t[k as keyof AirwallexRail] : () => { throw new Error(`the sim's Airwallex has no ${String(k)}: nothing pays in a simulated world`); }),
  });
}
