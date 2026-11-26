# Data inventory: personal and financial data

> **An engineering inventory, not legal advice.** It lists what the code stores, where, why, for how long and how it is
> deleted, as read from the code on 20 November 2026. The legal bases and retention periods below are the engineering
> team's reading. **The owner must confirm them with a qualified adviser** (a Dutch tax adviser or lawyer, and a privacy
> professional) before Purser holds any real company's data. Purser runs on test money only today.

The owner is in the Netherlands, so the GDPR (AVG) applies. Bookkeeping must be kept for **seven years** under Dutch law
(Article 2:10 of the Civil Code, BW, and Article 52 of the General Taxes Act, AWR). Purser Cloud keeps a closed company's
bookkeeping until 31 December of the seventh year after its last record (`purgeDay` in
[cloud/src/privacy.ts](../../cloud/src/privacy.ts)), then purges it. Some records have longer periods (for example, ten years
for records about immovable property under the VAT rules); the owner must confirm with the adviser whether any apply.

The rules per category, and how offboarding a company applies them, are in [retention.md](retention.md).

## Roles

- **A company using Purser Cloud** is the controller of its own bookkeeping: its suppliers, their contacts and bank
  details, its invoices and payments, and the people it adds.
- **Purser (the operator of Purser Cloud)** processes that data for the company, so it is the company's processor. For
  its own security and abuse controls (the security log, rate limits, the sign-in records), Purser may be a controller.
  The owner must confirm this split with the adviser and sign a data processing agreement (a *verwerkersovereenkomst*)
  with each company before any real data comes in.
- **The runner** (`src/`) is software a company runs itself. Its ledger file stays with the company, which is the
  controller and decides its retention. Purser receives what the runner pushes to Purser Cloud.

## Legal bases (GDPR Article 6(1))

| Key | Basis | Used for |
|---|---|---|
| **(b)** | Contract | Running the account: the people of a company, their sign-in, their sessions, the company's messages |
| **(c)** | Legal obligation | Bookkeeping kept seven years (BW 2:10, AWR 52); the company's obligation, which Purser carries out for it |
| **(f)** | Legitimate interest | Security and abuse controls: the security log, rate limits, failed sign-ins, tamper alarms |

## Purser Cloud: the database (D1)

One database for every company. Each company's row carries `tenant_id`, and every query is scoped by it
([cloud/src/tenant.ts](../../cloud/src/tenant.ts)). The schema is in [cloud/migrations/](../../cloud/migrations/). Some
tables are also made by their module on first use.

### People and access

