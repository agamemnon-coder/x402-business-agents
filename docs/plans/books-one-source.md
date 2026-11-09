# One source of truth for the books: design note (9 November)

Status: a proposal, nothing built. Open item "One source of truth for the books" in [go-live.md](../go-live.md).

## Where it stands

Purser has two bookkeeping views of the same movements:

1. **The stored ledger** (`src/ledger/`): posted, hash-chained entries, period locks, VAT overview, stock. It is fed by
   `syncLedger` (`src/ledger/feed.ts`) from the cash journal (`src/accounting/gl.ts`) plus the opening balances, and
   by the payables inbox's accruals (`src/ap/books.ts`). The cloud's reports come from this ledger
   (`test/cloud-sync.test.ts`).
2. **The computed books** (`src/accounting/books.ts`): `books(db)` turns the same cash journal into postings on every
   call, nothing stored. It feeds the dashboard's Books screen (`booksView`, `src/dashboard/snapshot.ts`),
   `npm run books`, the month pack (`src/accounting/monthPack.ts`), the payment trace (`src/redesign/trace.ts`), the
   data QA (`src/finance/dataQa.ts`) and the T:0 sink (`src/accounting/t0Sink.ts`, `src/cli/t0.ts`), which mirrors
   `CHART` account for account.

They agree today on what both hold: `test/ledger-feed.test.ts` ("the same balances as the computed books"). They differ
by design in two ways: the stored ledger also holds the payables accruals (`AP_CHART`: input VAT 1510, payables 2100)
and its own accounts (`LEDGER_CHART`), and it respects period locks (a late movement lands on the first open day). So a
CFO can see one trial balance on the Books screen and another in the cloud for the same day.

## The risk

Two derivations of the books drift: a fix in one is missed in the other, and a number on screen is not the number in
the ledger an auditor checks. The parity test only covers the cash-journal part.

## Smallest safe change

Make the stored ledger the only source for anything shown or exported as "the books"; keep `doubleEntry` only as the
feed's internal step and as a cross-check.

1. **A parity guard first** (test only, no behaviour change): for every fixture world in the existing tests, after
   `syncLedger`, the stored ledger's trial balance restricted to `CHART` accounts equals `trialBalance(books(db))`, per
   account and currency, to the cent; and the stored ledger's extra lines are exactly the payables accruals and the
   period-lock moves. This turns today's single parity test into the rule.
2. **Readers one at a time**, each behind that guard, each its own commit with its own test:
   - the Books screen (`booksView`) reads `trialBalance` from `src/ledger/reports.ts` after a sync;
   - `npm run books` and the month pack export the stored ledger (`exportCsv`, already tested);
   - the payment trace and the data QA read the stored entry for a payment by its source key.
3. **The T:0 sink last.** It mirrors `CHART` only; it would read the stored ledger's `CHART` lines. The payables
   accounts reach T:0 only once T:0 has them (a mapping decision for Max and the accountant, not code).
4. **Then** `books()` becomes the feed's private helper; `doubleEntry` stays for the parity check.

What this does not change: the cash journal stays the record of movements; the ledger is still fed only by
`syncLedger` and the payables inbox; no posted entry is rewritten.

## Not now

No refactor without the guard in step 1. Steps 2–4 touch the dashboard, the month pack and the T:0 sink, which the
submission's pages and tests use; they go after 15 November, one reader per pull request.
