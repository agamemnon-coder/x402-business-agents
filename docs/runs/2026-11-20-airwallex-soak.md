# Airwallex soak, 2026-11-20: 30 supplier payments and 5 negative controls (sandbox, test money)

Record: [2026-11-20-airwallex-soak.json](2026-11-20-airwallex-soak.json), built by `npm run airwallex:soak -- record` from the run's own files (0 calls). Code: [src/e2e/airwallexSoak.ts](../../src/e2e/airwallexSoak.ts), [src/cli/airwallexSoak.ts](../../src/cli/airwallexSoak.ts).

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
| create→PAID latency p50 / p95 (min, max) | 3088 ms / 3931 ms (2925, 4102; n=30) |
| Airwallex calls in all (budget) | 341 (—) |
| Calls: setup / payments / negatives | 4 / 324 / 13 |
| Calls per payment: mean (min, max) | 10.8 (10, 14) |
| Negative controls refused before any create | 5/5 |
| Calls from the one-cent change to the refusal: total / POST / creates | 0 / 0 / 0 |
| Negatives' request ids found at Airwallex afterwards | 0 |
| HTTP 429 answers / other non-2xx | 0 / 0 |
| Errors | none |

create→PAID is from POST /transfers/create being sent to the GET that first answered PAID: the create, two simulated transitions and the reads between them, one at a time at most one per 200 ms (src/airwallex/client.ts). It measures the API round trips, not a settlement time.

## Payments

