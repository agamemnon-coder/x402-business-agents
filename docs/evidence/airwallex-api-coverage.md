# Airwallex API coverage

Made by `npm run airwallex:coverage` (src/cli/airwallexCoverage.ts, rules in src/proof/awxCoverage.ts, tested in
test/airwallex-coverage.test.ts). Offline: nothing here calls Airwallex. Every call it counts as live was a call to the
**Airwallex sandbox**, with test money: the client refuses any other base URL (src/airwallex/client.ts).

## How it is counted

1. **The endpoints.** A static scan of the TypeScript in src/, cloud/src/, worker/src/ and scripts/ (tests excluded; 919 files),
   read with the TypeScript parser, call expressions only. A call counts when it passes a method literal ("GET",
   "POST") followed by an Airwallex path literal, or when the function's name is the method (`get("/deposits")`). A
   path is folded to a template: the origin, `/api/v1`, the query and every id or interpolation (`{id}`) dropped. Its
   first segment must be one of Airwallex's that the code uses (AWX_ROOTS), so Purser's own routes, Moneybird's, T:0's
   and Claude's are not counted. One row per distinct method and path, however many places call it: nothing is counted twice.
2. **LIVE (sandbox).** A committed run record holds a call to it: the Airwallex API trail (src/airwallex/apiTrail.ts,
   the list /airwallex/calls shows) and every JSON or JSONL record in docs/runs, docs/evidence and docs/demo, read
   generically (an object with a method and an endpoint whose service is Airwallex or unnamed, or a string starting
   "METHOD /path"); 218 records read. The first date is the earliest call's own time, or the record's date where
   it only counts calls. The Markdown run logs are not read: only machine-readable records count.
