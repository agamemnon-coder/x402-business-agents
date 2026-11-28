<div align="center">

<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# AI technical documentation

**Purser's AI system described in the order EU AI Act Annex IV sets: what it is for, the models it uses, how it is built and tested, how people oversee it, and how it is logged and watched.**

[![Version 1.0](https://img.shields.io/badge/version-1.0-5996f9?style=flat-square&labelColor=1f2937)](#document-control)&nbsp;[![Review by 2027-05-26](https://img.shields.io/badge/review_by-2027--05--26-f59e0b?style=flat-square&labelColor=1f2937)](#document-control)&nbsp;[![EU AI Act Art. 11, Annex IV](https://img.shields.io/badge/EU_AI_Act-Art._11%2C_Annex_IV-0ea5e9?style=flat-square&labelColor=1f2937)](controls.md#eu-ai-act-regulation-eu-20241689)&nbsp;[![High-risk: none on this reading](https://img.shields.io/badge/high--risk-none_on_this_reading-10b981?style=flat-square&labelColor=1f2937)](ai-act-classification.md#the-classification)&nbsp;[![Not legal advice](https://img.shields.io/badge/legal_advice-no-475569?style=flat-square&labelColor=1f2937)](#document-control)

[1 General](#1-general-description) · [2 Elements and development](#2-elements-and-development) · [3 Monitoring and control](#3-monitoring-functioning-and-control) · [4 Metrics](#4-why-these-metrics) · [5 Risk](#5-risk-management) · [6 Changes](#6-changes-over-the-lifecycle) · [7 Standards](#7-standards-applied) · [8 Declaration](#8-eu-declaration) · [9 Post-market](#9-post-market-monitoring)

</div>

## Document control

| Owner | Version | Written | Review by | Reviewed by |
|---|---|---|---|---|
| The maintainer, as AI system owner ([ai-policy.md](ai-policy.md#roles)) | 1.0, for Purser 1.5 | 26 November 2026 | 26 May 2027, and with every release that changes an agent, a model or a guardrail | Nobody else: no counsel, no notified body, no deployer |

> [!IMPORTANT]
> **Test money / sandbox; not legal advice.** Art. 11 and Annex IV bind the provider of a **high-risk** AI system.
> Purser's own reading ([ai-act-classification.md](ai-act-classification.md)) finds no agent or feature in Annex III,
> so Purser is not one, and this document is drawn up **voluntarily**, so that a deployer whose own use made Purser
> high-risk would start from it. The project is the provider of the AI system it builds on Anthropic's general-purpose
> models; Anthropic is the provider of those models. Everything below is drawn from this repository, and
> `test/compliance-templates.test.ts` holds the model ids named here to the code and every path cited to a file
> that exists.

## 1. General description

| Annex IV 1 | Purser |
|---|---|
| (a) Intended purpose, provider, version | Lets AI agents pay a business's suppliers, refund its customers and keep its balances above their floors, within limits the CFO sets; above a limit, the CFO signs the exact terms with a passkey. Intended users: a business's finance team (CFO, a second approver, a controller). Provider: the open-source project `agamemnon-coder/x402-business-agents`, maintained by @agamemnon-coder. Version: 1.5, in [package.json](../../package.json) and the [changelog](../../CHANGELOG.md) |
| (b) Interaction with other hardware, software and AI systems | Anthropic's Claude models through the Claude API; Airwallex (payouts, cards, Airi), Alta testnet (agent payments, the log's anchor), Cloudflare (the approval relay, Purser Cloud); other agents through the [agent API](../agent-api.md) and the [MCP server](../mcp.md). Every outside service is in the [third-party register](third-parties.md) |
| (c) Software versions, update requirements | Node 22.13 or later; dependencies pinned in `package-lock.json` and listed in the SBOM ([sbom.cdx.json](../security/sbom.cdx.json)); updates come as releases signed with Sigstore provenance ([releasing.md](../releasing.md)) |
| (d) Forms in which it is made available | The source repository and its signed releases (MIT licence); Purser Cloud as a public test preview with made-up companies, and a private console preview; no customer uses it |
| (e) Hardware it runs on | The runner on the owner's machine; the relay and Purser Cloud on Cloudflare Workers; a phone with a passkey (Face ID) for approvals |
| (f) What the product looks like | The screens are in the [gallery](../gallery.md) |
| (g) User interface for the deployer | The CFO's dashboard (`src/dashboard/page.html`), the phone's approval page (`src/approve/client.ts`), Purser Cloud's console, the command line |
| (h) Instructions for use | [instructions-for-use.md](instructions-for-use.md), written to Art. 13(3) |

## 2. Elements and development

### (a) Methods, and the pre-trained models used

Purser trains, fine-tunes or adapts no model. It calls Anthropic's Claude models through the Claude API and checks
every output with code before use. The model per role, as the code sets it:

| Role | Model | Set in |
|---|---|---|
| Classify an incoming document | `claude-haiku-5-5` | `src/claude/reader.ts` (`MODELS.classify`) |
| Read a document into typed fields, the agents' reading | `claude-sonnet-5-5` | `src/claude/reader.ts` (`MODELS.act`) |
| Advisory review beside a proposal | `claude-opus-5-5` | `src/claude/reader.ts` (`MODELS.review`) |
| Treasury's advice on when to pay | `claude-opus-5-5` | `src/agents/timingCore.ts` (`TIMING_MODEL`) |
| Sourcing agent (autonomy runs) | `claude-haiku-5-5` | `src/autonomy/sourcingCore.ts` (`SOURCING_MODEL`) |
| Negotiation | `claude-haiku-5-5` | `src/negotiate/claude.ts` (`NEGOTIATE_MODEL`) |
| Ask Purser (Purser Cloud) | `claude-haiku-5-5` | `cloud/src/ask/model.ts` (`ASK_MODEL`) |

The Kit 11 agents' models are in [agents.md](../agents.md); the payables Checker, Coder and Payer were measured on
three models ([agent-evals.md](../agent-evals.md)). A model's answer is structured output checked against a schema,
then by code against the document's own lines; when a call fails, is refused or no key is set, the deterministic
parsers take over (`claude.fallback`).

### (b) Design: the general logic and the key choices

- **No model output moves money.** A model proposes, reads or advises. A payment is decided only by code, within a
  limit the CFO signed (PC-03), or by a person whose passkey signs the SHA-256 of the exact terms (PC-01); the executor
  re-hashes the terms before any call to a rail (PC-02) ([ai-policy.md](ai-policy.md#the-principle-no-model-output-moves-money)).
- **Each agent is a principal** with its own tools, rails, currencies and payees (PC-07), signing each money-relevant
  request with its own key (PC-08), within a mandate and a short-lived token (PC-09).
- **Documents are untrusted input.** An instruction found in an invoice or an e-mail is flagged and changes nothing;
  changed bank details are held for a check outside the system (PC-13; [fraud-and-injection.md](../fraud-and-injection.md)).
- **What it optimises:** each agent's task within its mandate; the trade-off made is the model per agent, chosen as the
  cheapest that passed every eval case, because the cheaper models fail some ([instructions-for-use.md](instructions-for-use.md#6-accuracy-and-robustness-as-measured)).
- **No decision about a person** is made by a model: the agents decide about payments to businesses, never about
  anyone's credit, employment or access to a service ([ai-act-classification.md](ai-act-classification.md#why-not-high-risk-annex-iii)).

### (c) Architecture and computational resources

The runner, the relay and Purser Cloud, and how they talk: [architecture.md](../architecture.md). Model calls go to
the Claude API; each action has a spend budget, and a call whose worst case does not fit is not sent
(`src/claude/budget.ts`, `claude.capped`). Purser runs no model of its own.

### (d) Data

No training, validation or test data is used to build a model, because Purser builds none. At run time the models read
invoices, documents (up to three pages of a scan), e-mails and agents' messages, as the [record of processing](gdpr.md#record-of-processing-activities-art-30)
lists. The eval cases are hand-written test data in `src/evals/`, and the held-out adversarial sets were committed
before their first run (for example [adversarial-v17.md](../evals/adversarial-v17.md)).

### (e) Human oversight measures (Art. 14)

| Measure | Control | Record |
|---|---|---|
| A person signs the exact terms above every limit | PC-01 | `proposal.approved` |
| Two different people above the four-eyes threshold and for loosening the policy | PC-05 | `proposal.cosigned` |
| One action stops everything; one agent can be paused or revoked | PC-06, PC-07 | `policy.changed`, `principal.revoked` |
| Whether Details was opened before signing (automation bias) | PC-26 | `approval.rationale_viewed` |
| Advice against a proposal makes Approve arm after 3 seconds instead of 0.8 | `src/approve/client.ts` | |

How a person uses them: [instructions-for-use.md](instructions-for-use.md#4-the-human-oversight-it-needs) and
[ai-literacy.md](ai-literacy.md).

### (f) Changes decided in advance

The system does not learn in use. A model is changed only by a pull request that runs its eval on the cases of
[agent-evals.md](../agent-evals.md) ([ai-policy.md](ai-policy.md#acceptable-use-of-claude-agents)); a change that lets
a model approve, or weakens the signature over the exact terms, is refused in review ([CONTRIBUTING.md](../../CONTRIBUTING.md)).

### (g) Validation and testing

| What | Metric | Record |
|---|---|---|
| The agents with real models | Case-and-model rows passed every run | [agent-evals.md](../agent-evals.md), `docs/evals/agents.json` |
| The payables agents | Right, fooled, unsafe after code enforced | `docs/evals/ap-agents.json` |
| A hostile model in Claude's place, in CI | Hostile tool calls refused by code; unsafe by the ledger verdict | `docs/evals/ap-hostile.json` |
| A script that always says pay | Wrong payments, paid past the CFO | [worst-case-ai.md](../worst-case-ai.md) |
| Held-out adversarial invoices | Wrong payments and false holds, blind then rerun | [adversarial-v17.md](../evals/adversarial-v17.md) |
| Red team of the API | Attacks held | [redteam-api.md](../evidence/redteam-api.md), [coverage.md](../redteam/coverage.md) |
| Changed copies of signed terms | Every one refused | [tamper-matrix.md](../evidence/tamper-matrix.md) |
| Fuzzing, chaos for money movement, the formal model | Crashes, money lost, states reached | [fuzzing.md](../evidence/fuzzing.md), [chaos-money.md](../evidence/chaos-money.md), [formal-model.md](../evidence/formal-model.md) |

Each record is dated and committed with the commit it ran on; none is signed by a responsible person, as Annex IV
2(g) asks of test reports: a missing part ([controls.md](controls.md)).

### (h) Cybersecurity

A STRIDE threat model with trust zones ([security.md](../security.md)), the assurance case ([assurance.md](../assurance.md)),
a zero-trust matrix ([zero-trust.md](../zero-trust.md)), an OWASP ASVS 4.0.3 Level 2 self-assessment
([asvs-l2.md](../security/asvs-l2.md)) and the OWASP LLM Top 10 mapping ([SECURITY-MAPPING.md](../security/SECURITY-MAPPING.md)).

## 3. Monitoring, functioning and control

- **Capabilities and limits**, and the accuracy measured per agent, model and case set:
  [instructions-for-use.md](instructions-for-use.md#6-accuracy-and-robustness-as-measured). No level is promised
  beyond those records.
- **Accuracy for particular persons or groups:** not applicable; no agent decides about a person.
- **Foreseeable unintended outcomes and sources of risk:** an approver who signs without reading; an instruction
  planted in a document; a wrong reading of a document whose own lines are wrong; a cheaper model failing a case.
  Each is in the risk register ([ai-impact-assessment.md](ai-impact-assessment.md#the-risk-register)).
- **Input data:** documents, e-mails and messages are untrusted; a card number never reaches a model.

## 4. Why these metrics

The payables figures measure the outcome after code enforced the agent's decision, because that is what the business
gets: code alone gets the Checker's non-red-team cases right too, so the figure mostly measures code, and the Coder's
accuracy is given apart ([agent-evals.md](../agent-evals.md)). *Fooled* counts what the agent alone would have paid
wrongly, so a model's weakness stays visible even when code stopped it.

## 5. Risk management

The impact assessment per agent and feature, the risk matrix and the risk register with owners and a review date:
[ai-impact-assessment.md](ai-impact-assessment.md). Its first review is due on 26 May 2027 (the EU AI Act Art. 9(2) row
of [controls.md](controls.md)).

## 6. Changes over the lifecycle

Every release: [CHANGELOG.md](../../CHANGELOG.md) and the release notes in `docs/releases/`; every change through a
pull request and CI (PC-21). This document is updated with each release that changes an agent, a model or a guardrail.

## 7. Standards applied

No harmonised standard is applied. Mapped instead, without an audit: ISO/IEC 42001 Annex A and the other frameworks of
[controls.md](controls.md), OWASP ASVS 4.0.3 Level 2, the OWASP Top 10 for LLM applications, and NIST SP 800-57 for key
management ([key-management.md](../security/key-management.md)).

## 8. EU declaration

None drawn up: the EU declaration Art. 47 describes is for high-risk systems, and on Purser's reading it is not one.

## 9. Post-market monitoring

No post-market monitoring plan in the sense of Art. 72 exists. What watches the system in use today:

- each model reading is an audit row with the model, request id, input hash and token use (PC-16);
- every refusal and hold is recorded with its reason (PC-11), and the ledger is reconciled with the rails every hour (PC-15);
- the controller reads the compliance evidence each month, the automation-bias signal included ([README.md](README.md#run-it));
- incidents are classified and handled as in [incident-response.md](incident-response.md);
- the AI policy, this document and the impact assessment are reviewed together ([qms.md](qms.md#h-post-market-monitoring)).

## See also

[ai-act-classification.md](ai-act-classification.md) · [qms.md](qms.md) · [ai-literacy.md](ai-literacy.md) ·
[instructions-for-use.md](instructions-for-use.md) · [ai-policy.md](ai-policy.md) · [controls.md](controls.md)
