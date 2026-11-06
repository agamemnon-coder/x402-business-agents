# awx-1: the Airwallex-only run, plan and runbook (Max's item 2.1)

**Status: prepared, not run.** No call to Airwallex, Claude or Metal was made to prepare it. Max approves the call count
below before anything runs live. The stand-in run (`npm run awx-1 -- stand-in`, 0 network) shows the code path and the
record's shape only; it is never the run's evidence.

## What the run must show

| | Shown by | Code path today | Built for awx-1 | Can the sandbox produce it? |
|---|---|---|---|---|
| **a** One card per agent with the policy's limit, MCC, currency and end date | Step a: three cards issued in a fresh world, each read back with `GET /issuing/cards/{id}` | Yes: `setupCards` issues VIRTUAL cards with `transaction_limits`, `allowed_merchant_categories`, `allowed_currencies`, `active_to` (`src/policy/cards.ts`, `src/airwallex/issuing.ts`); read back live on 6 Nov (`docs/runs/airwallex-cards-2026-11-06.json`) | The world's own nickname suffix `(awx-1)`: a world without a Metal account would otherwise get the plain nickname and could adopt an earlier world's card and its spend | Yes, shown live on 29 Oct and 3 Nov |
| **b** A payment within the limit, approved | Step b: Packwise 19.99 EUR, MCC 5734, on the Sourcing card (30.00 per purchase) | Yes: `POST /simulation/issuing/create`, the sandbox's own way for a merchant to charge a card | The charge as the merchant's (nothing recorded by the caller): the webhook records it | Yes. The merchant's charge is the simulated part; the approval is Airwallex's |
| **c** A payment over the limit, declined by Airwallex with its code | Step c: Packwise Pro 45.00 EUR on the same card | Yes (live 29 Oct: `LIMIT_EXCEEDED`, `docs/runs/2026-10-29-cards.md`) | — | Yes. `LIMIT_EXCEEDED` is not among the failure reasons a simulation may ask for (`transaction_failure_reason` takes only `CARDHOLDER_VERIFICATION_FAILED`, `CVV_INVALID`, `INVALID_EXPIRY_DATE`, `PIN_INVALID`, `PIN_RETRIES_EXCEEDED`, `TRANSACTION_BLOCKED`, … per the API reference, read 6 Nov), so it can only come from the card's own controls. Purser never sets that field (a test checks the request body) |
| **d** A payment in the wrong merchant category, declined with its code | Step d: Packwise (MCC 5734) on the Support card (MCC 7372 only) | Yes (live 30 Oct: `MERCHANT_CATEGORY_NOT_ALLOWED`, `docs/runs/2026-10-30-single-use.md`) | — | Yes, the same way as c |
| **e** Webhooks that really arrive and that the agents read; after a decline the agent asks the CFO instead of retrying | Steps b–d (card transactions), f (payouts): Airwallex → hosted relay `/hooks/airwallex` (signature checked) → runner (checked again) → ledger. The runner then starts the agent whose card it is (`meetNewDeclines`): Haiku reads the code and proposes a raise for c, nothing for d | Yes (subscription of 30 Oct, 23 events, `docs/runs/2026-10-30-webhooks.md`; runner `onHook` → `meetDeclines`) | The runner's card poll can be turned off (`KIT11_CARD_POLL_MS=off`), so a transaction reaches the ledger by its webhook and every poll is not a counted call; the conductor waits for the webhook in the ledger and records it if one does not come | Yes. The webhook secret must be the one on the relay: it is in the default keys folder, not in a fresh one (copied in step 0). The relay keeps 24 h of events: events of other worlds from that day reach this runner too and are recorded as not Purser's |
| **f** The EUR balance at Airwallex decides: enough, no FX; too little, only the shortfall on a fresh quote | f1: the licence (SLL-2026-11, 240.00 + fee ceiling 20.00) against free EUR 1,500.00: no quote, no conversion. f2: Bergtex (BTX-2026-11, 1,850.00 + 20.00) right after, against the balance the licence left: FX for the shortfall only, on a quote asked for then | Yes: `planInvoice` → `proposeInvoicePayment` reads `GET /balances/current` and chooses `pay_from_eur` or `convert_shortfall` (`src/policy/treasury.ts`) | Bergtex planned without `npm run s3` (which sweeps on Metal first); the plan takes the stand-ins' null Claude client | Yes. Honest limit: the sandbox account is shared by every world, so free EUR is calibrated once per world at the seed (`eur_obligations`, as in every run since 29 Oct); after that only the Airwallex balance moves. The preflight checks EUR is above the floor plus 1,500.00 |
| **g** A SWIFT payout after Face ID, `approval_sha256` in its metadata, followed to PAID | f1 and f2: each payout runs only after Max's Face ID on its exact terms; `npm run verify` reads each transfer back | Yes (main run P-0005: `03360bfa…`, PAID, hash in metadata, `docs/runs/airwallex-transfer-approval-2026-11-06.json`) | — | Yes. SENT and PAID come from the sandbox's `POST /simulation/transfers/{id}/transition`; the sandbox does not settle SWIFT by itself |

