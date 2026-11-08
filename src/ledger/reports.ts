// Reports from the stored ledger (bookkeeping core, decisions 3 and 4): trial balance, profit and loss, balance sheet,
// receivables and payables ageing, cash per currency and the quarterly VAT overview. Every figure is a sum of posted
// lines; amounts stay in their own currency (no revaluation into one reporting currency yet).

import type { DB } from "../db/open.js";
import { accountType, isBank, isProfitAndLoss, LEDGER_ACCOUNTS as CHART, PAYABLES, RECEIVABLES } from "./accounts.js";
import { VAT_CODES, VAT_NOTICE, type VatRubric } from "./vat.js";

interface Row { account: string; currency: string; debit: number; credit: number }

/** The year close's own entries (src/ledger/close.ts): they move the result to equity, they are not part of it. */
export const CLOSING_KEY_PREFIX = "close-year:";

function sums(db: DB, range: { from?: string; to?: string } = {}, opts: { withoutClosing?: boolean } = {}): Row[] {
  return db.prepare(`SELECT l.account, l.currency, SUM(l.debit_cents) AS debit, SUM(l.credit_cents) AS credit
    FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id
    WHERE e.posting_date >= ? AND e.posting_date <= ? AND (? = 0 OR e.source_key IS NULL OR e.source_key NOT LIKE '${CLOSING_KEY_PREFIX}%')
    GROUP BY l.account, l.currency ORDER BY l.account, l.currency`)
    .all(range.from ?? "0000-01-01", range.to ?? "9999-12-31", opts.withoutClosing ? 1 : 0) as Row[];
}

export interface TrialRow { account: string; name: string; type: string; currency: string; debit_cents: number; credit_cents: number; balance_cents: number }

/** Per account and currency up to a day: debits, credits and the balance (debit minus credit). */
export function trialBalance(db: DB, to?: string): TrialRow[] {
  return sums(db, { to }).map((r) => ({ account: r.account, name: CHART[r.account] ?? "", type: accountType(r.account), currency: r.currency, debit_cents: r.debit, credit_cents: r.credit, balance_cents: r.debit - r.credit }));
}

export interface ProfitAndLoss {
  revenue_cents: number;
  expense_cents: number;
  result_cents: number;
  accounts: { account: string; name: string; type: string; cents: number }[];
}

/**
 * Revenue (credit minus debit on 4xxx) and expenses (debit minus credit on 5xxx to 8xxx), per currency. The year
 * close's entry is left out (review of PR #108, finding 2), so a closed year still shows its own result.
 */
export function profitAndLoss(db: DB, range: { from: string; to: string }): Record<string, ProfitAndLoss> {
  const out: Record<string, ProfitAndLoss> = {};
  for (const r of sums(db, range, { withoutClosing: true }).filter((x) => isProfitAndLoss(x.account))) {
    const p = (out[r.currency] ??= { revenue_cents: 0, expense_cents: 0, result_cents: 0, accounts: [] });
    const type = accountType(r.account);
    const cents = type === "revenue" ? r.credit - r.debit : r.debit - r.credit;
    if (type === "revenue") p.revenue_cents += cents;
    else p.expense_cents += cents;
    p.accounts.push({ account: r.account, name: CHART[r.account] ?? "", type, cents });
  }
  for (const p of Object.values(out)) p.result_cents = p.revenue_cents - p.expense_cents;
  return out;
}

export interface BalanceSheet {
  assets_cents: number;
  liabilities_cents: number;
  equity_cents: number;
  /** Profit not yet closed into retained earnings. */
  result_cents: number;
  balanced: boolean;
  accounts: { account: string; name: string; type: string; cents: number }[];
}

/** Assets against liabilities, equity and the open result, per currency, on a day. It must balance. */
export function balanceSheet(db: DB, to: string): Record<string, BalanceSheet> {
  const out: Record<string, BalanceSheet> = {};
  for (const r of sums(db, { to })) {
    const b = (out[r.currency] ??= { assets_cents: 0, liabilities_cents: 0, equity_cents: 0, result_cents: 0, balanced: false, accounts: [] });
    const type = accountType(r.account);
    if (type === "revenue" || type === "expense") { b.result_cents += r.credit - r.debit; continue; }
    const cents = type === "asset" ? r.debit - r.credit : r.credit - r.debit;
    if (type === "asset") b.assets_cents += cents;
    else if (type === "liability") b.liabilities_cents += cents;
    else b.equity_cents += cents;
    if (cents !== 0) b.accounts.push({ account: r.account, name: CHART[r.account] ?? "", type, cents });
  }
  for (const b of Object.values(out)) b.balanced = b.assets_cents === b.liabilities_cents + b.equity_cents + b.result_cents;
  return out;
}

/** Each bank account's balance per currency (all posted lines). */
export function cashByCurrency(db: DB): { account: string; currency: string; balance_cents: number }[] {
  return sums(db).filter((r) => isBank(r.account) && r.debit - r.credit !== 0).map((r) => ({ account: r.account, currency: r.currency, balance_cents: r.debit - r.credit }));
}

