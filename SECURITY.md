<div align="center">

<a href="README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/purser-mark-dark.svg"><img src="docs/assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Security

**How to report a vulnerability in Purser privately, how fast you hear back, and what is in scope.**

[![Report privately: GitHub advisory](https://img.shields.io/badge/report_privately-GitHub_advisory-be123c?style=flat-square&labelColor=1f2937)](https://github.com/agamemnon-coder/x402-business-agents/security/advisories/new)&nbsp;[![Acknowledged: within 3 working days](https://img.shields.io/badge/acknowledged-within_3_working_days-059669?style=flat-square&labelColor=1f2937)](#disclosure-timeline)&nbsp;[![Disclosure: within 90 days](https://img.shields.io/badge/disclosure-within_90_days-0284c7?style=flat-square&labelColor=1f2937)](#disclosure-timeline)&nbsp;[![Supported: main and the latest release](https://img.shields.io/badge/supported-main_%C2%B7_latest_release-7c3aed?style=flat-square&labelColor=1f2937)](#supported-versions)&nbsp;[![Test money only](https://img.shields.io/badge/money-test_only-d97706?style=flat-square&labelColor=1f2937)](#scope)

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain)&nbsp;[![CodeQL](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/github-code-scanning/codeql)&nbsp;[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/agamemnon-coder/x402-business-agents/badge)](https://scorecard.dev/viewer/?uri=github.com/agamemnon-coder/x402-business-agents)&nbsp;[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16923/badge)](https://www.bestpractices.dev/projects/16923)&nbsp;[![Secrets: gitleaks on every push](https://img.shields.io/badge/secrets-gitleaks_on_every_push-7c3aed?style=flat-square&labelColor=1f2937)](#no-secrets-in-this-repository)

[Report](#reporting-a-vulnerability) · [Timeline](#disclosure-timeline) · [Handling](#how-a-report-is-handled) · [Supported versions](#supported-versions) · [Scope](#scope) · [Controls](#security-controls-at-a-glance) · [Trust boundaries](#trust-boundaries-and-the-money-path) · [Credit](#credit) · [Threat model](docs/security.md)

</div>

This is a hackathon project that only uses test money (Alta (formerly Metal) testnet, the Airwallex sandbox). Please do not test
against the hosted relay with real credentials.

> [!CAUTION]
> **Never report a vulnerability in a public issue, pull request or discussion.** Use GitHub's private form below.

## Reporting a vulnerability

Please report privately, never in a public issue, pull request or discussion.

| Channel | How |
|---|---|
| **GitHub private vulnerability reporting** (enabled on this repository; the preferred way) | https://github.com/agamemnon-coder/x402-business-agents/security/advisories/new (on the repository: Security → Advisories → Report a vulnerability). Only you and the maintainer see the report, and the fix is prepared in the advisory's private fork. |
| If you cannot use GitHub's form | Contact the maintainer through their GitHub profile, https://github.com/agamemnon-coder, and ask for a private channel; do not put the details in a public place. |
| Machine-readable | The same contact is in `/.well-known/security.txt` on the relay (https://kit11.max-31b.workers.dev/.well-known/security.txt). Published advisories: https://github.com/agamemnon-coder/x402-business-agents/security/advisories |

Please include what is affected (the route, file or commit), how to reproduce it, and what an attacker gains. Test money
only: do not use real credentials, and do not test against partners' systems (see Scope).

### Disclosure timeline

| When | What happens |
|---|---|
| Within 3 working days of the report | We acknowledge it and say who is looking at it. |
| Within 10 working days | We tell you whether it is in scope and how severe we think it is (CVSS where it helps). |
| As soon as a fix is ready | A PATCH release, and the hosted test preview redeployed if it is affected. |
| Within 90 days of the report at the latest | Coordinated public disclosure: the GitHub security advisory is published (with a CVE requested through GitHub when the issue affects users), sooner once the fix is out, at a date agreed with you. |

If we cannot fix it within 90 days, we agree a later date with you and say why in the advisory. You are free to disclose
after 90 days if we have stopped answering.

## How a report is handled

```mermaid
flowchart LR
  R["You report privately<br/>GitHub private<br/>vulnerability reporting"]:::purser --> A1["1 · Acknowledge<br/>within 3 working days"]:::cash
  A1 --> A2["2 · Assess<br/>within 10 working days:<br/>in scope? how severe?"]:::cash
  A2 --> A3["3 · Fix in private<br/>in the advisory's private fork,<br/>a regression test that<br/>fails before the fix"]:::cash
  A3 --> A4["4 · Release<br/>a PATCH release; the test<br/>preview redeployed if affected"]:::paid
  A4 --> A5["5 · Disclose<br/>the advisory published,<br/>normally within 90 days"]:::cash
  A5 --> C["Credit<br/>in the advisory and<br/>the release notes"]:::purser
  classDef purser fill:#6d28d9,stroke:#a78bfa,color:#fff
  classDef cash fill:#0369a1,stroke:#38bdf8,color:#fff
  classDef paid fill:#047857,stroke:#34d399,color:#fff
```

1. **Acknowledge** within 3 working days, in the advisory (or by e-mail), with who is looking at it.
2. **Assess**: reproduce it, decide whether it is in scope, and rate it (CVSS where it helps), together with the
   reporter. The reporter hears the outcome either way.
3. **Fix in private**: in the advisory's temporary private fork, with a regression test that fails before the fix
   (the test policy in [CONTRIBUTING.md](CONTRIBUTING.md#tests-come-with-the-change)). A fix that touches the money
   rules is checked against the assurance case ([docs/assurance.md](docs/assurance.md)).
4. **Release**: merge, deploy the hosted test preview if it is affected, and cut a PATCH release
   ([docs/releasing.md](docs/releasing.md)) whose notes name the advisory.
5. **Disclose**: publish the GitHub security advisory (with a CVE requested through GitHub when the issue affects
   users), normally within 90 days of the report or sooner once the fix is out, at a date agreed with the reporter.

## Supported versions

| Version | Gets security fixes |
|---|---|
| `main` | ✅ Yes |
| The latest release ([docs/releases/](docs/releases/)) | ✅ Yes ([docs/releasing.md](docs/releasing.md#supported-versions-and-upgrading)) |
| Older releases | ❌ No: upgrade to the latest release |
| The submission tags `v1.0-submission` and `v1.1-submission` | ❌ No: the hackathon submissions |

Supported: `main`. There are no other release branches. The submission tags are lightweight tags on GitHub, each naming a commit: `v1.0-submission` names `b704672c0` (8 November) and `v1.1-submission` names `a1807f2ef` (15 November, the merge of #400). An earlier annotated `v1.1-submission` tag made on the maintainer's machine named `c431a4689` (also 15 November, #358); it is not the tag on GitHub. Release tags: see [docs/releasing.md](docs/releasing.md) (only `v1.4.0` is signed).

## Scope

| ✅ In scope | ❌ Out of scope |
|---|---|
| The relay Worker (`worker/`): the site, `/try/sign`, and the relay's Durable Object that carries proposals and approvals | The partners' own systems (the Airwallex sandbox, Alta testnet, Airi, T:0, Moneybird): report those to them |
| Purser Cloud (`cloud/`): the console, its API, its engine, and the MCP server at `/mcp` (read and propose only: no tool can approve or pay) | Denial of service against the hosted test preview |
| The passkey approval flow, the policy and money executors (`src/policy`, `src/executors`), and the hash-chained audit log with its on-chain anchor (`src/audit`, `src/anchor`) | Anything that needs a real person's device or account |
| The TAP merchant layer (`src/visa`) | |

The threat model is [docs/security.md](docs/security.md); the controls are [docs/controls.md](docs/controls.md).

## Security controls at a glance

What stands between an agent and the money, and what keeps the code honest. Each badge opens the control's own
document or code; the colours are the console's: violet for Purser and the CFO's approval, green for what is checked
in CI, amber for test money.

| Control | What it does | Where |
|---|---|---|
| [![Approval: passkey-signed terms](https://img.shields.io/badge/approval-passkey--signed_terms-7c3aed?style=flat-square&labelColor=1f2937)](src/lib/terms.ts) | Above a limit, the CFO's passkey (Face ID) signs the SHA-256 of the exact terms; one cent changed and it no longer verifies. | [src/lib/terms.ts](src/lib/terms.ts), [src/policy/approvals.ts](src/policy/approvals.ts) |
| [![Execution: re-checks the signed hash](https://img.shields.io/badge/execution-re--checks_the_signed_hash-7c3aed?style=flat-square&labelColor=1f2937)](src/policy/hashFirst.ts) | Before anything leaves for a rail, the executor checks that the stored terms still hash to what was signed. | [src/policy/hashFirst.ts](src/policy/hashFirst.ts), [src/executors/](src/executors/) |
| [![Agent identity: Ed25519-signed requests](https://img.shields.io/badge/agent_identity-Ed25519_signed_requests-7c3aed?style=flat-square&labelColor=1f2937)](docs/security/agent-identity.md) | Each agent that can move money has its own key; a money-relevant request carries a signature over that exact request, and a replay is refused. | [docs/security/agent-identity.md](docs/security/agent-identity.md) |
| [![Audit: hash-chained, anchored](https://img.shields.io/badge/audit-hash--chained%2C_anchored-7c3aed?style=flat-square&labelColor=1f2937)](src/audit/log.ts) | Every event goes into a hash-chained log whose head is anchored on Alta testnet. | [src/audit/log.ts](src/audit/log.ts), [src/anchor/](src/anchor/) |
| [![Releases: SBOM and SLSA L3 provenance](https://img.shields.io/badge/releases-SBOM_%C2%B7_SLSA_L3_provenance-7c3aed?style=flat-square&labelColor=1f2937)](docs/security/README.md#verify-a-release) | A release carries a CycloneDX bill of materials and Sigstore-signed attestations; releases after `v1.2.0` also carry SLSA Build Level 3 provenance. | [docs/security/README.md](docs/security/README.md#verify-a-release), [release.yml](.github/workflows/release.yml) |
| [![Static analysis: CodeQL](https://img.shields.io/badge/static_analysis-CodeQL-059669?style=flat-square&labelColor=1f2937)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/github-code-scanning/codeql) | GitHub's code scanning on the repository. | [Code scanning](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/github-code-scanning/codeql) |
| [![Secrets: gitleaks](https://img.shields.io/badge/secrets-gitleaks-059669?style=flat-square&labelColor=1f2937)](#no-secrets-in-this-repository) | gitleaks on every push and on the whole history of the commit under check. | [ci.yml](.github/workflows/ci.yml), [below](#no-secrets-in-this-repository) |
| [![OpenSSF: Scorecard and Best Practices](https://img.shields.io/badge/OpenSSF-Scorecard_%C2%B7_Best_Practices-059669?style=flat-square&labelColor=1f2937)](https://www.bestpractices.dev/projects/16923) | The OpenSSF Scorecard workflow, and the project's OpenSSF Best Practices entry. | [scorecard.yml](.github/workflows/scorecard.yml), [bestpractices.dev](https://www.bestpractices.dev/projects/16923) |
| [![Money: test only](https://img.shields.io/badge/money-test_only-d97706?style=flat-square&labelColor=1f2937)](#scope) | The Airwallex sandbox, Alta testnet and Visa via Airwallex's Airi (sandbox): no real money moves. | [Scope](#scope) |

## Trust boundaries and the money path

What a report is measured against: an agent's payment crosses these boundaries, and Purser's checks, the CFO's
passkey, the executor's re-check and the rails' own limits can each stop it. A summary of
the full diagram in [docs/security.md](docs/security.md#trust-boundaries), where each arrow says what crosses and what
checks it.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/anim/money-path-security-dark.svg"><img src="docs/assets/anim/money-path-security.svg" alt="One payment on test money: the agent proposes, Purser's checks, the CFO's passkey and the executor's re-check each light green, the rail pays and the audit chain records it; then a payment whose terms changed by one cent after signing turns red at the executor and is refused, nothing paid" width="100%"></picture>

```mermaid
flowchart LR
  subgraph U["Untrusted"]
    IN["Invoices, emails, x402 servers,<br/>visitors, outside agents"]:::refused
    CL["Claude<br/>no key, fixed tools"]:::agent
    W["Relay Worker<br/>queues proposals and approvals"]:::proof
  end
  subgraph T["Trusted: the runner"]
    CK["Purser's checks in code<br/>limits, payee, duplicates,<br/>the CFO's emergency stop"]:::purser
    EX["Executor<br/>re-checks the approved terms' hash<br/>and the passkey signature"]:::purser
    LOG["Hash-chained audit log<br/>anchored on Alta testnet"]:::proof
  end
  subgraph P["The CFO's phone"]
    PK["Passkey, Face ID<br/>signs the SHA-256<br/>of the exact terms"]:::purser
  end
  subgraph Q["The rails, each with its own limits"]
    AW["Airwallex sandbox"]:::testmoney
    AL["Alta testnet"]:::testmoney
    VI["Visa via Airwallex's Airi<br/>sandbox"]:::testmoney
  end
  IN -- "data, never instructions" --> CK
  CL -- "typed answers, checked by code" --> CK
  CK -- "within the limits" --> EX
  CK -- "above a limit: the exact terms" --> W
  W --> PK
  PK -- "signature over the terms' hash" --> W
  W -- "verified on the runner" --> EX
  EX -- "one cent changed" --> X["Refused.<br/>Nothing paid."]:::refused
  EX -- "terms match" --> AW & AL & VI
  EX --> LOG
  classDef purser fill:#6d28d9,stroke:#a78bfa,color:#fff
  classDef agent fill:#4338ca,stroke:#818cf8,color:#fff
  classDef paid fill:#047857,stroke:#34d399,color:#fff
  classDef refused fill:#be123c,stroke:#fb7185,color:#fff
  classDef testmoney fill:#b45309,stroke:#fbbf24,color:#fff
  classDef proof fill:#334155,stroke:#94a3b8,color:#fff
  style U fill:#be123c1a,stroke:#fb7185
  style T fill:#6d28d91a,stroke:#a78bfa
  style P fill:#6d28d91a,stroke:#a78bfa
  style Q fill:#b453091a,stroke:#fbbf24
```

> [!NOTE]
> The CFO's emergency stop ran live for payments on the Airwallex sandbox on 26 November: a signed stop held a supplier
> payout at the rail with no create sent, and lifting it took the passkey (a virtual test passkey;
> [record](docs/runs/2026-11-26-stop-at-rail-live.md)). Freezing every card on a stop is tested against stand-ins only
> ([docs/claims.md](docs/claims.md)).

## Credit

Every reporter of a vulnerability that is resolved is credited by name (or handle) in the published advisory and in the
release notes, unless they ask to stay anonymous. Resolved reports, with their credit, are listed below.

| Date | Advisory | Reported by |
|---|---|---|
| (none yet) | No vulnerability has been reported through this process as of 19 November 2026. | |

The reviews and sweeps the project ran itself (the security reviews of 1, 8 and 13 November, the sweeps of
15 November) are in [docs/security.md](docs/security.md) and their tests; they were not outside reports.

## No secrets in this repository

No key, token, password or environment value is committed: gitleaks scans every push and the whole history of the
commit under check (CI job `secrets`), and its accepted false positives are listed by fingerprint, each with the reason,
in `.gitleaksignore`. Live runs read their keys from the environment or a proxy, never from a file in the repository;
`.env.example` lists variable names only. If you find a secret here, report it privately as above.

<details><summary><b>Where to read more</b></summary>

| Document | What it holds |
|---|---|
| [docs/security.md](docs/security.md) | The threat model: what we protect, the attackers and attacks, what stops each one, the accepted risks |
| [docs/controls.md](docs/controls.md) | Every control, how it works, and its evidence |
| [docs/security/README.md](docs/security/README.md) | The security artefacts: the software bill of materials, the supply-chain and static-analysis checks, how to verify a release |
| [docs/assurance.md](docs/assurance.md) | The assurance case: each invariant about money, the function that enforces it, its tests |
| [GOVERNANCE.md](GOVERNANCE.md) | Who holds the security response role |

</details>
