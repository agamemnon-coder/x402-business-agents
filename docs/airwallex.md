# Airwallex in Purser

This page lists every Airwallex API that Purser calls: the method and path as the code (`src/airwallex/`) and the run logs show them, what Purser uses it for, why that is a necessary financial action, and the run that proves it. After the kit, also: [airwallex-platform.md](airwallex-platform.md), [airwallex-approvals.md](airwallex-approvals.md).

All calls go to the Airwallex sandbox (`https://api.sandbox.airwallex.com/api/v1`), with test money. The client refuses any other base URL (`src/airwallex/client.ts`).

**Sandbox only** marks a call that simulates what the sandbox cannot do by itself: a merchant's charge, a settlement, a deposit, an account's activation. These calls sit behind separate interfaces (`SandboxSim`, `IssuingSim`), so no production path can reach them.

## The runs of record

| Date | Run | Record |
|---|---|---|
| 3 Nov | The main run | [log](runs/2026-11-03-main-run.md), [record](demo/main-run.json); read back on 6 Nov: [transfer](runs/airwallex-transfer-approval-2026-11-06.json), [cards](runs/airwallex-cards-2026-11-06.json) |
| 7 Nov | The Airwallex-only run: cards, declines, webhooks, FX, SWIFT | [log](runs/2026-11-07-awx-1.md), [record](demo/airwallex-run.json) |
| 7 Nov | The Airi run: a single-use card credential | [log](runs/2026-11-07-vic-1.md), [record](demo/airi-run.json) |
| 10 Nov | Connected accounts: a payout with Purser's fee | [log](runs/2026-11-10-connected-accounts-sandbox.md) |
| 10 Nov | Three test companies on connected accounts | [log](runs/2026-11-10-platform-e2e.md), [facts](runs/2026-11-10-platform-e2e/facts.json), [calls](runs/2026-11-10-platform-e2e/calls.jsonl) |
| 10 Nov | Payment acceptance: an invoice paid by test card | [log](runs/2026-11-10-payment-acceptance-sandbox.md) |
| 10 Nov | Two locks: Airwallex's approval workflow | [log](runs/2026-11-10-airwallex-two-locks.md) |

Runs of 29 and 30 October are cited only where no later run shows the step, each with its date. Every live run: [docs/runs/README.md](runs/README.md).

## The Airwallex-only run (7 November)

One fresh world on the Airwallex sandbox only: 0 Metal calls, test money, all seven checks passed. [Log](runs/2026-11-07-awx-1.md), [record](demo/airwallex-run.json), [plan and call budget](runs/awx-1-plan.md). Shown on `/airwallex`.

| Step | What Airwallex did | Ids |
|---|---|---|
| a | 3 virtual cards issued with the policy's `PER_TRANSACTION` and `MONTHLY` limits, merchant category, EUR only and `active_to`; each read back with `GET /issuing/cards/{id}` | ····2441 (Sourcing, 30.00 / 100.00, MCC 5734), ····4175 (Support, 60.00 / 150.00, MCC 7372), ····1562 (Treasury, 25.00 / 50.00, MCC 5734) |
| b | 19.99 EUR at Packwise approved | `01a1b5e8-5933-7000-94c1-0a9d4115f515` |
| c | 45.00 EUR over the 30.00 limit declined `LIMIT_EXCEEDED`. The Sourcing agent (Claude Haiku) asked the CFO for a raise (P-0001) instead of retrying. After Max's Face ID (12:11:01 UTC) `POST /issuing/cards/{id}/update` set 45.00, and the same charge was approved | `01a1b5e8-6dc2-7000-95bf-c8fc5e6e2f38` (declined), `01a1b5eb-5c54-7000-8227-1f077fc047f5` (approved) |
| d | 19.99 EUR (MCC 5734) on the Support card (MCC 7372 only) declined `MERCHANT_CATEGORY_NOT_ALLOWED`; the Support agent asked for no raise | `01a1b5eb-6784-7000-8bb2-ecf137506d3f` |
| e | 21 webhooks, each signature checked by the relay and the runner, all agreeing with the ledger; every card transaction was recorded from them (card poll off) | event ids in the record |
| f1 | SLL-2026-11, EUR 240.00: free EUR 1,500.00 covers the 260.00 needed (with the fee ceiling), so no quote and no conversion; SWIFT after Max's Face ID (12:12:20 UTC) | transfer `738a4263-6d6c-4de8-94a3-93da1c175fb4`, PAID, fee EUR 13.50 |
| f2 | BTX-2026-11, EUR 1,850.00: free EUR 1,246.50 is less than the 1,870.00 needed, so a quote for the shortfall only: EUR 623.50 for USD 704.45 at 1.129833 (market 1.128941, 8 bps over). The proposal expired at 12:27:03, 30 seconds before the quote. Conversion, then SWIFT after Max's Face ID (12:13:16 UTC) | quote `1605354b-5f6f-3ab5-8dbc-3af479c54b33`, conversion `fafcc208-bd1e-43d9-bd09-69191a8aa81f` (SETTLED), transfer `4140dee2-6373-4eb4-a71f-bf69130f96a7`, PAID, fee EUR 13.50 |
| g | Each payout's `metadata.approval_sha256` is the hash of the terms Max signed. `npm run verify` read both back (`GET /transfers`, `GET /fx/conversions`): all checks pass. `npm run reconcile`: 0 differences | P-0002 `b0f075d9…`, P-0003 `68f85b99…` |

