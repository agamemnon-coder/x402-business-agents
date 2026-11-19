# What the owner sets up by hand (security, 19 November)

Steps only the owner can take, in the Airwallex web app and in Cloudflare. No key or secret goes into a file, a chat
or a commit; each is typed into the place named below. What the code does with them:
[2026-11-19-hardening.md](2026-11-19-hardening.md).

## Scoped Airwallex keys, one per role

Purser can use a separate Airwallex API key for each of its roles (`src/airwallex/keyScopes.ts`). Each is read from
its own variable, with the same `AIRWALLEX_CLIENT_ID`, and falls back to `AIRWALLEX_API_KEY` while it is unset, so
nothing changes until a key is set. With a role key set, Purser refuses, before sending anything, any call outside that
role's scopes, and a runner whose code would make such a call refuses to start.

In the Airwallex web app, where API keys are managed, create one scoped key per row (scope labels as the web app
shows them; Read lets a key call a resource's GET endpoints, Write its GET and POST endpoints, per
[Airwallex's scope reference](https://www.airwallex.com/docs/developer-tools/api/api-key-scopes.md)):

| Variable | Role | Write | Read | Used by |
|---|---|---|---|---|
| `AIRWALLEX_API_KEY_READ` | reads only | none | Balances, Deposits, Global Accounts, Transfers, Beneficiaries, Conversion, Financial Transactions, Bills, Vendors, Authorizations and Transactions, Cards | reconciliation (`src/finance/sources.ts`), the check after each payout, `npm run reconcile`, `npm run verify`, `npm run health` |
| `AIRWALLEX_API_KEY_PAYOUT` | the payout executors | Transfers, Beneficiaries, Conversion, Simulations (sandbox only) | Balances | the payout rail (`src/airwallex/adapter.ts` via `airwallexFromEnv`), the one Airwallex batch transfer, the sandbox's card-charge simulation |
| `AIRWALLEX_API_KEY_ISSUING` | the agents' cards | Cards, Cardholders | Authorizations and Transactions | the card rail (`issuingFromEnv`): issue, limits, freeze, the card transactions |
| `AIRWALLEX_API_KEY_SPEND` | bills and vendors | Bills, Vendors, Upload Files | none | reserved: this build makes no Spend call yet, so nothing uses it |

Then, on the runner host (never in git), each key into the environment the runner reads, beside the existing
`AIRWALLEX_CLIENT_ID`:

```bash
AIRWALLEX_API_KEY_READ=…      # typed into the host's secret store, not on a command line
AIRWALLEX_API_KEY_PAYOUT=…
AIRWALLEX_API_KEY_ISSUING=…
```

Notes:

- **What still uses `AIRWALLEX_API_KEY`.** Calls made without a role keep the general key: setup (global accounts,
  webhooks, beneficiaries created from the CLIs), the payee name check, the platform's connected accounts, payment
  acceptance, the demo and sweep CLIs. Once every role key is set, the general key can be a restricted key that holds
  only what those still need, or be unset on a runner that runs none of them.
- **Simulations is a payout scope.** In the sandbox the card-charge simulation runs on the payout key, not the issuing
  key; in production there is no simulation and Simulations is not granted.
- **A company's own OAuth connection** (`AIRWALLEX_OAUTH=on`) is not an API key: these roles do not apply to it.
- **Check after setting them:** start the runner; it stops at once with `a scoped Airwallex key would be used outside its
  scopes` if a key's role does not cover a call Purser makes with it. Then `npm run health` reads the balances with the
  read key.
- **What scoping does not change:** anyone with the Airwallex web app, or a key with Issuing write, can still change a
  card's limit at Airwallex directly (see the hardening note, section 2). Keep web-app access to people who need it,
  and add Airwallex's IP allowlist for each key in production.

## Cloudflare Turnstile on the /try start

The steps are in [cloud.md](../cloud.md#cloudflare-turnstile-before-a-start-19-nov-off-by-default): add the widget in
the Cloudflare dashboard, `worker/node_modules/.bin/wrangler secret put TURNSTILE_SECRET -c cloud/wrangler.try.jsonc`,
then the switch `turnstile` on. Not before the /try page renders the widget: until then the switch refuses every start
from the page.
