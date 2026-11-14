// Purser's credential check, the decision only (partner review, 14 Nov): given the purchase a credential was issued for,
// is this use of it the one use it was made for? src/airi/credentialGuard.ts reads the purchase from the ledger and asks
// this function; /visa ships this same file, its types stripped, to the browser (src/redesign/visaCardScene.ts), so a
// visitor runs the real check on the recorded purchase. It must stay self-contained: no imports, no helpers outside it.

export type CredentialRefusalCode =
  | "PURSER_CREDENTIAL_UNKNOWN_MANDATE" | "PURSER_CREDENTIAL_OTHER_PURCHASE"
  | "PURSER_CREDENTIAL_AMOUNT_MISMATCH" | "PURSER_CREDENTIAL_MERCHANT_MISMATCH" | "PURSER_CREDENTIAL_ALREADY_USED";

export interface CredentialUse {
  /** The Airi mandate whose credential would pay. */
  mandateId: string;
  /** The purchase this payment is for (the executor passes its own; a conductor's test may pass none). */
  actionId?: string;
  /** What the checkout would charge. */
  amount: string;
  currency: string;
  /** The merchant the checkout would pay (its URL). Given, it must be the merchant in the signed terms (same origin). */
  merchantUrl?: string;
}

/** A purchase as the ledger holds it: what the CFO's terms say and how far it got. */
export interface PurchaseOnRecord {
  actionId: string;
  mandateId: string | null;
  cents: number;
  currency: string;
  /** The merchant URL in the signed terms, or null when the terms name none. */
  merchantUrl: string | null;
  status: string;
  /** Whether the checkout was already asked to pay (its money step was started). */
  paid: boolean;
}

/**
 * Why this use of a credential is refused, or null when it is the one use its mandate was created for. `own` is the
 * purchase named by use.actionId (when given), `latest` the newest purchase whose mandate is use.mandateId.
 */
export function credentialRefusalOf(use: CredentialUse, own: PurchaseOnRecord | undefined, latest: PurchaseOnRecord | undefined): { code: CredentialRefusalCode; reason: string } | null {
  if (use.actionId && own && own.mandateId !== use.mandateId) return { code: "PURSER_CREDENTIAL_OTHER_PURCHASE", reason: `mandate ${use.mandateId} was not created for ${use.actionId}` };
  const row = use.actionId ? own : latest;
  if (!row) return { code: "PURSER_CREDENTIAL_UNKNOWN_MANDATE", reason: `mandate ${use.mandateId} is not one Purser created for a purchase` };
  // Exactly two decimals, as everywhere in Purser's terms ("45.00"); anything else is not this purchase's amount.
  const m = /^(0|[1-9]\d*)\.(\d{2})$/.exec(use.amount);
  const cents = m ? Number(m[1]) * 100 + Number(m[2]) : null;
  if (cents !== row.cents || use.currency !== row.currency) {
    return { code: "PURSER_CREDENTIAL_AMOUNT_MISMATCH", reason: `mandate ${use.mandateId} is for ${(row.cents / 100).toFixed(2)} ${row.currency}, not ${use.amount} ${use.currency}` };
  }
  if (use.merchantUrl !== undefined) {
    // Plain https, no user or password: the origin is what is compared.
    let signed: string | null = null, asked: string | null = null;
    try { const u = new URL(row.merchantUrl ?? ""); if (u.protocol === "https:" && !u.username && !u.password) signed = u.origin; } catch { signed = null; }
    try { const u = new URL(use.merchantUrl); if (u.protocol === "https:" && !u.username && !u.password) asked = u.origin; } catch { asked = null; }
    if (!signed || asked !== signed) return { code: "PURSER_CREDENTIAL_MERCHANT_MISMATCH", reason: `mandate ${use.mandateId} is for ${signed ?? "no known merchant"}, not ${asked ?? use.merchantUrl}` };
  }
  // After these statuses the mandate's one payment has been made or tried: its credential may not pay again.
  if (row.paid || ["PAYING", "SETTLED", "UNCONFIRMED", "RELEASED"].includes(row.status)) {
    return { code: "PURSER_CREDENTIAL_ALREADY_USED", reason: `mandate ${use.mandateId}'s credential was already used for ${row.actionId} (${row.status.toLowerCase()})` };
  }
  return null;
}
