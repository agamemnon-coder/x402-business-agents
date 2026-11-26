# Receivables, live: 2026-11-26

`npm run airwallex:money-loop-live -- live receivables`. Money in against the real sandbox: two customer invoices booked, one with a real single-use Airwallex payment link; two incoming payments made by the sandbox's deposit simulation on the EUR Global Account, read back from Airwallex and matched by Purser (one pays its invoice, one names nothing and goes to review); the paid invoice's link switched off at Airwallex; a reminder drafted for the overdue invoice and never sent. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `9abc1b24bfad`. The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-26-receivables-live.json.

**9 of 9 steps passed, 0 failed, 0 not judged** (measurements, or not supported by the sandbox). 10 Airwallex calls of a budget of 30 (the drill's hard limit: 40; logins included), one at a time, at least 200 ms apart; 0 answered 429; 0 unexpected non-2xx.

## In short

- pass, `ar.issue_linked`: NW-AR-112601 EUR 121.00 booked (entry 1); link a0003ca6-d9d0-4baf-be68-40ca37c8abbd; read back: EUR 121.00, reference NW-AR-112601, single use, active
- pass, `ar.deposits`: 65908513-1b9b-4759-9e5c-7cdf381342af EUR 121.00 (NW-AR-112601); 6ebb9a84-0c1d-4005-afda-9882d16af239 EUR 33.33 (GIFT-TEST-1126)
- pass, `ar.readback`: reads: none -> SETTLED+SETTLED; 65908513-1b9b-4759-9e5c-7cdf381342af EUR 121.00 SETTLED reference NW-AR-112601; 6ebb9a84-0c1d-4005-afda-9882d16af239 EUR 33.33 SETTLED reference GIFT-TEST-1126
- pass, `ar.match`: 65908513-1b9b-4759-9e5c-7cdf381342af: ar MATCHED (NW-AR-112601: reference names NW-AR-112601); NW-AR-112601 PAID; 6ebb9a84-0c1d-4005-afda-9882d16af239: ar REVIEW (no invoice: amount); review queue 1: EUR 33.33, "no invoice named and no open invoice is open for exactly this amount"; suspense EUR 33.33; 0 calls
- pass, `ar.once`: MATCHED (NW-AR-112601: reference names NW-AR-112601); ledger entries 4 -> 4; payments recorded 2
- pass, `ar.link_off`: retired NW-AR-112601; read back not active
- pass, `ar.dunning`: 1 draft(s): NW-AR-112602 stage 1 due 2026-11-23; stored DRAFT; aged: NW-AR-112602 EUR 60.50 6 days (0-30); 0 calls
- Shown: A payment link at Airwallex for exactly one invoice (amount, currency, reference, single use), read back, and switched off once the invoice is paid.
- Shown: A deposit read back from Airwallex is matched to its open invoice by its reference and booked once; a second sight of it books nothing.
- Shown: A deposit that names no invoice and fits none goes to the review queue and to suspense (2900), never to revenue.
- Shown: Reminders are drafts for a person: one drafted for the overdue invoice, stored as DRAFT, sent by nobody.

## Simulated, and how

- The customers are made up ("Alpenhof Sport AG (test customer)", "Fjordline Outdoor AS (test customer)", "Unknown Test Payer GmbH"). Their payments are the sandbox's deposit simulation (`POST /simulation/deposit/create`): no bank transfer and no card payment took place. Once made, each deposit is Airwallex's own record, read back with `GET /deposits` and matched from what Airwallex answered.
- The overdue invoice is dated 30 days back by the run (issued then, due 6 days ago): nothing waited, and the reminder is drafted for that due date.
- No passkey: money in needs no CFO approval in Purser; nothing here pays anything.

## Steps (19:53:54.487–19:54:14.097 UTC)

A fresh ledger of its own. Before the runs, 6 read-only calls looked at the sandbox (two probes, logins included: the balances twice, the beneficiaries and the Global Accounts); none moved money or changed anything, and they are not in this record's call table. The three runs (19:53 to 19:54 UTC) ran one after the other on the code committed as `9abc1b24b`. The code that ran includes the review fixes of 26 Nov: the FX executor judges the floor on free money under the payout lock and holds the signed maximum, and checks the stop, pause and the agent's identity again right before the create; a payment reference names an invoice only as a whole word.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `ar.issue_linked` Invoice NW-AR-112601 issued to a test customer (EUR 121.00 with 21% VAT, due in 14 days): booked, and a single-use Airwallex payment link made for exactly it, then read back | treasury | booked once; the link and its read-back exactly the invoice | NW-AR-112601 EUR 121.00 booked (entry 1); link a0003ca6-d9d0-4baf-be68-40ca37c8abbd; read back: EUR 121.00, reference NW-AR-112601, single use, active | **pass** | 1, 2, 3 | 1390 |
| 2 | `ar.issue_overdue` Invoice NW-AR-112602 to another test customer (EUR 60.50, VAT 0%), issued 30 days ago and due 6 days ago; no link *(simulated: an invoice dated in the past by the run (its dates are written, nothing waited 30 days))* | treasury | booked; no Airwallex call | NW-AR-112602 EUR 60.50 booked, due 2026-11-20; 0 calls | **pass** | 0 | 2 |
| 3 | `ar.global_account` The EUR Global Account money arrives on (GET /global_accounts) | – | one ACTIVE account that receives EUR | 3 ACTIVE Global Accounts; EUR: 4e868b5f-2b52-4539-9d8b-14809a65939c | **pass** | 4 | 384 |
| 4 | `ar.deposits` Two payments arrive by the sandbox's simulation (POST /simulation/deposit/create): EUR 121.00 with reference NW-AR-112601, and EUR 33.33 with reference GIFT-TEST-1126 (no invoice) *(simulated: the payer and the money are the sandbox's deposit simulation; the deposits are then Airwallex's own records)* | – | two deposits made at Airwallex | 65908513-1b9b-4759-9e5c-7cdf381342af EUR 121.00 (NW-AR-112601); 6ebb9a84-0c1d-4005-afda-9882d16af239 EUR 33.33 (GIFT-TEST-1126) | **pass** | 5, 6 | 1411 |
| 5 | `ar.readback` Both deposits read back from Airwallex (GET /deposits for the run's window), again every 15 s until SETTLED (at most 4 reads) | – | both found, SETTLED, with the amount and reference sent | reads: none -> SETTLED+SETTLED; 65908513-1b9b-4759-9e5c-7cdf381342af EUR 121.00 SETTLED reference NW-AR-112601; 6ebb9a84-0c1d-4005-afda-9882d16af239 EUR 33.33 SETTLED reference GIFT-TEST-1126 | **pass** | 7, 8 | 15694 |
| 6 | `ar.match` Purser matches each deposit as Airwallex read it back (routeDeposit, src/receivables/ar.ts) | treasury | NW-AR-112601 paid by its reference; the unknown payment to review and suspense (2900), never to revenue | 65908513-1b9b-4759-9e5c-7cdf381342af: ar MATCHED (NW-AR-112601: reference names NW-AR-112601); NW-AR-112601 PAID; 6ebb9a84-0c1d-4005-afda-9882d16af239: ar REVIEW (no invoice: amount); review queue 1: EUR 33.33, "no invoice named and no open invoice is open for exactly this amount"; suspense EUR 33.33; 0 calls | **pass** | 0 | 10 |
| 7 | `ar.once` The first deposit routed again (a webhook and a poll that both see it) | treasury | recorded once: the same outcome, no second booking | MATCHED (NW-AR-112601: reference names NW-AR-112601); ledger entries 4 -> 4; payments recorded 2 | **pass** | 0 | 3 |
| 8 | `ar.link_off` The paid invoice's payment link switched off at Airwallex (retireDoneLinks), then read back | treasury | deactivated: active false read back | retired NW-AR-112601; read back not active | **pass** | 9, 10 | 682 |
| 9 | `ar.dunning` The aged debtors and the reminder drafts as of today (draftReminders): NW-AR-112602 is 6 days late | treasury | one first-stage reminder drafted for it, stored as DRAFT, never sent; the paid invoice not in the aged list; no Airwallex call | 1 draft(s): NW-AR-112602 stage 1 due 2026-11-23; stored DRAFT; aged: NW-AR-112602 EUR 60.50 6 days (0-30); 0 calls | **pass** | 0 | 1 |

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 19:53:54.495 | 19:53:55.077 | 582 | `POST /authentication/login` | 201 | – | `26ad1a0d960440019ed971e054710e24` | – | ar.issue_linked (treasury) |
| 2 | 19:53:55.084 | 19:53:55.543 | 459 | `POST /pa/payment_links/create` | 201 | – | `327e8487fdf1475a838307912f1ffa88` | – | ar.issue_linked (treasury) |
| 3 | 19:53:55.545 | 19:53:55.879 | 334 | `GET /pa/payment_links/{id}` | 200 | – | `15898280c6a34821ad6774c0bed6a48f` | – | ar.issue_linked (treasury) |
| 4 | 19:53:55.883 | 19:53:56.265 | 382 | `GET /global_accounts` | 200 | – | `f779e725a06c409c8cbfb938cf9f44e1` | – | ar.global_account |
| 5 | 19:53:56.270 | 19:53:56.967 | 697 | `POST /simulation/deposit/create` | 201 | – | `1eba5a86f4654a949cc3c27fa42a8bd1` | – | ar.deposits |
| 6 | 19:53:56.968 | 19:53:57.679 | 711 | `POST /simulation/deposit/create` | 201 | – | `21d4b418a83b491d8a54342a6298628c` | – | ar.deposits |
| 7 | 19:53:57.681 | 19:53:57.989 | 308 | `GET /deposits` | 200 | – | `c4e95384e27040989c2643ea715fae1f` | – | ar.readback |
| 8 | 19:54:13.003 | 19:54:13.374 | 371 | `GET /deposits` | 200 | – | `3d1c3cfdf79245fe8a93f7de0d2ee285` | – | ar.readback |
| 9 | 19:54:13.405 | 19:54:13.762 | 357 | `POST /pa/payment_links/{id}/deactivate` | 200 | – | `a1d73e2e40ed4a54a449831345a239f8` | – | ar.link_off (treasury) |
| 10 | 19:54:13.763 | 19:54:14.083 | 320 | `GET /pa/payment_links/{id}` | 200 | – | `93045700eaac425e81ddcf1f02542cd2` | – | ar.link_off (treasury) |

Calls by endpoint: `POST /authentication/login` 1, `POST /pa/payment_links/create` 1, `GET /pa/payment_links/{id}` 2, `GET /global_accounts` 1, `POST /simulation/deposit/create` 2, `GET /deposits` 2, `POST /pa/payment_links/{id}/deactivate` 1.

## What this does not show

- A customer paying through the link's hosted checkout page (a card payment): not done; the link is made, read back and switched off.
- A real bank transfer from a customer: the deposits are the sandbox's simulation.
- Partial, short and overpaid payments live: covered by test/receivables-ar.test.ts, not run against the sandbox.