**What the sandbox cannot do, said in the record:** there are no real merchants (each charge is
`POST /simulation/issuing/create`), SWIFT does not settle by itself (SENT and PAID are simulated), and the sandbox
cannot hold anything but test money. Every approve, decline and decline code, every limit and control, the FX quote and
rate, the conversion and the transfer are Airwallex's own.

**Built in this PR (all behind the stand-ins, 0 network):** `src/awx/scenario.ts` (the driver, the record, checks a–g),
`src/awx/standIn.ts` (stand-in deps: signed webhooks through the relay Worker's code and the runner's handler, a
labelled virtual passkey through the runner's own WebAuthn check, the real executors), `src/awx/live.ts` (live deps:
the conductor waits in the ledger for the runner), `src/airwallex/callBudget.ts` (the call guard), `src/awx/plan.ts`
(this budget), `npm run awx-1`, `KIT11_CARD_POLL_MS`, and `npm run verify` without Metal accounts in a world that has no
dispute. Tests: `test/awx1.test.ts`, `test/awx1-world.test.ts`, `test/awx1-plan.test.ts`.

## Who does what, and when

- **Max, three Face ID moments plus the enrolment, about 45 minutes in all.** (0) Enrol his passkey for this world and
  say "Bevestig passkey &lt;fingerprint&gt;" in chat. (1) Step c: the Sourcing agent's raise (one hour to decide).
  (2) Step f1: the licence, EUR 240.00 (20 minutes). (3) Step f2: Bergtex, EUR 1,850.00 with FX (within the quote's
  14.5 minutes). Each is on his own phone, on the relay's approval page.
- **If Max's slot does not come:** a labelled virtual test passkey (a headless browser on the runner machine, as the
  main run's test-controller) signs instead, only on Max's go in chat, and the record marks every proposal it signed
  (`virtual_test_passkey: true`; set `AWX1_VIRTUAL_LABELS` to its label).
- **Claude Code** runs every command, watches the call log, and stops on any abort criterion. It approves nothing.

## Environment (names only)

Present in this environment on 6 November (checked without printing a value): `AIRWALLEX_CLIENT_ID`,
`AIRWALLEX_API_KEY`, `KIT11_ANTHROPIC_API_KEY`, `CLOUDFLARE_API_TOKEN`; the relay token file `/home/user/.kit11/relay-token`;
the webhook secret file `airwallex-webhook-secret` in the default keys folder `x402-business-agents-keys/testnet`.
Also present, and **unset for the run**: `METAL_RPC_URL`, `METAL_ENDPOINT_SECRET`, `T0_API_KEY`.

Set for the run:

```bash
export KIT11_DB=data/awx-1.sqlite KIT11_KEYS_DIR=../x402-business-agents-keys/awx-1
export KIT11_AGENTS=on KIT11_CARD_POLL_MS=off          # agents meet declines and advise; webhooks bring transactions
unset KIT11_AUTONOMY METAL_RPC_URL METAL_ENDPOINT_SECRET T0_API_KEY T0_ENABLED HUB_PUSH_ENABLED HUB_DECISIONS_ENABLED
export AIRWALLEX_CALL_BUDGET=<the number Max approved> AIRWALLEX_CALL_LOG=$KIT11_KEYS_DIR/airwallex-calls.jsonl
```

Nothing to set in the Airwallex web app if the preflight passes: the key in this environment made every kind of call
in the table live by 3 November (Issuing, FX, Transfers, Balances, Deposits, Beneficiaries, Webhooks, Simulation). If
Max has since swapped it for a narrower scoped key, the first 401 names the missing permission (an abort criterion). If the preflight finds no
webhook subscription for the relay, or the first webhook is refused as "bad signature", a new subscription is needed
(contingency below; it also changes the relay Worker's secret, so it needs Max's go).

## Steps

| # | What | Command (Claude Code) | Max | Calls (expected) |
|---|---|---|---|---|
| 0 | Fresh world; copy the webhook secret (never printed); preflight | `mkdir -m 700 $KIT11_KEYS_DIR && install -m 600 ../x402-business-agents-keys/testnet/airwallex-webhook-secret $KIT11_KEYS_DIR/`; `npm run awx-1 -- preflight` | — | 3 |
| 0b | Runner on the hosted relay, with Max's enrolment | `npm run relay -- --enrol` (its own process group) | Face ID (enrol), then "Bevestig passkey &lt;fp&gt;" | runner: login, later its reconciliation |
| 1 | The scenario, a to close | `AWX1_GO=yes npm run awx-1 -- live` (stops at the first failure) | Face ID ×3 when the conductor prints `FACE ID` | see the table |
| 2 | Verify, saved | `npm run verify \| tee $KIT11_KEYS_DIR/verify.log` | — | 4 |
| 3 | Reconcile | `npm run reconcile` | — | 6 |
| 4 | The record | `npm run awx-1 -- record --verify-log $KIT11_KEYS_DIR/verify.log` → `docs/demo/airwallex-run.json`; then `docs/runs/2026-11-07-awx-1.md` from it: every id, every webhook, every decline code, every attempt | — | 0 |
| 5 | Stop | `npm run stop -- awx-1` | — | 0 |

