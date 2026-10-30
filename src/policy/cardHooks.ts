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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Handles one relayed event and says what happened, in a line for the runner's log. Never throws. */
export function handleAirwallexHook(db: DB, h: RelayedHook, secret: string, now = new Date()): string {
  if (!hookSignatureOk(h, secret)) return `webhook ${String(h.id).slice(0, 40)}: bad signature, ignored`;
  let event: unknown;
  try {
    event = JSON.parse(h.body);
  } catch {
    return `webhook ${String(h.id).slice(0, 40)}: not JSON, ignored`;
  }
  // Signed is not the same as well-formed: anything but an object with a string name is ignored (HF9).
  if (!isObject(event) || typeof event.name !== "string") return `webhook ${String(h.id).slice(0, 40)}: not an event, ignored`;
  const name = event.name;
  // The docs put the resource under data.object; the sandbox (version 2025-11-11) sends it as data itself.
  const data = isObject(event.data) ? event.data : undefined;
  const object = isObject(data?.object) ? data.object : data;
  if (!name.startsWith("issuing.") || !object || typeof object.card_id !== "string" || object.transaction_amount === undefined) {
    return `webhook ${name || "?"}: not a card transaction, ignored (fields: ${Object.keys(object ?? {}).slice(0, 12).join(", ")})`;
  }
  try {
    const t = toCardTransaction(object as never);
    const fresh = ingestCardTransaction(db, t, "webhook", now);
    return fresh
      ? `webhook ${name}: Airwallex ${t.approved ? "approved" : "declined"} ${fromCents(t.amountCents)} ${t.currency} at ${t.merchant}`
      : `webhook ${name}: ${t.transactionId.slice(0, 8)} already recorded`;
  } catch (e) {
    return `webhook ${name}: ${(e as Error).message} (fields: ${Object.keys(object).slice(0, 16).join(", ")})`;
  }
}
