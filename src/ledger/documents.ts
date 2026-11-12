// Booking documents (bookkeeping core, decision 7): a purchase invoice, a sales invoice, and paying or receiving
// against an open item. The payables inbox and the company API call these. VAT is computed per line from its code
// (src/ledger/vat.ts) and the code is stored on the net line, so the VAT overview reads exactly what was posted.
// Each document posts once: its source key is the counterparty and the document number.

import type { DB } from "../db/open.js";
import { INPUT_VAT, isBank, OUTPUT_VAT, PAYABLES, RECEIVABLES } from "./accounts.js";
import { LedgerRefused, postEntry, type LineInput, type Posted } from "./core.js";
import { assertSignedTerms } from "./termsLock.js";
import { VAT_CODES, vatOn } from "./vat.js";

export interface DocumentLine {
  account: string;
  /** Net amount in cents; negative for a credit note. */
  net_cents: number;
  vat_code: string;
  cost_centre?: string;
  memo?: string;
}

interface DocumentBase {
  date: string;
  doc_ref: string;
  doc_sha256?: string;
  due_date: string;
  currency: string;
  created_by: string;
  source_key?: string;
  /** The signed proposal this document was approved under: booked only while its stored terms hash to what was signed. */
  proposal_id?: string;
  lines: DocumentLine[];
}

const side = (cents: number, normal: "debit" | "credit"): Pick<LineInput, "debit" | "credit"> =>
  (cents >= 0) === (normal === "debit") ? { debit: Math.abs(cents) } : { credit: Math.abs(cents) };

function codeOf(line: DocumentLine, kind: "sale" | "purchase") {
  const c = VAT_CODES[line.vat_code];
  if (!c) throw new LedgerRefused(`unknown VAT code ${line.vat_code}`);
  if (c.kind !== kind) throw new LedgerRefused(`VAT code ${line.vat_code} is for a ${c.kind}, not a ${kind}`);
  if (!Number.isInteger(line.net_cents) || line.net_cents === 0) throw new LedgerRefused("a line's net amount is whole cents and not zero");
  return c;
}

/** A supplier's invoice: each net line (expense or stock) and its input VAT against accounts payable. */
export function purchaseInvoice(db: DB, inv: DocumentBase & { supplier: string }, now = new Date()): Posted {
  if (!inv.supplier.trim() || !inv.doc_ref.trim()) throw new LedgerRefused("a purchase invoice needs a supplier and a document number");
  const lines: LineInput[] = [];
  let payable = 0;
  let inputVat = 0;
  let reverseVat = 0;
  for (const l of inv.lines) {
    const c = codeOf(l, "purchase");
    const vat = vatOn(l.net_cents, l.vat_code);
    lines.push({ account: l.account, ...side(l.net_cents, "debit"), currency: inv.currency, cost_centre: l.cost_centre, vat_code: l.vat_code, vat_cents: vat, memo: l.memo, doc_ref: inv.doc_ref });
    payable += l.net_cents;
    if (c.reverse) reverseVat += vat;
    else {
      payable += vat;
      if (c.deductible) inputVat += vat;
    }
  }
  if (inputVat) lines.push({ account: INPUT_VAT, ...side(inputVat, "debit"), currency: inv.currency, doc_ref: inv.doc_ref, memo: "input VAT" });
  if (reverseVat) {
    // Reverse charge: we owe the VAT and reclaim it in the same return; nothing extra goes to the supplier.
    lines.push({ account: INPUT_VAT, ...side(reverseVat, "debit"), currency: inv.currency, doc_ref: inv.doc_ref, memo: "input VAT, reverse charge" });
    lines.push({ account: OUTPUT_VAT, ...side(reverseVat, "credit"), currency: inv.currency, doc_ref: inv.doc_ref, memo: "VAT owed, reverse charge" });
  }
  lines.push({ account: PAYABLES, ...side(payable, "credit"), currency: inv.currency, party: inv.supplier, doc_ref: inv.doc_ref, due_date: inv.due_date });
  if (inv.proposal_id) assertSignedTerms(db, inv.proposal_id, { amount_cents: payable, currency: inv.currency });
  return postEntry(db, {
    date: inv.date, description: `Purchase invoice ${inv.doc_ref} from ${inv.supplier}`, created_by: inv.created_by, source_key: inv.source_key ?? `purchase:${inv.supplier}:${inv.doc_ref}`,
    doc_ref: inv.doc_ref, doc_sha256: inv.doc_sha256, lines,
  }, now);
}

