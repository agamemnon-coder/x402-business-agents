# Airwallex API coverage, called live: 2026-11-19

`npm run airwallex:coverage-live -- live` (src/cli/airwallexCoverageLive.ts, src/proof/awxCoverageLive.ts). The **Airwallex sandbox** only, test money only.
Each endpoint that docs/evidence/airwallex-api-coverage.md listed as TESTED ONLY or CODE ONLY, called once, through Purser's own
function for it, one call at a time through the client's queue, rate limit and call budget. The machine-readable record is
docs/runs/2026-11-19-airwallex-coverage.json; the coverage report reads its rows and counts one as live only when Airwallex answered the call itself 2xx.

**10 of 11 endpoints answered 2xx (live), 0 refused, 1 not run.** 19 Airwallex calls of a budget of 30 (the logins included), 0 answered 429.

| Endpoint | Function | HTTP | Live | What happened | Id | Needed first | Clean-up |
|---|---|---|---|---|---|---|---|
| `GET /accounts` | AirwallexPlatformRest.findConnectedAccount (src/airwallex/platform.ts) | 200 | **yes** | listed; no account under this request id (none was opened with it) | – | – | – |
| `GET /batch_transfers` | AirwallexBatchRest.findBatchByRequestId (src/airwallex/batchTransfers.ts) | 200 | **yes** | found the batch just made, by its request_id (DRAFTING) | `a5d9f755-0979-461b-9f6f-5433a6f77d38` | createBatch made batch a5d9f755-0979-461b-9f6f-5433a6f77d38 (DRAFTING, no items) under request_id awxcov-batch-20261119091307 | the batch was deleted again (the next row) |
| `POST /batch_transfers/{id}/delete` | AirwallexBatchRest.deleteBatch (src/airwallex/batchTransfers.ts) | 200 | **yes** | deleted the DRAFTING batch | `a5d9f755-0979-461b-9f6f-5433a6f77d38` | createBatch made batch a5d9f755-0979-461b-9f6f-5433a6f77d38 (DRAFTING, no items) under request_id awxcov-batch-20261119091307 | the batch is deleted; read back after the delete: Airwallex answered 404 not_found |
| `POST /webhooks/create` | createWebhook (src/airwallex/webhooks.ts) | 201 | **yes** | subscribed https://example.com/purser-awx-coverage-check to 1 event (the signing secret was dropped, never stored) | `wh_SgVVHZtqHhdkqZgIK7roEDHQy0_nGMC3` | – | deleted again (the next row); none left at the check's URL (listed after) |
| `POST /webhooks/{id}/delete` | deleteWebhook (src/airwallex/webhooks.ts) | 200 | **yes** | deleted the subscription | `wh_SgVVHZtqHhdkqZgIK7roEDHQy0_nGMC3` | createWebhook made subscription wh_SgVVHZtqHhdkqZgIK7roEDHQy0_nGMC3 | deleted |
| `POST /issuing/cardholders/create` | IssuingRest.createCardholder (src/airwallex/issuing.ts) | 202 | **yes** | cardholder READY, no card issued | `100a81eb-6d4d-4987-9c47-fdac352b338a` | – | none: Purser's client has no call that removes a cardholder (it holds no card and no money) |
| `POST /global_accounts/create` | AirwallexRest.createGlobalAccount (src/airwallex/adapter.ts; the create usdGlobalAccountId makes) | 201 | **yes** | opened a Global Account for AUD (ACTIVE) | `9d19f0a2-983e-4ea5-8420-23f3acadc71c` | activeGlobalAccounts: 3 ACTIVE (EUR, GBP, USD); AUD is not among them | none: Purser's client has no call that closes a Global Account (it holds no money) |
| `GET /deposits/{id}` | airwallexDiffs, a deposit (src/finance/dataQa.ts) | 200 | **yes** | found: GBP 125.00, SETTLED, reference awx-switch…osit; agrees with the 13 Nov record | `59769c92-01dd-43e4-8b13-4296d71bd171` | the deposit the sandbox simulated on 13 Nov (docs/runs/2026-11-13-airwallex-deposits.json) | – |
| `GET /issuing/transactions/{id}` | airwallexDiffs, a card transaction (src/finance/dataQa.ts) | 200 | **yes** | found: EUR 45.00, FAILED LIMIT_EXCEEDED; agrees with the list | `cda6e6d1-9ca8-413e-870a-6fddd52cb103` | the newest card transaction in the sandbox's list (FAILED, simulated) | – |
| `POST /pa/payment_intents/{id}/confirm` | AcceptanceRest.confirmWithTestCard (src/airwallex/acceptance.ts) | 200 | **yes** | confirmed with the sandbox success test card: SUCCEEDED; read back: SUCCEEDED, card ending 0008 | `int_sgpvv6qjhhoaw6jo8fi` | createPaymentIntent made int_sgpvv6qjhhoaw6jo8fi (EUR 1.00, REQUIRES_PAYMENT_METHOD) | none needed: EUR 1.00 of test money on a sandbox test card; nobody is paid out |
| `POST /hosted_flows/{id}/authorize` | AirwallexPlatformRest.onboardingLink (src/airwallex/platform.ts) | not sent | no | not run: it needs a hosted flow, and hosted_flows/create needs the onboarding template id that Airwallex's account manager issues; this sandbox account has none (on 12 Nov the create answered 400 twice without one: docs/runs/2026-11-12-real-customers.md), so no flow id exists to authorize | – | a hosted flow id: none can be made without the template | – |

