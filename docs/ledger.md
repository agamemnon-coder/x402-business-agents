# Purser's own books

Purser keeps the books itself: a stored general ledger, fed from every movement of money Purser makes, with VAT,
reports, closing and stock. Design: [docs/superpowers/specs/2026-11-08-bookkeeping-core-design.md](superpowers/specs/2026-11-08-bookkeeping-core-design.md).
Test money only, like the rest of Purser.

## Run it

```bash
npm run ledger -- sync
```

Posts every movement Purser recorded that is not in the ledger yet: data sales, purchases, refunds, card spend,
invoice payments and their fees, conversions, sweeps, clearing and receipts, plus the opening balances. Each posts
once; run it as often as you like.

| Command | What it shows |
|---|---|
| `npm run ledger -- trial [--date 2026-11-30]` | Trial balance per account and currency |
| `npm run ledger -- pnl [--year 2026]` | Profit and loss |
| `npm run ledger -- balance [--date 2026-11-30]` | Balance sheet; it must balance in every currency |
| `npm run ledger -- vat --quarter 2026Q4` | Overview for the Dutch VAT return (rubrics 1a to 5c) |
| `npm run ledger -- ageing receivables` / `payables` | Open customer and supplier invoices, by due date |
| `npm run ledger -- cash` / `stock` | Cash per account and currency; stock at average cost |
| `npm run ledger -- close --month 2026-11` | Locks a month and every month before it; a late item posts on the first day after the last closed month |
| `npm run ledger -- close --year 2026` | Moves the year's result to retained earnings and locks the year |
| `npm run ledger -- export --csv` / `--json` | Every line; the JSON carries the chain check |
| `npm run ledger -- verify` | Recomputes the ledger's hash chain from the first entry |
| `npm run ledger -- serve` | All reports on a read-only page at http://127.0.0.1:4500/ |

## What holds

- **Balanced or refused.** Debits equal credits per currency, or nothing is written.
- **Nothing is changed or deleted.** The database refuses it. A mistake is corrected by a reversing entry that names
  the one it reverses. Each entry's hash covers the previous one, so `verify` finds any change.
- **Closed months stay closed.** A month close is a row that is only ever added.
- **No guessed VAT.** What Purser fed in has no VAT code (its records do not say which VAT applies); the VAT overview
  counts those lines as "no VAT code yet". Documents booked with a code (purchase and sales invoices) are added up into
  the rubrics.

## For other parts of Purser

`src/ledger/documents.ts` books a purchase invoice (expense or stock, input VAT, payables), a sales invoice
(receivables, revenue, output VAT) and a payment or receipt against an open item; `src/ledger/stock.ts` buys and sells
goods at weighted average cost. The payables inbox and the company API call these.

## Not yet

- Filing the VAT return: the overview is for a person to check and file; filing to the tax authority needs a
  certified connection (Digipoort/SBR).
- One reporting currency: every report is per currency; revaluation is a later step.
- The XAF audit file for the tax authority (XML, needs validating against its schema), depreciation and payroll.