To resume after a failure (only on Max's go, within the approved calls): `AWX1_GO=yes npm run awx-1 -- live --from <step>`.

## Abort criteria (stop, record, tell Max)

- The call log reaches the approved number (the guard refuses the next call by itself), or any contingency is needed.
- The preflight fails: EUR under the floor plus 1,500.00, no webhook subscription, or a refusal of the environment.
- A webhook is refused as "bad signature", or no webhook comes within 2 minutes for a card transaction (the conductor
  polls once and records `awx1.webhook_missing`; e then fails honestly).
- Airwallex approves the over-limit charge (c) or the wrong-category charge (d): the control did not hold.
- An agent retries a declined charge, or a raise is proposed by code's fallback instead of the agent (no Claude answer).
- Any 401 (a missing key permission), any `AirwallexAmbiguous` on a POST, any transfer FAILED, `fee_over_ceiling`, or
  a `verify` FAIL or reconcile difference.
- An approval expires, or Max rejects one.
- **Deadline: if awx-1 has not passed by Mon 9 Nov 20:00, it stops and the record says so.**

## How a failure is recorded

Every step writes `awx1.step_started`, then `awx1.step_done` or `awx1.step_failed` with its cause, into the world's
hash-chained audit log; the record lists every attempt (`attempts`), the call log lists every call. A failed attempt
stays in `docs/demo/airwallex-run.json` and in the run log, with its cause and what was done next; a second attempt in a
fresh world is `awx-1b`, never a rewrite of the first. Nothing of the main run's records changes.

## Call budget

**Airwallex: 85 calls expected, at most 96.** Read-only paging is the only difference (list lengths we cannot know without reading them: cardholders 1–2 page(s), each holder's cards 2–3, deposits of 30 days 3–6, beneficiaries 1–2 per payee).

| Step | Process | Endpoint | Expected | At most | Why | Code |
|---|---|---|---|---|---|---|
| 0 | preflight | `POST /authentication/login` | 1 | 1 | the preflight's token | `Airwallex.login` |
| 0 | preflight | `GET /balances/current` | 1 | 1 | EUR and USD available: is there enough EUR for f1 to go without FX? | `awx-1 preflight` |
| 0 | preflight | `GET /webhooks` | 1 | 1 | the relay's subscription (23 events since 30 October) is still there | `listWebhooks` |
| 0 | conductor | `POST /authentication/login` | 4 | 4 | the conductor's token, renewed every 25 minutes over at most 90 minutes | `Airwallex.login` |
| a | conductor | `GET /issuing/cardholders` | 3 | 6 | finds each agent's DELEGATE cardholder (none is created twice) | `setupCards → findCardholderByEmail` |
| a | conductor | `GET /issuing/cards` | 6 | 9 | pages through each holder's cards: no awx-1 card may exist yet (none is adopted) | `setupCards → findCard` |
| a | conductor | `POST /issuing/cards/create` | 3 | 3 | one virtual card per agent with the policy's limit, MCC, currency and end date | `setupCards → createCard` |
| a | conductor | `GET /issuing/cards/{id}` | 3 | 3 | reads each card back: the controls as Airwallex holds them | `awx-1 step a read-back` |
| b | conductor | `POST /simulation/issuing/create` | 1 | 1 | sandbox only: Packwise charges 19.99 EUR (MCC 5734) on the Sourcing card (limit 30.00) | `merchantCharge` |
| c | conductor | `POST /simulation/issuing/create` | 2 | 2 | sandbox only: Packwise Pro 45.00 EUR over the 30.00 limit; after the CFO's raise, the same charge again | `merchantCharge` |
| d | conductor | `POST /simulation/issuing/create` | 1 | 1 | sandbox only: Packwise (MCC 5734) on the Support card, which may pay only MCC 7372 | `merchantCharge` |
| f1 | conductor | `GET /deposits` | 3 | 6 | is the seed deposit there (last 30 days)? Then no new one | `seedTreasury → findDepositsByReference` |
| f1 | conductor | `GET /balances/current` | 2 | 2 | the seed's calibration, then the licence's plan: free EUR decides FX or not | `seedTreasury, proposeInvoicePayment` |
| f1 | conductor | `GET /beneficiaries` | 2 | 4 | the two allowlisted payees, found by IBAN (none is created) | `seedTreasury → findBeneficiaryByIban` |
| f2 | conductor | `GET /balances/current` | 2 | 2 | after the licence was paid: the EUR balance now falls short of Bergtex's 1,850.00 | `awx-1 step f2, proposeInvoicePayment` |
| f2 | conductor | `GET /fx/rates/current` | 1 | 1 | the market rate, to check the quote against | `proposeInvoicePayment → currentRate` |
| f2 | conductor | `POST /fx/quotes/create` | 1 | 1 | a fresh quote for the shortfall only, valid 15 minutes | `proposeInvoicePayment → createQuote` |
| close | conductor | `GET /issuing/transactions` | 3 | 3 | one poll of each card: every authorisation the webhooks brought, and none they missed | `pollCardTransactions` |
| close | conductor | `GET /issuing/cards/{id}` | 3 | 3 | each card read back at the end (the raised limit as Airwallex holds it) | `awx-1 close read-back` |
| 0 | runner | `POST /authentication/login` | 4 | 4 | the runner's token over at most 100 minutes | `Airwallex.login` |
| c | runner | `GET /issuing/cards/{id}` | 2 | 2 | the approved raise: the card read before and after its update | `syncCardsAfterPolicy → syncOne` |
| c | runner | `POST /issuing/cards/{id}/update` | 1 | 1 | the raised per-purchase limit, set at Airwallex | `setCardLimits` |
| f1 | runner | `GET /balances/current` | 2 | 2 | the balance before the payout and after it | `executeInvoicePayment: snapshot pre-exec, post-exec` |
| f1 | runner | `POST /transfers/create` | 1 | 1 | the SWIFT payout with its request_id and metadata.approval_sha256 | `submitTransfer → createTransfer` |
| f1 | runner | `GET /transfers/{id}` | 3 | 3 | status and fee read back after create, SENT and PAID | `settleInSandbox → getTransfer` |
| f1 | runner | `POST /simulation/transfers/{id}/transition` | 2 | 2 | sandbox only: SENT, then PAID (the sandbox does not settle SWIFT by itself) | `settleInSandbox → transitionTransfer` |
| f2 | runner | `POST /fx/conversions/create` | 1 | 1 | converts only the shortfall on the approved quote, metadata.approval_sha256 | `executeInvoicePayment → createConversion` |
| f2 | runner | `GET /balances/current` | 2 | 2 | the balance before the payout and after it | `executeInvoicePayment: snapshot pre-exec, post-exec` |
| f2 | runner | `POST /transfers/create` | 1 | 1 | the SWIFT payout with its request_id and metadata.approval_sha256 | `submitTransfer → createTransfer` |
| f2 | runner | `GET /transfers/{id}` | 3 | 3 | status and fee read back after create, SENT and PAID | `settleInSandbox → getTransfer` |
| f2 | runner | `POST /simulation/transfers/{id}/transition` | 2 | 2 | sandbox only: SENT, then PAID (the sandbox does not settle SWIFT by itself) | `settleInSandbox → transitionTransfer` |
| close | runner | `GET /issuing/transactions` | 6 | 6 | the runner's reconciliation, a minute after start and an hour later | `reconcile → cardTransactions` |
| close | runner | `GET /transfers/{id}` | 2 | 2 | the hour-later reconciliation of both payouts | `reconcile → transfer` |
| g | verify | `POST /authentication/login` | 1 | 1 | verify's token | `Airwallex.login` |
| g | verify | `GET /transfers` | 2 | 2 | each payout by its request_id: amount, payee, reference, approval hash in metadata, PAID | `verifyAirwallex` |
| g | verify | `GET /fx/conversions` | 1 | 1 | the conversion by its request_id: quote, amounts, SETTLED | `verifyAirwallex` |
| close | reconcile | `POST /authentication/login` | 1 | 1 | reconcile's token | `Airwallex.login` |
| close | reconcile | `GET /transfers/{id}` | 2 | 2 | each payout's status and amount | `reconcile → transfer` |
| close | reconcile | `GET /issuing/transactions` | 3 | 3 | each card's authorisations against the ledger | `reconcile → cardTransactions` |

By endpoint:

| Endpoint | Expected | At most |
|---|---|---|
| `POST /authentication/login` | 11 | 11 |
| `GET /balances/current` | 9 | 9 |
| `GET /webhooks` | 1 | 1 |
| `GET /issuing/cardholders` | 3 | 6 |
| `GET /issuing/cards` | 6 | 9 |
| `POST /issuing/cards/create` | 3 | 3 |
| `GET /issuing/cards/{id}` | 8 | 8 |
| `POST /simulation/issuing/create` | 4 | 4 |
| `GET /deposits` | 3 | 6 |
| `GET /beneficiaries` | 2 | 4 |
| `GET /fx/rates/current` | 1 | 1 |
| `POST /fx/quotes/create` | 1 | 1 |
| `GET /issuing/transactions` | 12 | 12 |
| `POST /issuing/cards/{id}/update` | 1 | 1 |
| `POST /transfers/create` | 2 | 2 |
| `GET /transfers/{id}` | 10 | 10 |
| `POST /simulation/transfers/{id}/transition` | 4 | 4 |
| `POST /fx/conversions/create` | 1 | 1 |
| `GET /transfers` | 2 | 2 |
| `GET /fx/conversions` | 1 | 1 |
| **Total** | **85** | **96** |

**Worst single retry:** step a again (three new cards in a fresh world awx-1b, with their read-back): 15 calls, at most 21, so 117 at most with it.

Not in the budget; each only on Max's go (the guard refuses it otherwise):

| If | Calls | Endpoints |
|---|---|---|
| EUR too low for f1 to go without FX (preflight: EUR available under the floor 25,000.00 + 1,500.00): a simulated EUR deposit into the EUR Global Account | 3 | login, GET /global_accounts, POST /simulation/deposit/create |
| the webhook secret on file does not match (first webhook 'bad signature'): a new subscription with a new secret (npm run cards -- webhook --replace; also changes the relay Worker's secret) | 5 | login, GET /webhooks, POST /webhooks/create, POST /webhooks/{id}/delete, GET /webhooks |
| the Bergtex quote expires before Face ID (14.5 minutes): a new plan on a fresh quote | 4 | GET /balances/current ×2, GET /fx/rates/current, POST /fx/quotes/create |
| Airwallex answers fee_unknown on a transfer: the same request_id again after 15, 30, 60, 90 and 120 s (never a second payout) | 5 | POST /transfers/create (same request_id) |
| a webhook does not arrive within 2 minutes: the card is polled once instead (recorded as such) | 1 | GET /issuing/transactions |

**Claude: 14 calls, about 0.1074 USD** at the main run's own average cost per call (docs/demo/main-run.json: Haiku 338 µUSD, Sonnet 7148 µUSD, Opus 15187 µUSD, from list prices in src/claude/pricing.ts). Worst single retry: Bergtex planned again on a fresh quote (its quote expired before Face ID), 5 calls, about 0.0530 USD; 0.1605 USD with it.

| Step | Model | Calls | Why | Code |
|---|---|---|---|---|
| c | claude-haiku-5-5 | 2 | the Sourcing agent reads Airwallex's LIMIT_EXCEEDED and asks the CFO for a raise (read_decline, propose_raise) | `meetDecline` |
| d | claude-haiku-5-5 | 2 | the Support agent reads MERCHANT_CATEGORY_NOT_ALLOWED and asks for nothing (read_decline, no_raise) | `meetDecline` |
| f1 | claude-haiku-5-5 | 1 | sorts the licence invoice | `Tools.classify` |
| f1 | claude-sonnet-5-5 | 1 | reads the licence invoice into checked fields | `Tools.invoice` |
| f1 | claude-opus-5-5 | 2 | the Treasury agent advises when to pay | `adviseTiming` |
| f1 | claude-opus-5-5 | 1 | the advisory review beside the proposal | `attachReview` |
| f2 | claude-haiku-5-5 | 1 | sorts Bergtex's invoice | `Tools.classify` |
| f2 | claude-sonnet-5-5 | 1 | reads Bergtex's invoice | `Tools.invoice` |
| f2 | claude-opus-5-5 | 2 | the Treasury agent advises when to pay (with the quote) | `adviseTiming` |
| f2 | claude-opus-5-5 | 1 | the advisory review | `attachReview` |

**Metal: 0 calls** (METAL_RPC_URL unset; no bootstrap, no mandate, no sweep).

**Asked of Max:** approve `AIRWALLEX_CALL_BUDGET=96` for awx-1 (85 expected), about 0.11 USD of Claude (14 calls, in the
evals block), 0 Metal calls; and, separately, whether a second attempt (awx-1b) may use up to the same again.