## Every call (UTC; no body, header, token or key)

| # | Time | Call | HTTP |
|---|---|---|---|
| 1 | 09:13:07.590 | `POST /authentication/login` | 201 |
| 2 | 09:13:08.600 | `GET /accounts` | 200 |
| 3 | 09:13:09.255 | `POST /batch_transfers/create` | 200 |
| 4 | 09:13:09.644 | `GET /batch_transfers` | 200 |
| 5 | 09:13:10.105 | `POST /batch_transfers/{id}/delete` | 200 |
| 6 | 09:13:10.480 | `GET /batch_transfers/{id}` | 404 `not_found` |
| 7 | 09:13:10.787 | `POST /webhooks/create` | 201 |
| 8 | 09:13:11.151 | `POST /webhooks/{id}/delete` | 200 |
| 9 | 09:13:11.506 | `GET /webhooks` | 200 |
| 10 | 09:13:11.807 | `POST /issuing/cardholders/create` | 202 |
| 11 | 09:13:12.218 | `GET /global_accounts` | 200 |
| 12 | 09:13:12.598 | `POST /global_accounts/create` | 201 |
| 13 | 09:13:13.287 | `GET /deposits/{id}` | 200 |
| 14 | 09:13:13.630 | `GET /issuing/transactions` | 200 |
| 15 | 09:13:14.512 | `GET /issuing/transactions/{id}` | 200 |
| 16 | 09:13:14.892 | `POST /authentication/login` | 201 |
| 17 | 09:13:15.378 | `POST /pa/payment_intents/create` | 201 |
| 18 | 09:13:16.001 | `POST /pa/payment_intents/{id}/confirm` | 200 |
| 19 | 09:13:17.030 | `GET /pa/payment_intents/{id}` | 200 |

## What this does not show

- One call each: not that every branch around a call works, nor any webhook delivery (the webhook went to a URL nobody listens on, and was deleted at once).
- The cardholder and the Global Account it opened stay in the sandbox: Purser's client has no call that removes either. Neither holds a card or money.
- The webhook's signing secret came back in the create's answer and was dropped there: it is in no file, log or record.
- Not counted in the /proof band: the band counts the Airwallex API trail (src/airwallex/apiTrail.ts), which this record is not part of.
