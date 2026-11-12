# Airwallex's own ledger against Purser's, to the cent (12 November 2026)

Airwallex sandbox, read only. Tool: `npm run awx-depth -- ft` and `ft-reconcile` (`src/cli/awxDepth.ts`). Code:
`src/finance/awxFinancialTx.ts` (`GET /financial_transactions`), behind `AIRWALLEX_FINANCIAL_TX=on` (off by default).
Every number below is in [`2026-11-12-airwallex-financial-transactions.json`](2026-11-12-airwallex-financial-transactions.json),
from audit rows and the call log only.

## What ran

One read of Airwallex's financial transactions for the awx-1 window (7 November, 12:00 to 12:30 UTC): 8 rows. Each was
compared with the movements the committed awx-1 record holds ([`docs/demo/airwallex-run.json`](../demo/airwallex-run.json)),
by Airwallex source id, in integer cents.

| Movement in Purser's record | What Airwallex booked | Result |
|---|---|---|
| SLL-2026-11 payout `738a4263…`: EUR 240.00 + fee EUR 13.50 | a PAYOUT row EUR 240.00 and a FEE row EUR 13.50, both under the transfer id | agrees |
| BTX-2026-11 payout `4140dee2…`: EUR 1,850.00 + fee EUR 13.50 | a PAYOUT row EUR 1,850.00 and a FEE row EUR 13.50 | agrees |
| BTX-2026-11 conversion `fafcc208…`: buy EUR 623.50, sell USD 704.45 | CONVERSION_BUY EUR 623.50, CONVERSION_SELL USD 704.45 | agrees |

3 checked, 3 agree, 0 differences. 0 payouts, fees or conversions at Airwallex that the record lacks. 2 rows out of
scope: card authorisation holds (`CARD_PURCHASE`, EUR 45.00 and EUR 19.99, PENDING); card transactions are not part of
this comparison.

How the comparison was refined: the first pass (audit row 6) agreed on the same numbers but described the fee as
"included in the gross amount". The rows show the fee as its own FEE row, so the comparison now checks that shape
exactly, and `ft-reconcile` ran it again on the rows already read (audit row 7; 0 calls).

Not shown: a difference found live (none existed). Tests (`test/airwallex-financial-tx.test.ts`) show one cent off, a
missing row, a cancelled row, a payout and its fee that the ledger lacks, and paging.

## Calls

2 Airwallex calls for this capability: 1 login, 1 `GET /financial_transactions` (one page).

## Wording to apply (other sessions own these pages)

- Proof, "Airwallex, read back": "Reconciled with Airwallex's own ledger (financial transactions): the awx-1 payouts,
  their fees and the conversion agree to the cent; 0 differences, 0 movements Purser did not make."
