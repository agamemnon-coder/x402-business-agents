# Real customers, sandbox run (12 November 2026)

**Labels: Airwallex sandbox only; test data only; no money moved.** Approved budget: at most 30 Airwallex requests,
counted by Purser's call budget (`AIRWALLEX_CALL_BUDGET=30`, `AIRWALLEX_CALL_LOG`): every request is written to the log
before it is sent, the login and the OAuth endpoints included. **Calls used: 8 of 30.** Moneybird: no calls (its OAuth
application is the owner's to register).

What this run was for ([docs/real-customers.md](../real-customers.md)): open one connected test account for a new
company and read its status; get Airwallex's hosted onboarding (KYC) link; see what Airwallex answers to an OAuth
connection with the credentials Purser has.

Call log (method, path with ids replaced, time; no bodies, no headers):
[2026-11-12-real-customers-calls.jsonl](2026-11-12-real-customers-calls.jsonl). The answers are as the run printed them
(status, code, ids, trace ids only).

| # | Time (UTC) | Call | Answer |
|---|---|---|---|
| 1 | 14:18:25.018 | `POST /authentication/login` | 201 |
| 2 | 14:18:25.673 | `POST /accounts/create` through Purser's rail (`AirwallexPlatformRest.createConnectedAccount`): "Purser Real Customers Test BV (fake)", NL, a test e-mail, both customer agreements, a `request_id` | **`CREATED`**, `acct_tqitvOzLOL2gzTyLb5mgXg` |
| 3 | 14:18:26.703 | `GET /accounts/acct_tqitvOzLOL2gzTyLb5mgXg` through Purser's rail (`getAccount`: id and status only) | **`CREATED`** |
| 4 | 14:18:27.148 | `POST /hosted_flows/create` with `account_id`, `return_url`, `error_url`, **no `template`** (Airwallex has not given us one) | **400** (trace `eee48d3b82e745afaf5ce29bfd7e3453`) |
| 5 | 14:18:27.455 | `GET https://www.sandbox.airwallex.com/oauth/authorize` with Purser's sandbox client id, the redirect URI `…/v1/connect/airwallex/callback`, Purser's scopes, `state`, an S256 `code_challenge`; redirects not followed | **302** to `www.sandbox.airwallex.com/app/login-auth/sandbox` (Airwallex's sign-in page; no `error` in the redirect) |
| 6 | 14:18:28.091 | `POST https://api.sandbox.airwallex.com/oauth/token`, `grant_type=authorization_code`, Purser's sandbox client id, **no client secret**, a made-up code, the verifier | **401 `invalid_client`** (trace `0f3283401778430a857614ecd22d18a3`) |
| 7 | 14:18:42.958 | `POST /authentication/login` (a second, raw run to read call 4's error body, which Purser's client does not keep) | 201 |
| 8 | 14:18:43.508 | `POST /hosted_flows/create`, the same body as call 4 | **400 with an empty body** (trace `c74fa9f1b1ae4ac8b584e58bd0ced1af`) |

## Confirmed live

- A new connected account for a test company opens in our sandbox (`CREATED`) through Purser's rail, and its status
  reads back through `GET /accounts/{id}` (`CREATED`), which is what Purser's new poll uses.

## Stopped, and why

- **Hosted KYC link:** `hosted_flows/create` without a template answers 400 with no body. Airwallex's docs say the
  hosted flow needs a template open ID from the Account Manager; we have none, so no link was made and nothing was
  shown to anyone. Nothing was submitted for the test account: it stays `CREATED`, and Purser refuses any payment from
  it (status not `active`).
- **OAuth:** Airwallex's authorize page answers with its sign-in page for our client id (a person would sign in there;
  not done). The token endpoint refuses our client id without a client secret (`invalid_client`). Purser has an API
  key, not an OAuth application: no client secret, no whitelisted redirect URI. The OAuth part stops here until the
  owner registers an application through Airwallex's partner program ([what to register](../real-customers.md#what-the-owner-must-register-to-switch-it-on)).

Nothing was paid, no beneficiary was created, no transfer exists and no fee was taken.