/** An invoice to a customer: accounts receivable against revenue and output VAT. */
export function salesInvoice(db: DB, inv: DocumentBase & { customer: string }, now = new Date()): Posted {
  if (!inv.customer.trim() || !inv.doc_ref.trim()) throw new LedgerRefused("a sales invoice needs a customer and a document number");
  const lines: LineInput[] = [];
  let receivable = 0;
  let outputVat = 0;
  for (const l of inv.lines) {
    codeOf(l, "sale");
    const vat = vatOn(l.net_cents, l.vat_code);
    lines.push({ account: l.account, ...side(l.net_cents, "credit"), currency: inv.currency, cost_centre: l.cost_centre, vat_code: l.vat_code, vat_cents: vat, memo: l.memo, doc_ref: inv.doc_ref });
    receivable += l.net_cents + vat;
    outputVat += vat;
  }
  if (outputVat) lines.push({ account: OUTPUT_VAT, ...side(outputVat, "credit"), currency: inv.currency, doc_ref: inv.doc_ref, memo: "output VAT" });
  lines.unshift({ account: RECEIVABLES, ...side(receivable, "debit"), currency: inv.currency, party: inv.customer, doc_ref: inv.doc_ref, due_date: inv.due_date });
  return postEntry(db, {
    date: inv.date, description: `Sales invoice ${inv.doc_ref} to ${inv.customer}`, created_by: inv.created_by, source_key: inv.source_key ?? `sale:${inv.customer}:${inv.doc_ref}`,
    doc_ref: inv.doc_ref, doc_sha256: inv.doc_sha256, lines,
  }, now);
}

/** What is still open on one document of one party, in cents (positive: owed to us for receivables, by us for payables). */
export function openAmount(db: DB, kind: "receivables" | "payables", party: string, docRef: string, currency: string): number | null {
  const account = kind === "receivables" ? RECEIVABLES : PAYABLES;
  const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(debit_cents - credit_cents), 0) AS net FROM ledger_lines WHERE account = ? AND party = ? AND doc_ref = ? AND currency = ?")
    .get(account, party, docRef, currency) as { n: number; net: number };
  if (r.n === 0) return null;
  return kind === "receivables" ? r.net : -r.net;
}

export interface Settlement {
  kind: "pay" | "receive";
  party: string;
  doc_ref: string;
  amount_cents: number;
  currency: string;
  /** The bank account the money moved through (12xx). */
  bank: string;
  date: string;
  created_by: string;
  /** The payment's own id (an Airwallex transfer, a deposit): posts once. */
  source_key?: string;
  proof?: string;
  /** The signed proposal the payment was made under: booked only while its stored terms hash to what was signed. */
  proposal_id?: string;
}

/** Paying a supplier's open item, or receiving a customer's: never more than is open. */
export function settleOpenItem(db: DB, s: Settlement, now = new Date()): Posted {
  if (!isBank(s.bank)) throw new LedgerRefused(`${s.bank} is not a bank account`);
  if (!Number.isInteger(s.amount_cents) || s.amount_cents <= 0) throw new LedgerRefused("an amount in whole cents above zero");
  if (s.proposal_id) assertSignedTerms(db, s.proposal_id, { amount_cents: s.amount_cents, currency: s.currency });
  const kind = s.kind === "pay" ? "payables" : "receivables";
  // Review of PR #108, finding 5: a retried payment (a webhook delivered again) is the payment already posted, and the
  // open amount is read inside the same write transaction, so two processes cannot both pay what is open once.
  return db.transaction((): Posted => {
    if (s.source_key) {
      const had = db.prepare("SELECT entry_id, posting_date FROM ledger_entries WHERE source_key = ?").get(s.source_key) as { entry_id: number; posting_date: string } | undefined;
      if (had) return { ...had, duplicate: true };
    }
    const open = openAmount(db, kind, s.party, s.doc_ref, s.currency);
    if (open === null) throw new LedgerRefused(`no open ${kind === "payables" ? "supplier invoice" : "customer invoice"} ${s.doc_ref} for ${s.party} in ${s.currency}`);
    if (s.amount_cents > open) throw new LedgerRefused(`${s.doc_ref} has ${open} cents open; ${s.amount_cents} is more than that`);
    const item = { account: s.kind === "pay" ? PAYABLES : RECEIVABLES, currency: s.currency, party: s.party, doc_ref: s.doc_ref };
    const lines: LineInput[] = s.kind === "pay"
      ? [{ ...item, debit: s.amount_cents }, { account: s.bank, credit: s.amount_cents, currency: s.currency, doc_ref: s.doc_ref }]
      : [{ account: s.bank, debit: s.amount_cents, currency: s.currency, doc_ref: s.doc_ref }, { ...item, credit: s.amount_cents }];
    return postEntry(db, {
      date: s.date, description: s.kind === "pay" ? `Payment of ${s.doc_ref} to ${s.party}` : `Receipt of ${s.doc_ref} from ${s.party}`, created_by: s.created_by,
      source_key: s.source_key, doc_ref: s.proof ?? s.doc_ref, lines,
    }, now);
  }).immediate();
}
