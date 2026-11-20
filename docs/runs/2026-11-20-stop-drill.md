# Stop drill: 2026-11-20

`npm run airwallex:stop-drill -- live`. The emergency stop and the velocity stop pulled live against sandbox-backed agents: every agent, card and pending action tried after each, the time to fully blocked measured, and every way of lifting it tried. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `5d9bd3da29b4` (each pass says what it ran on). The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-20-stop-drill.json.

**53 of 55 steps passed, 1 failed, 1 not judged** (measurements, or not supported by the sandbox). 126 Airwallex calls of a budget of 150 (the drill's hard limit: 150; logins included), one at a time, at least 200 ms apart; 0 answered 429; 1 unexpected non-2xx.

## In short

- Pass 1: emergency stop pulled: C-24599e28 approved by the passkey; Purser refuses every agent payment after 82 ms; sourcing, support, treasury frozen at Airwallex, the last read back INACTIVE after 3498 ms; fully blocked after 3501 ms.
- Pass 1: after the stop, 14 of 14 checks blocked.
- Pass 1: lifting it: phone as expected, unapproved as expected, typed as expected, passkey NOT as expected, purchase as expected (lift.passkey: P-0003 approved by the passkey; emergency stop off; cards ACTIVE, ACTIVE, ACTIVE).
- Pass 1: velocity stop: 1:ok 2:ok 3:ok 4:ok 5:ok 6:ok in 32759 ms; stopped after purchase 6 (6 payments in a minute, the limit is 5); the agent was stopped 743 ms after Airwallex answered the authorisation that broke the limit.
- Pass 1: after the velocity stop: card not judged.
- Pass 2: after the velocity stop: card as expected, purchase as expected, others as expected, lift_phone as expected, lift_passkey as expected.
- Pass 3: emergency stop pulled: C-b7c7b485 approved by the passkey; Purser refuses every agent payment after 102 ms; sourcing, support, treasury frozen at Airwallex, the last read back INACTIVE after 3350 ms; fully blocked after 3352 ms.
- Pass 3: after the stop, 13 of 13 checks blocked.
- Pass 3: lifting it: phone as expected, unapproved as expected, typed as expected, passkey as expected, purchase as expected.

## Simulated, and how

- The approver is a labelled virtual test passkey ("stop-drill virtual test passkey (no person's Face ID)", src/redteam/authenticator.ts), enrolled as the only passkey of the drill's own ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.
- The CFO's phone is played by the drill: the stop is pulled with the phone's own path (a signed policy change, processPolicyRequest), and the runner's steps after an approval (executePolicyChange, then syncCardsAfterPolicy) are called by the drill, not by a running `npm run relay`.
- Every merchant charge is the sandbox's simulation endpoint (`POST /simulation/issuing/create`); the approve or decline is Airwallex's own.
- The supplier payout is planned against the sandbox (balance, beneficiary) and signed, but never created: the emergency stop refuses it, which is what the drill checks.

## The cards

| Agent | Card id | Last 4 | Nickname at Airwallex |
|---|---|---|---|
| sourcing | `29c779e4-907b-43e5-b420-2f5cffc1ac58` | 6051 | sourcing agent: warehouse and data software (card-drill) |
| support | `71fa14e1-42be-4da3-9329-cdc15f2b5f65` | 2361 | support agent: helpdesk software (card-drill) |
| treasury | `8743bc4c-8d29-4c72-9f4b-fbe37e7cb830` | 4577 | treasury agent: bookkeeping (card-drill) |

## Pass 1 (09:53:15.731–09:54:21.826 UTC)

The card code as on origin/main (f667d16), with the drill beside it. **Stopped at `velocity.card`:** the sandbox's simulation answered HTTP 400 bad_request to a charge on the stopped agent's frozen card (its message was not kept by this pass's log; the card drill met a 400 on the same endpoint at 10:00 UTC with the message "failed to process transaction"). The drill halts on any unexpected 4xx.

**Stopped:** velocity.card: an unexpected HTTP 400 bad_request on POST /simulation/issuing/create (line 83)

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.cards` Adopt the three agents' drill cards (issued by the card drill) and bring them to the policy | – | three cards, INACTIVE at Airwallex | sourcing ••6051 INACTIVE, support ••2361 INACTIVE, treasury ••4577 INACTIVE | **pass** | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 | 6860 |
| 2 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: stop-drill virtual test passkey (no person's Face ID) | **pass** | 0 | 35 |
| 3 | `setup.payout` A supplier payout planned against the sandbox (EUR 1.00 to Bergtex Textil GmbH) and signed, waiting to run *(simulated: signed by the virtual test passkey)* | treasury | APPROVED, not executed | P-0001 APPROVED by the virtual passkey (approved); request_id a55b7cbb-7ca1-4f71-a2cb-4d27c3bebae6 | **pass** | 16, 17 | 980 |
| 4 | `setup.windows` Every agent's card thawed mid-purchase (openCardWindow on each) | – | three cards ACTIVE at Airwallex | sourcing ACTIVE, support ACTIVE, treasury ACTIVE | **pass** | 18, 19, 20, 21, 22, 23 | 2102 |
| 5 | `stop.pull` The CFO pulls the emergency stop on the phone (a policy change signed by the passkey), the runner applies it and syncs the cards *(simulated: signed by the virtual test passkey)* | – | every card frozen at Airwallex; the time to fully blocked measured | C-24599e28 approved by the passkey; Purser refuses every agent payment after 82 ms; sourcing, support, treasury frozen at Airwallex, the last read back INACTIVE after 3498 ms; fully blocked after 3501 ms | **pass** | 24, 25, 26, 27, 28, 29, 30, 31, 32 | 3510 |
| 6 | `blocked.charge` A merchant charges the agent's card (EUR 1.04) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 33 | 2797 |
| 7 | `blocked.purchase` The agent buys on its card (buyPlan packwise-starter) | sourcing | refused by Purser, before any Airwallex call | refused: the CFO stopped every agent payment (emergency stop); the sourcing agent buys nothing until the CFO lifts it with Face ID; 0 Airwallex calls | **pass** | 0 | 13 |
| 8 | `blocked.alta` The agent pays on Alta (Purser's check before signing) | sourcing | refused frozen_by_cfo | refused: frozen_by_cfo: the CFO stopped every agent payment (emergency stop); the Sourcing agent signs nothing | **pass** | 0 | 0 |
| 9 | `blocked.window` Purser tries to open a purchase window on the card | sourcing | no window opened, no Airwallex call | no window; 0 calls | **pass** | 0 | 1 |
| 10 | `blocked.charge` A merchant charges the agent's card (EUR 1.04) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 34 | 3614 |
| 11 | `blocked.purchase` The agent buys on its card (buyPlan replyhub-starter) | support | refused by Purser, before any Airwallex call | refused: the CFO stopped every agent payment (emergency stop); the support agent buys nothing until the CFO lifts it with Face ID; 0 Airwallex calls | **pass** | 0 | 29 |
| 12 | `blocked.alta` The agent pays on Alta (Purser's check before signing) | support | refused frozen_by_cfo | refused: frozen_by_cfo: the CFO stopped every agent payment (emergency stop); the Support agent signs nothing | **pass** | 0 | 1 |
| 13 | `blocked.window` Purser tries to open a purchase window on the card | support | no window opened, no Airwallex call | no window; 0 calls | **pass** | 0 | 2 |
| 14 | `blocked.charge` A merchant charges the agent's card (EUR 1.04) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 35 | 2565 |
| 15 | `blocked.purchase` The agent buys on its card (buyPlan ledgerly-starter) | treasury | refused by Purser, before any Airwallex call | refused: the CFO stopped every agent payment (emergency stop); the treasury agent buys nothing until the CFO lifts it with Face ID; 0 Airwallex calls | **pass** | 0 | 2 |
| 16 | `blocked.alta` The agent pays on Alta (Purser's check before signing) | treasury | refused frozen_by_cfo | refused: frozen_by_cfo: the CFO stopped every agent payment (emergency stop); the Treasury agent signs nothing | **pass** | 0 | 0 |
| 17 | `blocked.window` Purser tries to open a purchase window on the card | treasury | no window opened, no Airwallex call | no window; 0 calls | **pass** | 0 | 1 |
| 18 | `blocked.payout` The signed payout waiting to run is started (executeInvoicePayment) | treasury | refused before any create; Airwallex holds no transfer under its request_id | refused: the CFO pulled the emergency stop; nothing is paid until it is lifted; 1 calls (0 POST) while refusing; at Airwallex: no transfer | **pass** | 36, 37 | 770 |
| 19 | `blocked.health` The runner's health | – | the emergency_stop alarm stands (/health answers 503) | emergency_stop alarm standing | **pass** | 0 | 21 |
| 20 | `lift.phone` Lift the stop from the phone (a signed change, freeze on to off) *(simulated: signed by the virtual test passkey)* | – | refused: the phone can only tighten | refused: the phone can only tighten the CFO policy; Emergency stop: all agent payments and cards would loosen it. Propose that on the runner (npm run policy -- set …) an | **pass** | 0 | 3 |
| 21 | `lift.unapproved` Lift the stop with a proposal on the runner that nobody approved | – | refused: not approved | refused: P-0003 is PENDING_APPROVAL, not approved | **pass** | 0 | 14 |
| 22 | `lift.typed` Approve the runner's proposal with its typed hash prefix (no passkey) | – | refused: once a passkey is enrolled, a typed prefix can only reject | refused: a passkey is enrolled: approve with it (Face ID on the phone); a typed hash prefix can only reject | **pass** | 0 | 1 |
| 23 | `lift.passkey` Approve the runner's proposal with the passkey, apply it, sync the cards *(simulated: signed by the virtual test passkey)* | – | lifted; the cards stay frozen by default | P-0003 approved by the passkey; emergency stop off; cards ACTIVE, ACTIVE, ACTIVE | **FAIL** | 38, 39, 40, 41, 42, 43, 44, 45, 46 | 3071 |
| 24 | `lift.purchase` After the lift, an agent buys on its card (EUR 1.05) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | approved; the card INACTIVE again after it | approved (APPROVED); card INACTIVE | **pass** | 47, 48, 49, 50, 51 | 5287 |
| 25 | `velocity.burst` The treasury agent buys 6 times within a minute (its limit is 5 a minute) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | purchases 1 to 5 approved; the 6th approved by Airwallex and stops the agent | 1:ok 2:ok 3:ok 4:ok 5:ok 6:ok in 32759 ms; stopped after purchase 6 (6 payments in a minute, the limit is 5) | **pass** | 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81 | 32760 |
| 26 | `velocity.card` The stopped agent's card at Airwallex, and a merchant charging it (EUR 1.06) | treasury | INACTIVE; declined CARD_INACTIVE | the sandbox refused to simulate the charge (HTTP 400 bad_request): neither approved nor declined, nothing to judge. error: Airwallex /simulation/issuing/create -> 400 bad_request (trace 1d1b94c7d1d94fd1ad16e41de085bdec) | not judged | 82, 83 | 1418 |

Timings: code_blocked_ms 82 ms; cards_frozen_ms 3498 ms; fully_blocked_ms 3501 ms; velocity_stop_after_authorisation_ms 743 ms.

## Pass 2 (10:07:35.771–10:07:49.942 UTC)

The rest of the velocity stop (after the burst), on the same ledger, with the card fixes in place. The first pass's virtual passkey lived only in that process, so a new labelled virtual passkey replaced it (the replace window the ledger offers for a lost passkey).

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.cards` Adopt the three agents' drill cards (issued by the card drill) and bring them to the policy | – | three cards, INACTIVE at Airwallex | sourcing ••6051 INACTIVE, support ••2361 INACTIVE, treasury ••4577 INACTIVE | **pass** | 84, 85, 86, 87 | 2124 |
| 2 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: stop-drill virtual test passkey (no person's Face ID), pass 2 (replacing the earlier pass's) | **pass** | 0 | 98 |
| 3 | `velocity.card` The stopped agent's card at Airwallex, and a merchant charging it (EUR 1.06) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | INACTIVE; declined CARD_INACTIVE | card INACTIVE; declined CARD_INACTIVE | **pass** | 88, 89 | 3377 |
| 4 | `velocity.purchase` The stopped agent tries to buy again | treasury | refused by Purser before any Airwallex call | refused: the treasury agent was stopped automatically (velocity limit); it buys nothing until the CFO lifts the stop with Face ID; 0 calls | **pass** | 0 | 20 |
| 5 | `velocity.others` Another agent buys while the Treasury agent is stopped (EUR 1.07) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | approved: the other agents go on | approved (APPROVED) | **pass** | 90, 91, 92, 93, 94 | 4239 |
| 6 | `velocity.lift_phone` Lift the velocity stop from the phone (a signed change, stop on to off) *(simulated: signed by the virtual test passkey)* | treasury | refused: the phone can only tighten | refused: the phone can only tighten the CFO policy; Treasury agent: stopped (velocity limit) would loosen it. Propose that on the runner (npm run policy -- set …) and ap | **pass** | 0 | 54 |
| 7 | `velocity.lift_passkey` Lift it with a proposal on the runner, approved with the passkey; then the agent buys (EUR 1.08) *(simulated: signed by the virtual test passkey; the merchant's charge is the sandbox's simulation endpoint)* | treasury | lifted; the purchase approved | typed prefix refused; passkey approved; stop off; purchase approved (APPROVED) | **pass** | 95, 96, 97, 98, 99 | 4211 |

## Pass 3 (10:07:56.386–10:08:19.090 UTC)

After the fix to `lift.passkey` (src/policy/cards.ts closeBlockedWindow: a stop closes the purchase windows it overrules): the cards thawed mid-purchase, the stop, the checks on the cards and agents, and the lift again, on the same ledger with a new virtual passkey. The pending payout was not planned again (pass 1 shows it refused).

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.cards` Adopt the three agents' drill cards (issued by the card drill) and bring them to the policy | – | three cards, INACTIVE at Airwallex | sourcing ••6051 INACTIVE, support ••2361 INACTIVE, treasury ••4577 INACTIVE | **pass** | 100, 101, 102, 103 | 2028 |
| 2 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: stop-drill virtual test passkey (no person's Face ID), pass 3 (replacing the earlier pass's) | **pass** | 0 | 48 |
| 3 | `setup.windows` Every agent's card thawed mid-purchase (openCardWindow on each) | – | three cards ACTIVE at Airwallex | sourcing ACTIVE, support ACTIVE, treasury ACTIVE | **pass** | 104, 105, 106, 107, 108, 109 | 2288 |
| 4 | `stop.pull` The CFO pulls the emergency stop on the phone (a policy change signed by the passkey), the runner applies it and syncs the cards *(simulated: signed by the virtual test passkey)* | – | every card frozen at Airwallex; the time to fully blocked measured | C-b7c7b485 approved by the passkey; Purser refuses every agent payment after 102 ms; sourcing, support, treasury frozen at Airwallex, the last read back INACTIVE after 3350 ms; fully blocked after 3352 ms | **pass** | 110, 111, 112, 113, 114, 115, 116, 117, 118 | 3354 |
| 5 | `blocked.charge` A merchant charges the agent's card (EUR 1.04) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 119 | 3962 |
| 6 | `blocked.purchase` The agent buys on its card (buyPlan packwise-starter) | sourcing | refused by Purser, before any Airwallex call | refused: the CFO stopped every agent payment (emergency stop); the sourcing agent buys nothing until the CFO lifts it with Face ID; 0 Airwallex calls | **pass** | 0 | 18 |
| 7 | `blocked.alta` The agent pays on Alta (Purser's check before signing) | sourcing | refused frozen_by_cfo | refused: frozen_by_cfo: the CFO stopped every agent payment (emergency stop); the Sourcing agent signs nothing | **pass** | 0 | 1 |
| 8 | `blocked.window` Purser tries to open a purchase window on the card | sourcing | no window opened, no Airwallex call | no window; 0 calls | **pass** | 0 | 1 |
| 9 | `blocked.charge` A merchant charges the agent's card (EUR 1.04) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 120 | 2646 |
| 10 | `blocked.purchase` The agent buys on its card (buyPlan replyhub-starter) | support | refused by Purser, before any Airwallex call | refused: the CFO stopped every agent payment (emergency stop); the support agent buys nothing until the CFO lifts it with Face ID; 0 Airwallex calls | **pass** | 0 | 2 |
| 11 | `blocked.alta` The agent pays on Alta (Purser's check before signing) | support | refused frozen_by_cfo | refused: frozen_by_cfo: the CFO stopped every agent payment (emergency stop); the Support agent signs nothing | **pass** | 0 | 1 |
| 12 | `blocked.window` Purser tries to open a purchase window on the card | support | no window opened, no Airwallex call | no window; 0 calls | **pass** | 0 | 5 |
| 13 | `blocked.charge` A merchant charges the agent's card (EUR 1.04) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 121 | 2651 |
| 14 | `blocked.purchase` The agent buys on its card (buyPlan ledgerly-starter) | treasury | refused by Purser, before any Airwallex call | refused: the CFO stopped every agent payment (emergency stop); the treasury agent buys nothing until the CFO lifts it with Face ID; 0 Airwallex calls | **pass** | 0 | 3 |
| 15 | `blocked.alta` The agent pays on Alta (Purser's check before signing) | treasury | refused frozen_by_cfo | refused: frozen_by_cfo: the CFO stopped every agent payment (emergency stop); the Treasury agent signs nothing | **pass** | 0 | 0 |
| 16 | `blocked.window` Purser tries to open a purchase window on the card | treasury | no window opened, no Airwallex call | no window; 0 calls | **pass** | 0 | 1 |
| 17 | `blocked.health` The runner's health | – | the emergency_stop alarm stands (/health answers 503) | emergency_stop alarm standing | **pass** | 0 | 95 |
| 18 | `lift.phone` Lift the stop from the phone (a signed change, freeze on to off) *(simulated: signed by the virtual test passkey)* | – | refused: the phone can only tighten | refused: the phone can only tighten the CFO policy; Emergency stop: all agent payments and cards would loosen it. Propose that on the runner (npm run policy -- set …) an | **pass** | 0 | 12 |
| 19 | `lift.unapproved` Lift the stop with a proposal on the runner that nobody approved | – | refused: not approved | refused: P-0006 is PENDING_APPROVAL, not approved | **pass** | 0 | 37 |
| 20 | `lift.typed` Approve the runner's proposal with its typed hash prefix (no passkey) | – | refused: once a passkey is enrolled, a typed prefix can only reject | refused: a passkey is enrolled: approve with it (Face ID on the phone); a typed hash prefix can only reject | **pass** | 0 | 1 |
| 21 | `lift.passkey` Approve the runner's proposal with the passkey, apply it, sync the cards *(simulated: signed by the virtual test passkey)* | – | lifted; the cards stay frozen by default | P-0006 approved by the passkey; emergency stop off; cards INACTIVE, INACTIVE, INACTIVE | **pass** | 0 | 87 |
| 22 | `lift.purchase` After the lift, an agent buys on its card (EUR 1.05) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | approved; the card INACTIVE again after it | approved (APPROVED); card INACTIVE | **pass** | 122, 123, 124, 125, 126 | 5253 |

Timings: code_blocked_ms 102 ms; cards_frozen_ms 3350 ms; fully_blocked_ms 3352 ms.

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 09:53:15.747 | 09:53:16.858 | 1111 | `POST /authentication/login` | 201 | – | `018984aa256f479191a034cac1deed81` | – | pass 1 setup.cards |
| 2 | 09:53:16.865 | 09:53:17.254 | 389 | `GET /issuing/cardholders` | 200 | – | `51c67e77e31e4cf3a977351733612a48` | – | pass 1 setup.cards |
| 3 | 09:53:17.259 | 09:53:17.611 | 352 | `GET /issuing/cards` | 200 | – | `b03bf426a9534777b15042807df8b952` | – | pass 1 setup.cards |
| 4 | 09:53:17.860 | 09:53:18.182 | 322 | `GET /issuing/cards` | 200 | – | `0be0081f75894527b27697bd89c33504` | – | pass 1 setup.cards |
| 5 | 09:53:18.183 | 09:53:18.512 | 329 | `GET /issuing/cards/{id}` | 200 | – | `7a97602a92e34bddbabc895c7e75cb1e` | INACTIVE | pass 1 setup.cards |
| 6 | 09:53:18.519 | 09:53:18.853 | 334 | `GET /issuing/cardholders` | 200 | – | `1551976227a24bdfb70ce7eecbbd847e` | – | pass 1 setup.cards |
| 7 | 09:53:18.854 | 09:53:19.192 | 338 | `GET /issuing/cards` | 200 | – | `a0056f1347dd4704be90218ceeaaa0ac` | – | pass 1 setup.cards |
| 8 | 09:53:19.439 | 09:53:19.755 | 317 | `GET /issuing/cards` | 200 | – | `624ada9296124007ac32145eb9f059cc` | – | pass 1 setup.cards |
| 9 | 09:53:19.756 | 09:53:20.083 | 327 | `GET /issuing/cards/{id}` | 200 | – | `bba7b0a053294c07bc62ec31ea35b489` | ACTIVE | pass 1 setup.cards |
| 10 | 09:53:20.086 | 09:53:20.498 | 412 | `POST /issuing/cards/{id}/update` | 200 | – | `037be1258f734dd783c65afd72098a4a` | – | pass 1 setup.cards |
| 11 | 09:53:20.499 | 09:53:21.023 | 524 | `GET /issuing/cards/{id}` | 200 | – | `91055c4766fc408e95810843c92beb2f` | INACTIVE | pass 1 setup.cards |
| 12 | 09:53:21.034 | 09:53:21.358 | 324 | `GET /issuing/cardholders` | 200 | – | `f3217f82f1cd49a88456825385f8e7bd` | – | pass 1 setup.cards |
| 13 | 09:53:21.359 | 09:53:21.707 | 348 | `GET /issuing/cards` | 200 | – | `943a53d2d7f544ea8e9943d123eaf5d9` | – | pass 1 setup.cards |
| 14 | 09:53:21.910 | 09:53:22.263 | 353 | `GET /issuing/cards` | 200 | – | `f3e1fa143e9d4ca59377afbd5b22a3f9` | – | pass 1 setup.cards |
| 15 | 09:53:22.263 | 09:53:22.588 | 325 | `GET /issuing/cards/{id}` | 200 | – | `129176d02ef54a46a670f6be96be613a` | INACTIVE | pass 1 setup.cards |
| 16 | 09:53:22.634 | 09:53:23.101 | 467 | `GET /beneficiaries` | 200 | – | `33ddc13691a04e0daef0f2b5949ca5e8` | – | pass 1 setup.payout (treasury) |
| 17 | 09:53:23.224 | 09:53:23.571 | 347 | `GET /balances/current` | 200 | – | `68f71dfea49746d6aa92405969780a78` | – | pass 1 setup.payout (treasury) |
| 18 | 09:53:23.613 | 09:53:23.981 | 368 | `POST /issuing/cards/{id}/update` | 200 | – | `595aa294e3e942b9bc1ceaf595134a21` | – | pass 1 setup.windows |
| 19 | 09:53:23.982 | 09:53:24.298 | 316 | `GET /issuing/cards/{id}` | 200 | – | `ffb67d6739e947d49e17ace127df566a` | ACTIVE | pass 1 setup.windows |
| 20 | 09:53:24.301 | 09:53:24.678 | 377 | `POST /issuing/cards/{id}/update` | 200 | – | `6759c8eff8f54aa1bc41697262545856` | – | pass 1 setup.windows |
| 21 | 09:53:24.686 | 09:53:25.011 | 325 | `GET /issuing/cards/{id}` | 200 | – | `4bfd033beae84f0180815a71d6b67f2a` | ACTIVE | pass 1 setup.windows |
| 22 | 09:53:25.013 | 09:53:25.393 | 380 | `POST /issuing/cards/{id}/update` | 200 | – | `ea8a1e9998904ce9be4479bf6f0f4092` | – | pass 1 setup.windows |
| 23 | 09:53:25.394 | 09:53:25.713 | 319 | `GET /issuing/cards/{id}` | 200 | – | `60a1fb2a092443208ca7c166b80defec` | ACTIVE | pass 1 setup.windows |
| 24 | 09:53:25.804 | 09:53:26.151 | 347 | `GET /issuing/cards/{id}` | 200 | – | `6639cfae51d34f42a6f9f7feda87d0c6` | ACTIVE | pass 1 stop.pull |
| 25 | 09:53:26.152 | 09:53:26.527 | 376 | `POST /issuing/cards/{id}/update` | 200 | – | `d9488f147e0e433a8cddaac24d87d5ee` | – | pass 1 stop.pull |
| 26 | 09:53:26.529 | 09:53:26.852 | 323 | `GET /issuing/cards/{id}` | 200 | – | `9a7e930d182d4b7b88ca11792f46bfd1` | INACTIVE | pass 1 stop.pull |
| 27 | 09:53:26.857 | 09:53:27.420 | 563 | `GET /issuing/cards/{id}` | 200 | – | `9c9fe583941843f88ef5f56723dba438` | ACTIVE | pass 1 stop.pull |
| 28 | 09:53:27.421 | 09:53:27.781 | 360 | `POST /issuing/cards/{id}/update` | 200 | – | `92e1aa0c8db74eb984ce3ebe3f6101c0` | – | pass 1 stop.pull |
| 29 | 09:53:27.783 | 09:53:28.191 | 408 | `GET /issuing/cards/{id}` | 200 | – | `3c2ed8ab31ac4ec29c5d2cd0765a68d6` | INACTIVE | pass 1 stop.pull |
| 30 | 09:53:28.216 | 09:53:28.519 | 303 | `GET /issuing/cards/{id}` | 200 | – | `17afc20cacf54c39a38a1f7345001e5d` | ACTIVE | pass 1 stop.pull |
| 31 | 09:53:28.521 | 09:53:28.893 | 372 | `POST /issuing/cards/{id}/update` | 200 | – | `b81a89fbee7640e5919d6a35cc46f088` | – | pass 1 stop.pull |
| 32 | 09:53:28.894 | 09:53:29.219 | 325 | `GET /issuing/cards/{id}` | 200 | – | `65a0d6606155457589cb160133c4f61b` | INACTIVE | pass 1 stop.pull |
| 33 | 09:53:29.250 | 09:53:32.044 | 2794 | `POST /simulation/issuing/create` | 201 | – | `0dd51cbd560a417cb509965f9864f45a` | auth DECLINED CARD_INACTIVE | pass 1 blocked.charge (sourcing) |
| 34 | 09:53:32.106 | 09:53:35.712 | 3606 | `POST /simulation/issuing/create` | 201 | – | `8aa7c8ccf44d4f33908c4dd768620d9d` | auth DECLINED CARD_INACTIVE | pass 1 blocked.charge (support) |
| 35 | 09:53:35.830 | 09:53:38.391 | 2561 | `POST /simulation/issuing/create` | 201 | – | `b8cd66dc3360400cb956f630081264bc` | auth DECLINED CARD_INACTIVE | pass 1 blocked.charge (treasury) |
| 36 | 09:53:38.428 | 09:53:38.763 | 335 | `GET /balances/current` | 200 | – | `5a88182dac584ec3b2a9147acc4d794d` | – | pass 1 blocked.payout (treasury) |
| 37 | 09:53:38.772 | 09:53:39.187 | 415 | `GET /transfers` | 200 | – | `a9b8b37ed7d84124a04219ad6a01a8ba` | – | pass 1 blocked.payout (treasury) |
| 38 | 09:53:39.297 | 09:53:39.610 | 313 | `GET /issuing/cards/{id}` | 200 | – | `d86121b24fb141f686181b7506f7a5c9` | INACTIVE | pass 1 lift.passkey |
| 39 | 09:53:39.612 | 09:53:39.975 | 363 | `POST /issuing/cards/{id}/update` | 200 | – | `7b4e6114cec14bd5819a9f6e4c3b1ca7` | – | pass 1 lift.passkey |
| 40 | 09:53:39.976 | 09:53:40.297 | 321 | `GET /issuing/cards/{id}` | 200 | – | `a9ef4dad3b174342a3d411fd30c72e2a` | ACTIVE | pass 1 lift.passkey |
| 41 | 09:53:40.300 | 09:53:40.623 | 323 | `GET /issuing/cards/{id}` | 200 | – | `80c39c0710a74a849d8e66943aad6aec` | INACTIVE | pass 1 lift.passkey |
| 42 | 09:53:40.624 | 09:53:40.999 | 375 | `POST /issuing/cards/{id}/update` | 200 | – | `9c5603c9551042c0b89d79a2cedf2ecd` | – | pass 1 lift.passkey |
| 43 | 09:53:41.000 | 09:53:41.309 | 309 | `GET /issuing/cards/{id}` | 200 | – | `f432f5afbda5401dadf2c7a52e8fcacd` | ACTIVE | pass 1 lift.passkey |
| 44 | 09:53:41.313 | 09:53:41.619 | 306 | `GET /issuing/cards/{id}` | 200 | – | `6cd31820d53f42d7b06c2b53fb967883` | INACTIVE | pass 1 lift.passkey |
| 45 | 09:53:41.639 | 09:53:42.016 | 377 | `POST /issuing/cards/{id}/update` | 200 | – | `1f488e7c703e458d999147c2b0788e5d` | – | pass 1 lift.passkey |
| 46 | 09:53:42.016 | 09:53:42.329 | 313 | `GET /issuing/cards/{id}` | 200 | – | `24147242f181405eafb573bc3b9d179a` | ACTIVE | pass 1 lift.passkey |
| 47 | 09:53:42.358 | 09:53:42.684 | 326 | `POST /issuing/cards/{id}/update` | 200 | – | `c7ad848b19934985b9f84d32e5b1567e` | – | pass 1 lift.purchase (sourcing) |
| 48 | 09:53:42.684 | 09:53:43.011 | 327 | `GET /issuing/cards/{id}` | 200 | – | `3b68c69e18044b87a924e352c1818141` | ACTIVE | pass 1 lift.purchase (sourcing) |
| 49 | 09:53:43.011 | 09:53:46.926 | 3915 | `POST /simulation/issuing/create` | 201 | – | `3b4f1248bf654b54bd5dedf52a4ce296` | auth APPROVED | pass 1 lift.purchase (sourcing) |
| 50 | 09:53:46.931 | 09:53:47.299 | 368 | `POST /issuing/cards/{id}/update` | 200 | – | `80239dbf46e44dbcb632c4c1cb4f9c64` | – | pass 1 lift.purchase (sourcing) |
| 51 | 09:53:47.300 | 09:53:47.622 | 322 | `GET /issuing/cards/{id}` | 200 | – | `6e8f4fbd363544959012d4e6a09c13b5` | INACTIVE | pass 1 lift.purchase (sourcing) |
| 52 | 09:53:47.645 | 09:53:47.994 | 349 | `POST /issuing/cards/{id}/update` | 200 | – | `480234035f4340039ec83c2670737bef` | – | pass 1 velocity.burst (treasury) |
| 53 | 09:53:47.995 | 09:53:48.327 | 332 | `GET /issuing/cards/{id}` | 200 | – | `352981a2f5fb4012b358d8dc9a8c90bc` | ACTIVE | pass 1 velocity.burst (treasury) |
| 54 | 09:53:48.328 | 09:53:50.909 | 2581 | `POST /simulation/issuing/create` | 201 | – | `894e6a1321bf493f8b2df2ec5d3167a2` | auth APPROVED | pass 1 velocity.burst (treasury) |
| 55 | 09:53:50.923 | 09:53:51.286 | 363 | `POST /issuing/cards/{id}/update` | 200 | – | `30026b51cac94d39bc0e17e308fb82c9` | – | pass 1 velocity.burst (treasury) |
| 56 | 09:53:51.289 | 09:53:51.614 | 325 | `GET /issuing/cards/{id}` | 200 | – | `2f748c511ee94726935c89ba712511d2` | INACTIVE | pass 1 velocity.burst (treasury) |
| 57 | 09:53:51.668 | 09:53:52.045 | 377 | `POST /issuing/cards/{id}/update` | 200 | – | `c0e9e3f7bc0c4ae195aa088c6fa987a3` | – | pass 1 velocity.burst (treasury) |
| 58 | 09:53:52.057 | 09:53:52.389 | 332 | `GET /issuing/cards/{id}` | 200 | – | `bcfa3aaba51c47b69f5af354d9ef777e` | ACTIVE | pass 1 velocity.burst (treasury) |
| 59 | 09:53:52.410 | 09:53:55.193 | 2797 | `POST /simulation/issuing/create` | 201 | – | `b601e92270cd468a80f2fcc4fd33f4ae` | auth APPROVED | pass 1 velocity.burst (treasury) |
| 60 | 09:53:59.374 | 09:53:59.770 | 396 | `POST /issuing/cards/{id}/update` | 200 | – | `d85aaefca2084713b92e41e0ff04ce5c` | – | pass 1 velocity.burst (treasury) |
| 61 | 09:53:59.775 | 09:54:00.107 | 332 | `GET /issuing/cards/{id}` | 200 | – | `5f9ee6dd35af495fa05c87957a72383c` | INACTIVE | pass 1 velocity.burst (treasury) |
| 62 | 09:54:00.167 | 09:54:00.546 | 379 | `POST /issuing/cards/{id}/update` | 200 | – | `30475723e03a41469d9159c28393d835` | – | pass 1 velocity.burst (treasury) |
| 63 | 09:54:00.547 | 09:54:00.859 | 312 | `GET /issuing/cards/{id}` | 200 | – | `5bf95dab406a4ab38618f92815cf1338` | ACTIVE | pass 1 velocity.burst (treasury) |
| 64 | 09:54:00.860 | 09:54:04.459 | 3599 | `POST /simulation/issuing/create` | 201 | – | `7a19f2d7c84c4340b0d0aae7656f26d2` | auth APPROVED | pass 1 velocity.burst (treasury) |
| 65 | 09:54:04.467 | 09:54:04.842 | 375 | `POST /issuing/cards/{id}/update` | 200 | – | `0b9d420889c34419bf51ffe3b8868763` | – | pass 1 velocity.burst (treasury) |
| 66 | 09:54:04.851 | 09:54:05.166 | 315 | `GET /issuing/cards/{id}` | 200 | – | `dddfeb5a4bf5424ebbab5bcc8fb1ee8c` | INACTIVE | pass 1 velocity.burst (treasury) |
| 67 | 09:54:05.216 | 09:54:05.627 | 411 | `POST /issuing/cards/{id}/update` | 200 | – | `01dbb56f247c48f0b74b01f036b26c92` | – | pass 1 velocity.burst (treasury) |
| 68 | 09:54:05.628 | 09:54:05.950 | 322 | `GET /issuing/cards/{id}` | 200 | – | `f9952c842543468cb9798d072566f17d` | ACTIVE | pass 1 velocity.burst (treasury) |
| 69 | 09:54:05.951 | 09:54:09.663 | 3712 | `POST /simulation/issuing/create` | 201 | – | `21852a05d4d148b99cf898e94fb9c496` | auth APPROVED | pass 1 velocity.burst (treasury) |
| 70 | 09:54:09.665 | 09:54:10.278 | 613 | `POST /issuing/cards/{id}/update` | 200 | – | `d851af0abd5d4086b92c7f449a846a7c` | – | pass 1 velocity.burst (treasury) |
| 71 | 09:54:10.279 | 09:54:10.609 | 330 | `GET /issuing/cards/{id}` | 200 | – | `ff7cab52cdad4ea7ba83a3573c2282f1` | INACTIVE | pass 1 velocity.burst (treasury) |
| 72 | 09:54:10.645 | 09:54:11.025 | 380 | `POST /issuing/cards/{id}/update` | 200 | – | `b99fe07a9e4b45e4bdbe42809f8970c5` | – | pass 1 velocity.burst (treasury) |
| 73 | 09:54:11.026 | 09:54:11.346 | 320 | `GET /issuing/cards/{id}` | 200 | – | `d0167d92169f48ddb48c2a93f35e58e8` | ACTIVE | pass 1 velocity.burst (treasury) |
| 74 | 09:54:11.351 | 09:54:14.305 | 2954 | `POST /simulation/issuing/create` | 201 | – | `f16535e29db84109bfaab8ac7fcbcc6e` | auth APPROVED | pass 1 velocity.burst (treasury) |
| 75 | 09:54:14.307 | 09:54:14.681 | 374 | `POST /issuing/cards/{id}/update` | 200 | – | `dda2503bfce14243bc8364f0bf31925b` | – | pass 1 velocity.burst (treasury) |
| 76 | 09:54:14.682 | 09:54:15.001 | 319 | `GET /issuing/cards/{id}` | 200 | – | `2196198e32f7478495496252f40370d3` | INACTIVE | pass 1 velocity.burst (treasury) |
| 77 | 09:54:15.032 | 09:54:15.400 | 368 | `POST /issuing/cards/{id}/update` | 200 | – | `0a6892ef105d48b3bb567997959548b0` | – | pass 1 velocity.burst (treasury) |
| 78 | 09:54:15.401 | 09:54:15.724 | 323 | `GET /issuing/cards/{id}` | 200 | – | `527e0a99648c48edbe01a9e29cff2708` | ACTIVE | pass 1 velocity.burst (treasury) |
| 79 | 09:54:15.727 | 09:54:19.651 | 3924 | `POST /simulation/issuing/create` | 201 | – | `74ac1ba22c684695a57a1f690e6aaed0` | auth APPROVED | pass 1 velocity.burst (treasury) |
| 80 | 09:54:19.654 | 09:54:20.062 | 408 | `POST /issuing/cards/{id}/update` | 200 | – | `f91f43ee61d447878b1f448d488c0d02` | – | pass 1 velocity.burst (treasury) |
| 81 | 09:54:20.063 | 09:54:20.390 | 327 | `GET /issuing/cards/{id}` | 200 | – | `f611f22b16b746a9b68427f5beea8cac` | INACTIVE | pass 1 velocity.burst (treasury) |
| 82 | 09:54:20.400 | 09:54:20.715 | 315 | `GET /issuing/cards/{id}` | 200 | – | `4f01a94a6903419a87f33279436869ee` | INACTIVE | pass 1 velocity.card (treasury) |
| 83 | 09:54:20.716 | 09:54:21.802 | 1087 | `POST /simulation/issuing/create` | 400 bad_request | – | `1d1b94c7d1d94fd1ad16e41de085bdec` | – | pass 1 velocity.card (treasury) |
| 84 | 10:07:35.780 | 10:07:36.545 | 765 | `POST /authentication/login` | 201 | – | `d5766590494748169ecd70c865dea9c7` | – | pass 2 setup.cards |
| 85 | 10:07:36.548 | 10:07:37.139 | 591 | `GET /issuing/cards/{id}` | 200 | – | `ecf1715f5e68436bbe047a9e014060b9` | INACTIVE | pass 2 setup.cards |
| 86 | 10:07:37.207 | 10:07:37.534 | 327 | `GET /issuing/cards/{id}` | 200 | – | `2c8484166d5449f899e8e193ebca04fd` | INACTIVE | pass 2 setup.cards |
| 87 | 10:07:37.560 | 10:07:37.876 | 316 | `GET /issuing/cards/{id}` | 200 | – | `453a50c130d44cd49da9392164e071d2` | INACTIVE | pass 2 setup.cards |
| 88 | 10:07:38.006 | 10:07:38.332 | 326 | `GET /issuing/cards/{id}` | 200 | – | `ee40fb34c68c492e9b0d598416dc6e84` | INACTIVE | pass 2 velocity.card (treasury) |
| 89 | 10:07:38.333 | 10:07:41.380 | 3048 | `POST /simulation/issuing/create` | 201 | – | `f14dc8652d924233aba1e461910a299f` | auth DECLINED CARD_INACTIVE | pass 2 velocity.card (treasury) |
| 90 | 10:07:41.458 | 10:07:41.827 | 369 | `POST /issuing/cards/{id}/update` | 200 | – | `de226c627ae84dc4aa24217406cd8311` | – | pass 2 velocity.others (support) |
| 91 | 10:07:41.828 | 10:07:42.159 | 331 | `GET /issuing/cards/{id}` | 200 | – | `04366a27925a46c184c7f582ffeb13fa` | ACTIVE | pass 2 velocity.others (support) |
| 92 | 10:07:42.160 | 10:07:44.785 | 2625 | `POST /simulation/issuing/create` | 201 | – | `35554836eee84869ab3852468435b4c2` | auth APPROVED | pass 2 velocity.others (support) |
| 93 | 10:07:44.789 | 10:07:45.183 | 394 | `POST /issuing/cards/{id}/update` | 200 | – | `731656e00b4743a2a2c3a3614bb61e19` | – | pass 2 velocity.others (support) |
| 94 | 10:07:45.184 | 10:07:45.580 | 396 | `GET /issuing/cards/{id}` | 200 | – | `568e40055dd64cd690c81a8fe78fac55` | INACTIVE | pass 2 velocity.others (support) |
| 95 | 10:07:45.918 | 10:07:46.298 | 380 | `POST /issuing/cards/{id}/update` | 200 | – | `5254f9c7b85344088a84612fc23ebcaf` | – | pass 2 velocity.lift_passkey (treasury) |
| 96 | 10:07:46.299 | 10:07:46.609 | 310 | `GET /issuing/cards/{id}` | 200 | – | `abd4fc6bc3b94b13bbcddcc3853c73d2` | ACTIVE | pass 2 velocity.lift_passkey (treasury) |
| 97 | 10:07:46.611 | 10:07:49.227 | 2616 | `POST /simulation/issuing/create` | 201 | – | `e36d0f9fbcd14355a79124eba082e2c1` | auth APPROVED | pass 2 velocity.lift_passkey (treasury) |
| 98 | 10:07:49.229 | 10:07:49.615 | 386 | `POST /issuing/cards/{id}/update` | 200 | – | `b6b66acf62b44f618a60d6e3c9f764bd` | – | pass 2 velocity.lift_passkey (treasury) |
| 99 | 10:07:49.616 | 10:07:49.926 | 310 | `GET /issuing/cards/{id}` | 200 | – | `c2eefc6c494a4fe1bdb71305b35f6add` | INACTIVE | pass 2 velocity.lift_passkey (treasury) |
| 100 | 10:07:56.456 | 10:07:57.323 | 867 | `POST /authentication/login` | 201 | – | `2894af21af7c486aa27fbc46c3ab13d2` | – | pass 3 setup.cards |
| 101 | 10:07:57.338 | 10:07:57.739 | 401 | `GET /issuing/cards/{id}` | 200 | – | `dc2d4adad5e54e92a7320c263787f429` | INACTIVE | pass 3 setup.cards |
| 102 | 10:07:57.803 | 10:07:58.135 | 332 | `GET /issuing/cards/{id}` | 200 | – | `d87380f5a0134252b5dbbfe8fa5011b8` | INACTIVE | pass 3 setup.cards |
| 103 | 10:07:58.161 | 10:07:58.478 | 317 | `GET /issuing/cards/{id}` | 200 | – | `df52a6f96f0d496eb516eab9fb20de2b` | INACTIVE | pass 3 setup.cards |
| 104 | 10:07:58.545 | 10:07:58.918 | 373 | `POST /issuing/cards/{id}/update` | 200 | – | `ae21782c0355402d9f865cb2cb9aa693` | – | pass 3 setup.windows |
| 105 | 10:07:58.919 | 10:07:59.323 | 404 | `GET /issuing/cards/{id}` | 200 | – | `316bcbfbffe04464989427dd2537ec00` | ACTIVE | pass 3 setup.windows |
| 106 | 10:07:59.326 | 10:07:59.695 | 369 | `POST /issuing/cards/{id}/update` | 200 | – | `de9bb8550f4d48b98a8e8a2db48814f2` | – | pass 3 setup.windows |
| 107 | 10:07:59.696 | 10:08:00.093 | 397 | `GET /issuing/cards/{id}` | 200 | – | `df74b137c0e0449a89b14b7870b844e4` | ACTIVE | pass 3 setup.windows |
| 108 | 10:08:00.097 | 10:08:00.503 | 406 | `POST /issuing/cards/{id}/update` | 200 | – | `a944d65af74a427b8b1119b0d61f54bd` | – | pass 3 setup.windows |
| 109 | 10:08:00.504 | 10:08:00.829 | 325 | `GET /issuing/cards/{id}` | 200 | – | `77a404686bef4409a38fd5ac87e44301` | ACTIVE | pass 3 setup.windows |
| 110 | 10:08:00.951 | 10:08:01.270 | 319 | `GET /issuing/cards/{id}` | 200 | – | `63e323289bf9438b8fe309cd1c336c23` | ACTIVE | pass 3 stop.pull |
| 111 | 10:08:01.272 | 10:08:01.716 | 444 | `POST /issuing/cards/{id}/update` | 200 | – | `7a22fed1be014daabe4b228402079d4c` | – | pass 3 stop.pull |
| 112 | 10:08:01.717 | 10:08:02.029 | 312 | `GET /issuing/cards/{id}` | 200 | – | `13b888a6fd5144f39947e10a018de443` | INACTIVE | pass 3 stop.pull |
| 113 | 10:08:02.033 | 10:08:02.443 | 410 | `GET /issuing/cards/{id}` | 200 | – | `39d3d301ba2d42a2b8b967cb9c28d7ae` | ACTIVE | pass 3 stop.pull |
| 114 | 10:08:02.444 | 10:08:02.878 | 434 | `POST /issuing/cards/{id}/update` | 200 | – | `c1e6d0ec23fe4aa69d8f7d3a680722c0` | – | pass 3 stop.pull |
| 115 | 10:08:02.878 | 10:08:03.191 | 313 | `GET /issuing/cards/{id}` | 200 | – | `54a5987fbaca4aea93b7d84a0ba54c59` | INACTIVE | pass 3 stop.pull |
| 116 | 10:08:03.201 | 10:08:03.524 | 323 | `GET /issuing/cards/{id}` | 200 | – | `64a2b6f6982d452495791fda4fa60d48` | ACTIVE | pass 3 stop.pull |
| 117 | 10:08:03.525 | 10:08:03.880 | 355 | `POST /issuing/cards/{id}/update` | 200 | – | `5f7c05cec84b4a7aac878ce2c7ca3878` | – | pass 3 stop.pull |
| 118 | 10:08:03.881 | 10:08:04.189 | 308 | `GET /issuing/cards/{id}` | 200 | – | `86be3ebdb37e426c8f19f2ad01038088` | INACTIVE | pass 3 stop.pull |
| 119 | 10:08:04.197 | 10:08:08.156 | 3959 | `POST /simulation/issuing/create` | 201 | – | `6c596a252b62475c951ff115edc0f01a` | auth DECLINED CARD_INACTIVE | pass 3 blocked.charge (sourcing) |
| 120 | 10:08:08.195 | 10:08:10.839 | 2644 | `POST /simulation/issuing/create` | 201 | – | `57efe2b3400e42638ae534389b115fa5` | auth DECLINED CARD_INACTIVE | pass 3 blocked.charge (support) |
| 121 | 10:08:10.871 | 10:08:13.521 | 2650 | `POST /simulation/issuing/create` | 201 | – | `de0d9113b5da45a7af2c08c9945e5d75` | auth DECLINED CARD_INACTIVE | pass 3 blocked.charge (treasury) |
| 122 | 10:08:13.864 | 10:08:14.243 | 379 | `POST /issuing/cards/{id}/update` | 200 | – | `754eb31681b44029bf19ae6fc9376d9e` | – | pass 3 lift.purchase (sourcing) |
| 123 | 10:08:14.244 | 10:08:14.562 | 318 | `GET /issuing/cards/{id}` | 200 | – | `dd61fe188b60422db31c7579a7b85e76` | ACTIVE | pass 3 lift.purchase (sourcing) |
| 124 | 10:08:14.564 | 10:08:18.367 | 3803 | `POST /simulation/issuing/create` | 201 | – | `26dedc76ba434e179af92b2955d54c64` | auth APPROVED | pass 3 lift.purchase (sourcing) |
| 125 | 10:08:18.369 | 10:08:18.731 | 362 | `POST /issuing/cards/{id}/update` | 200 | – | `4e6095e73b1646dd892843ef5718b574` | – | pass 3 lift.purchase (sourcing) |
| 126 | 10:08:18.733 | 10:08:19.063 | 330 | `GET /issuing/cards/{id}` | 200 | – | `0b56a6261d8b4cddbb63f391cee18fec` | INACTIVE | pass 3 lift.purchase (sourcing) |

Calls by endpoint: `POST /authentication/login` 3, `GET /issuing/cardholders` 3, `GET /issuing/cards` 6, `GET /issuing/cards/{id}` 56, `POST /issuing/cards/{id}/update` 36, `GET /beneficiaries` 1, `GET /balances/current` 2, `POST /simulation/issuing/create` 18, `GET /transfers` 1.

## What this does not show

- Alta (on chain): an agent payment on Alta is refused by Purser's own check before signing (purserRefusal); nothing was sent to Alta in this drill, and the on-chain mandate is not revoked by the emergency stop (that is the pause, `npm run pause`).
- A person's Face ID on a real phone, and the relay between the phone and the runner.
- The runner's every-few-seconds sync and the autonomous agents' processes: the drill calls the same code once, in order.
- One run: the times are single measurements.
