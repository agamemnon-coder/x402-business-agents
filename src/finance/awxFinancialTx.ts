// Reconciliation from Airwallex's own ledger: GET /financial_transactions (docs: api/finance/financial_transactions,
// read 12 November 2026) lists every movement on the account with its source (source_id, source_type), gross amount,
// fee and net, per currency. Purser compares each payout and conversion it made with what Airwallex booked for that
// source, exactly, in integer cents. It reads only: it never moves, creates or changes anything.
//
// Behind AIRWALLEX_FINANCIAL_TX=on (off by default). List parameters (docs): from_created_at / to_created_at
// (ISO 8601, inclusive), currency, status (PENDING, SETTLED), source_id, page_num (from 0), page_size (≤ 1000).

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import type { Airwallex } from "../airwallex/client.js";

export const FINANCIAL_TX_FLAG = "AIRWALLEX_FINANCIAL_TX";
export const financialTxOn = (env: Record<string, string | undefined> = process.env): boolean => env[FINANCIAL_TX_FLAG] === "on";

/** A movement as Airwallex books it, amounts in signed integer cents. */
export interface FinancialTx {
  id: string;
  sourceId: string | null;
  sourceType: string;
  transactionType: string;
  currency: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  status: string;
  createdAt: string | null;
  settledAt: string | null;
}

/** Major units (number or numeric string, possibly negative) → signed integer cents; refuses anything finer. */
export function signedCents(v: unknown): number {
  const s = typeof v === "number" ? v.toFixed(6) : String(v ?? "0").trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`not an amount: ${JSON.stringify(v)}`);
  const frac = (m[3] ?? "").padEnd(6, "0");
  if (/[1-9]/.test(frac.slice(2))) throw new Error(`amount finer than a cent: ${s}`);
  const c = Number(m[2]) * 100 + Number(frac.slice(0, 2));
  return m[1] && c !== 0 ? -c : c;
}

interface RawFt { id: string; source_id?: string | null; source_type?: string; transaction_type?: string; currency?: string; amount?: number | string; fee?: number | string | null; net?: number | string | null; status?: string; created_at?: string | null; settled_at?: string | null }

export function toFinancialTx(r: RawFt): FinancialTx {
  return {
    id: r.id, sourceId: r.source_id ?? null, sourceType: r.source_type ?? "", transactionType: r.transaction_type ?? "", currency: r.currency ?? "",
    amountCents: signedCents(r.amount ?? 0), feeCents: signedCents(r.fee ?? 0), netCents: signedCents(r.net ?? 0), status: r.status ?? "",
    createdAt: r.created_at ?? null, settledAt: r.settled_at ?? null,
  };
}

/** The most pages read in one listing; more means the window is too wide for one reconciliation. */
export const MAX_PAGES = 5;

