// Reading the manufacturer's invoice (deterministic fallback for the Claude layer) and checking its payee against the
// allowlisted beneficiary. Changed bank details, a lookalike vendor or another account holder never pay: they are
// blocked as possible invoice fraud (src/policy/fraud.ts) and escalate to a person.

import { createHash } from "node:crypto";
import type { DB } from "../db/open.js";
import { CONTRACTED_EUR_CENTS } from "../config/policy.js";
import { fromCents, toCents } from "../lib/money.js";
import { assessInvoice, type FraudFinding } from "../policy/fraud.js";
import { counterpartyAllowed, frozen } from "../policy/rules.js";

export { parseInvoiceFallback, type Invoice } from "../claude/invoiceReading.js";
import type { Invoice } from "../claude/invoiceReading.js";

export const ibanSha = (iban: string) => createHash("sha256").update(iban.replace(/\s+/g, "").toUpperCase()).digest("hex");

export type InvoiceCheck =
  | { ok: true; beneficiaryId: string; name: string; ibanLast4: string; bic: string; amountCents: number }
  | { ok: false; reason: string; fraud?: FraudFinding };

/** checkInvoice's refusal of an allowlisted payee the CFO policy blocks, or null. The Treasury agent's invoice facts
 *  ask the same (src/autonomy/invoiceFacts.ts), so they never offer what this refuses (review 2, LOW 3). */
export function payeeBlocked(db: DB, name: string): string | null {
  return counterpartyAllowed(db, name) ? null : `${name} is blocked by the CFO policy`;
}

/** checkInvoice's refusal of an amount other than a contracted fee (Kit 11's licence fee: paid only for exactly the
 *  amount in code, whatever the invoice says), or null; the invoice facts ask the same. */
export function offContract(name: string, amount: string): string | null {
  const contracted = CONTRACTED_EUR_CENTS[name];
  return contracted !== undefined && toCents(amount) !== contracted ? `the licence fee in code is EUR ${fromCents(contracted)}; this invoice from ${name} asks EUR ${amount}` : null;
}

/**
 * The invoice may only be paid to a beneficiary already on the allowlist, by name, with the same IBAN, BIC and
 * account holder. `text` is the document itself, for the account holder line and the wording around a change.
 */
export function checkInvoice(db: DB, inv: Invoice, text = ""): InvoiceCheck {
  if (inv.currency !== "EUR") return { ok: false, reason: `currency ${inv.currency}, expected EUR` };
  const fraud = assessInvoice(db, inv, text);
  if (fraud.blocked) {
    const blocking = fraud.signals.filter((s) => s.blocks);
    if (!fraud.suspicious) return { ok: false, reason: blocking.map((s) => s.detail).join("; "), fraud };
    const who = fraud.allowlisted?.name ?? inv.vendor;
    return { ok: false, reason: `possible invoice fraud: ${blocking.map((s) => s.detail).join("; ")}; nothing is paid until a person verifies with ${who} on the phone number on file`, fraud };
  }
  const b = fraud.allowlisted!;
  const blocked = payeeBlocked(db, b.name);
  if (blocked) return { ok: false, reason: blocked };
  if (frozen(db)) return { ok: false, reason: "the CFO pulled the emergency stop" };
  const off = offContract(b.name, inv.amount);
  if (off) return { ok: false, reason: `${off}: a person checks the contract first` };
  return { ok: true, beneficiaryId: b.beneficiary_id, name: b.name, ibanLast4: b.iban_last4, bic: b.bic, amountCents: toCents(inv.amount) };
}
