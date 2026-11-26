// An Airwallex webhook the relay passed on (K2). The relay checked the signature, but the runner trusts no relay:
// it checks Airwallex's HMAC again with its own copy of the secret, then records the event once. A card transaction
// is booked; any other object (a card, a payout, a conversion, a deposit) is checked against the ledger
// (airwallexEvents.ts). A webhook only ever records what Airwallex decided; it cannot approve, pay or change anything.
// A webhook whose signature does not hold here is recorded too (26 Nov), as WEBHOOK_REFUSED with its source and the
// reason only: never its body, id or headers (text anyone could have written). The relay checked the same signature
// with its own copy of the secret and slows an address that keeps failing (worker/src/core.ts, HF1), so one reaching
// the runner means the two secrets differ or the relay passed on what it should not have: a monitoring and incident
// signal (docs/compliance/incident-response.md), shown in the compliance evidence under PC-14.

import { createHmac, timingSafeEqual } from "node:crypto";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { toCardTransaction } from "../airwallex/issuing.js";
import { ingestCardTransaction } from "./cards.js";
import { checkEvent, recordEvent, seenEvent } from "./airwallexEvents.js";

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

/** The audit event of a relayed webhook whose signature the runner refused. */
export const WEBHOOK_REFUSED = "airwallex.webhook_refused";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Handles one relayed event and says what happened, in a line for the runner's log. Never throws. */
export function handleAirwallexHook(db: DB, h: RelayedHook, secret: string, now = new Date()): string {
  if (!hookSignatureOk(h, secret)) {
    // Never throws: a ledger that cannot take the row still gets the runner's log line.
    try { audit(db, "system", WEBHOOK_REFUSED, null, { source: "airwallex", reason: "bad signature" }, now); } catch { /* the line below says it */ }
    return `webhook ${String(h.id).slice(0, 40)}: bad signature, ignored`;
  }
  let event: unknown;
  try {
    event = JSON.parse(h.body);
  } catch {
    return `webhook ${String(h.id).slice(0, 40)}: not JSON, ignored`;
  }
  // Signed is not the same as well-formed: anything but an object with a string name is ignored (HF9).
  if (!isObject(event) || typeof event.name !== "string") return `webhook ${String(h.id).slice(0, 40)}: not an event, ignored`;
  const name = event.name;
  // One record per event: Airwallex retries until it gets a 200, and the relay may pass an event on twice.
  if (seenEvent(db, h.id)) return `webhook ${name}: ${String(h.id).slice(0, 40)} already recorded`;
  // The docs put the resource under data.object; the sandbox (version 2025-11-11) sends it as data itself.
  const data = isObject(event.data) ? event.data : undefined;
  const object = isObject(data?.object) ? data.object : (data ?? {});
  if (!(name.startsWith("issuing.") && typeof object.card_id === "string" && object.transaction_amount !== undefined)) {
    const c = checkEvent(db, name, object, now);
    recordEvent(db, h.id, name, c, now);
    return `webhook ${name}: ${c.outcome}`;
  }
  let line: string;
  let agrees: boolean | null = true;
  let t: ReturnType<typeof toCardTransaction> | undefined;
  try {
    t = toCardTransaction(object as never);
    const fresh = ingestCardTransaction(db, t, "webhook", now);
    line = fresh
      ? `Airwallex ${t.approved ? "approved" : "declined"} ${fromCents(t.amountCents)} ${t.currency} at ${t.merchant}`
      : `${t.transactionId.slice(0, 8)} already recorded`;
  } catch (e) {
    const msg = (e as Error).message;
    // A transaction on a card that is no agent's is something the ledger cannot explain; a malformed one is not.
    agrees = /not an agent's card/.test(msg) ? false : null;
    line = `${msg} (fields: ${Object.keys(object).slice(0, 16).join(", ")})`;
  }
  recordEvent(db, h.id, name, { object: "card_transaction", object_id: t?.transactionId ?? (typeof object.card_transaction_id === "string" ? object.card_transaction_id : null), status: t ? (t.approved ? "APPROVED" : "DECLINED") : null, amount_cents: t?.amountCents ?? null, currency: t?.currency ?? null, agrees, outcome: line }, now);
  return `webhook ${name}: ${line}`;
}