/** Every financial transaction created in [from, to], all pages (page_size 1000, at most MAX_PAGES). */
export async function listFinancialTransactions(api: Pick<Airwallex, "call">, a: { from: string; to: string; currency?: string }): Promise<FinancialTx[]> {
  const out: FinancialTx[] = [];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of financial transactions in ${a.from} … ${a.to}; narrow the window`);
    const r = await api.call<{ items?: RawFt[]; has_more?: boolean }>("GET", "/financial_transactions", undefined, {
      from_created_at: a.from, to_created_at: a.to, page_num: String(page), page_size: "1000", ...(a.currency ? { currency: a.currency } : {}),
    });
    if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's financial transactions came without items");
    out.push(...r.items.map(toFinancialTx));
    if (r.has_more !== true) return out;
  }
}

/** One movement in Purser's ledger, keyed by the Airwallex id of its source (a transfer or a conversion). */
export type LedgerMovement =
  | { kind: "payout"; sourceId: string; label: string; currency: string; amountCents: number; feeCents: number | null }
  | { kind: "conversion"; sourceId: string; label: string; buyCurrency: string; buyCents: number; sellCurrency: string; sellCents: number }
  | { kind: "deposit"; sourceId: string; label: string; currency: string; amountCents: number };

export interface MovementCheck {
  sourceId: string;
  kind: LedgerMovement["kind"];
  label: string;
  agrees: boolean;
  /** How Airwallex's rows matched, in words: which fields carry the amount and the fee. */
  how: string;
  ledger: string;
  airwallex: string;
  rows: number;
}

export interface Reconciliation {
  checked: number;
  agree: number;
  differences: MovementCheck[];
  movements: MovementCheck[];
  /** Payouts and conversions Airwallex booked in the window that the ledger does not hold. */
  unknownAtAirwallex: { id: string; sourceId: string | null; sourceType: string; currency: string; amount: string }[];
  /** Everything else in the window, counted by source type (cards, payments, …): outside this reconciliation. */
  outOfScope: Record<string, number>;
}

const abs = Math.abs;
const sum = (rows: FinancialTx[], f: (r: FinancialTx) => number) => rows.reduce((s, r) => s + f(r), 0);
const money = (cur: string, c: number) => `${cur} ${c < 0 ? "-" : ""}${fromCents(abs(c))}`;
/** Source types a payout or conversion of Purser's books: one Airwallex holds that the ledger lacks is reported. */
const TRACKED = new Set(["PAYOUT", "FEE", "CONVERSION"]);

/**
 * Compares the ledger's movements with Airwallex's financial transactions, exactly. A payout agrees when the rows for its
 * transfer id, in its currency, carry exactly the amount and the fee: as the sandbox books it, a PAYOUT row for the
 * amount and a FEE row for the fee; or, in one row, the fee in its own field or inside the gross. A conversion agrees
 * when its buy and sell currencies each carry exactly the amounts the ledger holds. Cancelled rows are not counted.
 */
export function reconcileFinancialTransactions(ledger: LedgerMovement[], fts: FinancialTx[]): Reconciliation {
  const live = fts.filter((f) => f.status !== "CANCELLED");
  const bySource = new Map<string, FinancialTx[]>();
  for (const f of live) if (f.sourceId) bySource.set(f.sourceId, [...(bySource.get(f.sourceId) ?? []), f]);
  const movements: MovementCheck[] = ledger.map((m) => {
    const rows = bySource.get(m.sourceId) ?? [];
    if (m.kind === "payout") {
      const r = rows.filter((x) => x.currency === m.currency);
      const isFee = (x: FinancialTx) => x.sourceType === "FEE" || x.transactionType === "FEE";
      const pay = r.filter((x) => !isFee(x)), feeRows = r.filter(isFee);
      const payAmt = abs(sum(pay, (x) => x.amountCents)), feeRowAmt = abs(sum(feeRows, (x) => x.amountCents)), feeField = abs(sum(r, (x) => x.feeCents));
      const ledgerTxt = `${money(m.currency, m.amountCents)}${m.feeCents != null ? ` + fee ${money(m.currency, m.feeCents)}` : " (fee not known in the ledger)"}`;
      const awxTxt = `${r.length} row(s): ${pay.length} payout ${money(m.currency, payAmt)}, ${feeRows.length} fee row(s) ${money(m.currency, feeRowAmt)}, fee field ${money(m.currency, feeField)}`;
      let how = "no rows for this transfer";
      let agrees = false;
      // As the sandbox books it (read 12 November): a PAYOUT row for the amount and a FEE row, both under the transfer id.
      if (pay.length && m.feeCents != null && payAmt === m.amountCents && feeRowAmt === m.feeCents && feeField === 0) { agrees = true; how = "a PAYOUT row for the amount and a FEE row for the fee, both under the transfer id"; }
      else if (pay.length && !feeRows.length && m.feeCents != null && payAmt === m.amountCents && feeField === m.feeCents) { agrees = true; how = "amount and fee in their own fields of one row"; }
      else if (pay.length && !feeRows.length && m.feeCents != null && payAmt === m.amountCents + m.feeCents && feeField === 0) { agrees = true; how = "fee included in the gross amount"; }
      else if (pay.length && m.feeCents == null && payAmt === m.amountCents) { agrees = true; how = "amount (the ledger holds no fee yet)"; }
      else if (r.length) how = "amounts differ";
      return { sourceId: m.sourceId, kind: m.kind, label: m.label, agrees, how, ledger: ledgerTxt, airwallex: awxTxt, rows: r.length };
    }
    if (m.kind === "conversion") {
      const buy = abs(sum(rows.filter((x) => x.currency === m.buyCurrency), (x) => x.amountCents));
      const sell = abs(sum(rows.filter((x) => x.currency === m.sellCurrency), (x) => x.amountCents));
      const agrees = rows.length > 0 && buy === m.buyCents && sell === m.sellCents;
      return {
        sourceId: m.sourceId, kind: m.kind, label: m.label, agrees, how: rows.length ? (agrees ? "buy and sell legs" : "amounts differ") : "no rows for this conversion",
        ledger: `buy ${money(m.buyCurrency, m.buyCents)}, sell ${money(m.sellCurrency, m.sellCents)}`, airwallex: `${rows.length} row(s): ${m.buyCurrency} ${fromCents(buy)}, ${m.sellCurrency} ${fromCents(sell)}`, rows: rows.length,
      };
    }
    const r = rows.filter((x) => x.currency === m.currency);
    const amt = abs(sum(r, (x) => x.amountCents));
    const agrees = r.length > 0 && amt === m.amountCents;
    return { sourceId: m.sourceId, kind: m.kind, label: m.label, agrees, how: r.length ? (agrees ? "amount" : "amounts differ") : "no rows for this deposit", ledger: money(m.currency, m.amountCents), airwallex: `${r.length} row(s): ${money(m.currency, amt)}`, rows: r.length };
  });
  const known = new Set(ledger.map((m) => m.sourceId));
  const unknownAtAirwallex = live.filter((f) => TRACKED.has(f.sourceType) && !(f.sourceId && known.has(f.sourceId)))
    .map((f) => ({ id: f.id, sourceId: f.sourceId, sourceType: f.sourceType, currency: f.currency, amount: money(f.currency, f.amountCents) }));
  const outOfScope: Record<string, number> = {};
  for (const f of live) if (!(f.sourceId && known.has(f.sourceId)) && !TRACKED.has(f.sourceType)) outOfScope[f.sourceType || "UNKNOWN"] = (outOfScope[f.sourceType || "UNKNOWN"] ?? 0) + 1;
  const differences = movements.filter((m) => !m.agrees);
  return { checked: movements.length, agree: movements.length - differences.length, differences, movements, unknownAtAirwallex, outOfScope };
}

/** The ledger's payouts (written at Airwallex, sent or paid) and conversions, by their Airwallex ids. */
export function ledgerMovementsFromDb(db: DB): LedgerMovement[] {
  const out: LedgerMovement[] = [];
  for (const t of db.prepare("SELECT transfer_id, invoice_no, amount, currency, fee_actual FROM transfers WHERE transfer_id IS NOT NULL AND status IN ('SENT', 'PAID') ORDER BY updated_at").all() as { transfer_id: string; invoice_no: string; amount: string; currency: string; fee_actual: string | null }[]) {
    const fee = t.fee_actual && t.fee_actual.startsWith(`${t.currency} `) ? toCents(t.fee_actual.slice(t.currency.length + 1)) : null;
    out.push({ kind: "payout", sourceId: t.transfer_id, label: t.invoice_no, currency: t.currency, amountCents: toCents(t.amount), feeCents: fee });
  }
  for (const c of db.prepare("SELECT conversion_id, buy_amount, sell_amount FROM fx_conversions WHERE sell_amount IS NOT NULL").all() as { conversion_id: string; buy_amount: string; sell_amount: string }[]) {
    out.push({ kind: "conversion", sourceId: c.conversion_id, label: `conversion ${c.conversion_id.slice(0, 8)}`, buyCurrency: "EUR", buyCents: toCents(c.buy_amount), sellCurrency: "USD", sellCents: toCents(c.sell_amount) });
  }
  return out;
}

/** The same movements from a committed run record (docs/demo/airwallex-run.json: its invoices). */
export function ledgerMovementsFromRunRecord(record: { invoices?: { invoice_no: string; amount: string; transfer_id: string | null; status: string; fee: string | null; conversion_id: string | null; quote: null | { buy_eur: string; sell_usd: string } }[] }): LedgerMovement[] {
  const out: LedgerMovement[] = [];
  for (const i of record.invoices ?? []) {
    if (i.transfer_id && (i.status === "PAID" || i.status === "SENT")) {
      const fee = i.fee && /^EUR \d+\.\d{2}$/.test(i.fee) ? toCents(i.fee.slice(4)) : null;
      out.push({ kind: "payout", sourceId: i.transfer_id, label: i.invoice_no, currency: "EUR", amountCents: toCents(i.amount), feeCents: fee });
    }
    if (i.conversion_id && i.quote) out.push({ kind: "conversion", sourceId: i.conversion_id, label: `${i.invoice_no} conversion`, buyCurrency: "EUR", buyCents: toCents(i.quote.buy_eur), sellCurrency: "USD", sellCents: toCents(i.quote.sell_usd) });
  }
  return out;
}

/** Records a reconciliation in the audit log (what the run record is built from). */
export function recordReconciliation(db: DB, r: Reconciliation, window: { from: string; to: string }, now = new Date()): void {
  audit(db, "system", "awx_ft.reconciled", null, {
    from: window.from, to: window.to, checked: r.checked, agree: r.agree, differences: r.differences.length,
    movements: r.movements.map((m) => ({ source_id: m.sourceId, kind: m.kind, label: m.label, agrees: m.agrees, how: m.how, ledger: m.ledger, airwallex: m.airwallex, rows: m.rows })),
    unknown_at_airwallex: r.unknownAtAirwallex.slice(0, 50), out_of_scope: r.outOfScope,
  }, now);
}