71 Airwallex API calls (run budget: 96; 85 expected). Simulated by the sandbox: the merchants' charges and each payout's SENT and PAID. Every approve, decline, code, limit, quote and rate is Airwallex's own.

## The hash the CFO signed, in Airwallex's own record (main run, 3 November)

In the main run the Treasury agent planned P-0005: pay invoice SLL-2026-11, EUR 240.00, by SWIFT. Max approved the exact terms with Face ID at 11:31:18 UTC. [Log](runs/2026-11-03-main-run.md), [record](demo/main-run.json).

| | Value | Where it is |
|---|---|---|
| The hash the CFO signed | `797d4483594fc4f6585466f39bb3f9e4ad4200c85b82d5b7dc078527dcababcd` | The record's `proposal.approved` row for P-0005 |
| `metadata.approval_sha256` at Airwallex | `797d4483594fc4f6585466f39bb3f9e4ad4200c85b82d5b7dc078527dcababcd` | Transfer `03360bfa-afce-457b-89d1-e1097fbe3985`, PAID, fee EUR 13.42, as `GET /transfers/{id}` returned it on 6 November: [read-back](runs/airwallex-transfer-approval-2026-11-06.json) |

Match: the same hash. Anyone who can read Airwallex's record can check that this payout is the one the CFO signed. `npm run verify` makes that comparison and also fails on a different amount, quote or fee (`src/airwallex/verify.ts`).

**FX for the shortfall only, with the quote inside the signed terms.** The payment needed EUR 260.00 (240.00 plus a fee ceiling of 20.00). Free EUR was 150.00, so only EUR 110.00 was bought, for USD 124.29. The signed terms in the record hold `conversion.quote_id` `f6a63046-6e8c-3eee-9098-e3c605832015` and `conversion.valid_to` 2026-11-03T11:45:31Z, and the proposal itself expired 30 seconds earlier. A new quote would mean a new hash and a new Face ID. Conversion `3ca88196-05da-4d88-9caa-796f03704636` was booked before the transfer was created.

Simulated in this run: SENT and PAID were set through the sandbox's simulation API.

## The Airi run (7 November)

The Sourcing agent buys at our own Airwallex sandbox merchant with a single-use card credential from Airwallex's Airi wallet (airi-cli 0.1.0-beta.4, Airi's test card visa •••• 1111, test money; 0 Metal calls, 0 Claude calls). All five checks passed, in the second attempt in its world. [Log, with every failed attempt](runs/2026-11-07-vic-1.md), [record](demo/airi-run.json).

| Purchase | What happened | Ids |
|---|---|---|
| A, EUR 12.00 | Within the CFO's limit for this rail (EUR 20.00): scripted, no Claude call, no Purser approval. Purser opened the order, Airi created the mandate, the CFO confirmed it once in Airi, and the agent typed the card into Airwallex's Hosted Payment Page: SUCCEEDED | PaymentIntent `int_sgpvzc9hjhnxvpblt2r`, mandate `mdt_nlpdgv8gqhnxvpbv09m` |
| B, EUR 45.00 | Above the limit: P-0002 waited for Max's Face ID on its exact terms (14:05:02 UTC). Then the same path: SUCCEEDED | PaymentIntent `int_sgpvzc9hjhnxvxc26ie`, mandate `mdt_nlpdgv8gqhnxvxcjxbv`, terms `8bbfffc9…` |
| C, EUR 5.00 | A merchant the CFO does not allow: refused by Purser, `PURSER_MERCHANT_NOT_ALLOWED`, before any call to Airi or Airwallex | — |

