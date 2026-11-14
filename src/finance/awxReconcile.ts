// The reconciliation with Airwallex's own ledger, its pure part (split out of ./awxFinancialTx.ts on 14 Nov): a movement
// as Airwallex books it, in signed integer cents, and the exact comparison with Purser's ledger. No database, no audit
// log, no network: the runner (./awxFinancialTx.ts) and Purser Cloud's live Airwallex tab (cloud/src/awxLive.ts) run
// this same code.

import { fromCents, toCents } from "../lib/money.js";

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

export interface RawFt { id: string; source_id?: string | null; source_type?: string; transaction_type?: string; currency?: string; amount?: number | string; fee?: number | string | null; net?: number | string | null; status?: string; created_at?: string | null; settled_at?: string | null }

export function toFinancialTx(r: RawFt): FinancialTx {
  return {
    id: r.id, sourceId: r.source_id ?? null, sourceType: r.source_type ?? "", transactionType: r.transaction_type ?? "", currency: r.currency ?? "",
    amountCents: signedCents(r.amount ?? 0), feeCents: signedCents(r.fee ?? 0), netCents: signedCents(r.net ?? 0), status: r.status ?? "",
    createdAt: r.created_at ?? null, settledAt: r.settled_at ?? null,
  };
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
// CFO review, 14 Nov: amounts with thousands separators ("EUR 1,850.00"), as everywhere else on the site.
const grouped = (s: string) => { const [i, d] = s.split("."); return `${i!.replace(/\B(?=(\d{3})+$)/g, ",")}${d === undefined ? "" : `.${d}`}`; };
const money = (cur: string, c: number) => `${cur} ${c < 0 ? "-" : ""}${grouped(fromCents(abs(c)))}`;
/** Source types a payout or conversion of Purser's books: one Airwallex holds that the ledger lacks is reported. */
const TRACKED = new Set(["PAYOUT", "FEE", "CONVERSION"]);

/**
 * Compares the ledger's movements with Airwallex's financial transactions, exactly and with their signs. A payout agrees
 * when the rows for its transfer id are, as the sandbox books it, a PAYOUT debit of exactly the amount and a FEE debit of
 * exactly the fee, and nothing else. A conversion agrees when the bought currency is credited and the sold one debited by
 * exactly the amounts the ledger holds, and nothing else. Cancelled rows are not counted.
 */
export function reconcileFinancialTransactions(ledger: LedgerMovement[], fts: FinancialTx[]): Reconciliation {
  const live = fts.filter((f) => f.status !== "CANCELLED");
  const bySource = new Map<string, FinancialTx[]>();
  for (const f of live) if (f.sourceId) bySource.set(f.sourceId, [...(bySource.get(f.sourceId) ?? []), f]);
  const isFee = (x: FinancialTx) => x.sourceType === "FEE" || x.transactionType === "FEE";
  const movements: MovementCheck[] = ledger.map((m) => {
    // Every row Airwallex holds for this source must be accounted for: a row in another currency, a credit where a debit
    // is due, or a fee the ledger does not know is a difference, never left out.
    const rows = bySource.get(m.sourceId) ?? [];
    if (m.kind === "payout") {
      const pay = rows.filter((x) => !isFee(x)), feeRows = rows.filter(isFee);
      const payAmt = sum(pay, (x) => x.amountCents), feeAmt = sum(feeRows, (x) => x.amountCents), feeField = sum(rows, (x) => x.feeCents);
      const other = rows.filter((x) => x.currency !== m.currency);
      const ledgerTxt = `${money(m.currency, m.amountCents)}${m.feeCents != null ? ` + fee ${money(m.currency, m.feeCents)}` : " (fee not known in the ledger)"}`;
      const awxTxt = `${rows.length} row(s): ${pay.length} payout ${money(m.currency, payAmt)}, ${feeRows.length} fee row(s) ${money(m.currency, feeAmt)}${feeField ? `, fee field ${money(m.currency, feeField)}` : ""}${other.length ? `, ${other.length} row(s) in another currency` : ""}`;
      let how: string;
      let agrees = false;
      if (!rows.length) how = "no rows for this transfer";
      else if (other.length) how = "rows in another currency";
      // As the sandbox books it (read 12 November): a PAYOUT debit for the amount and a FEE debit, both under the
      // transfer id, signed as money leaving the account.
      else if (m.feeCents == null) how = "the ledger holds no fee for this payout yet; Airwallex's rows cannot be checked in full";
      else if (pay.length >= 1 && payAmt === -m.amountCents && feeAmt === -m.feeCents && feeField === 0) { agrees = true; how = "a PAYOUT debit for the amount and a FEE debit for the fee, both under the transfer id"; }
      else how = payAmt === -m.amountCents && feeAmt === -m.feeCents ? "the rows carry a fee field the ledger cannot place" : "amounts differ";
      return { sourceId: m.sourceId, kind: m.kind, label: m.label, agrees, how, ledger: ledgerTxt, airwallex: awxTxt, rows: rows.length };
    }
    if (m.kind === "conversion") {
      const buyRows = rows.filter((x) => x.currency === m.buyCurrency), sellRows = rows.filter((x) => x.currency === m.sellCurrency);
      const buy = sum(buyRows, (x) => x.amountCents), sell = sum(sellRows, (x) => x.amountCents);
      const stray = rows.length - buyRows.length - sellRows.length;
      // The bought currency comes in (a credit), the sold one goes out (a debit).
      const agrees = rows.length > 0 && stray === 0 && buy === m.buyCents && sell === -m.sellCents;
      return {
        sourceId: m.sourceId, kind: m.kind, label: m.label, agrees,
        how: !rows.length ? "no rows for this conversion" : stray ? "rows in a third currency" : agrees ? "a credit in the bought currency and a debit in the sold one" : "amounts differ",
        ledger: `buy ${money(m.buyCurrency, m.buyCents)}, sell ${money(m.sellCurrency, m.sellCents)}`, airwallex: `${rows.length} row(s): ${money(m.buyCurrency, buy)}, ${money(m.sellCurrency, sell)}`, rows: rows.length,
      };
    }
    const r = rows.filter((x) => x.currency === m.currency);
    const amt = sum(r, (x) => x.amountCents);
    const agrees = r.length > 0 && r.length === rows.length && amt === m.amountCents;
    return { sourceId: m.sourceId, kind: m.kind, label: m.label, agrees, how: !r.length ? "no rows for this deposit" : agrees ? "a credit for the amount" : "amounts differ", ledger: money(m.currency, m.amountCents), airwallex: `${rows.length} row(s): ${money(m.currency, amt)}`, rows: rows.length };
  });
  const known = new Set(ledger.map((m) => m.sourceId));
  const unknownAtAirwallex = live.filter((f) => TRACKED.has(f.sourceType) && !(f.sourceId && known.has(f.sourceId)))
    .map((f) => ({ id: f.id, sourceId: f.sourceId, sourceType: f.sourceType, currency: f.currency, amount: money(f.currency, f.amountCents) }));
  const outOfScope: Record<string, number> = {};
  for (const f of live) if (!(f.sourceId && known.has(f.sourceId)) && !TRACKED.has(f.sourceType)) outOfScope[f.sourceType || "UNKNOWN"] = (outOfScope[f.sourceType || "UNKNOWN"] ?? 0) + 1;
  const differences = movements.filter((m) => !m.agrees);
  return { checked: movements.length, agree: movements.length - differences.length, differences, movements, unknownAtAirwallex, outOfScope };
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