| # | Invoice | Payee | EUR | FX (USD sold) | Proposal | Transfer | Signed terms hash = metadata.approval_sha256 | Read-back | create sent → PAID seen (UTC) | ms | Calls |
|---|---|---|---:|---|---|---|---|---|---|---:|---:|
| 1 | BTX-SOAK-01 | Bergtex Textil GmbH | 1.00 | — | P-0001 | `cc68119e-a5dd-454c-ada3-856aaee2ad01` | `6bef1f28381b47eb47a76d158b058df645893c3d582709bec388fa3cfeb00bab` = | PAID, match | 04:21:38.721 → 04:21:42.823 | 4102 | 10 |
| 2 | SLL-SOAK-02 | Stockline Data GmbH | 240.00 | — | P-0002 | `a3a73ae2-509c-4d6c-b873-7b3e1c109e35` | `72e9984e3e8da9d4b0785f510fbd2e42c105bf4af8ad79feb01297b9ab69164e` = | PAID, match | 04:21:44.476 → 04:21:48.407 | 3931 | 10 |
| 3 | BTX-SOAK-03 | Bergtex Textil GmbH | 2.50 | — | P-0003 | `736a6583-8fde-43bb-8f94-efe390eb5f9c` | `fe1dcc731189fbcf5ab7d00427d75c49485f704b41af9278c1b33f618a9ad847` = | PAID, match | 04:21:49.971 → 04:21:53.052 | 3081 | 10 |
| 4 | BTX-SOAK-04 | Bergtex Textil GmbH | 19.99 | — | P-0004 | `b6c2cff5-0620-42c4-8800-4db427ffaceb` | `184931c913f027e94720898a7c3f4031cab8760b5bdef1f00c4b412d724ad623` = | PAID, match | 04:21:54.415 → 04:21:57.955 | 3540 | 10 |
| 5 | BTX-SOAK-05 | Bergtex Textil GmbH | 33.33 | USD 48.08 at 1.10966; read back, match | P-0005 | `dbd6fd38-89ca-443a-bab9-0670cde16411` | `e361103b7078d603b7f7540bb935cc0f7a4d5de02db0161436c3ba52a1ae1582` = | PAID, match | 04:22:00.704 → 04:22:03.937 | 3233 | 14 |
| 6 | BTX-SOAK-06 | Bergtex Textil GmbH | 101.01 | — | P-0006 | `13957b79-70bd-403a-aa90-b555d3826682` | `d7f638ca4f7fd0f0a6ccd0d11ffebea6feb1b88d2d9ea9b6200f38c628ff85bb` = | PAID, match | 04:22:05.858 → 04:22:08.783 | 2925 | 10 |
| 7 | SLL-SOAK-07 | Stockline Data GmbH | 240.00 | USD 277.42 at 1.10966; read back, match | P-0008 | `061a2b36-3836-47cc-a3f5-7b089ac9e7d9` | `db0ca7335ab17517fc45e50bd081f3b9145ba0a7a4ae8a4b20695ae24a7875a7` = | PAID, match | 04:22:12.124 → 04:22:15.597 | 3473 | 14 |
| 8 | BTX-SOAK-08 | Bergtex Textil GmbH | 7.01 | — | P-0009 | `c694788b-8a12-483d-b2a0-f8377d7ad9e9` | `60d976c3b1b48dba86b47518bf79264e2bcb1f437de2274f6625c2e3442db0a4` = | PAID, match | 04:22:17.519 → 04:22:20.555 | 3036 | 10 |
| 9 | BTX-SOAK-09 | Bergtex Textil GmbH | 123.45 | — | P-0010 | `b3c45d63-2cba-428c-9ca2-ed792150ecae` | `c60ef0f2535a2533c3802ac5c7499d2ee756aeae5291cf272620f4ab6dbe1926` = | PAID, match | 04:22:21.927 → 04:22:24.952 | 3025 | 10 |
| 10 | BTX-SOAK-10 | Bergtex Textil GmbH | 1850.00 | USD 2063.97 at 1.10966; read back, match | P-0011 | `fe523efc-91e7-495e-afa1-ba4fb31037ba` | `16e623f776e6019332e55543623a9e88b4771487196e138926422e111bf3bd4c` = | PAID, match | 04:22:27.478 → 04:22:30.794 | 3316 | 14 |
| 11 | BTX-SOAK-11 | Bergtex Textil GmbH | 277.77 | — | P-0012 | `fd787d13-db24-4002-b740-c6d14c6d51c5` | `e4ff9ec76a327649da9a04240326ac315d1936b127c5e23e24a5ad9c9c8fcaab` = | PAID, match | 04:22:32.535 → 04:22:35.623 | 3088 | 10 |
| 12 | SLL-SOAK-12 | Stockline Data GmbH | 240.00 | — | P-0013 | `5a595f86-f459-49ec-992a-3ba2875eaf71` | `fbda74789de1e995a3a232252eef71f45753480e9e3380dcc8e3a166531562f9` = | PAID, match | 04:22:37.069 → 04:22:40.279 | 3210 | 10 |
| 13 | BTX-SOAK-13 | Bergtex Textil GmbH | 404.04 | — | P-0015 | `80669160-5356-424b-b3a6-947cbf7bcb47` | `c994047074cdd3994c9137a40a9c3192278ca8b95027a5b42ed99151ccf2bd50` = | PAID, match | 04:22:42.348 → 04:22:45.330 | 2982 | 10 |
| 14 | BTX-SOAK-14 | Bergtex Textil GmbH | 2500.00 | — | P-0016 | `4722958f-ecf0-4f95-8c4e-bb27f544a286` | `90926b122e6b723b379cb53740bd50c7c10b6b3212174e53be48cf8952e7446e` = | PAID, match | 04:22:46.670 → 04:22:49.724 | 3054 | 10 |
| 15 | BTX-SOAK-15 | Bergtex Textil GmbH | 555.55 | USD 627.57 at 1.10966; read back, match | P-0017 | `85a05a5a-57f4-4abc-b8fc-db76b330b012` | `3a4f085ca9dfd9ba45f47c500a6de1711cae3a980103524540266bccf5f6cd46` = | PAID, match | 04:22:52.176 → 04:22:55.252 | 3076 | 14 |
| 16 | BTX-SOAK-16 | Bergtex Textil GmbH | 10.00 | — | P-0018 | `e7ae180a-d777-4d8b-be42-4c77dff83b18` | `198b8b181114d499e2d410667da9ef5dbdefe18fc1874070cc22923876368279` = | PAID, match | 04:22:56.923 → 04:22:59.916 | 2993 | 10 |
| 17 | SLL-SOAK-17 | Stockline Data GmbH | 240.00 | — | P-0019 | `3f3276bd-385d-4ac0-b52c-2eb94f386c55` | `53fbee3dea7b2212897a3b0935bc79b413b629b6b432ccaebfff5266efcb1a2d` = | PAID, match | 04:23:01.263 → 04:23:04.263 | 3000 | 10 |
| 18 | BTX-SOAK-18 | Bergtex Textil GmbH | 678.91 | — | P-0020 | `25ba3d4f-7748-43f5-aca2-b65b3eae329d` | `d503edf8390cf9fa0f542638435b8d6d84ca755cb216b5764e26b4febf8d1dcc` = | PAID, match | 04:23:05.582 → 04:23:08.718 | 3136 | 10 |
| 19 | BTX-SOAK-19 | Bergtex Textil GmbH | 3333.33 | — | P-0022 | `d03e30db-5d2e-4d0c-b080-44d1ee799da1` | `bc6347604775b9788547697e2eeb44a9ce76058794e7348e2dda138d5196e781` = | PAID, match | 04:23:10.756 → 04:23:13.758 | 3002 | 10 |
| 20 | BTX-SOAK-20 | Bergtex Textil GmbH | 999.99 | — | P-0023 | `dfa96a1b-330f-45b9-8da1-ab0ca7cd1bb4` | `02907d0545aeb92bc18f8a6647101977e85b9e9c2d6071ffe922a05f7c08a738` = | PAID, match | 04:23:15.088 → 04:23:18.050 | 2962 | 10 |
| 21 | SLL-SOAK-21 | Stockline Data GmbH | 240.00 | USD 277.42 at 1.10966; read back, match | P-0024 | `5761b1c6-49c8-4803-a18b-6e2a87809fd6` | `29b78650a274d05155dcaad553a90a8faa7434e89de8a9fe6a8414264474d8cb` = | PAID, match | 04:23:20.643 → 04:23:24.009 | 3366 | 14 |
| 22 | BTX-SOAK-22 | Bergtex Textil GmbH | 4999.99 | — | P-0025 | `6bcceba5-ab58-4116-9950-8496e07ca958` | `34e0185583f411e076c1e2ec7bd929fdf0579c79ddb086abecf80d89e7a17acc` = | PAID, match | 04:23:26.358 → 04:23:29.862 | 3504 | 10 |
| 23 | BTX-SOAK-23 | Bergtex Textil GmbH | 12.34 | — | P-0026 | `0b918f3e-033b-4e02-aeee-59a905eeb3ea` | `9e2ea2d19c5c43f27fd78f1d831f49155e47310db0de242136c333ccbf12c034` = | PAID, match | 04:23:31.477 → 04:23:35.147 | 3670 | 10 |
| 24 | BTX-SOAK-24 | Bergtex Textil GmbH | 1234.57 | — | P-0027 | `1a2d296b-c5b6-4dee-889e-dcbcf4beb7ac` | `1283f17dc9570a7b3571e00b28c6111a318f86bb93491148c603b42540cd1c98` = | PAID, match | 04:23:36.535 → 04:23:39.600 | 3065 | 10 |
| 25 | BTX-SOAK-25 | Bergtex Textil GmbH | 66.67 | — | P-0029 | `41fe0500-02a4-4ea5-aeb3-95d3214aaed5` | `0254d48990b024985ce5e63e5a837fb8affe286964290e0551ec668e95bdcc22` = | PAID, match | 04:23:42.101 → 04:23:45.407 | 3306 | 10 |
| 26 | SLL-SOAK-26 | Stockline Data GmbH | 240.00 | — | P-0030 | `8f7c1317-3aa1-482b-b715-ffb0dea58d25` | `d2aca78d559a6476f860ba56ea304b1fe702f3033131f0ac02e729e40e4589c9` = | PAID, match | 04:23:46.996 → 04:23:50.168 | 3172 | 10 |
| 27 | BTX-SOAK-27 | Bergtex Textil GmbH | 2765.43 | USD 3079.78 at 1.10966; read back, match | P-0031 | `8591538a-d9e5-4f71-8b12-ad945d90fd0e` | `5937a858be5d683ddf2d4aa33b86d475a2f26922b657bc12104b02c885f853e1` = | PAID, match | 04:23:52.547 → 04:23:56.082 | 3535 | 14 |
| 28 | BTX-SOAK-28 | Bergtex Textil GmbH | 88.88 | — | P-0032 | `81cac31d-048d-4b92-aee5-0c39c7a7ccea` | `709b68bb9cb4f15380c8a27d7d8412603644a0181e14b5da90d6af6c3eaad928` = | PAID, match | 04:23:57.759 → 04:24:00.840 | 3081 | 10 |
| 29 | BTX-SOAK-29 | Bergtex Textil GmbH | 6543.21 | — | P-0033 | `36295e5f-c732-46f0-89bd-c2f3d8708466` | `2f52a08a358c64e13b56b6ad44746cef482b32e7ab26968138580ff220497fe8` = | PAID, match | 04:24:02.135 → 04:24:05.494 | 3359 | 10 |
| 30 | BTX-SOAK-30 | Bergtex Textil GmbH | 5.05 | — | P-0034 | `d8f606af-6c22-49cc-ae16-79e1f1339d1c` | `7b322944c9307691b0e39619e5d380d102de5cda347a9429a6e90590fd74ff31` = | PAID, match | 04:24:07.041 → 04:24:09.974 | 2933 | 10 |

