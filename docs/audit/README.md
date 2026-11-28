<div align="center">

<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# The recorded run's audit log

**The hash-chained audit log of the recorded run of 30 October, as stored, with the one command that checks it offline.**

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain)&nbsp;[![Audit log: 194 rows, chain intact](https://img.shields.io/badge/audit_log-194_rows_%C2%B7_chain_intact-10b981?style=flat-square&labelColor=1f2937)](friday-1-audit.jsonl)&nbsp;[![Head: ee0732445a71…3618](https://img.shields.io/badge/head-ee0732445a71%E2%80%A63618-5996f9?style=flat-square&labelColor=1f2937)](#check-it-offline-with-no-keys)&nbsp;[![Checked offline, with no keys](https://img.shields.io/badge/check-offline_%C2%B7_no_keys-0ea5e9?style=flat-square&labelColor=1f2937)](#check-it-offline-with-no-keys)&nbsp;[![No keys, card numbers or secrets; test IBANs only](https://img.shields.io/badge/secrets-none_%C2%B7_test_IBANs_only-10b981?style=flat-square&labelColor=1f2937)](#what-it-contains)&nbsp;[![Test money only](https://img.shields.io/badge/money-test_only-f59e0b?style=flat-square&labelColor=1f2937)](../../README.md#built-with)

[What it is](#what-it-is) · [Check it offline](#check-it-offline-with-no-keys) · [What it contains](#what-it-contains) · [The log](friday-1-audit.jsonl)

</div>

| At a glance | Record |
|---|---|
| **194 rows**, one per line; chain intact | [friday-1-audit.jsonl](friday-1-audit.jsonl) |
| Head `ee0732445a71…3618`, the one the pages show | `test/recorded-audit.test.ts` in CI |
| No keys, card numbers or secrets; test IBANs only | this page, below |

## What it is

`friday-1-audit.jsonl` is the audit log of the recorded run (Friday run 1, 30 October 2026, Northwind Outdoor), as
stored: 194 rows, one per line. Rows 1 to 175 are what the run's `npm run verify` checked (head `5f8bb068…`); rows
176 to 191 are the fraud, planted-instruction and reconciliation steps that followed; rows 192 to 194 are the
Dispute desk case, decided after the run on the same ledger.

Each row's hash is SHA-256 over the previous row's hash and the row itself (`src/audit/log.ts`), so changing,
removing or reordering any row breaks every hash after it.

```mermaid
flowchart LR
  R1["Rows 1 to 175<br/>what the run's npm run verify checked<br/>head 5f8bb068…"] --> R2["Rows 176 to 191<br/>fraud, planted instructions,<br/>reconciliation"]
  R2 --> R3["Rows 192 to 194<br/>the Dispute desk case"]
  R3 --> HEAD["Head ee0732445a71…3618<br/>the one the pages show"]
  E["Change, remove or reorder<br/>any row"] -.->|every hash after it breaks| HEAD
  classDef purser fill:#5996f9,stroke:#246bdd,color:#ffffff
  classDef ok fill:#10b981,stroke:#047857,color:#111827
  classDef stop fill:#f43f5e,stroke:#be123c,color:#111827
  class R1,R2,R3 purser
  class HEAD ok
  class E stop
```

## Check it offline, with no keys

```bash
npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl --anchor 194:ee0732445a717f7386b4c6ccd94c0f5459b515e1d3e0869833c10d328fd83618
```

The head, `ee0732445a71…3618`, is the one the pages show ("194 rows, chain intact"); `test/recorded-audit.test.ts`
checks that in CI.

## What it contains

Every decision, refusal, payment, approval and Claude reading of the run, with Airwallex ids and
Metal transaction hashes. What it does not contain: keys, card numbers or secrets. The IBANs in it are the test
IBANs of the run's invoices, including the two fake ones.

`npm run verify` goes further (credentials, pulls and receipts against the chain, passkey signatures, Airwallex), but
it needs the full ledger and a Metal RPC endpoint.
