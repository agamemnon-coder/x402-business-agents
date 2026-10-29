// Kestrel Quant's agent, simulated: another company buying our ticks under its own mandate.
// It signs each order (the seller requires it) and keeps nothing of ours.

import type { Address } from "viem";
import { activeMandate, type LoadedMandate } from "../metal/mandate.js";
import { findSettlementByNonce, payUnderMandate, type PayOutcome } from "../metal/pay.js";
import { SELLER_ROUTE } from "../servers/seller.js";

export type Purchase = { seq: number; outcome: PayOutcome; charged?: boolean };

export class CustomerAgent {
  private mandate: LoadedMandate | undefined;

  constructor(private readonly sellerBase: string, private readonly seller: Address) {}

  async buy(seq: number): Promise<Purchase> {
    this.mandate ??= await activeMandate("customer");
    const since = Date.now() - 60_000;
    const outcome = await payUnderMandate(this.mandate, `${this.sellerBase}${SELLER_ROUTE}?seq=${seq}`);
    if (outcome.kind !== "in_doubt") return { seq, outcome, charged: outcome.kind === "paid" };
    // The seller answered with an error and no settlement. The facilitator's public list says whether it settled.
    const found = await findSettlementByNonce(this.seller, outcome.nonce, since);
    return { seq, outcome, charged: found !== undefined };
  }
}
