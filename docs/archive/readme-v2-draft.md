<!-- Draft of the README's next structure (12 Nov), written by `npm run readme-draft` (src/cli/readmeDraft.ts).
     Not README.md yet: the orchestrator integrates it. Every number below is read from a run record or computed;
     regenerate rather than edit. Image paths are relative to docs/. -->

# Purser

**AI agents spend company money only within limits the CFO signs with Face ID.**

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="assets/payment-life-tall-dark.svg">
  <source media="(max-width: 600px)" srcset="assets/payment-life-tall-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="assets/payment-life-wide-dark.svg">
  <img src="assets/payment-life-wide-light.svg" alt="One payment's life: invoice, read by Claude, checked by Purser's code, the exact terms hashed, signed by the CFO's Face ID, checked again by the rail's own control, paid, booked." width="100%">
</picture>

Three runs where the rail itself held a payment, each a live sandbox or testnet run:

| Rail | What happened | Record |
|---|---|---|
| **Airwallex**<br>`IN_APPROVAL` | A labelled virtual test passkey signed the terms in Purser; Purser created transfer 4074d684… for EUR 240.00 on 10 Nov. Airwallex held it IN_APPROVAL until a person approved it at Airwallex, 12 Nov; then PAID (simulated settlement). | 12 Nov, Airwallex sandbox, test money.<br>[Run record](../runs/2026-11-12-airwallex-two-locks-paid.md) |
| **Metal**<br>`mandate_cap_exceeded` | As a test, Purser's own check was switched off for one purchase. Metal refused #24 (0.04 test USD, over the 0.03 cap) and recorded the refusal on chain; nothing settled. | 3 Nov, Metal testnet, test money.<br>[Run record](../runs/2026-11-03-main-run.md) · [tx 0x2e92…1871](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871) |
| **Visa Intelligent Commerce via Airi**<br>Airi's passkey step | In a failed attempt, a purchase waited for the cardholder to confirm it with a passkey in Airi. The tap did not come within 5 minutes: no card credential, nothing charged. Purser's own timeout (PURSER_NO_TAP) then cancelled the mandate.<br>_Airi has not refused a purchase outright in a live run._ | 7 Nov, Airwallex sandbox, test card, test money.<br>[Run record](../runs/2026-11-07-vic-1.md) |

**Try it with your own Face ID:** [kit11.max-31b.workers.dev/try/sign](https://kit11.max-31b.workers.dev/try/sign) signs a test payment
in your own test world (stand-in executors: no payment reaches Airwallex or Metal).

## How it works

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="assets/architecture-tall-dark.svg">
  <source media="(max-width: 600px)" srcset="assets/architecture-tall-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-wide-dark.svg">
  <img src="assets/architecture-wide-light.svg" alt="AI agents propose; three layers that do not trust each other can each stop a payment: Purser's checks in code, the CFO's Face ID over the exact terms above a limit, the rail's own controls; then the ledger." width="100%">
</picture>

1. **Agents propose.** Claude agents read invoices and propose payments. An agent cannot change its own limits.
2. **Purser's code checks.** Per-agent limits and budgets, allowed payees and merchants, the invoice's totals. It
   hashes the exact terms (SHA-256).
3. **The CFO signs.** Above a limit, the CFO approves with Face ID: a passkey signs that hash. Every change to a
   limit is a proposal the CFO signs too. Before paying, Purser hashes the terms again; changed terms are refused.
   Within the limits, a payment goes without a new signature: the CFO signed those limits.
4. **The rail checks on its own.** Airwallex (transfer approvals, card controls), Metal (a mandate cap on chain) and
   Visa Intelligent Commerce via Airwallex's Airi (the cardholder's passkey per purchase) each keep their own limit.
5. **Recorded.** Every step goes to the ledger's hash-chained audit log. Books were posted to T:0 and Moneybird in
   sandbox runs; Purser Cloud (a private preview, no customer) keeps invoices, suppliers and payments with every
   version.

## Security model

| Layer | Held by | Refuses on its own | Trusts the others? |
|---|---|---|---|
| 1. Purser's checks | Code in this repository | over a limit or budget, an unknown payee, totals that do not add up | No |
| 2. The CFO's signature | The CFO's passkey (Face ID) over the hash of the exact terms | terms changed after signing (the executor re-hashes) | No |
| 3. The rail's own controls | Airwallex, Metal, Airi | over the rail's own limit or approval, even after Purser's yes | No |

What this does not cover: the rails' limits (Metal mandate caps, Airwallex card limits) are set by Purser's runner,
which holds the keys, with the CFO's signature for each change. So the layers hold against an agent, a changed
invoice or changed terms, not against a compromised runner (see the threat model).

Threat model: [security.md](../security.md). Controls: [controls.md](../controls.md). Security reports:
[SECURITY.md](../../SECURITY.md).

## Partners, and what ran live on each

Built with:

<img src="assets/logos/built-with.png" alt="Built with Airwallex, Metal, Claude, Visa, Cloudflare" height="44">