3. **TESTED ONLY.** No record holds it, but a test under test/ names this method and this path together: a call
   with both, a "METHOD /path" string (a stand-in's call log), or an object with a method and a path (a stand-in's
   route). A path named without its method does not count. 739 test files read (not this report's own test, whose fixtures name endpoints on purpose).
4. **CODE ONLY.** Neither: the code can make the call; nothing committed shows it ran or a test that names it.

What this does not show: that a LIVE call succeeded (some records hold refusals, which are the point of those runs),
or that a test covers every branch around a call. A call whose path is built at run time (`api.call("GET", path)`)
cannot be read statically; those sites are listed at the end, not guessed.

## Totals

| | Endpoints |
|---|---|
| Distinct endpoints the code calls | 56 (from 133 call sites) |
| LIVE (sandbox): in a committed run record | 45 (21 of them also named by a test) |
| TESTED ONLY: named by a test, in no record | 3 |
| CODE ONLY: neither | 8 |
| Call sites with a path built at run time (not classified) | 4 |
| Endpoints in a record that the scan did not find in the code | 2 |

## Every endpoint

| Endpoint | Status | First live call (record) | Records | First test that names it | Test files | Called at |
|---|---|---|---|---|---|---|
| `GET /accounts` | CODE ONLY | – | – | – | – | src/airwallex/platform.ts:122 |
| `GET /accounts/{id}` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-real-customers-calls.jsonl) | 1 | – | – | src/airwallex/platform.ts:115 |
| `POST /accounts/{id}/submit` | **LIVE** | 2026-11-10 (docs/runs/2026-11-10-platform-e2e/calls.jsonl) | 1 | – | – | src/e2e/platformOps.ts:77 |
| `POST /accounts/{id}/update` | **LIVE** | 2026-11-10 (docs/runs/2026-11-10-platform-e2e/calls.jsonl) | 1 | – | – | src/e2e/platformOps.ts:76 |
| `POST /accounts/create` | **LIVE** | 2026-11-10 (docs/runs/2026-11-10-platform-e2e/calls.jsonl) | 2 | test/cloud-awx-act.test.ts:36 | 1 | src/airwallex/platform.ts:91 |
| `POST /authentication/login` | **LIVE** | 2026-11-07 (docs/demo/airi-run.json) | 14 | test/agent-cards.test.ts:16 | 11 | src/airwallex/client.ts:167, worker/src/awxCards.ts:61, worker/src/awxGateway.ts:51, worker/src/awxPayout.ts:105, worker/src/awxRead.ts:380, worker/src/fxQuote.ts:104 |
| `GET /balances/current` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 7 | test/airwallex-client.test.ts:29 | 7 | src/airwallex/adapter.ts:125, src/airwallex/adapter.ts:280, src/cli/awx1.ts:66, src/cli/dataQa.ts:38, src/cli/health.ts:43, worker/src/awxPayout.ts:119, worker/src/awxRead.ts:262 |
| `GET /batch_transfers` | CODE ONLY | – | – | – | – | src/airwallex/batchTransfers.ts:150 |
| `GET /batch_transfers/{id}` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-airwallex-batch-transfer.json) | 1 | – | – | src/airwallex/batchTransfers.ts:157 |
| `POST /batch_transfers/{id}/add_items` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-airwallex-batch-transfer.json) | 3 | – | – | src/airwallex/batchTransfers.ts:161 |
| `POST /batch_transfers/{id}/delete` | CODE ONLY | – | – | – | – | src/airwallex/batchTransfers.ts:177 |
| `GET /batch_transfers/{id}/items` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-airwallex-batch-transfer.json) | 3 | – | – | src/airwallex/batchTransfers.ts:167 |
| `POST /batch_transfers/{id}/quote` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-airwallex-batch-transfer.json) | 3 | – | – | src/airwallex/batchTransfers.ts:164 |
| `POST /batch_transfers/{id}/submit` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-airwallex-batch-transfer.json) | 3 | – | – | src/airwallex/batchTransfers.ts:174 |
| `POST /batch_transfers/create` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-airwallex-batch-transfer.json) | 3 | – | – | src/airwallex/batchTransfers.ts:147 |
| `GET /beneficiaries` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 3 | – | – | src/airwallex/adapter.ts:214, src/airwallex/adapter.ts:332, worker/src/awxRead.ts:291 |
| `GET /beneficiaries/{id}` | **LIVE** | 2026-11-01 (docs/runs/airwallex-readback.json) | 1 | – | – | src/cli/awxReadback.ts:59 |
| `POST /beneficiaries/create` | **LIVE** | 2026-11-10 (docs/runs/2026-11-10-platform-e2e/calls.jsonl) | 1 | test/cloud-awx-act.test.ts:32 | 1 | src/airwallex/adapter.ts:244, src/airwallex/adapter.ts:314 |
| `POST /beneficiaries/schema` | **LIVE** | 2026-11-10 (docs/runs/2026-11-10-platform-e2e/calls-earlier-attempts.jsonl) | 2 | – | – | src/airwallex/adapter.ts:236, src/airwallex/adapter.ts:309 |
| `POST /beneficiaries/validate` | **LIVE** | 2026-11-10 (docs/runs/2026-11-10-platform-e2e/calls.jsonl) | 1 | – | – | src/airwallex/adapter.ts:243, src/airwallex/adapter.ts:313 |
| `POST /beneficiaries/verify_account` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-airwallex-payee-check.json) | 2 | – | – | src/airwallex/payeeName.ts:89 |
| `POST /connected_account_transfers/create` | **LIVE** | 2026-11-10 (docs/runs/2026-11-10-platform-e2e/calls-earlier-attempts.jsonl) | 2 | – | – | src/e2e/platformOps.ts:92 |
| `GET /deposits` | **LIVE** | 2026-11-01 (docs/runs/airwallex-readback.json) | 3 | – | – | src/airwallex/adapter.ts:151, src/airwallex/deposits.ts:49, src/airwallex/verify.ts:39, src/cli/awxReadback.ts:31, src/cli/receivables.ts:90, src/finance/dataQa.ts:252 |
| `GET /deposits/{id}` | CODE ONLY | – | – | – | – | src/finance/dataQa.ts:251 |
| `GET /financial_transactions` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-airwallex-financial-transactions.json) | 3 | – | – | src/finance/awxFinancialTx.ts:36, worker/src/awxRead.ts:270 |
| `GET /fx/conversions` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 1 | – | – | src/airwallex/adapter.ts:203, src/airwallex/verify.ts:62, src/cli/fail.ts:112, src/finance/dataQa.ts:238 |
| `GET /fx/conversions/{id}` | **LIVE** | 2026-11-01 (docs/runs/airwallex-readback.json) | 1 | – | – | src/cli/awxReadback.ts:50, src/finance/dataQa.ts:237 |
| `POST /fx/conversions/create` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 1 | test/airwallex-client.test.ts:76 | 3 | src/airwallex/adapter.ts:190, src/airwallex/apiTrail.ts:233 |
| `GET /fx/quotes/{id}` | **LIVE** | 2026-11-01 (docs/runs/airwallex-readback.json) | 1 | – | – | src/cli/awxReadback.ts:61 |
| `POST /fx/quotes/create` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 1 | test/airwallex-adapter.test.ts:53 | 4 | src/airwallex/adapter.ts:179, src/airwallex/apiTrail.ts:232, worker/src/fxQuote.ts:133 |
| `GET /fx/rates/current` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 3 | test/airwallex-adapter.test.ts:33 | 3 | src/airwallex/adapter.ts:169, worker/src/awxRead.ts:279 |
| `GET /global_accounts` | **LIVE** | 2026-11-13 (docs/runs/2026-11-13-airwallex-deposits.json) | 1 | – | – | src/airwallex/adapter.ts:139, src/cli/awxSwitchOn.ts:295, src/cli/receivables.ts:31, worker/src/awxRead.ts:263 |
| `POST /global_accounts/create` | TESTED ONLY | – | – | test/cloud-awx-act.test.ts:35 | 1 | src/airwallex/adapter.ts:142, src/cli/receivables.ts:34 |
| `POST /hosted_flows/{id}/authorize` | CODE ONLY | – | – | – | – | src/airwallex/platform.ts:107 |
| `POST /hosted_flows/create` | **LIVE** | 2026-11-12 (docs/runs/2026-11-12-real-customers-calls.jsonl) | 1 | – | – | src/airwallex/platform.ts:105 |
| `GET /issuing/cardholders` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 1 | test/support/awxCardsFake.ts:35 | 1 | src/airwallex/issuing.ts:175, worker/src/awxCards.ts:176 |
| `POST /issuing/cardholders/create` | TESTED ONLY | – | – | test/support/awxCardsFake.ts:36 | 1 | src/airwallex/issuing.ts:185, worker/src/awxCards.ts:181 |
| `GET /issuing/cards` | **LIVE** | 2026-11-06 (docs/runs/airwallex-cards-2026-11-06.json) | 2 | test/agent-cards.test.ts:21 | 3 | src/airwallex/issuing.ts:197, worker/src/awxCards.ts:133, worker/src/awxCards.ts:142 |
| `GET /issuing/cards/{id}` | **LIVE** | 2026-11-06 (docs/runs/airwallex-cards-2026-11-06.json) | 2 | test/awx-live.test.ts:243 | 1 | src/airwallex/issuing.ts:224, src/cli/visaTapLive.ts:43, worker/src/awxCards.ts:109, worker/src/awxRead.ts:318 |
| `POST /issuing/cards/{id}/update` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 1 | – | – | src/airwallex/issuing.ts:230, src/airwallex/issuing.ts:240, src/airwallex/issuing.ts:249, worker/src/awxCards.ts:209, worker/src/awxCards.ts:217, worker/src/awxCards.ts:223 |
| `POST /issuing/cards/create` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 1 | test/agent-cards.test.ts:23 | 6 | src/airwallex/apiTrail.ts:234, src/airwallex/issuing.ts:207, worker/src/awxCards.ts:193 |
| `GET /issuing/transactions` | **LIVE** | 2026-11-01 (docs/runs/airwallex-readback.json) | 2 | test/agent-cards.test.ts:22 | 3 | src/airwallex/issuing.ts:259, src/cli/awxReadback.ts:40, src/finance/dataQa.ts:263, worker/src/awxCards.ts:166 |
| `GET /issuing/transactions/{id}` | CODE ONLY | – | – | – | – | src/cli/awxReadback.ts:54, src/finance/dataQa.ts:262 |
| `GET /pa/payment_intents/{id}` | **LIVE** | 2026-11-07 (docs/demo/airi-run.json) | 2 | – | – | src/airi/checkout.ts:159, src/airi/hostedCheckout.ts:228, src/airi/termsMetadata.ts:44, src/airwallex/acceptance.ts:76, src/airwallex/apiTrail.ts:251, src/cli/vicReadback.ts:54 |
| `POST /pa/payment_intents/{id}/confirm` | CODE ONLY | – | – | – | – | src/airi/checkout.ts:133, src/airwallex/acceptance.ts:68 |
| `POST /pa/payment_intents/create` | **LIVE** | 2026-11-07 (docs/demo/airi-run.json) | 1 | test/airi-checkout.test.ts:57 | 4 | src/airi/checkout.ts:93, src/airwallex/acceptance.ts:61 |
| `POST /simulation/accounts/{id}/update_status` | **LIVE** | 2026-11-10 (docs/runs/2026-11-10-platform-e2e/calls.jsonl) | 1 | test/airwallex-dossier.test.ts:196 | 1 | src/e2e/platformOps.ts:80 |
| `POST /simulation/deposit/create` | **LIVE** | 2026-11-13 (docs/runs/2026-11-13-airwallex-deposits.json) | 1 | test/airwallex-dossier.test.ts:196 | 1 | src/airwallex/adapter.ts:162, src/airwallex/deposits.ts:87, src/cli/receivables.ts:61, src/cli/receivables.ts:75 |
| `POST /simulation/issuing/create` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 2 | test/agent-cards.test.ts:27 | 5 | src/airwallex/issuing.ts:267, worker/src/awxCards.ts:229 |
| `POST /simulation/transfers/{id}/transition` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 3 | test/airwallex-dossier.test.ts:196 | 2 | src/airwallex/adapter.ts:274, worker/src/awxPayout.ts:138 |
| `GET /transfers` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 1 | test/cloud-awx-act.test.ts:37 | 2 | src/airwallex/adapter.ts:258, src/airwallex/adapter.ts:264, src/airwallex/verify.ts:78, src/cli/fail.ts:113, src/finance/closeUnsent.ts:103, worker/src/awxRead.ts:286 |
| `GET /transfers/{id}` | **LIVE** | 2026-11-01 (docs/runs/airwallex-readback.json) | 6 | test/awx-live.test.ts:383 | 4 | src/airwallex/adapter.ts:270, src/cli/awxReadback.ts:52, src/cli/lateFailure.ts:404, src/finance/dataQa.ts:227, worker/src/awxPayout.ts:145, worker/src/awxRead.ts:288 |
| `POST /transfers/create` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 4 | test/agent-cards.test.ts:31 | 7 | src/airwallex/adapter.ts:249, src/airwallex/adapter.ts:342, src/airwallex/apiTrail.ts:230, worker/src/awxPayout.ts:127 |
| `GET /webhooks` | **LIVE** | 2026-11-07 (docs/demo/airwallex-run.json) | 1 | test/awx1-world.test.ts:68 | 1 | src/airwallex/webhooks.ts:30 |
| `POST /webhooks/{id}/delete` | CODE ONLY | – | – | – | – | src/airwallex/webhooks.ts:44 |
| `POST /webhooks/create` | TESTED ONLY | – | – | test/contract/airwallex.test.ts:127 | 1 | src/airwallex/webhooks.ts:38 |

## In a record, not found by the scan

These calls are in a committed run record, but no call site with a literal path was found for them: the code reaches them through a path or URL built at run time (for example the OAuth URLs in src/lib/oauth.ts), or the code that made them has changed since. They are not in the totals above.

| Endpoint | First live call (record) | Records |
|---|---|---|
| `GET /oauth/authorize` | 2026-11-12 (docs/runs/2026-11-12-real-customers-calls.jsonl) | 1 |
| `POST /oauth/token` | 2026-11-12 (docs/runs/2026-11-12-real-customers-calls.jsonl) | 1 |

## Call sites with a path built at run time

Listed so nothing is hidden; each passes a path held in a variable, so the scan cannot say which endpoint it is.

| Where | Call |
|---|---|
| src/airwallex/verify.ts:24 | `call("GET", path)` |
| src/cli/awxReadback.ts:26 | `call("GET", path)` |
| src/cli/dataQa.ts:39 | `call("GET", p)` |
| worker/src/awxRead.ts:392 | `call("GET", path)` |

