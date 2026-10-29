// Paying an x402 route under a mandate, with the outcome classified the way the facilitator means it:
// paid, refused (nothing moved), or in doubt (signed and maybe settled: look the nonce up, never pay again).
// Mirrors metal-agent 0.3.3's own `pay` command.

import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { createMandatePaymentClient, refusalOf, signedOfferOf } from "@metalntwx/metal-pay/mandates";
import type { Address, Hex } from "viem";
import { FACILITATOR_ROOT } from "./network.js";
import type { LoadedMandate } from "./mandate.js";

export type PayOutcome =
  | { kind: "paid"; status: number; body: string; tx: Hex; nonce: string; signedOffer: string; amount: string; payTo: string }
  | { kind: "refused"; reason: string; status: number; body: string; nonce?: string }
  | { kind: "in_doubt"; reason: string; status?: number; body?: string; nonce: string };

/** Settlement reasons that mean nothing moved (metal-agent 0.3.3, NOTHING_SETTLED). */
const NOTHING_SETTLED = new Set([
  "unsupported_x402_version", "unsupported_network", "unsupported_scheme", "unsupported_asset", "settlement_unavailable",
  "invalid_payload", "bad_signature", "rpc_unreachable", "authorization_window", "rate_limited", "daily_limit_reached",
  "recipient_refuses", "payment_failed", "payment_reverted",
]);

export function nothingSettled(reason: string | undefined): boolean {
  if (reason === undefined) return false;
  const mandate = refusalOf(reason);
  if (mandate !== undefined) return mandate !== "NonceUsed";
  return NOTHING_SETTLED.has(reason) || reason.startsWith("payment_mismatch:");
}

/**
 * `guard` sees the offer before anything is signed (amount in cents, payee) and returns a reason to refuse it,
 * or null: the CFO policy's limit is checked here, inside the mandate's own cap.
 */
export async function payUnderMandate(
  m: LoadedMandate, url: string, init: RequestInit = {}, guard?: (cents: number, payTo: string) => string | null,
): Promise<PayOutcome> {
  const paying = createMandatePaymentClient({ credential: m.credential, signDigest: m.signDigest, network: "testnet" });
  let blocked: string | null = null;
  if (guard) {
    paying.client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      blocked = guard(Number(BigInt(selectedRequirements.amount) / 10n ** 16n), selectedRequirements.payTo);
      return blocked ? { abort: true as const, reason: blocked } : undefined;
    });
  }
  let nonce: string | undefined;
  let signedOffer = "";
  let offer: { amount: string; payTo: string } | undefined;
  paying.client.onAfterPaymentCreation(async ({ selectedRequirements, paymentPayload }) => {
    offer = { amount: selectedRequirements.amount, payTo: selectedRequirements.payTo };
    nonce = (paymentPayload.payload as { authorization?: { nonce?: string } }).authorization?.nonce;
    signedOffer = signedOfferOf(paymentPayload);
  });

  let res: Response;
  try {
    // A paid request that hangs is abandoned; once signed it is in doubt and looked up by its nonce, never resent.
    res = await paying.fetchWithPayment(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60_000) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (blocked !== null) return { kind: "refused", reason: blocked, status: 0, body: "" };
    if (nonce !== undefined) return { kind: "in_doubt", reason: message, nonce };
    return { kind: "refused", reason: `nothing was signed: ${message}`, status: 0, body: "" };
  }
  const body = await res.text();
  const required = res.headers.get("payment-required");
  const response = res.headers.get("payment-response");

  if (res.status === 402 && required) {
    const r = decodePaymentRequiredHeader(required);
    return { kind: "refused", reason: r.error ?? "payment required", status: 402, body, nonce };
  }
  const settlement = response ? decodePaymentResponseHeader(response) : undefined;
  if (settlement && !settlement.success) {
    const reason = settlement.errorReason ?? "settlement failed";
    if (nothingSettled(settlement.errorReason)) return { kind: "refused", reason, status: res.status, body, nonce };
    return { kind: "in_doubt", reason, status: res.status, body, nonce: nonce ?? "" };
  }
  if (settlement?.success && nonce !== undefined && offer) {
    return { kind: "paid", status: res.status, body, tx: settlement.transaction as Hex, nonce, signedOffer, amount: offer.amount, payTo: offer.payTo };
  }
  if (nonce !== undefined) {
    // Signed, but no settlement came back: the seller failed or cancelled. Only a lookup can say.
    return { kind: "in_doubt", reason: `seller answered ${res.status} without a settlement`, status: res.status, body, nonce };
  }
  return { kind: "refused", reason: `seller answered ${res.status} and asked for no payment`, status: res.status, body };
}

export interface Settlement {
  id: string;
  payer: string;
  payTo: string;
  amount: string;
  transaction: string;
  settledAt: number;
}

/** The facilitator's public list of what settled to an address (oldest first, 500 a page). */
export async function settlementsTo(payTo: Address, sinceMs: number): Promise<Settlement[]> {
  const out: Settlement[] = [];
  let since = sinceMs;
  for (;;) {
    const res = await fetch(`${FACILITATOR_ROOT}/x402/facilitator/settlements?payTo=${payTo}&since=${since}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`/settlements answered ${res.status}`);
    const page = ((await res.json()) as { settlements: Settlement[] }).settlements;
    out.push(...page.filter((s) => !out.some((o) => o.id === s.id)));
    if (page.length < 500) return out;
    since = page[page.length - 1]!.settledAt;
  }
}

/** A payment's settlement id ends with its nonce. */
export async function findSettlementByNonce(payTo: Address, nonce: string, sinceMs: number): Promise<Settlement | undefined> {
  const tail = nonce.toLowerCase().replace(/^0x/, "");
  return (await settlementsTo(payTo, sinceMs)).find((s) => s.id.toLowerCase().includes(tail));
}