Not shown: a real card or a real shop. The credential comes from Airi's test card, and the merchant is our own sandbox account. A second run that day made 0 Airwallex calls and shows what Purser refuses around the rail ([log](runs/2026-11-07-vic-2.md)). The endpoints are under "Payment acceptance".

## How Purser talks to Airwallex

- One client holds the client id, the API key and the bearer token.
- `POST /authentication/login` sends `x-client-id` and `x-api-key` as headers and gets a 30-minute token. The client refreshes it five minutes early.
- Calls run one at a time, at most one per 200 ms: half of the sandbox limit per endpoint. A 429 is retried with backoff (up to 4 times).
- A `POST` that gets no answer is never resent blindly. It becomes "ambiguous" and is looked up by its `request_id` or its nickname.
- Amounts are major units at the API. Purser turns them into integer cents at one boundary (`src/airwallex/adapter.ts`).
- Evidence: `test/airwallex-client.test.ts`, `test/airwallex-adapter.test.ts`.

## Issuing

Each agent has a DELEGATE cardholder and one virtual Visa card. The CFO policy sets the card's limits. Airwallex enforces them. Agents never see the card number or CVV, and no call asks for them.

Run of record: [the Airwallex-only run](runs/2026-11-07-awx-1.md). The main run's cards were read back on 6 November with the controls Airwallex holds ([read-back](runs/airwallex-cards-2026-11-06.json)).

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /issuing/cardholders` | Finds an agent's cardholder by email. | Avoids a second cardholder, and so a second card with its own limits. | 7 Nov run: 3 calls; `test/cards.test.ts` |
| `POST /issuing/cardholders/create` | Creates a DELEGATE cardholder for each agent. | A card can only be issued to a cardholder. | Not among the 7 November calls. Only an earlier rehearsal of 29 October shows it ([log](runs/2026-10-29-cards.md)). |
| `GET /issuing/cards` | Finds an agent's card by cardholder and nickname. | A lost answer is settled by a look-up, not by issuing another card. | 7 Nov run: 4 calls; `test/cards.test.ts` |
| `POST /issuing/cards/create` | Issues a VIRTUAL card with `authorization_controls`: `PER_TRANSACTION` and `MONTHLY` limits from the CFO policy. Also single-use task cards (`allowed_transaction_count: SINGLE`). | The card is the control. Airwallex declines any purchase over the limit, whatever the agent does. | 7 Nov run: 3 calls. Task cards: run of 30 October ([log](runs/2026-10-30-single-use.md)), a second charge declined `CARD_CLOSED`. |
| `GET /issuing/cards/{id}` | Reads the card back after every change. | A limit is only real if Airwallex holds it. A drift is corrected from the policy. | 7 Nov run: 8 calls; `test/cards.test.ts` |
| `POST /issuing/cards/{id}/update` | Sets new limits when the CFO approves a policy change. Sets `card_status` to `INACTIVE` or `ACTIVE` for the emergency stop. | Raising or lowering what an agent can spend is a financial decision. | 7 Nov run: 1 call (30.00 to 45.00 after Face ID). The stop is tested against stand-ins only (`test/freeze.test.ts`). |
| `GET /issuing/transactions` | Records each card transaction once, by `card_transaction_id`. | The ledger must show what Airwallex approved and declined. | 7 Nov run: 6 calls; `test/issuing-adapter.test.ts` |
| `POST /simulation/issuing/create` (**sandbox only**) | Simulates a merchant's charge. | A sandbox has no real merchants. The approve or decline that follows is Airwallex's own. | 7 Nov run: 4 calls |

In the main run the Sourcing agent's card was raised from 30.00 to 46.00 after Face ID (P-0006), and Airwallex then approved EUR 45.00 on it: `01a1a12f-4113-7000-b76d-014677710007` ([log](runs/2026-11-03-main-run.md)). A card for an outside agent, issued only after Face ID, is shown only by an earlier rehearsal of 29 October ([log](runs/2026-10-29-agent-api.md)).

## Webhooks

Airwallex tells the relay about each change. The relay checks the signature and keeps the event. The runner checks it again with its own copy of the secret, because it trusts no relay. A webhook never approves, pays, thaws a card or changes a limit.

Runs of record: the subscription was made on 30 October with 23 events ([log](runs/2026-10-30-webhooks.md)); `conversion.overdue` is left out, because the key lacks that permission. On 7 November [the Airwallex-only run](runs/2026-11-07-awx-1.md) received 21 events, all agreeing with the ledger.

| Object | Events | What the runner does with it |
|---|---|---|
| Card transaction | `issuing.card_transaction_event.*`, `issuing.transaction.*` | Books Airwallex's approve or decline once. |
| Card | `issuing.card.active`, `.inactive`, `.closed`, `.blocked`, `.lost`, `.stolen` | Flags a card live at Airwallex while the policy has it frozen. |
| Payout, conversion | `payout.transfer.*`, `conversion.*` | Compares with the ledger. One that Purser did not make is flagged. |
| Deposit | `deposit.pending`, `.settled`, `.rejected`, `.reversed` | A settled deposit goes to the receivables agent, which books it once. |

A flagged event stands as the `airwallex_disagrees` alarm in `/health` for a day (`src/policy/airwallexEvents.ts`, `test/airwallex-events.test.ts`). The code's list also holds the approval events (`payout.transfer.in_approval` and the three that end it) and `payment_intent.succeeded`. They need a new subscription, and no recorded run has received one.

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /webhooks` | Lists subscriptions, so setup does not subscribe twice. | A duplicate subscription would deliver every event twice. | 7 Nov run: 1 call |
| `POST /webhooks/create` | Subscribes the relay's `/hooks/airwallex`. The signing secret in the answer is stored and never printed. | The CFO sees a card decision within seconds. | Run of 30 October |
| `POST /webhooks/{id}/delete` | Removes the old subscription once the new one is in place. | Two subscriptions would deliver every event twice. | Run of 30 October |