export type AgeBucket = "not due" | "1-30" | "31-60" | "61-90" | "90+";
export interface OpenItem { party: string; doc_ref: string; currency: string; due_date: string | null; open_cents: number; days_overdue: number; bucket: AgeBucket }

const DAY_MS = 86_400_000;
const bucketOf = (days: number): AgeBucket => (days <= 0 ? "not due" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+");

/** The open items on receivables (1300) or payables (2100) on a day, by party and document, oldest due first. */
export function ageing(db: DB, kind: "receivables" | "payables", asOf: string): { as_of: string; items: OpenItem[]; totals: Record<string, Record<AgeBucket, number>> } {
  const account = kind === "receivables" ? RECEIVABLES : PAYABLES;
  const rows = db.prepare(`SELECT l.party, l.doc_ref, l.currency, MIN(l.due_date) AS due_date, SUM(l.debit_cents - l.credit_cents) AS net
    FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id WHERE l.account = ? AND e.posting_date <= ?
    GROUP BY l.party, l.doc_ref, l.currency`).all(account, asOf) as { party: string | null; doc_ref: string | null; currency: string; due_date: string | null; net: number }[];
  const items: OpenItem[] = [];
  const totals: Record<string, Record<AgeBucket, number>> = {};
  for (const r of rows) {
    const open = kind === "receivables" ? r.net : -r.net;
    if (open === 0) continue;
    const days = r.due_date ? Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${r.due_date}T00:00:00Z`)) / DAY_MS) : 0;
    const item: OpenItem = { party: r.party ?? "", doc_ref: r.doc_ref ?? "", currency: r.currency, due_date: r.due_date, open_cents: open, days_overdue: Math.max(0, days), bucket: bucketOf(days) };
    items.push(item);
    const t = (totals[r.currency] ??= { "not due": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });
    t[item.bucket] += open;
  }
  items.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.party.localeCompare(b.party));
  return { as_of: asOf, items, totals };
}

export interface VatOverview {
  quarter: string;
  from: string;
  to: string;
  notice: string;
  rubrics: Record<VatRubric, { base_cents: number; vat_cents: number }>;
  owed_5a_cents: number;
  input_5b_cents: number;
  balance_5c_cents: number;
  /** Lines on revenue or expense accounts with no VAT code: a person codes them; the ledger does not guess. */
  uncoded_lines: number;
  /** VAT-coded lines in a currency other than EUR: a person converts them for the return. */
  other_currency_lines: number;
}

const RUBRICS: VatRubric[] = ["1a", "1b", "1e", "2a", "3a", "3b", "4a", "4b"];

export function quarterRange(quarter: string): { from: string; to: string } {
  const m = /^(\d{4})Q([1-4])$/.exec(quarter);
  if (!m) throw new Error(`not a quarter: ${quarter} (write 2026Q4)`);
  const q = Number(m[2]);
  const end = [0, "03-31", "06-30", "09-30", "12-31"][q] as string;
  return { from: `${m[1]}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`, to: `${m[1]}-${end}` };
}

/** The quarter's lines added up into the rubrics of the Dutch VAT return. An overview, not a filing. */
export function vatOverview(db: DB, quarter: string): VatOverview {
  const { from, to } = quarterRange(quarter);
  // The year close's entry carries no VAT and is no transaction: it is not counted as an uncoded line.
  const rows = db.prepare(`SELECT l.account, l.currency, l.debit_cents, l.credit_cents, l.vat_code, l.vat_cents
    FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id WHERE e.posting_date >= ? AND e.posting_date <= ?
    AND (e.source_key IS NULL OR e.source_key NOT LIKE '${CLOSING_KEY_PREFIX}%')`)
    .all(from, to) as { account: string; currency: string; debit_cents: number; credit_cents: number; vat_code: string | null; vat_cents: number | null }[];
  const rubrics = Object.fromEntries(RUBRICS.map((r) => [r, { base_cents: 0, vat_cents: 0 }])) as VatOverview["rubrics"];
  let input = 0;
  let uncoded = 0;
  let otherCurrency = 0;
  for (const r of rows) {
    if (!r.vat_code) {
      if (isProfitAndLoss(r.account)) uncoded += 1;
      continue;
    }
    if (r.currency !== "EUR") { otherCurrency += 1; continue; }
    const c = VAT_CODES[r.vat_code]!;
    const vat = r.vat_cents ?? 0;
    const base = c.kind === "sale" ? r.credit_cents - r.debit_cents : r.debit_cents - r.credit_cents;
    if (c.kind === "sale") {
      if (c.rubric) { rubrics[c.rubric].base_cents += base; rubrics[c.rubric].vat_cents += vat; }
      continue;
    }
    if (c.reverse && c.rubric) { rubrics[c.rubric].base_cents += base; rubrics[c.rubric].vat_cents += vat; }
    if (c.deductible) input += vat;
  }
  const owed = RUBRICS.reduce((s, k) => s + rubrics[k].vat_cents, 0);
  return { quarter, from, to, notice: VAT_NOTICE, rubrics, owed_5a_cents: owed, input_5b_cents: input, balance_5c_cents: owed - input, uncoded_lines: uncoded, other_currency_lines: otherCurrency };
}
