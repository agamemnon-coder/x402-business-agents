# Connected accounts, sandbox runs (10 November 2026)

Airwallex (Turner Vickery, hackathon Slack #help, 10 Nov) enabled connected accounts and payment acceptance on our
sandbox platform account `acct_op0_QItiOyWKsYb5pwQihA` (registered in the Netherlands). Max gave the go for a run of at
most 12 Airwallex calls. Sandbox only, test data only, no money moved. Every call went through Purser's own client
(`src/airwallex/client.ts`) under Purser's call budget (`AIRWALLEX_CALL_BUDGET=12`, one log line per request before it
is sent); the account was opened through Purser's platform rail (`AirwallexPlatformRest.createConnectedAccount`).

**Calls used: 4 of 12.** The run stopped at the first blocker, as agreed: activation needs a submitted account, and
submitting needs the company's verification details.

| # | Time (UTC) | Call | Answer | What it shows |
|---|---|---|---|---|
| 1 | 05:02:45.871 | `POST /authentication/login` | 200 | the platform's own login |
| 2 | 05:02:46.480 | `POST /accounts/create` (Purser's rail: business name "Purser Sandbox Test BV (fake)", NL, a test e-mail, both customer agreements, a `request_id`) | 201, `acct_SC-QD89fOneAeqaRFgOymw`, `CREATED` | **connected accounts are now enabled** (on 9 Nov the same call answered 400 "This account cannot onboard business accounts"); the body Purser sends is accepted as it is, `request_id` included |
| 3 | 05:02:47.535 | `POST /accounts/acct_SC-QD89fOneAeqaRFgOymw/submit` | 400 `field_required`, source `account_details.business_details.business_structure` (trace `aa239a3c67ee4c99a8fe054af106b5ab`) | submitting for verification needs the company's verification details; Airwallex names the first missing field only |
| 4 | 05:02:48.313 | `POST /simulation/accounts/acct_SC-QD89fOneAeqaRFgOymw/update_status` `{ next_status: ACTIVE, force: true }` | 400 `bad_request` "Account needs to be submitted for review before using this endpoint" (trace `d5f3f097dbe34150b939c9cd4b861671`) | the sandbox's activation simulation works only from `SUBMITTED`, as the docs say; `force` does not skip it |

Nothing was paid, no beneficiary was created and no fee was taken. The test account stays `CREATED` in our sandbox.

## Confirmed live

- Our sandbox can open connected accounts (`POST /accounts/create` → `CREATED`), with the body Purser's rail sends.

## Still unconfirmed (nothing called)

- How a company gets from `CREATED` to `ACTIVE` in our sandbox: either Airwallex's hosted onboarding (needs the KYC
  template id from Airwallex) filled in once in the browser, or the account updated with complete test verification
  details through the API, then `submit`, then the simulation to `ACTIVE`. The second needs an unknown number of calls,
  because `submit` names one missing field at a time.
- Everything after `ACTIVE`: balances, beneficiaries, transfers and the simulation calls with `x-on-behalf-of`; funding
  a connected account from the platform (`connected_account_transfers/create`, the documented direction); Purser's fee.
- `request_id` on `accounts/create` as an idempotency id: accepted without an error, but whether Airwallex uses it is not
  known.
- The platform fee. Airwallex's sample integration for payout platforms (docs, read 10 Nov:
  `global-treasury/use-cases/payroll/cross-border-payroll-payouts/sample-integration`) shows **`application_fee_options`
  on `POST /transfers/create`** sent with `x-on-behalf-of` (for example `{ source_type: "TRANSFER", type: "PERCENTAGE",
  percentage: "0.5" }`), answered with `application_fees` per fee. That is a documented way to take a platform fee from
  the payout itself; Purser's build still uses `connected_account_transfers/create` with `x-on-behalf-of` (unconfirmed).
  The same page says FX and payout fee mark-ups are configured with the Account Manager. Neither is tested.
- The webhook fields of `account.*` events.


## Second run: verification details, submit, ACTIVE (7 of 8 further calls)

Max approved 8 more calls. Before any call, the required fields for a Netherlands business were read from Airwallex's
docs (`connected-accounts/onboarding/kyc-and-onboarding/native-api/business-kyc-requirements/netherlands-(nl)`): a
**non-registered sole trader** (`business_structure: SOLE_PROPRIETOR`, no `business_identifiers`) needs no business
registration number and no uploaded documents, so it can be filled in in one update with clearly fake test data.

| # | Time (UTC) | Call | Answer |
|---|---|---|---|
| 5 | 05:30:48.925 | `POST /authentication/login` | 200 |
| 6 | 05:30:49.750 | `GET /reference/industry_categories` | 200, 13 groups, 169 codes; picked "Professional services > Management consulting" `ICCV3_0808XX` |
| 7 | 05:30:50.564 | `POST /accounts/acct_SC-QD89fOneAeqaRFgOymw/update`: business name "Purser Sandbox Test (fake sole trader)", `SOLE_PROPRIETOR`, description (states it is fictional), industry code, operating country NL, a test registration address, account usage `MAKE_TRANSFERS` / EUR 5,000 a month; one person "Test Persoon (fake)", born 1985-01-01, NL, roles `AUTHORISED_PERSON` + `BENEFICIAL_OWNER`, test address, a test passport number (no file) | 200, still `CREATED` |
| 8 | 05:30:51.159 | `POST /accounts/acct_SC-QD89fOneAeqaRFgOymw/submit` | 200, **`SUBMITTED`** |
| 9 | 05:30:51.849 | `POST /simulation/accounts/acct_SC-QD89fOneAeqaRFgOymw/update_status` `ACTIVE` | 400 "Account needs to be submitted for review before using this endpoint" (trace `fa51062be6de4c7a9aecfa1099e1f6f1`), 0.7 s after the submit answered |
| 10 | 05:32:03.379 | `POST /authentication/login` (a new process, after waiting 60 s) | 200 |
| 11 | 05:32:04.238 | `POST /simulation/accounts/acct_SC-QD89fOneAeqaRFgOymw/update_status` `ACTIVE` | 200, **`ACTIVE`** |