| Table | What it holds | Category | Purpose and basis | Retention | How it is deleted |
|---|---|---|---|---|---|
| `tenants` | Company name, address (slug), language, when it closed, its purge day | Company data (personal data when the company is a sole trader) | Contract (b) | Until the purge; a tombstone (`[purged]`) stays so the address is never reused | `purgeExpired` renames it |
| `users` | Name, e-mail, role, language | Personal: identity, contact | Contract (b) | While the account is active | Erasure (`eraseUser`) or offboarding (`offboardTenant`): name made a pseudonym, e-mail removed at once; row deleted at the purge |
| `credentials` | Passkey public keys and counters | Personal: authentication | Contract (b) | While the person has access | Deleted on erasure, passkey removal and offboarding |
| `identity_links` | Google, Microsoft or Apple subject and e-mail | Personal: identity, contact | Contract (b) | While linked | Deleted on unlinking, erasure and offboarding |
| `sessions` | Sign-in time, expiry, user agent (cut short), network (IP cut to its network) | Personal: online identifiers | Contract (b), security (f) | Until a day after expiry | Daily job `pruneSessions`; deleted at offboarding and the purge |
| `challenges` | Single-use passkey challenges | Technical | Contract (b) | A day after expiry | Daily job (`purgeExpired`'s housekeeping); deleted at offboarding |
| `enrolments` | Invites: who, when, a hash of the secret | Personal: account management | Contract (b) | Until used or cancelled; row until the purge | Cancelled at erasure and offboarding; deleted at the purge |
| `api_keys` | Key name, scopes, hash of the secret, who made it | Personal (who made it) | Contract (b) | Revoked keys stay as a record until the purge | Revoked at erasure and offboarding; deleted at the purge |
| `recovery_requests` | Owner recovery by two platform admins: the owner's id, the admins' key ids, the check made | Personal (ids), security | Security (f) | Unapproved: a day after expiry. Approved: a year | Daily job `pruneRecoveryRequests`; deleted at offboarding and the purge |
| `oauth_states`, `oidc_states`, `oauth_codes`, `oauth_consents` | Short-lived sign-in and connection states (ids, hashes) | Technical | Contract (b) | Minutes | Deleted when used, or when expired on the next use; the company's OAuth and OIDC states also at closing and offboarding |
| `oauth_connections`, `books_connections` | The company's connected accounts (tokens sealed, encrypted) | Credentials | Contract (b) | While connected | Deleted at disconnection, closing and offboarding |

### Bookkeeping (statutory)

Kept as they are until the purge day; offboarding never changes them. `audit_rows` and `ledger_entries` are hash
chains: a changed byte would break the chain, so they are kept or deleted whole, never rewritten.

| Table / store | What it holds | Category | Purpose and basis | Retention | How it is deleted |
|---|---|---|---|---|---|
| `vendors` (+ `object_history`) | Suppliers: name, bank details (IBAN, BIC), address, contacts; each earlier version | Financial; personal for sole traders and contacts | Legal obligation (c) | Seven years (purge day) | `purgeExpired` |
| `invoices`, `payments`, `transactions` | Invoices, payments and the transactions register | Financial | Legal obligation (c) | Seven years | `purgeExpired` |
| `ledger_entries`, `ledger_lines` | The general ledger (hash-chained) | Financial | Legal obligation (c) | Seven years | `purgeExpired` |
| `audit_rows` | The runner's audit log (hash-chained): who did what, by role or agent | Financial audit evidence | Legal obligation (c) | Seven years | `purgeExpired` |
| `documents` + R2 `t/<company>/docs/<sha256>` | Invoice PDFs and other documents, by their SHA-256 | Financial; may hold personal data | Legal obligation (c) | Seven years | `purgeExpired` deletes the objects |
| `inbound_mail` + R2 `t/<company>/mail/<sha256>.eml` | E-mails that brought invoices: sender address, names, the attachment | Financial; personal (sender) | Legal obligation (c): the invoice as received | Seven years | `purgeExpired` |
| R2 `t/<company>/vault/` | The company engine's document vault | Financial | Legal obligation (c) | Seven years | `purgeExpired` deletes the prefix |
| `books_pushes` | Which invoice went to which bookkeeping package | Financial | Legal obligation (c) | Seven years | `purgeExpired` |
| `awx_accounts` | The company's Airwallex account: business name, country, who consented and when | Financial; personal (who consented) | Contract (b), legal obligation (c) | Seven years | `purgeExpired` |
| `erasures` | A record of each erasure: whose id, when, by whom | Accountability | Legal obligation (c) (GDPR Article 5(2)) | Until the purge | `purgeExpired` |

### Messages, exports and security

| Table / store | What it holds | Category | Purpose and basis | Retention | How it is deleted |
|---|---|---|---|---|---|
| `webhooks` | The company's webhook URL and its signing secret | Contact, credential | Contract (b) | Until removed | Removed by an owner; deleted at offboarding |
| `alert_targets` | Phone numbers and e-mail addresses for approval alerts | Personal: contact | Contract (b) | Until removed | Removed by an owner; deleted at offboarding |
| `alert_deliveries` | Each alert sent: masked target, status | Personal (masked) | Contract (b) | Until the purge | Mask replaced by `[removed]` at offboarding; deleted at the purge |
| `chat_hooks` | Slack and Teams incoming-webhook URLs | Contact, credential | Contract (b) | Until removed | Removed by an owner; deleted at offboarding |
| `exports` + R2 `exports/<company>/<export>/` | Staged exports: everything the company holds, in parts | Everything above | Contract (b) (data portability, GDPR Article 20) | A day | `sweepExports` (daily, and before each new export) |
| `export_links_used` | Spent download links (a nonce) | Technical | Security (f) | 15 minutes | `sweepExports` |
| `security_events` | The company's own security events: who (an id), what, when | Security | Security (f) | Until the purge | `purgeExpired` |
| `security_log` | The platform's security log: kind, company id, actor id, network (IP cut to its network), route, status | Personal: online identifiers | Security (f) | A year; a database trigger refuses an earlier delete | `pruneSecurityLog` (daily) |
| `rate_hits` | Request counters per key, person or network | Online identifiers | Security (f) | A day | `purgeExpired`'s housekeeping |
| `push_log`, `runner_health` | Pushes from the runner and its health reports | Technical | Contract (b) | Until the purge | `purgeExpired` |
| `authority_maps` | The runner's authority map as last pushed: per agent what it may pay and what needs the CFO (agent names, limits, payee kinds; an outside agent's display name) | Financial summary | Contract (b) | Until the purge | `purgeExpired` |
| `compliance_summaries` | The runner's compliance evidence in short as last pushed: counts per framework and per control for the last 30 days, and the control map's gaps (no audit row, subject or payload; no personal data) | Technical | Contract (b) | Until the purge | `purgeExpired` |
| `storage_use` | The company's stored bytes and files | Technical | Contract (b) | Until the purge | `purgeExpired` |
| `engine_companies`, `autopilot_runs` | Which companies run the nightly autopilot; its digests | Financial summary | Contract (b) | 90 days; a purged company's at once | `pruneAutopilot` |

