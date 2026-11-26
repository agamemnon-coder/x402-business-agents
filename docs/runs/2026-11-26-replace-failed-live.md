# A failed payout replaced once, live: 2026-11-26

`npm run airwallex:governance-live -- live replace-failed`. One failed payout replaced once (src/executors/replaceFailed.ts, behind `KIT11_REPLACE_FAILED_PAYOUT=on`): a signed supplier payout created on the Airwallex sandbox, made to fail after it was sent with the sandbox's simulation, read back final-failed at Airwallex, replaced once through the runner's hook under the request_id derived from the first, and asked again. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `86d7f6b93376`. The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-26-replace-failed-live.json.

**10 of 10 steps passed, 0 failed, 0 not judged** (measurements, or not supported by the sandbox). 21 Airwallex calls of a budget of 40 (the drill's hard limit: 80; logins included), one at a time, at least 200 ms apart; 0 answered 429; 0 unexpected non-2xx.

## In short

- pass, `pay.create`: transfer ec987ba1-bb45-43c7-944b-e7d1d554d1ef SCHEDULED; payment EXECUTED
- pass, `fail.simulated`: SENT answered SENT; FAILED answered FAILED (INCORRECT_ROUTING)
- pass, `fail.readback`: reads: CANCELLED INCORRECT_ROUTING
- pass, `replace.off`: no hook (off)
- pass, `replace.once`: replaced: SCHEDULED; replacement 05928c50-120e-4280-8125-ded979442af8 SCHEDULED under a88b95df-ff14-5295-9971-8e72e460dda2 (derived from the first: true); 1 create; calls GET /transfers/{id}, GET /balances/current, POST /transfers/create
- pass, `replace.settle`: 05928c50-120e-4280-8125-ded979442af8 PAID (EUR 1.02)
- pass, `replace.again`: hook: asked before (0 calls); direct: already_replaced (1 calls, 0 POST)
- pass, `readback.both`: 6b12284e-7974-4630-9c44-47d435efbc6b: found; a88b95df-ff14-5295-9971-8e72e460dda2: found; first CANCELLED INCORRECT_ROUTING; replacement PAID
- Shown: Airwallex moved the first transfer from SENT to FAILED and read it back CANCELLED with a failure type; with `KIT11_REPLACE_FAILED_PAYOUT` unset the runner has no replacement hook; switched on, it sent exactly one replacement (one `POST /transfers/create`) under the request_id derived from the first, for the same EUR 1.02, which the sandbox then settled to PAID.
- Shown: Asked again, nothing is sent: the hook answers "asked before" with no call, and replaceFailedPayout called directly finds the replacement (`already_replaced`) with one read and no POST. Airwallex holds one transfer under each request_id: the first CANCELLED, the replacement PAID.

## Simulated, and how

- The approver is a labelled virtual test passkey ("governance-live virtual test passkey (no person's Face ID)", src/redteam/authenticator.ts), enrolled as the only passkey of the run's own fresh ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.
- The failure is the sandbox's simulation endpoint: SENT, then FAILED (never PAID); Airwallex chose the failure type. The replacement's settlement (SENT, PAID) is the same endpoint, called by the run.
- The runner's follow-up loop is not running: the run calls its hook (`replaceFailedHook`, the one src/payouts/follow.ts uses) once with the flag unset and once with it on.

## Steps (11:31:33.061–11:31:44.866 UTC)

A fresh ledger of its own, on the platform account's own balance. The payee is Bergtex Textil GmbH, already on file at Airwallex. Before the runs, 14 read-only calls checked the sandbox (10 in three probes: the platform's and the connected account's balances, GET /account, which answered `acct_op0_QItiOyWKsYb5pwQihA`, and the connected account's beneficiaries; 4 in the entities run's two stopped attempts, described in docs/runs/2026-11-26-entities-live.md). None moved money or changed anything; they are not in this record's call table. The runs (11:27 to 11:32 UTC) ran on the code committed right after them as `86d7f6b93`; between the runs and that commit only the records' wording, the stand-in's call counter and two unused imports changed.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: governance-live virtual test passkey (no person's Face ID) | **pass** | 0 | 15 |
| 2 | `setup.payout` A supplier payout planned against the sandbox (EUR 1.02 to Bergtex Textil GmbH, invoice BTX-GOV-1126-R) and signed with the passkey *(simulated: signed by the virtual test passkey)* | treasury | APPROVED | P-0001 APPROVED (approved); request_id 6b12284e-7974-4630-9c44-47d435efbc6b | **pass** | 1, 2, 3 | 1699 |
| 3 | `pay.create` The payment executed (executeInvoicePayment, no settlement simulated) | treasury | a transfer created under the signed request_id | transfer ec987ba1-bb45-43c7-944b-e7d1d554d1ef SCHEDULED; payment EXECUTED | **pass** | 4, 5, 6 | 2106 |
| 4 | `fail.simulated` The first transfer moved SENT, then FAILED, by the sandbox's simulation endpoint (never PAID) *(simulated: the failure is the sandbox's simulation endpoint)* | – | Airwallex accepts both transitions | SENT answered SENT; FAILED answered FAILED (INCORRECT_ROUTING) | **pass** | 7, 8 | 2292 |
| 5 | `fail.readback` The first transfer read back at Airwallex (GET /transfers/{id}), again after 20 s while it is FAILED and not yet closed (at most 3 reads) | – | CANCELLED with a failure type (final-failed) | reads: CANCELLED INCORRECT_ROUTING | **pass** | 9 | 325 |
| 6 | `replace.off` The runner's replacement hook with KIT11_REPLACE_FAILED_PAYOUT unset (the default) | treasury | no hook: nothing is replaced by code | no hook (off) | **pass** | 0 | 0 |
| 7 | `replace.once` The runner's replacement hook with KIT11_REPLACE_FAILED_PAYOUT=on, for the failed payment | treasury | replaced once: one new transfer under the request_id derived from the first, same amount, payee and approval hash | replaced: SCHEDULED; replacement 05928c50-120e-4280-8125-ded979442af8 SCHEDULED under a88b95df-ff14-5295-9971-8e72e460dda2 (derived from the first: true); 1 create; calls GET /transfers/{id}, GET /balances/current, POST /transfers/create | **pass** | 10, 11, 12 | 1627 |
| 8 | `replace.settle` The replacement settled by the sandbox's simulation (SENT, PAID) and read back *(simulated: the settlement to PAID is the sandbox's simulation)* | – | PAID | 05928c50-120e-4280-8125-ded979442af8 PAID (EUR 1.02) | **pass** | 13, 14, 15, 16 | 2108 |
| 9 | `replace.again` Asked again: the hook, then replaceFailedPayout directly | treasury | no second send: the hook answers asked before; the direct call finds the replacement (already_replaced); no POST | hook: asked before (0 calls); direct: already_replaced (1 calls, 0 POST) | **pass** | 17 | 319 |
| 10 | `readback.both` Airwallex read back by both request_ids (GET /transfers?request_id=…) and both transfers by id | – | one transfer under each request_id; the first CANCELLED, the replacement PAID | 6b12284e-7974-4630-9c44-47d435efbc6b: found; a88b95df-ff14-5295-9971-8e72e460dda2: found; first CANCELLED INCORRECT_ROUTING; replacement PAID | **pass** | 18, 19, 20, 21 | 1286 |

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 11:31:33.080 | 11:31:33.808 | 728 | `POST /authentication/login` | 201 | – | `dbc090c9d3314f50b9d4e7266e8a527e` | – | setup.payout (treasury) |
| 2 | 11:31:33.811 | 11:31:34.352 | 541 | `GET /beneficiaries` | 200 | – | `b3d4731076804d2283dd1cd3a491e2f4` | – | setup.payout (treasury) |
| 3 | 11:31:34.426 | 11:31:34.746 | 320 | `GET /balances/current` | 200 | – | `6bc003f6169a4c45898249a620558f56` | – | setup.payout (treasury) |
| 4 | 11:31:34.782 | 11:31:35.114 | 332 | `GET /balances/current` | 200 | – | `e1f3e7ae47204bfbadceb6208ff49013` | – | pay.create (treasury) |
| 5 | 11:31:35.138 | 11:31:36.540 | 1402 | `POST /transfers/create` | 201 | – | `50e41fcb99164e6b86f9832b44cfab51` | – | pay.create (treasury) |
| 6 | 11:31:36.544 | 11:31:36.880 | 336 | `GET /balances/current` | 200 | – | `bcac381fbd9147619658afd09f150bb0` | – | pay.create (treasury) |
| 7 | 11:31:36.886 | 11:31:38.510 | 1624 | `POST /simulation/transfers/{id}/transition` | 200 | – | `2d1634404cac44e485fe391ee7f5826b` | – | fail.simulated |
| 8 | 11:31:38.511 | 11:31:39.177 | 666 | `POST /simulation/transfers/{id}/transition` | 200 | – | `c706d9d07eda40be89192eb05e378c2b` | – | fail.simulated |
| 9 | 11:31:39.182 | 11:31:39.503 | 321 | `GET /transfers/{id}` | 200 | – | `28f1324594f440e7b6aa478e3461fcf6` | – | fail.readback |
| 10 | 11:31:39.519 | 11:31:39.827 | 308 | `GET /transfers/{id}` | 200 | – | `79d21200a1244d20a3e0b11425268d1a` | – | replace.once (treasury) |
| 11 | 11:31:39.833 | 11:31:40.148 | 315 | `GET /balances/current` | 200 | – | `3cb7b05ccf0546bbb04423655e624ff0` | – | replace.once (treasury) |
| 12 | 11:31:40.150 | 11:31:41.132 | 982 | `POST /transfers/create` | 201 | – | `ad94dcbdd7364a97a1349c808143f814` | – | replace.once (treasury) |
| 13 | 11:31:41.148 | 11:31:41.453 | 305 | `GET /transfers/{id}` | 200 | – | `c44bcaac6fa44549bde8abafe87133d8` | – | replace.settle |
| 14 | 11:31:41.454 | 11:31:42.392 | 938 | `POST /simulation/transfers/{id}/transition` | 200 | – | `2db4a35df11f4027ae4d34c49ebd0a54` | – | replace.settle |
| 15 | 11:31:42.393 | 11:31:42.870 | 477 | `POST /simulation/transfers/{id}/transition` | 200 | – | `214ce35381ed4027a719c48048a80a39` | – | replace.settle |
| 16 | 11:31:42.871 | 11:31:43.255 | 384 | `GET /transfers/{id}` | 200 | – | `cd3ee7f972ad4a3a8bf073246756d2ee` | – | replace.settle |
| 17 | 11:31:43.261 | 11:31:43.572 | 311 | `GET /transfers/{id}` | 200 | – | `f86dd6f326dc4842b26498b134e5fc73` | – | replace.again (treasury) |
| 18 | 11:31:43.578 | 11:31:43.877 | 299 | `GET /transfers` | 200 | – | `8535f366a0c24d55be15c84185a08bd4` | – | readback.both |
| 19 | 11:31:43.878 | 11:31:44.172 | 294 | `GET /transfers` | 200 | – | `5682f7a242de485092af1dff6b70f6b3` | – | readback.both |
| 20 | 11:31:44.172 | 11:31:44.548 | 376 | `GET /transfers/{id}` | 200 | – | `4934d6b0bd8248ee82434afe816c1cf0` | – | readback.both |
| 21 | 11:31:44.549 | 11:31:44.862 | 313 | `GET /transfers/{id}` | 200 | – | `a2a53ad72db84b82974062d9a547811d` | – | readback.both |

Calls by endpoint: `POST /authentication/login` 1, `GET /beneficiaries` 1, `GET /balances/current` 4, `POST /transfers/create` 2, `POST /simulation/transfers/{id}/transition` 4, `GET /transfers/{id}` 7, `GET /transfers` 2.

## What this does not show

- A replacement that fails too (Purser then stops for a person): not run live.
- A payout paid and then returned (no replacement by code): the 17 Nov late-failure run shows such a return; this run's payout never reached PAID.
- A real bank's rejection: the failure is the sandbox's simulation. One run.
