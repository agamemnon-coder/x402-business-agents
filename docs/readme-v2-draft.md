<!-- Draft of the README's next structure (12 Nov), written by `npm run readme-draft` (src/cli/readmeDraft.ts).
     Not README.md yet: the orchestrator integrates it. Every number below is read from a run record or computed;
     regenerate rather than edit. Image paths are relative to docs/. -->

# Purser

**AI agents spend company money only within limits the CFO signs with Face ID.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/payment-life-wide-dark.svg">
  <img src="assets/payment-life-wide-light.svg" alt="One payment's life: invoice, read by Claude, checked by Purser's code, the exact terms hashed, signed by the CFO's Face ID, checked again by the rail's own control, paid, booked." width="100%">
</picture>

Three proofs that the rail itself holds the line, each from a live sandbox or testnet run:

| Rail | What happened | Record |
|---|---|---|
| **Airwallex**<br>`IN_APPROVAL` | After the CFO's passkey (a labelled test passkey) signed, Purser created transfer 4074d684… for EUR 240.00. Airwallex held it IN_APPROVAL until a person approves it in Airwallex; nobody did, so it was not paid. | 10 Nov, Airwallex sandbox, test money.<br>[Run record](runs/2026-11-10-airwallex-two-locks.md) |
| **Metal**<br>`mandate_cap_exceeded` | As a test, Purser's own check was switched off for one purchase. Metal refused #24 (0.04, over the 0.03 cap) and recorded the refusal on chain; nothing settled. | 3 Nov, Metal testnet, test money.<br>[Run record](runs/2026-11-03-main-run.md) · [tx 0x2e92…1871](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871) |
| **Visa Intelligent Commerce via Airi**<br>`no passkey, no credential` | A purchase waited for the cardholder to confirm it with a passkey in Airi. None came within 5 minutes: no card credential, nothing charged, and Purser cancelled the mandate.<br>_Airi's own step held; Airi has not refused a purchase outright in a live run._ | 7 Nov, Airwallex sandbox, test card, test money.<br>[Run record](runs/2026-11-07-vic-1.md) |

**Try it with your own Face ID:** [kit11.max-31b.workers.dev/try/sign](https://kit11.max-31b.workers.dev/try/sign) signs a test payment
in your own test world (stand-in executors: no payment reaches Airwallex or Metal).

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-wide-dark.svg">
  <img src="assets/architecture-wide-light.svg" alt="AI agents propose; three layers that do not trust each other must each say yes: Purser's checks in code, the CFO's Face ID over the exact terms, the rail's own controls; then the ledger, the books and the archive." width="100%">
</picture>

1. **Agents propose.** Claude agents read invoices and propose payments. An agent cannot change its own limits.
2. **Purser's code checks.** Per-agent limits and budgets, allowed payees and merchants, the invoice's totals. It
   hashes the exact terms (SHA-256).
3. **The CFO signs.** Above a limit, the CFO approves with Face ID: a passkey signs that hash. Before paying, Purser
   hashes the terms again; changed terms are refused.
4. **The rail checks on its own.** Airwallex (transfer approvals, card controls), Metal (a mandate cap on chain) and
   Visa Intelligent Commerce via Airwallex's Airi (the cardholder's passkey per purchase) each keep their own limit.
5. **Booked and archived.** Every step goes to a hash-chained audit log; the books go to the accounting; documents
   keep every version.

## Security model

| Layer | Held by | Refuses on its own | Trusts the others? |
|---|---|---|---|
| 1. Purser's checks | Code in this repository | over a limit or budget, an unknown payee, totals that do not add up | No |
| 2. The CFO's signature | The CFO's passkey (Face ID) over the hash of the exact terms | terms changed after signing (the executor re-hashes) | No |
| 3. The rail's own controls | Airwallex, Metal, Airi | over the rail's own limit or approval, even after Purser's yes | No |

Threat model: [security.md](security.md). Controls: [controls.md](controls.md). Security reports:
[SECURITY.md](../SECURITY.md).

## Partners, and what ran live on each

Text only: no logos, no endorsement implied. Every run is in sandbox or testnet with test money; dates and records
in [runs/README.md](runs/README.md).