### Hands-on demo (`/try`)

Visitors' test companies hold made-up data only.

| Table | What it holds | Retention | How it is deleted |
|---|---|---|---|
| `try_companies`, the test companies' rows and objects | Test data; the visitor's network as a salted hash | 24 hours | `sweepTry` |
| `try_salts` | The day's salt | A day | Deleted with the day |
| `try_feedback` | A choice and an optional note of up to 200 characters, no address | **No automatic deletion yet** (see [retention.md](retention.md#open-items)) | By hand |
| `try_tally`, `try_metrics`, `try_status`, `daily_counts` | Counters, no ids | 90 days (`daily_counts`) | `pruneCounts` |

## Purser Cloud: each company's engine (Durable Object)

Each company's engine runs in its own Cloudflare Durable Object, on its own SQLite database with the runner's ledger
schema (below). It holds the same bookkeeping, plus the approval passkeys (their label is the person's name). Offboarding
asks the engine to revoke every person's approval passkey first (`forgetPasskey`); the purge wipes the engine whole
(`wipe`). Its documents live in R2 under `t/<company>/vault/`.

## Purser Cloud: logs

The Worker writes one log line per request and per security event: the route, the status, the company's id, the
caller's id and the network (IP cut to its network). Never a body, a token or a name. Cloudflare's Workers Logs keep
them for the period of the account's plan (`observability` in [cloud/wrangler.jsonc](../../cloud/wrangler.jsonc)); the
owner should check that period in the Cloudflare dashboard.

## The runner (`src/`)

The runner keeps its ledger in one SQLite file (`KIT11_DB`; schema in [src/db/schema.sql](../../src/db/schema.sql) and
[src/db/ledger.sql](../../src/db/ledger.sql)) and its documents in a folder. The company that runs it is the controller
and decides how long these are kept; the statutory seven years apply to the bookkeeping in it. Personal or financial data
is in these tables:

| Tables | What they hold | Category |
|---|---|---|
| `ap_invoices`, `ap_documents`, `ap_scan_readings`, `ap_codings`, `invoices`, `receivables`, `receipts` | Invoices received and sent, their readings and codings, money received (payer, reference) | Financial; personal for sole traders |
| `beneficiaries`, `payee_adds`, `payee_changes`, `payee_name_checks` | Suppliers' bank details (name, IBAN, BIC), changes to them and the bank's name check | Financial; personal for sole traders |
| `ledger_entries`, `ledger_lines`, `ledger_locks`, `stock_items`, `stock_moves` | The general ledger | Financial |
| `audit_log` | The hash-chained audit log | Financial audit evidence |
| `proposals`, `approvals`, `cosignatures`, `passkeys`, `passkey_assertions`, `passkey_enrolments`, `passkey_pending` | Payment proposals, who approved them (name or role), passkey public keys and signatures | Financial; personal (approver) |
| `transfers`, `fx_quotes`, `fx_conversions`, `executions`, `awx_batches`, `batch_lines`, `platform_fees`, `airwallex_events` | Payouts and currency conversions at Airwallex | Financial |
| `cards`, `card_transactions`, `task_cards`, `holds`, `velocity_events` | Agents' company cards (last four digits only) and their transactions (merchant, amount) | Financial |
| `sales`, `sale_settlements`, `mandates`, `refunds`, `disputes`, `dispute_decisions`, `chain_credits`, `quarantines`, `sweeps`, `upstream_purchases` | Agent-to-agent payments on the Alta testnet: payer and payee addresses, amounts, transaction hashes | Financial; wallet addresses can be personal data |
| `external_agents`, `principals`, `tap_agents` | Outside agents and their keys | Technical |

Records written to a public blockchain (Alta's testnet) cannot be deleted by anyone. Purser writes addresses, amounts and
hashes there, never a name or an e-mail address.

## Subprocessors the code calls

Only services the code actually calls with company data are listed. "Opt-in" means the company switches it on.

| Service | What it receives | When | Where in the code | Location |
|---|---|---|---|---|
| **Cloudflare** (Workers, D1, R2, Durable Objects, Queues, Email Routing, Workers Logs, Turnstile) | Everything Purser Cloud stores and every request | Always (Turnstile: the hands-on demo only) | [cloud/wrangler.jsonc](../../cloud/wrangler.jsonc), [cloud/src/worker.ts](../../cloud/src/worker.ts) | D1 placed in western Europe (`--location weur`); R2 bucket in the EU jurisdiction; Durable Objects and logs not pinned |
| **Anthropic** (Claude API) | Invoice text and documents to read, the agents' prompts | When an API key is set (runner: `KIT11_ANTHROPIC_API_KEY`; cloud engine: `ENGINE_CLAUDE=on`) | [src/claude/reader.ts](../../src/claude/reader.ts), [cloud/src/engine/claudeAccess.ts](../../cloud/src/engine/claudeAccess.ts) | United States |
| **Airwallex** | Suppliers' names and bank details (beneficiaries), payouts, conversions; the company's account opening | When a payment runs or an account opens | [src/airwallex/](../../src/airwallex/), [cloud/src/awxPlatform.ts](../../cloud/src/awxPlatform.ts) | Sandbox today |
| **Alta (formerly Metal)** | Agent-to-agent payments: addresses, amounts | Agent payments (x402) | [src/metal/](../../src/metal/) | Public testnet: written for good |
| **Moneybird**, **Exact Online**, **Xero**, **QuickBooks Online**, **Business Central**, **Odoo**, **T:0** | Invoices, suppliers and journal entries pushed to the company's own bookkeeping package | Opt-in | [src/erp/](../../src/erp/), [cloud/src/books/](../../cloud/src/books/), [src/accounting/t0.ts](../../src/accounting/t0.ts) | The provider's |
| **Resend** (e-mail) | An approval alert's e-mail address and message (amount, payee, link) | Opt-in (alert target) | [cloud/src/alerts.ts](../../cloud/src/alerts.ts) | United States |
| **Twilio** (WhatsApp) | An approval alert's phone number and message | Opt-in (alert target) | [cloud/src/alerts.ts](../../cloud/src/alerts.ts) | United States |
| **Slack**, **Microsoft Teams** | An approval alert's message, to the company's own incoming webhook | Opt-in (chat hook) | [cloud/src/chatHooks.ts](../../cloud/src/chatHooks.ts) | The provider's |
| **Google**, **Microsoft**, **Apple** (sign-in) | A sign-in request; Purser receives the account's subject and e-mail | Opt-in (a person links an account) | [cloud/src/oidc.ts](../../cloud/src/oidc.ts) | The provider's |
| **Google Workspace**, **Microsoft 365** (Gmail, Drive, Sheets, Outlook, OneDrive) | The runner reads invoices from the company's mailbox or folder | Opt-in, runner only | [src/workplace/](../../src/workplace/), [src/vault/onedrive.ts](../../src/vault/onedrive.ts) | The provider's |

Not subprocessors of company data: ElevenLabs (used only by scripts that voice the demo film), GitHub (the code).

The repository records no data processing agreement or international transfer mechanism (such as the EU Standard
Contractual Clauses or the EU-US Data Privacy Framework) for any of these. The owner must put them in place, and list the
subprocessors in each company's agreement, before Purser holds real company data.
