# Real customers: each company brings its own money account and its own books

Status, 12 November 2026: **built behind flags that are off by default, tested against fakes, and partly tried live
in Airwallex's sandbox** (8 calls, [run record](runs/2026-11-12-real-customers.md)). With the flags off Purser runs
exactly as before: every company on Purser's own Airwallex sandbox account.

Today every company in Purser Cloud pays through Purser's own Airwallex sandbox account. For real customers each company
needs its **own** money account, opened and checked (KYC) by Airwallex, or its **existing** Airwallex account connected
to Purser, and its own books connected the same way. This page has three parts:

1. What Airwallex and Moneybird offer, from their own documentation, with a URL for every fact.
2. What Purser built, where, and how it is switched on.
3. What ran live, what the owner must register, and the wording for the pages.

Labels used below: **Docs** = read on the URL given, 12 Nov 2026 (earlier reads say so). **Live** = called in Airwallex's
sandbox on 12 Nov 2026 (run record). **Unknown** = neither the docs nor a call say it.

---

## 1. What the providers offer

### (a) A new customer: its own Airwallex account, with KYC done by Airwallex

Purser is an Airwallex platform: it opens a *connected account* for the company and Airwallex checks the company in its
own hosted pages. This was built and first tried in the sandbox on 10 Nov
([docs/airwallex-platform.md](airwallex-platform.md), [run](runs/2026-11-10-connected-accounts-sandbox.md)); this
stream adds following the status by poll and the record below.

| Fact | Source |
|---|---|
| Open the account: `POST /api/v1/accounts/create` with `primary_contact.email`, `account_details.business_details.business_name`, `registration_address.country_code` and both `customer_agreements` set to true; the connected account "must agree to the terms of data usage before the API request is made". | Docs: https://www.airwallex.com/docs/connected-accounts/onboarding/kyc-and-onboarding/hosted-onboarding |
| The hosted flow ("onboarding verification, previously referred to as Know Your Customer (KYC)") redirects the account holder "to an Airwallex-hosted form", "dynamically collects identity information based on the account holder's country and account type"; business accounts only. | Docs: same page |
| Before it can be used: "Hosted flow onboarding enabled on your platform account, including a hosted flow template open ID … Contact your Airwallex Account Manager to request enablement … You know enablement is complete when you have the template open ID." | Docs: same page |
| `POST /api/v1/hosted_flows/create` with `account_id`, `template`, `return_url`, `error_url` → `id`, `url`. "Do not share the URL with the account holder until you have authorized it." Errors: 400 (`template` not found, `account_id` not found), 403 (account `SUSPENDED`), 500. | Docs: same page |
| `POST /api/v1/hosted_flows/{id}/authorize` with `identity` ("your platform's identifier for the user") → a short-lived `url` with an `authorization_code`; after a session timeout (`TOKEN_EXPIRED`) authorize again with the saved flow id. | Docs: same page |
| "Listen for account status changes via account webhooks." | Docs: same page |
| Statuses: `CREATED`, `SUBMITTED`, `ACTION_REQUIRED`, `ACTIVE`, `SUSPENDED`, `DORMANT`, `CLOSED`; after offboarding an account reads `SUSPENDED`, then `CLOSED` after 30 days; "Additional values may be introduced over time; handle unknown values gracefully." `next_action.type` says what to do when `ACTION_REQUIRED`. | Docs: https://www.airwallex.com/docs/api/scale/accounts/retrieve |
| Webhooks `account.submitted`, `account.action_required`, `account.active`, `account.suspended`, … | Docs (read 9 Nov): https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events/account |
| **What the platform can see:** `GET /api/v1/accounts/{id}` returns the account's `account_details` (business and person details, including `identification_number` fields) and a `view_type`: "Information on whether the response contains complete or PII excluded data." So a platform may be shown the company's identity data. **Unknown:** which `view_type` our platform gets, and whether uploaded identity documents can be read back (no file endpoint for them was seen). | Docs: https://www.airwallex.com/docs/api/scale/accounts/retrieve |
| What Purser therefore does: reads **only `id` and `status`** from that answer and stores only those; never asks for, uploads or keeps an identity document. | Code: `src/airwallex/platform.ts` (`getAccount`), test `test/cloud-real-customers-kyc.test.ts` |
| The sandbox simulates activation: `POST /simulation/accounts/{id}/update_status` works only from `SUBMITTED`. | Live, 10 Nov: [run](runs/2026-11-10-connected-accounts-sandbox.md) |