**Confirmed live:** a Netherlands connected account goes `CREATED` → `SUBMITTED` → `ACTIVE` in our sandbox through the
documented API, with one update holding the verification details of a non-registered sole trader. The submit is taken in
asynchronously: right after it, the simulation still reads the account as not submitted; a minute later it works.

**Not done in this run (1 approved call left, a payout needs 4; done in the third run below):** funding the account from the platform
(`connected_account_transfers/create`), a beneficiary and a EUR 5 payout with `x-on-behalf-of`, with Purser's fee as
`application_fee_options` (EUR 0.05, FIXED) through Purser's `createPayoutTransfer`. Nothing was paid, no beneficiary was
created and no fee was taken. No transfer exists, so nothing is `IN_APPROVAL`, and nothing was approved in Airwallex's web
app. The script for those 4 calls is ready and was run against a stand-in.

Purser's code before this run (commit `baad3b3`): Purser's fee now goes with the payout as `application_fee_options`
(the documented way for payout platforms) and is counted taken and booked only when the payout is PAID with exactly the
signed fee reported in `application_fees`; the invoice-payment route follows a payout that is not yet PAID (for example
`IN_APPROVAL`) instead of marking it FAILED.

## Third run: the payout with Purser's fee, PAID (6 of 6 calls)

Max: "do everything", at most 6 calls. All through Purser's client; the payout through Purser's `createPayoutTransfer`.

| # | Time (UTC) | Call | Answer |
|---|---|---|---|
| 12 | 05:39:21.774 | `POST /authentication/login` | 200 |
| 13 | 05:39:22.402 | `POST /connected_account_transfers/create`, platform → `acct_SC-QD89fOneAeqaRFgOymw`, EUR 20.00 (test money) | `tr_oZIJlT2oNQ2OX33f83UCag`, `NEW` |
| 14 | 05:39:23.011 | `POST /beneficiaries/create` with `x-on-behalf-of`: "Zeeland Verpakkingen BV (test)", NL IBAN, SWIFT | `f8678483-2718-4393-a328-d78261b5d5a4` |
| 15 | 05:39:23.780 | `POST /transfers/create` with `x-on-behalf-of`: EUR 5.00, SWIFT, request id `cacc-pay-mwa9ftwt`, `metadata.approval_sha256`, **`application_fee_options: [{ source_type: TRANSFER, type: FIXED, amount: "0.05", currency: EUR }]`** | `a9460dba-f31b-4111-be58-6d9a9e71adb1`, **`SCHEDULED`**, **`application_fees`: EUR 0.05 (TRANSFER)**, Airwallex's own SWIFT fee `fee_amount` EUR 13.41 |
| 16 | 05:39:24.995 | `POST /simulation/transfers/{id}/transition` `SENT` (with `x-on-behalf-of`) | `SENT`, no `application_fees` in the answer |
| 17 | 05:39:25.951 | `POST /simulation/transfers/{id}/transition` `PAID` (with `x-on-behalf-of`) | **`PAID`**, no `application_fees` in the answer, `fee_amount` EUR 13.41 |

**Confirmed live in the sandbox:** a payout from a connected account (`x-on-behalf-of` on beneficiaries, transfers and
the transfer simulation), funded from the platform with `connected_account_transfers/create`, and **Purser's fee taken
with the payout as `application_fee_options`: Airwallex accepted exactly EUR 0.05** and reported it in
`application_fees`. The payout went `SCHEDULED` → `SENT` → `PAID` through the sandbox's simulation (the settlement is
simulated; test money). It did not come back `IN_APPROVAL`: no approval workflow was active for it. Airwallex's SWIFT
fee in the sandbox was EUR 13.41 on a EUR 5.00 payout.

**What the live answers changed in Purser** (commit after `7febdea`): the simulation's answers leave `application_fees`
out, so Purser now keeps the fee Airwallex accepted at create (exactly the signed amount, for that payout) and counts it
taken when that payout is PAID; any other amount is noted for a person and the fee stays `OPEN`.

Still unconfirmed: whether `GET /transfers/{id}` and the live (non-simulated) PAID answer carry `application_fees`, where
the fee shows in the platform account's balance, and the platform webhooks.

## Next

Nothing more is planned against the sandbox for this. Max may switch on Airwallex's transfer approval workflow in the web
app; a later payout then waits `IN_APPROVAL` until Max approves it there (Purser follows it, see `docs/airwallex-platform.md`).

Call log (method, path with ids, time; no bodies, no headers) as Purser's budget wrote it: 4 lines in the first run,
7 in the second, 6 in the third (17 calls in all, each within the budget Max approved for it).
