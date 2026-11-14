// Reconciliation from Airwallex's own ledger: GET /financial_transactions (docs: api/finance/financial_transactions,
// read 12 November 2026) lists every movement on the account with its source (source_id, source_type), gross amount,
// fee and net, per currency. Purser compares each payout and conversion it made with what Airwallex booked for that
// source, exactly, in integer cents. It reads only: it never moves, creates or changes anything.
//
// On by default since 13 November: after each payout and in the hourly reconciliation (src/finance/reconcile.ts), each
// payout and conversion is looked up by its source_id until it agrees once. AIRWALLEX_FINANCIAL_TX=off is an emergency
// stop only. List parameters (docs): from_created_at / to_created_at
// (ISO 8601, inclusive), currency, status (PENDING, SETTLED), source_id, page_num (from 0), page_size (≤ 1000).

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import type { Airwallex } from "../airwallex/client.js";
import { settledDeposits } from "../airwallex/deposits.js";
import type { FinancialTx, LedgerMovement, MovementCheck, RawFt, Reconciliation } from "./awxReconcile.js";
// The comparison itself is pure and lives in ./awxReconcile.ts (14 Nov), so Purser Cloud's Worker can run it without
// the runner's database or audit log; re-exported here for every caller that knew it here.
export { ledgerMovementsFromRunRecord, reconcileFinancialTransactions, signedCents, toFinancialTx } from "./awxReconcile.js";
export type { FinancialTx, LedgerMovement, MovementCheck, Reconciliation } from "./awxReconcile.js";
import { reconcileFinancialTransactions, toFinancialTx } from "./awxReconcile.js";

export const FINANCIAL_TX_FLAG = "AIRWALLEX_FINANCIAL_TX";
export const financialTxOn = (env: Record<string, string | undefined> = process.env): boolean => env[FINANCIAL_TX_FLAG] !== "off";


/** The most pages read in one listing; more means the window is too wide for one reconciliation. */
export const MAX_PAGES = 5;

/** Every financial transaction created in [from, to], all pages (page_size 1000, at most MAX_PAGES). */
export async function listFinancialTransactions(api: Pick<Airwallex, "call">, a: { from?: string; to?: string; currency?: string; sourceId?: string }): Promise<FinancialTx[]> {
  if (!a.sourceId && !(a.from && a.to)) throw new Error("a window (from, to) or a source_id is needed; Airwallex's whole ledger is never read");
  const out: FinancialTx[] = [];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of financial transactions in ${a.sourceId ?? `${a.from} … ${a.to}`}; narrow the window`);
    const r = await api.call<{ items?: RawFt[]; has_more?: boolean }>("GET", "/financial_transactions", undefined, {
      ...(a.from && a.to ? { from_created_at: a.from, to_created_at: a.to } : {}), ...(a.sourceId ? { source_id: a.sourceId } : {}),
      page_num: String(page), page_size: "1000", ...(a.currency ? { currency: a.currency } : {}),
    });
    // Asked by source: every row must be that source's, or the filter was not applied and nothing is concluded.
    if (a.sourceId && r?.items?.some((i) => i.source_id !== a.sourceId)) throw new Error(`Airwallex answered rows of other sources when asked for ${a.sourceId}; nothing is concluded`);
    if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's financial transactions came without items");
    out.push(...r.items.map(toFinancialTx));
    // has_more must be a yes or no: a full page without it may hide more rows, and is never read as the last.
    if (typeof r.has_more !== "boolean" && r.items.length >= 1000) throw new Error("Airwallex's financial transactions came as a full page without has_more; nothing is concluded");
    if (r.has_more !== true) return out;
  }
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
  // Money received (13 November): each SETTLED deposit to a global account the ledger recorded (src/airwallex/deposits.ts).
  for (const d of settledDeposits(db)) out.push({ kind: "deposit", sourceId: d.id, label: d.label, currency: d.currency, amountCents: d.amountCents });
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

/** A movement Airwallex has not booked yet is "pending", not a difference, for this long after Purser first looked. */
export const BOOKING_GRACE_MS = 2 * 60 * 60_000;

export interface LedgerCheck {
  checked: number;
  agree: number;
  /** Not booked at Airwallex yet, within BOOKING_GRACE_MS of the first look: looked at again on the next run. */
  pending: string[];
  differences: MovementCheck[];
  movements: MovementCheck[];
}

/** The rows Airwallex booked for one source (a transfer id or a conversion id). */
export type FtBySource = (sourceId: string) => Promise<FinancialTx[]>;

/**
 * Purser's own ledger against Airwallex's, movement by movement (switched on 13 November): each payout (SENT or PAID)
 * and conversion is looked up by its source_id and compared to the cent, until it has agreed once (awx_ft.agreed);
 * `only` limits it to some sources (right after a payout). Anything that differs is flagged (awx_ft.difference, and the
 * caller's alarm); one not booked yet is pending for BOOKING_GRACE_MS, then a difference. Reads only.
 */
export async function reconcileLedgerAtAirwallex(db: DB, bySource: FtBySource, o: { only?: string[]; now?: Date } = {}): Promise<LedgerCheck> {
  const now = o.now ?? new Date();
  const agreed = new Set((db.prepare("SELECT DISTINCT subject FROM audit_log WHERE event = 'awx_ft.agreed'").all() as { subject: string }[]).map((r) => r.subject));
  const todo = ledgerMovementsFromDb(db).filter((m) => !agreed.has(m.sourceId) && (!o.only || o.only.includes(m.sourceId)));
  const out: LedgerCheck = { checked: 0, agree: 0, pending: [], differences: [], movements: [] };
  for (const m of todo) {
    const rows = await bySource(m.sourceId);
    const r = reconcileFinancialTransactions([m], rows);
    const c = r.movements[0]!;
    out.checked++;
    out.movements.push(c);
    const p = { label: c.label, kind: c.kind, how: c.how, ledger: c.ledger, airwallex: c.airwallex, rows: c.rows, items: rows.map((f) => ({ id: f.id, source_type: f.sourceType, transaction_type: f.transactionType, currency: f.currency, amount_cents: f.amountCents, status: f.status })) };
    if (c.agrees) { out.agree++; audit(db, "system", "awx_ft.agreed", m.sourceId, p, now); continue; }
    const first = (db.prepare("SELECT MIN(ts) AS ts FROM audit_log WHERE event = 'awx_ft.pending' AND subject = ?").get(m.sourceId) as { ts: string | null }).ts;
    if (!rows.length && (!first || now.getTime() - Date.parse(first) < BOOKING_GRACE_MS)) {
      out.pending.push(m.sourceId);
      audit(db, "system", "awx_ft.pending", m.sourceId, p, now);
      continue;
    }
    out.differences.push(c);
    audit(db, "system", "awx_ft.difference", m.sourceId, p, now);
  }
  audit(db, "system", "awx_ft.reconciled", null, {
    by: "source", only: o.only ?? null, checked: out.checked, agree: out.agree, differences: out.differences.length, pending: out.pending,
    movements: out.movements.map((m) => ({ source_id: m.sourceId, kind: m.kind, label: m.label, agrees: m.agrees, how: m.how, ledger: m.ledger, airwallex: m.airwallex, rows: m.rows })),
  }, now);
  return out;
}

/** Airwallex's rows for one source, through the API (one GET per source). */
export const ftBySourceVia = (api: Pick<Airwallex, "call">): FtBySource => (sourceId) => listFinancialTransactions(api, { sourceId });