## Negative controls: one cent changed after signing

Each was planned and signed like a payment; then its stored terms were changed by one cent (the approval row untouched) and handed to the same executor. Calls are counted from the change to the refusal; afterwards Airwallex was asked by the signed request ids whether it holds anything. The one call in each window is a read: the executor reads the balances (`GET /balances/current`) before it checks the hash (src/executors/invoicePayment.ts), so a changed proposal costs one read and sends nothing that moves money: no POST, no conversion, no transfer.

| # | After payment | Invoice | Change | Refused | Calls from change to refusal (POST) | Transfer / conversion at Airwallex | Executor's words |
|---|---:|---|---|---|---|---|---|
| 1 | 6 | BTX-SOAK-N01 | amount +0.01: amount 150.00 → 150.01 | yes | 0 (0) | none / — | P-0007: terms do not match the approved hash dfdd12723538f14764ee7b90c00fc7d2b71e39a16cf13cd2faa98b7b4379ad53 |
| 2 | 12 | BTX-SOAK-N02 | amount -0.01: amount 75.25 → 75.24 | yes | 0 (0) | none / — | P-0014: terms do not match the approved hash 69c5b0afbfce565d1bdfebfa7147aac49b4863b1aab0e2459c65e1ffd5de5702 |
| 3 | 18 | BTX-SOAK-N03 | amount +0.01, terms_sha256 column recomputed: amount 310.10 → 310.11 | yes | 0 (0) | none / — | P-0021: terms do not match the approved hash 938974b60664b67de8e7cef266efedb4e7ff9c612e9c6a332c3d4f089dc2aa27 |
| 4 | 24 | SLL-SOAK-N04 | fee_max +0.01: fee_max 20.00 → 20.01 | yes | 0 (0) | none / — | P-0028: terms do not match the approved hash 50a16c04b7cfd9d4ba8fcffd8aba6eb6b12ca96442daf5afd0d880cab7197e8c |
| 5 | 30 | BTX-SOAK-N05 | conversion.buy_amount +0.01: conversion.buy_amount 430.42 → 430.43 | yes | 0 (0) | none / none | P-0035: terms do not match the approved hash d89766000016a0a669f965cf1b928c97437032aeda7ae7d7bda17db7263e63bc |

