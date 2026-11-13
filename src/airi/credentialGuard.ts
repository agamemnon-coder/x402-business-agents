// Purser's check that an Airi credential pays one order only: the purchase it was issued for, at that purchase's
// amount and currency, once. vic-3 showed that the Airi/Airwallex sandbox accepted a credential on another amount
// (F1) and a second time (F2); this check runs in Purser's executor right before the checkout is asked to pay, and in
// the vic-4 conductor for its F1 and F2, so that misuse is refused by Purser before any Airwallex call. It reads the
// ledger only: no call to Airi or Airwallex.

import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";

export type CredentialRefusalCode =
  | "PURSER_CREDENTIAL_UNKNOWN_MANDATE" | "PURSER_CREDENTIAL_OTHER_PURCHASE"
  | "PURSER_CREDENTIAL_AMOUNT_MISMATCH" | "PURSER_CREDENTIAL_ALREADY_USED";

export interface CredentialUse {
  /** The Airi mandate whose credential would pay. */
  mandateId: string;
  /** The purchase this payment is for (the executor passes its own; a conductor's test may pass none). */
  actionId?: string;
  /** What the checkout would charge. */
  amount: string;
  currency: string;
}

/** Statuses after which the mandate's one payment has been made or tried: its credential may not pay again. */
const USED = ["PAYING", "SETTLED", "UNCONFIRMED", "RELEASED"];

/** Why this use of a credential is refused, or null when it is the one use its mandate was created for. */
export function credentialUseRefusal(db: DB, use: CredentialUse): { code: CredentialRefusalCode; reason: string } | null {
  type Row = { action_id: string; mandate_id: string | null; cents: number; terms_json: string; status: string };
  const cols = "SELECT action_id, mandate_id, cents, terms_json, status FROM airi_purchases";
  if (use.actionId) {
    const own = db.prepare(`${cols} WHERE action_id = ?`).get(use.actionId) as Row | undefined;
    if (own && own.mandate_id !== use.mandateId) return { code: "PURSER_CREDENTIAL_OTHER_PURCHASE", reason: `mandate ${use.mandateId} was not created for ${use.actionId}` };
  }
  const row = (use.actionId ? db.prepare(`${cols} WHERE action_id = ?`).get(use.actionId) : db.prepare(`${cols} WHERE mandate_id = ? ORDER BY created_at DESC LIMIT 1`).get(use.mandateId)) as Row | undefined;
  if (!row) return { code: "PURSER_CREDENTIAL_UNKNOWN_MANDATE", reason: `mandate ${use.mandateId} is not one Purser created for a purchase` };
  const currency = (JSON.parse(row.terms_json) as { currency?: string }).currency ?? "";
  let cents: number | null;
  try { cents = toCents(use.amount); } catch { cents = null; }
  if (cents !== row.cents || use.currency !== currency) {
    return { code: "PURSER_CREDENTIAL_AMOUNT_MISMATCH", reason: `mandate ${use.mandateId} is for ${(row.cents / 100).toFixed(2)} ${currency}, not ${use.amount} ${use.currency}` };
  }
  const paid = db.prepare("SELECT 1 FROM money_steps WHERE action_id = ? AND step = 'airi.checkout_pay'").get(row.action_id);
  if (paid || USED.includes(row.status)) return { code: "PURSER_CREDENTIAL_ALREADY_USED", reason: `mandate ${use.mandateId}'s credential was already used for ${row.action_id} (${row.status.toLowerCase()})` };
  return null;
}
