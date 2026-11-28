<div align="center">

<a href="../../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/purser-mark-dark.svg"><img src="../../assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Data processing agreement: a template for Purser Cloud

**A template agreement between a company that uses Purser Cloud (the controller) and Purser Cloud's operator (the processor), with each item GDPR Art. 28(3) lists and the subprocessors from the register.**

[![Version 1.0](https://img.shields.io/badge/version-1.0-5996f9?style=flat-square&labelColor=1f2937)](#document-control)&nbsp;[![Review by 2027-05-26](https://img.shields.io/badge/review_by-2027--05--26-f59e0b?style=flat-square&labelColor=1f2937)](#document-control)&nbsp;[![GDPR Art. 28](https://img.shields.io/badge/GDPR-Art._28-0ea5e9?style=flat-square&labelColor=1f2937)](../controls.md#gdpr-regulation-eu-2016679)&nbsp;[![Signed: with nobody](https://img.shields.io/badge/signed-with_nobody-f43f5e?style=flat-square&labelColor=1f2937)](#document-control)&nbsp;[![Template, not legal advice](https://img.shields.io/badge/template-not_legal_advice-475569?style=flat-square&labelColor=1f2937)](#document-control)

[Checklist](#the-art-283-checklist) · [Parties](#1-parties) · [Instructions](#3-instructions) · [Security](#5-security) · [Subprocessors](#6-subprocessors) · [Return and deletion](#9-deletion-or-return-at-the-end) · [Annexes](#annex-i-the-processing)

</div>

## Document control

| Owner | Version | Written | Review by | Reviewed by counsel | Signed |
|---|---|---|---|---|---|
| The maintainer | 1.0 | 26 November 2026 | 26 May 2027, and when a table, a provider or a route of Purser Cloud changes | No | With nobody |

> [!IMPORTANT]
> **Test money / sandbox. Template, not legal advice; not reviewed by counsel.** No company uses Purser Cloud with
> real data: it runs a public test preview with made-up companies and a private console preview, and no customer
> uses it ([runbook.md](../../runbook.md#purser-cloud-added-9-november)). There is no company behind Purser yet
> ([instructions-for-use.md](../instructions-for-use.md#1-the-provider)), so the processor's name below is a blank. This
> template is the agreement such a company and Purser Cloud's operator would start from, with counsel, before any
> real data comes in ([data-inventory.md](../../privacy/data-inventory.md#roles)). Words in **[brackets]** are for the
> parties to fill in. The roles are those of [gdpr.md](../gdpr.md#who-is-controller): the company is the controller of
> its data; for its own security and abuse controls, Purser's operator may itself be a controller.

## The Art. 28(3) checklist

| Art. 28 | What the contract must provide | Clause below | What Purser Cloud has today |
|---|---|---|---|
| 28(3), first sentence | Subject matter, duration, nature and purpose of the processing, the type of personal data, the categories of data subjects, the controller's rights and obligations | [2](#2-subject-matter-and-duration), [Annex I](#annex-i-the-processing) | The record of processing, R1 to R9 ([gdpr.md](../gdpr.md#record-of-processing-activities-art-30)) |
| 28(3)(a) | Process only on documented instructions, transfers included, unless the law requires otherwise (and then say so first) | [3](#3-instructions) | The company's settings are its instructions: the CFO policy, the integrations and alerts it switches on |
| 28(3), last paragraph | Tell the controller at once if an instruction would breach data protection law | [3](#3-instructions) | No route for it: by e-mail to the controller's contact |
| 28(3)(b) | People authorised to process are bound to confidentiality | [4](#4-confidentiality) | One person, the maintainer, holds the platform admin token ([runbook.md](../../runbook.md#purser-cloud-added-9-november)) |
| 28(3)(c) | The measures of Art. 32 | [5](#5-security), [Annex II](#annex-ii-technical-and-organisational-measures) | As built and tested; not audited |
| 28(2), (4) and 28(3)(d) | Subprocessors only with the controller's authorisation, under the same obligations; the processor stays liable | [6](#6-subprocessors), [Annex III](#annex-iii-subprocessors) | The register's providers, on their standard terms; no agreement with any of them is recorded |
| 28(3)(e) | Help the controller answer data subjects' requests | [7](#7-data-subjects-rights) | `GET /v1/me`, the company's export, `POST /v1/users/{id}/erase` |
| 28(3)(f) | Help with Arts. 32 to 36: security, breach notification, impact assessments, prior consultation | [8](#8-breaches-and-impact-assessments) | [incident-response.md](../incident-response.md); the DPIA in [gdpr.md](../gdpr.md#dpia-for-the-agents-art-35) |
| 28(3)(g) | At the end, delete or return all personal data, as the controller chooses, unless the law requires it to be kept | [9](#9-deletion-or-return-at-the-end) | Export first, then `POST /v1/offboarding`; the books kept as bookkeeping law requires |
| 28(3)(h) | Make available the information needed to show these obligations are met; allow and contribute to audits | [10](#10-information-and-audits) | The signed compliance evidence and audit pack (runner); no audit has been made |
| Chapter V | Transfers outside the EU only with a mechanism | [11](#11-transfers-outside-the-eu) | **None recorded** ([transfers.md](../transfers.md)) |

## 1. Parties

- **Controller:** **[the company's legal name, registered address, registration number, contact for data protection]**,
  the company that uses Purser Cloud.
- **Processor:** **[Purser Cloud's operator: legal name, registered address, registration number, contact]**. Blank
  today: there is no company behind Purser yet.

This agreement is part of **[the Purser Cloud agreement between the parties, its date]**. Where they differ on personal
data, this agreement prevails.

## 2. Subject matter and duration

The processor hosts and processes the controller's bookkeeping, payment approvals and related records in Purser Cloud,
as described in [Annex I](#annex-i-the-processing), for as long as the Purser Cloud agreement runs, and afterwards for
as long as clause 9 needs.

## 3. Instructions

1. The processor processes the personal data only on the controller's documented instructions, including on transfers
   to a third country, unless EU or Member State law requires otherwise; in that case it tells the controller before
   processing, unless that law forbids it.
2. The instructions are this agreement, the Purser Cloud agreement, and what the controller sets in Purser Cloud: its
   people and roles, its CFO policy, the integrations and alert targets it switches on, its exports and erasures.
   Further instructions are given in writing to **[the processor's contact]**.
3. The processor tells the controller at once if, in its opinion, an instruction would breach the GDPR or other data
   protection law.

## 4. Confidentiality

The processor lets only people who need it for the service process the personal data, and only after they are bound to
confidentiality by contract or by law. **[List of the processor's roles with access.]** Today one person, the
maintainer, holds the platform admin token (only its SHA-256 is kept as a Worker secret).

## 5. Security

The processor takes the measures Art. 32 requires, at least those in [Annex II](#annex-ii-technical-and-organisational-measures),
and keeps them in step with the risk. It does not reduce them without telling the controller **[n days]** in advance.

## 6. Subprocessors

1. The controller gives a general written authorisation for the subprocessors in [Annex III](#annex-iii-subprocessors).
2. The processor tells the controller **[n days]** before adding or replacing one, so the controller can object;
   **[what happens on an objection: termination, an alternative]**.
3. The processor puts the same data protection obligations on each subprocessor by contract, in particular sufficient
   technical and organisational measures, and remains fully liable to the controller for each subprocessor's
   performance.
4. **Today:** every provider in Annex III is used on its standard terms (test, sandbox or developer accounts); no
   agreement between Purser's operator and any of them is recorded. Each must be in place before real data comes in.

## 7. Data subjects' rights

The processor helps the controller answer requests from people exercising their rights (Arts. 12 to 22), with these
routes of Purser Cloud ([gdpr.md](../gdpr.md#data-subjects-rights)):

| Right | Route |
|---|---|
| Access, Art. 15 | `GET /v1/me` for a user; the company's export (`POST /v1/export/staged`) for anyone else, answered by the controller |
| Rectification, Art. 16 | `/v1/me`; a supplier's bank details only through the payee-change procedure |
| Erasure, Art. 17 | `POST /v1/users/{id}/erase`: the name pseudonymised, e-mail, passkeys, linked accounts and keys removed at once; the books kept (Art. 17(3)(b)) |
| Portability, Art. 20 | The company's export, JSON and CSV |

A request that reaches the processor directly is passed to the controller within **[n working days]** and not
answered by the processor itself.

## 8. Breaches and impact assessments

1. The processor tells the controller of a personal data breach without undue delay, and within **[n hours]** of
   becoming aware of it, with what [incident-response.md](../incident-response.md) records: what happened, the data and
   people affected, the likely consequences, the measures taken. Notifying the supervisory authority (Art. 33) and the
   people affected (Art. 34) is the controller's.
2. The processor helps with the controller's impact assessments and prior consultations (Arts. 35, 36), starting from
   the DPIA in [gdpr.md](../gdpr.md#dpia-for-the-agents-art-35).

## 9. Deletion or return at the end

At the end of the service the controller chooses:

- **Return:** the company's export (`POST /v1/export/staged`, JSON and CSV, every document by its SHA-256), which the
  owner downloads.
- **Deletion:** `POST /v1/offboarding`, after that export ([retention.md](../../privacy/retention.md#offboarding-a-company)).
  People's names are pseudonymised and their contact details, passkeys and keys removed at once; the books are kept
  until 31 December of the seventh year after their last record, because bookkeeping law requires it, then purged.

The processor confirms in writing when it is done. **[Any longer period the law requires the processor to keep data.]**

## 10. Information and audits

1. The processor makes available what the controller needs to see these obligations are met: this agreement's
   annexes, the [control map](../controls.md), and on request the records Purser keeps.
2. The processor allows audits and inspections by the controller or an auditor it mandates, and contributes to them,
   **[with notice of n days, at most once a year unless after a breach, at whose cost]**.
3. **Today:** nobody has audited Purser Cloud. The runner's signed compliance evidence and audit pack
   ([README.md](../README.md#run-it)) are made on the runner, not in Purser Cloud.

## 11. Transfers outside the EU

The processor transfers personal data outside the EEA only on the controller's instructions and only under Chapter V
of the GDPR. Per subprocessor, where the data goes and which mechanism it would need is in
[transfers.md](../transfers.md). **Today none is in place or recorded**; Anthropic, Resend and Twilio are in the United
States. **[The mechanism per subprocessor, for example the Standard Contractual Clauses' module, attached.]**

## 12. Liability, term, law

**[Liability, term and termination, governing law and courts: as in the Purser Cloud agreement, or set here with
counsel.]**

## Annex I: the processing

| | |
|---|---|
| **Categories of data subjects** | The company's staff (owners, CFO, accountants, viewers); approvers; suppliers who are natural persons and suppliers' contacts; customers who are refunded or invoiced; people named as alert targets; visitors of the demo |
| **Types of personal data** | Names, e-mail addresses, roles, passkeys' public keys and signatures over terms hashes, bank details of suppliers, invoices and documents, payments and refunds, alert phone numbers and e-mail addresses, network addresses (cut to their network where kept) |
| **Special categories** | None intended. A document a supplier sends can carry anything; the controller decides what it uploads |
| **Nature and purpose** | The activities R1 to R9 of the [record of processing](../gdpr.md#record-of-processing-activities-art-30): sign-in, payment approvals, accounts payable and bookkeeping, agent payments, disputes, security monitoring, approval alerts, accounts receivable |
| **Duration and retention** | As each activity's *Kept* column says ([retention.md](../../privacy/retention.md)) |

## Annex II: technical and organisational measures

As built in this repository and tested; not audited. The protection levels per table are in
[data-classification.md](../../security/data-classification.md).

| Measure | How | Where |
|---|---|---|
| Separation of companies | Every row carries the company's `tenant_id`; every query is scoped by it | `cloud/src/tenant.ts` |
| Access | Passkeys for people; scoped API keys; roles (owner, CFO, accountant, viewer); a recent passkey check for offboarding | `cloud/src/stepUp.ts`, [data-inventory.md](../../privacy/data-inventory.md) |
| Approvals | A payment above the limits only with a passkey signature over the SHA-256 of its exact terms (PC-01) | [phone-approval.md](../../phone-approval.md) |
| Integrity | Hash-chained audit log and ledger; an import checks both chains and every document's SHA-256 before writing | `cloud/src/restore.ts`, PC-10 |
| Secrets | Sealed tokens and key hashes kept, never a secret in the clear; secrets redacted from logs | `src/lib/redact.ts`, [key-management.md](../../security/key-management.md) |
| Data location | D1 placed in western Europe; R2 bucket in the EU jurisdiction; Durable Objects and logs not pinned | [third-parties.md](../third-parties.md) |
| Minimisation | Network addresses cut to their network; a card number never reaches Purser or a model | [gdpr.md](../gdpr.md) |
| Exports | Staged exports behind signed links valid 15 minutes; every export and download in the security events | `cloud/src/exports.ts` |
| Incidents | Severity classes, the runbook, the record | [incident-response.md](../incident-response.md) |

## Annex III: subprocessors

Generated from the [third-party register](../third-parties.json) and the [record of processing](../gdpr.md#record-of-processing-activities-art-30).

<!-- subprocessors:start: generated by npm run compliance:controls from docs/compliance/third-parties.json and src/compliance/gdpr.ts; do not edit by hand -->

17 providers receive personal data in the record of processing. Called from: the register's code paths. A provider called only by the runner is engaged by the business itself when it runs the runner with its own accounts; it is Purser's subprocessor only where Purser's operator runs that part for the business.

| Subprocessor | Service | Data it receives (register: Restricted and Secret) | Activities | Called from | Location (register) | Terms today (register) |
|---|---|---|---|---|---|---|
| **Airwallex** | Business accounts, payouts and FX, virtual cards for the agents, webhooks, and Airi (agentic checkout) | Suppliers' names and bank details (beneficiaries), amounts, payouts, conversions, the agents' cardholders (placeholder personal details in the sandbox) (Restricted) | R3, R4, R5, R9 | the runner | Sandbox today (docs/privacy/data-inventory.md); the production region is not documented in this repository | none: a sandbox account on Airwallex's standard terms |
| **Visa, through Airwallex Airi** | Visa Intelligent Commerce: one agent purchase with one tokenised credential, through Airwallex's Airi | The purchase (merchant, amount, description); Purser never sees a card number (Restricted) | R4 | the runner | Through Airwallex's sandbox (no Visa host is called by Purser's code) | none: through Airwallex's sandbox |
| **Alta (formerly Metal)** | Testnet chain, *USDZ, the x402 facilitator, and the contracts that hold agent mandates, clearing and receive policy | Agents' addresses and amounts, written to a public testnet for good (Restricted) | R4 | the runner | Public testnet: written for good (docs/privacy/data-inventory.md) | none: a public testnet |
| **Anthropic (Claude API)** | Claude models: reading invoices and documents, the agents' reasoning, reviews, Ask Purser | Invoice text and documents to read, the agents' prompts, a person's question to Ask Purser (Restricted) | R3, R5 | Purser Cloud and the runner | United States (docs/privacy/data-inventory.md) | none: a developer API key on Anthropic's standard terms |
| **Cloudflare** | Workers, D1, R2, Durable Objects, Queues, Email Routing, Workers Logs, Turnstile: the approval relay and Purser Cloud | Everything Purser Cloud stores and every request it serves (the books, documents, people, security logs) (Restricted); Sealed tokens and key hashes Purser Cloud keeps (never a secret in the clear) (Secret) | R1, R2, R3, R4, R5, R6, R7, R8, R9 | Purser Cloud and the runner | D1 placed in western Europe (--location weur); R2 bucket in the EU jurisdiction; Durable Objects and logs not pinned (docs/privacy/data-inventory.md) | none negotiated: the maintainer's account on Cloudflare's standard terms |
| **T:0** | Accounting: each payment booked as an entry | Journal entries: invoices, suppliers and payments (Restricted) | R3 | the runner | The provider's (docs/privacy/data-inventory.md) | none: a test account |
| **Moneybird** | Accounting package (OAuth connection) | Invoices, suppliers and journal entries pushed to the company's own administration (Restricted) | R3 | the runner | The provider's (docs/privacy/data-inventory.md) | none: a test administration |
| **Xero** | Accounting package, and invoices read from it (OAuth) | Invoices, suppliers and journal entries (Restricted) | R3 | Purser Cloud and the runner | The provider's (docs/privacy/data-inventory.md) | none: a developer app |
| **Intuit QuickBooks Online** | Accounting package (OAuth connection) | Invoices, suppliers and journal entries (Restricted) | R3 | the runner | The provider's (docs/privacy/data-inventory.md) | none: a developer app |
| **Exact Online** | Accounting package (OAuth connection) | Invoices, suppliers and journal entries (Restricted) | R3 | the runner | The provider's (docs/privacy/data-inventory.md) | none: a developer app |
| **Odoo** | Accounting package, on the company's own Odoo address | Invoices, suppliers and journal entries (Restricted) | R3 | the runner | The provider's (docs/privacy/data-inventory.md) | none |
| **Microsoft (Entra ID, Graph, Business Central, Teams)** | Sign-in, Outlook and OneDrive as invoice sources, Business Central as a bookkeeping sink, Teams incoming webhooks | A sign-in request (Purser receives the account's subject and e-mail); invoices read from the mailbox or folder; journal entries; an approval alert's message (Restricted) | R1, R3, R7 | Purser Cloud and the runner | The provider's (docs/privacy/data-inventory.md) | none: developer apps |
| **Google (Sign-In, Gmail, Drive, Sheets)** | Sign-in, Gmail and Drive as invoice sources, Sheets | A sign-in request (Purser receives the account's subject and e-mail); invoices read from the mailbox or folder (Restricted) | R1, R3 | Purser Cloud and the runner | The provider's (docs/privacy/data-inventory.md) | none: developer apps |
| **Apple (Sign in with Apple)** | Sign-in | A sign-in request; Purser receives the account's subject and e-mail (Restricted) | R1 | Purser Cloud | The provider's (docs/privacy/data-inventory.md) | none: a developer account |
| **Slack** | Incoming webhooks to the company's own channel | An approval alert's message (amount, payee, link) (Restricted) | R7 | Purser Cloud and the runner | The provider's (docs/privacy/data-inventory.md) | none |
| **Resend** | E-mail delivery | An approval alert's e-mail address and message (amount, payee, link) (Restricted) | R7 | Purser Cloud | United States (docs/privacy/data-inventory.md) | none |
| **Twilio** | WhatsApp messages | An approval alert's phone number and message (Restricted) | R7 | Purser Cloud | United States (docs/privacy/data-inventory.md) | none |

<!-- subprocessors:end -->

## See also

- [../gdpr.md](../gdpr.md): roles, the record of processing, the DPIA, rights.
- [../transfers.md](../transfers.md): where the data goes, and which mechanism each recipient would need.
- [ict-contract-clauses.md](ict-contract-clauses.md): the DORA Art. 30 clauses, for a financial entity.
- [../controls.md](../controls.md): the GDPR Art. 28 row (PC-38).
