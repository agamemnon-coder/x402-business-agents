# Airwallex in Purser

This page lists every Airwallex API that Purser calls. For each one it gives the method and path (as in `src/airwallex/*.ts`), what Purser uses it for, why that is a necessary financial action, and the proof.

All calls go to the Airwallex sandbox (`https://api.sandbox.airwallex.com/api/v1`). The client refuses any other base URL (`src/airwallex/client.ts`).

Two marks are used in the tables:

- **Sandbox only.** The call exists to simulate something the sandbox cannot do by itself. Purser keeps these calls behind separate interfaces (`SandboxSim`, `IssuingSim`), so no production path can reach them.
- † The proof comes from the 29 October rehearsals with the earlier example company (Tidemark Data). The Friday 30 October runs with Northwind Outdoor repeated these steps live (Friday run 1: cards •••• 8120, 6882, 7786; conversion `08736b6e…`; SWIFT transfer `4d508b0b…`, fee EUR 13.41); each of those ids was re-read from the sandbox, read-only, on 30 October.

Run logs are in `docs/runs/`. Tests are in `test/`.

## How Purser talks to Airwallex

- One client holds the client id, the API key and the bearer token. Nothing else does.
- `POST /authentication/login` sends `x-client-id` and `x-api-key` as headers and gets a 30-minute token. The client refreshes it five minutes early.
- Calls run one at a time, at most one per 200 ms. That is half of the sandbox limit per endpoint. A 429 is retried with backoff (up to 4 times).
- A `POST` that gets no answer is never resent blindly. It becomes "ambiguous" and is looked up by its `request_id` or its nickname.
- Amounts are major units at the API. Purser turns them into integer cents at one boundary (`src/airwallex/adapter.ts`) and nowhere else.
- Evidence: `test/airwallex-client.test.ts`, `test/airwallex-adapter.test.ts`.

## Issuing

