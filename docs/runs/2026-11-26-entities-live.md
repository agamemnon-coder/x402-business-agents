# Entities and their funding accounts, live: 2026-11-26

`npm run airwallex:governance-live -- live entities`. Two legal entities, each with its own Airwallex account: entity A is the sandbox's connected account `acct_SC-QD89fOneAeqaRFgOymw` (ACTIVE since 10 Nov, docs/runs/2026-11-10-connected-accounts-sandbox.md), entity B the platform account `acct_op0_QItiOyWKsYb5pwQihA`, the API key's own. A payment from entity A's own account, paid; payments set to fund from entity B's account refused before any create. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `86d7f6b93376`. The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-26-entities-live.json.

**12 of 12 steps passed, 0 failed, 0 not judged** (measurements, or not supported by the sandbox). 18 Airwallex calls of a budget of 60 (the drill's hard limit: 80; logins included), one at a time, at least 200 ms apart; 0 answered 429; 0 unexpected non-2xx.

## In short

- pass, `pay.plan_a`: P-0002 APPROVED (approved); paying_entity {"id":"nl-test-sole","name":"Purser Sandbox Test (fake sole trader, connected account)","country":"NL"}; funding_account {"id":"acct_SC-QD89fOneAeqaRFgOymw","currency":"EUR"}; request_id 3709fc5d-205f-477d-99e4-160bcbb35f68
- pass, `pay.exec_a`: transfer 05c09c48-f6c5-4752-bcba-3fdf51a861e4 PAID; payment EXECUTED; 8 calls (GET /balances/current, POST /transfers/create, GET /transfers/{id}, POST /simulation/transfers/{id}/transition, GET /transfers/{id}, POST /simulation/transfers/{id}/transition, GET /transfers/{id}, GET /balances/current)
- pass, `readback.a`: 05c09c48-f6c5-4752-bcba-3fdf51a861e4 PAID at A (EUR 1.00); at B: no transfer
- pass, `refuse.plan_rail_b`: refused: funding_account_mismatch: Purser Sandbox Test (fake sole trader, connected account) (nl-test-sole) pays only from its own account acct_SC-QD89fOneAeqaRFgOymw, but the rail acts for acct_op0_QItiOyWKsYb5pwQihA (Northwind ; 0 Airwallex calls
- pass, `refuse.plan_entity_b`: refused: entity_not_permitted: the CFO policy does not let the Treasury agent pay from Northwind Outdoor BV (the sandbox platform account) (nl-platform); the CFO allows it with Face ID (policy pay_from.nl-platform.treasury); 0 Airwallex calls
- pass, `refuse.terms_b`: refused: funding_account_mismatch: Purser Sandbox Test (fake sole trader, connected account) (nl-test-sole) pays only from its own account acct_SC-QD89fOneAeqaRFgOymw, but the terms fund it from acct_op0_QItiOyWKsYb5pwQihA (North
- pass, `refuse.exec_rail_b`: P-0003 signed; on B's account: refused: the terms were signed for payment from acct_SC-QD89fOneAeqaRFgOymw, but this runner pays from the company's own Airwallex account; nothing is paid; 1 Airwallex calls (0 POST: GET /balances/current); payment APPROVED
- pass, `readback.none`: 33b94dbc-d854-4c0b-a0bb-869721b6b925: at A no transfer, at B no transfer
- Shown: A payment from entity A carries `paying_entity` and `funding_account` (A's own account) in the terms the passkey signed, and is paid from A's own account (x-on-behalf-of A): created, PAID, read back PAID at A, and not found under its request_id at B.
- Shown: A payment for entity A on a rail acting for B's account is refused `funding_account_mismatch` before any Airwallex call; a payment from entity B, which the CFO has not opened to the agent, is refused `entity_not_permitted` before any call; terms naming A funded from B's account are refused by the same check.
- Shown: A's signed payment executed on the client's default account (B's own) is refused before any create (no POST; one balance read at B), and Airwallex holds no transfer under its request_id at A or B.

## Simulated, and how

- The approver is a labelled virtual test passkey ("governance-live virtual test passkey (no person's Face ID)", src/redteam/authenticator.ts), enrolled as the only passkey of the run's own fresh ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.
- Opening entity A to the treasury agent (`pay_from.nl-test-sole.treasury` allowed) is a proposal on the runner approved with the passkey. The runner's steps after an approval (executePolicyChange, then syncCardsAfterPolicy) are called by the run once, in order, not by a running `npm run relay` and its every-few-seconds loop.
- The invoices are test documents written by the run; the entities' names are labels for the two sandbox accounts.
- The settlement of the paid payout (SENT, then PAID) is the sandbox's simulation endpoint, called with x-on-behalf-of A.

## Steps (11:29:21.575–11:29:30.865 UTC)

Both funding accounts were usable: A's EUR balance was 54.06 before the run (read in a probe), B's the platform's. The payee is the test beneficiary already on file at A (`f8678483-2718-4393-a328-d78261b5d5a4`, "Zeeland Verpakkingen BV (test)", made on 10 Nov); the run created no beneficiary. Airwallex's record of it holds no SWIFT code, so the run put ABN AMRO's BIC (ABNANL2A, its bank's) on Purser's allowlist row and in the test invoice. **Two earlier attempts stopped at `pay.plan_a`** (11:28:24 and 11:29:01 UTC, 2 read-only calls each: login and GET /beneficiaries at A): the run's own invoice text had an empty BIC line, so Purser's invoice check read the next line as the BIC and refused the payment as possible fraud (nothing planned, nothing sent); the second attempt ran before the fix was saved. The fix was to the run's invoice text, not to Purser's code. Before the runs, 14 read-only calls checked the sandbox (10 in three probes: the platform's and the connected account's balances, GET /account, which answered `acct_op0_QItiOyWKsYb5pwQihA`, and the connected account's beneficiaries; 4 in the entities run's two stopped attempts, described in docs/runs/2026-11-26-entities-live.md). None moved money or changed anything; they are not in this record's call table. The runs (11:27 to 11:32 UTC) ran on the code committed right after them as `86d7f6b93`; between the runs and that commit only the records' wording, the stand-in's call counter and two unused imports changed.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: governance-live virtual test passkey (no person's Face ID) | **pass** | 0 | 15 |
| 2 | `setup.entities` Register two legal entities, each with its own Airwallex account: A Purser Sandbox Test (fake sole trader, connected account) (acct_SC-QD89fOneAeqaRFgOymw), B Northwind Outdoor BV (the sandbox platform account) (acct_op0_QItiOyWKsYb5pwQihA) | – | both held; neither open to any agent | held: nl-test-sole, nl-platform; treasury may pay from A false, from B false | **pass** | 0 | 2 |
| 3 | `setup.allow_a` The CFO opens entity A to the treasury agent (pay_from.nl-test-sole.treasury allowed: a loosening, a proposal on the runner signed with the passkey) *(simulated: signed by the virtual test passkey)* | treasury | the treasury agent may pay from A, not from B | P-0001 approved by the passkey and applied; A true, B false | **pass** | 0 | 52 |
| 4 | `setup.payee_a` A test payee already on file at entity A's account, read from Airwallex (GET /beneficiaries with x-on-behalf-of A) and put on Purser's allowlist | – | found; nothing created at Airwallex | f8678483-2718-4393-a328-d78261b5d5a4 Zeeland Verpakkingen BV (test), IBAN ••4300 | **pass** | 1, 2 | 1139 |
| 5 | `pay.plan_a` A payment from entity A (EUR 1.00 to the test payee, invoice ENT-A-1126-1), planned on the rail acting for A's own account, signed with the passkey *(simulated: signed by the virtual test passkey)* | treasury | proposed with paying_entity A and funding_account A's account in the signed terms; APPROVED | P-0002 APPROVED (approved); paying_entity {"id":"nl-test-sole","name":"Purser Sandbox Test (fake sole trader, connected account)","country":"NL"}; funding_account {"id":"acct_SC-QD89fOneAeqaRFgOymw","currency":"EUR"}; request_id 3709fc5d-205f-477d-99e4-160bcbb35f68 | **pass** | 3 | 468 |
| 6 | `pay.exec_a` Entity A's payment executed on the rail acting for A's own account (x-on-behalf-of), then settled by the sandbox's simulation *(simulated: the settlement to PAID is the sandbox's simulation)* | treasury | the transfer created at A's account, followed to PAID | transfer 05c09c48-f6c5-4752-bcba-3fdf51a861e4 PAID; payment EXECUTED; 8 calls (GET /balances/current, POST /transfers/create, GET /transfers/{id}, POST /simulation/transfers/{id}/transition, GET /transfers/{id}, POST /simulation/transfers/{id}/transition, GET /transfers/{id}, GET /balances/current) | **pass** | 4, 5, 6, 7, 8, 9, 10, 11 | 5097 |
| 7 | `readback.a` Airwallex read back: the transfer at A's account by its id; its request_id at B's account | – | PAID at A; no transfer under that request_id at B | 05c09c48-f6c5-4752-bcba-3fdf51a861e4 PAID at A (EUR 1.00); at B: no transfer | **pass** | 12, 13, 14 | 1114 |
| 8 | `refuse.plan_rail_b` A payment from entity A planned on a rail acting for entity B's account (x-on-behalf-of B) | treasury | refused funding_account_mismatch before any Airwallex call; no proposal | refused: funding_account_mismatch: Purser Sandbox Test (fake sole trader, connected account) (nl-test-sole) pays only from its own account acct_SC-QD89fOneAeqaRFgOymw, but the rail acts for acct_op0_QItiOyWKsYb5pwQihA (Northwind ; 0 Airwallex calls | **pass** | 0 | 6 |
| 9 | `refuse.plan_entity_b` A payment set to fund from entity B (its own account), which the CFO has not opened to the treasury agent | treasury | refused entity_not_permitted before any Airwallex call | refused: entity_not_permitted: the CFO policy does not let the Treasury agent pay from Northwind Outdoor BV (the sandbox platform account) (nl-platform); the CFO allows it with Face ID (policy pay_from.nl-platform.treasury); 0 Airwallex calls | **pass** | 0 | 3 |
| 10 | `refuse.terms_b` Terms naming entity A but funding it from entity B's account (Purser's entity check, run at planning and again at execution) | – | refused funding_account_mismatch | refused: funding_account_mismatch: Purser Sandbox Test (fake sole trader, connected account) (nl-test-sole) pays only from its own account acct_SC-QD89fOneAeqaRFgOymw, but the terms fund it from acct_op0_QItiOyWKsYb5pwQihA (North | **pass** | 0 | 0 |
| 11 | `refuse.exec_rail_b` A second payment from entity A (EUR 1.01, ENT-A-1126-3), planned on A's rail and signed, then executed on the client's default account (entity B's own account) *(simulated: signed by the virtual test passkey)* | treasury | refused before any create (no POST): the terms were signed for A's account | P-0003 signed; on B's account: refused: the terms were signed for payment from acct_SC-QD89fOneAeqaRFgOymw, but this runner pays from the company's own Airwallex account; nothing is paid; 1 Airwallex calls (0 POST: GET /balances/current); payment APPROVED | **pass** | 15, 16 | 746 |
| 12 | `readback.none` Airwallex read back by the refused payment's request_id, at A's account and at B's | – | no transfer at either | 33b94dbc-d854-4c0b-a0bb-869721b6b925: at A no transfer, at B no transfer | **pass** | 17, 18 | 634 |

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 11:29:21.651 | 11:29:22.368 | 717 | `POST /authentication/login` | 201 | – | `70663417468e4c13b6d6a0384e690241` | – | setup.payee_a |
| 2 | 11:29:22.371 | 11:29:22.788 | 417 | `GET /beneficiaries` | 200 | – | `55bbef1987464471bd185e2136592dff` | – | setup.payee_a |
| 3 | 11:29:22.848 | 11:29:23.219 | 371 | `GET /balances/current` | 200 | – | `38e649503550464b94848229902a9580` | – | pay.plan_a (treasury) |
| 4 | 11:29:23.262 | 11:29:23.642 | 380 | `GET /balances/current` | 200 | – | `b29ba56fcefd4f71867d2917500bded7` | – | pay.exec_a (treasury) |
| 5 | 11:29:23.654 | 11:29:25.135 | 1481 | `POST /transfers/create` | 201 | – | `102a533028414e59b1be30744e4bbda0` | – | pay.exec_a (treasury) |
| 6 | 11:29:25.139 | 11:29:25.536 | 397 | `GET /transfers/{id}` | 200 | – | `0681aa559aca4238b1bb99cfebfaebc5` | – | pay.exec_a (treasury) |
| 7 | 11:29:25.540 | 11:29:26.383 | 843 | `POST /simulation/transfers/{id}/transition` | 200 | – | `c84a53ca9ab348d48a217a9c04283ab0` | – | pay.exec_a (treasury) |
| 8 | 11:29:26.384 | 11:29:26.725 | 341 | `GET /transfers/{id}` | 200 | – | `0131275fff2b4784b5766f8425e0e4f7` | – | pay.exec_a (treasury) |
| 9 | 11:29:26.727 | 11:29:27.284 | 557 | `POST /simulation/transfers/{id}/transition` | 200 | – | `7a349e78ecba450fb88e5f8764fa772e` | – | pay.exec_a (treasury) |
| 10 | 11:29:27.285 | 11:29:27.634 | 349 | `GET /transfers/{id}` | 200 | – | `8d93bfbfc348497eaf4aad5404dccb6d` | – | pay.exec_a (treasury) |
| 11 | 11:29:27.639 | 11:29:28.352 | 713 | `GET /balances/current` | 200 | – | `bb4367e08eef4c9e8a4ac3bfdbf3bd05` | – | pay.exec_a (treasury) |
| 12 | 11:29:28.358 | 11:29:28.726 | 368 | `GET /transfers/{id}` | 200 | – | `eacfda8ff8f0490eba68efc5d48dd2c5` | – | readback.a |
| 13 | 11:29:28.728 | 11:29:29.172 | 444 | `POST /authentication/login` | 201 | – | `55ee6feb2999494aad4fa18d92af9e64` | – | readback.a |
| 14 | 11:29:29.172 | 11:29:29.470 | 298 | `GET /transfers` | 200 | – | `33155c580a2c4f68b118dd526258e8a2` | – | readback.a |
| 15 | 11:29:29.487 | 11:29:29.861 | 374 | `GET /balances/current` | 200 | – | `8e2a80c7af774a22b1e4b7ee4671d99d` | – | refuse.exec_rail_b (treasury) |
| 16 | 11:29:29.901 | 11:29:30.222 | 321 | `GET /balances/current` | 200 | – | `852b3b9ddd794c8cbb3e5671ec2b283e` | – | refuse.exec_rail_b (treasury) |
| 17 | 11:29:30.232 | 11:29:30.562 | 330 | `GET /transfers` | 200 | – | `e48e392ad4dd4acb8c0681728a9dfc41` | – | readback.none |
| 18 | 11:29:30.562 | 11:29:30.864 | 302 | `GET /transfers` | 200 | – | `5165664cbe994c878c59b47f99bee942` | – | readback.none |

Calls by endpoint: `POST /authentication/login` 2, `GET /beneficiaries` 1, `GET /balances/current` 5, `POST /transfers/create` 1, `GET /transfers/{id}` 4, `POST /simulation/transfers/{id}/transition` 2, `GET /transfers` 3.

## What this does not show

- A payment from entity B's own account: B was left closed to the agent on purpose; only refusals ran against B.
- Several real legal entities: A is a connected account of the platform B, so the two are not independent companies; Purser's check is the same either way (the account the terms name and the account the rail acts for).
- The executor refusal on B's account is Purser's `checkPayingAccount` (the terms were signed for A's account, the rail acts for the client's own account). Purser does not know that the default account is B's; the refusal does not depend on it.
- A screen in Purser Cloud to choose the entity: none yet. A person's Face ID on a real phone. One run.
