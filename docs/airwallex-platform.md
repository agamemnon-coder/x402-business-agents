# Purser as an Airwallex platform (connected accounts)

Status: built behind `AIRWALLEX_PLATFORM=on` (off by default), tested only against a fake Airwallex. Apart from the two
read-only/refused calls in "Live check" below, **no call has been made to Airwallex for any of this.** Our sandbox is not
enabled for connected accounts yet (`accounts/create` answers 400 "This account cannot onboard business accounts");
Airwallex enables that per account (see "What Max must ask Airwallex" below).

## Why

Today a company has to open its own Airwallex account and give Purser its API key. As a platform, Purser opens the
Airwallex account for the company (a *connected account*), Airwallex verifies the company in its own hosted flow, and
Purser pays that company's suppliers *on behalf of* that account. The money stays in the company's own Airwallex wallet:
Purser is never in the flow of funds. Every payment is still approved by the CFO's Face ID over the exact terms, and those
terms now name the paying account and any Purser fee.

## What Airwallex's documentation says

All read on 9 November 2026 from airwallex.com/docs (the `.md` versions of each page). "Unconfirmed" means the docs did
not say it and no call has checked it.

### Model

- Payments for Platforms lets a platform "programmatically create connected accounts" and "generate revenue through
  payout fees, FX markups, and platform fees collected from the connected account's Wallet. Each connected account has
  its own ledger." — `docs/payments-for-platforms/understanding-payments-for-platforms`
- For SaaS platforms there are two models; in both the platform is **not** in the funds flow and the customer is the
  merchant of record ("Is the platform in funds flow? No / No"). The choice depends on local law (PSD2 in the EU is named).
  — `docs/payments-for-platforms/use-cases/payments-for-saas`
- Payment activation verification (KYB) applies only when the connected account is merchant of record for *accepting*
  payments. Purser only pays out, so only **onboarding verification** applies. —
  `docs/connected-accounts/onboarding/understand-onboarding-requirements`

### Create a connected account

- `POST /api/v1/accounts/create` — minimal body: `primary_contact.email` (or mobile),
  `customer_agreements.agreed_to_data_usage: true`, `customer_agreements.agreed_to_terms_and_conditions: true`;
  `account_details.business_details.business_name` and `registration_address.country_code` may be sent too. Returns the
  account `id` (`acct_…`) with `status: "CREATED"`. — `docs/connected-accounts/onboarding/kyc-and-onboarding/native-api`,
  `docs/api/scale/accounts/create`
- When the platform collects the terms-and-conditions agreement in its own UI it must show the Connected Account terms of
  use. — same page. Purser's console shows that consent step before the call.
- Account statuses: `CREATED`, `SUBMITTED`, `ACTION_REQUIRED`, `ACTIVE`, `SUSPENDED`, `DORMANT`, `CLOSED`; "handle unknown
  values gracefully". — `docs/api/scale/accounts/create` (response)

### Onboarding through Airwallex's hosted flow (KYC)

- `POST /api/v1/hosted_flows/create` with `account_id`, `template` (an id **provided by Airwallex**), optional
  `return_url`, `error_url`, `metadata` → `{ id, url, status }`. —
  `docs/connected-accounts/onboarding/kyc-and-onboarding/hosted-onboarding`, `docs/api/scale/hosted_flows/create`
