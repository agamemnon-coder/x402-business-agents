// The number an inbox invoice carries in the payment ledger (invoices, transfers, invoice_payment proposals). Those
// tables key an invoice by its number alone, which was enough for Northwind's own two payees, but two suppliers may
// well use the same number. So the inbox files every payment under the supplier's number with the supplier's name
// beside it ("BTX-2026-21 · Bergtex Textil GmbH"): unique per supplier, still the supplier's own number for the CFO,
// and the ledger's duplicate guards keep working unchanged. The SWIFT reference stays the invoice's own.

import { invoiceAlreadyHandled } from "../agents/euroBill.js";
import type { DB } from "../db/open.js";

/** The payment ledger's number for this supplier's invoice. */
export function ledgerInvoiceNo(invoiceNo: string, vendor: string): string {
  return `${invoiceNo.trim()} · ${vendor.trim()}`;
}

/**
 * Why this supplier's invoice may not be paid again, or null: a payout or proposal under the inbox's number for it,
 * or one the Treasury flow filed under the bare number for the same supplier (the ledger's guard compares the number
 * and the supplier in both forms, src/lib/invoiceKey.ts sameLedgerInvoice). The same supplier is the same name or the
 * same account (`accountSha256`): another supplier's invoice with the same number is not this invoice.
 */
export function handledInLedger(db: DB, invoiceNo: string, vendor: string, now: Date, accountSha256?: string | null): string | null {
  return invoiceAlreadyHandled(db, ledgerInvoiceNo(invoiceNo, vendor), now, invoiceNo, { vendor, accountSha256: accountSha256 ?? null });
}