Each agent has a DELEGATE cardholder and one virtual Visa card. The CFO policy sets the card's per-transaction and monthly limits. Airwallex enforces them. Agents never see the card number or CVV, and no call asks for them.

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /issuing/cardholders` | Finds an agent's cardholder by email, so setup runs only once. | Avoids a second cardholder, and so a second card with its own limits, for the same agent. | `test/cards.test.ts` (issues once; adopts an existing card) |
| `POST /issuing/cardholders/create` | Creates a DELEGATE cardholder for each agent. | A card can only be issued to a cardholder. DELEGATE is the type for someone who spends on the business's behalf. | `docs/runs/2026-10-29-cards.md` † |
| `GET /issuing/cards` | Finds an agent's card by cardholder and nickname. | Lets a lost answer be settled by a look-up, not by issuing another card. | `test/cards.test.ts` |
| `POST /issuing/cards/create` | Issues a VIRTUAL, commercial card with `authorization_controls`: `PER_TRANSACTION` and `MONTHLY` limits set from the CFO policy. Also issues the card an outside agent asks for, after Face ID, and single-use task cards from Ask Purser (`allowed_transaction_count: SINGLE`, one merchant category, an end date). | The card is the control. Airwallex declines any purchase over the limit, whatever the agent does; a task card closes itself after its one purchase. | `docs/runs/2026-10-29-cards.md` † (three cards); `docs/runs/2026-10-29-agent-api.md` † (card issued only after Face ID on P-0011); `docs/runs/2026-10-30-single-use.md` (three task cards: a second charge declined `CARD_CLOSED`, a wrong merchant `MERCHANT_CATEGORY_NOT_ALLOWED`) |
| `GET /issuing/cards/{id}` | Reads the card back after every change and every few seconds. Purser trusts what Airwallex reports, not what it asked for. | A limit is only real if Airwallex holds it. A drift is corrected from the policy. | `test/cards.test.ts` ("brings its limits back to the policy") |
| `POST /issuing/cards/{id}/update` | Two uses. (1) Sets new limits when the CFO approves a policy change. (2) Sets `card_status` to `INACTIVE` or `ACTIVE` for the emergency stop. | Raising or lowering what an agent can spend is a financial decision. The stop freezes every card at once. | `docs/runs/2026-10-29-cards.md` † (raise 30.00 to 50.00 after Face ID, then the same 45.00 purchase was approved). The stop is covered by `test/freeze.test.ts`. A live `CARD_INACTIVE` decline is in `docs/runs/2026-10-30-single-use.md` (after Purser set a task card INACTIVE); the emergency stop itself is tested against stand-ins only. |
| `GET /issuing/transactions` | Polls each card's transactions every few seconds and records each one once, by `card_transaction_id`. | The ledger must show what Airwallex approved and declined, or the CFO cannot rely on it. | `docs/runs/2026-10-29-cards.md` †; `test/cards.test.ts` (recorded once however it arrives); `test/issuing-adapter.test.ts` |
| `POST /simulation/issuing/create` (**sandbox only**) | Simulates a merchant's charge on an agent's card (amount, merchant, merchant category code). | A sandbox has no real merchants. The approval or decline that follows is Airwallex's own. The merchant's charge is the simulated part. | `docs/runs/2026-10-29-cards.md` † (19.99 EUR approved; 45.00 EUR declined `LIMIT_EXCEEDED`) |

## Webhooks

Airwallex tells the relay about each change as it happens. The relay checks the signature and keeps the event. The runner then checks the signature again with its own copy of the secret, because it trusts no relay.

**Live since 30 October** (`docs/runs/2026-10-30-webhooks.md`): one subscription with 23 events: card transactions, cards, payouts, conversions and deposits. `conversion.overdue` is left out: this key lacks the permission. Shown live: deposits matched by the webhook alone (EUR 300.00 matched in about 2 seconds; GBP 100.00 short by 20.00, escalated) and a card transaction in both of Airwallex's event shapes. Payout, conversion and card status events are subscribed but were not caused in that run; their checks are covered by tests.
How each object is handled (`src/policy/airwallexEvents.ts`, `test/airwallex-events.test.ts`). Each signed event is
recorded once and checked against the ledger:

| Object | Events | What the runner does with it |
|---|---|---|
| Card transaction | `issuing.card_transaction_event.*`, `issuing.transaction.*` | Books Airwallex's approve or decline once (as before). A transaction on a card that is no agent's is flagged. |
| Card | `issuing.card.active`, `.inactive`, `.closed`, `.blocked`, `.lost`, `.stolen` | Compares with the status the CFO policy wants. A card live at Airwallex while the policy has it frozen is flagged; a stricter status is not. |
| Payout | `payout.transfer.scheduled` … `.paid`, `.failed`, `.cancelled` | Compares with the ledger's transfer. A payout Purser did not make, or one paid in one place and failed in the other, is flagged. |
| Conversion | `conversion.scheduled`, `.overdue`, `.settled`, `.cancelled` | Compares with the ledger's conversion. A conversion Purser did not make is flagged. |
| Deposit | `deposit.pending`, `.settled`, `.rejected`, `.reversed` | A settled EUR or GBP deposit into one of Northwind's Global Accounts goes to the receivables agent, which books it once. The poll stays the backup. |

A flagged event stands as the `airwallex_disagrees` alarm in `/health` for a day, and shows on the dashboard. A webhook never
approves, pays, thaws a card or changes a limit. Airwallex cannot add events to an existing subscription (its update call
changes only the url), so adding events means a new subscription with a new signing secret:
`npm run cards -- webhook --replace`. That creates the new one, puts its secret on the relay and the runner, and only then
deletes the old one. It changes a secret, so it needs the CFO's go (given on 30 October).

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /webhooks` | Lists subscriptions, so setup does not subscribe twice. | A duplicate subscription would deliver every event twice. | `src/airwallex/webhooks.ts` |
| `POST /webhooks/create` | Subscribes the relay's `/hooks/airwallex` to the 23 events above (API version 2025-11-11); until 30 October, to the four card-transaction events only. The signing secret in the answer is stored and never printed. | The CFO sees a card decision within seconds, not at the next poll. | `docs/runs/2026-10-29-cards.md` † (live from 16:57: a merchant's own 9.00 EUR charge and a declined 61.00 EUR charge reached the ledger by webhook) |
| `POST /webhooks/{id}/delete` | Removes the old subscription once `--replace` has put the new one in place. | Two subscriptions would deliver every event twice, one signed with a secret nobody checks any more. | `docs/runs/2026-10-30-webhooks.md` (the 29 October subscription was deleted after the new one was in place) |