### (b) An existing customer: connect its own Airwallex account by OAuth

| Fact | Source |
|---|---|
| "Use this flow when your users already have Airwallex Business Accounts and want to connect them to your platform." | Docs: https://www.airwallex.com/docs/developer-tools/partner-connections/implement-your-authorization-flow/existing-customers |
| Needed first: "Client ID and client secret credentials from Airwallex. Register with our partner program to request credentials"; "Redirect URI whitelisted with Airwallex. Contact your partnerships manager to whitelist additional URIs." | Docs: same page |
| Grant: the **authorization code** grant, with the **PKCE** extension (`code_challenge`, `code_challenge_method=S256`; `code_verifier` at the token endpoint). PKCE is "required for applications like desktops and mobile apps"; Purser uses it as well as its client secret. | Docs: https://www.airwallex.com/docs/partner-api/authentication/oauth2 |
| Authorize URL, sandbox: `https://www.sandbox.airwallex.com/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&state=…&scope=…` (production: `https://airwallex.com/oauth/authorize`). The user logs in, picks the organisation and account, and reviews the permissions. A declined consent returns `error=access_denied&state=…`. | Docs: existing-customers page; oauth2 page |
| Token endpoint, sandbox: `POST https://api.sandbox.airwallex.com/oauth/token`, form-encoded, `client_id`, `client_secret` (or HTTP Basic), `grant_type=authorization_code`, `code`, `redirect_uri` (must match), `code_verifier`. | Docs: same two pages |
| The code "expires in 5 minutes and becomes invalid once an access token is exchanged." | Docs: oauth2 page |
| Answer: `access_token` (**5 minutes**), `refresh_token` (**90 days**), `account_id` (the connected account, "Returned when any scopes other than Billing or Spend are requested"), `org_id`, `expires_in`, `refresh_token_expires_in`, `scope`. Calls then use `Authorization: Bearer <access token>`; "Only the APIs corresponding to the scopes … will be allowed access." | Docs: both pages |
| Refresh: `grant_type=refresh_token`. "Refresh tokens are single-use": every refresh returns a new one and invalidates the old one; "Do not make multiple simultaneous refresh requests"; the old one stays valid **60 seconds** for a lost answer; reuse after that "will cause the entire token family to be revoked". On 5xx retry with the same token; on any other 4xx except 429 "Stop retrying … mark the connection as disconnected". | Docs: both pages |
| Tokens also end when the user disconnects the app in Airwallex, or the user who consented loses the Owner, Admin or Finance Admin role (then refresh fails with `invalid_grant`). | Docs: existing-customers page; https://www.airwallex.com/docs/developer-tools/partner-connections/oauth-permissions |
| Who may consent: Owner, Admin, Finance Admin. | Docs: oauth-permissions page |
| Disconnect: `partner_connection.disconnected` webhook, with `data.account_ids` (one or more), `org_id`, `reason: user_initiated`; one subscription for the whole app. Partner webhooks are made with `POST /api/v1/webhooks/create` and `/{id}/connect`, authenticated with the app's client id and secret, not a user's token. | Docs: https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events/partner-connections ; https://www.airwallex.com/docs/developer-tools/partner-connections/notifications-and-workflow-automation |
| **Revocation by the app:** none documented; only the user disconnects (in Airwallex's settings). **Unknown** whether an endpoint exists. | Docs: none of the pages above lists one |
| Scopes Purser asks for (new names; the old `r:awx_action:*` / `w:awx_action:*` names are "accepted during the transition period"): `account_details:read`, `balance:read`, `beneficiary:write`, `transfer:write` (also covers "Retrieve a current rate"), `fx.conversion:write`, and in the sandbox `simulation:write`. "Only scopes pre-registered with your application are allowed." | Docs: https://www.airwallex.com/docs/developer-tools/partner-connections/oauth-scopes ; oauth2 page |
| **Unknown:** whether `fx/quotes/create` (used by Purser's FX path) is covered by any scope; it is not listed on the scopes page. | Docs: scopes page |
| **Unknown:** the signature scheme of partner webhooks. Purser assumes the one its other Airwallex webhooks use (`x-timestamp`, `x-signature`). | — |

### (c) The customer's books: Moneybird by OAuth

| Fact | Source |
|---|---|
| An app is registered once at `https://moneybird.com/user/applications/new` (personal API token, or an external OAuth application with a `Client ID` and `Client Secret`). | Docs: https://developer.moneybird.com/authentication |
| Authorize: `https://moneybird.com/oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=…`; `client_id` and `redirect_uri` "must exactly match" the registered application; the user "should be owner of the administration". | Docs: same page |
| Token: `POST https://moneybird.com/oauth/token` with `client_id`, `client_secret`, `code`, `redirect_uri`, `grant_type=authorization_code`; answer `access_token`, `refresh_token`, `scope`, `created_at`. "As of now, this token does not expire"; refresh with `grant_type=refresh_token`. | Docs: same page |
| Scopes: `sales_invoices`, `documents`, `estimates`, `bank`, `time_entries`, `settings`; default `sales_invoices`. Purser's connector needs `documents` only (purchase invoices, payments, attachments, journal documents; contacts, ledger accounts and tax rates come with it). | Docs: same page; code `src/erp/moneybird.ts` |
| Revoke: `POST https://moneybird.com/oauth/revoke` (RFC 7009) with the app's credentials and `token`; one call ends both tokens; 200 with an empty body even for an unknown token. | Docs: same page |
| PKCE: **not documented** for Moneybird; Purser sends `state` only. | Docs: same page |
| The token answer names no administration; the administration id is chosen afterwards (Purser's runner keeps `ERP_MONEYBIRD_ADMINISTRATION_ID`). | Docs: same page |

---

## 2. What Purser built (behind flags, off by default)

| Part | Where | Flag | Tested in |
|---|---|---|---|
| KYC: open the connected account, the owner gets Airwallex's own hosted link, status from `account.*` webhooks (existing) **and now by poll** (`POST /v1/airwallex/account/refresh`, `GET /accounts/{id}`, id and status only; a poll counts as the newest word, an older webhook after it changes nothing; an unknown status is left as it was) | `cloud/src/awxPlatform.ts` (`refreshAccount`), `cloud/src/app.ts` | `CloudEnv.awxPlatform` (absent: 404) | `test/cloud-real-customers-kyc.test.ts` |
| No payment until Airwallex reports `ACTIVE`: the runner pays only from the account in the cloud's signed binding, and only while its status is `active` (`checkBinding`); suspended later, payments stop again | `src/airwallex/binding.ts` (existing), proven end to end through the cloud | `AIRWALLEX_PLATFORM=on` | `test/cloud-real-customers-kyc.test.ts` |
| OAuth helpers: authorize URL, PKCE S256 (RFC 7636 test vector), code exchange, refresh, revoke; a refused request keeps only the OAuth error code | `src/lib/oauth.ts` | — | `test/cloud-real-customers-connect.test.ts` |
| Tokens sealed at rest per company: AES-256-GCM, key from a Worker secret (`OAUTH_TOKEN_KEY`), each value bound to company + provider + field as additional data, so a sealed token copied to another company's row does not open | `cloud/src/sealed.ts`, tables `oauth_connections`, `oauth_states` | — | same |
| Connect / finish / token / disconnect: owner session only for start, finish, disconnect; `state` (only its hash kept, single use, ten minutes, bound to the person and company) and PKCE verifier (sealed); code exchanged server side; one Airwallex account belongs to one company; refresh one at a time under a lock, rotated refresh token sealed at once; a 4xx refusal ends the connection, a 5xx keeps it; Moneybird revoked at Moneybird on disconnect; Airwallex has no app revocation, so the owner is told to remove Purser in Airwallex's settings; `partner_connection.disconnected` ends the named accounts' connections; closing a company deletes its tokens | `cloud/src/connect.ts`, routes `/v1/connect*` in `cloud/src/app.ts`, console card "Accounts you already have" in `cloud/src/console.ts` | `PURSER_OAUTH_CONNECT=on` plus `OAUTH_TOKEN_KEY` and an app per provider (Worker secrets, `cloud/src/worker.ts`) | same |
| Every Airwallex call for that company with its own token: the runner fetches a short-lived access token with **its own** sync key (`GET /v1/connect/airwallex/token`); the cloud answers a key only with its own company's token; the client then sends no API key and never `x-on-behalf-of`; a token for another account than the one pinned (`AIRWALLEX_CONNECTED_ACCOUNT`) is refused before any call | `src/cloudsync/connections.ts`, `src/airwallex/client.ts` (`oauth`) | `AIRWALLEX_OAUTH=on` | same ("company A's token can never be used for company B") |
| The Moneybird connector takes the company's token from the cloud the same way | `src/erp/registry.ts` | `ERP_MONEYBIRD_OAUTH=on` | same |

With every flag off, `fromEnv` returns the API key pair as before, the `/v1/connect*` routes answer 404 and the console
shows no new card (tested).

Not built: the platform rail in the Worker itself (the Airwallex client is Node-only; see
[airwallex-platform.md](airwallex-platform.md)), so in production the cloud's `awxPlatform` rail and the OAuth token
endpoint calls run from a Purser-held service, as that page already plans. Customer support and terms of service are
out of scope (the owner's decision).

---

## 3. Live, what the owner must register, and the wording

### Live in Airwallex's sandbox (12 Nov, 8 calls of the 30 approved)

From the call log only ([run record](runs/2026-11-12-real-customers.md)):

- **Confirmed:** a new connected test account opens (`CREATED`) and its status reads back (`CREATED`).
- **Blocked, as the docs say:** `POST /hosted_flows/create` without a template id answers **400** (empty body). The
  hosted KYC flow needs the template open ID from Airwallex; we have none.
- **OAuth:** the sandbox authorize URL with Purser's sandbox client id answers **302** to Airwallex's sign-in page
  (nothing more was done: signing in is a person's step). The token endpoint with that client id and no client secret
  answers **401 `invalid_client`**. Purser has no OAuth application (no client secret, no whitelisted redirect URI), so
  the OAuth part stopped there.

### What the owner must register to switch it on

1. **Airwallex: the hosted onboarding template.** Ask the Airwallex Account Manager to enable hosted flow onboarding on
   the platform account and give the template open ID (optionally the landing page's name, logo and colour).
2. **Airwallex: an OAuth application** through the partner program: client id and client secret for the sandbox, the
   redirect URI `https://<cloud origin>/v1/connect/airwallex/callback` whitelisted, and the scopes in part 1(b)
   pre-registered for the app. Ask Airwallex: which scope covers `fx/quotes/create`; whether an app can revoke a
   connection; the signature scheme of partner webhooks.
3. **Airwallex: a partner webhook** for `partner_connection.disconnected` to `https://<cloud origin>/v1/connect/airwallex/webhook`
   (made with the app's credentials), and its secret.
4. **Moneybird: an external OAuth application** at `moneybird.com/user/applications/new` with the redirect URI
   `https://<cloud origin>/v1/connect/moneybird/callback`.
5. **Purser Cloud secrets** (`wrangler secret put`): `OAUTH_TOKEN_KEY` (32 random bytes, base64),
   `AIRWALLEX_OAUTH_CLIENT_ID`, `AIRWALLEX_OAUTH_CLIENT_SECRET`, `AIRWALLEX_PARTNER_WEBHOOK_SECRET`,
   `MONEYBIRD_OAUTH_CLIENT_ID`, `MONEYBIRD_OAUTH_CLIENT_SECRET`; then the var `PURSER_OAUTH_CONNECT=on`.
6. **Each company's runner:** `AIRWALLEX_OAUTH=on` (and optionally `AIRWALLEX_CONNECTED_ACCOUNT=acct_…` to pin the
   account), `ERP_MONEYBIRD_OAUTH=on`, with `PURSER_CLOUD_URL` and its sync key `PURSER_CLOUD_KEY`.

### Wording to apply (src/redesign pages; not changed here)

Other sessions are rewriting `src/redesign/*`; these lines are for them. Accurate as of this build:

- **Getting started, new company:** "Open your company's own Airwallex account from Purser. Airwallex checks your
  company on its own pages; Purser never asks for or keeps your passport or company documents. Payments start once
  Airwallex says the account is active."
- **Getting started, existing Airwallex customer:** "Already on Airwallex? Connect your account: you sign in at
  Airwallex and choose what Purser may do. Purser keeps the connection encrypted, for your company only. You can
  disconnect at any time, in Purser and in Airwallex's settings."
- **Books:** "Connect your Moneybird administration: you sign in at Moneybird and allow Purser to file purchase
  invoices and payments. Disconnecting in Purser revokes the access at Moneybird too."
- **Status line under the account:** "Waiting for Airwallex's check" (created, pending), "Airwallex needs more from you"
  (action required), "Active", "Stopped by Airwallex" (suspended).
- **Be exact about state:** say "sandbox" and "test money" until a company goes live; do not say the OAuth connection
  works live (it needs Purser's OAuth application, not yet registered); never say Purser is certified or endorsed by
  Airwallex or Moneybird.
