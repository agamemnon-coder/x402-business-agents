# Emergency stop at the rail, live: 2026-11-26

`npm run airwallex:governance-live -- live stop-rail`. The CFO's emergency stop at the rail (src/policy/emergencyStop.ts `railStop`, asked by src/airwallex/routedRail.ts immediately before every create), with signed supplier payouts on the Airwallex sandbox: the stop landing at the rail after the executor's own last check; the executor and the routed rail refusing with the stop on; Airwallex read back by request_id; the stop lifted with the passkey and the same payment then paid. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `86d7f6b93376`. The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-26-stop-at-rail-live.json.

**12 of 12 steps passed, 0 failed, 0 not judged** (measurements, or not supported by the sandbox). 20 Airwallex calls of a budget of 60 (the drill's hard limit: 80; logins included), one at a time, at least 200 ms apart; 0 answered 429; 0 unexpected non-2xx.

## In short

- pass, `stop.lands_at_rail`: HeldBeforeCreate: the CFO pulled the emergency stop; nothing is paid until it is lifted; 1 Airwallex calls (0 POST: GET /balances/current); stop on; row CANCELLED held_by_purser; payment FAILED; audited checked: rail
- pass, `blocked.executor`: refused: the CFO pulled the emergency stop; nothing is paid until it is lifted; 1 Airwallex calls (0 POST: GET /balances/current); payment APPROVED
- pass, `blocked.rail`: HeldBeforeCreate: the CFO pulled the emergency stop; nothing is paid until it is lifted; 0 Airwallex calls; audited checked: rail
- pass, `readback.none`: 2601a7bb-3f94-4e7c-8cfe-826c5697e339: no transfer; b808985c-12ce-49fd-ade9-3704b4c773d3: no transfer
- pass, `lift.passkey`: P-0004 approved by the passkey and applied; the stop off
- pass, `paid.payout1`: transfer db7377c0-adf7-4aaa-b46d-a1b025e2b821 PAID; payment EXECUTED; 8 Airwallex calls (GET /balances/current, POST /transfers/create, GET /transfers/{id}, POST /simulation/transfers/{id}/transition, GET /transfers/{id}, POST /simulation/transfers/{id}/transition, GET /transfers/{id}, GET /balances/current)
- pass, `readback.paid`: db7377c0-adf7-4aaa-b46d-a1b025e2b821 PAID (EUR 1.00); request_id 2601a7bb-3f94-4e7c-8cfe-826c5697e339: found
- pass, `after.payout2`: refused: the payout b808985c-12ce-49fd-ade9-3704b4c773d3 was refused by Airwallex and closed; nothing is sent again under it, a new proposal is neede; 0 POST; Airwallex under b808985c-12ce-49fd-ade9-3704b4c773d3: no transfer
- Shown: With a signed stop landing at the rail after the executor's last check, nothing reached Airwallex: no POST was sent, the payout row was closed CANCELLED (`held_by_purser`), the payment FAILED, and the refusal is audited `transfer.held_before_create` with `checked: rail`.
- Shown: With the stop on, the executor refuses a signed payment when its execution begins (no POST; one balance read), and the routed rail asked directly refuses the same request_id with no call at all.
- Shown: Airwallex holds no transfer under either request_id while the stop is on.
- Shown: Lifted with the passkey, the same signed payment (its own request_id) is created at Airwallex and followed to PAID; the payout held at the rail is not sent again under its request_id.

## Simulated, and how

- The approver is a labelled virtual test passkey ("governance-live virtual test passkey (no person's Face ID)", src/redteam/authenticator.ts), enrolled as the only passkey of the run's own fresh ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.
- The CFO's phone is played by the run: the stop is signed with the phone's own path (processPolicyRequest). The lift is a proposal on the runner approved with the passkey (the phone may not lift it). The runner's steps after an approval (executePolicyChange, then syncCardsAfterPolicy) are called by the run once, in order, not by a running `npm run relay` and its every-few-seconds loop.
- In `stop.lands_at_rail` the run chooses the moment the signed stop is applied: inside the rail's last ask before the transfer create, after the executor's own check let the payment through. The stop itself is the CFO's signed change, applied by executePolicyChange.
- The settlement of the paid payout (SENT, then PAID) is the sandbox's simulation endpoint (`POST /simulation/transfers/{id}/transition`).

## Steps (11:28:08.266–11:28:18.279 UTC)

A fresh ledger of its own, on the platform account's own balance (no x-on-behalf-of). Both payouts go to the beneficiary Bergtex Textil GmbH already on file at Airwallex (none created). The routed rail is Purser Cloud's `RoutedRail` with the Airwallex sandbox adapter as its Airwallex bank, an in-memory stand-in as its simulated bank (never used: every action ran `within("airwallex")`), a permissive cap guard, and `railStop` on this ledger. Before the runs, 14 read-only calls checked the sandbox (10 in three probes: the platform's and the connected account's balances, GET /account, which answered `acct_op0_QItiOyWKsYb5pwQihA`, and the connected account's beneficiaries; 4 in the entities run's two stopped attempts, described in docs/runs/2026-11-26-entities-live.md). None moved money or changed anything; they are not in this record's call table. The runs (11:27 to 11:32 UTC) ran on the code committed right after them as `86d7f6b93`; between the runs and that commit only the records' wording, the stand-in's call counter and two unused imports changed.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: governance-live virtual test passkey (no person's Face ID) | **pass** | 0 | 15 |
| 2 | `setup.payouts` Two supplier payouts planned against the sandbox (EUR 1.00 and EUR 1.01 to Bergtex Textil GmbH) and signed with the passkey *(simulated: signed by the virtual test passkey)* | treasury | both APPROVED, not executed | P-0001 APPROVED (EUR 1.00, request_id 2601a7bb-3f94-4e7c-8cfe-826c5697e339); P-0002 APPROVED (EUR 1.01, request_id b808985c-12ce-49fd-ade9-3704b4c773d3) | **pass** | 1, 2, 3, 4 | 2351 |
| 3 | `stop.signed` The CFO signs the emergency stop on the phone (a policy change, freeze off to on), not yet applied *(simulated: signed by the virtual test passkey)* | – | approved by the passkey | C-c62ce97c approved; the stop is not yet applied | **pass** | 0 | 43 |
| 4 | `stop.lands_at_rail` The second payout (P-0002) is started on the routed rail with the stop off; the signed stop is applied at the instant its transfer create reaches the rail, after the executor's own last check *(simulated: the moment the stop lands is chosen by the run (inside the rail's last ask); the stop itself is the CFO's signed change)* | treasury | HeldBeforeCreate at the rail: no POST to Airwallex, the payout row closed CANCELLED (held_by_purser), the payment FAILED, the refusal audited (checked: rail) | HeldBeforeCreate: the CFO pulled the emergency stop; nothing is paid until it is lifted; 1 Airwallex calls (0 POST: GET /balances/current); stop on; row CANCELLED held_by_purser; payment FAILED; audited checked: rail | **pass** | 5 | 381 |
| 5 | `stop.sync` The runner syncs the cards after the stop (this ledger holds no cards) | – | no card, no call | changed []; 0 calls | **pass** | 0 | 1 |
| 6 | `blocked.executor` The first payout (P-0001) is started on the routed rail while the stop is on (executeInvoicePayment) | treasury | refused by the executor when its execution begins: no POST to Airwallex; the payment stays APPROVED | refused: the CFO pulled the emergency stop; nothing is paid until it is lifted; 1 Airwallex calls (0 POST: GET /balances/current); payment APPROVED | **pass** | 6 | 349 |
| 7 | `blocked.rail` The routed rail asked directly for the first payout's transfer (its signed request_id, payee and amount), the stop on | treasury | HeldBeforeCreate: nothing sent to Airwallex; the refusal audited (checked: rail) | HeldBeforeCreate: the CFO pulled the emergency stop; nothing is paid until it is lifted; 0 Airwallex calls; audited checked: rail | **pass** | 0 | 2 |
| 8 | `readback.none` Airwallex read back by each payout's request_id (GET /transfers?request_id=…) | – | no transfer under either request_id | 2601a7bb-3f94-4e7c-8cfe-826c5697e339: no transfer; b808985c-12ce-49fd-ade9-3704b4c773d3: no transfer | **pass** | 7, 8 | 827 |
| 9 | `lift.passkey` The CFO lifts the stop: a proposal on the runner (freeze on to off), approved with the passkey, applied *(simulated: signed by the virtual test passkey)* | – | the stop off | P-0004 approved by the passkey and applied; the stop off | **pass** | 0 | 53 |
| 10 | `paid.payout1` The same first payout (P-0001) started again on the routed rail after the lift, then settled by the sandbox's simulation *(simulated: the settlement to PAID is the sandbox's simulation)* | treasury | the transfer created under its signed request_id, followed to PAID | transfer db7377c0-adf7-4aaa-b46d-a1b025e2b821 PAID; payment EXECUTED; 8 Airwallex calls (GET /balances/current, POST /transfers/create, GET /transfers/{id}, POST /simulation/transfers/{id}/transition, GET /transfers/{id}, POST /simulation/transfers/{id}/transition, GET /transfers/{id}, GET /balances/current) | **pass** | 9, 10, 11, 12, 13, 14, 15, 16 | 4710 |
| 11 | `readback.paid` Airwallex read back: the transfer by its id, and the request_id | – | PAID; a transfer under the first payout's request_id | db7377c0-adf7-4aaa-b46d-a1b025e2b821 PAID (EUR 1.00); request_id 2601a7bb-3f94-4e7c-8cfe-826c5697e339: found | **pass** | 17, 18 | 622 |
| 12 | `after.payout2` The payout held at the rail (P-0002) started again after the lift | treasury | not sent again under its request_id (a new proposal pays the invoice): no POST | refused: the payout b808985c-12ce-49fd-ade9-3704b4c773d3 was refused by Airwallex and closed; nothing is sent again under it, a new proposal is neede; 0 POST; Airwallex under b808985c-12ce-49fd-ade9-3704b4c773d3: no transfer | **pass** | 19, 20 | 645 |

