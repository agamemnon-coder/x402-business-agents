# Connected accounts, first sandbox run (10 November 2026)

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

## Proposed next run (needs Max's go; about 12 calls)

Login (1); `POST /accounts/{id}/update` with complete test verification details from Airwallex's documented example
(1–3, each answer names the next missing field); `submit` (1); simulation to `ACTIVE` (1); fund the account from the
platform with `connected_account_transfers/create` (1); with `x-on-behalf-of`: `beneficiaries/create` (1), a €5 transfer
through Purser's `createPayoutTransfer` (1), the simulation to `PAID` (1), Purser's fee call (1), a €2 transfer with
`application_fee_options` (1). Or ask Airwallex for the hosted onboarding template id and do the verification once in
the browser.

Call log (method, path with ids, time; no bodies, no headers) as Purser's budget wrote it: 4 lines.