## Airwallex calls by endpoint

| Endpoint | Calls |
|---|---:|
| `POST /authentication/login` | 1 |
| `GET /balances/current` | 96 |
| `GET /beneficiaries` | 2 |
| `POST /transfers/create` | 30 |
| `GET /transfers/{id}` | 120 |
| `POST /simulation/transfers/{id}/transition` | 60 |
| `GET /fx/rates/current` | 7 |
| `POST /fx/quotes/create` | 7 |
| `POST /fx/conversions/create` | 6 |
| `GET /fx/conversions` | 7 |
| `GET /transfers` | 5 |
| **Total** | **341** |

First call 2026-11-20T04:21:35.432Z, last 2026-11-20T04:24:11.939Z. Setup: 1 POST /authentication/login, 1 GET /balances/current, 2 GET /beneficiaries; balances before: EUR 9769613.79, USD 9988251.37.

## The /proof band

docs/runs/2026-11-20-airwallex-soak.json and its .md are in NOT_IN_BAND (src/redesign/scale.ts; src/cli/verifyAll.ts skips them the same way): verify-all compares the band with the pages as deployed, and this record is newer than them. Once counted, it would change:

- Airwallex sandbox API calls in the run records: +341 (once the record is listed in the API trail (src/airwallex/apiTrail.ts), which /airwallex/calls and the band count)
- sandbox and testnet runs: +1 (once the run is a row of /runs (src/redesign/runs.ts))
- Unchanged: tests passing; Alta testnet transactions (none in this record); Claude calls with request ids (none: no model is asked); refusals on record (the record holds no audit row with a refusal event; its negatives are counted in summary.negatives)

## Run it again

```
npm run airwallex:soak -- stand-in      # the whole soak on the in-memory stand-in, 0 network
AWX_SOAK_GO=yes AIRWALLEX_CALL_BUDGET=450 AIRWALLEX_CALL_LOG=<run>/calls.jsonl KIT11_DB=<run>/awx-soak.sqlite npm run airwallex:soak -- live
AIRWALLEX_CALL_LOG=<run>/calls.jsonl KIT11_DB=<run>/awx-soak.sqlite npm run airwallex:soak -- record
```
