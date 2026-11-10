# T:0 journal posting, 2026-11-10

**Result:** T:0: 95 journal entries posted to T:0's shared sandbox entity on 10 Nov (first je_prod_z7kTCuZ1iiwad01q); debits equal credits, and T:0 matches our books line by line. These are the books of the main run of 3 November.

| | |
|---|---|
| Entity | "T:0 Sandbox" (US, USD), `entity_prod_ieEAMzvhgtHalvsm`. This is a shared demo entity: T:0 said we may write journal entries to it. |
| Key | `agamemnon-coder`, issued by T:0 on 10 Nov. The proxy added it to each request. It is not in code, git, logs or this record. |
| Ledger | A copy of `main-1.sqlite` (sha256 `09895aa2…6e2e27`, the same file as the 5 Nov record). The original was not opened for writing. |
| Rate | EUR/USD 1.1179, the ECB reference rate for 2026-11-03. |
| Account map | `src/config/t0Map.ts` v2. T:0 replaced this entity's chart before 10 Nov (now 261 accounts), so the v1 targets no longer existed. |
| Posted | 95 of 95. First entry posted 06:07:03 UTC, last 06:08:08 UTC. Each entry is recorded in the ledger copy's `t0_postings` table. |
| T:0 calls | About 130 for the posting, within the 130 agreed, including the failed attempts while the key was set up. Then 2 for the read-back and the second push. |

## Steps

1. **Read.** `GET /v1/entities` and `GET /v1/gl-accounts` (261 accounts). None of our 19 codes exists in T:0, so every code goes through the sandbox map below.
2. **Dry run.** 95 entries built: 3 opening balances and 92 journal entries, all dated 2026-11-03, with 190 lines.
   - Debits and credits are each 21,141,221.86 USD.
   - Each entry was checked offline against OpenAPI 1.12.1 (`CustomerJournalEntryRequest`):
     - ISO currency;
     - `je_number` of at most 64 characters, starting `PUR-`, and unique;
     - at least 2 lines;
     - integer `amount_atoms` above 0;
     - memos of at most 1000 characters;
     - debits equal to credits;
     - an idempotency key of at most 128 characters.
   - 0 errors.
3. **One entry, then read back.** `PUR-8264fd976b2da0702aaf01ae` (owner funds the Metal account) became `je_prod_z7kTCuZ1iiwad01q`. `GET /v1/journal-entries/{id}` returned the same `je_number`, the date 2026-11-03 and 2 lines.
4. **The rest.** The push first listed T:0's manual entries for 2026-11-03. It skipped the one already there (`in T:0`) and posted 94, one at a time, each with an `X-Idempotency-Key`. There was no error and nothing was retried.

Sample ids:

| Purser | T:0 |
|---|---|
| `PUR-8264fd976b2da0702aaf01ae` (owner funding on Metal, test USD) | `je_prod_z7kTCuZ1iiwad01q` |
| `PUR-5a96f68546bb47fe4a457407` (Airwallex EUR balance before the run) | `je_prod_ylgcf70AtiY3ylVy` |
| `PUR-374457b597668b38a075a99f` (Airwallex USD balance before the run) | `je_prod_bNIX367ojTdLu2pr` |
| `PUR-60c15b4415a6f0164eea3a98` (stock check sold to retailer 41, test USD) | `je_prod_BUYP5umE2VtDdeDl` |

## Our trial balance, by T:0 account (USD, net debit)

| T:0 account | Our code | Net |
|---|---|---|
| 11120 Operating Checking Account #2 | 1200 Airwallex EUR | 11,144,700.05 |
| 11210 Savings Account #1 | 1201 Airwallex USD | 9,995,581.94 |
| 11410 Payment Processor #1 | 1210 Metal account (test USD) | 20.03 |
| 11999 Money in Transit | 1590 | 1.32 |
| 32000 Common Stock | 3000 Owner's equity | -21,140,636.23 |
| 42000 Services Revenue | 4000 sales, 4100 refunds | -2.05 + 0.15 |
| 51200 Third-Party Services & Licenses | 5000 stock data, 6350 data licence | 1.18 + 268.30 |
| 63410 Software Subscriptions | 6100 | 50.31 |
| 63700 Bank Charges & Fees | 6800 | 15.00 |

The balances are sandbox test money: the Airwallex sandbox balances and Metal testnet *USDZ, posted as USD.

## Read-back and second push (10 Nov, 2 more T:0 calls)

- **Full read-back:** `GET /v1/journal-entries` for 2026-11-03, manual entries, compared with our books by `compareOwnEntries`. **T:0 matches our books line by line.**
  - 95 `PUR-` entries are in T:0 and we built 95; there are 0 differences.
  - 1 other manual entry on that date is someone else's, and it is ignored.
  - Every entry has debits equal to credits: 21,141,221.86 USD each, the same as our books. Status `editable`.
  - Per T:0 account, ours and T:0's:

| T:0 account | Ours (net debit) | T:0 |
|---|---|---|
| 11120 (1200) | 11,144,700.05 | 11,144,700.05 |
| 11210 (1201) | 9,995,581.94 | 9,995,581.94 |
| 11410 (1210) | 20.03 | 20.03 |
| 11999 (1590) | 1.32 | 1.32 |
| 32000 (3000) | -21,140,636.23 | -21,140,636.23 |
| 42000 (4000+4100) | -1.90 | -1.90 |
| 51200 (5000+6350) | 269.48 | 269.48 |
| 63410 (6100) | 50.31 | 50.31 |
| 63700 (6800) | 15.00 | 15.00 |

- **Second push:** posted 0 and skipped 95, every one because it is already in T:0. Re-running is safe.

## Code changes from this run

- **The account map.** `src/config/t0Map.ts` is now v2, for the new chart. The tests use the new revenue account.
- **Entries without a `je_number`.** `T0JournalEntry.je_number` can now be null, so imported entries in T:0 no longer crash the comparison or the dedup.
- **No Node fetch change.** The Node fetch the CLI uses only went through the session's network proxy with `NODE_USE_ENV_PROXY=1`, which is a local setting, not a code change.

## T:0's own statements (10 Nov, 09:00 UTC)

Two read-only calls to T:0's report endpoints after our entries were in: `GET /v1/reports/balance-sheet` and `GET /v1/reports/cash-flow` (the cash flow statement had not been used before), for November 2026, monthly. A third T:0 request fetched the public OpenAPI document. No writes.

| Check | Result |
|---|---|
| Balance sheet balances (assets = liabilities + equity) | Yes: 26,447,805.98 = 3,807,739.87 + 22,640,066.11 USD, difference 0.00 (`balanceSheetCheck`) |
| Cash flow, financing activities | 21,140,636.23 USD: exactly the owner funding in our books (account 3000 → T:0 32000, row above) |
| Cash flow, net increase for the period | 21,118,854.03 USD (`cashFlowNetChange`) |

Caveat: the sandbox entity is shared with other hackathon teams, so the statements' totals include their entries too; the line-by-line match with our books is the journal-entry comparison above. The financing line matches because no other team booked financing in November.

Code: `T0Client.cashFlow`, `balanceSheetCheck` and `cashFlowNetChange` in `src/accounting/t0.ts`, tested in `test/t0-statements.test.ts`.
