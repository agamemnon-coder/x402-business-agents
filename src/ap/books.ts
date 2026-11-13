// Payables, part 4: the books. Every checked invoice is booked when it comes in (accrual: the expense, the input VAT,
// and what we owe the supplier), and again when it is paid (what we owe, out of the bank, and the SWIFT fee Airwallex
// really charged). Debits equal credits in every entry. The entries are derived from the ledger, so the export is
// always complete; a BookkeepingSink receives them as they happen (the CSV file is the first; a bookkeeping package's
// API can be the next without touching the inbox).

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { audit } from "../audit/log.js";
import { AP_CHART, bankAccountFor, CHART, LEDGER_CHART } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { csvCell } from "../lib/csv.js";
import { fromCents, toCents } from "../lib/money.js";
import { VAT_CODES, vatOn } from "../ledger/vat.js";
import { signedTermsRefusal } from "../ledger/termsLock.js";
import type { ApInvoiceRow, StoredCoding } from "./store.js";
import { apInvoices } from "./store.js";
import { ledgerInvoiceNo } from "./ledgerKey.js";
import { paymentDay } from "../vault/data.js";

export const AP_ACCOUNTS = { inputVat: "1510", payable: "2100", bank: "1200", fees: "6800", transit: "1590" } as const;
/** VAT the company itself owes on a reverse-charged purchase (the stored ledger's output VAT account). */
const VAT_OWED = "2210";

/** The Airwallex bank account per currency: EUR, USD and GBP have their own in the chart; others share 1203. */
export { bankAccountFor };

export interface ApEntry {
  date: string;
  invoice_id: string;
  event: "accrual" | "payment" | "reversal";
  account: string;
  account_name: string;
  debit: string;
  credit: string;
  currency: string;
  memo: string;
  doc_sha256: string;
  /** Only on the net lines of an accrual built from the Coder's coding: what the stored ledger keeps on the line. */
  cost_centre?: string;
  vat_code?: string;
  /** The VAT of this line's group in cents: its share of the invoice's VAT, or for a reverse-charge code the VAT the company owes itself. */
  vat_cents?: number;
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
  return inv.status === "needs_review" && inv.findings.every((f) => f.level === "warn" || f.code === "currency_not_paid" || f.code === "country_not_paid");
}

const line = (inv: ApInvoiceRow, event: ApEntry["event"], date: string, account: string, debitCents: number, creditCents: number, memo: string, currency = inv.currency): ApEntry => ({
  date, invoice_id: inv.id, event, account, account_name: CHART[account] ?? AP_CHART[account] ?? LEDGER_CHART[account] ?? "", debit: debitCents ? fromCents(debitCents) : "", credit: creditCents ? fromCents(creditCents) : "",
  currency, memo, doc_sha256: inv.doc_sha256,
});

/** The Dutch purchase VAT code an invoice's own tax amounts to (21% or 9% of its net, within a cent), or null: the engine's own VAT coding. */
/**
 * The VAT a supplier abroad charged, by its VAT id's country and the rate it charged: German 19% (13 Nov). Such VAT is
 * not reclaimable in the Dutch return; it is coded so it counts on its own row, never as Dutch input tax.
 */
export function foreignVat(netCents: number, vatCents: number, supplierVatId: string | null | undefined): "PF_DE19" | null {
  if (!/^DE\d{9}$/.test((supplierVatId ?? "").replace(/\s/g, "").toUpperCase()) || vatCents <= 0) return null;
  return Math.abs(Math.round((netCents * 19) / 100) - vatCents) <= 1 ? "PF_DE19" : null;
}

export function dutchVat(netCents: number, vatCents: number): "P21" | "P9" | null {
  if (Math.abs(Math.round((netCents * 21) / 100) - vatCents) <= 1) return "P21";
  if (Math.abs(Math.round((netCents * 9) / 100) - vatCents) <= 1) return "P9";
  return null;
}

const cents = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

/**
 * The Coder's coding an accrual is built from, or null (then the engine's own accrual is booked). Code does not take
 * a stored coding on trust: it must have lines, its amounts must be the invoice row's own total to the cent, every
 * account must be an expense account of the chart, and every VAT code a purchase code. Its VAT must stay below the
 * total and sit on lines with a net, as the engine's own accrual requires: VAT with no expense under it would be booked
 * as input VAT that no VAT code supports.
 */