- The URL must not be shared until authorized: `POST /api/v1/hosted_flows/{id}/authorize` with `identity` (the
  platform's own user id) → a short-lived URL with an `authorization_code`. Re-authorize after a session expiry
  (`TOKEN_EXPIRED`). — same page
- Errors: 400 (flow already finished), 403 (account `SUSPENDED`), 404. — same page

### Status webhooks

`account.active`, `account.action_required`, `account.submitted`, `account.suspended`, `account.connected`,
`account.dormant`, `account.closed` (the last two from API version 2026-08-21), `account.offboarding.pending|completed|cancelled`.
— `docs/developer-tools/webhooks/listen-for-webhook-events/account`. Purser maps `account.submitted` → pending,
`account.action_required` → action required, `account.active` → active, `account.suspended|closed` → refused/closed.
The webhook is verified the same way as Purser's existing Airwallex webhooks (`src/airwallex/webhooks.ts`); that the
platform-level webhook uses the same signature scheme is **unconfirmed**.

### Acting on behalf of the connected account

- "As a platform, you can call all Transfers API endpoints on behalf of your connected accounts by specifying the
  connected account's open ID (in the format `acct_xxxxxx`) in the `x-on-behalf-of` header." The same note appears on
  get-transfer and list-transfers. — `docs/payments-for-platforms/pay-out-funds/create-a-transfer`
- **Unconfirmed:** that balances, beneficiaries, rates, quotes and conversions accept `x-on-behalf-of` too. Purser sends
  the header on every call of the payout rail when the company has a connected account (so everything happens in that
  company's wallet); the sandbox test below checks each one.

### Platform fee

- The docs say platform fees are "collected from the connected account's Wallet" (above), and that SaaS platforms "can
  collect platform fees … while staying out of the funds flow" via **Funds Split** — but Funds Split is tied to a
  *payment intent* (pay-ins). — `docs/payments-for-platforms/airwallex-gateway/manage-funds-split`
- `POST /api/v1/connected_account_transfers/create` (body: `amount`, `currency`, `destination` = account id, `reason`,
  `reference` 1–140 chars, `request_id` 1–50 chars; statuses `NEW`, `SETTLED`, `PENDING`, `SUSPENDED`, `FAILED`) sends
  funds **from the platform's account to a connected account**. — `docs/api/scale/connected_account_transfers/create`
- **Unconfirmed, and the most important open question:** how a payout platform collects a fee *from* a connected
  account (a connected-account transfer sent with `x-on-behalf-of` to the platform's account id, a fee configured by
  Airwallex on the platform, or an FX/payout markup). Purser's fee collection therefore sits behind a second flag,
  `AIRWALLEX_PLATFORM_FEE=on` (off by default), uses `connected_account_transfers/create` with `x-on-behalf-of` as its
  *assumed* call, and must not be switched on before Airwallex confirms the mechanism.

### Where companies can be onboarded

- Netherlands (NL) and Germany (DE): "Full account, Ledger account". The country is where the business is *registered*;
  Airwallex may serve EEA customers from its Netherlands entity. "Onboarding eligibility does not guarantee that all
  account types or product capabilities are available in every market." —
  `docs/connected-accounts/about/regional-availability`
- The same page (re-read 9 Nov): Belgium, France, the United Kingdom and the United States are listed with "Full account,
  Ledger account" as well; for full accounts Airwallex says to confirm with the Airwallex Account Manager.
- **Live check, 9 Nov (two calls, reported to this session):** our sandbox account is registered in the Netherlands.
  `GET /api/v1/accounts` → 200 with 0 items; `POST /api/v1/accounts/create` → 400 `invalid_argument` "This account cannot
  onboard business accounts". So the platform API is reachable but connected accounts are **not enabled** on our
  sandbox yet; Max is asking Airwallex to enable it.
- Airwallex's own staff in the hackathon Slack (#platforms-kits-5-6-7-and-8, 9 Nov) confirmed that connected accounts
  are enabled per sandbox on request, and that *payments acceptance* depends on the platform's registration country
  (an India-registered sandbox may see `configuration_error`). Purser uses payouts, not acceptance; whether payouts on
  behalf of an NL/DE connected account work from our sandbox is **unconfirmed**.

## What Purser built (behind the flag)

| Part | Where | Tested against |
|---|---|---|
| Platform rail: create account, hosted flow create + authorize, get account, fee transfer | `src/airwallex/platform.ts` | `test/airwallex-platform.test.ts` (fake fetch: exact paths, bodies, headers) |
| `x-on-behalf-of` on every payout-rail call when a connected account is set | `src/airwallex/client.ts` (`onBehalfOf`), `airwallexFromEnv` | same |
| Signed terms name the paying account and the Purser fee; the fee counts toward the funds checked, a batch's totals and four eyes | `src/payouts/plan.ts`, `src/agents/euroBill.ts`, `src/policy/batch.ts`, `src/policy/fourEyes.ts` | `test/airwallex-platform.test.ts`, `test/rt6-platform.test.ts` |
| The paying account from a binding Purser Cloud signs (never a local setting) | `src/airwallex/binding.ts`, `cloud/src/awxPlatform.ts` (`bindingOf`), `GET /v1/airwallex/binding`, `src/cloudsync/client.ts` (`refreshBinding`) | `test/rt6-platform.test.ts`, `test/cloud-rt6.test.ts` |
| Phone shows "Paid from", "Purser fee → Purser's account" and "Total out" before Face ID, per line in a batch too | `src/approve/client.ts` | same |
| Fee taken only after the payout is PAID, once per request id; booked only when settled; never fails a paid payment | `src/executors/supplierPayment.ts` (`takePlatformFee`), `src/payouts/follow.ts`, `src/ap/books.ts`, `src/accounting/gl.ts`, `src/money/register.ts` | same |
| Cloud: owner opens the account (idempotent, consent kept), gets the onboarding link, status from webhooks | `cloud/src/awxPlatform.ts`, `cloud/src/app.ts` (`/v1/airwallex/*`), console Settings, table `awx_accounts` | `test/cloud-awx-platform.test.ts`, `test/cloud-rt6.test.ts` |

### The account binding (red team 6)

The account a company's payouts run from is never a setting on the runner, and never only `AIRWALLEX_ON_BEHALF_OF`.
Purser Cloud signs a **binding** with Purser's platform Ed25519 key (a Worker secret, `awxPlatform.bindingKey`):

`{ v: 1, tenant, account_id, status, name, fee_account, issued_at, expires_at }`, as `<base64url JSON>.<base64url signature>`

- `tenant` is the company in Purser Cloud; `account_id` and `status` come from the company's `awx_accounts` row (the
  status as Airwallex's `account.*` webhooks set it); `name` is the business name the cloud holds; `fee_account` is
  Purser's own platform account (`awxPlatform.feeAccount`), the only place a Purser fee can go.
- It holds for **one hour** (`BINDING_TTL_MS`). The runner fetches a fresh one on every cloud sync
  (`GET /v1/airwallex/binding`, sync scope) and keeps it in the setting `platform.binding` only if it checks.
- The runner checks it with Purser's public key (`PURSER_PLATFORM_PUBLIC_KEY`, base64 SPKI) and its own company id
  (`PURSER_TENANT_ID`). A binding for another company, signed by another key, expired, or for an account that is not
  `active`: nothing is planned, and an approved payment is not paid (the check runs again before anything moves).
- Every kind that moves Airwallex money (`invoice_payment`, `supplier_payment`, each line of a batch) carries
  `paying_account` in its signed terms, and one shared check (`checkPayingAccount`) runs in both executors: the terms'
  account, the binding's account and the account the rail acts for (`x-on-behalf-of`) must be the same, or, with the
  platform off, none. A fee in the terms must be within the cap, go to the binding's `fee_account`, and be its share of
  the amount.
- Card calls (Airwallex Issuing: cardholders, cards, limits, controls, status, card transactions and the sandbox's
  simulated charge) run the same binding check before **each** call (`checkCardAccount`, through `issuingFor` /
  `issuingFromEnv(db)`): the account the card rail acts for must be the binding's account, or, with the platform off,
  the company's own. A missing, expired or non-active binding, another account, or a card rail made without the
  company's database: nothing reaches Airwallex. A card call carries no signed terms, so only the acting account is
  checked (`test/card-binding.test.ts`).

### Purser's fee: the cap and its life

- **Cap: at most 100 basis points (1.00%) per payout** (`FEE_BPS_CAP`). The fee is CFO policy (`platform.fee_bps`, a
  choice from 0 to 100), changed only through a policy change the CFO approves with Face ID. A higher value is never
  planned, and terms above the cap are shown with a warning and cannot be signed on the phone.
- The fee counts toward the funds checked when the payment is planned (and in a batch's running reserve), toward the
  batch's totals and toward four eyes (a supplier payment's euro value is its amount plus the fee at the quote's rate,
  never less than the EUR the quote sells; a batch needs two people when its lines together are above the threshold).
- From the moment the payout is written until the fee is settled, the fee is held (`platform_fees` row `DUE`, counted in
  `inFlightCents`). It is taken only once the payout is `PAID`: at execution in the sandbox, or live when
  `followPayouts` (on `npm run payables -- sync`) reads the payout as PAID at Airwallex. A fee that cannot be taken stays
  `OPEN` for a person and the next follow-up; the payment stays `EXECUTED`. A fee answered `NEW`/`PENDING` stays so
  until it is read `SETTLED`; only a settled fee is booked and counted as moved. A payout that fails voids its fee.

### Production: on-behalf-of calls go through a Purser-held service (design note, not built)

In this build the runner holds the Airwallex platform key and sets `x-on-behalf-of` itself; the binding stops a runner
from paying from another company's account by mistake or by a changed setting, but whoever holds the platform key can
still call Airwallex for any connected account. **Before production, every on-behalf-of call goes through a service
Purser holds** (the platform key never leaves it): the runner sends the signed terms, the CFO's approval and the
binding; the service checks the binding and the approval hash, then makes the call for that one account. The runner
keeps no platform key. This is a go-live item (`docs/go-live.md`).

### What is unconfirmed (all behind the flag, none called yet)

- `request_id` on `POST /accounts/create` as an idempotency id, and looking an account up by it
  (`GET /accounts?request_id=`, `findConnectedAccount`): the cloud sends the same id on every attempt of one opening,
  looks a stale opening up before it retries, and adopts what it finds; if Airwallex cannot answer, nothing is opened
  again.
- The id field of `account.*` events: the cloud applies an event **only** by `data.object.id` (the account object's own
  id, as Airwallex documents the account object), and an event that also names another account in `account_id` or
  elsewhere changes nothing.
- `GET /connected_account_transfers/{id}` to read a fee transfer's status, like the create.

The cloud keeps the account's id, status, the opening's idempotency id and the owner's **consent record** (who agreed
to Airwallex's terms, when, and which version, `awxPlatform.termsVersion`), never the onboarding link (short-lived, made
when asked for) and never a key. It is off unless the cloud is given a platform rail (`CloudEnv.awxPlatform`); the
Worker does not wire one yet, because the Airwallex client is Node-only (`src/airwallex/callBudget.ts` writes a local
file).

## What Max must ask Airwallex

1. Enable **connected accounts / Payments for Platforms** on our sandbox (account id and client id as in the Slack
   thread example; never post the API key).
2. The **hosted onboarding flow template id** for KYC (`template` in `hosted_flows/create`).
3. Confirm the **platform fee mechanism for payouts** (see "Platform fee"): which call, from which account, and whether a
   fee can be taken from a connected account's wallet at all.
4. Confirm which endpoints accept **`x-on-behalf-of`** besides Transfers (balances, beneficiaries, rates, quotes,
   conversions).
5. Confirm that a **Netherlands-registered** connected account can receive SWIFT/SEPA payouts on our sandbox, and the
   webhook signature scheme for platform-level `account.*` events.

## The sandbox test that would confirm it (needs Max's go and a call budget)

About 12 calls, in this order: login (1); `POST /accounts/create` (1); `POST /hosted_flows/create` (1);
`POST /hosted_flows/{id}/authorize` (1); after the KYC is done in the browser and `account.active` arrives:
`GET /accounts/{id}` (1); with `x-on-behalf-of`: `GET /balances/current` (1), `POST /beneficiaries/validate` (1),
`POST /beneficiaries/create` (1), `POST /transfers/create` (1), `GET /transfers/{id}` (1); fee:
`POST /connected_account_transfers/create` (1) only if Airwallex confirms it; `GET /accounts/{id}` once more to read the
balance trail (1). Run with `KIT11_AIRWALLEX_CALL_BUDGET` set so no call goes over it.
