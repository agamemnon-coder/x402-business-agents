# Money received: a deposit to a global account, against Airwallex's own ledger (13 November 2026)

Airwallex sandbox, test money only. **The deposit was simulated** by the sandbox's simulation endpoint. No one paid
anything.

Tool: `npm run awx-switch-on -- deposit-live`, then `deposit-follow` and `deposit-record` (`src/cli/awxSwitchOn.ts`).
Code: `src/airwallex/deposits.ts` (`GET /deposits`). Each settled deposit becomes a "deposit" movement in the ledger
reconciliation (`src/finance/awxFinancialTx.ts`). The hourly `reconcile()` reads the last week's deposits before it
compares.

Every number below is in [`2026-11-13-airwallex-deposits.json`](2026-11-13-airwallex-deposits.json), from the run
ledger's audit rows and the call log only.

## What ran

| Time (UTC) | Step | Result |
|---|---|---|
| 12:42:41 | `GET /global_accounts` | 3 global accounts, 3 `ACTIVE`; the first, `3964c579-c078-45e2-b400-4615079251de`, was used |
| 12:42:42 | `POST /simulation/deposit/create`, asked as `SETTLED` | deposit `59769c92-01dd-43e4-8b13-4296d71bd171`, GBP 125.00, answered `PENDING` |
| 12:42:42 | `GET /deposits`, from 5 minutes before the run to a minute after | 0 deposits: the new one was not listed yet |
| 12:43:40 | `GET /deposits`, the last day (`deposit-follow`) | 1 deposit: `59769c92…`, GBP 125.00, `SETTLED`, recorded once (`awx_deposit.seen`) |
| 12:43:40 | `GET /financial_transactions?source_id=59769c92…` | one `DEPOSIT` credit GBP 125.00 (`ftx_WXackgHdQ-SLE0KW1xvRcQ`), `SETTLED`: **agrees to the cent** |

What Purser does with a deposit:
- It reads deposits and records each one once; a later change of status is recorded as its own row.
- A `SETTLED` deposit is checked against Airwallex's financial transactions by its id, like a payout.
- One that cannot be read, or a cent off, is a difference: an alarm, and a person looks.

Purser never creates, returns or moves a deposit. Money coming in needs no CFO approval, and nothing here pays anything.
Every payment out still needs the CFO's signature over its exact terms.

## Not shown

- A difference found live (none existed).
- The first listing missed a deposit made a second earlier. The hourly reconciliation reads the last 7 days, so a
  listing that lags is caught on the next run.
- Tested only (`test/airwallex-deposits.test.ts`):
  - a cent off;
  - an unreadable list, which is flagged as a difference;
  - a window wider than 31 days, which is refused;
  - a deposit recorded twice, which is not;
  - a deposit not yet settled, which is not compared.

## Calls

7 Airwallex calls of the 12 approved for this run: 2 logins, 1 `GET /global_accounts`, 1
`POST /simulation/deposit/create`, 2 `GET /deposits`, 1 `GET /financial_transactions`.
