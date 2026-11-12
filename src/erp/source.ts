// What the ERP sync sends from Purser's own ledger today, mapped to the canonical model: the payees on the allowlist as
// vendors, the invoices, the PAID payouts as payments, and the GL journal's other money movements as journal entries.
// The payables inbox (src/ap) feeds its invoices through the same model (below); the bookkeeping core (src/ledger) does
// not feed it yet.
//
// Honest limits of this feed: the Treasury flow's own invoices carry no issue date (the due date stands in) and no VAT split (the
// amount is booked as one line with VAT treatment NONE); movements in Metal's test token (USDZ) are not ISO currencies,
// so no ERP can hold them and they are left out; opening balances are the accountant's, not sent.

import { journal as glJournal } from "../accounting/gl.js";
import { bankAccountFor, bookable } from "../ap/books.js";
import { ledgerInvoiceNo } from "../ap/ledgerKey.js";
import { apInvoices, type ApInvoiceRow } from "../ap/store.js";
import { VENDOR_GL } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import type { JournalEntry, Payment, PurchaseInvoice, Vendor } from "./model.js";
import type { SyncItem } from "./sync.js";

const ISO = /^[A-Z]{3}$/;
const MONEY = /^\d+\.\d{2}$/;

/**
 * The VAT an inbox invoice carries, as an ERP code: Dutch 21% or 9% when the invoice's own tax is that share of its
 * subtotal (within a cent), so it is reclaimed; anything else (no VAT, another country's VAT) is no Dutch VAT, booked
 * with the cost.
 */
function apVat(a: ApInvoiceRow): { code: "NL21" | "NL9" | "NONE"; netCents: number; vatCents: number } {
  const total = toCents(a.total);
  if (!MONEY.test(a.tax) || !MONEY.test(a.subtotal)) return { code: "NONE", netCents: total, vatCents: 0 };
  const net = toCents(a.subtotal);
  const vat = toCents(a.tax);
  if (vat <= 0 || net + vat !== total) return { code: "NONE", netCents: total, vatCents: 0 };
  for (const [code, rate] of [["NL21", 21], ["NL9", 9]] as const) if (Math.abs(Math.round((net * rate) / 100) - vat) <= 1) return { code, netCents: net, vatCents: vat };
  return { code: "NONE", netCents: total, vatCents: 0 };
}

export function ledgerItems(db: DB): SyncItem[] {
  const items: SyncItem[] = [];
  for (const b of db.prepare("SELECT beneficiary_id, name, iban_last4, iban_sha256, bic, currency FROM beneficiaries WHERE status = 'ACTIVE' ORDER BY beneficiary_id").all() as
    { beneficiary_id: string; name: string; iban_last4: string; iban_sha256: string; bic: string; currency: string }[]) {
    // A supplier on a local route (FX payouts: ACH, Faster Payments, ...) may have no BIC: none is sent rather than an empty one.
    const v: Vendor = { id: b.beneficiary_id, name: b.name, ibanLast4: b.iban_last4, ibanSha256: b.iban_sha256, ...(b.bic ? { bic: b.bic } : {}), currency: b.currency, ...(VENDOR_GL[b.name] ? { defaultGl: VENDOR_GL[b.name]! } : {}) };
    items.push({ kind: "vendor", object: v });
  }
  const invoices = db.prepare("SELECT invoice_no, vendor, amount, currency, due_date, beneficiary_id, doc_sha256 FROM invoices WHERE beneficiary_id IS NOT NULL ORDER BY invoice_no").all() as
    { invoice_no: string; vendor: string; amount: string; currency: string; due_date: string; beneficiary_id: string; doc_sha256: string }[];
  // The payables inbox files its invoices in the ledger as "NUM · Supplier" (src/ap/ledgerKey.ts); the ERP gets the
  // supplier's own number, issue date, VAT and expense account from the inbox, and only for an invoice the books hold
  // (bookable, not rejected). The ledger's key stays the id, so the payment still finds its invoice (red team round 3).
  const inbox = new Map(apInvoices(db).map((a) => [ledgerInvoiceNo(a.invoice_no, a.vendor), a]));
  for (const r of invoices) {
    const cents = toCents(r.amount);
    const a = inbox.get(r.invoice_no);
    if (a) {
      if (a.status === "rejected" || !bookable(a)) continue;
      const vat = apVat(a);
      items.push({ kind: "invoice", object: {
        id: r.invoice_no, vendorId: r.beneficiary_id, number: a.invoice_no, issueDate: a.issue_date || r.due_date, dueDate: a.due_date || r.due_date, currency: a.currency,
        lines: [{ description: `Invoice ${a.invoice_no}, ${a.vendor}`, glAccount: a.gl_account || VENDOR_GL[r.vendor] || "6900", vatCode: vat.code, netCents: vat.netCents, vatCents: vat.vatCents, ...(a.cost_centre ? { costCentre: a.cost_centre } : {}) }],
        totals: { netCents: vat.netCents, vatCents: vat.vatCents, grossCents: vat.netCents + vat.vatCents }, documentSha256: a.doc_sha256,
      } satisfies PurchaseInvoice });
      continue;
    }
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
      // The Airwallex balance it left from: EUR, USD, GBP each their own account, any other currency 1203 (FX payouts).
      bankAccount: bankAccountFor(t.currency), ...(t.transfer_id ? { airwallexTransferId: t.transfer_id } : {}),
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