How a delivery is checked (`worker/src/core.ts`, `test/relay-hooks.test.ts`): HMAC-SHA256 over `x-timestamp` plus the raw body, before anything parses it. A timestamp more than five minutes off is refused. The relay keeps one row per event id.

## FX: rates, quotes with expiry, conversions

The Treasury agent converts only the shortfall, fee included, and only if USD stays above its floor. Runs of record: [the Airwallex-only run](runs/2026-11-07-awx-1.md) (step f2) and the main run (above).

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /fx/rates/current` | Checks the quote against the market's rate. A quote more than 0.50% dearer is escalated. | It stops a bad quote reaching the phone. | 7 Nov run: 1 call |
| `POST /fx/quotes/create` | Locks a rate (`validity` `MIN_15`). The quote id, the rate and `valid_to_at` go into the terms the CFO approves. | Without a locked rate the CFO would approve an amount that can move. | 7 Nov run: 1 call |
| `POST /fx/conversions/create` | Books the conversion on the approved quote, with a `request_id` and `metadata.approval_sha256`. | This moves company money between currencies, only after Face ID on the exact terms. | 7 Nov run: 1 call |
| `GET /fx/conversions` | Reads the conversion back for `npm run verify`. | An auditor can check that Airwallex booked what the CFO approved. | 7 Nov run: 1 call |

The rules in code (`src/policy/treasury.ts`, `src/agents/euroBill.ts`):

- **Only the shortfall.** The need is the invoice plus a fee ceiling of EUR 20.00. Free EUR is the balance minus the floor and what is already committed. Only the difference is bought.
- **Fee-aware.** The kit says the SWIFT fee is a flat EUR 12.85. Airwallex charged EUR 13.42 in the main run and EUR 13.50 on 7 November. The ceiling absorbs that; `npm run verify` fails a fee above it.
- **Above the reserve floor.** A quote is usable only if selling its USD keeps USD at or above its floor. If not, the agent escalates and moves nothing. Only an earlier rehearsal of 29 October shows that ([log](runs/2026-10-29-f4.md)).
- **Quote expiry.** A proposal expires 30 seconds before its quote does. A late approval approves nothing. Only an earlier rehearsal of 29 October shows a late approval ([log](runs/2026-10-29-f1.md)).
- **Single use.** A quote is booked once, under one `request_id`. Airwallex would accept it again under a new one, so our code enforces this (`src/executors/invoicePayment.ts`).

## Beneficiaries

Only an allowlisted beneficiary can be paid. The allowlist is in the ledger; an agent cannot change it. Runs of record: [the Airwallex-only run](runs/2026-11-07-awx-1.md) and [the three test companies](runs/2026-11-10-platform-e2e.md).

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /beneficiaries` | Finds a beneficiary by IBAN, so an invoice is checked against the account at Airwallex. | A payout goes to an account on file or it does not go. | 7 Nov run: 2 calls |
| `POST /beneficiaries/schema`, `POST /beneficiaries/validate` | Reads the required fields, then validates the bank details before create. | A wrong IBAN would send money to the wrong place. | 10 Nov, for each of four suppliers |
| `POST /beneficiaries/create` | Adds a supplier (setup), or the new account after an approved bank-detail change. | A transfer needs a `beneficiary_id`. | 10 Nov: four SEPA beneficiaries, the first `e8599d32-5f16-42e6-842c-f7356d5de239` |