How a delivery is checked (`worker/src/core.ts`, `src/policy/cardHooks.ts`):

- The HMAC-SHA256 is computed over `x-timestamp` plus the raw body, as received, before anything parses it.
- A timestamp more than five minutes from our clock is refused.
- The relay keeps one row per event id and answers 200.
- An event only records what Airwallex decided. It moves no money.
- A card transaction is recorded once by its Airwallex id, whichever source sees it first.
- Evidence: `test/relay-hooks.test.ts`.

## FX: rates, quotes with expiry, conversions

The Finance agent pays a euro invoice from a USD balance. It converts only the shortfall, fee included, and only if USD stays above its floor.

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /fx/rates/current` | Checks the locked quote against the market's current rate before the CFO sees it; a quote more than 0.50% dearer is escalated to the CFO. | The CFO approves the quote; this check stops a bad one reaching the phone. | feed event `fx.rate_checked` |
| `POST /fx/quotes/create` | Locks a rate for the amount to buy (`buy_currency` EUR, `sell_currency` USD, `buy_amount`, `validity` `MIN_15`, or `MIN_1` in the late-approval test). The quote id, the rate and `valid_to_at` go into the terms the CFO approves. | Without a locked rate the CFO would approve an amount that can move before it is booked. | `docs/runs/2026-10-29-s3.md` † (quote `101475c7-493b-3442-9734-3b2c0ce83f6f`); `docs/runs/2026-10-29-f1.md` † |
| `POST /fx/conversions/create` | Books the conversion on the approved quote, with a `request_id` and `metadata.approval_sha256`. | This moves company money between currencies. It happens only after Face ID on the exact terms. | `docs/runs/2026-10-29-rehearsal-3.md` † (conversion `0650049f-acb1-476e-a72f-c4de56d5b7b1`, EUR 370.00); `docs/runs/2026-10-29-s3.md` †; `test/airwallex-adapter.test.ts` |
| `GET /fx/conversions` | Reads the conversion back by `request_id` for `npm run verify`: amount, quote and the approval hash in metadata. | An auditor can check that Airwallex booked what the CFO approved. | `src/airwallex/verify.ts`; `test/airwallex-verify.test.ts`; `docs/runs/2026-10-29-s3.md` † |

The rules in code (`src/policy/treasury.ts`, `src/agents/euroBill.ts`):

- **Only the shortfall.** The need is the invoice plus a SWIFT fee ceiling of EUR 20.00. Free EUR is the balance minus the EUR floor and what is already committed. Only the difference is bought. Rehearsal 3: EUR 1,870.00 needed, EUR 1,500.00 free, EUR 370.00 converted. †
- **Fee-aware.** The kit says the SWIFT fee is a flat EUR 12.85. Airwallex charged between EUR 13.40 and EUR 13.47 in our runs. The ceiling absorbs that. `npm run verify` fails a fee above the ceiling.
- **Above the reserve floor.** A quote is usable only if selling its USD keeps USD at or above its floor. If not, the agent escalates with options, asks for no approval and moves nothing (`docs/runs/2026-10-29-f4.md` †). If EUR is already below its floor plus commitments, it makes no plan and gets no quote.
- **Quote expiry.** A proposal expires 30 seconds before its quote does. A late approval approves nothing (`docs/runs/2026-10-29-f1.md` †). A new quote means a new hash and a new approval.
- **Single use.** A quote is booked once, under one `request_id`. Airwallex would accept the same quote under a new `request_id`, so the single use is enforced in our code (`src/executors/invoicePayment.ts`).

## Beneficiaries

Only an allowlisted beneficiary can be paid. The allowlist is in the ledger. An agent cannot change it.

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /beneficiaries` | Finds a beneficiary by IBAN, so an invoice is checked against the real account at Airwallex. | A payout goes to an account on file or it does not go. | `src/airwallex/adapter.ts`; `test/euroBill.test.ts` |
| `POST /beneficiaries/validate` | Reads `POST /beneficiaries/schema` for the required fields, then validates the bank details (DE, EUR, IBAN plus `swift_code`) with `POST /beneficiaries/validate` before create. | A wrong IBAN would send money to the wrong place. | `docs/runs/2026-10-29-s3.md` † |
| `POST /beneficiaries/create` | Adds the supplier as a SWIFT beneficiary (setup), or the new account after a bank-detail change. | A transfer needs a `beneficiary_id`. | `docs/runs/2026-10-29-s3.md` † (beneficiary `1322d7e4-5102-4858-ac2f-912d0ad5b999`) |

