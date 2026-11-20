# Airwallex sandbox: the same create sent twice under one request_id (2026-11-20)

Record: [2026-11-20-airwallex-replay.json](2026-11-20-airwallex-replay.json), written by `npm run airwallex:replay -- live` ([src/cli/airwallexReplay.ts](../../src/cli/airwallexReplay.ts), [src/proof/awxReplay.ts](../../src/proof/awxReplay.ts)). This page is written from the record.

- **Airwallex sandbox only, test money.** Every call went to `api.sandbox.airwallex.com` through Purser's own client, counted against an approved budget before it was sent.
- **Why.** Purser's exactly-once rests on Airwallex refusing a second create under a request_id it has seen: after a lost answer Purser looks the request_id up before any retry, and its routed rail reads a duplicate answer as "the first send went through" (`DUPLICATE_CODES` in src/airwallex/routedRail.ts). Until this run no record held what Airwallex answers a repeated transfer, conversion or batch create (a repeated payment intent answered `duplicate_request` on 7 Nov, vic-1c).
- **What ran.** For three EUR 1.00 transfers, one USD→EUR 1.00 conversion and one empty batch: the create; the identical create again (a retry after a lost answer); for the transfers and the conversion, the create again with the amount one cent higher (changed terms under the same id); then the request_id looked up. Each transfer was then taken to PAID by the sandbox's simulation endpoint (simulated, not a settlement) and read back; the batch was deleted.

## Result

| | |
|---|---|
| Creates with exactly one object under their request_id afterwards, with the first terms | 5/5 |
| Repeats sent (same terms, or one cent more) | 9 |
| Repeats Airwallex refused | 9/9 |
| Repeats answered with the first object instead | 0 |
| Cases where no repeat made a second object | 5/5 |
| Airwallex's answers to a repeat | `400 duplicate_request_id`, `400 invalid_argument`, `400 batch_request_id_duplicate` |
| Of those, read by Purser's routed rail as a refusal that moved nothing (should be none) | `400 invalid_argument`, `400 batch_request_id_duplicate` |
| Airwallex calls (approved budget) | 32 (50) |
| Errors | none |

**After the run.** Fixed the same day: Purser's routed rail read two of these answers as a refusal that moved nothing, and so would have freed the amount under the Cloud sandbox caps although the first send went through (no money moves twice: Airwallex refused every repeat). batch_request_id_duplicate is now one of its duplicate codes, and invalid_argument on a conversion create is no longer read as an outright refusal (src/airwallex/routedRail.ts; test/security-sweep-2026-11-15.test.ts). The summary above is as the run found it, on the code before the fix.

## Every case

| Case | request_id | First create | Same again | One cent more | Listed under the request_id | After |
|---|---|---|---|---|---|---|
| transfer 1: EUR 1.00 to Bergtex Textil GmbH | `757f5cb3-ac04-40d2-9d01-b6bafb87de54` | 200, `a73cf3c8-45f2-40c0-a1fe-f1ca8b87f924`, 1.00 | 400 `duplicate_request_id` (trace `7adb24b8850344e1b228353f65336829`) | 400 `duplicate_request_id` (trace `b51ebaf963de43738026cfaef4fd5316`) | 1: `a73cf3c8-45f2-40c0-a1fe-f1ca8b87f924`, 1.00 | PAID |
| transfer 2: EUR 1.00 to Bergtex Textil GmbH | `dd196116-d3e9-4cd1-a626-4f0f9ebddfff` | 200, `2256a8da-ec24-4852-8628-59ddeb6844a5`, 1.00 | 400 `duplicate_request_id` (trace `21011d1ccb784546a0a66f1fbec9243b`) | 400 `duplicate_request_id` (trace `c0e595b46b9a4ce2a077d41e971fa1e5`) | 1: `2256a8da-ec24-4852-8628-59ddeb6844a5`, 1.00 | PAID |
| transfer 3: EUR 1.00 to Bergtex Textil GmbH | `2aec0411-825d-42b3-9f79-8992e24e0b86` | 200, `9caceb77-de06-4b04-b728-b84fd6d38eaf`, 1.00 | 400 `duplicate_request_id` (trace `da647655feb74281a6129f11cb8312c9`) | 400 `duplicate_request_id` (trace `a0f8dcb84cd44e9c8d532fc697d746a7`) | 1: `9caceb77-de06-4b04-b728-b84fd6d38eaf`, 1.00 | PAID |
| conversion: USD sold for EUR 1.00 at a locked quote | `83b48998-02d7-469c-b033-d842365b06b6` | 200, `c79ea9ed-85bf-4b8e-b643-1381a53068ca`, 1.00 | 400 `invalid_argument` (trace `230bdbbfe3ff4762bf9fcc9375f08b00`) | 400 `invalid_argument` (trace `89b2bf400688403ea248aeef0b701929`) | 1: `c79ea9ed-85bf-4b8e-b643-1381a53068ca`, 1.00 | – |
| batch transfer: an empty batch | `8846fe92-5b6b-4e8d-b22f-f0a9b996d7aa` | 200, `98c96ef3-4eb8-4634-be36-53c9b4d9aed7` | 400 `batch_request_id_duplicate` (trace `27b03f953f584d498f2fd8b0390e118b`) | – (no amount) | 1: `98c96ef3-4eb8-4634-be36-53c9b4d9aed7` | deleted |

