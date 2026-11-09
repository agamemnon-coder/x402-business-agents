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
| Signed terms name the paying account and the Purser fee; the fee counts toward the funds checked | `src/payouts/plan.ts` | `test/airwallex-platform.test.ts` |
| Phone shows "Paid from" and "Purser fee" before Face ID | `src/approve/client.ts` | same |
| Fee collected only after the payout is PAID, once per request id, booked and in the register | `src/executors/supplierPayment.ts` (`takePlatformFee`), `src/ap/books.ts`, `src/accounting/gl.ts`, `src/money/register.ts` | same |
| Cloud: owner opens the account, gets the onboarding link, status from webhooks | `cloud/src/awxPlatform.ts`, `cloud/src/app.ts` (`/v1/airwallex/*`), console Settings, table `awx_accounts` | `test/cloud-awx-platform.test.ts` (fake rail; owner-only, one per company, tenant isolation, signature, replay order) |

The cloud keeps only the account's id and status, never the onboarding link (short-lived, made when asked for) and
never a key. It is off unless the cloud is given a platform rail (`CloudEnv.awxPlatform`); the Worker does not wire one
yet, because the Airwallex client is Node-only (`src/airwallex/callBudget.ts` writes a local file). Which field of an
`account.*` event carries the connected account's id is **unconfirmed**: the cloud accepts `data.object.id`,
`data.object.account_id`, `data.id`, `data.account_id`, `account_id` or `accountId`, and changes a company only when the
id is one Purser opened.

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
