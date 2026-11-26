<div align="center">

<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Proof bundles

**The file /try hands over on Paid and on the one-cent refusal, so anyone can check the payment without trusting our server.**

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain)&nbsp;[![Format: purser.proof-bundle/v1](https://img.shields.io/badge/format-purser.proof--bundle%2Fv1-8b5cf6?style=flat-square&labelColor=1f2937)](../../src/proof/bundle.ts)&nbsp;[![Checks: 7, the same in the browser and offline](https://img.shields.io/badge/checks-7%2C_browser_and_offline-8b5cf6?style=flat-square&labelColor=1f2937)](#check-one)&nbsp;[![Tamper matrix: from badges/tamper-matrix.json](https://img.shields.io/badge/tamper_matrix-894%2F894_refused-16a34a?style=flat-square&labelColor=1f2937)](../evidence/tamper-matrix.md)&nbsp;[![Samples: one paid, one refused](https://img.shields.io/badge/samples-1_paid_%C2%B7_1_refused-10b981?style=flat-square&labelColor=1f2937)](#the-two-samples-here)&nbsp;[![Test money only](https://img.shields.io/badge/money-test_only-f59e0b?style=flat-square&labelColor=1f2937)](../../README.md#built-with)

[What it holds](#what-it-holds) · [Check one](#check-one) · [The two samples](#the-two-samples-here) · [/verify](https://kit11.max-31b.workers.dev/verify) · [Tamper matrix](../evidence/tamper-matrix.md)

</div>

| At a glance | Record |
|---|---|
| Format `purser.proof-bundle/v1`: the signed terms, the passkey's signature, the decision, the ledger entries | [src/proof/bundle.ts](../../src/proof/bundle.ts) |
| **7 checks**, the same code in the browser and offline | [/verify](https://kit11.max-31b.workers.dev/verify) · `npm run verify-bundle` |
| **2 samples** from the live /try, 15 Nov 2026: EUR 1,850.00 paid; EUR 1,850.01 refused | [try-paid.json](try-paid.json) · [try-refused.json](try-refused.json) |
| Every signed field of both samples (and of the other signed files committed here) changed by one step: every changed copy refused, 0 accepted | [tamper-matrix.md](../evidence/tamper-matrix.md) · `npm run tamper-matrix` |

<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/payment-life-wide-dark.svg"><img src="../assets/payment-life-wide-light.svg" alt="One payment's life: invoice, read by Claude, checked by Purser's code, the exact terms hashed, signed by the CFO's Face ID, checked again by the rail's own control, paid, booked. Sandbox and testnet runs, test money." width="100%"></picture>

## What it holds

On /try it is the "Download the proof (JSON)" button; the format is `purser.proof-bundle/v1`.

- the signed terms, their canonical JSON (RFC 8785) and its SHA-256;
- the WebAuthn assertion (authenticatorData, clientDataJSON, signature) and the passkey's public key (COSE), with the rpId;
- the engine's decision (both layers' words);
- the payment's ledger entries and the ledger's head;
- for a refusal, the terms that were asked, and their hash.

There are no secrets and no personal data: a test company and test money only.

## Check one

| Where | How |
|---|---|
| In a browser | Drop it on [/verify](https://kit11.max-31b.workers.dev/verify): no server call; WebCrypto on your device |
| Offline | `npm run verify-bundle -- docs/proof/try-paid.json`: exit 0 when every check passes, 1 when one fails |

Both run the same code. The checks:

1. The SHA-256 of the canonical terms equals the file's hash.
2. `clientDataJSON.challenge` equals that hash.
3. The authenticator data's first 32 bytes are SHA-256 of the rpId, and its flags say "user present" and "user verified".
4. The ES256 or RS256 signature verifies over `authenticatorData ‖ SHA-256(clientDataJSON)` with the public key.
5. The decision names the signed hash.
6. A refusal's asked terms hash differently, so the signature cannot cover them.
7. Every ledger entry balances and hashes as posted.

```mermaid
flowchart LR
  F["purser-proof.json<br/>from /try"] --> C1["1 · terms hash"]
  C1 --> C2["2 · challenge = hash"]
  C2 --> C3["3 · rpId, user present<br/>and verified"]
  C3 --> C4["4 · passkey signature"]
  C4 --> C5["5 · decision names<br/>the signed hash"]
  C5 --> C6["6 · a refusal's asked terms<br/>hash differently"]
  C6 --> C7["7 · ledger entries<br/>balance and hash"]
  C7 --> OK["VALID<br/>exit 0"]
  C1 & C2 & C3 & C4 & C5 & C6 & C7 -.->|any check fails| NO["NOT VALID<br/>exit 1"]
  classDef purser fill:#8b5cf6,stroke:#6d28d9,color:#ffffff
  classDef ok fill:#10b981,stroke:#047857,color:#111827
  classDef stop fill:#f43f5e,stroke:#be123c,color:#111827
  class C1,C2,C3,C4,C5,C6,C7 purser
  class OK ok
  class NO stop
```

## The two samples here

`try-paid.json` and `try-refused.json` come from the deployed site, on 15 November 2026:

- paid at 04:26:10 UTC and refused at 04:26:16 UTC (each file's `made_at`);
- one run of the live /try, https://purser-try.max-31b.workers.dev/try, so the rpId is `purser-try.max-31b.workers.dev`;
- a fresh test company, on the simulated bank (test money; ids such as `tr_5`), signed by Chromium's virtual passkey (user verification on);
- the clean sample invoice, EUR 1,850.00 to Bergtex Textil GmbH (a test supplier), paid; then the same signature sent with EUR 1,850.01, refused.

```mermaid
flowchart LR
  SIG["The CFO's passkey signature<br/>over the SHA-256 of the terms<br/>EUR 1,850.00 to Bergtex Textil GmbH"]
  SIG --> P["Sent with EUR 1,850.00<br/>the terms it signed"] --> PAID["Paid<br/>try-paid.json"]
  SIG --> R["Sent with EUR 1,850.01<br/>one cent changed"] --> REF["Refused, nothing paid<br/>try-refused.json"]
  classDef purser fill:#8b5cf6,stroke:#6d28d9,color:#ffffff
  classDef ok fill:#10b981,stroke:#047857,color:#111827
  classDef stop fill:#f43f5e,stroke:#be123c,color:#111827
  class SIG purser
  class P,PAID ok
  class R,REF stop
```

Both pass every line on the live [/verify](https://kit11.max-31b.workers.dev/verify) and with `npm run verify-bundle`.
`npx tsx test/browser/proof.check.ts --live --write` makes them again; without `--live` it runs the same walk on this
machine, on `localhost`.