function bookedCoding(inv: ApInvoiceRow): StoredCoding | null {
  const c = inv.coding;
  if (!c || !Array.isArray(c.lines) || c.lines.length === 0 || !MONEY.test(inv.total)) return null;
  const sound = c.lines.every((l) => cents(l.net_cents) && cents(l.vat_cents) && /^[56]\d{3}$/.test(l.account) && l.account in CHART && typeof l.cost_centre === "string" && l.cost_centre !== ""
    && (l.vat_code === null || VAT_CODES[l.vat_code]?.kind === "purchase") && (l.vat_cents === 0 || l.net_cents > 0));
  const sum = c.lines.reduce((s, l) => s + l.net_cents + l.vat_cents, 0);
  const vat = c.lines.reduce((s, l) => s + l.vat_cents, 0);
  return sound && vat < sum && sum === toCents(inv.total) && c.total_cents === sum ? c : null;
}

/** Whether this invoice's accrual is built from the Coder's coding (and not the engine's own one-line coding). */
export const codedAccrual = (inv: ApInvoiceRow): boolean => bookedCoding(inv) !== null;

/**
 * The accrual from the Coder's coding: one debit per group of lines with the same account, cost centre and VAT code,
 * in the order they first appear; the VAT the invoice charges to input VAT; for a reverse-charge group the VAT the
 * company owes itself, as input VAT and as VAT owed (nothing extra goes to the supplier); and the invoice's total as
 * what is owed. Debits equal credits.
 */
function codedEntries(inv: ApInvoiceRow, c: StoredCoding, date: string, memo: string): ApEntry[] {
  const groups: { account: string; cost_centre: string; vat_code: string | null; net: number; vat: number }[] = [];
  for (const l of c.lines) {
    let g = groups.find((x) => x.account === l.account && x.cost_centre === l.cost_centre && x.vat_code === l.vat_code);
    if (!g) groups.push(g = { account: l.account, cost_centre: l.cost_centre, vat_code: l.vat_code, net: 0, vat: 0 });
    g.net += l.net_cents;
    g.vat += l.vat_cents;
  }
  const out: ApEntry[] = [];
  const owed: number[] = [];
  for (const g of groups) {
    // A group without a net has nothing to book.
    if (g.net === 0) continue;
    const reverse = g.vat_code !== null && VAT_CODES[g.vat_code]?.reverse === true;
    const self = reverse ? vatOn(g.net, g.vat_code!) : 0;
    out.push({ ...line(inv, "accrual", date, g.account, g.net, 0, memo), cost_centre: g.cost_centre, ...(g.vat_code !== null ? { vat_code: g.vat_code, vat_cents: reverse ? self : g.vat } : {}) });
    if (self) owed.push(self);
  }
  const vat = c.lines.reduce((s, l) => s + l.vat_cents, 0);
  if (vat) out.push(line(inv, "accrual", date, AP_ACCOUNTS.inputVat, vat, 0, `${memo}: input VAT`));
  for (const self of owed) {
    out.push(line(inv, "accrual", date, AP_ACCOUNTS.inputVat, self, 0, `${memo}: input VAT, reverse charge`), line(inv, "accrual", date, VAT_OWED, 0, self, `${memo}: VAT owed, reverse charge`));
  }
  out.push(line(inv, "accrual", date, AP_ACCOUNTS.payable, 0, toCents(inv.total), memo));
  return out;
}

/**
 * The invoice as received: expense (net) and input VAT on the debit side, the supplier's claim on the credit side.
 * An invoice the Coder coded (KIT11_AP_AGENTS=on, src/ap/coderAgent.ts) is booked from that coding, line group by
 * line group; any other exactly as before: its net to the row's own account.
 */
export function accrualEntries(inv: ApInvoiceRow): ApEntry[] {
  const total = toCents(inv.total);
  const tax = MONEY.test(inv.tax) && toCents(inv.tax) > 0 && toCents(inv.tax) < total ? toCents(inv.tax) : 0;
  const date = inv.issue_date || inv.received_at.slice(0, 10);
  const memo = `${inv.vendor} invoice ${inv.invoice_no}`;
  const coding = bookedCoding(inv);
  if (coding) return codedEntries(inv, coding, date, memo);
  return [
    line(inv, "accrual", date, inv.gl_account, total - tax, 0, memo),
    ...(tax ? [line(inv, "accrual", date, AP_ACCOUNTS.inputVat, tax, 0, `${memo}: input VAT`)] : []),
    line(inv, "accrual", date, AP_ACCOUNTS.payable, 0, total, memo),
  ];
}

