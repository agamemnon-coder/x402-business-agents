// Closing (bookkeeping core, decision 5). A month close locks the month for posting. A year close posts the closing
// entry, each profit-and-loss account to retained earnings (3100) per currency, on the year's last day, then locks
// every month of the year. Locks are rows that are only ever added (src/db/ledger.sql).

import type { DB } from "../db/open.js";
import { isProfitAndLoss, RETAINED_EARNINGS } from "./accounts.js";
import { LedgerRefused, lockMonth, postClosingEntry, type LineInput } from "./core.js";

export function closeMonth(db: DB, month: string, by: string, now = new Date()): { month: string; locked: boolean } {
  return { month, locked: lockMonth(db, month, by, now, "month") };
}

export function closeYear(db: DB, year: number, by: string, now = new Date()): { entry_id: number | null; locked_months: string[] } {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new LedgerRefused(`not a year: ${year}`);
  const key = `close-year:${year}`;
  if (db.prepare("SELECT 1 FROM ledger_entries WHERE source_key = ?").get(key)) throw new LedgerRefused(`${year} is already closed`);
  const rows = (db.prepare(`SELECT l.account, l.currency, SUM(l.debit_cents) - SUM(l.credit_cents) AS net
    FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id WHERE e.posting_date >= ? AND e.posting_date <= ?
    GROUP BY l.account, l.currency`).all(`${year}-01-01`, `${year}-12-31`) as { account: string; currency: string; net: number }[])
    .filter((r) => isProfitAndLoss(r.account) && r.net !== 0);
  let entryId: number | null = null;
  return db.transaction(() => {
    if (rows.length) {
      const lines: LineInput[] = [];
      const toEquity = new Map<string, number>();
      for (const r of rows) {
        // Bring each account to zero; what it held goes to retained earnings.
        lines.push(r.net > 0 ? { account: r.account, credit: r.net, currency: r.currency } : { account: r.account, debit: -r.net, currency: r.currency });
        toEquity.set(r.currency, (toEquity.get(r.currency) ?? 0) + r.net);
      }
      for (const [currency, net] of toEquity) if (net !== 0) lines.push(net > 0 ? { account: RETAINED_EARNINGS, debit: net, currency } : { account: RETAINED_EARNINGS, credit: -net, currency });
      entryId = postClosingEntry(db, { date: `${year}-12-31`, description: `Year close ${year}: result to retained earnings`, created_by: by, source_key: key, lines }, `${year}-12-31`, now).entry_id;
    }
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    for (const m of months) lockMonth(db, m, by, now, "year");
    return { entry_id: entryId, locked_months: months };
  }).immediate();
}
