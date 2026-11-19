// T:0's own reports against its journal and Purser's books (19 Nov): a three-way check on T:0's shared sandbox entity.
// The 14 Nov read-back (docs/runs/2026-11-14-t0-readback.md) checked T:0's journal entries against Purser's books. This
// goes one level up: T:0's computed Balance Sheet and Profit & Loss must equal, account by account and to the cent,
// the sum of every journal line T:0 holds on that account; of which Purser's own entries (je_number PUR-…) must equal
// Purser's books as recorded on 10 Nov (src/accounting/recordedChecks.ts). The rest is other teams' entries on the shared
// entity: counted per account, never copied. Read only.

import { T0_READBACK_2026_11_10, centsOf } from "./recordedChecks.js";
import { balanceSheetCheck, type T0BalanceSheet, type T0JournalEntry, type T0ProfitLoss, type T0ReportAccount } from "./t0.js";

/** Our T:0 account numbers in the recorded table ("11120 (1200)" → "11120"). */
export const OUR_ACCOUNTS = T0_READBACK_2026_11_10.map((r) => ({ account: r.account.split(" ")[0]!, label: r.account, oursNetDebitCents: centsOf(r.ours) }));

/** Each postable account's balance in one period, from a report's tree, by account number (atoms). */
export function reportBalances(sections: { balances: Record<string, number | null>; children?: T0ReportAccount[] }[], periodId: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (a: T0ReportAccount) => {
    const v = (a.own_balances ?? a.balances)[periodId];
    if (a.account_number && v != null) out.set(a.account_number, (out.get(a.account_number) ?? 0) + v);
    for (const c of a.children ?? []) walk(c);
  };
  for (const s of sections) for (const c of s.children ?? []) walk(c);
  return out;
}

const DEBIT_NORMAL = /^(asset|expense|cost)/i;

/** Net debit per account number from journal lines, in cents (atoms / atoms_per_unit × 100), split ours / others. */
export function journalNetDebit(entries: readonly T0JournalEntry[]): { ours: Map<string, number>; others: Map<string, number>; types: Map<string, string>; oursCount: number; othersCount: number } {
  const ours = new Map<string, number>(), others = new Map<string, number>(), types = new Map<string, string>();
  let oursCount = 0, othersCount = 0;
  for (const e of entries) {
    const mine = /^PUR-/.test(e.je_number ?? "");
    if (mine) oursCount++; else othersCount++;
    const m = mine ? ours : others;
    for (const l of e.lines) {
      if (!l.account_number) continue;
      types.set(l.account_number, l.account_type);
      const cents = Math.round((l.amount_atoms / (e.atoms_per_unit || 1)) * 100);
      m.set(l.account_number, (m.get(l.account_number) ?? 0) + (l.line_type === "debit" ? cents : -cents));
    }
  }
  return { ours, others, types, oursCount, othersCount };
}

export interface AccountCheck { account: string; label: string; type: string; books: number; t0Ours: number; t0Others: number; report: number | null; booksAgree: boolean; reportAgrees: boolean }
export interface ReportReconciliation { period: string; balanceSheetBalances: boolean | null; accounts: AccountCheck[]; agree: number; entries: { ours: number; others: number } }

/**
 * The three-way check, in cents with T:0's report signs turned to net debit (a credit-normal account's report balance
 * is its credit balance). Books = Purser's recorded figures; t0Ours = Purser's entries in T:0; report = T:0's report.
 * An account agrees when books = t0Ours and report = t0Ours + t0Others.
 */
export function reconcileReports(bs: T0BalanceSheet, pl: T0ProfitLoss, entries: readonly T0JournalEntry[]): ReportReconciliation {
  const period = bs.periods.at(-1)!;
  const plPeriod = pl.periods.at(-1)!;
  const unit = bs.atoms_per_unit || 1;
  const bal = reportBalances(bs.sections, period.id), pnl = reportBalances(pl.sections, plPeriod.id);
  // The balance sheet is cumulative to its end date: every entry up to it. The P&L is the period's: its entries only.
  const j = journalNetDebit(entries.filter((e) => e.entry_date <= period.end_date));
  const jp = journalNetDebit(entries.filter((e) => e.entry_date >= plPeriod.start_date && e.entry_date <= plPeriod.end_date));
  const accounts = OUR_ACCOUNTS.map((a): AccountCheck => {
    const type = j.types.get(a.account) ?? "";
    const onBs = bal.has(a.account);
    const raw = onBs ? bal.get(a.account) : pnl.get(a.account);
    const reportCents = raw == null ? null : Math.round((raw / unit) * 100) * (DEBIT_NORMAL.test(type) ? 1 : -1);
    const src = onBs ? j : jp;
    const t0Ours = src.ours.get(a.account) ?? 0, t0Others = src.others.get(a.account) ?? 0;
    return { account: a.account, label: a.label, type, books: a.oursNetDebitCents, t0Ours, t0Others, report: reportCents, booksAgree: a.oursNetDebitCents === t0Ours, reportAgrees: reportCents === t0Ours + t0Others };
  });
  const bsCheck = balanceSheetCheck(bs).at(-1);
  return { period: period.label, balanceSheetBalances: bsCheck ? (bsCheck.noData ? null : bsCheck.balances) : null, accounts, agree: accounts.filter((a) => a.booksAgree && a.reportAgrees).length, entries: { ours: j.oursCount, others: j.othersCount } };
}