A supplier's bank-detail change takes three separate steps (`src/policy/payeeChange.ts`):

1. A request. It changes nothing.
2. A person records that the supplier confirmed the account on a contact already in our own records. An agent cannot do this.
3. A proposal with the full new IBAN and that verification, approved with Face ID. When four eyes is on, a bank-detail change always needs two people, whatever the amount.

Only then is the account created at Airwallex and made the active payee. The old account stays in the ledger as REPLACED. Before any of this, an invoice with changed bank details is blocked by code, before Airwallex is called (`src/policy/fraud.ts`).

Evidence: `test/payee-change.test.ts`, `test/fraud.test.ts`, `docs/runs/2026-10-29-fraud.md` †. The three-step change has tests only; there is no live run log yet.

## Transfers: SWIFT, status to PAID

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `POST /transfers/create` | Pays the invoice by SWIFT: `request_id`, `beneficiary_id`, `transfer_amount`, `transfer_currency` EUR, `source_currency` EUR, `transfer_method` SWIFT, `reference`, `reason`, `metadata.approval_sha256`. | This is money leaving the company. It runs once, after Face ID, on the approved terms only. | `docs/runs/2026-10-29-rehearsal-3.md` † (transfer `260638bd-3400-4a6f-b170-268ecc1ffc5b`, PAID, fee EUR 13.46); `docs/runs/2026-10-29-s3.md` † (`26954165-5c6d-4796-91bd-c9aa356e1ea9`); `docs/runs/2026-10-29-f1.md` † (`c443a5da-aebb-486d-9101-5cf9ea0e3bae`) |
| `GET /transfers` (by `request_id`) | Finds a transfer after a lost answer, and reads it back in `npm run verify`. | A payment must never be paid twice. | `test/euroBill.test.ts` (F8: a lost answer is adopted, not repaid); `test/airwallex-verify.test.ts` |
| `GET /transfers/{id}` | Reads the status and the fee Airwallex charged. | The fee is only known after the charge. The status shows whether the money arrived. | `src/airwallex/adapter.ts`; `docs/runs/2026-10-29-rehearsal-3.md` † |
| `POST /simulation/transfers/{id}/transition` (**sandbox only**) | Moves the transfer to SENT, then PAID. | The sandbox does not settle SWIFT by itself. In the logs, PAID comes from this simulation. | `docs/runs/2026-10-29-s3.md` † |

Other rules:

- A transfer starts as SUBMITTING in our ledger before the call. One invoice has at most one live payout (`one_live_transfer_per_invoice`).
- A failed transfer is read as FAILED, then CANCELLED, which is how the sandbox ends it.
- Opus's advice sits beside the proposal, outside the hash. It cannot change what is paid.
- **For the bank and the ERP: ISO 20022.** `npm run iso20022 -- BTX-2026-11` exports the paid invoice as a
  pacs.008.001.08 message ([`docs/iso20022/pacs008-BTX-2026-11.xml`](iso20022/pacs008-BTX-2026-11.xml)). The SWIFT
  transfer carries EndToEndId `BTX-2026-11`, Airwallex's transfer id `4d508b0b…feb4` as the UETR, and the invoice as
  structured remittance. The same message holds the Metal transaction whose earnings were booked at Airwallex as
  deposit `56366c9d…c838`, so one message links both rails. It is valid against the official XSD; it is not a
  message a bank sent, and the sandbox assigns no SWIFT UETR.

