// Reads a route's current x402 offer without paying: the 402 it answers names the price.

import { decodePaymentRequiredHeader } from "@x402/core/http";
import { baseUnitsToCents } from "../lib/money.js";

export async function liveOfferCents(url: string): Promise<{ cents: number; payTo: string }> {
  const res = await fetch(url);
  const header = res.headers.get("payment-required");
  if (res.status !== 402 || !header) throw new Error(`${url} did not answer with an offer (status ${res.status})`);
  const offer = decodePaymentRequiredHeader(header).accepts[0];
  if (!offer) throw new Error(`${url} offered nothing`);
  return { cents: baseUnitsToCents(BigInt(offer.amount)), payTo: offer.payTo };
}
