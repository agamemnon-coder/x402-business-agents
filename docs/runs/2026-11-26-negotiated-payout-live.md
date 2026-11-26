# Negotiated early-payment discount, paid live: 2026-11-26

`npm run airwallex:money-loop-live -- live negotiated-pay`. Purser's Sourcing agent and a simulated supplier agree an early-payment discount in a chain of signed offers (the recorded negotiation); the agreement is checked, the supplier's invoice for the agreed terms is planned, signed with the passkey and paid to the sandbox beneficiary through the normal executor, and Airwallex's transfer is read back: the agreed amount, with the agreement's hash in its metadata beside the approval hash. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `9abc1b24bfad`. The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-26-negotiated-payout-live.json.

**8 of 8 steps passed, 0 failed, 0 not judged** (measurements, or not supported by the sandbox). 7 Airwallex calls of a budget of 30 (the drill's hard limit: 40; logins included), one at a time, at least 200 ms apart; 0 answered 429; 0 unexpected non-2xx.

## In short

- pass, `neg.agree`: agreed: EUR 98.00 by 2026-12-03 (2.00% off if paid by 2026-12-03, discount EUR 2.00), within_cfo_policy; 4 turns; turn 2's bank change refused (payee_unchanged); agreement 2d52c115b596…; 0 calls
- pass, `neg.verify`: signatures 4 of 4; chain holds; agreement hash recomputed; head inside the agreement
- pass, `neg.original_refused`: escalated: the invoice asks EUR 100.00, the agreement EUR 98.00; only the agreed amount is paid; 0 calls; 0 payment proposals
- pass, `neg.signed`: P-0001 APPROVED (approved): EUR 98.00 to Bergtex Textil GmbH, reference BTX-NEG-1126-2d52c115; negotiation.agreement_sha256 the agreement's; request_id 7e8ecefe-ff7e-4777-84e2-08d970b5dcd6
- pass, `neg.pay`: transfer df4f52c3-5f66-45a4-ac0b-43cfbe0187fd SCHEDULED, EUR 98.00; payment EXECUTED
- pass, `neg.readback`: df4f52c3-5f66-45a4-ac0b-43cfbe0187fd PROCESSING: EUR 98.00 (agreed 98.00, invoice as issued 100.00); reference BTX-NEG-1126-2d52c115; metadata agreement_sha256 2d52c115b596…; all as signed and agreed
- Shown: The rails refused the supplier's mid-negotiation bank change, and the deal agreed is within the CFO's policy.
- Shown: Each offer's signature verifies with its agent's key, the offers form one chain, and the agreement's SHA-256 recomputes and holds the chain's head.
- Shown: An invoice under the agreement for the original amount is refused before any Airwallex call: only the agreed amount is planned.
- Shown: The transfer Airwallex holds is for exactly the agreed amount, under the signed request_id, with approval_sha256 and agreement_sha256 in its metadata and the agreement's first 8 hex in its reference.

## Simulated, and how

- The approver is a labelled virtual test passkey ("money-loop virtual test passkey (no person's Face ID)", src/redteam/authenticator.ts), enrolled as the only passkey of the run's own fresh ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.
- The negotiation is the recorded one (src/negotiate/negotiate.ts recordedTurns: written in advance, labelled "Recorded negotiation", no model call): the supplier and its agent are simulated, and its agent's signing key was made by the simulation. Purser's rails and the CFO's negotiation policy judge every turn live, and every offer is signed and chained live.
- The supplier's invoice for the agreed terms is composed by the run (as /try's engine composes it); no supplier sent it. The transfer's settlement is not simulated: it stays as Airwallex answered.

## Steps (19:54:23.696–19:54:27.522 UTC)

