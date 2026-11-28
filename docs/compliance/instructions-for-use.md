<div align="center">

<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Instructions for use

**For a business that deploys Purser: what it does and does not do, its limits, the oversight it needs, how to stop it, and how accurate it was measured to be.**

[![Version 1.0](https://img.shields.io/badge/version-1.0-5996f9?style=flat-square&labelColor=1f2937)](#document-control)&nbsp;[![Review by 2027-05-26](https://img.shields.io/badge/review_by-2027--05--26-f59e0b?style=flat-square&labelColor=1f2937)](#document-control)&nbsp;[![EU AI Act Art. 13](https://img.shields.io/badge/EU_AI_Act-Art._13%283%29-0ea5e9?style=flat-square&labelColor=1f2937)](controls.md)&nbsp;[![Money: test only](https://img.shields.io/badge/money-test_only-10b981?style=flat-square&labelColor=1f2937)](#1-the-provider)

[Provider](#1-the-provider) · [Purpose](#2-what-purser-is-for) · [Does not](#3-what-purser-does-not-do) · [Oversight](#4-the-human-oversight-it-needs) · [Stop it](#5-how-to-stop-it) · [Accuracy](#6-accuracy-and-robustness-as-measured) · [Logs](#7-how-logs-are-collected) · [Running it](#8-what-it-needs-to-run)

</div>

## Document control

| Owner | Version | Written | Review by | Reviewed by a deployer |
|---|---|---|---|---|
| The maintainer, as AI system owner | 1.0 | 26 November 2026 | 26 May 2027, and with every release that changes an agent or a model | Not yet (a gap, [controls.md](controls.md)) |

> [!IMPORTANT]
> **Test money / sandbox; adopt and adapt before production.** Purser runs today on the Airwallex sandbox, Alta
> testnet and Visa through Airwallex Airi in the sandbox. These instructions follow the list in EU AI Act Art. 13(3).
> They do not say Purser is a high-risk AI system: Purser's own reading is that it is not
> ([ai-act-classification.md](ai-act-classification.md)).

## 1. The provider

Purser, the open-source project `agamemnon-coder/x402-business-agents` (MIT licence), maintained by **@agamemnon-coder**.
Contact: a private report through [SECURITY.md](../../SECURITY.md) for anything about security; an issue on the
repository for everything else. There is no company behind it yet and no support contract.

## 2. What Purser is for

Purser lets AI agents pay a business's suppliers within limits the CFO sets. The agents (Claude models) read
invoices, buy what they are allowed to, refund customers within a cap and keep balances above their floors; above a
limit, the CFO signs the exact terms with a passkey (Face ID) on the phone. Everything is recorded in a hash-chained
audit log. Intended users: a business's finance team (CFO, a second approver, a controller).

## 3. What Purser does not do

- **It never lets a model approve or move money.** A model proposes; code (within a limit the CFO signed) or a person
  (with a passkey over the exact terms) decides ([ai-policy.md](ai-policy.md#the-principle-no-model-output-moves-money)).
- It holds no customer money (the money is in the business's own Airwallex and Alta accounts) and never sees a card number.
- It does not score, profile or decide about people; it does not decide on credit.
- It is not a payment service provider: the PSP's own controls (Airwallex's strong customer authentication, card
  controls, screening) apply on top ([psd2-sca.md](psd2-sca.md)).
- It has not been audited or penetration-tested by an independent party.

**Limits and foreseeable misuse.** An approver who signs without reading defeats the passkey (automation bias: see
section 4). A document can carry instructions meant for the agents: they are flagged and change nothing, but a person
should read the flag. The agents' readings are checked by code against the document's own lines; a document whose
lines are themselves wrong is read as it is. The cheaper models fail some cases (section 6): choose the model per
agent as the eval records show.

## 4. The human oversight it needs

| Who | Must | Where |
|---|---|---|
| CFO | Set the limits and sign them; sign every payment above them after reading the terms; pull the emergency stop when something is wrong | [docs/cfo-policy.md](../cfo-policy.md), [docs/phone-approval.md](../phone-approval.md) |
| Second approver | Sign the second time above the four-eyes threshold and for loosening the policy | [docs/cfo-policy.md](../cfo-policy.md) |
| Controller | Read the compliance evidence each month, including *approvals signed with the rationale viewed: n/m*; read the refusals and holds; classify incidents | [README.md](README.md), [incident-response.md](incident-response.md) |

**Automation bias.** On the approval page the first screen holds the amount, the payee, the agent and why it needs
you; **Details** holds the agent's reasons, the review and every hashed field. Open it before you sign anything you did
not expect. The page reports whether you did (it is not signed and never blocks you), and the evidence counts it.

## 5. How to stop it

| To stop | Do | Effect |
|---|---|---|
| Everything | The emergency stop: one approved policy change, `freeze` on | Every agent payment refused, every card frozen; lifting it is a loosening and needs the passkey. Live on the Airwallex sandbox on 26 November ([record](../runs/2026-11-26-stop-at-rail-live.md)) |
| One agent | Pause it, or revoke it (its tokens with it) | It can propose nothing more |
| A payment waiting | Reject it with Face ID | Nothing is paid |
| An agent running wild | Nothing to do: its velocity limit stops it at once (`velocity.tripped`) | A person looks before it runs again |

The runbook has every step: [docs/runbook.md](../runbook.md).

## 6. Accuracy and robustness, as measured

Declared only as the records measured them, with their scope (EU AI Act Art. 15(3)). These are test cases, not
production traffic; no level is promised beyond them.

| What | Measured | Scope | Record |
|---|---|---|---|
| Sourcing, Support, Treasury agents | 67 of 68 case-and-model rows passed every run; Support on claude-haiku-5-5 failed `support-outside` 0 of 10 (an attack case), so Support's default is claude-sonnet-5-5 | Stand-in tools, no chain, no Airwallex; 5 to 20 runs per row; last update 6 Nov 2026 | [agent-evals.md](../agent-evals.md) |
| Payables Checker | 40 of 40 cases right (not red team) on each of three models; 0 fooled | 49 cases, one fresh test ledger each; 12 Nov 2026 | [agent-evals.md](../agent-evals.md#the-payables-agents-the-checker-and-the-payer-with-real-models), `docs/evals/ap-agents.json` |
| Payables Payer | 10 of 10 right (not red team) on each of three models | 13 cases; 12 Nov 2026 | same |
| Payables Coder | Account class 94.3% (haiku and sonnet); VAT code 68.6% (haiku), 91.4% (sonnet); no model reached 95% on both | 35 test invoices, one run each; 12 Nov 2026 | [agent-evals.md](../agent-evals.md) |
| A hostile model in Claude's place | 380 hostile tool calls, 370 refused by code, 0 unsafe by the ledger verdict | Every turn its worst tool call; in CI | `docs/evals/ap-hostile.json` |
| The /try API under attack | 128 attacks, 128 held | Red team v2, 19 Nov 2026 | [redteam-api.md](../evidence/redteam-api.md) |
| Changed copies of signed terms | Every one refused | The tamper matrix | [tamper-matrix.md](../evidence/tamper-matrix.md) |

What "right" means: for the payables agents, the outcome after code enforced it; code alone gets the Checker's
non-red-team cases right too, so the figure mostly measures code ([agent-evals.md](../agent-evals.md)). The Coder's
mistakes are let into the books by code's rules: a bookkeeper checks the coding.

## 7. How logs are collected

Every decision, refusal and approval is a row of the hash-chained audit log in the runner's ledger (`KIT11_DB`); each
model reading is a row with the model, request id, a hash of the input and the token use. A signed audit pack
(`npm run audit-pack`) and the compliance evidence (`npm run compliance-evidence`) carry a period's rows out, each
verified offline. How long they are kept: [retention.md](retention.md).

## 8. What it needs to run

Node 22.13 or later for the runner, a Cloudflare account for the relay and Purser Cloud, sandbox keys for Airwallex and Alta, and
a Claude API key for the agents ([docs/install.md](../install.md)). Without the Claude key the reader falls back to the
plain parser and agents can be off: people propose instead. Updates come as signed releases ([docs/releasing.md](../releasing.md)).
