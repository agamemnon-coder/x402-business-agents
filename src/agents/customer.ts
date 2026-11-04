// Summit Outfitters' agent, simulated: another company buying our stock checks.
// With a clearing deposit it buys on the prepaid route (Metal clearing: a signed receipt, no transaction per query);
// whenever clearing cannot take the payment and nothing was paid, it falls back to the mandate route (exact, a
// transfer per query under its mandate, with a signed order), so a sale never depends on the new scheme working.
// It keeps nothing of ours.

import type { Address } from "viem";
import { registerClearingClient } from "@metalntwx/metal-pay";
import { createMandatePaymentClient } from "@metalntwx/metal-pay/mandates";
import { activeMandate, type LoadedMandate } from "../metal/mandate.js";
import { findSettlementByNonce, payUnderMandate, type PayOutcome } from "../metal/pay.js";
import { NETWORK, betweenEpochs, customerClearingClient, outcomeUnknown } from "../metal/clearing.js";
import { PREPAID_ROUTE, SELLER_ROUTE } from "../servers/seller.js";

export type Purchase = { seq: number; via: "mandate"; outcome: PayOutcome; charged?: boolean; fallbackFrom?: string };
export type PrepaidPurchase = Purchase | { seq: number; via: "clearing"; status: number; body: string; charged: boolean };

/** Why clearing was not used, when nothing was paid; null when the outcome is clearing's to report. */
export type ClearingAttempt = { kind: "paid" | "owed"; status: number; body: string } | { kind: "unused"; reason: string } | { kind: "in_doubt"; reason: string };

export interface CustomerOptions {
  /** Most a single clearing payment may be, in *USDZ base units (the price is 0.07). */
  maxUnits?: bigint;
  /** How often to send a request again while the clearing service is between epochs. */
  epochRetries?: number;
  /** How often to send the same request again when an earlier payment's answer was lost (Metal resolves it then). */
  resends?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class CustomerAgent {
  private mandate: LoadedMandate | undefined;

  constructor(private readonly sellerBase: string, private readonly seller: Address, private readonly opts: CustomerOptions = {}) {}

  /** Pays from the clearing deposit on the prepaid route; when clearing cannot take it and nothing was paid, on the mandate route. */
  async buyPrepaid(seq: number): Promise<PrepaidPurchase> {
    const c = await this.tryClearing(seq);
    // A clearing payment whose answer was lost may have been counted: never pay the same stock check a second way.
    if (c.kind === "in_doubt") return { seq, via: "clearing", status: 0, body: c.reason, charged: true };
    if (c.kind !== "unused") return { seq, via: "clearing", status: c.status, body: c.body, charged: true };
    return { ...(await this.buy(seq)), fallbackFrom: c.reason };
  }

  /** Pays on the mandate route: an exact transfer under Summit's mandate, with its signed order. */
  async buy(seq: number): Promise<Purchase> {
    this.mandate ??= await activeMandate("customer");
    const since = Date.now() - 60_000;
    const outcome = await payUnderMandate(this.mandate, `${this.sellerBase}${SELLER_ROUTE}?seq=${seq}`);
    if (outcome.kind !== "in_doubt") return { seq, via: "mandate", outcome, charged: outcome.kind === "paid" };
    // The seller answered with an error and no settlement. The facilitator's public list says whether it settled.
    const found = await findSettlementByNonce(this.seller, outcome.nonce, since);
    return { seq, via: "mandate", outcome, charged: found !== undefined };
  }

  /** One prepaid purchase from the clearing deposit. */
  async tryClearing(seq: number): Promise<ClearingAttempt> {
    let opened: Awaited<ReturnType<typeof customerClearingClient>>;
    try {
      opened = await customerClearingClient(this.opts.maxUnits ?? 10n ** 17n);
    } catch (e) {
      return { kind: "unused", reason: `clearing is not available: ${(e as Error).message.slice(0, 160)}` };
    }
    try {
      this.mandate ??= await activeMandate("customer");
      // The mandate client carries the customer's exact scheme too, but the prepaid route offers only clearing.
      const paying = createMandatePaymentClient({ credential: this.mandate.credential, signDigest: this.mandate.signDigest, network: "testnet" });
      registerClearingClient(paying.client, NETWORK, opened.client);
      const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      const url = `${this.sellerBase}${PREPAID_ROUTE}?seq=${seq}`;
      for (let attempt = 0, resends = 0; ; attempt++) {
        let res: Response;
        try {
          res = await paying.fetchWithPayment(url, { signal: AbortSignal.timeout(60_000) });
        } catch (e) {
          if (betweenEpochs(e) && attempt < (this.opts.epochRetries ?? 8)) {
            await sleep(3000);
            continue;
          }
          // The same request again, never a new one: the wallet resolves the held payment and pays at most once.
          if (outcomeUnknown(e) && resends < (this.opts.resends ?? 5)) {
            resends++;
            await sleep(3000);
            continue;
          }
          const reason = (e as Error).message.slice(0, 240);
          // Only these say nothing was paid; anything else (a held payment, a lost answer) may have been counted.
          if (betweenEpochs(e) || /insufficient|deposit|not offered|no clearing/i.test(reason)) return { kind: "unused", reason };
          return { kind: "in_doubt", reason };
        }
        const body = await res.text();
        if (res.ok) return { kind: "paid", status: res.status, body };
        // 503 before any offer: the seller does not offer clearing for this stock check now (nothing was paid).
        if (res.status === 503 && !res.headers.get("payment-response") && /not offered/.test(body)) return { kind: "unused", reason: body.slice(0, 240) };
        if (res.status === 402) return { kind: "unused", reason: `the prepaid route asked for payment again: ${body.slice(0, 160)}` };
        // Paid, then the seller could not deliver: owed, and support refunds it.
        return { kind: "owed", status: res.status, body };
      }
    } finally {
      await opened.wallet.close();
    }
  }
}
