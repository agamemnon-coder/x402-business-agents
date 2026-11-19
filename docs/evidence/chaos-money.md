# Chaos for money movement

Run on 2026-11-19 with `npm run chaos:money` (src/cli/chaosMoney.ts), seed 20261119: **317 scenarios (300 randomized, 17 hand-written), 317 passed, 0 failed**.

What runs: the real invoice payment executor, its saga and outbox (money_steps), the real Airwallex client and adapter, and the runner's recovery (recoverHolds, resumeInterrupted). Airwallex is a stand-in REST API in this process (src/chaos/standInAirwallex.ts) that, call by call, loses the request, loses the answer after doing the work (a dropped connection or a timeout), answers 500, 502 after doing the work, 503 or 429. The runner's process dies at saga checkpoints or with a call sent; a death is emulated faithfully: the ledger restarts from its SQLite image at that instant (whatever catch blocks did after it is thrown away) and Airwallex refuses the dead process's calls. Clocks are skewed (the runner against Airwallex) and approvals arrive late. The CFO approves with a passkey (a software authenticator, through the real assertion path). After the faulty lives: one calm life, a person's retry of each failed payment (the retry route's semantics), Airwallex paying out what it holds, the payout follow-up, a restart the next day, then a webhook storm (every Airwallex event several times, shuffled, with forged ones) and the checks. Test money, no network, no key.

## Invariants

| Invariant | Held | Broken |
|---|---|---|
| I1: never paid twice: at most one live transfer and one conversion per approval at Airwallex, no request_id twice | 317 | 0 |
| I2: never paid without a valid signature: every transfer is to passkey-approved terms, for the approved amount, and the stored signatures re-verify offline | 317 | 0 |
| I3: the ledger balances: the audit chain and the general ledger verify, Airwallex's EUR is conserved, every executed payment's payout row says what Airwallex says | 317 | 0 |
| I4: every payment ends in a known state, or goes to a person (an alarm row or a /health alert) | 317 | 0 |
| I5: webhooks move nothing: duplicated, out-of-order and forged events change no proposal, payout row or approval; forged ones are ignored | 317 | 0 |

## Totals

- Airwallex calls: 9146; faults injected: 492 (429 76, 500 49, 503 72, lost-answer 80, crash 40, 502-after 64, timeout-after 46, lost-request 65); process deaths: 77.
- Webhooks delivered: 1686, of which forged: 459.
- How the payments ended: EXECUTED 218, EXPIRED 165, PENDING_APPROVAL 2, APPROVED 1, REJECTED 1, FAILED 8.
- Scenarios where a payment went to a person (an alarm row or a /health alert) instead of a final state: 1.
- Scenarios where an approved payment was refused before it began and sat APPROVED with no alarm until its expiry: 49 (see the findings).

## The invariants have teeth (canaries)

Each canary runs a calm payment and plants one break before the checks; each must be caught.

| Canary | Caught | By |
|---|---|---|
| canary: a second transfer at Airwallex under the same approval (a double payment) (`C1`) | yes | I1, I3 |
| canary: a transfer at Airwallex that no approval signed (`C2`) | yes | I1, I2, I3 |
| canary: the ledger's payout row says SENT while Airwallex says PAID (`C3`) | yes | I3 |
| canary: the ledger calls a payment failed while Airwallex paid it, and nothing says so (`C4`) | yes | I4 |

## Findings

No invariant was broken in any scenario.

### Observation: an approved payment refused before it begins raises no alarm until it expires

In 49 scenario(s) an approved proposal was refused by the executor before anything was sent (the terms in the ledger no longer hash to the approved hash, or the EUR floor would be broken once another payment went out) and stayed APPROVED, with no alarm row and nothing on /health, retried and refused at each start until its expiry made it EXPIRED. Nothing was paid (I1, I2 held). A person is not told while it lasts: `resumeInterrupted` (src/policy/saga.ts) keeps the refusal in its return value only. The same EUR floor refusal, met after execution began, fails the proposal instead (FAILED, on the dashboard). Why they were refused: the EUR floor 49. Seen in: H17, R006, R007, R010, R016, R031, R032, R034, R046, R048, R055, R071, R072, R075, R085, R095, R103, R104, R108, R113, R115, R116, R132, R148, R157, R161, R174, R191, R203, R205, R216, R221, R222, R226, R232, R235, R241, R243, R244, R245, R248, R250, R254, R261, R274, R284, R291, R293, R298.

Repro: `npm run chaos:money -- --only H11` (terms edited after the approval) and `--only H17` (two approvals, the second refused at the EUR floor).

## Hand-written scenarios

| Scenario | Result | How it ended |
|---|---|---|
| `H01` the transfer create is done at Airwallex and its answer is lost (connection dropped), every time it is sent | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H02` the process dies right after Airwallex made the transfer, before the ledger heard of it | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H03` the process dies with the conversion sent and done at Airwallex, before its answer arrives | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H16` the process dies with the transfer create sent and done at Airwallex, before its answer arrives | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H17` the conversion's answer is lost, then the payout cannot go on (the EUR floor): the converted money must not vanish from view | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID; P-0002 EXPIRED, nothing at Airwallex |
| `H04` 429 on every call, beyond the client's retries, then calm | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H05` 502 after Airwallex did the work, on every POST | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H06` two runners pay the same approved proposal at once, with lost answers | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H07` the runner's clock is 16 minutes ahead of Airwallex's: the quote it holds looks expired | held | P-0001 EXPIRED, nothing at Airwallex |
| `H08` the approval is used 25 minutes later: the terms have expired | held | P-0001 EXPIRED, nothing at Airwallex |
| `H09` a webhook storm: every event five times, shuffled, and six forged events | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H10` never approved: the executor is asked to pay a proposal waiting for the CFO | held | P-0001 PENDING_APPROVAL, nothing at Airwallex |
| `H11` the terms in the ledger are changed after the passkey approved them (amount +1.00) | held | P-0001 APPROVED, nothing at Airwallex → a person (approved_terms_changed) |
| `H12` the passkey signed other terms (another amount): the approval is refused, nothing is paid | held | P-0001 PENDING_APPROVAL, nothing at Airwallex |
| `H13` rejected with the passkey, then the executor is asked to pay | held | P-0001 REJECTED, nothing at Airwallex |
| `H14` the process dies twice: with the transfer's answer in hand, then again during the next life's settlement | held | P-0001 EXECUTED, Airwallex PAID, payout row PAID |
| `H15` two invoices, every fault kind at 50%, three faulty lives, a crash with the 9th call | held | P-0001 FAILED, nothing at Airwallex; P-0002 EXECUTED, Airwallex PAID, payout row PAID |

## Randomized scenarios (seed 20261119)

| Scenario | Faults | Deaths | Result | How it ended |
|---|---|---|---|---|
| `R001` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R002` | 0 | 0 | held | EXECUTED |
| `R003` | 2 | 0 | held | EXPIRED |
| `R004` | 2 | 0 | held | EXECUTED |
| `R005` | 3 | 0 | held | EXECUTED |
| `R006` | 2 | 1 | held | EXECUTED+EXPIRED |
| `R007` | 2 | 0 | held | EXECUTED+EXPIRED |
| `R008` | 1 | 0 | held | EXECUTED |
| `R009` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R010` | 2 | 1 | held | EXECUTED+EXPIRED |
| `R011` | 2 | 0 | held | EXECUTED |
| `R012` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R013` | 1 | 0 | held | EXECUTED |
| `R014` | 0 | 0 | held | EXECUTED |
| `R015` | 0 | 0 | held | EXPIRED |
| `R016` | 1 | 0 | held | EXECUTED+EXPIRED |
| `R017` | 0 | 0 | held | EXPIRED |
| `R018` | 0 | 0 | held | EXECUTED |
| `R019` | 0 | 0 | held | EXPIRED |
| `R020` | 2 | 1 | held | EXECUTED |
| `R021` | 15 | 1 | held | EXECUTED |
| `R022` | 2 | 0 | held | EXECUTED |
| `R023` | 0 | 0 | held | EXECUTED |
| `R024` | 0 | 0 | held | EXECUTED |
| `R025` | 4 | 0 | held | EXECUTED |
| `R026` | 4 | 1 | held | EXECUTED |
| `R027` | 2 | 0 | held | EXECUTED |
| `R028` | 0 | 0 | held | EXECUTED |
| `R029` | 0 | 0 | held | EXPIRED |
| `R030` | 0 | 0 | held | EXPIRED |
| `R031` | 0 | 1 | held | EXECUTED+EXPIRED |
| `R032` | 6 | 0 | held | EXECUTED+EXPIRED |
| `R033` | 0 | 0 | held | EXECUTED |
| `R034` | 3 | 0 | held | EXPIRED+EXECUTED |
| `R035` | 0 | 0 | held | EXPIRED |
| `R036` | 1 | 0 | held | EXECUTED |
| `R037` | 3 | 0 | held | EXECUTED |
| `R038` | 1 | 0 | held | EXPIRED |
| `R039` | 0 | 0 | held | EXPIRED |
| `R040` | 1 | 0 | held | EXPIRED |
| `R041` | 0 | 0 | held | EXECUTED |
| `R042` | 0 | 0 | held | EXPIRED |
| `R043` | 0 | 0 | held | EXECUTED |
| `R044` | 1 | 0 | held | EXECUTED |
| `R045` | 1 | 1 | held | EXECUTED |
| `R046` | 4 | 0 | held | EXECUTED+EXPIRED |
| `R047` | 0 | 0 | held | EXPIRED |
| `R048` | 1 | 1 | held | EXECUTED+EXPIRED |
| `R049` | 0 | 0 | held | EXECUTED |
| `R050` | 0 | 1 | held | EXECUTED |
| `R051` | 1 | 0 | held | EXPIRED |
| `R052` | 3 | 0 | held | EXECUTED |
| `R053` | 0 | 0 | held | EXPIRED |
| `R054` | 1 | 0 | held | EXECUTED |
| `R055` | 0 | 1 | held | EXECUTED+EXPIRED |
| `R056` | 0 | 0 | held | EXPIRED |
| `R057` | 1 | 0 | held | EXECUTED |
| `R058` | 19 | 2 | held | FAILED+EXECUTED |
| `R059` | 0 | 0 | held | EXECUTED |
| `R060` | 1 | 0 | held | EXECUTED |
| `R061` | 1 | 1 | held | EXECUTED |
| `R062` | 0 | 0 | held | EXPIRED |
| `R063` | 1 | 0 | held | EXECUTED |
| `R064` | 1 | 0 | held | EXECUTED |
| `R065` | 0 | 0 | held | EXECUTED |
| `R066` | 3 | 0 | held | EXECUTED |
| `R067` | 0 | 0 | held | EXPIRED |
| `R068` | 1 | 0 | held | EXECUTED |
| `R069` | 1 | 0 | held | EXECUTED |
| `R070` | 0 | 0 | held | EXPIRED |
| `R071` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R072` | 1 | 0 | held | EXECUTED+EXPIRED |
| `R073` | 1 | 0 | held | EXPIRED |
| `R074` | 0 | 0 | held | EXPIRED |
| `R075` | 4 | 1 | held | EXECUTED+EXPIRED |
| `R076` | 1 | 0 | held | EXECUTED |
| `R077` | 4 | 0 | held | EXECUTED+FAILED |
| `R078` | 10 | 0 | held | EXECUTED |
| `R079` | 0 | 1 | held | EXECUTED |
| `R080` | 4 | 0 | held | EXECUTED |
| `R081` | 1 | 1 | held | EXECUTED |
| `R082` | 3 | 1 | held | EXECUTED |
| `R083` | 3 | 0 | held | EXECUTED |
| `R084` | 1 | 1 | held | EXECUTED |
| `R085` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R086` | 1 | 0 | held | EXECUTED |
| `R087` | 1 | 1 | held | EXECUTED |
| `R088` | 1 | 1 | held | EXPIRED |
| `R089` | 2 | 0 | held | EXECUTED |
| `R090` | 0 | 0 | held | EXPIRED |
| `R091` | 1 | 0 | held | EXECUTED |
| `R092` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R093` | 0 | 0 | held | EXPIRED |
| `R094` | 1 | 0 | held | EXPIRED |
| `R095` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R096` | 2 | 0 | held | EXECUTED |
| `R097` | 0 | 0 | held | EXPIRED |
| `R098` | 2 | 0 | held | EXECUTED |
| `R099` | 2 | 0 | held | EXECUTED |
| `R100` | 2 | 0 | held | EXECUTED |
| `R101` | 1 | 0 | held | EXECUTED |
| `R102` | 5 | 1 | held | EXECUTED |
| `R103` | 3 | 0 | held | EXECUTED+EXPIRED |
| `R104` | 2 | 0 | held | EXECUTED+EXPIRED |
| `R105` | 0 | 0 | held | EXECUTED |
| `R106` | 0 | 0 | held | EXPIRED |
| `R107` | 0 | 0 | held | EXPIRED |
| `R108` | 7 | 0 | held | EXECUTED+EXPIRED |
| `R109` | 0 | 0 | held | EXPIRED |
| `R110` | 0 | 1 | held | EXECUTED |
| `R111` | 5 | 0 | held | EXECUTED |
| `R112` | 0 | 0 | held | EXPIRED |
| `R113` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R114` | 1 | 0 | held | EXECUTED |
| `R115` | 1 | 2 | held | EXECUTED+EXPIRED |
| `R116` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R117` | 0 | 0 | held | EXPIRED |
| `R118` | 2 | 0 | held | EXECUTED |
| `R119` | 3 | 0 | held | EXECUTED |
| `R120` | 0 | 0 | held | EXPIRED |
| `R121` | 2 | 0 | held | EXECUTED |
| `R122` | 0 | 0 | held | EXPIRED |
| `R123` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R124` | 0 | 0 | held | EXPIRED |
| `R125` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R126` | 13 | 1 | held | EXECUTED |
| `R127` | 1 | 0 | held | EXECUTED |
| `R128` | 0 | 0 | held | EXPIRED |
| `R129` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R130` | 4 | 0 | held | EXECUTED |
| `R131` | 0 | 0 | held | EXECUTED |
| `R132` | 0 | 1 | held | EXECUTED+EXPIRED |
| `R133` | 0 | 0 | held | EXECUTED |
| `R134` | 8 | 0 | held | EXECUTED |
| `R135` | 0 | 0 | held | EXECUTED |
| `R136` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R137` | 0 | 0 | held | EXECUTED |
| `R138` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R139` | 2 | 0 | held | EXECUTED |
| `R140` | 2 | 0 | held | EXECUTED |
| `R141` | 0 | 0 | held | EXPIRED |
| `R142` | 0 | 0 | held | EXECUTED |
| `R143` | 0 | 0 | held | EXPIRED |
| `R144` | 0 | 0 | held | EXPIRED |
| `R145` | 0 | 0 | held | EXPIRED |
| `R146` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R147` | 0 | 0 | held | EXPIRED |
| `R148` | 6 | 1 | held | EXECUTED+EXPIRED |
| `R149` | 14 | 1 | held | EXECUTED |
| `R150` | 4 | 0 | held | EXECUTED |
| `R151` | 3 | 0 | held | EXECUTED+FAILED |
| `R152` | 2 | 0 | held | EXECUTED |
| `R153` | 0 | 2 | held | EXECUTED |
| `R154` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R155` | 0 | 1 | held | EXECUTED |
| `R156` | 0 | 0 | held | EXECUTED |
| `R157` | 6 | 0 | held | EXECUTED+EXPIRED |
| `R158` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R159` | 0 | 0 | held | EXPIRED |
| `R160` | 1 | 0 | held | EXECUTED |
| `R161` | 2 | 0 | held | EXECUTED+EXPIRED |
| `R162` | 1 | 0 | held | EXECUTED |
| `R163` | 2 | 0 | held | FAILED+EXECUTED |
| `R164` | 1 | 0 | held | EXECUTED |
| `R165` | 2 | 0 | held | EXECUTED |
| `R166` | 2 | 0 | held | EXECUTED |
| `R167` | 0 | 0 | held | EXECUTED |
| `R168` | 4 | 0 | held | EXECUTED |
| `R169` | 1 | 0 | held | EXECUTED |
| `R170` | 1 | 1 | held | EXECUTED |
| `R171` | 2 | 0 | held | EXECUTED |
| `R172` | 0 | 0 | held | EXECUTED |
| `R173` | 1 | 1 | held | EXPIRED |
| `R174` | 2 | 1 | held | EXECUTED+EXPIRED |
| `R175` | 0 | 0 | held | EXECUTED |
| `R176` | 8 | 1 | held | EXECUTED |
| `R177` | 0 | 0 | held | EXPIRED |
| `R178` | 1 | 1 | held | EXECUTED |
| `R179` | 0 | 0 | held | EXPIRED |
| `R180` | 3 | 1 | held | EXECUTED |
| `R181` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R182` | 1 | 1 | held | EXECUTED |
| `R183` | 3 | 0 | held | EXECUTED |
| `R184` | 0 | 0 | held | EXECUTED |
| `R185` | 3 | 0 | held | EXECUTED |
| `R186` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R187` | 2 | 1 | held | EXPIRED |
| `R188` | 0 | 0 | held | EXECUTED |
| `R189` | 5 | 1 | held | EXECUTED |
| `R190` | 1 | 0 | held | EXECUTED |
| `R191` | 2 | 1 | held | EXECUTED+EXPIRED |
| `R192` | 0 | 0 | held | EXECUTED |
| `R193` | 3 | 1 | held | EXECUTED |
| `R194` | 0 | 0 | held | EXPIRED |
| `R195` | 1 | 1 | held | EXECUTED |
| `R196` | 1 | 1 | held | EXECUTED |
| `R197` | 5 | 1 | held | EXECUTED |
| `R198` | 1 | 0 | held | EXECUTED |
| `R199` | 1 | 0 | held | EXECUTED |
| `R200` | 2 | 0 | held | EXECUTED |
| `R201` | 0 | 0 | held | EXPIRED |
| `R202` | 0 | 0 | held | EXPIRED |
| `R203` | 3 | 0 | held | EXECUTED+EXPIRED |
| `R204` | 0 | 0 | held | EXPIRED |
| `R205` | 2 | 0 | held | EXECUTED+EXPIRED |
| `R206` | 1 | 0 | held | EXECUTED |
| `R207` | 0 | 0 | held | EXECUTED |
| `R208` | 1 | 1 | held | EXECUTED |
| `R209` | 0 | 0 | held | EXPIRED |
| `R210` | 1 | 1 | held | EXPIRED+EXPIRED |
| `R211` | 0 | 0 | held | EXECUTED |
| `R212` | 2 | 0 | held | EXECUTED |
| `R213` | 4 | 1 | held | EXECUTED |
| `R214` | 2 | 0 | held | EXECUTED |
| `R215` | 0 | 0 | held | EXPIRED |
| `R216` | 2 | 2 | held | EXECUTED+EXPIRED |
| `R217` | 0 | 0 | held | EXPIRED |
| `R218` | 0 | 0 | held | EXPIRED |
| `R219` | 8 | 0 | held | FAILED+EXECUTED |
| `R220` | 1 | 0 | held | EXPIRED+EXPIRED |
| `R221` | 2 | 0 | held | EXECUTED+EXPIRED |
| `R222` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R223` | 2 | 1 | held | EXECUTED |
| `R224` | 0 | 0 | held | EXECUTED |
| `R225` | 4 | 0 | held | EXECUTED |
| `R226` | 3 | 0 | held | EXECUTED+EXPIRED |
| `R227` | 1 | 0 | held | EXPIRED |
| `R228` | 1 | 1 | held | EXECUTED |
| `R229` | 0 | 0 | held | EXPIRED |
| `R230` | 0 | 0 | held | EXPIRED |
| `R231` | 0 | 0 | held | EXPIRED |
| `R232` | 1 | 2 | held | EXECUTED+EXPIRED |
| `R233` | 1 | 1 | held | EXECUTED |
| `R234` | 6 | 2 | held | EXECUTED |
| `R235` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R236` | 0 | 0 | held | EXECUTED |
| `R237` | 6 | 1 | held | EXECUTED |
| `R238` | 0 | 0 | held | EXPIRED |
| `R239` | 0 | 0 | held | EXPIRED |
| `R240` | 2 | 0 | held | EXECUTED |
| `R241` | 0 | 1 | held | EXECUTED+EXPIRED |
| `R242` | 0 | 0 | held | EXPIRED |
| `R243` | 2 | 0 | held | EXECUTED+EXPIRED |
| `R244` | 2 | 0 | held | EXPIRED+EXECUTED |
| `R245` | 8 | 0 | held | EXECUTED+EXPIRED |
| `R246` | 1 | 0 | held | EXECUTED |
| `R247` | 1 | 0 | held | EXECUTED |
| `R248` | 3 | 0 | held | EXECUTED+EXPIRED |
| `R249` | 0 | 0 | held | EXPIRED |
| `R250` | 1 | 0 | held | EXECUTED+EXPIRED |
| `R251` | 2 | 0 | held | EXECUTED |
| `R252` | 2 | 1 | held | EXECUTED |
| `R253` | 0 | 1 | held | EXECUTED |
| `R254` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R255` | 3 | 2 | held | EXECUTED |
| `R256` | 1 | 0 | held | EXPIRED |
| `R257` | 2 | 0 | held | EXECUTED+FAILED |
| `R258` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R259` | 1 | 0 | held | EXECUTED |
| `R260` | 0 | 0 | held | EXECUTED |
| `R261` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R262` | 0 | 0 | held | EXECUTED |
| `R263` | 0 | 0 | held | EXPIRED |
| `R264` | 0 | 0 | held | EXECUTED |
| `R265` | 0 | 0 | held | EXPIRED |
| `R266` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R267` | 0 | 0 | held | EXECUTED |
| `R268` | 0 | 0 | held | EXPIRED |
| `R269` | 0 | 0 | held | EXECUTED |
| `R270` | 0 | 1 | held | EXECUTED |
| `R271` | 5 | 0 | held | EXECUTED |
| `R272` | 1 | 1 | held | EXECUTED |
| `R273` | 0 | 2 | held | EXECUTED |
| `R274` | 1 | 0 | held | EXECUTED+EXPIRED |
| `R275` | 0 | 0 | held | EXECUTED |
| `R276` | 0 | 0 | held | EXECUTED |
| `R277` | 3 | 0 | held | EXECUTED |
| `R278` | 13 | 1 | held | FAILED+EXECUTED |
| `R279` | 0 | 0 | held | EXPIRED |
| `R280` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R281` | 0 | 0 | held | EXECUTED |
| `R282` | 2 | 0 | held | EXECUTED |
| `R283` | 3 | 2 | held | EXECUTED |
| `R284` | 5 | 0 | held | EXECUTED+EXPIRED |
| `R285` | 0 | 0 | held | EXPIRED |
| `R286` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R287` | 0 | 0 | held | EXPIRED |
| `R288` | 0 | 0 | held | EXPIRED |
| `R289` | 0 | 0 | held | EXPIRED |
| `R290` | 3 | 0 | held | EXECUTED |
| `R291` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R292` | 0 | 0 | held | EXPIRED |
| `R293` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R294` | 1 | 1 | held | EXECUTED |
| `R295` | 2 | 0 | held | EXECUTED |
| `R296` | 0 | 0 | held | EXPIRED |
| `R297` | 2 | 0 | held | EXPIRED |
| `R298` | 0 | 0 | held | EXECUTED+EXPIRED |
| `R299` | 0 | 0 | held | EXPIRED+EXPIRED |
| `R300` | 2 | 1 | held | EXECUTED |

The JSON beside this file (`chaos-money.json`) holds every scenario's parameters and, for the hand-written ones, what happened life by life.
