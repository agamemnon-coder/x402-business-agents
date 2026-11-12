// The month pack (closing a month): what an accountant expects at a month's end, every figure from the ledger's own
// report functions (src/ledger/reports.ts), never computed a second time here: the trial balance and the balance sheet
// at the month's end, the month's profit and loss, the VAT overview of the quarter the month lies in, up to the
// month's end (a preparation for the return, not a filing), and the payables still open at the month's end. Nothing
// posted after the month's end is in it, so a closed month's pack never changes. The vault files it as one PDF for every
// closed month (src/vault/build.ts), and the payables server serves it read-only.

import type { DB } from "../db/open.js";
import { ageing, balanceSheet, postedLines, profitAndLoss, trialBalance, vatOverviewFrom, type BalanceSheet, type OpenItem, type ProfitAndLoss, type TrialRow, type VatOverview } from "./reports.js";
import { LedgerRefused } from "./core.js";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Whether a month is closed for posting, and by which close: a month is closed when it or a later month was closed. */
export interface PeriodState {
  month: string;
  from: string;
  to: string;
  locked: boolean;
  /** The close that locked it (its own, or a later month's), when it is locked. */
  locked_month: string | null;
  locked_by: string | null;
  locked_at: string | null;
}

export interface MonthPack {
  period: PeriodState;
  /** The quarter of the VAT overview, as the ledger writes it: 2026Q4; the overview counts its lines up to the month's end. */
  quarter: string;
  trial: TrialRow[];
  pnl: Record<string, ProfitAndLoss>;
  balance: Record<string, BalanceSheet>;
  vat: VatOverview;
  payables: { as_of: string; items: OpenItem[]; totals: Record<string, Record<string, number>> };
}

/** The first and last day of a month, YYYY-MM-DD. */
export function monthBounds(month: string): { from: string; to: string } {
  const m = MONTH.exec(month);
  if (!m) throw new LedgerRefused(`not a month: ${month} (write 2026-11)`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export const quarterOfMonth = (month: string) => `${month.slice(0, 4)}Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;

export function periodState(db: DB, month: string): PeriodState {
  const { from, to } = monthBounds(month);
  const lock = db.prepare("SELECT month, locked_by, locked_at FROM ledger_locks WHERE month >= ? ORDER BY month LIMIT 1").get(month) as { month: string; locked_by: string; locked_at: string } | undefined;
  return { month, from, to, locked: !!lock, locked_month: lock?.month ?? null, locked_by: lock?.locked_by ?? null, locked_at: lock?.locked_at ?? null };
}

/** The month pack's figures, each the report function's own result. */
export function monthPack(db: DB, month: string): MonthPack {
  const period = periodState(db, month);
  const quarter = quarterOfMonth(month);
  return {
    period,
    quarter,
    trial: trialBalance(db, period.to),
    pnl: profitAndLoss(db, { from: period.from, to: period.to }),
    balance: balanceSheet(db, period.to),
    vat: vatOverviewFrom(postedLines(db).filter((l) => l.posting_date <= period.to), quarter),
    payables: ageing(db, "payables", period.to),
  };
}