A fresh ledger of its own; the payee is the beneficiary on file at the sandbox (Bergtex Textil GmbH), not created by the run. Before the runs, 6 read-only calls looked at the sandbox (two probes, logins included: the balances twice, the beneficiaries and the Global Accounts); none moved money or changed anything, and they are not in this record's call table. The three runs (19:53 to 19:54 UTC) ran one after the other on the code committed as `9abc1b24b`. The code that ran includes the review fixes of 26 Nov: the FX executor judges the floor on free money under the payout lock and holds the signed maximum, and checks the stop, pause and the agent's identity again right before the create; a payment reference names an invoice only as a whole word.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: money-loop virtual test passkey (no person's Face ID) | **pass** | 0 | 13 |
| 2 | `neg.payee` The supplier's payee at Airwallex (Bergtex Textil GmbH, GET /beneficiaries), recorded in the run's ledger | treasury | found; the run creates none | 2abfa3ba-0786-44f7-b828-9d7c8e2da883 (Bergtex Textil GmbH, IBAN ending 3000) | **pass** | 1, 2 | 992 |
| 3 | `neg.agree` The Sourcing agent negotiates an early-payment discount on BTX-NEG-1126 (EUR 100.00, net 30) with the simulated supplier's agent: the recorded negotiation, every turn through Purser's rails and signed as an offer *(simulated: the recorded negotiation (turns written in advance, no model call); the supplier and its agent's key are the simulation's)* | sourcing | agreed within the CFO's policy; the supplier's bank change refused by the rails; no Airwallex call | agreed: EUR 98.00 by 2026-12-03 (2.00% off if paid by 2026-12-03, discount EUR 2.00), within_cfo_policy; 4 turns; turn 2's bank change refused (payee_unchanged); agreement 2d52c115b596…; 0 calls | **pass** | 0 | 11 |
| 4 | `neg.verify` The offers and the agreement checked: each offer's signature by its agent's key, the chain of offers, the agreement's hash and the chain's head inside it | – | all hold | signatures 4 of 4; chain holds; agreement hash recomputed; head inside the agreement | **pass** | 0 | 2 |
| 5 | `neg.original_refused` An invoice under the agreement's reference for the original amount (EUR 100.00) is planned with the agreement | treasury | refused before any Airwallex call: only the agreed amount is paid | escalated: the invoice asks EUR 100.00, the agreement EUR 98.00; only the agreed amount is paid; 0 calls; 0 payment proposals | **pass** | 0 | 10 |
| 6 | `neg.signed` The supplier's invoice for the agreed terms (its number carries the agreement's first 8 hex) planned with the agreement and signed with the passkey *(simulated: signed by the virtual test passkey; the supplier's invoice is composed by the run for the agreed terms (as /try's engine does))* | treasury | APPROVED: the signed amount is the agreed amount, and the signed terms carry the agreement's hash | P-0001 APPROVED (approved): EUR 98.00 to Bergtex Textil GmbH, reference BTX-NEG-1126-2d52c115; negotiation.agreement_sha256 the agreement's; request_id 7e8ecefe-ff7e-4777-84e2-08d970b5dcd6 | **pass** | 3 | 494 |
| 7 | `neg.pay` The payment executed (executeInvoicePayment): one transfer to the sandbox beneficiary under the signed request_id, approval_sha256 and agreement_sha256 in its metadata | treasury | a transfer created for the agreed amount | transfer df4f52c3-5f66-45a4-ac0b-43cfbe0187fd SCHEDULED, EUR 98.00; payment EXECUTED | **pass** | 4, 5, 6 | 1970 |
| 8 | `neg.readback` The transfer read back from Airwallex (GET /transfers/{id}) | – | the agreed amount in EUR (not the invoice as issued); the signed request_id; approval_sha256 and agreement_sha256 in its metadata; the reference naming the agreement | df4f52c3-5f66-45a4-ac0b-43cfbe0187fd PROCESSING: EUR 98.00 (agreed 98.00, invoice as issued 100.00); reference BTX-NEG-1126-2d52c115; metadata agreement_sha256 2d52c115b596…; all as signed and agreed | **pass** | 7 | 306 |

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 19:54:23.718 | 19:54:24.241 | 523 | `POST /authentication/login` | 201 | – | `dfdbb4c8c08e4249aa90cf6bfb10cc78` | – | neg.payee (treasury) |
| 2 | 19:54:24.254 | 19:54:24.706 | 452 | `GET /beneficiaries` | 200 | – | `afcbfcdded4a41c18b461b85bd15e22a` | – | neg.payee (treasury) |
| 3 | 19:54:24.852 | 19:54:25.191 | 339 | `GET /balances/current` | 200 | – | `19c71cca7da0437b939e97f23e36573f` | – | neg.signed (treasury) |
| 4 | 19:54:25.246 | 19:54:25.576 | 330 | `GET /balances/current` | 200 | – | `2f24d4eb26304859b0b1105ab887e361` | – | neg.pay (treasury) |
| 5 | 19:54:25.597 | 19:54:26.890 | 1293 | `POST /transfers/create` | 201 | – | `5d69cc9e7c314a0db8722fc8a431c0cb` | – | neg.pay (treasury) |
| 6 | 19:54:26.893 | 19:54:27.208 | 315 | `GET /balances/current` | 200 | – | `ded6da353a7445b9adfa244fe16ef4c4` | – | neg.pay (treasury) |
| 7 | 19:54:27.215 | 19:54:27.520 | 305 | `GET /transfers/{id}` | 200 | – | `384da79697ce42e8bc690da28cfa3456` | – | neg.readback |

Calls by endpoint: `POST /authentication/login` 1, `GET /beneficiaries` 1, `GET /balances/current` 3, `POST /transfers/create` 1, `GET /transfers/{id}` 1.

## What this does not show

- A live negotiation between two Claude models: the turns are the recorded ones (no model call).
- The transfer's settlement to PAID: not simulated in this run (Airwallex answered SCHEDULED at create and PROCESSING at the read-back).
- A person's Face ID on a real phone. One run.
