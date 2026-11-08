// What the vault's documents are made from. Every figure is read from the payables tables (ap_invoices,
// ap_documents), the payment ledger (proposals, approvals, transfers, beneficiaries) and the stored ledger (src/ledger);
// nothing is estimated here. Each document's data has a stable key and is hashed, so the vault can tell whether it
// changed since it was filed.

import { createHash } from "node:crypto";
import { ledgerInvoiceNo } from "../ap/ledgerKey.js";
import { apInvoice, apInvoices, type ApInvoiceRow } from "../ap/store.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { postingDay } from "../ledger/core.js";
import { balanceSheet, profitAndLoss, quarterRange, trialBalance, vatOverview, type VatOverview } from "../ledger/reports.js";

const MONEY = /^\d+\.\d{2}$/;
const OPEN = new Set(["ready", "waiting_cfo", "needs_vendor", "needs_review"]);
const NOT_FOR_BOOKING = new Set(["blocked", "rejected"]);

/** A stable hash of a document's data (keys sorted), so the same data always hashes the same. */
export function dataSha(data: unknown): string {
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canon(data))).digest("hex");
}

const day = (iso: string | null | undefined) => (iso ?? "").slice(0, 10);
const invoiceDay = (i: Pick<ApInvoiceRow, "issue_date" | "received_at">) => /^\d{4}-\d{2}-\d{2}$/.test(i.issue_date) ? i.issue_date : day(i.received_at);

// ---------- invoices ----------

export interface InvoiceDoc {
  key: string; id: string; vendor: string; invoice_no: string; date: string; currency: string; total: string; status: string;
  blocked: boolean; doc_sha256: string; doc_path: string;
}

/** Every received invoice with its original document; blocked or rejected ones are marked (not for booking). */
export function invoiceDocs(db: DB): InvoiceDoc[] {
  return apInvoices(db).flatMap((i): InvoiceDoc[] => {
    const doc = db.prepare("SELECT path FROM ap_documents WHERE sha256 = ?").get(i.doc_sha256) as { path: string } | undefined;
    if (!doc) return [];
    return [{
      key: `invoice:${i.id}`, id: i.id, vendor: i.vendor || "Onbekende leverancier", invoice_no: i.invoice_no || i.id, date: invoiceDay(i),
      currency: i.currency || "XXX", total: MONEY.test(i.total) ? i.total : "0.00", status: i.status, blocked: NOT_FOR_BOOKING.has(i.status),
      doc_sha256: i.doc_sha256, doc_path: doc.path,
    }];
  });
}

// ---------- payment receipts ----------

export interface ReceiptData {
  key: string; id: string; vendor: string; invoice_no: string; invoice_date: string; due_date: string; reference: string;
  currency: string; amount: string; paid_at: string; proposal_id: string; terms_sha256: string;
  transfer_id: string | null; fee: string | null; method: string;
  fx: { rate: string; bought: string; sold: string } | null;
  approval: { approver: string; method: string; at: string; signed_sha256: string } | null;
  cosigner: string | null;
  /** The supplier's account as the approved terms show it: "•••• 3000 · BIC COBADEFFXXX" for a EUR invoice payment,
   *  the masked account and its clearing code for a supplier payment in any currency (FX payouts). */
  account: string;
}

/** The two payment kinds an inbox invoice is paid with (src/agents/euroBill.ts, src/payouts/plan.ts), as far as a
 *  receipt reads them. */
interface PaidTerms {
  kind?: string; amount: string; currency: string; reference: string; method: string; transfer_request_id?: string;
  iban_last4?: string; bic?: string; account?: string; clearing?: string | null;
  conversion: { client_rate: string; buy_currency: string; buy_amount: string; sell_currency: string; sell_amount: string } | null;
}

/**
 * The day a paid invoice's payment is in the books: the posting date the ledger gave its transfer, or, before the ledger
 * posted it, the day the ledger will post it on (its own day, or the first open month's first day when its month is
 * closed). The vault and the month reports date payments by it, so a closed month is never changed by a later payment
 * (red team round 3).
 */
export function paymentDay(db: DB, inv: ApInvoiceRow): string {
  const own = day(inv.paid_at);
  const terms = inv.proposal_id ? db.prepare("SELECT json_extract(terms_json, '$.transfer_request_id') AS rid FROM proposals WHERE proposal_id = ?").get(inv.proposal_id) as { rid: string | null } | undefined : undefined;
  const posted = terms?.rid
    ? db.prepare("SELECT posting_date FROM ledger_entries WHERE source_key LIKE ? AND reverses IS NULL ORDER BY entry_id LIMIT 1").get(`transfer|${terms.rid}|%`) as { posting_date: string } | undefined
    : undefined;
  return posted?.posting_date ?? (own ? postingDay(db, own) : own);
}

