# Card drill: 2026-11-20

`npm run airwallex:card-drill -- live`. Agent cards frozen by default, checked against Airwallex: freeze, thaw, authorise, refreeze, per card, timed; the race inside a purchase window; a process killed between thaw and refreeze; duplicate and late webhooks. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `5d9bd3da29b4` (each pass says what it ran on). The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-20-card-drill.json.

**37 of 54 steps passed, 11 failed, 6 not judged** (measurements, or not supported by the sandbox). 115 Airwallex calls of a budget of 200 (the drill's hard limit: 200; logins included), one at a time, at least 200 ms apart; 0 answered 429; 1 unexpected non-2xx.

## In short

- Update sent to Airwallex until the new status read back: freeze pass 1 sourcing 892 ms, pass 1 support 625 ms, pass 1 treasury 613 ms, pass 2 support 810 ms, pass 3 support 777 ms; thaw pass 1 sourcing 915 ms, pass 1 support 705 ms, pass 1 treasury 909 ms, pass 3 support 685 ms; refreeze pass 1 sourcing 878 ms, pass 1 support 657 ms, pass 1 treasury 754 ms, pass 3 support 694 ms.
- Charges on a frozen card (before the thaw, and right after the refreeze was read back): 8 of 8 declined CARD_INACTIVE; 1 not judged (the sandbox refused to simulate).
- A second authorisation inside the purchase window, while the card was thawed for the purchase: pass 1 sourcing APPROVED, pass 1 support APPROVED (same amount as the purchase), pass 1 treasury APPROVED, pass 3 support APPROVED (same amount as the purchase). Airwallex judges a thawed card on its limits and merchant categories only; Purser can only find such a charge afterwards (detection below).
- Purser's own purchase path (chargeInWindow) kept the card thawed for 4043 ms (thaw sent until the refreeze read back).
- Crash k1 (killed after the thaw was recorded): pass 1 kill pass, tick FAIL, recover FAIL, charge FAIL; pass 3 kill pass, tick measured, recover pass, charge pass.
- Crash k2 (killed the moment Airwallex answered the thaw, before the ledger heard): pass 1 kill pass, tick FAIL, recover FAIL, charge FAIL; pass 3 kill pass, tick measured, recover pass, charge pass.
- Detection by the poll, pass 1 FAIL: 11 new from the poll (4 recorded before); second authorisations flagged: sourcing yes, support NO (same amount as the purchase), treasury yes.
- Detection by the poll, pass 3 pass: 16 new from the poll (16 recorded before); second authorisations flagged: support yes (same amount as the purchase).
- Webhook replay (local), pass 1 not judged: VOID (the drill's log kept the simulation answers without their date, so the replayed events were malformed (see the pass's note); re-run in pass 3). Seen: 45 deliveries of 15 authorisations: 0 new ledger row(s), 0 new alarm(s), 0 new approval and 0 new decline record(s); 15 answered "already recorded".
- Webhook replay (local), pass 3 pass: 18 deliveries of 6 authorisations (15 logged without their date left out): 0 new ledger row(s), 0 new alarm(s), 0 new approval and 0 new decline record(s); 18 answered "already recorded".

## Simulated, and how

- Every merchant charge is the sandbox's simulation endpoint (`POST /simulation/issuing/create`): no merchant charged anything. The approve or decline is Airwallex's own, on the card's status, limits and merchant categories.
- The crash is a SIGKILL the child process sends itself at the point the drill chose (after the thaw was recorded; or the moment Airwallex answered the thaw, before the ledger heard of it). The restart is the runner's own card code run by the drill, not a restarted runner process.
- Duplicate and late webhooks are replayed locally: built from this run's own simulation answers (whitelisted fields only) and signed with a local test secret. Airwallex sent none of them; the sandbox has no endpoint that replays an event.
- No passkey signs anything in this drill, and no money other than the agents' cards' test balance moves.

## The cards

| Agent | Card id | Last 4 | Nickname at Airwallex |
|---|---|---|---|
| sourcing | `29c779e4-907b-43e5-b420-2f5cffc1ac58` | 6051 | sourcing agent: warehouse and data software (card-drill) |
| support | `71fa14e1-42be-4da3-9329-cdc15f2b5f65` | 2361 | support agent: helpdesk software (card-drill) |
| treasury | `8743bc4c-8d29-4c72-9f4b-fbe37e7cb830` | 4577 | treasury agent: bookkeeping (card-drill) |

## Pass 1 (09:46:22.389–09:51:52.379 UTC)

The card code as on origin/main (f667d16), with the drill beside it: no card recovery at the runner's start, the thaw written to the ledger only after Airwallex answered it, and a purchase window taken by any authorisation of its amount. **This pass's webhook replay is void:** the drill's log kept each simulation answer without its date (`transacted_at`), so the 30 replayed events under a new id were refused by the hook handler as malformed (no row, no alarm) and only the 15 repeats of an id were answered "already recorded". The log was fixed and the replay re-run in pass 3.