- **Airwallex (sandbox).** Main run, 3 Nov: the hash the CFO signed is in Airwallex's own record of SWIFT transfer `03360bfa…` (EUR 240.00). awx-1, 7 Nov: Airwallex declined agents' cards with its own controls (`LIMIT_EXCEEDED`, `MERCHANT_CATEGORY_NOT_ALLOWED`). Two locks, 10 Nov: its approval workflow held a signed transfer `IN_APPROVAL`.
- **Metal (testnet).** Main run: a mandate on chain per agent; 86 payments, each its own transaction; #24 refused on chain (`mandate_cap_exceeded`); the mandates replaced on chain after the CFO's Face ID.
- **Visa Intelligent Commerce via Airwallex's Airi (sandbox, test card).** 7 Nov: 2 purchases paid with a single-use credential, each confirmed by the cardholder's passkey in Airi; 5 of 5 checks passed ([run log](runs/2026-11-07-vic-1.md)).
- **Claude (Anthropic).** Main run: 24 of 24 decisions by Claude, 0 fallbacks; 5 Face ID signatures in the same run.
- **Books.** T:0 (sandbox): 95 journal entries of the main run posted ([record](runs/2026-11-10-t0-journal-sandbox.md)). Moneybird (Moneybird sandbox administration, test data, no e-mail sent): 6 documents read back, 0 differences ([record](runs/2026-11-12-moneybird-sandbox.md)).

## Run it yourself

Needs Node.js 22.13 or later and git. No keys; after `npm ci`, no network.

```sh
git clone https://github.com/agamemnon-coder/x402-business-agents.git
cd x402-business-agents
npm ci
npm test                    # the tests, on stand-ins for Airwallex, Metal and Claude
npm run judge -- --check    # builds the site's pages from the main run's record, offline
npm run judge               # serves them on http://localhost:4311
npm run visuals -- --check  # the diagrams in docs/assets are what the code draws
```

Running it live (sandbox keys, a Metal RPC): [run-it.md](run-it.md).

## Repository map

| Folder | What | Files |
|---|---|---|
| `src/` | Purser: agents, policy, passkey approvals, executors per rail, ledger, the site's pages | 527 |
| `cloud/` | Purser Cloud: the small-company product (invoices in, read, paid after Face ID, booked, archived) | 28 |
| `worker/` | The hosted site and relay (Cloudflare Worker): /try/sign, the phone-to-runner relay | 13 |
| `contracts/` | Solidity contracts used on Metal testnet, with their ABIs | 7 |
| `test/` | Unit, integration and browser checks | 471 |
| `docs/` | Run logs, records, security, plans, the visuals | 422 |
| `fixtures/` | Test invoices, including the hostile ones (bank change, look-alike, injection) | 19 |

## Tests and CI

- **4448 of 4449 tests passed** in 419 files, 1 skipped (vitest report of this draft's build; CI runs them on every push).
- 415 test files, 11 browser checks (Playwright, 390 and 1440 px), 2 workflows.
- CI steps (from `.github/workflows/ci.yml`): Tests with coverage, per area; Relay Worker type check; Cloud tests on local D1; npm run judge (no keys, no ledger); Guest pages in Chromium (/, /demo, /month at 390 and 1440 px); Agent trace in Chromium (390 and 1440 px, light and dark); /try/sign in Chromium (360, 390 and 1440 px, light and dark; layout after signing and after the tamper); Purser Cloud's console in Chromium (first run and sign-in with a virtual passkey, every page at 1440 and 390 px); /try/sign in WebKit (390 px light, 1440 px dark; up to the passkey step where WebKit has WebAuthn); gitleaks, whole history of this commit; SBOM (CycloneDX, runtime dependencies); Semgrep (blocking; public sets plus .semgrep/purser.yml).
- 62 dated run logs in [runs/](runs/).

## Limits, and what is simulated

| | Status |
|---|---|
| Money | Test money only: Airwallex sandbox, Metal testnet, Airi's test card. No real money has moved. |
| Main run (3 Nov) | Live calls to the Airwallex sandbox, Metal testnet and Claude; the CFO's Face ID on a phone. The sandbox simulates a SWIFT transfer's last steps and the merchant's card charge. |
| Customer, supplier, second approver | Run by us (the second approver is a labelled test passkey). |
| Home, Watch, Proof | Replay the main run's record. |
| /try/sign | Your own test world on stand-in executors: your passkey's signature is real, no payment reaches a rail. |
| Airi | Its own passkey step held a purchase; it has not refused one outright in a live run. |
| Two locks | Airwallex held the transfer `IN_APPROVAL`; it was never approved in the web app, so never paid. |
| Purser Cloud | A hosted preview behind an access key; no customer uses it; test money only. |
| Tests | Run on stand-ins for Airwallex, Metal and Anthropic. |
| Customers | Not validated with customers yet; no pilots, no revenue. |

Screenshots and short loops of the live site: [assets/screens/](assets/screens/README.md).