/** The moment a receipt names: when the invoice was marked paid, or the books' day when the ledger dates it otherwise. */
function paidAtInBooks(db: DB, inv: ApInvoiceRow): string {
  const books = paymentDay(db, inv);
  return books && books !== day(inv.paid_at) ? books : inv.paid_at ?? "";
}

/**
 * An invoice's status at a moment, from its status changes in the audit log (each records from and to): the last change
 * up to then, or the status before its first change; the current status when it never changed.
 */
export function statusAt(db: DB, inv: ApInvoiceRow, at: string): string {
  const changes = db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = 'ap.status' AND subject = ? ORDER BY seq").all(inv.id) as { ts: string; payload_json: string }[];
  if (changes.length === 0) return inv.status;
  const upTo = changes.filter((c) => c.ts <= at);
  const last = upTo.at(-1) ?? null;
  return last ? (JSON.parse(last.payload_json) as { to: string }).to : (JSON.parse(changes[0]!.payload_json) as { from: string }).from;
}

/** The receipt of a paid inbox invoice, or null when it is not paid (or its payment is not in the ledger). Either payment
 *  kind: the EUR invoice payment and the multi-currency supplier payment. */
export function receiptData(db: DB, id: string): ReceiptData | null {
  const inv = apInvoice(db, id);
  if (!inv || inv.status !== "paid" || !inv.proposal_id) return null;
  const p = db.prepare("SELECT terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(inv.proposal_id) as { terms_json: string; terms_sha256: string } | undefined;
  if (!p) return null;
  const terms = JSON.parse(p.terms_json) as PaidTerms;
  // The payout this proposal made (both kinds name it in their terms); an older proposal without the key by invoice number.
  const t = (terms.transfer_request_id
    ? db.prepare("SELECT transfer_id, fee_actual FROM transfers WHERE request_id = ? AND status = 'PAID'").get(terms.transfer_request_id)
    : db.prepare("SELECT transfer_id, fee_actual FROM transfers WHERE invoice_no = ? AND status = 'PAID' ORDER BY updated_at DESC").get(ledgerInvoiceNo(inv.invoice_no, inv.vendor))) as { transfer_id: string | null; fee_actual: string | null } | undefined;
  const a = db.prepare("SELECT approver, method, created_at, approved_sha256 FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(inv.proposal_id) as { approver: string; method: string; created_at: string; approved_sha256: string } | undefined;
  const co = db.prepare("SELECT approver FROM cosignatures WHERE proposal_id = ? ORDER BY created_at, rowid LIMIT 1").get(inv.proposal_id) as { approver: string } | undefined;
  const c = terms.conversion;
  return {
    key: `receipt:${inv.id}`, id: inv.id, vendor: inv.vendor, invoice_no: inv.invoice_no, invoice_date: invoiceDay(inv), due_date: inv.due_date,
    // Dated as the ledger dates the payment: the moment it was marked paid, unless the books put it on another day.
    reference: terms.reference, currency: terms.currency, amount: terms.amount, paid_at: paidAtInBooks(db, inv), proposal_id: inv.proposal_id,
    terms_sha256: p.terms_sha256, transfer_id: t?.transfer_id ?? null, fee: t?.fee_actual ?? null, method: terms.method,
    fx: c ? { rate: c.client_rate, bought: `${c.buy_currency} ${c.buy_amount}`, sold: `${c.sell_currency} ${c.sell_amount}` } : null,
    approval: a ? { approver: a.approver, method: a.method, at: a.created_at, signed_sha256: a.approved_sha256 } : null,
    cosigner: co && a && co.approver !== a.approver ? co.approver : null,
    account: terms.kind === "supplier_payment"
      ? [terms.account, terms.clearing].filter((x): x is string => !!x).join(" · ")
      : `•••• ${terms.iban_last4 ?? "????"} · BIC ${terms.bic ?? "?"}`,
  };
}

export function receipts(db: DB): ReceiptData[] {
  return apInvoices(db, { status: "paid" }).flatMap((i) => { const r = receiptData(db, i.id); return r ? [r] : []; });
}

// ---------- month report ----------

export interface Amounts { currency: string; total: string; count: number }
export interface MonthData {
  key: string; month: string; from: string; to: string;
  received: Amounts[];
  paid: { vendor: string; invoice_no: string; amount: string; paid_on: string }[];
  open: { vendor: string; invoice_no: string; amount: string; due_date: string; status: string }[];
  blocked: { vendor: string; invoice_no: string; amount: string; reasons: string[]; why?: { code: string; detail: string; signals: string[] }[] }[];
  spend: { vendor: string; currency: string; total: string; count: number }[];
  fees: Amounts[];
  fx: { conversions: number; bought: Amounts[]; sold: Amounts[] };
  pnl: { currency: string; revenue: string; expense: string; result: string; accounts: { account: string; name: string; amount: string }[] }[];
}

function sumBy<T>(rows: T[], key: (r: T) => string, cents: (r: T) => number): Map<string, { cents: number; count: number }> {
  const m = new Map<string, { cents: number; count: number }>();
  for (const r of rows) { const k = key(r); const x = m.get(k) ?? { cents: 0, count: 0 }; m.set(k, { cents: x.cents + cents(r), count: x.count + 1 }); }
  return m;
}

const amounts = (m: Map<string, { cents: number; count: number }>): Amounts[] =>
  [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, x]) => ({ currency, total: fromCents(x.cents), count: x.count }));

