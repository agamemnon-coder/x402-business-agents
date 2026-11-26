# Cash and FX, live: 2026-11-26

`npm run airwallex:money-loop-live -- live fx-convert`. The Treasury advisor against the real sandbox: the balances read, a 13-week forecast from them and the ledger, the advisor's suggested conversion from Airwallex's indicative rates over the CFO's threshold, the passkey's approval, and the executor's real quote and conversion; a change to the signed terms refused before any call. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `9abc1b24bfad`. The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-26-fx-conversion-live.json.

**9 of 9 steps passed, 0 failed, 0 not judged** (measurements, or not supported by the sandbox). 11 Airwallex calls of a budget of 30 (the drill's hard limit: 40; logins included), one at a time, at least 200 ms apart; 0 answered 429; 0 unexpected non-2xx.

## In short

- pass, `fx.balances`: 4 currencies with money available: CNY 10000000.00, EUR 9622616.14, GBP 10001085.50, USD 9981754.40; CHF available 0.00
- pass, `fx.advice`: CHF lowest -100.00 in week 2, short 100.00; suggested: buy CHF 100.00 with at most EUR 111.49 (indicative 110.38 at 0.905922, about EUR 110.38 against the threshold EUR 50.00); 4 rates read
- pass, `fx.changed_after_signing`: P-0002 approved; changed, then refused: P-0002: terms do not match the approved hash 3531b2889e62336431c276f0005a0cc9ac3b11ddd4a88ba8e331765b6b36293d; 0 Airwallex calls; status APPROVED, then closed NEEDS_REAPPROVAL; 0 conversions in the ledger
- pass, `fx.signed`: P-0003 APPROVED: buy CHF 100.00 with at most EUR 111.49; request_id 0d1530c5-82cf-459e-96fb-a98d5a5f2970
- pass, `fx.convert`: EXECUTED: converted EUR 110.38 to CHF 100.00 (45168a42-b5b5-4038-b3a9-050e28abaf91); quote af3936fb-5f52-3562-aaf4-6102c84a0583; payment EXECUTED; calls GET /fx/conversions, GET /balances/current, POST /fx/quotes/create, POST /fx/conversions/create
- pass, `fx.readback`: 45168a42-b5b5-4038-b3a9-050e28abaf91 SETTLED: EUR 110.38 to CHF 100.00; request_id the signed one; metadata approval_sha256 the signed hash
- pass, `fx.again`: refused: P-0003 is EXECUTED, not approved; 0 calls; 1 conversion in the ledger
- Shown: The advisor's suggestion is computed from Airwallex's real available balances and indicative rates, and is filed only because it is at or above the CFO's threshold.
- Shown: Terms changed after the passkey signed them reach nothing outside Purser: the executor refused before any Airwallex call.
- Shown: The signed conversion is one real sandbox quote and one real conversion, for exactly the signed buy amount, within the signed maximum, under the signed request id; asked again, nothing is converted twice.

## Simulated, and how

- The approver is a labelled virtual test passkey ("money-loop virtual test passkey (no person's Face ID)", src/redteam/authenticator.ts), enrolled as the only passkey of the run's own fresh ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.
- The CHF payable (AGZ-1126, "Alpenglas Zuerich AG (test supplier)") is a test invoice entered in the run's ledger: no supplier sent it, and it is not paid by this run. The balances, the rates, the quote and the conversion are the sandbox's own (test money).
- The change after signing (buy_amount 100.00 to 100.01 in the stored terms) is made by the run in its own ledger, as someone with write access to the ledger would; the refused proposal is then closed.

## Steps (19:53:39.773–19:53:44.519 UTC)

A fresh ledger of its own. The sandbox holds no CHF, so a test payable of CHF 100.00 due in 10 days makes the forecast fall CHF 100.00 short; the CFO's threshold is EUR 50.00. Before the runs, 6 read-only calls looked at the sandbox (two probes, logins included: the balances twice, the beneficiaries and the Global Accounts); none moved money or changed anything, and they are not in this record's call table. The three runs (19:53 to 19:54 UTC) ran one after the other on the code committed as `9abc1b24b`. The code that ran includes the review fixes of 26 Nov: the FX executor judges the floor on free money under the payout lock and holds the signed maximum, and checks the stop, pause and the agent's identity again right before the create; a payment reference names an invoice only as a whole word.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: money-loop virtual test passkey (no person's Face ID) | **pass** | 0 | 15 |
| 2 | `fx.balances` Read the sandbox's real balances (GET /balances/current), the forecast's opening | treasury | EUR available; CHF held or not, as Airwallex says | 4 currencies with money available: CNY 10000000.00, EUR 9622616.14, GBP 10001085.50, USD 9981754.40; CHF available 0.00 | **pass** | 1, 2 | 1180 |
| 3 | `fx.policy` The CFO sets the FX threshold (treasury.fx_threshold_eur) to EUR 50.00 with the passkey; a test payable of CHF 100.00 (AGZ-1126, due 2026-12-06) is entered in the run's ledger *(simulated: signed by the virtual test passkey; the CHF payable is a test invoice entered in the ledger (no supplier sent it))* | treasury | the threshold applied; the payable open; no Airwallex call | P-0001 approved by the passkey and applied: threshold EUR 50.00; payable AP-FX-1126 CHF 100.00 due 2026-12-06; 0 Airwallex calls | **pass** | 0 | 83 |
| 4 | `fx.advice` The 13-week forecast from the real balances and the ledger; the advisor's exposure and suggestion from Airwallex's indicative rates (GET /fx/rates/current, which moves nothing) | treasury | one suggestion: buy CHF 100.00 with EUR, at or above the threshold | CHF lowest -100.00 in week 2, short 100.00; suggested: buy CHF 100.00 with at most EUR 111.49 (indicative 110.38 at 0.905922, about EUR 110.38 against the threshold EUR 50.00); 4 rates read | **pass** | 3, 4, 5, 6 | 1506 |
| 5 | `fx.changed_after_signing` A conversion proposal filed and signed with the passkey; its stored terms then changed (buy_amount 100.00 to 100.01) and the executor started *(simulated: signed by the virtual test passkey; the change after signing is made by the run in the ledger, as an attacker with write access would)* | treasury | refused by the executor before any Airwallex call (the terms no longer hash to what was signed); closed: nothing converted | P-0002 approved; changed, then refused: P-0002: terms do not match the approved hash 3531b2889e62336431c276f0005a0cc9ac3b11ddd4a88ba8e331765b6b36293d; 0 Airwallex calls; status APPROVED, then closed NEEDS_REAPPROVAL; 0 conversions in the ledger | **pass** | 0 | 46 |
| 6 | `fx.signed` The same suggestion filed again and signed with the passkey *(simulated: signed by the virtual test passkey)* | treasury | APPROVED, with the signed maximum and request id in its terms | P-0003 APPROVED: buy CHF 100.00 with at most EUR 111.49; request_id 0d1530c5-82cf-459e-96fb-a98d5a5f2970 | **pass** | 0 | 28 |
| 7 | `fx.convert` The executor runs the signed conversion (executeFxConversion): a fresh quote for exactly the signed buy amount, held to the signed maximum, then one conversion under the signed request id carrying the approval hash | treasury | EXECUTED: one quote and one conversion created at Airwallex | EXECUTED: converted EUR 110.38 to CHF 100.00 (45168a42-b5b5-4038-b3a9-050e28abaf91); quote af3936fb-5f52-3562-aaf4-6102c84a0583; payment EXECUTED; calls GET /fx/conversions, GET /balances/current, POST /fx/quotes/create, POST /fx/conversions/create | **pass** | 7, 8, 9, 10 | 1443 |
| 8 | `fx.readback` The conversion read back from Airwallex (GET /fx/conversions/{id}) | – | buys CHF 100.00, sells EUR within the signed maximum, under the signed request id; the approval hash in its metadata if Airwallex shows it | 45168a42-b5b5-4038-b3a9-050e28abaf91 SETTLED: EUR 110.38 to CHF 100.00; request_id the signed one; metadata approval_sha256 the signed hash | **pass** | 11 | 392 |
| 9 | `fx.again` The executor asked again for the same proposal | treasury | refused (already executed) before any Airwallex call; one conversion in the ledger | refused: P-0003 is EXECUTED, not approved; 0 calls; 1 conversion in the ledger | **pass** | 0 | 0 |

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 19:53:39.792 | 19:53:40.520 | 728 | `POST /authentication/login` | 201 | – | `7f07cf35c92f44639590d05ec97152c0` | – | fx.balances (treasury) |
| 2 | 19:53:40.527 | 19:53:40.969 | 442 | `GET /balances/current` | 200 | – | `ebeae15743374ed5bc8e4b43478a5041` | – | fx.balances (treasury) |
| 3 | 19:53:41.078 | 19:53:41.453 | 375 | `GET /fx/rates/current` | 200 | – | `55695078841f4b2a8b304df286df3cee` | – | fx.advice (treasury) |
| 4 | 19:53:41.454 | 19:53:41.854 | 400 | `GET /fx/rates/current` | 200 | – | `ff128172cb99406584c7be2b5f69d4e2` | – | fx.advice (treasury) |
| 5 | 19:53:41.855 | 19:53:42.226 | 371 | `GET /fx/rates/current` | 200 | – | `e6c6bcec76d64f46821eb2b781fa7906` | – | fx.advice (treasury) |
| 6 | 19:53:42.227 | 19:53:42.563 | 336 | `GET /fx/rates/current` | 200 | – | `affa4a3b7c3a42af92157f2f401c483d` | – | fx.advice (treasury) |
| 7 | 19:53:42.687 | 19:53:43.050 | 363 | `GET /fx/conversions` | 200 | – | `6ae134f2135947c980a25566c7109862` | – | fx.convert (treasury) |
| 8 | 19:53:43.051 | 19:53:43.403 | 352 | `GET /balances/current` | 200 | – | `db03c86cbde94890a7ca3a450df27025` | – | fx.convert (treasury) |
| 9 | 19:53:43.405 | 19:53:43.711 | 306 | `POST /fx/quotes/create` | 200 | – | `bc58f1d41b8b4cca8c0b067f141863cd` | – | fx.convert (treasury) |
| 10 | 19:53:43.713 | 19:53:44.118 | 405 | `POST /fx/conversions/create` | 201 | – | `cb3a76b3a6674e47a49e3ed34beafaf4` | – | fx.convert (treasury) |
| 11 | 19:53:44.121 | 19:53:44.512 | 391 | `GET /fx/conversions/{id}` | 200 | – | `4d0d1db9532d4330a0bbccdbeeb8564f` | – | fx.readback |

Calls by endpoint: `POST /authentication/login` 1, `GET /balances/current` 2, `GET /fx/rates/current` 4, `GET /fx/conversions` 1, `POST /fx/quotes/create` 1, `POST /fx/conversions/create` 1, `GET /fx/conversions/{id}` 1.

## What this does not show

- The CHF payable being paid: the run converts for it and stops there.
- A person's Face ID on a real phone; Purser Cloud's screens. The runner's every-few-seconds loop did not run: each step was called once, in order.
- A rate that moves past the signed maximum, or a stop pulled during the quote, live: both are covered by test/treasury-fx-proposal.test.ts on stand-ins, not run against the sandbox.