A supplier's bank-detail change takes three steps (`src/policy/payeeChange.ts`): a request that changes nothing; a person records that the supplier confirmed the account on a contact already on file; a proposal with the full new IBAN, approved with Face ID. It has tests only (`test/payee-change.test.ts`). Before any of this, code blocks an invoice with changed bank details (`src/policy/fraud.ts`, `test/fraud.test.ts`); only an earlier rehearsal of 29 October shows that live ([log](runs/2026-10-29-fraud.md)).

## Transfers: SWIFT, status to PAID

Runs of record: [the Airwallex-only run](runs/2026-11-07-awx-1.md) (two payouts) and the main run (above).

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `POST /transfers/create` | Pays the invoice: `request_id`, `beneficiary_id`, amount, currency, `transfer_method`, `reference`, `reason`, `metadata.approval_sha256`. | This is money leaving the company. It runs once, after Face ID, on the approved terms only. | 7 Nov run: 2 calls |
| `GET /transfers` (by `request_id`) | Finds a transfer after a lost answer, and reads it back in `npm run verify`. | A payment must never be paid twice. | 7 Nov run: 2 calls; `test/euroBill.test.ts` (a lost answer is adopted, not repaid) |
| `GET /transfers/{id}` | Reads the status and the fee Airwallex charged. | The fee is only known after the charge. | 7 Nov run: 8 calls |
| `POST /simulation/transfers/{id}/transition` (**sandbox only**) | Moves the transfer to SENT, then PAID. | The sandbox does not settle by itself. In the logs, PAID comes from this call. | 7 Nov run: 4 calls |

- One invoice has at most one live payout. The Treasury agent's advice sits outside the hash and cannot change what is paid.
- **For the bank and the ERP.** `npm run iso20022` exports a paid invoice as a pacs.008 message with Airwallex's transfer id as the UETR. The example is from a rehearsal of 30 October: [`docs/iso20022/pacs008-BTX-2026-11.xml`](iso20022/pacs008-BTX-2026-11.xml). It is not a message a bank sent.

## Transfer approvals

