// Reading the licence invoice (deterministic fallback for the Claude layer) and checking its bank details
// against the allowlisted beneficiary. Changed bank details never pay: they escalate (invoice fraud guard).

import { createHash } from "node:crypto";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";

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
  | { ok: false; reason: string };

/** The invoice may only be paid to a beneficiary already on the allowlist, with the same IBAN and BIC. */
export function checkInvoice(db: DB, inv: Invoice): InvoiceCheck {
  if (inv.currency !== "EUR") return { ok: false, reason: `currency ${inv.currency}, expected EUR` };
  const b = db.prepare("SELECT beneficiary_id, name, iban_last4, iban_sha256, bic FROM beneficiaries WHERE name = ? AND currency = 'EUR'").get(inv.vendor) as
    { beneficiary_id: string; name: string; iban_last4: string; iban_sha256: string; bic: string } | undefined;
  if (!b) return { ok: false, reason: `${inv.vendor} is not an allowlisted beneficiary` };
  if (b.iban_sha256 !== ibanSha(inv.iban) || b.bic !== inv.bic) {
    return { ok: false, reason: `bank details differ from the allowlisted ones (IBAN ...${b.iban_last4}, BIC ${b.bic}); possible invoice fraud` };
  }
  return { ok: true, beneficiaryId: b.beneficiary_id, name: b.name, ibanLast4: b.iban_last4, bic: b.bic, amountCents: toCents(inv.amount) };
}
