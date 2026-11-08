// Payables, part 4: the books. Every checked invoice is booked when it comes in (accrual: the expense, the input VAT,
// and what we owe the supplier), and again when it is paid (what we owe, out of the bank, and the SWIFT fee Airwallex
// really charged). Debits equal credits in every entry. The entries are derived from the ledger, so the export is
// always complete; a BookkeepingSink receives them as they happen (the CSV file is the first; a bookkeeping package's
// API can be the next without touching the inbox).

import { appendFileSync, existsSync } from "node:fs";
import { AP_CHART, CHART } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import type { ApInvoiceRow } from "./store.js";
import { apInvoices } from "./store.js";
import { ledgerInvoiceNo } from "./ledgerKey.js";

export const AP_ACCOUNTS = { inputVat: "1510", payable: "2100", bank: "1200", fees: "6800" } as const;

export interface ApEntry {
  date: string;
  invoice_id: string;
  event: "accrual" | "payment";
  account: string;
  account_name: string;
  debit: string;
  credit: string;
  currency: string;
  memo: string;
  doc_sha256: string;
}

/** Where entries go as they happen. push is called once per event; it must not throw for a bookkeeping outage to stop a payment. */
export interface BookkeepingSink {
  readonly name: string;
  push(entries: ApEntry[], invoice: ApInvoiceRow): void | Promise<void>;
}

const MONEY = /^\d+\.\d{2}$/;

/** Whether an invoice belongs in the books: checked clean (ready, waiting or paid), or clean but for a currency paid by hand. */
export function bookable(inv: Pick<ApInvoiceRow, "status" | "findings" | "total">): boolean {
  if (!MONEY.test(inv.total)) return false;
  if (inv.status === "ready" || inv.status === "waiting_cfo" || inv.status === "paid") return true;
  return inv.status === "needs_review" && inv.findings.every((f) => f.level === "warn" || f.code === "currency_not_paid");
}

const line = (inv: ApInvoiceRow, event: ApEntry["event"], date: string, account: string, debitCents: number, creditCents: number, memo: string): ApEntry => ({
  date, invoice_id: inv.id, event, account, account_name: CHART[account] ?? AP_CHART[account] ?? "", debit: debitCents ? fromCents(debitCents) : "", credit: creditCents ? fromCents(creditCents) : "",
  currency: inv.currency, memo, doc_sha256: inv.doc_sha256,
});

/** The invoice as received: expense (net) and input VAT on the debit side, the supplier's claim on the credit side. */
export function accrualEntries(inv: ApInvoiceRow): ApEntry[] {
  const total = toCents(inv.total);
  const tax = MONEY.test(inv.tax) && toCents(inv.tax) > 0 && toCents(inv.tax) < total ? toCents(inv.tax) : 0;
  const date = inv.issue_date || inv.received_at.slice(0, 10);
  const memo = `${inv.vendor} invoice ${inv.invoice_no}`;
  return [
    line(inv, "accrual", date, inv.gl_account, total - tax, 0, memo),
    ...(tax ? [line(inv, "accrual", date, AP_ACCOUNTS.inputVat, tax, 0, `${memo}: input VAT`)] : []),
    line(inv, "accrual", date, AP_ACCOUNTS.payable, 0, total, memo),
  ];
}

/** The payment, from the ledger's transfer for this invoice: the claim settled from the bank, and the fee charged. */
export function paymentEntries(db: DB, inv: ApInvoiceRow): ApEntry[] {
  const t = db.prepare("SELECT transfer_id, amount, fee_actual, updated_at FROM transfers WHERE invoice_no = ? AND status = 'PAID' ORDER BY updated_at DESC").get(ledgerInvoiceNo(inv.invoice_no, inv.vendor)) as
    { transfer_id: string | null; amount: string; fee_actual: string | null; updated_at: string } | undefined;
  if (!t) return [];
  const date = (inv.paid_at ?? t.updated_at).slice(0, 10);
  const memo = `${inv.vendor} invoice ${inv.invoice_no}, Airwallex transfer ${t.transfer_id ?? "(no id)"}`;
  const amount = toCents(t.amount);
  const out = [line(inv, "payment", date, AP_ACCOUNTS.payable, amount, 0, memo), line(inv, "payment", date, AP_ACCOUNTS.bank, 0, amount, memo)];
  const fee = t.fee_actual && new RegExp(`^${inv.currency} \\d+\\.\\d{2}$`).test(t.fee_actual) ? toCents(t.fee_actual.split(" ")[1]!) : 0;
  if (fee) out.push(line(inv, "payment", date, AP_ACCOUNTS.fees, fee, 0, `${memo}: SWIFT fee`), line(inv, "payment", date, AP_ACCOUNTS.bank, 0, fee, `${memo}: SWIFT fee`));
  return out;
}

/** Every payables entry, in order: what the export and the insight read. */
export function apJournal(db: DB): ApEntry[] {
  return apInvoices(db).flatMap((inv) => (bookable(inv) ? [...accrualEntries(inv), ...(inv.status === "paid" ? paymentEntries(db, inv) : [])] : []));
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (header: string[], rows: string[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

export const JOURNAL_COLUMNS = ["date", "invoice_id", "event", "account", "account_name", "debit", "credit", "currency", "memo", "doc_sha256"] as const;

export function journalCsv(entries: ApEntry[]): string {
  return csv([...JOURNAL_COLUMNS], entries.map((e) => JOURNAL_COLUMNS.map((k) => e[k])));
}

export const INVOICE_COLUMNS = ["id", "vendor", "invoice_no", "issue_date", "due_date", "currency", "subtotal", "tax", "total", "gl_account", "cost_centre", "status", "read_by", "received_at", "paid_at", "doc_sha256"] as const;

export function invoicesCsv(invs: ApInvoiceRow[]): string {
  return csv([...INVOICE_COLUMNS], invs.map((i) => INVOICE_COLUMNS.map((k) => String(i[k] ?? ""))));
}

/** The first sink: appends each event's entries to one CSV file, for any bookkeeping package's import. */
export class CsvFileSink implements BookkeepingSink {
  readonly name = "csv";
  constructor(private readonly path: string) {}
  push(entries: ApEntry[]): void {
    if (entries.length === 0) return;
    const body = journalCsv(entries);
    appendFileSync(this.path, existsSync(this.path) ? body.slice(body.indexOf("\n") + 1) : body);
  }
}

/** Hands an event's entries to the sink; a sink that fails is logged by the caller, never fatal. */
export async function pushToSink(sink: BookkeepingSink | undefined, entries: ApEntry[], inv: ApInvoiceRow): Promise<string | null> {
  if (!sink || entries.length === 0) return null;
  try {
    await sink.push(entries, inv);
    return null;
  } catch (e) {
    return `${sink.name}: ${(e as Error).message}`;
  }
}
