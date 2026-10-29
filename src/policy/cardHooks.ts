// An Airwallex webhook the relay passed on (K2). The relay checked the signature, but the runner trusts no relay:
// it checks Airwallex's HMAC again with its own copy of the secret, then records the card transaction once.
// A webhook only ever records what Airwallex decided; it cannot approve, pay or change anything.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { toCardTransaction } from "../airwallex/issuing.js";
import { ingestCardTransaction } from "./cards.js";

export interface RelayedHook {
  id: string;
  /** Airwallex's x-timestamp and x-signature, as the relay received them. */
  ts: string;
  signature: string;
  /** The raw body, exactly as signed. */
  body: string;
}

export function hookSignatureOk(h: RelayedHook, secret: string): boolean {
  const want = createHmac("sha256", secret).update(h.ts + h.body).digest();
  const got = /^[0-9a-f]{64}$/i.test(h.signature) ? Buffer.from(h.signature, "hex") : Buffer.alloc(0);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Handles one relayed event and says what happened, in a line for the runner's log. Never throws. */
export function handleAirwallexHook(db: DB, h: RelayedHook, secret: string, now = new Date()): string {
  if (!hookSignatureOk(h, secret)) return `webhook ${h.id.slice(0, 40)}: bad signature, ignored`;
  let event: { id?: unknown; name?: unknown; data?: { object?: unknown } };
  try {
    event = JSON.parse(h.body) as typeof event;
  } catch {
    return `webhook ${h.id.slice(0, 40)}: not JSON, ignored`;
  }
  const name = String(event.name ?? "");
  const object = event.data?.object as Record<string, unknown> | undefined;
  if (!name.startsWith("issuing.") || !object || typeof object.card_id !== "string" || object.transaction_amount === undefined) {
    return `webhook ${name || "?"}: not a card transaction, ignored`;
  }
  try {
    const t = toCardTransaction(object as never);
    const fresh = ingestCardTransaction(db, t, "webhook", now);
    return fresh
      ? `webhook ${name}: Airwallex ${t.approved ? "approved" : "declined"} ${fromCents(t.amountCents)} ${t.currency} at ${t.merchant}`
      : `webhook ${name}: ${t.transactionId.slice(0, 8)} already recorded`;
  } catch (e) {
    return `webhook ${name}: ${(e as Error).message}`;
  }
}