const signed = (cents: number) => (cents < 0 ? `-${fromCents(-cents)}` : fromCents(cents));

function pnlRows(r: ReturnType<typeof profitAndLoss>): MonthData["pnl"] {
  return Object.entries(r).sort(([a], [b]) => a.localeCompare(b)).map(([currency, p]) => ({
    currency, revenue: signed(p.revenue_cents), expense: signed(p.expense_cents), result: signed(p.result_cents),
    accounts: p.accounts.map((a) => ({ account: a.account, name: a.name, amount: signed(a.cents) })),
  }));
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * A month's report, as the books stood at the month's end (red team round 3): payments dated by the ledger
 * (paymentDay), and the open and blocked invoices with their status at the end of the month. Once the month is closed,
 * nothing that happens later changes it, so the vault never files a correction for it.
 */
export function monthData(db: DB, month: string): MonthData {
  const { from, to } = monthRange(month);
  const end = `${to}T23:59:59.999Z`;
  const inMonth = (iso: string | null) => !!iso && iso.slice(0, 7) === month;
  // Credit notes are not invoices received or open to pay (screenshot pass S2): a person sets them against invoices.
  const all = apInvoices(db).filter((i) => MONEY.test(i.total) && i.currency && i.doc_kind !== "credit_note");
  const received = all.filter((i) => inMonth(i.received_at));
  const paidOn = new Map(all.filter((i) => i.status === "paid").map((i) => [i.id, paymentDay(db, i)]));
  const paid = all.filter((i) => inMonth(paidOn.get(i.id) ?? null));
  const atEnd = new Map(all.filter((i) => day(i.received_at) <= to).map((i) => [i.id, statusAt(db, i, end)]));
  const open = all.filter((i) => OPEN.has(atEnd.get(i.id) ?? "") && !((paidOn.get(i.id) ?? "9999") <= to));
  const blocked = received.filter((i) => atEnd.get(i.id) === "blocked");
  const spend = sumBy(paid, (i) => `${i.vendor}\u0000${i.currency}`, (i) => toCents(i.total));
  // What Airwallex charged for the month's payments, and the FX bought for them (from the approved terms).
  const fees: { currency: string; total: string }[] = [];
  const bought: { currency: string; total: string }[] = [];
  const sold: { currency: string; total: string }[] = [];
  for (const i of paid) {
    const r = receiptData(db, i.id);
    if (r?.fee && /^[A-Z]{3} \d+\.\d{2}$/.test(r.fee)) fees.push({ currency: r.fee.slice(0, 3), total: r.fee.slice(4) });
    if (r?.fx) {
      bought.push({ currency: r.fx.bought.slice(0, 3), total: r.fx.bought.slice(4) });
      sold.push({ currency: r.fx.sold.slice(0, 3), total: r.fx.sold.slice(4) });
    }
  }
  const byCur = (xs: { currency: string; total: string }[]) => amounts(sumBy(xs, (x) => x.currency, (x) => toCents(x.total)));
  return {
    key: `month:${month}`, month, from, to,
    received: byCur(received),
    paid: paid.map((i) => ({ vendor: i.vendor, invoice_no: i.invoice_no, amount: `${i.currency} ${i.total}`, paid_on: paidOn.get(i.id)! })),
    open: open.map((i) => ({ vendor: i.vendor, invoice_no: i.invoice_no, amount: `${i.currency} ${i.total}`, due_date: i.due_date, status: atEnd.get(i.id)! })),
    blocked: blocked.map((i) => ({ vendor: i.vendor, invoice_no: i.invoice_no, amount: `${i.currency} ${i.total}`, reasons: i.findings.filter((f) => f.level === "block").map((f) => f.detail),
      why: i.findings.filter((f) => f.level === "block").map((f) => ({ code: f.code, detail: f.detail, signals: (f.signals ?? []).map((x) => x.code) })) })),
    spend: [...spend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => { const [vendor, currency] = k.split("\u0000") as [string, string]; return { vendor, currency, total: fromCents(x.cents), count: x.count }; }),
    fees: byCur(fees),
    fx: { conversions: bought.length, bought: byCur(bought), sold: byCur(sold) },
    pnl: pnlRows(profitAndLoss(db, { from, to })),
  };
}

// ---------- VAT, year, suppliers ----------

export function vatData(db: DB, quarter: string): VatOverview & { key: string } {
  return { key: `vat:${quarter}`, ...vatOverview(db, quarter) };
}

export interface YearData {
  key: string; year: number;
  pnl: MonthData["pnl"];
  balance: { currency: string; assets: string; liabilities: string; equity: string; result: string; balanced: boolean; accounts: { account: string; name: string; type: string; amount: string }[] }[];
  trial: { account: string; name: string; currency: string; debit: string; credit: string; balance: string }[];
}

export function yearData(db: DB, year: number): YearData {
  const to = `${year}-12-31`;
  return {
    key: `year:${year}`, year,
    pnl: pnlRows(profitAndLoss(db, { from: `${year}-01-01`, to })),
    balance: Object.entries(balanceSheet(db, to)).sort(([a], [b]) => a.localeCompare(b)).map(([currency, b]) => ({
      currency, assets: signed(b.assets_cents), liabilities: signed(b.liabilities_cents), equity: signed(b.equity_cents), result: signed(b.result_cents), balanced: b.balanced,
      accounts: b.accounts.map((a) => ({ account: a.account, name: a.name, type: a.type, amount: signed(a.cents) })),
    })),
    trial: trialBalance(db, to).map((t) => ({ account: t.account, name: t.name, currency: t.currency, debit: fromCents(t.debit_cents), credit: fromCents(t.credit_cents), balance: signed(t.balance_cents) })),
  };
}

export interface SuppliersData { key: string; rows: { name: string; iban_last4: string; bic: string; currency: string; status: string; invoices: number }[] }

/** The suppliers on file (the payment ledger's beneficiaries): only the last four IBAN digits, never the full IBAN. */
export function suppliersData(db: DB): SuppliersData {
  const counts = new Map<string, number>();
  for (const i of apInvoices(db)) counts.set(i.vendor, (counts.get(i.vendor) ?? 0) + 1);
  const rows = (db.prepare("SELECT name, iban_last4, bic, currency, status FROM beneficiaries ORDER BY name, status").all() as { name: string; iban_last4: string; bic: string; currency: string; status: string }[])
    .map((b) => ({ ...b, invoices: counts.get(b.name) ?? 0 }));
  return { key: "suppliers", rows };
}

/** The quarters whose three months are all closed in the ledger, and the closed months and years. */
export function closedPeriods(db: DB): { months: string[]; quarters: string[]; years: number[] } {
  const months = (db.prepare("SELECT month FROM ledger_locks ORDER BY month").all() as { month: string }[]).map((r) => r.month);
  const set = new Set(months);
  const quarters = [...new Set(months.map((m) => `${m.slice(0, 4)}Q${Math.ceil(Number(m.slice(5, 7)) / 3)}`))]
    .filter((q) => { const { from } = quarterRange(q); const m0 = Number(from.slice(5, 7)); return [0, 1, 2].every((k) => set.has(`${q.slice(0, 4)}-${String(m0 + k).padStart(2, "0")}`)); });
  const years = (db.prepare("SELECT source_key FROM ledger_entries WHERE source_key LIKE 'close-year:%' ORDER BY source_key").all() as { source_key: string }[]).map((r) => Number(r.source_key.slice(11)));
  return { months, quarters, years };
}
