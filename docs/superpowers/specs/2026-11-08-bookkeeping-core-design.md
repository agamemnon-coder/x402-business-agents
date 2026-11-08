# Purser's own bookkeeping: the ledger core (design)

Max, 8 November 2026: no outside bookkeeping package; Purser keeps the books itself. This is phase 2, part A. The
payables inbox (phase 1, `src/ap/`) posts into this ledger once both are merged. Built on a branch; nothing is
deployed until after 15 November.

## What it does

Purser already knows every movement of money it made (`src/accounting/gl.ts` derives one journal line per movement,
`src/accounting/books.ts` turns them into debits and credits). Until now those books were computed on the fly and
never stored. The ledger core stores them as a real general ledger, adds what a bookkeeper needs on top, and keeps it
for good.

## Decisions

1. **A stored general ledger** (`src/ledger/core.ts`, tables in `src/db/ledger.sql`). An entry has a posting date, a
   document date, a description, a source key, a document reference and its SHA-256, who created it, and two or more
   lines. A line has an account from the chart, a debit or a credit in integer cents, a currency, a cost centre, an
   optional VAT code with its VAT amount, an optional party and due date (for open items).
   - **Balanced or refused:** debits equal credits per currency, or nothing is written.
   - **Immutable:** the database refuses UPDATE and DELETE on entries and lines (triggers, like the audit log). A
     mistake is corrected by a reversing entry that names the one it reverses.
   - **Hash chain:** each entry's hash covers the previous entry's hash and the entry with its lines (JCS, as the audit
     log does). `npm run ledger -- verify` recomputes the chain from the start.
   - **Period locks:** a closed month cannot be posted into. A late item from a closed month posts on the first day of
     the next open month and keeps its document date.
2. **Fed from Purser, no typing** (`src/ledger/feed.ts`). `syncLedger` posts every line `books.ts` already derives
   (opening balances, data sales, purchases, refunds, card spend, invoice payments and fees, conversions, sweeps,
   clearing, receipts). Each source line posts once: its source key is unique, so a second sync posts nothing new.
   The feed sets no VAT code: Purser's own records do not say which VAT applies, and the ledger does not guess. Lines
   without a VAT code are listed in the VAT overview as "no VAT code yet".
3. **Dutch VAT as data** (`src/ledger/vat.ts`). Codes for sales (21%, 9%, 0%, to EU businesses, export, exempt) and
   purchases (21%, 9%, domestic reverse charge, from the EU, from outside the EU, no VAT), each mapped to the rubrics of
   the Dutch VAT return (1a, 1b, 1e, 2a, 3a, 3b, 4a, 4b, 5a, 5b, 5c). The quarterly overview is computed from the
   ledger and says on every output: an overview for the return, not a filing; filing to the tax authority is a later,
   certified step.
4. **Reports from the ledger** (`src/ledger/reports.ts`): trial balance, profit and loss (4xxx to 8xxx), balance sheet
   (1xxx to 3xxx plus this year's result; it must balance), receivables and payables ageing (open items by party and
   document, by due date), cash per currency (12xx). Per currency: no revaluation to one reporting currency yet.
5. **Closing** (`src/ledger/close.ts`): a month close locks the month. A year close posts the closing entry (each P&L
   account to 3100 retained earnings, per currency) and locks every month of the year. Locks are rows that are only
   ever added.
6. **Stock at weighted average cost** (`src/ledger/stock.ts`): buying goods debits 1700 stock and raises the item's
   quantity and value; selling goods credits 1700 and debits 8000 cost of goods sold at the average cost. Selling more
   than is in stock is refused.
7. **Helpers for documents** (`src/ledger/documents.ts`): a purchase invoice (expense or stock, input VAT, payables), a
   sales invoice (receivables, revenue, output VAT), and paying or receiving against an open item. Phase 1 and the
   company API call these.
8. **Exports:** the ledger as CSV and JSON.
9. **CLI and page:** `npm run ledger -- sync|trial|pnl|balance|vat --quarter 2026Q4|ageing|cash|close --month 2026-11|close --year 2026|export --csv|export --json|verify|serve`.
   `serve` shows the reports on a read-only local page (127.0.0.1).

## New accounts

1300 receivables, 1700 stock, 2200 VAT payable, 2210 output VAT (charged to customers), 3100 retained earnings, 8000
cost of goods sold (`LEDGER_CHART`), with phase 1's 1510 input VAT and 2100 accounts payable (`AP_CHART`, the same
definition word for word). Both stay out of `CHART`: the T:0 sink mirrors `CHART` account for account, and T:0 has no
such accounts yet. The ledger accepts all three. The first digit gives the kind: 1 assets, 2 liabilities, 3 equity,
4 revenue, 5 to 8 expenses.

## Rules that do not change

Test money only. No outside calls. No secrets. Nothing posted is ever deleted. The live site's figures do not change.

## Not in this part

Filing the VAT return (Digipoort/SBR, certified); revaluation into one reporting currency; the XAF audit file
(XML, needs validating against the tax authority's schema); depreciation of fixed assets; payroll.