Code under test: `recover_card_windows` false, `thaw_marked_before_call` false.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.cards` Issue or adopt the three agents' drill cards and bring them to the policy | – | every card INACTIVE at Airwallex, limits and merchant categories as the policy | sourcing ••6051 INACTIVE, support ••2361 INACTIVE, treasury ••4577 INACTIVE | **pass** | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 | 9314 |
| 2 | `cycle.freeze` Freeze the card (status INACTIVE) | sourcing | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 892 ms | **pass** | 20, 21 | 895 |
| 3 | `cycle.charge_frozen` A merchant charges the frozen card (EUR 1.01) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 22 | 2806 |
| 4 | `cycle.thaw` Purser opens a purchase window (openCardWindow: thaw) | sourcing | Airwallex reads the card back ACTIVE | read back ACTIVE; update to read-back 915 ms | **pass** | 23, 24 | 918 |
| 5 | `cycle.auth_purchase` The approved purchase's authorisation (EUR 1.00) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | approved | approved (APPROVED) | **pass** | 25 | 3988 |
| 6 | `cycle.auth_in_window` A second authorisation inside the same window (EUR 1.37, another amount, another merchant) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | declined (the brief's expectation) | approved (APPROVED): the race is real at Airwallex; the card is thawed for any charge within its limits | **FAIL** | 26 | 2536 |
| 7 | `cycle.refreeze` Purser closes the window (closeCardWindow: refreeze) | sourcing | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 878 ms | **pass** | 27, 28 | 882 |
| 8 | `cycle.charge_after_refreeze` A merchant charges right after the refreeze was read back (EUR 1.02) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 29 | 2648 |
| 9 | `cycle.freeze` Freeze the card (status INACTIVE) | support | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 625 ms | **pass** | 30, 31 | 626 |
| 10 | `cycle.charge_frozen` A merchant charges the frozen card (EUR 1.01) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 32 | 2596 |
| 11 | `cycle.thaw` Purser opens a purchase window (openCardWindow: thaw) | support | Airwallex reads the card back ACTIVE | read back ACTIVE; update to read-back 705 ms | **pass** | 33, 34 | 708 |
| 12 | `cycle.auth_purchase` The approved purchase's authorisation (EUR 1.00) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | approved | approved (APPROVED) | **pass** | 35 | 3647 |
| 13 | `cycle.auth_in_window` A second authorisation inside the same window (EUR 1.00, the purchase's own amount, another merchant) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined (the brief's expectation) | approved (APPROVED): the race is real at Airwallex; the card is thawed for any charge within its limits | **FAIL** | 36 | 2514 |
| 14 | `cycle.refreeze` Purser closes the window (closeCardWindow: refreeze) | support | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 657 ms | **pass** | 37, 38 | 661 |
| 15 | `cycle.charge_after_refreeze` A merchant charges right after the refreeze was read back (EUR 1.02) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 39 | 2481 |
| 16 | `cycle.freeze` Freeze the card (status INACTIVE) | treasury | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 613 ms | **pass** | 40, 41 | 618 |
| 17 | `cycle.charge_frozen` A merchant charges the frozen card (EUR 1.01) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 42 | 3541 |
| 18 | `cycle.thaw` Purser opens a purchase window (openCardWindow: thaw) | treasury | Airwallex reads the card back ACTIVE | read back ACTIVE; update to read-back 909 ms | **pass** | 43, 44 | 914 |
| 19 | `cycle.auth_purchase` The approved purchase's authorisation (EUR 1.00) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | approved | approved (APPROVED) | **pass** | 45 | 3659 |
| 20 | `cycle.auth_in_window` A second authorisation inside the same window (EUR 0.73, another amount, another merchant) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | declined (the brief's expectation) | approved (APPROVED): the race is real at Airwallex; the card is thawed for any charge within its limits | **FAIL** | 46 | 3549 |
| 21 | `cycle.refreeze` Purser closes the window (closeCardWindow: refreeze) | treasury | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 754 ms | **pass** | 47, 48 | 757 |
| 22 | `cycle.charge_after_refreeze` A merchant charges right after the refreeze was read back (EUR 1.02) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 49 | 3654 |
| 23 | `purchase.window` Purser's purchase path (chargeInWindow): thaw, charge EUR 1.11, refreeze *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | approved; the card INACTIVE again; the window's length measured | approved (APPROVED); card INACTIVE; thawed for 4043 ms (thaw sent to refreeze read back) | **pass** | 50, 51, 52, 53, 54 | 4062 |
| 24 | `crash.k1.kill` Killed after the thaw was answered and recorded, before the charge and the refreeze *(simulated: the kill is a SIGKILL the child process sends itself at the point the drill chose)* | treasury | the child ends by SIGKILL with the card thawed at Airwallex | child ended by SIGKILL; Airwallex reads the card ACTIVE; ledger says ACTIVE | **pass** | 55, 56, 57, 58 | 5587 |
| 25 | `crash.k1.tick` Restart: the runner's every-few-seconds card check (syncCardsIfChanged) | treasury | the card frozen at Airwallex | changed nothing; Airwallex reads the card ACTIVE | **FAIL** | 59 | 420 |
| 26 | `crash.k1.recover` Restart: the runner's start-up card recovery (recoverCardWindows) | treasury | the card frozen at Airwallex at the restart | no start-up card recovery in the runner at this commit | **FAIL** | 0 | 0 |
| 27 | `crash.k1.charge` A merchant charges the card after the restart (EUR 1.03) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | declined CARD_INACTIVE | approved (APPROVED) | **FAIL** | 60 | 3681 |
| 28 | `crash.k2.kill` Killed the moment Airwallex answered the thaw, before the ledger recorded it; restarted after the window would have run out *(simulated: the kill is a SIGKILL the child process sends itself at the point the drill chose)* | support | the child ends by SIGKILL with the card thawed at Airwallex | child ended by SIGKILL; Airwallex reads the card ACTIVE; ledger says INACTIVE | **pass** | 61, 62, 63, 64 | 4858 |
| 29 | `crash.k2.tick` Restart: the runner's every-few-seconds card check (syncCardsIfChanged) | support | the card frozen at Airwallex | changed treasury; Airwallex reads the card ACTIVE | **FAIL** | 65, 66, 67, 68 | 1906 |
| 30 | `crash.k2.recover` Restart: the runner's start-up card recovery (recoverCardWindows) | support | the card frozen at Airwallex at the restart | no start-up card recovery in the runner at this commit | **FAIL** | 0 | 1 |
| 31 | `crash.k2.charge` A merchant charges the card after the restart (EUR 1.03) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined CARD_INACTIVE | approved (APPROVED) | **FAIL** | 69 | 3563 |
| 32 | `detect.poll` The poll reads every card's transactions; each authorisation inside a window that Purser did not start must raise card.unexpected_authorization | – | each second authorisation flagged; the purchases not flagged | 11 new from the poll (4 recorded before); second authorisations flagged: sourcing yes, support NO (same amount as the purchase), treasury yes | **FAIL** | 70, 71, 72 | 1507 |
| 33 | `webhooks.sandbox_replay` Ask the sandbox to deliver an event twice, or late | – | the sandbox replays an event | not supported by the sandbox: Airwallex's API has no endpoint that replays or resends a webhook event, and this run has no public webhook receiver; not attempted live | not judged | 0 | 1 |
| 34 | `webhooks.local_replay` Duplicate and late card-transaction webhooks, replayed locally from this run's own sandbox answers *(simulated: replayed locally: the events are built from this run's own simulation answers (whitelisted fields) and signed with a local test secret; Airwallex sent none of them)* | – | no second ledger row, no second alarm, no change to an earlier decision | VOID (the drill's log kept the simulation answers without their date, so the replayed events were malformed (see the pass's note); re-run in pass 3). Seen: 45 deliveries of 15 authorisations: 0 new ledger row(s), 0 new alarm(s), 0 new approval and 0 new decline record(s); 15 answered "already recorded" | not judged | 0 | 29 |

## Pass 2 (10:00:11.580–10:00:23.076 UTC)

After the three fixes (src/policy/cards.ts: recoverCardWindows at the runner's start, the thaw written to the ledger before it is sent, a window expects one authorisation): a re-run of the support card's cycle, the crash, the poll and the webhooks. **Stopped at its second step:** the sandbox's simulation answered HTTP 400 bad_request "failed to process transaction" after 9.6 s to a charge on the frozen card (the stop drill had met an HTTP 400 on the same endpoint at 09:54 UTC). The drill halts on any unexpected 4xx, so nothing else was sent.

Code under test: `recover_card_windows` true, `thaw_marked_before_call` true.

**Stopped:** cycle.charge_frozen: an unexpected HTTP 400 bad_request on POST /simulation/issuing/create (line 76)

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `cycle.freeze` Freeze the card (status INACTIVE) | support | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 810 ms | **pass** | 73, 74, 75 | 1735 |
| 2 | `cycle.charge_frozen` A merchant charges the frozen card (EUR 1.01) | support | declined CARD_INACTIVE | the sandbox refused to simulate the charge (HTTP 400 bad_request): neither approved nor declined, nothing to judge. error: Airwallex /simulation/issuing/create -> 400 bad_request (trace 8f2f4c4a8d1b439bbc7194404d12c5d9) | not judged | 76 | 9579 |

## Pass 3 (10:02:19.171–10:07:13.656 UTC)

The same re-run, two minutes later. From this pass the drill records up to 4 such refusals of the sandbox's simulation in the run's log as "nothing to judge" instead of halting; none occurred. The freeze latencies of passes 2 and 3 are taken from the request log when this record was written: the drill had measured them from the process's login, which that step needed first.

Code under test: `recover_card_windows` true, `thaw_marked_before_call` true.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `cycle.freeze` Freeze the card (status INACTIVE) | support | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 777 ms | **pass** | 77, 78, 79 | 1607 |
| 2 | `cycle.charge_frozen` A merchant charges the frozen card (EUR 1.01) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 80 | 3801 |
| 3 | `cycle.thaw` Purser opens a purchase window (openCardWindow: thaw) | support | Airwallex reads the card back ACTIVE | read back ACTIVE; update to read-back 685 ms | **pass** | 81, 82 | 713 |
| 4 | `cycle.auth_purchase` The approved purchase's authorisation (EUR 1.00) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | approved | approved (APPROVED) | **pass** | 83 | 2909 |
| 5 | `cycle.auth_in_window` A second authorisation inside the same window (EUR 1.00, the purchase's own amount, another merchant) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined (the brief's expectation) | approved (APPROVED): the race is real at Airwallex; the card is thawed for any charge within its limits | **FAIL** | 84 | 3611 |
| 6 | `cycle.refreeze` Purser closes the window (closeCardWindow: refreeze) | support | Airwallex reads the card back INACTIVE | read back INACTIVE; update to read-back 694 ms | **pass** | 85, 86 | 708 |
| 7 | `cycle.charge_after_refreeze` A merchant charges right after the refreeze was read back (EUR 1.02) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 87 | 2523 |
| 8 | `crash.k1.kill` Killed after the thaw was answered and recorded, before the charge and the refreeze *(simulated: the kill is a SIGKILL the child process sends itself at the point the drill chose)* | treasury | the child ends by SIGKILL with the card thawed at Airwallex | child ended by SIGKILL; Airwallex reads the card ACTIVE; ledger says ACTIVE | **pass** | 88, 89, 90, 91 | 6477 |
| 9 | `crash.k1.tick` Restart: the runner's every-few-seconds card check (syncCardsIfChanged) | treasury | measured only: the restart's own step is the recovery below | changed nothing; Airwallex reads the card ACTIVE | not judged | 92 | 621 |
| 10 | `crash.k1.recover` Restart: the runner's start-up card recovery (recoverCardWindows) | treasury | the card frozen at Airwallex at the restart | closed treasury; synced treasury; Airwallex reads the card INACTIVE; recovery took 1769 ms | **pass** | 93, 94, 95, 96, 97, 98 | 2093 |
| 11 | `crash.k1.charge` A merchant charges the card after the restart (EUR 1.03) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | treasury | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 99 | 3684 |
| 12 | `crash.k2.kill` Killed the moment Airwallex answered the thaw, before the ledger recorded it; restarted after the window would have run out *(simulated: the kill is a SIGKILL the child process sends itself at the point the drill chose)* | support | the child ends by SIGKILL with the card thawed at Airwallex | child ended by SIGKILL; Airwallex reads the card ACTIVE; ledger says ACTIVE | **pass** | 100, 101, 102, 103 | 6400 |
| 13 | `crash.k2.tick` Restart: the runner's every-few-seconds card check (syncCardsIfChanged) | support | measured only: the restart's own step is the recovery below | changed support; Airwallex reads the card INACTIVE | not judged | 104, 105, 106, 107 | 1574 |
| 14 | `crash.k2.recover` Restart: the runner's start-up card recovery (recoverCardWindows) | support | the card frozen at Airwallex at the restart | closed no window; synced nothing; Airwallex reads the card INACTIVE; recovery took 1046 ms | **pass** | 108, 109, 110, 111 | 1393 |
| 15 | `crash.k2.charge` A merchant charges the card after the restart (EUR 1.03) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | support | declined CARD_INACTIVE | declined CARD_INACTIVE | **pass** | 112 | 3806 |
| 16 | `detect.poll` The poll reads every card's transactions; each authorisation inside a window that Purser did not start must raise card.unexpected_authorization | – | each second authorisation flagged; the purchases not flagged | 16 new from the poll (16 recorded before); second authorisations flagged: support yes (same amount as the purchase) | **pass** | 113, 114, 115 | 2144 |
| 17 | `webhooks.sandbox_replay` Ask the sandbox to deliver an event twice, or late | – | the sandbox replays an event | not supported by the sandbox: Airwallex's API has no endpoint that replays or resends a webhook event, and this run has no public webhook receiver; not attempted live | not judged | 0 | 0 |
| 18 | `webhooks.local_replay` Duplicate and late card-transaction webhooks, replayed locally from this run's own sandbox answers *(simulated: replayed locally: the events are built from this run's own simulation answers (whitelisted fields) and signed with a local test secret; Airwallex sent none of them)* | – | no second ledger row, no second alarm, no change to an earlier decision | 18 deliveries of 6 authorisations (15 logged without their date left out): 0 new ledger row(s), 0 new alarm(s), 0 new approval and 0 new decline record(s); 18 answered "already recorded" | **pass** | 0 | 20 |

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 09:46:22.391 | 09:46:23.096 | 705 | `POST /authentication/login` | 201 | – | `14f8a65a07504a6a8b8cba10bfa5e8c7` | – | pass 1 setup.cards |
| 2 | 09:46:23.103 | 09:46:23.515 | 412 | `GET /issuing/cardholders` | 200 | – | `eaebf9687d694bf792f9ea54c3bd591e` | – | pass 1 setup.cards |
| 3 | 09:46:23.516 | 09:46:23.864 | 348 | `GET /issuing/cards` | 200 | – | `c815943fb0ff435e9c2aa3445de5bb9f` | – | pass 1 setup.cards |
| 4 | 09:46:24.107 | 09:46:24.495 | 388 | `GET /issuing/cards` | 200 | – | `f9547b5f051d4473a40da28aeda1184a` | – | pass 1 setup.cards |
| 5 | 09:46:24.498 | 09:46:25.211 | 713 | `POST /issuing/cards/create` | 202 | – | `dfd97f58522e4b77ba0f6db336eae08b` | – | pass 1 setup.cards |
| 6 | 09:46:25.223 | 09:46:25.585 | 362 | `POST /issuing/cards/{id}/update` | 200 | – | `72c7bd2bce554ee982fe2c6f9cbc0fd6` | – | pass 1 setup.cards |
| 7 | 09:46:25.586 | 09:46:26.161 | 575 | `GET /issuing/cards/{id}` | 200 | – | `eac7746d5a8d455a8f38a2ad93a88809` | INACTIVE | pass 1 setup.cards |
| 8 | 09:46:26.165 | 09:46:26.477 | 312 | `GET /issuing/cardholders` | 200 | – | `ab755ac0b32e49aa91158415137fc341` | – | pass 1 setup.cards |
| 9 | 09:46:26.478 | 09:46:26.827 | 349 | `GET /issuing/cards` | 200 | – | `90cc49a0753a4a97838b5267de28ec4b` | – | pass 1 setup.cards |
| 10 | 09:46:27.061 | 09:46:27.371 | 310 | `GET /issuing/cards` | 200 | – | `1359b6af3ea6444abf93ed5ca52f40c5` | – | pass 1 setup.cards |
| 11 | 09:46:27.372 | 09:46:27.967 | 595 | `POST /issuing/cards/create` | 202 | – | `0e483beee66b45f79519cc197adb45fe` | – | pass 1 setup.cards |
| 12 | 09:46:27.970 | 09:46:28.401 | 431 | `POST /issuing/cards/{id}/update` | 200 | – | `2633b3b8a93445dc919746e904c693b4` | – | pass 1 setup.cards |
| 13 | 09:46:28.403 | 09:46:28.937 | 534 | `GET /issuing/cards/{id}` | 200 | – | `b19aa88a391b4161a0e9c898c2734f40` | INACTIVE | pass 1 setup.cards |
| 14 | 09:46:28.941 | 09:46:29.231 | 290 | `GET /issuing/cardholders` | 200 | – | `f14bf455b06949ec805a5d1f47d3f2a7` | – | pass 1 setup.cards |
| 15 | 09:46:29.232 | 09:46:29.556 | 324 | `GET /issuing/cards` | 200 | – | `2347f68084d34308b930d7d8101a318a` | – | pass 1 setup.cards |
| 16 | 09:46:29.791 | 09:46:30.158 | 367 | `GET /issuing/cards` | 200 | – | `3e0d0a6e022a4eaabfc2736190854e25` | – | pass 1 setup.cards |
| 17 | 09:46:30.159 | 09:46:31.032 | 873 | `POST /issuing/cards/create` | 202 | – | `33e01d306f744de49b36cdaa3d990238` | – | pass 1 setup.cards |
| 18 | 09:46:31.035 | 09:46:31.387 | 352 | `POST /issuing/cards/{id}/update` | 200 | – | `9ebc6c05cc7448949f4875cdb4a41ff0` | – | pass 1 setup.cards |
| 19 | 09:46:31.388 | 09:46:31.699 | 311 | `GET /issuing/cards/{id}` | 200 | – | `9dedbb5b8ccd4ca4b1f0557ccb816463` | INACTIVE | pass 1 setup.cards |
| 20 | 09:46:31.705 | 09:46:32.035 | 330 | `POST /issuing/cards/{id}/update` | 200 | – | `0d56565656894699b5328e336ff584c1` | – | pass 1 cycle.freeze (sourcing) |
| 21 | 09:46:32.035 | 09:46:32.597 | 562 | `GET /issuing/cards/{id}` | 200 | – | `4d6c424d14304859b79d0262f93fac0d` | INACTIVE | pass 1 cycle.freeze (sourcing) |
| 22 | 09:46:32.611 | 09:46:35.415 | 2804 | `POST /simulation/issuing/create` | 201 | – | `30f70141db274bd0a87bc048d83ffc61` | auth DECLINED CARD_INACTIVE | pass 1 cycle.charge_frozen (sourcing) |
| 23 | 09:46:35.420 | 09:46:36.026 | 606 | `POST /issuing/cards/{id}/update` | 200 | – | `c90080c615744861ab6a0c7834250a7d` | – | pass 1 cycle.thaw (sourcing) |
| 24 | 09:46:36.027 | 09:46:36.335 | 308 | `GET /issuing/cards/{id}` | 200 | – | `9405a792fa9a40f092ad8c14d9ddf9fd` | ACTIVE | pass 1 cycle.thaw (sourcing) |
| 25 | 09:46:36.343 | 09:46:40.322 | 3979 | `POST /simulation/issuing/create` | 201 | – | `4036e709166b46dbbd690da09dacf3a1` | auth APPROVED | pass 1 cycle.auth_purchase (sourcing) |
| 26 | 09:46:40.343 | 09:46:42.875 | 2532 | `POST /simulation/issuing/create` | 201 | – | `5ea31444c1794648880176c7b3cd33ef` | auth APPROVED | pass 1 cycle.auth_in_window (sourcing) |
| 27 | 09:46:42.881 | 09:46:43.445 | 565 | `POST /issuing/cards/{id}/update` | 200 | – | `54ed1ce5ab374bf48c2faf19bbe68f17` | – | pass 1 cycle.refreeze (sourcing) |
| 28 | 09:46:43.446 | 09:46:43.759 | 313 | `GET /issuing/cards/{id}` | 200 | – | `26b9895b27cb49e683f74c7dc48417be` | INACTIVE | pass 1 cycle.refreeze (sourcing) |
| 29 | 09:46:43.767 | 09:46:46.413 | 2646 | `POST /simulation/issuing/create` | 201 | – | `ad32a45fc7e7450fb3634ee6eb13fc30` | auth DECLINED CARD_INACTIVE | pass 1 cycle.charge_after_refreeze (sourcing) |
| 30 | 09:46:46.419 | 09:46:46.747 | 328 | `POST /issuing/cards/{id}/update` | 200 | – | `01a06071189c41849b1d2bcbf6bab2bc` | – | pass 1 cycle.freeze (support) |
| 31 | 09:46:46.748 | 09:46:47.044 | 296 | `GET /issuing/cards/{id}` | 200 | – | `4e41c70686a94e3d851a3a02d06e3b80` | INACTIVE | pass 1 cycle.freeze (support) |
| 32 | 09:46:47.049 | 09:46:49.641 | 2592 | `POST /simulation/issuing/create` | 201 | – | `6a95a80216844cdeafb3ac2ebd3bb7a7` | auth DECLINED CARD_INACTIVE | pass 1 cycle.charge_frozen (support) |
| 33 | 09:46:49.646 | 09:46:49.998 | 352 | `POST /issuing/cards/{id}/update` | 200 | – | `e1127865dadf41d694bfa938f27539bc` | – | pass 1 cycle.thaw (support) |
| 34 | 09:46:49.999 | 09:46:50.351 | 352 | `GET /issuing/cards/{id}` | 200 | – | `896f0f04fe2d4ad1ae12ca8fa5970de6` | ACTIVE | pass 1 cycle.thaw (support) |
| 35 | 09:46:50.375 | 09:46:54.018 | 3643 | `POST /simulation/issuing/create` | 201 | – | `c17720b5a6db4734b5dbcf06cb0d4446` | auth APPROVED | pass 1 cycle.auth_purchase (support) |
| 36 | 09:46:54.023 | 09:46:56.535 | 2512 | `POST /simulation/issuing/create` | 201 | – | `fae53980f0d24ba7bd6951ae33d0ddfa` | auth APPROVED | pass 1 cycle.auth_in_window (support) |
| 37 | 09:46:56.544 | 09:46:56.903 | 359 | `POST /issuing/cards/{id}/update` | 200 | – | `c879ddf25b664283aaf169b7c3918acd` | – | pass 1 cycle.refreeze (support) |
| 38 | 09:46:56.904 | 09:46:57.201 | 297 | `GET /issuing/cards/{id}` | 200 | – | `7ff8b315221e4049855b400e8b47f463` | INACTIVE | pass 1 cycle.refreeze (support) |
| 39 | 09:46:57.222 | 09:46:59.703 | 2481 | `POST /simulation/issuing/create` | 201 | – | `0622e1421ddf4851b75fb4bf6649d7d1` | auth DECLINED CARD_INACTIVE | pass 1 cycle.charge_after_refreeze (support) |
| 40 | 09:46:59.727 | 09:47:00.051 | 324 | `POST /issuing/cards/{id}/update` | 200 | – | `e0985347361c4060b815b4d34a5ff0b7` | – | pass 1 cycle.freeze (treasury) |
| 41 | 09:47:00.052 | 09:47:00.340 | 288 | `GET /issuing/cards/{id}` | 200 | – | `5b94428c829740beafe10ec6d0251307` | INACTIVE | pass 1 cycle.freeze (treasury) |
| 42 | 09:47:00.347 | 09:47:03.887 | 3540 | `POST /simulation/issuing/create` | 201 | – | `ddd9b5a67826475cb860781afc5242bc` | auth DECLINED CARD_INACTIVE | pass 1 cycle.charge_frozen (treasury) |
| 43 | 09:47:03.900 | 09:47:04.506 | 606 | `POST /issuing/cards/{id}/update` | 200 | – | `7e5ab403f6c04d09bcff38d9887aa56f` | – | pass 1 cycle.thaw (treasury) |
| 44 | 09:47:04.507 | 09:47:04.809 | 302 | `GET /issuing/cards/{id}` | 200 | – | `35c35ed9466b4bfab999143a5c8c1bcf` | ACTIVE | pass 1 cycle.thaw (treasury) |
| 45 | 09:47:04.814 | 09:47:08.460 | 3646 | `POST /simulation/issuing/create` | 201 | – | `59137a7682e04f01bcfaa4ddd064e93b` | auth APPROVED | pass 1 cycle.auth_purchase (treasury) |
| 46 | 09:47:08.483 | 09:47:12.030 | 3547 | `POST /simulation/issuing/create` | 201 | – | `010d59e8ac2948ccb17fbaf5c932a624` | auth APPROVED | pass 1 cycle.auth_in_window (treasury) |
| 47 | 09:47:12.037 | 09:47:12.398 | 361 | `POST /issuing/cards/{id}/update` | 200 | – | `45dd9a6760834a02b9645af4f3d285cd` | – | pass 1 cycle.refreeze (treasury) |
| 48 | 09:47:12.399 | 09:47:12.791 | 392 | `GET /issuing/cards/{id}` | 200 | – | `e98fb6bc3f2f4b7584c1b874913d293e` | INACTIVE | pass 1 cycle.refreeze (treasury) |
| 49 | 09:47:12.797 | 09:47:16.449 | 3652 | `POST /simulation/issuing/create` | 201 | – | `3cb47c1a98e34b6c88be952db9fd1985` | auth DECLINED CARD_INACTIVE | pass 1 cycle.charge_after_refreeze (treasury) |
| 50 | 09:47:16.467 | 09:47:16.842 | 375 | `POST /issuing/cards/{id}/update` | 200 | – | `4d7b5b060c2d46c6bda46373e7b0bda6` | – | pass 1 purchase.window (sourcing) |
| 51 | 09:47:16.842 | 09:47:17.153 | 311 | `GET /issuing/cards/{id}` | 200 | – | `e187bdbc087942df9b089168d5545384` | ACTIVE | pass 1 purchase.window (sourcing) |
| 52 | 09:47:17.154 | 09:47:19.830 | 2676 | `POST /simulation/issuing/create` | 201 | – | `ffdbe804f0ec4f568feacb95b2eefd13` | auth APPROVED | pass 1 purchase.window (sourcing) |
| 53 | 09:47:19.832 | 09:47:20.203 | 371 | `POST /issuing/cards/{id}/update` | 200 | – | `046be59ce8f64cbea6da6bbcec912ab2` | – | pass 1 purchase.window (sourcing) |
| 54 | 09:47:20.203 | 09:47:20.510 | 307 | `GET /issuing/cards/{id}` | 200 | – | `db1b60e9d32347b8b9f2ca8686ff29de` | INACTIVE | pass 1 purchase.window (sourcing) |
| 55 | 09:47:23.829 | 09:47:24.666 | 837 | `POST /authentication/login` | 201 | – | `4df4441f07d443e9a4330ac25324cfc1` | – | pass 1 crash.k1.kill (treasury) |
| 56 | 09:47:24.677 | 09:47:25.385 | 708 | `POST /issuing/cards/{id}/update` | 200 | – | `0fb033cd028e4aae87245e95a6e1b8da` | – | pass 1 crash.k1.kill (treasury) |
| 57 | 09:47:25.391 | 09:47:25.706 | 315 | `GET /issuing/cards/{id}` | 200 | – | `eb41b330754e40edb1c6b4647220bc8c` | ACTIVE | pass 1 crash.k1.kill (treasury) |
| 58 | 09:47:25.745 | 09:47:26.101 | 356 | `GET /issuing/cards/{id}` | 200 | – | `224f5a7692dc4d55b397439ddcc2bdc4` | ACTIVE | pass 1 crash.k1.kill (treasury) |
| 59 | 09:47:26.119 | 09:47:26.530 | 411 | `GET /issuing/cards/{id}` | 200 | – | `15c2f677bfdb4b31b1d931e43466f727` | ACTIVE | pass 1 crash.k1.tick (treasury) |
| 60 | 09:47:26.534 | 09:47:30.214 | 3680 | `POST /simulation/issuing/create` | 201 | – | `14408cd271244f95a6911a4786116d8a` | auth APPROVED | pass 1 crash.k1.charge (treasury) |
| 61 | 09:47:33.314 | 09:47:33.988 | 674 | `POST /authentication/login` | 201 | – | `faa1d7d1f46b4d18931329933ddb4b49` | – | pass 1 crash.k2.kill (support) |
| 62 | 09:47:33.990 | 09:47:34.391 | 401 | `POST /issuing/cards/{id}/update` | 200 | – | `e84279c7ccab458e87fd090db707d987` | – | pass 1 crash.k2.kill (support) |
| 63 | 09:47:34.392 | 09:47:34.708 | 316 | `GET /issuing/cards/{id}` | 200 | – | `6b76db44b0c241249433ccc89d34f3c8` | ACTIVE | pass 1 crash.k2.kill (support) |
| 64 | 09:47:34.734 | 09:47:35.073 | 339 | `GET /issuing/cards/{id}` | 200 | – | `442dd28569fe47e380e196acc28c4981` | ACTIVE | pass 1 crash.k2.kill (support) |
| 65 | 09:49:40.176 | 09:49:40.834 | 658 | `GET /issuing/cards/{id}` | 200 | – | `d1611cd7815e484c89cc8172cdb5939b` | ACTIVE | pass 1 crash.k2.tick (support) |
| 66 | 09:49:40.838 | 09:49:41.451 | 613 | `POST /issuing/cards/{id}/update` | 200 | – | `8eb2043cf1534d0fb1aac67f30e5c22d` | – | pass 1 crash.k2.tick (support) |
| 67 | 09:49:41.452 | 09:49:41.763 | 311 | `GET /issuing/cards/{id}` | 200 | – | `ba8b153a5b7b4f8295d54be2c81b7924` | INACTIVE | pass 1 crash.k2.tick (support) |
| 68 | 09:49:41.777 | 09:49:42.075 | 298 | `GET /issuing/cards/{id}` | 200 | – | `216b5aed70214311aa1e202e99b73fb1` | ACTIVE | pass 1 crash.k2.tick (support) |
| 69 | 09:49:42.091 | 09:49:45.647 | 3556 | `POST /simulation/issuing/create` | 201 | – | `951c141e89c64f048262c514cef7a58b` | auth APPROVED | pass 1 crash.k2.charge (support) |
| 70 | 09:51:50.754 | 09:51:51.435 | 681 | `GET /issuing/transactions` | 200 | – | `7531ae22751a4ee09c26b80980e305be` | – | pass 1 detect.poll |
| 71 | 09:51:51.450 | 09:51:51.824 | 374 | `GET /issuing/transactions` | 200 | – | `84a072e8ffe34c289722457bd00f3738` | – | pass 1 detect.poll |
| 72 | 09:51:51.850 | 09:51:52.232 | 382 | `GET /issuing/transactions` | 200 | – | `5c409755b51a485b8e6b2c302479241f` | – | pass 1 detect.poll |
| 73 | 10:00:11.624 | 10:00:12.525 | 901 | `POST /authentication/login` | 201 | – | `34f804a771504e8385f626d4e4e0888e` | – | pass 2 cycle.freeze (support) |
| 74 | 10:00:12.545 | 10:00:12.997 | 452 | `POST /issuing/cards/{id}/update` | 200 | – | `b85911971c624ed3b2629beab49c6327` | – | pass 2 cycle.freeze (support) |
| 75 | 10:00:12.998 | 10:00:13.355 | 357 | `GET /issuing/cards/{id}` | 200 | – | `d644d2cd4d104132993c266fbf63d296` | INACTIVE | pass 2 cycle.freeze (support) |
| 76 | 10:00:13.358 | 10:00:22.935 | 9577 | `POST /simulation/issuing/create` | 400 bad_request | – | `8f2f4c4a8d1b439bbc7194404d12c5d9` | – | pass 2 cycle.charge_frozen (support) |
| 77 | 10:02:19.173 | 10:02:19.985 | 812 | `POST /authentication/login` | 201 | – | `deae5d8438ee466c8132e45965db1eda` | – | pass 3 cycle.freeze (support) |
| 78 | 10:02:20.000 | 10:02:20.415 | 415 | `POST /issuing/cards/{id}/update` | 200 | – | `d98545dad51d41cdacdc07ede40c34be` | – | pass 3 cycle.freeze (support) |
| 79 | 10:02:20.416 | 10:02:20.777 | 361 | `GET /issuing/cards/{id}` | 200 | – | `430fd494d7ba4903ac4c3e4266914b18` | INACTIVE | pass 3 cycle.freeze (support) |
| 80 | 10:02:20.780 | 10:02:24.580 | 3800 | `POST /simulation/issuing/create` | 201 | – | `186bfcadaad64093aedd7401fe5767dc` | auth DECLINED CARD_INACTIVE | pass 3 cycle.charge_frozen (support) |
| 81 | 10:02:24.612 | 10:02:24.972 | 360 | `POST /issuing/cards/{id}/update` | 200 | – | `20a933d4dda94fd6b87df3d50566784a` | – | pass 3 cycle.thaw (support) |
| 82 | 10:02:24.973 | 10:02:25.297 | 324 | `GET /issuing/cards/{id}` | 200 | – | `7474c6502e75425981081edca12bb42d` | ACTIVE | pass 3 cycle.thaw (support) |
| 83 | 10:02:25.301 | 10:02:28.175 | 2874 | `POST /simulation/issuing/create` | 201 | – | `6e3607f77fe24582a742df0349e5e6b9` | auth APPROVED | pass 3 cycle.auth_purchase (support) |
| 84 | 10:02:28.212 | 10:02:31.818 | 3606 | `POST /simulation/issuing/create` | 201 | – | `29ffe781e1434c408607d6c20ed2cac8` | auth APPROVED | pass 3 cycle.auth_in_window (support) |
| 85 | 10:02:31.827 | 10:02:32.190 | 363 | `POST /issuing/cards/{id}/update` | 200 | – | `2148302d62d34dcc960a7d41c7725f96` | – | pass 3 cycle.refreeze (support) |
| 86 | 10:02:32.193 | 10:02:32.521 | 328 | `GET /issuing/cards/{id}` | 200 | – | `75cd370250da44e68bdfcb8926f2bdbb` | INACTIVE | pass 3 cycle.refreeze (support) |
| 87 | 10:02:32.535 | 10:02:35.056 | 2521 | `POST /simulation/issuing/create` | 201 | – | `20e4536fb88441a0b2d081882f174462` | auth DECLINED CARD_INACTIVE | pass 3 cycle.charge_after_refreeze (support) |
| 88 | 10:02:39.674 | 10:02:40.314 | 640 | `POST /authentication/login` | 201 | – | `3f91cc14756240eaa8add94f94cc903d` | – | pass 3 crash.k1.kill (treasury) |
| 89 | 10:02:40.321 | 10:02:40.763 | 442 | `POST /issuing/cards/{id}/update` | 200 | – | `7a5f8cb8c8f54a3a84899ede94d0a7bf` | – | pass 3 crash.k1.kill (treasury) |
| 90 | 10:02:40.764 | 10:02:41.081 | 317 | `GET /issuing/cards/{id}` | 200 | – | `fde7f7ea3eb04ed48201890072bb7e14` | ACTIVE | pass 3 crash.k1.kill (treasury) |
| 91 | 10:02:41.128 | 10:02:41.534 | 406 | `GET /issuing/cards/{id}` | 200 | – | `db837f932661479f8f463d74e446d318` | ACTIVE | pass 3 crash.k1.kill (treasury) |
| 92 | 10:02:41.552 | 10:02:42.163 | 611 | `GET /issuing/cards/{id}` | 200 | – | `70cd10ea0f2c44fb86c626a14c1658b3` | ACTIVE | pass 3 crash.k1.tick (treasury) |
| 93 | 10:02:42.175 | 10:02:42.560 | 385 | `GET /issuing/cards/{id}` | 200 | – | `69f114c5322f4279a4ad6edc0360b3a2` | INACTIVE | pass 3 crash.k1.recover (treasury) |
| 94 | 10:02:42.572 | 10:02:42.893 | 321 | `GET /issuing/cards/{id}` | 200 | – | `f57925126baf4fafac7a3226d1b4b6b5` | INACTIVE | pass 3 crash.k1.recover (treasury) |
| 95 | 10:02:42.899 | 10:02:43.195 | 296 | `GET /issuing/cards/{id}` | 200 | – | `9d21a4e0b4734aff95df1e9cf338b313` | ACTIVE | pass 3 crash.k1.recover (treasury) |
| 96 | 10:02:43.197 | 10:02:43.637 | 440 | `POST /issuing/cards/{id}/update` | 200 | – | `46871e706dbb4dd69084eab5031d56da` | – | pass 3 crash.k1.recover (treasury) |
| 97 | 10:02:43.638 | 10:02:43.937 | 299 | `GET /issuing/cards/{id}` | 200 | – | `7ba4c0ccc9f94f6e8827ba36d2e3b8eb` | INACTIVE | pass 3 crash.k1.recover (treasury) |
| 98 | 10:02:43.940 | 10:02:44.263 | 323 | `GET /issuing/cards/{id}` | 200 | – | `406175457b3b4cacb7c7b45216650e7c` | INACTIVE | pass 3 crash.k1.recover (treasury) |
| 99 | 10:02:44.268 | 10:02:47.951 | 3683 | `POST /simulation/issuing/create` | 201 | – | `96bf3fda502b4b26939a969dcf563557` | auth DECLINED CARD_INACTIVE | pass 3 crash.k1.charge (treasury) |
| 100 | 10:02:52.023 | 10:02:52.792 | 769 | `POST /authentication/login` | 201 | – | `ef589f46e36648209203be96567b70d1` | – | pass 3 crash.k2.kill (support) |
| 101 | 10:02:52.834 | 10:02:53.231 | 397 | `POST /issuing/cards/{id}/update` | 200 | – | `20f904e940fe42748fc926dc22db36fd` | – | pass 3 crash.k2.kill (support) |
| 102 | 10:02:53.234 | 10:02:53.787 | 553 | `GET /issuing/cards/{id}` | 200 | – | `d860c1f82e164eb9b568447a9923772b` | ACTIVE | pass 3 crash.k2.kill (support) |
| 103 | 10:02:53.852 | 10:02:54.323 | 471 | `GET /issuing/cards/{id}` | 200 | – | `9eb80a297cf243088840c8d3d89fc254` | ACTIVE | pass 3 crash.k2.kill (support) |
| 104 | 10:04:59.513 | 10:04:59.942 | 429 | `GET /issuing/cards/{id}` | 200 | – | `9ec5300ea1ba4bc7a9c6c1a492b35fde` | ACTIVE | pass 3 crash.k2.tick (support) |
| 105 | 10:04:59.945 | 10:05:00.425 | 480 | `POST /issuing/cards/{id}/update` | 200 | – | `c510b0a07b6b4b4192e88b7aa198a95a` | – | pass 3 crash.k2.tick (support) |
| 106 | 10:05:00.431 | 10:05:00.743 | 312 | `GET /issuing/cards/{id}` | 200 | – | `8bd38f36555a42d992d84f9463494998` | INACTIVE | pass 3 crash.k2.tick (support) |
| 107 | 10:05:00.770 | 10:05:01.080 | 310 | `GET /issuing/cards/{id}` | 200 | – | `83261e3f35794e399605e940f804fbd7` | INACTIVE | pass 3 crash.k2.tick (support) |
| 108 | 10:05:01.103 | 10:05:01.424 | 321 | `GET /issuing/cards/{id}` | 200 | – | `174dd31ccbe241ecb120c9a2fa821c26` | INACTIVE | pass 3 crash.k2.recover (support) |
| 109 | 10:05:01.440 | 10:05:01.820 | 380 | `GET /issuing/cards/{id}` | 200 | – | `390e813837d14461b7c0439f71619feb` | INACTIVE | pass 3 crash.k2.recover (support) |
| 110 | 10:05:01.829 | 10:05:02.147 | 318 | `GET /issuing/cards/{id}` | 200 | – | `d9b9e0e42ac440a09abed4f5338f6668` | INACTIVE | pass 3 crash.k2.recover (support) |
| 111 | 10:05:02.174 | 10:05:02.495 | 321 | `GET /issuing/cards/{id}` | 200 | – | `c7ff2fa1dec1445cb3cc2e01292cbae7` | INACTIVE | pass 3 crash.k2.recover (support) |
| 112 | 10:05:02.503 | 10:05:06.308 | 3805 | `POST /simulation/issuing/create` | 201 | – | `6db7f21c60d043f0a8b4a6134f2b5f8e` | auth DECLINED CARD_INACTIVE | pass 3 crash.k2.charge (support) |
| 113 | 10:07:11.411 | 10:07:11.993 | 582 | `GET /issuing/transactions` | 200 | – | `4894646666454e5f86bfcbd41386d107` | – | pass 3 detect.poll |
| 114 | 10:07:12.017 | 10:07:12.551 | 534 | `GET /issuing/transactions` | 200 | – | `5bf6378981624a92a89769d16cd7d6f5` | – | pass 3 detect.poll |
| 115 | 10:07:12.840 | 10:07:13.232 | 392 | `GET /issuing/transactions` | 200 | – | `dee775a3bd6d4210b2b44af7e077e5ce` | – | pass 3 detect.poll |

Calls by endpoint: `POST /authentication/login` 7, `GET /issuing/cardholders` 3, `GET /issuing/cards` 6, `POST /issuing/cards/create` 3, `POST /issuing/cards/{id}/update` 25, `GET /issuing/cards/{id}` 43, `POST /simulation/issuing/create` 22, `GET /issuing/transactions` 6.

## What this does not show

- Real merchants and card networks: the sandbox's simulated authorisation is decided by Airwallex, but its timing is not a card network's.
- A webhook delivered by Airwallex: this run has no public receiver; the replay checks Purser's handling of the same payloads.
- One run per card: latencies are single measurements, not a distribution.
- The restart is the runner's card code called by the drill (src/policy/cards.ts), not a restarted `npm run relay` process.