Airwallex has its own lock, which Purser does not control: a transfer approval workflow in the web app that also holds API-created transfers. A payout then needs two approvals that do not depend on each other: the CFO's signature in Purser, and a person in Airwallex's web app. Airwallex docs: [Manage approvals for transfers](https://www.airwallex.com/docs/payouts/transfers/manage-transfers/manage-approvals-for-transfers), [Transfer statuses](https://www.airwallex.com/docs/payouts/transfers/create-a-transfer/transfer-statuses).

Run of record: [two locks on one payout, 10 November](runs/2026-11-10-airwallex-two-locks.md).

| Lock | What the record shows |
|---|---|
| 1. Signed in Purser | Proposal P-0001, EUR 240.00 by SWIFT, signed by a labelled virtual test passkey (no person's Face ID in this run). Terms hash `f9ba0fe8758eadbef3b48f23e571ea92e3208f4ebd802703b413a414d444ac28`. |
| 2. Held at Airwallex | `POST /transfers/create`, once: transfer `4074d684-4704-406c-a527-2832753baf4f`, answered `IN_APPROVAL`, with the signed hash in its metadata. A read-back a few minutes later still said `IN_APPROVAL`. Purser did not simulate past it and did not send it again. |
| 3. Approved in the web app | State at the time of writing, 12 November, in the record's words: "Not completed." and "It stays `IN_APPROVAL`: without a person approving it in Airwallex it cannot be paid." The record is updated if that changes; the record is what counts. |

What Purser does with the wait (`src/airwallex/approvals.ts`, `test/airwallex-approvals.test.ts`): it follows the transfer with `GET /transfers/{id}` and only reads. `SCHEDULED` and then `PAID` are booked; `APPROVAL_REJECTED`, `APPROVAL_RECALLED` and `APPROVAL_BLOCKED` are shown as not paid. If the amount at Airwallex no longer matches what the CFO signed, Purser raises an alarm and does not book it.

## Connected accounts and application fees

As a platform, Purser opens an Airwallex account for a company (a connected account) and pays that company's suppliers on its behalf, with the header `x-on-behalf-of`. The money stays in the company's own wallet. Purser's fee goes with the payout as an application fee. Built after the kit, behind `AIRWALLEX_PLATFORM=on` ([design](airwallex-platform.md)). Airwallex docs: [About connected accounts](https://www.airwallex.com/docs/connected-accounts/about/about-connected-accounts), [Platform relationships](https://www.airwallex.com/docs/connected-accounts/about/platform-relationships), [Create connected account](https://www.airwallex.com/docs/api/scale/accounts/create).

Runs of record, both 10 November: [connected accounts](runs/2026-11-10-connected-accounts-sandbox.md) and [three test companies](runs/2026-11-10-platform-e2e.md) ([facts](runs/2026-11-10-platform-e2e/facts.json), [calls](runs/2026-11-10-platform-e2e/calls.jsonl)). The companies are fake. Approvals in the second run were signed with a test passkey, not Face ID; the first run's payout had no Face ID ([runs list](runs/README.md)).

| Endpoint | What Purser uses it for | What the run shows |
|---|---|---|
| `POST /accounts/create` | Opens the company's account. | `acct_SC-QD89fOneAeqaRFgOymw`, `CREATED` |
| `POST /accounts/{id}/update`, `POST /accounts/{id}/submit` | Sends the company's verification details, then submits them. | `SUBMITTED` |
| `POST /simulation/accounts/{id}/update_status` (**sandbox only**) | Makes a submitted test account `ACTIVE`. In production Airwallex verifies the company. | `ACTIVE`. Two more accounts the same way: `acct_O07lI0VvMLagXlj5aeOgyg`, `acct_XFhJLpkwNp6lzl8rpySE_Q` |
| `POST /connected_account_transfers/create` | Funds a test account from the platform (test money). | EUR 20.00, `tr_oZIJlT2oNQ2OX33f83UCag` |
| With `x-on-behalf-of`: the beneficiary and transfer calls above | The payout, from the company's own wallet. | Below |

Purser's fee is one `FIXED` entry in `application_fee_options` on `POST /transfers/create`: the exact amount in the signed terms, at most 100 basis points of the payout (`FEE_BPS_CAP`). It is counted as taken only when that payout is PAID.

| Payout | Method | Result | Purser's fee | Airwallex's fee |
|---|---|---|---|---|
| `a9460dba-f31b-4111-be58-6d9a9e71adb1`, EUR 5.00 | SWIFT | PAID | EUR 0.05, accepted by Airwallex in `application_fees` | EUR 13.41 |
| `593c340b-1752-4537-9ef2-0eb3558897cc`, EUR 4.84 | SEPA | PAID | EUR 0.02, to the platform account `acct_op0_QItiOyWKsYb5pwQihA` | EUR 2.69 |
| 3 payouts from the two new accounts | SEPA | Refused by Airwallex at create | Not taken | None |

Both PAID results came through the sandbox's settlement simulation. The SEPA payout's terms name the paying account and the fee, and its receipt verifies offline ([log](runs/2026-11-10-platform-e2e.md)).

The refusals, as the record gives the cause: `400 validation_failed`, source `payer.additional_info.business_registration_number`. The two new accounts were opened as non-registered sole traders, and a payout from them needs the payer's registration number. A retry with a test number in a `payer` object was refused too (field `payer`, code 048), so the number has to come from the account itself. A company opened with a registration number has not been tried yet.

Not confirmed by any run: whether a live PAID answer carries `application_fees`, where the fee shows in the platform's balance, and the `account.*` webhooks.

## Payment acceptance

Money in by card: a PaymentIntent for an order, paid by card, booked only after Airwallex itself reports `SUCCEEDED`. Airwallex docs: [Create a PaymentIntent](https://www.airwallex.com/docs/api/payments/payment_intents/create), [Hosted Payment Page](https://www.airwallex.com/docs/payments/integration-options/web-checkout/hosted-payment-page).

Runs of record: [payment acceptance, 10 November](runs/2026-11-10-payment-acceptance-sandbox.md), and [the Airi run, 7 November](runs/2026-11-07-vic-1.md).

| Endpoint | What Purser uses it for | What the run shows |
|---|---|---|
| `POST /pa/payment_intents/create` | Opens the order: amount, currency, `merchant_order_id`, a `request_id` unique per order. No card. | 10 Nov: invoice NW-R-PA1, EUR 24.90, `int_sgpv9bnppho0sezgl4a`, `REQUIRES_PAYMENT_METHOD`. 7 Nov: `int_sgpvzc9hjhnxvpblt2r`, `int_sgpvzc9hjhnxvxc26ie` |
| `POST /pa/payment_intents/{id}/confirm` | Confirms with Airwallex's documented test card (`src/airwallex/acceptance.ts`). No other card number is accepted. | 10 Nov: 200. On 7 November the same call was refused for our sandbox ("This account is not enabled for native API access"). |
| Airwallex's Hosted Payment Page (not an API call) | In the Airi run the agent types the card from Airi's credential into Airwallex's own page, like a shopper (`src/airi/hostedCheckout.ts`). | 7 Nov: both purchases |
| `GET /pa/payment_intents/{id}` | Reads the real outcome. Purser books from this answer, not from the confirm's. | 10 Nov: `SUCCEEDED`, card ending 0008. 7 Nov: `SUCCEEDED` twice |

On 10 November Purser matched the receipt to invoice NW-R-PA1 by `merchant_order_id` and recorded it once, under the PaymentIntent id. 4 Airwallex calls of the 15 approved.

Not shown by any run: a `payment_intent.succeeded` webhook, settlement of the card money into the wallet, and a live decline. The webhook and the decline have tests only (`test/payment-acceptance.test.ts`).

## Deposits and balances

Run of record: [the Airwallex-only run](runs/2026-11-07-awx-1.md); for the deposit, [the main run](runs/2026-11-03-main-run.md).

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /balances/current` | Reads cash balances. Only `available_amount` counts as spendable. | The Treasury agent's plan depends on free EUR and USD above the floors. | 7 Nov run: 9 calls |
| `GET /deposits` | Finds a deposit by its `reference`. | Earnings are credited once the on-chain sweep is final. The reference is the Metal transaction hash. | 7 Nov run: 2 calls |
| `POST /simulation/deposit/create` (**sandbox only**) | Books the sweep as a deposit with the Metal transaction hash as `reference`. | The sandbox cannot receive stablecoins, so this step is **simulated**: 1 USDZ is booked as 1 USD. No real USDZ reaches Airwallex. | Main run: deposit `b3812e05-2afa-4698-8f64-429f9608e0a0`, SETTLED |

A credit is booked only after the sweep is final on Metal, and once per `chainId:tx:logIndex` (`test/euroBill.test.ts`).

## Global accounts

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /global_accounts` | Finds the active USD global account that receives deposits. | The USD balance that funds the euro invoice comes in through it. | `src/airwallex/adapter.ts` |
| `POST /global_accounts/create` | Creates a US, USD, LOCAL account once, only if none exists; a GB, GBP account the same way. | Without the account there is nowhere to book the money. | `src/cli/receivables.ts`; run of 30 October |

**Receivables.** Retailers pay Northwind's invoices into its EUR and GBP accounts. The receivables agent (`src/agents/receivables.ts`) matches each settled deposit once to an open invoice and escalates a short payment or one with no invoice to the CFO. It moves no money. Live in the sandbox on 30 October ([log](runs/2026-10-30-receivables.md)), with the retailers' payments simulated by `POST /simulation/deposit/create`: two deposits matched (`50f623ac…`, `95fcf339…`), one short by 10.00 EUR and one with no invoice, both escalated (`5a6323a6…`, `acf543d2…`).

## Best practices we follow

- **Idempotency keys on every money movement.** Each conversion and each transfer carries a `request_id` (a UUID) fixed inside the approved terms. A lost answer is looked up by it, never resent with a new one (`test/euroBill.test.ts`, `test/cards.test.ts`).
- **Tracing each payment to agent, task and policy rule.** Airwallex holds the approval hash and its own ids. Our ledger ties them to the agent, the purpose, the rule that sent the decision to a person, and who decided (`src/accounting/gl.ts`, `test/gl-export.test.ts`). Limits: one card per agent, not per task; the purpose is in our ledger, not at Airwallex.
- **Read-backs.** `npm run data-qa` checks every payment the ledger shows against Airwallex with GET requests only (`src/finance/dataQa.ts`, `test/data-qa.test.ts`).
- **Secrets.** The API key never reaches a model. Logged bodies are redacted. Card numbers and CVVs are never requested (`test/redact.test.ts`, `test/adversarial.test.ts`).

## The scoped key

Purser should run on scoped API keys. Airwallex lets each key have Read or Write per resource: Read covers `GET`, Write covers `GET` and `POST` ([manage API keys](https://www.airwallex.com/docs/developer-tools/api/manage-api-keys), [API key best practices](https://www.airwallex.com/docs/developer-tools/api/api-key-best-practices)).

There are two roles. The code reads either key from the same two variables (`AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`); the account a key belongs to decides its role. The permissions below are derived from the endpoints the run logs show ([7 November](demo/airwallex-run.json), [10 November](runs/2026-11-10-platform-e2e/calls.jsonl)). The owner creates the keys in the Airwallex web app, where the names may differ a little.

### The company key

The key of a company's own Airwallex account, as in the main run and on 7 November.

| Resource | Endpoints | Permission |
|---|---|---|
| Login | `POST /authentication/login` | Every key |
| Balances | `GET /balances/current` | Read |
| Global accounts | `GET /global_accounts`; `POST /global_accounts/create` (once, at setup) | Read; Write only until the account exists |
| Deposits | `GET /deposits` | Read |
| Beneficiaries | `GET /beneficiaries`; `POST /beneficiaries/schema`; `POST /beneficiaries/validate`; `POST /beneficiaries/create` | Write |
| FX | `GET /fx/rates/current`; `POST /fx/quotes/create`; `POST /fx/conversions/create`; `GET /fx/conversions` | Write |
| Transfers | `POST /transfers/create`; `GET /transfers`; `GET /transfers/{id}` | Write |
| Issuing | `GET /issuing/cardholders`; `POST /issuing/cardholders/create`; `GET /issuing/cards`; `POST /issuing/cards/create`; `GET /issuing/cards/{id}`; `POST /issuing/cards/{id}/update`; `GET /issuing/transactions` | Write |
| Webhooks | `GET /webhooks`; `POST /webhooks/create`; `POST /webhooks/{id}/delete` | Write at setup, then none |
| Payment acceptance (Airi rail, or `AIRWALLEX_PAYMENT_ACCEPTANCE=on`) | `POST /pa/payment_intents/create`; `POST /pa/payment_intents/{id}/confirm`; `GET /pa/payment_intents/{id}` | Write |
| Sandbox simulation | `POST /simulation/issuing/create`; `POST /simulation/transfers/{id}/transition`; `POST /simulation/deposit/create` | Write (sandbox only) |

This key needs no permission for sensitive card details, users, roles, API keys, settings or billing, and none for connected accounts: it acts for its own account only.

### The platform key

The key of Purser's own platform account. It opens connected accounts and acts for one of them when a call carries `x-on-behalf-of`. It does need connected accounts: Airwallex enabled them on our sandbox on 10 November, and a day earlier `POST /accounts/create` was refused.

| Resource | Endpoints | Permission |
|---|---|---|
| Login | `POST /authentication/login` | Every key |
| Connected accounts | `POST /accounts/create`; `POST /accounts/{id}/update`; `POST /accounts/{id}/submit`; `GET /reference/industry_categories` | Write |
| Funding a test account | `POST /connected_account_transfers/create` | Write |
| On behalf of a connected account | `GET /balances/current`; `GET /beneficiaries`; `POST /beneficiaries/schema`; `POST /beneficiaries/validate`; `POST /beneficiaries/create`; `POST /transfers/create` (with `application_fee_options`); `GET /transfers/{id}` | Write |
| FX rate | `GET /fx/rates/current` | Read |
| Sandbox simulation | `POST /simulation/accounts/{id}/update_status`; `POST /simulation/transfers/{id}/transition` | Write (sandbox only) |

Built and not yet called in a recorded run: `GET /accounts/{id}`, `POST /hosted_flows/create` and `POST /hosted_flows/{id}/authorize` (`src/airwallex/platform.ts`).

Whoever holds this key can call Airwallex for any connected account. In this build the runner holds it, and a binding signed by Purser Cloud keeps it to its own company's account (`src/airwallex/binding.ts`). Before production, a service Purser holds makes every on-behalf-of call. That is open ([go-live list](go-live.md)).

### Checks

- Airwallex enforces key scope. On 30 October the key was refused the event `conversion.overdue` with `401 Insufficient permissions` ([log](runs/2026-10-30-webhooks.md)). Only an earlier rehearsal of 29 October shows the same for `GET /webhooks` ([log](runs/2026-10-29-cards.md)).
- After a key is created, run `npm run health`. Any `401 Insufficient permissions` names the missing permission.
