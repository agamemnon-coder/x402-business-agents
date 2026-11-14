// Purser's check that an Airi credential pays one order only: the purchase it was issued for, at that purchase's
// amount and currency, at the merchant in its signed terms, once. vic-3 showed that the Airi/Airwallex sandbox accepted a credential on another amount
// (F1) and a second time (F2); this check runs in Purser's executor right before the checkout is asked to pay, and in
// the vic-4 conductor for its F1 and F2, so that misuse is refused by Purser before any Airwallex call. It reads the
// ledger only: no call to Airi or Airwallex. The decision itself is src/airi/credentialCore.ts (pure, also run on /visa).

import type { DB } from "../db/open.js";
import { credentialRefusalOf, type CredentialRefusalCode, type CredentialUse, type PurchaseOnRecord } from "./credentialCore.js";

export type { CredentialRefusalCode, CredentialUse };

type Row = { action_id: string; mandate_id: string | null; cents: number; terms_json: string; status: string };

function purchaseOf(db: DB, row: Row | undefined): PurchaseOnRecord | undefined {
  if (!row) return undefined;
  const terms = JSON.parse(row.terms_json) as { currency?: string; merchant?: { url?: string } };
  const paid = !!db.prepare("SELECT 1 FROM money_steps WHERE action_id = ? AND step = 'airi.checkout_pay'").get(row.action_id);
  return { actionId: row.action_id, mandateId: row.mandate_id, cents: row.cents, currency: terms.currency ?? "", merchantUrl: terms.merchant?.url ?? null, status: row.status, paid };
}

/** Why this use of a credential is refused, or null when it is the one use its mandate was created for. */
export function credentialUseRefusal(db: DB, use: CredentialUse): { code: CredentialRefusalCode; reason: string } | null {
  const cols = "SELECT action_id, mandate_id, cents, terms_json, status FROM airi_purchases";
  const own = use.actionId ? purchaseOf(db, db.prepare(`${cols} WHERE action_id = ?`).get(use.actionId) as Row | undefined) : undefined;
  const latest = use.actionId ? undefined : purchaseOf(db, db.prepare(`${cols} WHERE mandate_id = ? ORDER BY created_at DESC LIMIT 1`).get(use.mandateId) as Row | undefined);
  return credentialRefusalOf(use, own, latest);
}