## Deposits and balances

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /balances/current` | Reads cash balances (`account_type=cash`). Only `available_amount` counts as spendable. Pending and reserved amounts never count. Also used by `npm run health`. | The Finance agent's plan depends on free EUR and USD above the floors. | `docs/runs/2026-10-29-s3.md` † (starting balances read live); `test/euroBill.test.ts` |
| `GET /deposits` | Finds a deposit by its `reference`. | Earnings are credited once the on-chain sweep is final. The reference is the Metal transaction hash. | `docs/runs/2026-10-29-s3.md` † ("the reference comes back verbatim"); `test/airwallex-adapter.test.ts` |
| `POST /simulation/deposit/create` (**sandbox only**) | Seeds USD, and books the sweep as a deposit with the Metal transaction hash as `reference`. | The sandbox cannot receive stablecoins. So the USDZ to Airwallex step is **simulated**: 1 USDZ is booked as 1 USD. No real USDZ reaches Airwallex. | `docs/runs/2026-10-29-s3.md` † (deposit `e49d68f2-bcc2-4a0d-ab22-abca60ea6509`); `docs/runs/2026-10-29-rehearsal-3.md` † (deposit `03d9d67d-449a-482b-9281-e2acf4fe058c`); `docs/security.md` |

A credit is booked only after the sweep is final on Metal, and once per `chainId:tx:logIndex` (`test/euroBill.test.ts`, F6).

## Global accounts

| Endpoint | What Purser uses it for | Why it is a necessary financial action | Evidence |
|---|---|---|---|
| `GET /global_accounts` | Finds the active USD global account that receives deposits. | The USD balance that funds the euro invoice comes in through it. | `src/airwallex/adapter.ts` (`usdGlobalAccountId`) |
| `POST /global_accounts/create` | Creates a US, USD, LOCAL account once, only if none exists. For receivables, a GB, GBP, LOCAL account the same way. | Without a USD account there is nowhere to book the earnings; without a GBP one, UK retailers cannot pay in pounds. | `src/airwallex/adapter.ts`; `src/cli/receivables.ts` (GBP account `3964c579…` created 30 Oct) |

### Receivables: retailers pay into the Global Accounts

Retailers pay Northwind's invoices into its EUR account (NL, SEPA) and GBP account (GB). The receivables agent
(`src/agents/receivables.ts`, `npm run receivables`) works as follows:
- It reads every settled deposit into those accounts (`GET /deposits`).
- It matches each one once, by its Airwallex id, to an open invoice, using the invoice number in the reference
  (written any way).
- It books the payment as wholesale revenue in its own currency.
- It escalates a short payment, an overpayment, the wrong currency or a payment with no invoice to the CFO. Nothing here
  moves money.

Live in the sandbox on 30 October (`docs/runs/2026-10-30-receivables.md`); the retailers' payments are the sandbox's
`POST /simulation/deposit/create`:

| Deposit | Amount | Result |
|---|---|---|
| `50f623ac…` | 1,240.00 EUR | matched to NW-R-101 |
| `95fcf339…` | 860.50 GBP | matched to NW-R-102 |
| `5a6323a6…` | 500.00 EUR | short by 10.00 EUR on NW-R-103: escalated |
| `acf543d2…` | 25.00 EUR | no invoice: held in suspense, escalated |

On a live runner the dashboard's Books tab and the Airwallex rail show them. They are kept out of the public recording, so that its balances, reconciliation and waiting items stay one consistent moment.

### Card spend by merchant

From the card transactions Purser already records (`GET /issuing/transactions`, the webhooks), `src/agents/spendReview.ts`
gives each agent's card spend per merchant and category, with the declines counted apart. A merchant that charged the
same amount again about a month later is flagged as a subscription, with how the CFO stops it: lower the card's monthly
limit, or take the category off the card. Both are tightenings the CFO can make on the phone. It reads only; it changes
no card. The recorded run has no subscription yet; `test/spend-review.test.ts` shows one being found.

## Best practices we follow

- **Idempotency keys on every money movement.** Each conversion and each transfer carries a `request_id` (a UUID) that is fixed inside the approved terms. It is reused only to retry the same operation. A new operation gets a new id. A lost answer is looked up by `request_id`, never resent with a new one. Card creation is looked up by nickname after a lost answer. Setting a card's limits twice is harmless, so that is settled by reading the card back. Proof: `test/euroBill.test.ts` (F8), `test/cards.test.ts`, `test/airwallex-client.test.ts`.
- **The approval hash in transfer metadata.** `metadata.approval_sha256` on `POST /fx/conversions/create` and `POST /transfers/create` is the SHA-256 of the exact terms the CFO signed with Face ID. `npm run verify` reads Airwallex back and fails if the metadata, amount, quote or fee differs from the approved terms. Proof: `test/airwallex-verify.test.ts`, `docs/runs/2026-10-29-rehearsal-3.md` †.
- **Tracing each payment to agent, task and policy rule.** Airwallex holds the hash and the Airwallex ids. Our ledger ties them to the rest. Each card transaction row holds the agent and, when the agent gave one, the purpose (the task). The GL export adds the cost centre, the rule that chose the account and the approval. The audit report lists each decision that needed a person: the agent that proposed it, the policy rule that sent it to a person, who decided and how, and the terms hash. Limits: one card per agent, not per task, and the purpose is stored in our ledger, not at Airwallex. Proof: `src/accounting/gl.ts`, `test/gl-export.test.ts`, `docs/audit-report-rehearsal-3.pdf` †.
- **Webhook signature checks.** HMAC-SHA256 over timestamp plus raw body, a five-minute window, checked on the relay and again on the runner. See "Webhooks" above.
- **Quote expiry.** The proposal ends before the quote does. A late approval approves nothing. See "FX" above.
- **Only the shortfall is converted.** Fee-aware, and never below the reserve floors. See "FX" above.
- **Limits and read-backs.** Calls are spaced to half of the sandbox limit. Card limits are read back from Airwallex, not assumed.
- **Sandbox calls are separate.** Simulations sit behind their own interface, as the builder guide advises.
- **Secrets.** The API key never reaches a model. Logged bodies are redacted. Card numbers and CVVs are never requested. Proof: `test/redact.test.ts`, `test/adversarial.test.ts`.

## The scoped key

Purser should run on a scoped API key, not an admin key. Airwallex lets each key have Read or Write per resource. Read covers `GET`. Write covers `GET` and `POST` ([manage API keys](https://www.airwallex.com/docs/developer-tools/api/manage-api-keys), [API key best practices](https://www.airwallex.com/docs/developer-tools/api/api-key-best-practices)).

The permissions below come from the endpoints on this page. Max creates the key in the Airwallex web app before submission. We do not create it and we never see the secret in a chat. The names in the web app may differ a little from the names here. If one is missing, tell us and we will match it.

| Resource | Endpoints used | Permission |
|---|---|---|
| Balances | `GET /balances/current` | Read |
| Global accounts | `GET /global_accounts`; `POST /global_accounts/create` (once, at setup) | Read; Write only until the account exists |
| Deposits | `GET /deposits` | Read |
| Beneficiaries | `GET /beneficiaries`; `POST /beneficiaries/schema`; `POST /beneficiaries/validate`; `POST /beneficiaries/create` | Write (needed at setup and for every approved bank-detail change) |
| FX rates, quotes and conversions | `GET /fx/rates/current`; `POST /fx/quotes/create`; `POST /fx/conversions/create`; `GET /fx/conversions` | Write |
| Transfers | `POST /transfers/create`; `GET /transfers`; `GET /transfers/{id}` | Write |
| Issuing: cardholders, cards, transactions | `GET`/`POST /issuing/cardholders`; `GET`/`POST /issuing/cards` and `/issuing/cards/{id}/update`; `GET /issuing/transactions` | Write |
| Webhooks | `GET /webhooks`; `POST /webhooks/create`; `POST /webhooks/{id}/delete` (setup and `--replace` only) | Write at setup, then none |
| Sandbox simulation | `POST /simulation/deposit/create`; `POST /simulation/transfers/{id}/transition`; `POST /simulation/issuing/create` | Write (sandbox only; these do not exist in production) |

What the key does not need:

- No permission for sensitive card details. Purser never asks for a card number or CVV.
- No permission for users, roles, API keys, settings, billing or connected accounts.
- No read of other products or entities.

Proof that Airwallex enforces key scope: before the Webhooks permission was added, `GET /webhooks` and `POST /webhooks/create` answered `401 Insufficient permissions` (`docs/runs/2026-10-29-cards.md` †).

After the key is created:

1. Put the client id and the API key in the environment (`AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`), as in `.env.example`.
2. Run `npm run health`.
3. Run the cards and the euro bill once. Any `401 Insufficient permissions` names the missing permission.
4. In production, add an IP allowlist, as Airwallex recommends. This build only talks to the sandbox.