The logos are the partners' official files, unmodified ([sources](../assets/logos/SOURCES.md)); no endorsement is
implied. Named in text only: Moneybird, T:0 (why: [sources](../assets/logos/SOURCES.md#left-out-named-in-text-only)).
Every run is in sandbox or testnet with test money; dates and records in [runs/README.md](../runs/README.md).

- **Airwallex (sandbox).** Main run, 3 Nov: the hash the CFO signed is in Airwallex's own record of SWIFT transfer `03360bfa…` (EUR 240.00). awx-1, 7 Nov: Airwallex declined agents' cards with its own controls (`LIMIT_EXCEEDED`, `MERCHANT_CATEGORY_NOT_ALLOWED`). Two locks, from 12 Nov: A labelled virtual test passkey signed the terms in Purser; Purser created transfer 4074d684… for EUR 240.00 on 10 Nov. Airwallex held it IN_APPROVAL until a person approved it at Airwallex, 12 Nov; then PAID (simulated settlement).
- **Metal (testnet).** Main run: a mandate on chain per agent; 86 payments, each its own transaction; #24 refused on chain (`mandate_cap_exceeded`); the mandates replaced on chain after the CFO's Face ID.
- **Visa Intelligent Commerce via Airwallex's Airi (sandbox, test card).** 7 Nov: 2 purchases paid with a single-use credential, each confirmed by the cardholder's passkey in Airi; 5 of 5 checks passed ([run log](../runs/2026-11-07-vic-1.md)).
- **Claude (Anthropic).** Main run: 24 of 24 decisions by Claude, 0 fallbacks; 5 Face ID signatures in the same run.
- **Books.** T:0 (sandbox): 95 journal entries of the main run posted ([record](../runs/2026-11-10-t0-journal-sandbox.md)). Moneybird (Moneybird sandbox administration, test data, no e-mail sent): 6 documents read back, 0 differences ([record](../runs/2026-11-12-moneybird-sandbox.md)).

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

Running it live (sandbox keys, a Metal RPC): [run-it.md](../run-it.md).

## Repository map

| Folder | What | Files |
|---|---|---|
| `src/` | Purser: agents, policy, passkey approvals, executors per rail, ledger, the site's pages | 687 |
| `cloud/` | Purser Cloud: the small-company product (invoices in, read, paid after Face ID, booked, archived) | 103 |
| `worker/` | The hosted site and relay (Cloudflare Worker): /try/sign, the phone-to-runner relay | 19 |
| `contracts/` | Solidity contracts used on Metal testnet, with their ABIs | 7 |
| `test/` | Unit, integration and browser checks | 656 |
| `docs/` | Run logs, records, security, plans (the generated visuals in `docs/assets/` not counted) | 467 |
| `fixtures/` | Test invoices, including the hostile ones (bank change, look-alike, injection) | 20 |

## Tests and CI

- **6513 of 6517 tests passed** in 577 files, 4 skipped, on commit `62100b5d` ([summary](../assets/test-summary.json)); CI runs them on every push.
- 573 test files under `test/`, 15 browser checks (Playwright, 390 and 1440 px), 2 workflows.
- CI steps (from `.github/workflows/ci.yml`): Tests with coverage, per area; Engine tests through the Durable Object handle; Hostile-model eval of the payables agents (the line /claude shows); Relay Worker type check; Cloud tests on local D1; npm run judge (no keys, no ledger); Guest pages in Chromium (/, /demo, /month at 390 and 1440 px); Agent trace in Chromium (390 and 1440 px, light and dark); /try/sign in Chromium (360, 390 and 1440 px, light and dark; layout after signing and after the tamper); The CFO's phone pages in Chromium (enrol, approve in every state, policy; 390 and 1440 px, light and dark); Purser Cloud's console in Chromium (first run and sign-in with a virtual passkey, every page at 1440 and 390 px); Connect Claude end to end (registration, a cross-site redirect into the consent page, PKCE, MCP with the token; the MCP SDK's own client); /try/sign in WebKit (390 px light, 1440 px dark; up to the passkey step where WebKit has WebAuthn); Playwright Firefox, with its system libraries; Guest pages in Firefox (360, 390, 768 and 1440 px, light and dark); /try/sign in Firefox (360, 390 and 1440 px, light and dark; signed with the software passkey); gitleaks, whole history of this commit; SBOM (CycloneDX, runtime dependencies); Semgrep (blocking; public sets plus .semgrep/purser.yml).
- 81 dated run logs in [runs/](../runs/).

## Limits, and what is simulated

| | Status |
|---|---|
| Money | Test money only: Airwallex sandbox, Metal testnet, Airi's test card. No real money has moved. |
| Main run (3 Nov) | Live calls to the Airwallex sandbox, Metal testnet and Claude; the CFO's Face ID on a phone. The sandbox simulates a SWIFT transfer's last steps and the merchant's card charge. |
| Customer, supplier, second approver | Run by us (the second approver is a labelled test passkey). |
| Home, Watch, Proof | Replay the main run's record. |
| /try/sign | Your own test world on stand-in executors: your passkey's signature is real, no payment reaches a rail. |
| Airi | Its own passkey step held a purchase; it has not refused one outright in a live run. |
| Two locks | Purser's lock was a labelled virtual test passkey, not a person's Face ID. Airwallex held the transfer `IN_APPROVAL` until a person approved it at Airwallex; `SENT` and `PAID` came from the sandbox's simulation. |
| Purser Cloud | A hosted preview behind an access key; no customer uses it; test money only. |
| Tests | Run on stand-ins for Airwallex, Metal and Anthropic. |
| Customers | Not validated with customers yet; no pilots, no revenue. |

Screenshots and short loops of the live site: [assets/screens/](../assets/screens/README.md).
