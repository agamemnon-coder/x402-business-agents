<div align="center">

<a href="README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/purser-mark-dark.svg"><img src="docs/assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Purser for judges, on one page

**The 2-minute path, what is real and what is sandbox, how to verify it yourself, and the honest limits.**

[![Airwallex: sandbox](https://img.shields.io/badge/Airwallex-sandbox-ff6b35?style=flat-square&labelColor=1f2937)](docs/airwallex.md)&nbsp;[![Alta (formerly Metal): testnet](https://img.shields.io/badge/Alta_%28formerly_Metal%29-testnet-0d9488?style=flat-square&labelColor=1f2937)](docs/metal-award.md)&nbsp;[![Visa via Airi: sandbox](https://img.shields.io/badge/Visa_via_Airi-sandbox-1a1f71?style=flat-square&labelColor=1f2937)](docs/visa-award.md)&nbsp;[![T:0: sandbox ledger](https://img.shields.io/badge/T%3A0-sandbox_ledger-475569?style=flat-square&labelColor=1f2937)](docs/t0.md)&nbsp;[![Test money only](https://img.shields.io/badge/money-test_only-ca8a04?style=flat-square&labelColor=1f2937)](#what-is-real-and-what-is-sandbox)

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain)&nbsp;[![Tests: from docs/assets/test-summary.json](https://img.shields.io/badge/tests%2C%20last%20full%20run-10239%20passing-16a34a?style=flat-square&labelColor=1f2937)](docs/assets/test-summary.json)&nbsp;[![Verify: offline, no keys](https://img.shields.io/badge/verify-offline%2C_no_keys-16a34a?style=flat-square&labelColor=1f2937)](#how-to-verify-it-yourself)&nbsp;[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb?style=flat-square&labelColor=1f2937)](LICENSE)

**1 · [Take the tour on /judge](https://kit11.max-31b.workers.dev/judge)** &nbsp;·&nbsp; **2 · [Try it on /try](https://kit11.max-31b.workers.dev/try)** (test money) &nbsp;·&nbsp; **3 · [See the proof on /proof](https://kit11.max-31b.workers.dev/proof)**

[The 2-minute path](#the-2-minute-path) · [Real or sandbox](#what-is-real-and-what-is-sandbox) · [Verify it](#how-to-verify-it-yourself) · [The honest limits](#the-honest-limits)

</div>

Purser is the control layer between a company's AI agents and its money: agents pay supplier invoices within limits
the CFO sets in code, and above a limit nothing is paid until the CFO signs the exact terms with a passkey. **Test
money only** throughout.

## The 2-minute path

```mermaid
flowchart LR
  J["1 · /judge<br/>the tour on Home,<br/>seven stops"] --> T["2 · /try<br/>your own test company"]
  T --> A["The agent pays<br/>a small invoice alone,<br/>within its limit"]
  T --> S["Above the limit:<br/>you sign the exact terms<br/>with your passkey"]
  S --> C["Change one cent:<br/>refused, nothing paid"]
  A & C --> P["3 · /proof<br/>every figure<br/>with its record"]
```

1. **[/judge](https://kit11.max-31b.workers.dev/judge)** opens the judge tour on Home: seven stops (the film, /try,
   Purser Cloud as a guest, Alta, Visa, T:0 and the proof), each with one sentence on what to look at.
2. **[/try](https://kit11.max-31b.workers.dev/try)**: your own test company. Claude reads a sample invoice; a small one
   the agent pays alone, within its limit; above the limit you sign the exact terms with your own passkey (Face ID on
   an iPhone); then change one cent of what you signed and see it refused, with nothing paid.
3. **[/proof](https://kit11.max-31b.workers.dev/proof)**: every figure with its record, organised by the questions a
   judge asks; each tile opens the run record it is read from.

## What is real, and what is sandbox

| 🟢 Live calls (test money) | 🟡 Simulated |
|---|---|
| The Airwallex sandbox (transfers, FX quotes, cards; a sandbox PAID is the sandbox's own simulation) | The customer and the supplier |
| Alta (formerly Metal) testnet: mandates and payments on chain | The merchants' charges and the settlement |
| Visa via Airwallex's Airi: Airi's single-use credential on Airi's test card (sandbox), one recorded run | The second approver, where a run shows one |
| The T:0 shared sandbox ledger, read back | On /try: the bank each payment is made on, with payouts also sent to the Airwallex sandbox |
| Claude (the agents and the invoice reader) | |

Every run, live or simulated, is listed with its record in [docs/runs/README.md](docs/runs/README.md) and on
[/runs](https://kit11.max-31b.workers.dev/runs).

## How to verify it yourself

Offline, no keys, under 2 minutes (Node.js 22.13+ and git):

```sh
npm ci
npm run judge -- --check     # every page built from the main run's record, offline
npm run verify-approval      # the owner's real passkey approval of 7 November, checked with Node's crypto
```

Change one cent in a copy of that receipt and `npm run verify-receipt -- tampered.json` says NOT VALID. Any proof file
downloaded from /try checks on [/verify](https://kit11.max-31b.workers.dev/verify) and with `npm run verify-bundle`.

## The honest limits

> [!IMPORTANT]
> **Test money only.** No production money, no outside security review yet, no customers: the full list is below.

**What is not finished:**

- No independent security review yet: the OWASP ASVS Level 2 assessment is a self-assessment, and no third party has tested its security. ([docs/security/asvs-l2.md](docs/security/asvs-l2.md))
- No production money: the Airwallex sandbox, Alta testnet and Airi's test card only; test money throughout.
- No second human approver yet: one CFO passkey signs; where a run shows a second approver, it is simulated (a labelled test passkey).
- No customers: no pilots and no revenue yet.
- Before real money: every go-live requirement, with where it stands, is in [docs/go-live.md](docs/go-live.md).

Also: only routes connected to Purser are protected (a wallet or card an agent reaches outside Purser is not); the red
team's figures are our own scripted attacks, not an independent penetration test. The questions judges ask, answered
briefly: [/security](https://kit11.max-31b.workers.dev/security#judge-questions) and the README's "Questions judges
ask".