## Calls

Method, endpoint (ids folded), Airwallex's HTTP status and error code; never a body, a query or a header.

| # | Time (UTC) | Call | HTTP | Code |
|---:|---|---|---:|---|
| 1 | 09:30:07.512 | `POST /authentication/login` | 201 |  |
| 2 | 09:30:08.265 | `GET /beneficiaries` | 200 |  |
| 3 | 09:30:08.775 | `POST /transfers/create` | 201 |  |
| 4 | 09:30:10.060 | `POST /transfers/create` | 400 | `duplicate_request_id` |
| 5 | 09:30:10.792 | `POST /transfers/create` | 400 | `duplicate_request_id` |
| 6 | 09:30:11.347 | `GET /transfers` | 200 |  |
| 7 | 09:30:11.669 | `POST /simulation/transfers/{id}/transition` | 200 |  |
| 8 | 09:30:12.494 | `POST /simulation/transfers/{id}/transition` | 200 |  |
| 9 | 09:30:13.062 | `GET /transfers/{id}` | 200 |  |
| 10 | 09:30:13.372 | `POST /transfers/create` | 201 |  |
| 11 | 09:30:14.052 | `POST /transfers/create` | 400 | `duplicate_request_id` |
| 12 | 09:30:14.603 | `POST /transfers/create` | 400 | `duplicate_request_id` |
| 13 | 09:30:15.050 | `GET /transfers` | 200 |  |
| 14 | 09:30:15.452 | `POST /simulation/transfers/{id}/transition` | 200 |  |
| 15 | 09:30:16.331 | `POST /simulation/transfers/{id}/transition` | 200 |  |
| 16 | 09:30:16.853 | `GET /transfers/{id}` | 200 |  |
| 17 | 09:30:17.187 | `POST /transfers/create` | 201 |  |
| 18 | 09:30:18.044 | `POST /transfers/create` | 400 | `duplicate_request_id` |
| 19 | 09:30:18.474 | `POST /transfers/create` | 400 | `duplicate_request_id` |
| 20 | 09:30:19.054 | `GET /transfers` | 200 |  |
| 21 | 09:30:19.371 | `POST /simulation/transfers/{id}/transition` | 200 |  |
| 22 | 09:30:20.583 | `POST /simulation/transfers/{id}/transition` | 200 |  |
| 23 | 09:30:21.044 | `GET /transfers/{id}` | 200 |  |
| 24 | 09:30:21.352 | `POST /fx/quotes/create` | 200 |  |
| 25 | 09:30:21.711 | `POST /fx/conversions/create` | 201 |  |
| 26 | 09:30:22.139 | `POST /fx/conversions/create` | 400 | `invalid_argument` |
| 27 | 09:30:22.455 | `POST /fx/conversions/create` | 400 | `invalid_argument` |
| 28 | 09:30:22.771 | `GET /fx/conversions` | 200 |  |
| 29 | 09:30:23.081 | `POST /batch_transfers/create` | 200 |  |
| 30 | 09:30:23.408 | `POST /batch_transfers/create` | 400 | `batch_request_id_duplicate` |
| 31 | 09:30:23.737 | `GET /batch_transfers` | 200 |  |
| 32 | 09:30:24.055 | `POST /batch_transfers/{id}/delete` | 200 |  |
