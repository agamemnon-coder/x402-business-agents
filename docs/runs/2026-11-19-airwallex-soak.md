# Airwallex soak, 2026-11-19: 30 supplier payments and 5 negative controls (sandbox, test money)

Record: [2026-11-19-airwallex-soak.json](2026-11-19-airwallex-soak.json), built by `npm run airwallex:soak -- record` from the run's own files (0 calls). Code: [src/e2e/airwallexSoak.ts](../../src/e2e/airwallexSoak.ts), [src/cli/airwallexSoak.ts](../../src/cli/airwallexSoak.ts).

- **Airwallex sandbox only, test money.** Every call went to `api.sandbox.airwallex.com` through Purser's own client (one at a time, at most one per 200 ms, backoff on 429), counted in one call log against an approved budget.
- **Signed by the airwallex-soak virtual test passkey (no person's Face ID).** Each payment's exact terms were signed with it; nothing was approved in Airwallex's web app.
- **PAID is simulated.** SENT and PAID came from the sandbox's simulation endpoint; the sandbox does not settle by itself.
- **Purser's real pipeline:** the treasury agent's code planned each payment (balance read; for a shortfall a rate check and a locked quote for the shortfall only), the virtual passkey signed the terms, the invoice payment executor booked the conversion and created the transfer with `metadata.approval_sha256`, then the transfer was read back from Airwallex and compared with the signed terms.

## Aggregates

| | |
|---|---|
| Transfers created | 30/30 |
| PAID at Airwallex (read back; simulated) | 30/30 |
| Read-backs matching the signed terms (approval_sha256, amount, currency, beneficiary, reference, request_id, PAID) | 30/30 |
| USD→EUR conversions for the shortfall (booked / read back matching) | 6/6 / 6/6 |
| create→PAID latency p50 / p95 (min, max) | 3055 ms / 3460 ms (2849, 3509; n=30) |
| Airwallex calls in all (budget) | 346 (450) |
| Calls: setup / payments / negatives | 4 / 324 / 18 |
| Calls per payment: mean (min, max) | 10.8 (10, 14) |
| Negative controls refused before any create | 5/5 |
| Calls from the one-cent change to the refusal: total / POST / creates | 5 / 0 / 0 (5 GET /balances/current) |
| Negatives' request ids found at Airwallex afterwards | 0 |
| HTTP 429 answers / other non-2xx | 0 / 0 |
| Errors | none |

create→PAID is from POST /transfers/create being sent to the GET that first answered PAID: the create, two simulated transitions and the reads between them, one at a time at most one per 200 ms (src/airwallex/client.ts). It measures the API round trips, not a settlement time.

## Payments

| # | Invoice | Payee | EUR | FX (USD sold) | Proposal | Transfer | Signed terms hash = metadata.approval_sha256 | Read-back | create sent → PAID seen (UTC) | ms | Calls |
|---|---|---|---:|---|---|---|---|---|---|---:|---:|
| 1 | BTX-SOAK-01 | Bergtex Textil GmbH | 1.00 | — | P-0001 | `a63888f6-3388-498e-993f-d2efbb64b578` | `7501cf8c149879b5344b63acc1c00c37ded8faa96ec969254ffcaf466f384d2b` = | PAID, match | 08:49:32.987 → 08:49:36.447 | 3460 | 10 |
| 2 | SLL-SOAK-02 | Stockline Data GmbH | 240.00 | — | P-0002 | `11d6fbe5-76c8-404f-a528-7c200e5f794e` | `0e6eea8ee299ee0188331416d3dfa384f0f45cf69d4e8cdccc34808d0d88c3d5` = | PAID, match | 08:49:37.775 → 08:49:40.845 | 3070 | 10 |
| 3 | BTX-SOAK-03 | Bergtex Textil GmbH | 2.50 | — | P-0003 | `87a403db-b7eb-4f0d-8b31-a0b2f4535251` | `bfb8bc638c2c99aa525dd16d45f52ee939f1efbcf2a0525a75faa8cc876eb5b7` = | PAID, match | 08:49:42.372 → 08:49:45.366 | 2994 | 10 |
| 4 | BTX-SOAK-04 | Bergtex Textil GmbH | 19.99 | — | P-0004 | `58c77e7d-5577-463f-a43a-732a0f6966a9` | `a0d3ed704075e4bdf72690c4fdad46fbad9504e70a9653973b50da3c34314b4a` = | PAID, match | 08:49:46.634 → 08:49:49.703 | 3069 | 10 |
| 5 | BTX-SOAK-05 | Bergtex Textil GmbH | 33.33 | USD 48.12 at 1.110519; read back, match | P-0005 | `0acd2cad-fcf7-49a6-abc1-b5e4b37498d7` | `a120bdfe29247f0cf1c5379133f2c8c783bea722606e360e5722f8d430691311` = | PAID, match | 08:49:52.035 → 08:49:55.240 | 3205 | 14 |
| 6 | BTX-SOAK-06 | Bergtex Textil GmbH | 101.01 | — | P-0006 | `be24bdd5-95ab-4107-baba-9f7e5e26d4d0` | `d1a3e8c19576e237ce137eb34e150d416a7c567bfabb813971ffb8443bb08b42` = | PAID, match | 08:49:57.163 → 08:50:00.218 | 3055 | 10 |
| 7 | SLL-SOAK-07 | Stockline Data GmbH | 240.00 | USD 277.63 at 1.110519; read back, match | P-0008 | `3dd8fb2c-6d6f-4347-80dd-ff81989a6acc` | `9b225468f657940482884f46f56b10bdb98dd4a57bf02b5589c61fe036d6800e` = | PAID, match | 08:50:03.973 → 08:50:07.296 | 3323 | 14 |
| 8 | BTX-SOAK-08 | Bergtex Textil GmbH | 7.01 | — | P-0009 | `bf959679-2866-4bfc-a3a5-e5b0b6c5d28a` | `0aaa62bc868d86f5cd4609bfe32b2dc6afae331fc693545f50fea432a2220a7a` = | PAID, match | 08:50:08.902 → 08:50:11.885 | 2983 | 10 |
| 9 | BTX-SOAK-09 | Bergtex Textil GmbH | 123.45 | — | P-0010 | `b420dd66-39f0-43c7-9ddd-c2b79cb3fdd0` | `af10439c65aabacf9d07afec22f89acf4b2a028c70586556adaf146cdb0673a2` = | PAID, match | 08:50:13.162 → 08:50:16.095 | 2933 | 10 |
| 10 | BTX-SOAK-10 | Bergtex Textil GmbH | 1850.00 | USD 2065.57 at 1.110519; read back, match | P-0011 | `e821de96-a98c-4481-b0ce-5ba55a5ff521` | `570105fa571a2e84c8c81dc0809a701eeacef93fddeb30e9b3ab64746ae57289` = | PAID, match | 08:50:18.432 → 08:50:21.453 | 3021 | 14 |
| 11 | BTX-SOAK-11 | Bergtex Textil GmbH | 277.77 | — | P-0012 | `1fbac219-4233-4827-b127-e46a7738b3a4` | `56b9d682c49f154815dbbd92cd965edfdd3f9a7954b9b9500f548e2e442dd8cc` = | PAID, match | 08:50:23.090 → 08:50:26.599 | 3509 | 10 |
| 12 | SLL-SOAK-12 | Stockline Data GmbH | 240.00 | — | P-0013 | `76ecfaa2-8d9a-47d5-b347-6a7890233788` | `10abe463ec8c83e7a42067134bfe3e4caf51d4d248b5adf40a1dfa5b5c3cafe6` = | PAID, match | 08:50:28.118 → 08:50:30.967 | 2849 | 10 |
| 13 | BTX-SOAK-13 | Bergtex Textil GmbH | 404.04 | — | P-0015 | `82d06707-a975-4fb6-8140-ff2611e4384c` | `514a84b5bc44dd454b9bae9dafd30e2cfef07aaf04cefce85cc2f76212793b47` = | PAID, match | 08:50:33.261 → 08:50:36.153 | 2892 | 10 |
| 14 | BTX-SOAK-14 | Bergtex Textil GmbH | 2500.00 | — | P-0016 | `11c9e397-9d8d-4b25-a02e-9e465a3e8221` | `03aa37600d11765b9054e4f1143cae43c6991049d982940d57dab94a42e3b747` = | PAID, match | 08:50:37.691 → 08:50:41.043 | 3352 | 10 |
| 15 | BTX-SOAK-15 | Bergtex Textil GmbH | 555.55 | USD 628.05 at 1.110517; read back, match | P-0017 | `02ff4a68-3a90-431f-b805-ce00b9ba1236` | `6f1e393041478f841ab0a1989aab41bb86c278957027d00fd716b21631a21c03` = | PAID, match | 08:50:43.631 → 08:50:47.049 | 3418 | 14 |
| 16 | BTX-SOAK-16 | Bergtex Textil GmbH | 10.00 | — | P-0018 | `8c4a541f-bdea-4e1e-b69a-678ef112ebac` | `9c3ea2a5d5fd2e79b99782bc215ff905e0ce93f85e7684db11ff2928cae0ce68` = | PAID, match | 08:50:48.660 → 08:50:51.739 | 3079 | 10 |
| 17 | SLL-SOAK-17 | Stockline Data GmbH | 240.00 | — | P-0019 | `6b037188-b075-44fd-8fb0-d4e30060ea0a` | `664311c446d7d4dfe6c66d219a38028578e1dd0367ca608b15de41f0cd15a65d` = | PAID, match | 08:50:53.026 → 08:50:56.082 | 3056 | 10 |
| 18 | BTX-SOAK-18 | Bergtex Textil GmbH | 678.91 | — | P-0020 | `c060f57f-7605-487f-af9b-bbc611528c86` | `356013128836bd0ce7166be34574cda544c6be34535d41a554e29bb3e19ac715` = | PAID, match | 08:50:57.374 → 08:51:00.447 | 3073 | 10 |
| 19 | BTX-SOAK-19 | Bergtex Textil GmbH | 3333.33 | — | P-0022 | `d1ffc499-217a-4abb-80f4-ffe9c32f75bc` | `b23555d94c919f247591fc7fba8ab034ca0763747dc2334ccd2ad5e76ea9cceb` = | PAID, match | 08:51:02.937 → 08:51:05.965 | 3028 | 10 |
| 20 | BTX-SOAK-20 | Bergtex Textil GmbH | 999.99 | — | P-0023 | `024edb8b-f397-4f63-abcb-15cf7cb89100` | `f15c9f209c58b9effb2ee048cec92b4c020d498152ad403d91701488ff8932e1` = | PAID, match | 08:51:07.270 → 08:51:10.203 | 2933 | 10 |
| 21 | SLL-SOAK-21 | Stockline Data GmbH | 240.00 | USD 277.63 at 1.110517; read back, match | P-0024 | `32cde8a4-58e0-4274-a4c2-a2bbe4e19003` | `0232a88e9d6948148cdfd00a07f2ffeb5dd730f41d3e8f04e0ccb74ed3780d6c` = | PAID, match | 08:51:12.550 → 08:51:15.455 | 2905 | 14 |
| 22 | BTX-SOAK-22 | Bergtex Textil GmbH | 4999.99 | — | P-0025 | `f8c8b191-0059-428b-a2b3-97b39c2c86be` | `01fa3bec0ec4146265343963a3acf4c3cb4f3e392104932bbe141f24e92e423f` = | PAID, match | 08:51:17.084 → 08:51:20.253 | 3169 | 10 |
| 23 | BTX-SOAK-23 | Bergtex Textil GmbH | 12.34 | — | P-0026 | `9a786258-e411-4fe9-8cb0-886e7c6c8f07` | `daec47c78c84b4dbf0c313a2776566869be3cb9e618e01107e672b828c11a6ac` = | PAID, match | 08:51:21.563 → 08:51:24.576 | 3013 | 10 |
| 24 | BTX-SOAK-24 | Bergtex Textil GmbH | 1234.57 | — | P-0027 | `bfa8d306-a416-4b5e-8f96-1651fae2c112` | `f50519f174c46f14c15c7e14f225fe9ddf0a48e83a86d651c3742484b1d45b31` = | PAID, match | 08:51:25.855 → 08:51:28.773 | 2918 | 10 |
| 25 | BTX-SOAK-25 | Bergtex Textil GmbH | 66.67 | — | P-0029 | `7b57741d-2898-4b78-979b-6954603923ef` | `c3d3d19a0611d8638306b3a477fa73a5ee96feab709d55ab0af5f5a948a26b37` = | PAID, match | 08:51:31.073 → 08:51:34.032 | 2959 | 10 |
| 26 | SLL-SOAK-26 | Stockline Data GmbH | 240.00 | — | P-0030 | `995cf235-ed8d-4b39-b6fc-0c33e95d5bbc` | `e1a8cac89447c5a44c7022ed063bfbb4bb71f437c0c97bbb8fcc60f5b7eda22e` = | PAID, match | 08:51:35.336 → 08:51:38.636 | 3300 | 10 |
| 27 | BTX-SOAK-27 | Bergtex Textil GmbH | 2765.43 | USD 3081.82 at 1.110395; read back, match | P-0031 | `9e9f87b5-bebd-4782-8442-851ca6253e85` | `eb2fabcf038d253dea5174a869928536def225c2c305c48d5cb2670698fcf1fd` = | PAID, match | 08:51:40.971 → 08:51:44.082 | 3111 | 14 |
| 28 | BTX-SOAK-28 | Bergtex Textil GmbH | 88.88 | — | P-0032 | `16c78339-156a-4f90-ac4a-d8348a05578b` | `abaa65d8cfbbe7d3b95242b7e23ff6b9a713b1cc3002ac29d858e0978fbe5a3a` = | PAID, match | 08:51:45.710 → 08:51:48.628 | 2918 | 10 |
| 29 | BTX-SOAK-29 | Bergtex Textil GmbH | 6543.21 | — | P-0033 | `c7444ff4-8e55-42bf-abf8-9785f5a9ed71` | `4d67917a7cfb93dc25af60478c3a6bf519ceeb800cee002e86f7555d81f3b5e9` = | PAID, match | 08:51:49.919 → 08:51:52.984 | 3065 | 10 |
| 30 | BTX-SOAK-30 | Bergtex Textil GmbH | 5.05 | — | P-0034 | `92ad9012-369c-4d08-9a18-4aaf808b9cd4` | `3f6419b5452a92a9b181aa4a5acdf1333bbac7462dc9c998c526278fc7067344` = | PAID, match | 08:51:54.324 → 08:51:57.350 | 3026 | 10 |

## Negative controls: one cent changed after signing

Each was planned and signed like a payment; then its stored terms were changed by one cent (the approval row untouched) and handed to the same executor. Calls are counted from the change to the refusal; afterwards Airwallex was asked by the signed request ids whether it holds anything. The one call in each window is a read: the executor reads the balances (`GET /balances/current`) before it checks the hash (src/executors/invoicePayment.ts), so a changed proposal costs one read and sends nothing that moves money: no POST, no conversion, no transfer.

| # | After payment | Invoice | Change | Refused | Calls from change to refusal (POST) | Transfer / conversion at Airwallex | Executor's words |
|---|---:|---|---|---|---|---|---|
| 1 | 6 | BTX-SOAK-N01 | amount +0.01: amount 150.00 → 150.01 | yes | 1 (0): 1 GET /balances/current | none / — | P-0007: terms do not match the approved hash 3db35196e0e355e8d722a102d3b7e026cbe0f60f53dae3ba3db1c479403d3e83 |
| 2 | 12 | BTX-SOAK-N02 | amount -0.01: amount 75.25 → 75.24 | yes | 1 (0): 1 GET /balances/current | none / — | P-0014: terms do not match the approved hash 2fa31fafdfce1e81df2801bfcdfb032d16991e3eadaefad8da07a3d68edee183 |
| 3 | 18 | BTX-SOAK-N03 | amount +0.01, terms_sha256 column recomputed: amount 310.10 → 310.11 | yes | 1 (0): 1 GET /balances/current | none / — | P-0021: terms do not match the approved hash 5364fd4e76fefe803dedc18d591fb6af18cdd614e9122a66a8b593d55a63737d |
| 4 | 24 | SLL-SOAK-N04 | fee_max +0.01: fee_max 20.00 → 20.01 | yes | 1 (0): 1 GET /balances/current | none / — | P-0028: terms do not match the approved hash 6c6ee07170321ab816a2e4d674db9cf6ca97723c708d0e96d0e191b715bf2826 |
| 5 | 30 | BTX-SOAK-N05 | conversion.buy_amount +0.01: conversion.buy_amount 430.42 → 430.43 | yes | 1 (0): 1 GET /balances/current | none / none | P-0035: terms do not match the approved hash d370568925cb332008d9676db27359d332051b8de7b61680089b17990a56b64a |

## Airwallex calls by endpoint

| Endpoint | Calls |
|---|---:|
| `POST /authentication/login` | 1 |
| `GET /balances/current` | 101 |
| `GET /beneficiaries` | 2 |
| `POST /transfers/create` | 30 |
| `GET /transfers/{id}` | 120 |
| `POST /simulation/transfers/{id}/transition` | 60 |
| `GET /fx/rates/current` | 7 |
| `POST /fx/quotes/create` | 7 |
| `POST /fx/conversions/create` | 6 |
| `GET /fx/conversions` | 7 |
| `GET /transfers` | 5 |
| **Total** | **346** |

First call 2026-11-19T08:49:30.375Z, last 2026-11-19T08:52:00.050Z. Setup: 1 POST /authentication/login, 1 GET /balances/current, 2 GET /beneficiaries; balances before: EUR 9837366.73, USD 9994630.19.

## The /proof band

docs/runs/2026-11-19-airwallex-soak.json and its .md are in NOT_IN_BAND (src/redesign/scale.ts; src/cli/verifyAll.ts skips them the same way): verify-all compares the band with the pages as deployed, and this record is newer than them. Once counted, it would change:

- Airwallex sandbox API calls in the run records: +346 (once the record is listed in the API trail (src/airwallex/apiTrail.ts), which /airwallex/calls and the band count)
- sandbox and testnet runs: +1 (once the run is a row of /runs (src/redesign/runs.ts))
- Unchanged: tests passing; Alta testnet transactions (none in this record); Claude calls with request ids (none: no model is asked); refusals on record (the record holds no audit row with a refusal event; its negatives are counted in summary.negatives)

## Run it again

```
npm run airwallex:soak -- stand-in      # the whole soak on the in-memory stand-in, 0 network
AWX_SOAK_GO=yes AIRWALLEX_CALL_BUDGET=450 AIRWALLEX_CALL_LOG=<run>/calls.jsonl KIT11_DB=<run>/awx-soak.sqlite npm run airwallex:soak -- live
AIRWALLEX_CALL_LOG=<run>/calls.jsonl KIT11_DB=<run>/awx-soak.sqlite npm run airwallex:soak -- record
```
