// What the ERP sync sends from Purser's own ledger today, mapped to the canonical model: the payees on the allowlist as
// vendors, the invoices, the PAID payouts as payments, and the GL journal's other money movements as journal entries.
// The payables inbox and the bookkeeping core (other branches) will feed richer objects through the same model.
//
// Honest limits of this feed: the ledger's invoices carry no issue date (the due date stands in) and no VAT split (the
// amount is booked as one line with VAT treatment NONE); movements in Metal's test token (USDZ) are not ISO currencies,
// so no ERP can hold them and they are left out; opening balances are the accountant's, not sent.

import { journal as glJournal } from "../accounting/gl.js";
import { VENDOR_GL } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import type { JournalEntry, Payment, PurchaseInvoice, Vendor } from "./model.js";
import type { SyncItem } from "./sync.js";

const BANK_FOR: Record<string, string> = { EUR: "1200", USD: "1201", GBP: "1202" };
const ISO = /^[A-Z]{3}$/;

export function ledgerItems(db: DB): SyncItem[] {
  const items: SyncItem[] = [];
  for (const b of db.prepare("SELECT beneficiary_id, name, iban_last4, iban_sha256, bic, currency FROM beneficiaries WHERE status = 'ACTIVE' ORDER BY beneficiary_id").all() as
    { beneficiary_id: string; name: string; iban_last4: string; iban_sha256: string; bic: string; currency: string }[]) {
    const v: Vendor = { id: b.beneficiary_id, name: b.name, ibanLast4: b.iban_last4, ibanSha256: b.iban_sha256, bic: b.bic, currency: b.currency, ...(VENDOR_GL[b.name] ? { defaultGl: VENDOR_GL[b.name]! } : {}) };
    items.push({ kind: "vendor", object: v });
  }
  const invoices = db.prepare("SELECT invoice_no, vendor, amount, currency, due_date, beneficiary_id, doc_sha256 FROM invoices WHERE beneficiary_id IS NOT NULL ORDER BY invoice_no").all() as
    { invoice_no: string; vendor: string; amount: string; currency: string; due_date: string; beneficiary_id: string; doc_sha256: string }[];
  for (const r of invoices) {
    const cents = toCents(r.amount);
    const inv: PurchaseInvoice = {
      id: r.invoice_no, vendorId: r.beneficiary_id, number: r.invoice_no, issueDate: r.due_date, dueDate: r.due_date, currency: r.currency,
      lines: [{ description: `Invoice ${r.invoice_no}, ${r.vendor}`, glAccount: VENDOR_GL[r.vendor] ?? "6900", vatCode: "NONE", netCents: cents, vatCents: 0 }],
      totals: { netCents: cents, vatCents: 0, grossCents: cents }, documentSha256: r.doc_sha256,
    };
    items.push({ kind: "invoice", object: inv });
  }
  const vendorOf = new Map(invoices.map((r) => [r.invoice_no, r.beneficiary_id]));
  for (const t of db.prepare("SELECT request_id, transfer_id, invoice_no, amount, currency, updated_at FROM transfers WHERE status = 'PAID' ORDER BY updated_at, request_id").all() as
    { request_id: string; transfer_id: string | null; invoice_no: string; amount: string; currency: string; updated_at: string }[]) {
    const vendorId = vendorOf.get(t.invoice_no);
    if (!vendorId) continue;
    const p: Payment = {
      id: t.request_id, invoiceId: t.invoice_no, vendorId, date: t.updated_at.slice(0, 10), amountCents: toCents(t.amount), currency: t.currency,
      bankAccount: BANK_FOR[t.currency] ?? "1200", ...(t.transfer_id ? { airwallexTransferId: t.transfer_id } : {}),
    };
    items.push({ kind: "payment", object: p });
  }
  // The GL journal's other movements, one balanced entry each; the id is the movement's own (source and reference).
  const seen = new Map<string, number>();
  for (const l of glJournal(db)) {
    if (l.source === "transfer" || l.source === "opening" || !ISO.test(l.currency)) continue;
    const cents = toCents(l.amount.replace(/^-/, ""));
    if (cents === 0) continue;
    const key = `${l.source}:${l.ref}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const out = l.amount.startsWith("-");
    const j: JournalEntry = {
      id: n === 1 ? key : `${key}#${n}`, date: l.date.slice(0, 10), currency: l.currency, memo: l.description, sourceRef: l.proof || l.ref,
      lines: [
        { glAccount: out ? l.gl_account : l.bank_account, debitCents: cents, creditCents: 0, description: l.description, ...(l.cost_centre ? { costCentre: l.cost_centre } : {}) },
        { glAccount: out ? l.bank_account : l.gl_account, debitCents: 0, creditCents: cents, description: l.description, ...(l.cost_centre ? { costCentre: l.cost_centre } : {}) },
      ],
    };
    items.push({ kind: "journal", object: j });
  }
  return items;
}
