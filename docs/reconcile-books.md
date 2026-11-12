# Reconciling with the outside books

`npm run reconcile-books -- --books <exact|bc|odoo|moneybird|t0>` sets Purser's books next to the outside books, one
document at a time. The code is `src/accounting/reconcileBooks.ts`; the command is `src/cli/reconcileBooks.ts`.

## What is compared

For every invoice Purser's ledger feeds the outside books (`src/erp/source.ts`): the net amount, the VAT, the gross
amount, the amount paid and the state (open, partly paid, paid), to the cent. Each document ends as one of:

- **equal**: every figure compared is the same;
- **differs**: each difference is named with both figures and the exact difference in cents. A payment the outside
  books do not show is named by Purser's request id;
- **missing outside**: the outside books do not hold the document;
- **only outside**: the outside books hold a document Purser does not.

A figure the outside books could not give (a read that failed) is **not compared**. It never counts as equal. The
verdict is `agree` (exit code 0), `differ` (1) or `partly compared` (2).

## Which outside books

**A bookkeeping package** (`exact`, `bc`, `odoo`, `moneybird`). Each invoice is found by the id the ERP sync recorded,
or else looked up (`findExisting`). A connector that can read an invoice back (`readPurchaseInvoice`) gives all five
figures. Without that, only whether the invoice is paid is compared, and the result says so. A connector cannot list
everything it holds, so a document that is only in the package is not found this way.

**T:0**. T:0 holds journal entries, not invoices, so only the amount paid is compared per document: each of Purser's
payments must be in T:0, under the entry number Purser gave it (`src/accounting/t0.ts`), with its amount. Two checks of
T:0 as a whole come with it: T:0's own balance sheet must balance in every month (`balanceSheetCheck`), and Purser's
entries in T:0 must equal the ones built from Purser's books (`compareOwnEntries`). Net, VAT, gross and state are not
compared there, and the result says so.

## Running it

It only reads. It reads the outside books only when a person runs it with that system's settings: the same settings as
`npm run erp` (docs/erp.md) or `npm run t0` (`T0_API_KEY`, and `T0_RATES`, `T0_MAP` where needed). Without them it
names the missing setting (never its value), reads nothing and keeps nothing.

Each run that read the outside books is kept as one audit row, `books.reconciled`: the verdict, the counts, the checks,
what could not be compared and the first 50 differences. The payables server serves the latest one per outside book,
read-only: `GET /api/payables/reconciliations`.

The tests use stand-ins for both (a package that keeps what it holds, and the T:0 stand-in): no live call was made for
this (`test/reconcile-books.test.ts`).