/**
 * The payment, from the ledger's transfer for this invoice: the claim settled from the invoice currency's bank account,
 * and the fee charged. A supplier payment funded by a conversion also books that conversion, each side in its own
 * currency through money in transit (1590), so every entry balances per currency.
 */
export function paymentEntries(db: DB, inv: ApInvoiceRow): ApEntry[] {
  const t = db.prepare("SELECT transfer_id, amount, fee_actual, updated_at FROM transfers WHERE invoice_no = ? AND status = 'PAID' ORDER BY updated_at DESC").get(ledgerInvoiceNo(inv.invoice_no, inv.vendor)) as
    { transfer_id: string | null; amount: string; fee_actual: string | null; updated_at: string } | undefined;
  if (!t) return [];
  // Dated as the ledger dates the payment (a month closed before it was posted is never posted into: red team round 3).
  const date = inv.paid_at ? paymentDay(db, inv) : t.updated_at.slice(0, 10);
  const memo = `${inv.vendor} invoice ${inv.invoice_no}, Airwallex transfer ${t.transfer_id ?? "(no id)"}`;
  const amount = toCents(t.amount);
  const bank = bankAccountFor(inv.currency);
  const out: ApEntry[] = [];
  const p = inv.proposal_id ? db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ? AND status = 'EXECUTED'").get(inv.proposal_id) as { kind: string; terms_json: string } | undefined : undefined;
  const c = p?.kind === "supplier_payment" ? (JSON.parse(p.terms_json) as { conversion: null | { buy_currency: string; buy_amount: string; sell_currency: string; sell_amount: string; client_rate: string; quote_id: string } }).conversion : null;
  if (c) {
    const fx = `${memo}: bought ${c.buy_currency} ${c.buy_amount} for ${c.sell_currency} ${c.sell_amount} (rate ${c.client_rate}, quote ${c.quote_id})`;
    out.push(
      line(inv, "payment", date, bankAccountFor(c.buy_currency), toCents(c.buy_amount), 0, fx, c.buy_currency), line(inv, "payment", date, AP_ACCOUNTS.transit, 0, toCents(c.buy_amount), fx, c.buy_currency),
      line(inv, "payment", date, AP_ACCOUNTS.transit, toCents(c.sell_amount), 0, fx, c.sell_currency), line(inv, "payment", date, bankAccountFor(c.sell_currency), 0, toCents(c.sell_amount), fx, c.sell_currency),
    );
  }
  out.push(line(inv, "payment", date, AP_ACCOUNTS.payable, amount, 0, memo), line(inv, "payment", date, bank, 0, amount, memo));
  const m = t.fee_actual ? /^([A-Z]{3}) (\d+\.\d{2})$/.exec(t.fee_actual) : null;
  const fee = m ? toCents(m[2]!) : 0;
  if (m && fee) out.push(line(inv, "payment", date, AP_ACCOUNTS.fees, fee, 0, `${memo}: transfer fee`, m[1]!), line(inv, "payment", date, bankAccountFor(m[1]!), 0, fee, `${memo}: transfer fee`, m[1]!));
  // Purser as an Airwallex platform: Purser's own fee for this payout, once it was taken (docs/airwallex-platform.md).
  if (inv.proposal_id && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'platform_fees'").get()) {
    for (const f of db.prepare("SELECT amount, currency, fee_transfer_id FROM platform_fees WHERE proposal_id = ? AND status = 'SETTLED'").all(inv.proposal_id) as { amount: string; currency: string; fee_transfer_id: string | null }[]) {
      const pf = `${memo}: Purser platform fee (${f.fee_transfer_id ?? "no id"})`;
      out.push(line(inv, "payment", date, AP_ACCOUNTS.fees, toCents(f.amount), 0, pf, f.currency), line(inv, "payment", date, bankAccountFor(f.currency), 0, toCents(f.amount), pf, f.currency));
    }
  }
  return out;
}