Timings: payout_create_to_paid_ms 4710 ms.

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 11:28:08.286 | 11:28:08.916 | 630 | `POST /authentication/login` | 201 | – | `a9b4b733811b45c4bc6a8faa46c27a30` | – | setup.payouts (treasury) |
| 2 | 11:28:08.919 | 11:28:09.442 | 523 | `GET /beneficiaries` | 200 | – | `07777d05fdf746e1accc763da97c5eae` | – | setup.payouts (treasury) |
| 3 | 11:28:09.615 | 11:28:10.193 | 578 | `GET /balances/current` | 200 | – | `003aa3d2c7c84c5dbbba1e39580ef951` | – | setup.payouts (treasury) |
| 4 | 11:28:10.231 | 11:28:10.612 | 381 | `GET /balances/current` | 200 | – | `12ab70ae29d04e3da6946edd9e004ea5` | – | setup.payouts (treasury) |
| 5 | 11:28:10.685 | 11:28:11.039 | 354 | `GET /balances/current` | 200 | – | `0e1df3fc78ac49a0bef6642f0dfdf277` | – | stop.lands_at_rail (treasury) |
| 6 | 11:28:11.066 | 11:28:11.405 | 339 | `GET /balances/current` | 200 | – | `7fb481731de3432fa28ed6336fc8b443` | – | blocked.executor (treasury) |
| 7 | 11:28:11.417 | 11:28:11.774 | 357 | `GET /transfers` | 200 | – | `922ff2263ea24b7d8ac84b125b4e2f36` | – | readback.none |
| 8 | 11:28:11.775 | 11:28:12.242 | 467 | `GET /transfers` | 200 | – | `9d5fe4d9ce81494c918ee4338b776284` | – | readback.none |
| 9 | 11:28:12.301 | 11:28:12.627 | 326 | `GET /balances/current` | 200 | – | `9aabfcffc396465fbe52e3533fe6716e` | – | paid.payout1 (treasury) |
| 10 | 11:28:12.639 | 11:28:14.214 | 1575 | `POST /transfers/create` | 201 | – | `a455aecbe61c474c87af38cde26bcc7c` | – | paid.payout1 (treasury) |
| 11 | 11:28:14.217 | 11:28:14.522 | 305 | `GET /transfers/{id}` | 200 | – | `52dc9cce41b64ca3833bdb781f5ee4a6` | – | paid.payout1 (treasury) |
| 12 | 11:28:14.527 | 11:28:15.528 | 1001 | `POST /simulation/transfers/{id}/transition` | 200 | – | `a1232726338a48e19b01a546e8e481f1` | – | paid.payout1 (treasury) |
| 13 | 11:28:15.529 | 11:28:15.874 | 345 | `GET /transfers/{id}` | 200 | – | `2877cc2af1b64805b035bce81a482101` | – | paid.payout1 (treasury) |
| 14 | 11:28:15.876 | 11:28:16.380 | 504 | `POST /simulation/transfers/{id}/transition` | 200 | – | `74f0c58d8dc0484b8ce0399dc0ae316a` | – | paid.payout1 (treasury) |
| 15 | 11:28:16.380 | 11:28:16.674 | 294 | `GET /transfers/{id}` | 200 | – | `cd52ad6fd3f248f58adaffc89a7bba24` | – | paid.payout1 (treasury) |
| 16 | 11:28:16.680 | 11:28:17.000 | 320 | `GET /balances/current` | 200 | – | `8d3418e647204dfdb941043c010be0f2` | – | paid.payout1 (treasury) |
| 17 | 11:28:17.009 | 11:28:17.324 | 315 | `GET /transfers/{id}` | 200 | – | `17efcc86d7d84dce91034d8c6354df8d` | – | readback.paid |
| 18 | 11:28:17.325 | 11:28:17.630 | 305 | `GET /transfers` | 200 | – | `bf2ecd3876f34e0080b64dbd08b74096` | – | readback.paid |
| 19 | 11:28:17.635 | 11:28:17.952 | 317 | `GET /balances/current` | 200 | – | `16ebc9265a044494b3fd0fc0c66cb180` | – | after.payout2 (treasury) |
| 20 | 11:28:17.962 | 11:28:18.277 | 315 | `GET /transfers` | 200 | – | `5f0e46c1042f44958445f464ce1c91df` | – | after.payout2 (treasury) |

Calls by endpoint: `POST /authentication/login` 1, `GET /beneficiaries` 1, `GET /balances/current` 7, `GET /transfers` 4, `POST /transfers/create` 1, `GET /transfers/{id}` 4, `POST /simulation/transfers/{id}/transition` 2.

## What this does not show

- Purser Cloud's own engine and its routes: the rail, the stop and the executor are Purser's code, wired by the run as Cloud wires them (cloud/src/engine/awxWire.ts), not a request to a running Cloud.
- The `after.payout2` refusal reads "was refused by Airwallex and closed": the payout was held by Purser at the rail, not refused by Airwallex. The outcome (nothing sent again under that request_id) is right; the words are the executor's general ones for a closed row (src/executors/invoicePayment.ts submitTransfer).
- A conversion held at the rail: both payouts were in euros from euros, so no conversion was asked for.
- A person's Face ID on a real phone. One run: the times are single measurements.
