# Purser · AI agents spend. You sign off.

For CFOs whose AI agents pay suppliers: when an agent wants to pay an invoice over its limit, you sign the exact terms with Face ID.

An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless.

**[Try it in a minute.](https://kit11.max-31b.workers.dev/try)** · **[Judge it in 3 minutes →](https://kit11.max-31b.workers.dev/judge)** · [Film, 3:58](https://youtu.be/kCUsFHrxE-o) · [Verify it offline](#verify-it-yourself-in-3-commands) · [The 60-second story](https://kit11.max-31b.workers.dev/try/sign)

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Tests: 6034 passing](https://img.shields.io/badge/tests-6034%20passing-brightgreen)](#verify-it-yourself-in-3-commands) [![Live demo: hands-on](https://img.shields.io/badge/live%20demo-hands--on-7c6cff)](https://kit11.max-31b.workers.dev/try) ![Metal testnet · Airwallex sandbox · Visa Intelligent Commerce · Claude: test money only](https://img.shields.io/badge/Metal%20testnet%20%C2%B7%20Airwallex%20sandbox%20%C2%B7%20Visa%20Intelligent%20Commerce%20%C2%B7%20Claude-test%20money%20only-555)

## For reviewers in 30 seconds

**What it is:** the control layer between a company's AI agents and its money on Airwallex and Metal, built for
Starter Kit 11 (x402 Business Agents) and entered for the Metal Award and the Visa Award. Northwind Outdoor, the example
company, is an outdoor wholesaler that sells live stock data to retailers per query: the kit's data business.
The Kit 11 scenario, run live on 3 November, and the separate runs after it:

| Rail | What ran live (Airwallex sandbox, Metal testnet, test money) | One id |
|---|---|---|
| Airwallex | Airwallex's own card controls declined an agent's EUR 45.00 purchase over its EUR 30.00 limit (`LIMIT_EXCEEDED`; the charge simulated through the sandbox), in the Airwallex-only run of 7 November | card transaction [`01a1b5e8-6dc2-7000-95bf-c8fc5e6e2f38`](docs/demo/airwallex-run.json) |
| Metal | Purchase #24, over the agent's mandate, refused on chain in the main run of 3 November, after we switched off our own check once to test the chain | [`0x2e92f9cb…1871`](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871) |
| Visa | Visa Intelligent Commerce (VIC) through Airwallex's Airi wallet, 7 November: a scripted purchase with no model call, confirmed by a person's passkey tap in Airi; above Purser's limit it ran only after the CFO's Face ID. TAP is an extra ([note](docs/submission/long-description.md#visa)) | PaymentIntent [`int_sgpvzc9hjhnxvxc26ie`](docs/runs/2026-11-07-vic-1.md) |
| Claude | Three tool-use agents made all 24 of the main run's decisions, with 0 fallbacks; routine payments are code | request [`req_011Cgfuhfh5iBjb9NbobuahB`](docs/demo/main-run.json) |
| x402 | The seller checks each payment before it does the work and settles it on Metal before it sends the answer; the protocol leaves the payer's budget to the payer, and in Purser that is the CFO's signed limit. 41 sales among the main run's 86 test-USD payments, each its own transaction | first sale [`0x2cc5a16e…2fc7`](https://testnet.metalntwx.com/tx/0x2cc5a16e4aa74d5912e1b155f815270bd6f8a82796c08371dafa540410fa2fc7) |

**Try it:** on [Try](https://kit11.max-31b.workers.dev/try), a test company of your own: Claude reads a sample invoice,
you approve the exact terms with your own passkey, and it is paid on a simulated bank and booked. Then change what you
signed: the changed terms are refused.\
**Verify offline:** `npm ci && npm run judge`, then `npm run verify-approval`: Node's own crypto checks that real
signature; each run's audit log is hash-chained, every row covering the one before. [Three commands](#verify-it-yourself-in-3-commands);
every run and id: [docs/in-depth.md](docs/in-depth.md).\
**Latest live runs, 12 and 13 November** (sandbox and testnet, test money; [all runs](docs/runs/README.md)): on Metal, a passkey account whose two owners (the CFO's passkey and a labelled virtual test passkey) signed 2 of 2, and Metal refused a payment over the mandate's cap on chain ([record](docs/runs/2026-11-12-faceid-onchain.md)); at Airwallex, a payout held `IN_APPROVAL` until a person approved it there, then PAID, settlement simulated ([record](docs/runs/2026-11-12-airwallex-two-locks-paid.md)); an invoice token minted, financed and settled on Metal testnet, a prototype with a simulated financier ([record](docs/runs/2026-11-12-tokenize.md)); the books in a Moneybird sandbox, 0 differences ([record](docs/runs/2026-11-12-moneybird-sandbox.md)); and Try with Claude Haiku reading the invoice, on a simulated bank and a test passkey ([record](docs/runs/2026-11-13-try-sample.json)).\
**Simulated:** the customer, the supplier, the merchants' charges, the settlement and the second approver; test money
only. Built with Claude (Anthropic) as the developer, directed and reviewed by Max Geurtsen.

<picture><source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="docs/assets/payment-life-tall-dark.svg"><source media="(max-width: 600px)" srcset="docs/assets/payment-life-tall-light.svg"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/payment-life-wide-dark.svg"><img src="docs/assets/payment-life-wide-light.svg" alt="One payment's life: an invoice arrives, Claude reads it, Purser's code checks it, the exact terms are hashed, above a limit the CFO signs that hash with Face ID, the rail checks with its own controls, the payment is made and written to the ledger." width="100%"></picture>

<table><tr><td width="25%"><a href="https://kit11.max-31b.workers.dev/try/sign"><img src="docs/assets/readme/phone-faceid.webp" alt="The CFO's phone: the exact terms and one button, Approve with Face ID"></a><br><b>Approve with Face ID</b></td><td width="25%"><a href="https://kit11.max-31b.workers.dev/"><img src="docs/assets/readme/tamper-refused.webp" alt="One cent changed, EUR 240.01: the terms hash no longer matches and the payment is refused"></a><br><b>One cent changed, refused</b></td><td width="25%"><a href="https://kit11.max-31b.workers.dev/proof"><img src="docs/assets/readme/proof.webp" alt="Proof: each claim with its id, its code and its run"></a><br><b>Proof, every id</b></td><td width="25%"><a href="https://kit11.max-31b.workers.dev/try"><img src="docs/assets/readme/hands-on.webp" alt="Hands-on: a test company of your own on Purser's engine, test money"></a><br><b>Hands-on, test money</b></td></tr></table>

## See it

<img src="docs/assets/charts/live-runs-per-rail.svg" alt="Live runs per rail, from the run records" width="49%"> <img src="docs/assets/charts/main-run-claude.svg" alt="Main run: Claude's decisions and cost per agent, from its record" width="49%"> <img src="docs/assets/charts/main-run-refusals.svg" alt="Main run: what was refused, from its record" width="49%"> <img src="docs/assets/charts/tests-over-time.svg" alt="Tests in the suite over time, from the README's own history" width="49%">

Drawn from the records by `npm run charts`; the architecture, one payment end to end and the mandate on Metal are [three diagrams](docs/diagrams.md).

## Why this is a company

Not validated with customers yet: 2 finance conversations (a CFO and a bank finance professional, quoted, anonymous); more in progress; no pilots, no revenue. Every line below is a hypothesis except the cited source.

- **The problem:** when an AI agent pays today, its limit lives in a prompt it can be talked out of, or in a month-end review that finds the money after it has left. ([problem.md](docs/business/problem.md#what-goes-wrong))
- **Who buys:** the finance team of a small company or scale-up that already banks with Airwallex and lets AI agents pay; the CFO uses it and decides. ([model.md](docs/business/model.md#who-buys-and-who-uses-it-hypothesis))
- **Pilot pricing:** Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout. A hypothesis. ([model.md](docs/business/model.md#pilot-pricing-hypothesis))
- **Why now:** Airwallex wrote on 5 October 2026 that agents moving money need limits enforced "through underlying infrastructure rather than prompts" ("Agentic banking starts with governance", source S1). ([problem.md](docs/business/problem.md#why-now-sourced))
- **Why Purser:** it builds on Airwallex's own card controls and Metal's mandates, and adds what sits on top: one CFO policy for card and chain, approvals signed over the exact terms, a hash-chained audit log. ([model.md](docs/business/model.md#risks-and-what-we-do-not-know))

**Why not Airwallex's own approvals?** Purser signs the exact terms with the CFO's passkey before the API call, enforces per-agent limits across Airwallex and Metal, and can additionally require Airwallex's approval workflow (`IN_APPROVAL` handled, [src/airwallex/approvals.ts](src/airwallex/approvals.ts)). Live in the sandbox, 10 and 12 Nov: Airwallex held a payout signed by a labelled test passkey `IN_APPROVAL` until the owner approved it in Airwallex's web app; then `PAID`, settlement simulated ([run](docs/runs/2026-11-12-airwallex-two-locks-paid.md)).

## How it works in 5 files

Purser gives each AI agent of a small company its own Airwallex card and its own Metal on-chain mandate. Metal holds
each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; the CFO approves anything
beyond them, with Face ID on the exact terms.

**Claude agents propose and pay; Purser's code, Airwallex and Metal each hold a limit; above them, the CFO signs the exact terms with Face ID.**

![Agent, then policy. Within the limits the agent pays under its own mandate or card limit; beyond them the CFO's passkey signs the SHA-256 of the exact terms, the executor re-checks the hash, then Airwallex or Metal. Every step goes into the hash-chained audit log.](docs/how-it-works.svg)

Within the limits an agent pays on its own; beyond them, nothing runs without the CFO's passkey.

<!-- worst-case -->
**Worst case, set by policy: EUR 28,200 on cards and task cards + USD 20 on chain a month.**

Task cards without Face ID: up to EUR 900 a day. Everything above waits for the CFO.

<details><summary>How this is computed</summary>

- Sourcing agent: EUR 100 on its card + USD 10 on chain (test USD) a month.
- Support agent: EUR 150 on its card + USD 4 on chain (test USD) a month.
- Treasury agent: EUR 50 on its card + EUR 27,900 in task cards + USD 6 on chain (test USD) a month.
- A day: EUR 1,200 + USD 20: a card or a mandate can go in one day, task cards 3 a day.
- Counted: each card's monthly limit (card.*.monthly, EUR) and each Metal mandate's budget (test USD, *USDZ; it lasts 40 days and can all go at once). Task cards, which the Treasury agent may issue without Face ID: up to EUR 300 each (approval.task_card_eur), 3 a day (EUR 900), 31 days a month (EUR 27,900), counted above.
- ≈ EUR 28,217.70 in all at the main run's rate of 3 Nov 2026 (1.129917 USD per EUR, docs/demo/main-run.json); test USD is never added to EUR otherwise.
- With a shared card or an API key, the limit is the card's or the account's.
- Computed from the policy by [`exposureOf`](src/policy/exposure.ts); `test/exposure.test.ts` checks this block against it.

</details>
<!-- /worst-case -->

1. **The policy.** [`reserveSpend`](src/policy/holds.ts#L63) runs before an agent's payment is signed or charged: its identity, the CFO's stops and caps, the mandate's cap and budget, the shared 20.00 total and velocity. A refusal means nothing is signed.
2. **The terms hash and the passkey.** [`termsHash`](src/lib/terms.ts#L41) is the SHA-256 of a proposal's exact terms as canonical JSON; [`verifyApprovalSignature`](src/passkey/webauthn.ts#L53) accepts a passkey's signature only if it signed that hash, with user verification (Face ID) on.
3. **The executors' hash check.** Every executor in [src/executors/](src/executors/) starts with [`beginExecution`](src/policy/approvals.ts#L246), which re-hashes the stored terms and runs nothing unless they match the approved hash, before the expiry.
4. **The Metal mandate layer.** [`payUnderMandate`](src/metal/pay.ts#L34) signs an x402 payment with the agent's own mandate key only after the caller's guard passes it (Sourcing's is `reserveSpend`); on chain, Metal refuses what is over the mandate.
5. **The audit chain.** [`audit`](src/audit/log.ts#L37) appends each event with `row_hash = SHA-256(prev_hash ‖ JCS(row))`; the database refuses UPDATE and DELETE, and `npm run verify` re-checks the chain.

### Verify it yourself in 3 commands

Needs Node.js 22.13 or later and git. `npm ci` downloads packages from npm; after that, no network and no keys.

```sh
npm ci
npm test
npm run judge -- --check
```

- `npm ci` (under a minute): installs the exact versions in the lockfile; every dependency is pinned.
- `npm test` (4 to 7 min): **6034 tests in 527 files, all passing**, on stand-ins for Airwallex, Metal and Claude, every check above included. Four more tests are skipped here: they run only on local D1 (`npm run test:d1`).
- `npm run judge -- --check` (about 3 s): builds every page in `CHECK_PATHS` (src/cli/judge.ts) from the main run's committed record, offline, and fetches each once.
- `npm run verify-approval` (under 1 s): checks the receipt of the owner's real passkey approval of 7 November, published on 12 November, offline with Node's own crypto: the passkey signed exactly those terms; change one cent and it says NOT VALID. `npm run verify-receipt -- receipt.json` does the same for the receipt you get after signing on [/try/sign](https://kit11.max-31b.workers.dev/try/sign). Getting the receipt needs the live site and your own passkey.

CI runs the same on every push.

## Built after the kit (test environment, not live)

On [/try/sign](https://kit11.max-31b.workers.dev/try/sign) the Treasury agent asks to pay one invoice above its limit and the CFO signs the exact terms with Face ID. The payables inbox below is built to do that for every supplier invoice of a small company. Its code is in this repository, not on this site: the inbox in [src/ap](src/ap), the books in [src/ledger](src/ledger), the documents in [src/vault](src/vault), the accounting links in [src/erp](src/erp), payments in other currencies in [src/payouts](src/payouts), and Purser Cloud, the console and its API, in [cloud/](cloud). It is built and tested against stand-ins and on Cloudflare's local database; on 10 November it ran once end to end in the Airwallex sandbox for three test companies (1 payout PAID, 3 refused by Airwallex: [run record](docs/runs/2026-11-10-platform-e2e.md)). Purser Cloud runs publicly as a test preview at kit11.max-31b.workers.dev/try: test companies, test money on a simulated bank. Its console's hosted preview exists but is private (behind an access key); no customer uses it, and it is not ready for real money. Its connected-account payout did run in the Airwallex sandbox on 10 November: EUR 5.00 paid on a test company's behalf (`a9460dba-f31b-4111-be58-6d9a9e71adb1`, settlement simulated), Airwallex accepting Purser's EUR 0.05 fee. The Kit 11 build keeps Metal and x402 for the agents' own payments; the inbox pays suppliers through Airwallex payouts. Details and screenshots: [docs/after-the-kit.md](docs/after-the-kit.md).

- **Payables inbox:** supplier invoices arrive as PDF or e-mail, are read, checked (duplicates, changed bank details, totals) and booked.
- **Scanned invoices:** two independent readings must agree on IBAN, total, currency and invoice number; otherwise a person decides.
- **One Face ID for a batch:** the CFO signs a list of exact terms once; each payment still runs and is checked on its own.
- **Cloud console** with passkey sign-in, a register of every money movement, Dutch screens.
- **Six red-team rounds:** every confirmed finding fixed with a test, except one point from round 6 that is still open ([docs/go-live.md](docs/go-live.md)).
- **Airwallex connected accounts:** each customer would open its own Airwallex account through Purser; every payout and card call is checked against that company's signed account binding. Live in the sandbox since 10 November: 3 connected accounts ACTIVE; payouts with Purser's fee from the first (above, and an end-to-end run from invoice to T:0); the two newer accounts' payouts refused by Airwallex, which wants the paying company's registration number ([run record](docs/runs/2026-11-10-platform-e2e.md)).

## Who does what

<img src="docs/assets/logos/built-with.png" alt="Built with Airwallex, Metal, Claude, Visa and Cloudflare" height="40"> official files, unmodified, no endorsement implied ([sources](docs/assets/logos/SOURCES.md))

- **Built by Max Geurtsen:** Purser itself: the CFO's policy and limits, the approval flow (Face ID on the exact terms,
  four eyes), the agents' tools and prompts, the relay and the site, the hash-chained audit log, the books, the tests.
- **Airwallex (sandbox):** the agents' cards and card limits, FX, the SWIFT euro payout, webhooks.
- **Metal (testnet):** the on-chain mandates and the agents' payments; it refuses what is over a mandate.
- **Claude by Anthropic:** the three agents' decisions: Sourcing on Claude Haiku, Support on Claude Sonnet, Treasury
  on Claude Opus.
- **Face ID and passkeys (WebAuthn on the CFO's phone):** the CFO's passkey, unlocked with Face ID, signs the hash of
  the exact terms.
- **Visa Intelligent Commerce via Airwallex's Airi (sandbox, test card):** an agent pays with a single-use card credential.
- **Cloudflare:** Workers and Durable Objects run the relay, the site and Purser Cloud's engine (one object per company).

## Releases

[`v1.0-submission`](https://github.com/agamemnon-coder/x402-business-agents/releases/tag/v1.0-submission) (8 November) is the hackathon submission; what came after it is in [CHANGELOG.md](CHANGELOG.md), generated from git, and the next release's notes are [docs/releases/v1.1-final.md](docs/releases/v1.1-final.md).

## Links

- **Read:** [docs/in-depth.md](docs/in-depth.md) (each judging criterion, the live runs with every id, what is real and what is mock) · [docs/README.md](docs/README.md) (every doc, by reader) · [docs/diagrams.md](docs/diagrams.md) · [docs/claims.md](docs/claims.md) (every claim and its source) · [docs/runs/](docs/runs/) (every run log, dated) · [docs/controls.md](docs/controls.md) · [docs/security.md](docs/security.md)
- **Partners:** [docs/metal-award.md](docs/metal-award.md) and [docs/airwallex.md](docs/airwallex.md) (what Purser uses from each) · [The Visa TAP note](docs/submission/long-description.md#visa): built and verified against Visa's public reference verifier; not eligible Visa tooling for this hackathon (Visa, 5 Nov)
- **Run and build:** [docs/run-it.md](docs/run-it.md) (live, with sandbox keys and a Metal RPC) · [docs/payables.md](docs/payables.md) (the invoice inbox, built after the submission; code in [src/ap](src/ap)) · [skills/purser-spend/SKILL.md](skills/purser-spend/SKILL.md) (for outside agents) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md)
- **Site:** [Hands-on demo](https://kit11.max-31b.workers.dev/try) (a test company of your own, test money) · [The replay of the main run of 3 November](https://kit11.max-31b.workers.dev/replay) (under Proof, not in the menu) · [/security](https://kit11.max-31b.workers.dev/security)
- **Submission:** [docs/submission/README.md](docs/submission/README.md) (the submission text, with the short Description) · [docs/submission/long-description.md](docs/submission/long-description.md) (the long form text it replaced, in full)

All money here is test money: the Airwallex sandbox and Metal testnet. Licence: MIT.