/**
 * Why this invoice must not be booked, or null: it was approved under a signed proposal and its stored terms no longer
 * hash to the hash the CFO signed, or name another amount or currency than the invoice (the books' lock, master list 77).
 */
export function bookingRefusal(db: DB, inv: ApInvoiceRow): string | null {
  if (!inv.proposal_id || !MONEY.test(inv.total)) return null;
  return signedTermsRefusal(db, inv.proposal_id, { amount_cents: toCents(inv.total), currency: inv.currency });
}

/** Every payables entry, in order: what the export and the insight read. */
export function apJournal(db: DB): ApEntry[] {
  // An invoice whose signed terms changed after the CFO's approval is not booked here either (src/ledger/termsLock.ts).
  return apInvoices(db).flatMap((inv) => (bookable(inv) && !bookingRefusal(db, inv) ? [...accrualEntries(inv), ...(inv.status === "paid" ? paymentEntries(db, inv) : [])] : []));
}

const csv = (header: string[], rows: string[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

export const JOURNAL_COLUMNS = ["date", "invoice_id", "event", "account", "account_name", "debit", "credit", "currency", "memo", "doc_sha256"] as const;

export function journalCsv(entries: ApEntry[]): string {
  return csv([...JOURNAL_COLUMNS], entries.map((e) => JOURNAL_COLUMNS.map((k) => e[k])));
}

export const INVOICE_COLUMNS = ["id", "vendor", "invoice_no", "issue_date", "due_date", "currency", "subtotal", "tax", "total", "gl_account", "cost_centre", "status", "read_by", "received_at", "paid_at", "doc_sha256"] as const;

export function invoicesCsv(invs: ApInvoiceRow[]): string {
  return csv([...INVOICE_COLUMNS], invs.map((i) => INVOICE_COLUMNS.map((k) => String(i[k] ?? ""))));
}

/** The accrual taken back when the CFO rejects the payment (or a person rejects the invoice): the same lines, debit and credit swapped. */
export function reversalEntries(inv: ApInvoiceRow, date: string, why = "the CFO rejected the payment"): ApEntry[] {
  return accrualEntries(inv).map((e) => ({ ...e, event: "reversal" as const, date, debit: e.credit, credit: e.debit, memo: `${e.memo}: reversed, ${why}` }));
}

/** The first sink: appends each event's entries to one CSV file, for any bookkeeping package's import. */
export class CsvFileSink implements BookkeepingSink {
  readonly name = "csv";
  constructor(private readonly path: string) {}
  push(entries: ApEntry[]): void {
    if (entries.length === 0) return;
    mkdirSync(dirname(this.path), { recursive: true });
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

/** The sink this installation books to: the CSV journal in the payables folder (KIT11_AP_DIR, default data/ap). */
export function payablesSink(env: Record<string, string | undefined> = process.env): BookkeepingSink {
  return new CsvFileSink(join(env.KIT11_AP_DIR ?? "data/ap", "journal.csv"));
}

/**
 * Hands one event of one invoice to the sink, once (ap_sink_events): a second call does nothing, a failed push is
 * logged and tried again on the next call. Without a sink nothing is recorded, so a later call with one still pushes.
 */
export async function pushOnce(db: DB, sink: BookkeepingSink | undefined, event: ApEntry["event"], entries: ApEntry[], inv: ApInvoiceRow, now: Date): Promise<boolean> {
  if (!sink || entries.length === 0) return false;
  if (db.prepare("SELECT 1 FROM ap_sink_events WHERE invoice_id = ? AND event = ? AND sink = ?").get(inv.id, event, sink.name)) return false;
  const failed = await pushToSink(sink, entries, inv);
  if (failed) { audit(db, "system", "ap.sink_failed", inv.id, { sink: failed, event }, now); return false; }
  db.prepare("INSERT OR IGNORE INTO ap_sink_events (invoice_id, event, sink, pushed_at) VALUES (?, ?, ?, ?)").run(inv.id, event, sink.name, now.toISOString());
  return true;
}

/** Whether this invoice's accrual reached the sink. */
export const accrualPushed = (db: DB, inv: ApInvoiceRow, sink: BookkeepingSink): boolean =>
  !!db.prepare("SELECT 1 FROM ap_sink_events WHERE invoice_id = ? AND event = 'accrual' AND sink = ?").get(inv.id, sink.name);
