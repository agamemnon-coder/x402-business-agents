# Contributing

Purser is a hackathon project (Airwallex Agentic Banking Hackathon, Starter Kit 11) that runs on test money only: the
Airwallex sandbox and Metal testnet. Issues and pull requests are welcome.

## Before you open a pull request

```sh
npm ci
npm run typecheck
npm run lint
npm test                    # stand-ins for Airwallex, Metal and Claude; no network, no keys
npm run judge -- --check    # every page built offline from the committed records
```

Run the tests with the API keys unset, as CI does. The browser checks (`test/browser/*.check.ts`) need Playwright's
Chromium; `BROWSER=firefox` or `BROWSER=webkit` runs them in the other engines.

## The rules this repository keeps

- **Nothing claimed that did not run.** A figure on a page or in a doc is read from a run record (`docs/runs/`,
  `docs/demo/`) or listed in [docs/claims.md](docs/claims.md); a test checks it. Simulated, sandbox, testnet and
  stand-in parts are labelled as such; what has not run is called "next".
- **No secrets.** No key, token, password or environment value in code, tests, docs, commits or logs. gitleaks runs on
  every push; a false positive goes in `.gitleaksignore` with a comment saying why.
- **No real money.** Live runs use sandboxes and testnets, within a call budget agreed before the run, and each one gets
  a dated record under `docs/runs/`.
- **Tests never use the network.** Partners are faked in `test/fakes/`.
- **Every payment beyond the CFO's limits needs the CFO's passkey** over the exact terms. A change that weakens that, or
  lets a model approve, will not be merged.

## Pull requests

Use the template (What changed, Why, Tests and checks run, Live calls made, Not done). Keep one topic per pull request;
merge `main` into your branch rather than rebasing a shared one. The changelog is generated: `npm run changelog`.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports go to [SECURITY.md](SECURITY.md), not to
a public issue.
