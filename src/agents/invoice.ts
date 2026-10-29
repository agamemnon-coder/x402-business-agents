// Reading the licence invoice (deterministic fallback for the Claude layer) and checking its payee against the
// allowlisted beneficiary. Changed bank details, a lookalike vendor or another account holder never pay: they are
// blocked as possible invoice fraud (src/policy/fraud.ts) and escalate to a person.

import { createHash } from "node:crypto";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { assessInvoice, type FraudFinding } from "../policy/fraud.js";
import { counterpartyAllowed } from "../policy/rules.js";

export interface Invoice {
  invoice_no: string;
  vendor: string;
  amount: string;
  currency: string;
  due_date: string;
  iban: string;
  bic: string;
  reference: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function isoDate(text: string): string {
  const m = /(\d{1,2}) (\w+) (\d{4})/.exec(text);
  const month = m ? MONTHS.indexOf(m[2]!.toLowerCase()) : -1;
  if (!m || month < 0) throw new Error(`not a date: ${text}`);
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

export function parseInvoiceFallback(text: string): Invoice {
  const get = (re: RegExp, what: string) => {
    const m = re.exec(text);
    if (!m) throw new Error(`invoice: no ${what}`);
    return m[1]!.trim();
  };
  const total = get(/Total due\s+EUR\s+([\d,]+\.\d{2})/, "total");
  return {
    invoice_no: get(/INVOICE\s+(\S+)/, "invoice number"),
    vendor: text.trim().split("\n")[0]!.trim(),
    amount: total.replace(/,/g, ""),
    currency: "EUR",
    due_date: isoDate(get(/Due date:\s*(.+)/, "due date")),
    iban: get(/IBAN:\s*([A-Z0-9 ]+)/, "IBAN").replace(/\s+/g, ""),
    bic: get(/BIC:\s*([A-Z0-9]+)/, "BIC"),
    reference: get(/Payment reference:\s*(\S+)/, "reference"),
  };
}

export const ibanSha = (iban: string) => createHash("sha256").update(iban.replace(/\s+/g, "").toUpperCase()).digest("hex");

export type InvoiceCheck =
  | { ok: true; beneficiaryId: string; name: string; ibanLast4: string; bic: string; amountCents: number }
  | { ok: false; reason: string; fraud?: FraudFinding };

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
  if (!counterpartyAllowed(db, b.name)) return { ok: false, reason: `${b.name} is blocked by the CFO policy` };
  return { ok: true, beneficiaryId: b.beneficiary_id, name: b.name, ibanLast4: b.iban_last4, bic: b.bic, amountCents: toCents(inv.amount) };
}
