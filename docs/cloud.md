# Purser Cloud

One place for everything a company's finance runs on: supplier invoices and their documents, suppliers, payments, the
ledger, its reports and the audit log. The company's apps, its accountant and its ERP read it through one JSON API, so
nobody exports a CSV. Design: [the spec](superpowers/specs/2026-11-08-backend-design.md). **A hosted preview exists but is
private (behind an access key); no customer uses it. Not ready for real money: test money only.** What is missing
before real money: [go-live.md](go-live.md).

## How it fits

```
 suppliers' e-mail ──► Cloudflare Email Routing ──► Purser Cloud (Worker) ◄── apps, accountant, ERP connectors
                                                      │  D1 (EU): data                        (API keys / passkeys)
                                                      │  R2 (EU): documents, e-mails
                                                      ▲
                     the company's Purser runner ─────┘  push (POST /v1/sync), pull mail (GET /v1/mail)
                     (agents, inbox, ledger; the only part that touches Airwallex and Metal)
```

- Purser Cloud moves no real money. Its hands-on deployment runs the engine on test money and a simulated bank. A company's real payments stay with its runner and the
  CFO's Face ID.
- Every row carries the company (`tenant_id`); routes only reach data through a tenant-scoped layer
  (`cloud/src/tenant.ts`), and a test tries every route against another company's objects.
- Pushes are idempotent. Ledger entries and audit rows are append-only and their hash chains are recomputed on
  arrival; a posted record that comes back changed is refused. Invoices, suppliers and payments keep every version.

## The API

`GET /v1/openapi.json` is the machine-readable form; the route table in `cloud/src/app.ts` is the source of both it and
the reference below (`test/cloud-docs.test.ts` fails when an endpoint is missing here).

### Conventions

- **Authentication:** `Authorization: Bearer <key or session>`. An API key (`pck_…`) carries scopes `read`, `sync`,
  `admin`; a passkey session (`pcs.…`, 15 minutes) carries the person's role. "Needs" below is the scope a route asks for.
- **Lists** answer `{ "items": [...], "next_cursor": "…" | null }`. Ask for the next page with `?cursor=<next_cursor>`;
  `limit` is 1 to 200 (default 50). Every list pages this way, except the engine's (`/v1/engine`): its invoices and
  archive files come whole, and its events page with `?after=<seq>` and `next`.
- **Errors** always have one shape, `{ "error": "<a sentence for a person>", "code": "<stable, for a program>" }`:

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | a body or filter that does not fit (the sentence says which) |
| 401 | `unauthorized` | no key or session, or one that is unknown, expired or revoked |
| 403 | `forbidden` | a key or role without the scope the route needs |
| 404 | `not_found` | no such object, also another company's object (never "exists but not yours") |
| 405 | `method_not_allowed` | the route exists with another method |
| 409 | `conflict` | a pushed record that changed after it was posted, a taken address, an erasure that is refused |
| 422 | `unprocessable` | a push that names a document the cloud does not hold, or does not balance |
| 429 | `rate_limited` | too many requests or failed sign-ins; wait a minute |
| 500 | `internal` | the sentence carries a reference to find the error in the log; nothing internal leaks |

### Endpoints

| Endpoint | Needs | What it does |
|---|---|---|
| `GET /v1/health` | anyone | For an uptime monitor: `{ ok, version, d1, r2, mail_queued }`; 503 when the database or the document store does not answer. No company's data. |
| `GET /v1/status` | admin | The company's status for its owners: last runner push, mail queue (queued, refused, done), today's mail quota use, the runner's alert codes, the webhook's delivery state. |
| `POST /v1/health/report` | sync | The runner reports its health: alert codes and severities only (any words are dropped). Alerts raised or cleared since the last report are sent to the webhook. |
| `GET /v1/integrations` | admin | Where the accounting link (Moneybird) stands: not_connected, connected or attention; last sync, sent, failed, waiting for a person, the newest failure. From the runner's ERP sync results in the audit log; never a token (docs/moneybird.md). |
| `GET /v1/webhook` | admin | The alert webhook: URL, failures in a row, last attempt and status, when it was turned off. Never its secret. |
| `POST /v1/webhook` | admin | Set the alert webhook (https, a public host name, port 443, no credentials); returns the signing secret once. |
| `DELETE /v1/webhook` | admin | Remove the alert webhook. |
| `GET /v1/airwallex/account` | admin | The company's Airwallex account opened through Purser as a platform: its id and onboarding status; `switched_on: false` when the cloud does not offer it ([airwallex-platform.md](airwallex-platform.md)). |
| `POST /v1/airwallex/account` | admin | Open that account (a signed-in owner only, after agreeing to Airwallex's terms): `business_name`, `country_code`, `email`, `agreed: true`. One per company; 404 when not switched on. |
| `POST /v1/airwallex/onboarding-link` | admin | Airwallex's hosted onboarding link for the company's checks (a signed-in owner only); short-lived and never stored. |
| `GET /v1/airwallex/binding` | sync | The company's binding to its own Airwallex account (tenant, account id, status, name, Purser's fee account), signed with Purser's platform Ed25519 key for an hour. The runner fetches it on every sync and pays only from the account in it while it is active (docs/airwallex-platform.md). 404 while there is none. |
| `POST /v1/airwallex/webhook` | anyone | Airwallex's `account.*` webhooks, signed (`x-timestamp`, `x-signature`): the account's status follows them. |
| `GET /v1/openapi.json` | anyone | This API, as OpenAPI 3.1. |
| `GET /v1/admin/companies` | platform admin | The companies on this cloud for the operator: each one's Airwallex account and status, the supplier payouts that moved and those waiting, and Purser's fees taken, from what the runners pushed (no key, no account number). The console shows it at `#/platform`. |
| `POST /v1/admin/tenants` | platform admin | Create a company and its first owner; returns the starter key once (a week, the first owner's passkey only). |
| `POST /v1/admin/tenants/{id}/recovery` | platform admin | An owner lost their passkey: after checking out of band who asks (`checked_by` says how), issue a one-time recovery key for that owner: a day long, good only for that owner's passkey enrolment. Redeemed, it removes the owner's old passkeys, ends their sessions and is spent, in the same write as the new passkey. One open recovery per company; recorded in security events and sent to the webhook. |
| `POST /v1/auth/challenge` | anyone | Start a passkey sign-in: a one-time challenge for the company. |
| `POST /v1/auth/login` | anyone | Finish a passkey sign-in; returns a 15-minute session token. |
| `POST /v1/auth/enrol` | anyone | Enrol a person's passkey with the single-use enrolment an owner started: the new passkey signs the enrolment's secret. |
| `POST /v1/auth/invite` | anyone | What an invite is for, from its secret: the company's address and name and the person; nothing is used up. |
| `POST /v1/auth/logout` | read | Sign out: every session of the signed-in person ends. |
| `GET /v1/me` | read | Who is calling: the company, and the key's scopes or the person's role; the person behind the call, whether an owner has a passkey yet, and the company's inbox address once mail is routed (the console's first run uses these). |
| `POST /v1/company` | admin | Change the company's display name (its address, the slug, stays) or the pages' language for everyone: `{ "name"?, "language"?: "nl" \| "en" }`. |
| `POST /v1/me/language` | read | The signed-in person's own language for the pages: `{ "language": "nl" \| "en" \| null }` (null follows the company's). Sessions only. |
| `GET /v1/invoices` | read | Supplier invoices; filter by status, due_from, due_to; paginated (limit, cursor). |
| `GET /v1/invoices/{id}` | read | One invoice, with its earlier versions. |
| `GET /v1/invoices/{id}/document` | read | The invoice's document, as received. |
| `GET /v1/vendors` | read | Suppliers; paginated. |
| `GET /v1/payments` | read | Payments; paginated. |
| `GET /v1/transactions` | read | The transactions register: every money movement on every rail, newest first; filter by rail, currency, from, to, reconciliation, moved; paginated (limit, cursor). |
| `GET /v1/transactions/summary` | read | Totals per currency (money that moved only) and the checks: unreconciled, without approval, without booking or proof; the same filters. |
| `GET /v1/transactions/export.csv` | read | The register as CSV, the same filters; one line per movement. |
| `GET /v1/transactions/{id}` | read | One movement, with its earlier versions. |
| `GET /v1/ledger/entries` | read | Ledger entries with their lines; filter by from, to; paginated. |
| `GET /v1/reports/{name}` | read | trial, pnl, balance, vat (?quarter=2026Q4), payables, receivables: computed from the ledger. |
| `GET /v1/insights` | read | Payables at a glance: open, due, overdue, waiting, blocked, spend per supplier. |
| `GET /v1/documents/{sha256}` | read | A document the company holds, by its SHA-256 (the export lists them). |
| `POST /v1/sync` | sync | The runner's push: vendors, invoices, documents, payments, the transactions register, ledger entries, audit rows. Idempotent. Never passkeys. |
| `GET /v1/sync/state` | sync | Where the cloud's copy stands: the heads of the audit and ledger chains, and the documents it holds. |
| `GET /v1/mail` | sync | Inbound e-mail waiting for the runner; paginated (limit, cursor). |
| `GET /v1/mail/{id}/raw` | sync | One inbound e-mail, raw (RFC 822). |
| `POST /v1/mail/{id}/done` | sync | The runner filed (done) or refused an inbound e-mail. |
| `GET /v1/security/events` | admin | What happened to the company's access: owner recoveries issued and completed, staged exports made and downloaded (newest last). |
| `GET /v1/keys` | admin | The company's API keys (never their secrets); paginated (limit, cursor). |
| `POST /v1/keys` | admin | A new API key; returned once. A key made by a key never has more scope or a later expiry than it. |
| `DELETE /v1/keys/{id}` | admin | Revoke an API key, and every key it made down the chain (`also_revoked`). |
| `GET /v1/users` | admin | The company's people and their roles; paginated (limit, cursor). |
| `GET /v1/users/{id}/passkeys` | admin | A person's passkeys (their ids and when each was enrolled). |
| `DELETE /v1/users/{id}/passkeys/{credential}` | admin | Remove a passkey (a signed-in owner only): it signs in no more, and the person's sessions end. Never the last owner passkey. |
| `POST /v1/users/{id}/enrolment` | admin | Start a person's passkey enrolment: a single-use secret for 30 minutes (an owner's passkey: a signed-in owner only, once any owner has one). |
| `POST /v1/users` | admin | Add a person (owner, cfo, accountant, viewer); they then enrol a passkey with an enrolment an owner starts. |
| `POST /v1/users/{id}/erase` | admin | Erase a person's personal data (bookkeeping records are kept for 7 years). |
| `GET /v1/export` | admin | Everything the cloud holds for the company; documents listed, each fetched from /v1/documents/{sha256}. Needs admin and read. |
| `POST /v1/export/staged` | admin | Build the company's export into the store in parts (one at a time, kept a day); returns a 15-minute signed link to its manifest, which needs no key. Needs admin and read. |
| `GET /v1/export/staged/{id}` | admin | A staged export's state, with a fresh 15-minute link to its manifest while it is ready. Needs admin and read. |
| `GET /v1/export/download/{id}/{part}` | anyone | With its signed link only: one part (or the manifest) of a staged export, by its signed link (no key); the manifest carries a signed link per part. |
| `POST /v1/close` | admin | Close the company's account: access ends; records are kept until the retention day, then purged. |
| `GET /v1/engine` | read | Where the company's engine stands: `mode` (`test_money`), the approval passkey, the stand-in bank's balances, whether both chains verify, who reads (`reader`: `claude` under the caps or `parser`), who decides (`agents`: `code` until the agents join), and what this company's Claude calls cost so far against its cap (`spent_micros`, `cap_micros`, micro-USD at list price). |
| `POST /v1/engine/documents` | admin | Upload a supplier invoice: `{ filename, mime?, base64 }`, at most 15 MB once decoded (22,000,000 bytes of body). Filed, read and checked; answers `{ kind, sha256, invoice }`, or 400 with the inbox's reason when it refuses the file (not a PDF, too large). |
| `GET /v1/engine/invoices` | read | The engine's invoices: status, whether it can be paid, what the checks found, its proposal; `{ items }`. |
| `POST /v1/engine/invoices/{id}/pay` | admin | File the invoice's payment for approval: `{ proposal }`, or 409 with the engine's reason; 404 for an invoice the company's engine does not hold. Nothing is paid before the approval. |
| `GET /v1/engine/proposals/{id}` | read | One proposal: the hash of its exact terms, the challenge a passkey signs, the facts a person reads; `{ proposal }`. |
| `POST /v1/engine/passkey/start` | admin | A session only, never a key. Start the signed-in person's approval passkey: `{ challenge, code, rp, user, exclude }`. |
| `POST /v1/engine/passkey/finish` | admin | A session only. `{ code, credential }`: the new passkey, labelled with the signed-in person's name; answers `{ credential_id }`, or 409 with the engine's reason when refused. |
| `POST /v1/engine/proposals/{id}/approve` | admin | A session only. `{ terms_sha256, credential }`: the passkey's signature over the proposal's challenge. Answers `{ status, message, settled }`; only `approved` pays, on the stand-in bank. For a test company of the hands-on demo the approval is stored and the payment held (`{ status: "approved", message, settled: null, held: true }`): it is paid through `POST /v1/engine/proposals/{id}/pay`. A `terms_sha256` other than the proposal's is refused before the signature is read. 404 for a proposal the company's engine does not hold. |
| `POST /v1/engine/proposals/{id}/retry` | admin | Try again: a payment that was approved but whose execution failed (the stand-in bank was away, say) is run once more by the executor's own resume path, which looks a payout written before the failure up by its request id and never pays twice. Answers `{ status: "retried", message, settled }`; 409 with the engine's reason when there is nothing to retry (paid, never approved, refused); 404 for a proposal the company's engine does not hold. |
| `POST /v1/engine/sync` | admin | Follow the payments, book, archive and feed the read model again; safe to repeat. |
| `GET /v1/engine/events` | read | What the engine did, oldest first: `?after=<seq>&limit=<1 to 200>`; `{ items, next }`. At most 2 reads a second per company, counted in its object: past that 429 `{ error, code: "slow_down", retry_ms }`. |
| `GET /v1/engine/vault` | read | The archive's files as its indexes list them: `{ files }`. |
| `GET /v1/engine/vault/file` | read | One file of the archive, `?path=` as the list gives it; 404 for a path the index does not list. |
| `GET /v1/autopilot` | read | The company's nightly autopilot runs, newest first (`?limit=` 1 to 90, default 14): each night the engine is synced and a digest written (invoices by status, the overdue ones, payments waiting for an approval, both hash chains). It never pays. 404 when the cloud runs no engine. See [Cloudflare's platform](#cloudflares-platform-cloudsrcedge). |
| `GET /v1/stats` | anyone | The cloud's own counters per day, UTC, across every company, with no company's id or amount (`?days=` 1 to 90, default 14): requests, refused, rate_limited, errors, uploads, payments_filed, approvals, engine_refusals. 404 when the counters are off. |
| `GET /v1/engine/samples` | read | The hands-on demo's sample invoices (test invoices, fake), in the tray's order: `{ items: [{ key, title, filename }] }`. Each title says what the visitor does, never what the engine will answer. |
| `POST /v1/engine/samples/{key}` | admin | A sample through the engine's inbox, as an upload of its PDF; answers as `POST /v1/engine/documents`. 404 for a key that is not a sample; 400 in the engine's words when refused (a test company holds at most 8 documents, whatever route brings them). |
| `GET /v1/engine/suppliers` | read | The suppliers the company has on file, as the engine's seed recorded them: `{ items: [{ key, name, iban, bic }] }`. Their IBANs are published test IBANs, not anyone's account. |
| `POST /v1/engine/compose` | admin | "Write your own" (a test company of the hands-on demo only): `{ supplier_key, invoice_no, amount, issue_date, due_date, iban }`, checked (EUR 1.00 to 5,000.00 with two decimals; dates within 60 days of today; an IBAN with a valid mod-97 check), written in the sample's layout, rendered to a PDF inside the engine and filed through its inbox. Answers as `POST /v1/engine/documents`; a refused field is 400 `{ code, message, field }`. The typed text stays in the company's own ledger and is never logged. |
| `GET /v1/engine/proposals/{id}/terms` | read | A proposal's exact terms as the passkey signs them: `{ proposal_id, status, terms, canonical, terms_sha256, approved, expires_at }` (the canonical JSON and its SHA-256, the signature's challenge). |
| `POST /v1/engine/proposals/{id}/pay` | admin | The hands-on demo's one pay route (a test company only; at most 8 KB, 30 a company): `{ terms, credential }`, the terms to pay (only `amount`, `beneficiary_name` and `iban_last4` may differ from the signed ones, else 400) with the signature the browser made at the approval. Two layers answer, always both: the product's verifier on that signature over the sent terms, and the executor's own gate asked with the sent terms written into the payment instruction, inside a transaction that is always rolled back. Only when both say yes is the held payment run, from the stored terms, on the simulated bank (test money). Answers `{ outcome, layers, signed_sha256, sent_sha256, changed, transfers_before, transfers_after, sandbox_calls, settled, request_id }`; `outcome` is `paid`, `refused`, `paid_once`, `not_signed`, `expired` or `failed` (the retry route runs a failed one again). |
| `GET /v1/engine/export` | read | The company in the product's sync format, as a file (`purser-test-company.json`): `{ format: "purser.cloud-sync/v1", company, made_at, batches }`, the batches a runner's push sends (the invoices with their documents, payments, transactions, the ledger and the audit log). No archive files. At most 5 MB; a test company may download it 5 times. |
| `POST /v1/try/start` | anyone | The hands-on deployment only (`HANDS_ON=on`; 404 elsewhere). A test company of your own on the engine, test money on a simulated bank, deleted after 24 hours: `{ token? }` (an event or jury token). Answers 201 `{ tenant, session, visitor_token, expires_at, session_expires_at, company, pool, mode }`; 429 `{ code: "limit" }` past a limit (per keyed address and per pool and day); 503 `{ code: "paused" }` while the switch `starts` is off. Like the renewal and every write of a test company, it must carry this site's `Origin` (the demo's own page); a program without one gets 403. |
| `POST /v1/try/session` | anyone | The hands-on deployment only. `{ tenant_id, visitor_token }`: a fresh 15-minute session for that test company; `{ session, expires_at, company_expires_at }`, or 410 `{ code: "gone" }` once it was deleted. Limited per company (30 a minute), never per address. |
| `POST /v1/try/admin` | platform admin | The hands-on deployment's controls: `{ op: "get" }` (the switches, today's counters), `{ op: "set", key, value }` (one switch, refused past its ceiling; logged without the token), `{ op: "token", pool, until }` (an event or jury token, shown once; only its hash is kept). |

The `/v1/engine` routes are the company's engine behind the API (`cloud/src/engine/routes.ts`): the same inbox, checks,
approval and executor a runner has, on **test money only** (a stand-in bank; no payment reaches a real bank). The
company is always the caller's own. The deploy's entry point is `cloud/src/entry.ts` (the Worker and the engine's
Durable Object, `CompanyEngine`). The routes answer 404 unless the Worker has the `ENGINE` binding and the var
`ENGINE_MODE=test_money`. With both, each company's engine runs in its own Durable Object on its own SQLite
(`cloud/src/engine/object.ts`), which keeps its ledger, its documents and its stand-in bank. The engine in
`cloud/src/engine/node.ts` keeps each ledger in memory and is used by the tests only. With the var `ENGINE_CLAUDE=on`,
the key and the owner's switches, the engine reads with Claude under hard caps (`cloud/src/engine/claudeAccess.ts`,
`cloud/src/engine/spend.ts`); otherwise the parser reads. A reading's row carries the model and its cost; its request id
is present in live records, and null when the SDK runs over a stand-in fetch (the tests).

A deployment without R2 leaves the `DOCS` binding out (`cloud/wrangler.try.jsonc`, the engine's deployment of its own,
`purser-try`). The Worker then keeps every document it would put in R2 (the read model's documents, the archive under
`t/<company>/vault/`, e-mails, staged exports) in D1 instead, in the tables `cloud_blobs` and `cloud_blob_parts`
(`cloud/src/blobsSql.ts`): base64 in parts of 600,000 bytes, a document's header row written after its last part, so a
write that fails half way leaves nothing to read. `GET /v1/health` then reports the D1 store under `r2`.

### The transactions register

`GET /v1/transactions` lists every money movement the runner knows, on every rail, newest first. The runner derives the
register from the rails' own records (`src/money/register.ts`) and pushes it with `npm run cloud -- push`, after
bringing its ledger up to date, so each row arrives reconciled against the books.

| Filter | Values |
|---|---|
| `rail` | `airwallex_transfer`, `airwallex_fx`, `airwallex_card`, `airwallex_airi`, `airwallex_receipt`, `metal`, `metal_clearing` |
| `currency` | `EUR`, `USD`, `GBP`, `USDZ` (Metal testnet) … |
| `from`, `to` | days, `2026-11-01` |
| `reconciliation` | `matched`, `missing_booking`, `missing_rail_record`, `amount_mismatch`, `not_applicable` |
| `moved` | `true` (money moved) or `false` (refused, declined, failed, aborted: never counted) |

A row: `id`, `at`, `direction` (`in`, `out`, `internal`) and `flow` (`in` or `out` of the account it touched), `rail`,
`description`, `counterparty`, `counterparty_account` (last four only), `amount`, `currency`, `eur_equivalent` (only
when a euro amount is recorded), `fee`, `moved`, `status_words`, `invoice` (the inbox id and the supplier's own number),
`approval` (the authority, the proposal, decision, method, when, the signed terms hash), `booking` (the ledger entries,
their accounts and what their bank lines add up to), `proof` (the Airwallex id or the transaction hash),
`reconciliation` and `flags` (`no_approval`, `no_booking`, `no_proof`, `amount_mismatch`, `booked_not_moved`).

`GET /v1/transactions/summary` gives totals per currency of money that moved only (in, out, between own accounts, fees)
and the checks: movements not reconciled, without approval, without booking or proof. `GET /v1/transactions/export.csv`
is the same rows as CSV (cells a spreadsheet would read as a formula start with an apostrophe). On the runner the same
register is the Transactions page of `npm run payables` (`/transactions`) and `/api/payables/transactions`.

From the runner: `npm run cloud -- push` and `npm run cloud -- mail`, with `PURSER_CLOUD_URL` and `PURSER_CLOUD_KEY`
(a key with the `sync` scope) in the environment. Set `PURSER_INBOX_ADDRESS` to the company's address
(`<slug>@<domain>`) and the payables page shows it ("Mail invoices to …"); unset, or not an e-mail address, it shows
nothing.

**Passkeys are never pushed.** A push carries bookkeeping only; a sync key cannot add a sign-in credential (security
review of 8 November: before, a sync key could push a passkey for the owner and sign in as the owner). A person enrols
in the cloud: an owner starts an enrolment (`POST /v1/users/{id}/enrolment`), hands its secret to that person, and the
person's new passkey signs that secret (`POST /v1/auth/enrol`). For a new company the starter key may start the
first owner's enrolment; once any owner has a passkey, only a signed-in owner may start another owner's.

**The starter key and invites (red team round 5).** The key the platform hands a new company is a starter key: it lasts
a week, can only say who it is, name the company and start its own owner's enrolment (anything else is 403), and the
first owner passkey revokes it in the same write. Each enrolment records who started it (a key or a signed-in person,
and whether that was a signed-in owner); when it is redeemed, the starter must still be live, and an owner's passkey
that no signed-in owner started still needs no owner to have one, both checked at commit. A new invite for a person
cancels their unused ones; revoking a key cancels the invites it (and the keys it made) started; erasing a person
cancels their own pending invites and the ones they started. Settings lists each person's passkeys; a signed-in owner
removes one, which ends that person's sessions, and the company's last owner passkey cannot be removed (checked at
commit, so two owners removing each other's at once leave one). Addresses mail systems and certificate authorities
write to (postmaster, admin, abuse, …: `RESERVED_SLUGS`) are refused, and a purged company keeps its address, never
reissued. `test/rt5-cloud.test.ts`.

**Sessions and keys end on time and on events.** A session lasts 15 minutes, and ends at once when the person signs
out, is erased or gets another role, or when the company is closed. Every key expires; erasing a person revokes every
key behind them, including keys made by their keys (each key records the person behind it, inherited down the chain).

**Throttling.** Sign-in routes are limited per address; failed keys and sessions are counted per address and, past 20
a minute, the address is turned away before any lookup. The address is Cloudflare's `cf-connecting-ip`, which the edge
sets and overwrites: behind any other proxy this header must not be trusted, and the limits would need the proxy's own.

## The console

The same Worker serves the company's console at `/` (`cloud/src/console.ts`): sign in with a passkey (no passwords),
the overview (inbox address, what is open, due, overdue, waiting and blocked, and what waits for the CFO), invoices and
each invoice (what Purser read, the checks, the timeline, the document), the transactions register with its filters and
CSV, the books (VAT overview per quarter, the journal) and, for owners, settings: people and their single-use passkey
links, API keys, and the export of everything. A new company's first run takes the starter key Purser hands over, makes
the owner's passkey, shows the inbox address and makes the runner's sync key with the one command to run; the starter
key can then be revoked from the same screen. The console reads and manages; it never pays: payments are approved on
the CFO's phone with Face ID, through the runner.

How it is kept safe: one page under a per-response nonce policy (no inline scripts, styles or handlers; `connect-src
'self'`); every value from the API is set as text, never as HTML (only the page's own icons go through `innerHTML`, and
a test holds it to that); the session is a bearer token in the tab's `sessionStorage`, gone with the tab and after 15
minutes, so there is no cookie for another site to ride on, and the Worker refuses any state change whose `Origin` is
not its own. An owner invites a person from Settings ("Add and invite", or "Invite" on a person): the Worker returns a
one-time link (its single-use secret in the URL fragment, which the browser never sends) and a QR code of it as SVG, drawn
where the link is made so the secret never goes back to a server; the page shows the code as an image, with a copy button.
It works once, for 30 minutes, in that company only (`test/cloud-console-invites.test.ts`). An invoice's PDF is drawn in a
sandboxed frame with an opaque origin (`/pdfview`, `sandbox allow-scripts` in its own policy too): the console fetches
the bytes and hands them over by `postMessage`; pdf.js, this origin's own copy from the Worker's static assets, parses
them in a worker (eval off, no XFA), draws up to six pages and stops after 15 seconds. The frame has no session, no
network but pdf.js, and cannot reach the console page; the console page parses no supplier PDF at all (red team round
5: a PDF bomb froze the tab that held the session). The download stays. `test/cloud-console.test.ts` checks the page and the routes; `test/browser/console.check.ts` runs the whole thing
in Chromium with a virtual passkey (CI, judge job).

## The hands-on deployment

`purser-try` (`cloud/wrangler.try.jsonc`, `HANDS_ON=on`) lets a visitor start a test company of their own on Purser's
real engine, from `POST /v1/try/start` (code in `cloud/src/try/`). Purser Cloud moves no real money. Its hands-on deployment runs the engine on test money and a simulated bank.

- **One object per company.** Each test company is a tenant of its own (`t_try_<16 hex>`) with one Durable Object running
  the product's engine on its own SQLite ledger: the same inbox, checks, approval and executor a runner has. The seed
  puts an opening balance of test money and two suppliers on file (their IBANs are published test IBANs); nothing else
  in a company is made up.
- **Test money on a simulated bank.** Every payment is made on a bank simulated inside the company's object. No payment
  reaches a real bank.
- **The invoice.** Five sample invoices, each chosen by what the engine answers when it reads it (`npm run cloud:samples`,
  held by `test/engine-try-world.test.ts`), or "write your own": the visitor's fields, checked, rendered to a PDF inside
  the object and filed through the inbox. At most 8 documents a company, PDF files only.
- **The held approval and the one pay route.** A test company's approval (its passkey over the SHA-256 of the exact
  terms) is stored and the payment held. `POST /v1/engine/proposals/{id}/pay` then tries the terms the visitor sends
  with the signature their browser made, through two layers that always both answer: the product's verifier on that
  signature over the sent terms, and the executor's own gate asked with the sent terms inside a transaction that is
  always rolled back. Only when both say yes is the held payment run, from the stored terms, on the simulated bank.
  A changed cent is refused by both and moves nothing (`test/engine-try-pay.test.ts`, `test/try-redteam.test.ts`).
- **Switches, pools and caps** (`POST /v1/try/admin`, table `try_switches`). Every switch fails closed: a missing row is
  off (`starts`, `claude`, `agents`, `rail_awx`, `rail_metal`, `own_upload`) or 0 (every Claude cap). Three pools:
  public, event and jury; event and jury tokens are made by the admin and kept as hashes only. Public starts are
  limited per address (an IPv6 address by its /64, kept only as a SHA-256 with a salt that changes each UTC day and is
  deleted after 48 hours) and per day; event and jury starts count against their own pool's day. Claude's spend is
  capped per action, company, address, pool and day, and in all (`cloud/src/engine/spend.ts`). A test company may call
  only the routes listed in `cloud/src/try/gate.ts`; its expired session counts against itself, never against the
  address, so one phone cannot turn away a room on the same Wi-Fi.
- **Measured limits:** in [the run record](runs/2026-11-13-engine-in-cloud.md); its numbers are not copied here.
- **The sweep.** Hourly, every company past its 24 hours is wiped: its object, its rows and its documents.
- **The export.** `GET /v1/engine/export` gives the company in the product's sync format (`purser.cloud-sync/v1`): the
  invoices with their documents, payments, transactions, the ledger and the audit log; no archive files.
- **What is not there:** real money; e-mail into a test company; the console's engine actions for a test company; a
  visitor's own file upload (switch `own_upload`, off); a live Airwallex payment (the sandbox leg is built only if its
  gate passes, and is then switched on separately).

What a public launch would still need: a bot check, WAF rate rules at Cloudflare, a budget alert on the Claude key, the
sweep watched, and a limit tested against a hostile PDF on the deployment itself.

## Tested on D1 itself

`npm run test:d1` runs the cloud's tests (`test/cloud-*.test.ts`, `test/rt4-cloud-*.test.ts`, the credit-netting test) on
local D1: each test gets a fresh database in workerd's own D1, through the wrangler pinned in `worker/`
(`test/support/d1.ts`; `npm ci --prefix worker` first). No network and no Cloudflare account. CI runs it in the test job.
The concurrency guards (the push guard row, the chain heads, key creation and enrolment re-checked at commit, the mail
quota, two owners erasing each other) depend on D1's batch semantics: a batch is one transaction, and a failed
statement rolls the whole batch back. Both hold there. The first run on 9 November found one difference from
better-sqlite3: the rate and quota counter counted in one statement and read its total in a second, so sixty deliveries
at once all read the final total and every one was refused; it now counts and reads back in one statement
(`RETURNING`).

## Privacy and retention

- **Export:** `GET /v1/export` returns every table and the list of documents to fetch; no secret leaves, not even a
  key's or an enrolment's hash. Documents come one by one, so no response has to hold a large company's files at once.
- **Staged export** (for a large company, and for a browser download): `POST /v1/export/staged` builds the same export
  into R2 under `exports/<company>/<id>/`, one table's rows per part (2,000 rows a part), each part with its SHA-256 in
  a manifest. The answer is a link to the manifest, signed (HMAC with the session secret) for that part of that export
  of that company, valid 15 minutes and needing no key; the manifest carries a signed link per part.
  `GET /v1/export/staged/{id}` gives fresh links. One export at a time per company (a second is refused with 409 while
  one is open, checked at commit), at most 512 MB (over it: 413, and nothing is kept), kept a day; then its parts are
  removed by the next request or the scheduled job and its status reads `expired`. Every staged export and every
  manifest download is in `GET /v1/security/events`. The build still runs inside the request that asks for it (one
  table in memory at a time); moving it to a queue is a later step. `joinStagedExport` (`cloud/src/restore.ts`) turns a
  staged export back into the one-object form a restore reads. Tests: `test/cloud-export-staging.test.ts`.
- **Erasure:** `POST /v1/users/{id}/erase` replaces the person's name and e-mail, removes their passkeys and revokes the
  keys they made. A staged export still open holds the person's data as it was, so the erasure ends it in the same
  write (its links stop working, its parts leave the store, and the owners see `export.ended_by_erasure`); an export
  being built at that moment is not kept. Every part fetched through a signed link is recorded (`export.part_downloaded`). The bookkeeping records stay: Dutch law keeps them for seven years (Article 52 AWR).
- **Closing:** `POST /v1/close` ends access at once and sets the purge day to seven full years after the year of the
  last record. The daily job (`scheduled`) removes a closed company's rows and documents after that day, leaving a
  tombstone.

## Going live: what Max does

Nothing here needs to be in git; every secret goes through `wrangler secret put`.

1. **Stores, in the EU:**
   ```bash
   npx wrangler d1 create purser-cloud --location weur
   ```
   ```bash
   npx wrangler r2 bucket create purser-cloud-docs --jurisdiction eu
   ```
   Paste the D1 `database_id` into `cloud/wrangler.jsonc`, then apply the schema:
   ```bash
   npx wrangler d1 migrations apply purser-cloud --remote -c cloud/wrangler.jsonc
   ```
2. **Secrets** (each one typed at the prompt, never on the command line or in chat):
   ```bash
   npx wrangler secret put SESSION_SECRET -c cloud/wrangler.jsonc
   ```
   ```bash
   npx wrangler secret put ADMIN_TOKEN_SHA256 -c cloud/wrangler.jsonc
   ```
   `SESSION_SECRET` is 48 or more random characters. `ADMIN_TOKEN_SHA256` is the SHA-256 (hex) of a platform admin token
   that Max keeps in a password manager.
3. **An address:** a domain on Cloudflare (for example `cloud.<domain>`) as the Worker's route; set `RP_ID` and `ORIGIN`
   in `cloud/wrangler.jsonc` to it (passkeys are bound to it).
4. **E-mail:** in the Cloudflare dashboard, Email Routing for a mail domain (for example `in.<domain>`), a catch-all
   rule "Send to a Worker: purser-cloud", and `MAIL_DOMAIN` set to that domain. Each company is then reached at
   `<its-slug>@in.<domain>`.
5. **Deploy** (on Max's word): `npm run cloud:pdfjs` (copies pdf.js into `cloud/public`, the Worker's static assets, so the console can draw an invoice; without it the console offers the download only), then `npx wrangler deploy -c cloud/wrangler.jsonc`.
   Since the engine was merged, `cloud/wrangler.jsonc` adds the `CompanyEngine` class and its migration `v1`, which cannot
   be rolled back once deployed: it goes out only after 15 November 2026, or earlier on Max's own word.

### Deploying purser-try

`purser-try` is the engine's deployment of its own, on test money (`cloud/wrangler.try.jsonc`): never the product's
`purser-cloud` and never its stores. It has no R2 bucket, so documents and the archive are kept in its D1 database.
From the repository root, after `npm ci` and `npm ci --prefix worker`, with wrangler logged in to the account:

1. **The database** (EU), then paste its `database_id` into `cloud/wrangler.try.jsonc`:
   ```bash
   worker/node_modules/.bin/wrangler d1 create purser-try --location weur
   ```
   ```bash
   worker/node_modules/.bin/wrangler d1 migrations apply purser-try --remote -c cloud/wrangler.try.jsonc
   ```
2. **Secrets** (each typed at the prompt, never on the command line or in chat):
   ```bash
   worker/node_modules/.bin/wrangler secret put SESSION_SECRET -c cloud/wrangler.try.jsonc
   ```
   ```bash
   worker/node_modules/.bin/wrangler secret put ADMIN_TOKEN_SHA256 -c cloud/wrangler.try.jsonc
   ```
   Later, for Claude in the engine: `KIT11_ANTHROPIC_API_KEY`, the demo's own capped key, set by Max by hand the same way.
3. **Deploy:** `npm run cloud:pdfjs`, a dry run, then the deploy:
   ```bash
   worker/node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/purser-try -c cloud/wrangler.try.jsonc
   ```
   ```bash
   worker/node_modules/.bin/wrangler deploy -c cloud/wrangler.try.jsonc
   ```
4. **Smoke** (the admin token in `PURSER_ADMIN_TOKEN`, read and never printed): the cloud alone, then the engine's chain,
   then a burst with polling:
   ```bash
   npm run cloud:smoke -- https://purser-try.max-31b.workers.dev --plain
   ```
   ```bash
   npm run cloud:smoke -- https://purser-try.max-31b.workers.dev
   ```
   ```bash
   npm run cloud:smoke -- https://purser-try.max-31b.workers.dev --parallel 10 --poll 1000
   ```
   What they printed goes into [the run record](runs/2026-11-13-engine-in-cloud.md).

## Limits on what comes in

- **Inbound mail:** anyone on the internet can mail `<slug>@<domain>`, so each company's address takes at most 500
  messages and 500 MB a day (UTC), 25 MB a message; past that, mail is refused until the next day.
- **A push:** at most 50 MB, 200 documents of 16 MB, 5,000 entries and 20,000 audit rows; the same id twice, an entry
  with the same line twice, a date that is not a real day and amounts above 10^13 cents are refused (4xx, never 500).
  Documents are stored only after every check passed; a refused push leaves no bytes behind.

## Before real customer data

What the code does not do yet, and must be in place before a company's real data goes in:

1. **WAF and rate rules at Cloudflare** in front of the Worker (the code's own limits are per isolate and per address).
2. **Monitoring and alerts** on 4xx/5xx rates, failed sign-ins and the scheduled job.
3. **R2 lifecycle rules** for anything orphaned, and a check that R2 and D1 encryption at rest is on (it is by default).
4. **Sync keys bound to the runner** (Cloudflare mTLS or an IP allow-list) and short expiries for them.
5. **An independent security review** of this code after these fixes, and a red-team run against a deployed staging copy.

## Not done yet

- No production deployment: a hosted preview exists but is private (behind an access key), and no customer uses it.
  The automated tests run through the Worker's own handler over SQLite and a folder (`test/cloud-*.test.ts`) and on
  local D1 (`npm run test:d1`); none runs against a deployed copy.
- The ERP connectors (`src/erp`, [erp.md](erp.md)) run on the company's runner, not in the cloud; the cloud only shows
  where the accounting link stands (`GET /v1/integrations`). Billing, SSO and per-row encryption beyond D1's and R2's
  are not built.
- Reports per company are read in one piece; very large companies would need streaming.

## Monitoring, logs and alert webhooks

- **Uptime:** point a monitor at `GET /v1/health`. It answers 503 when D1 or R2 does not answer.
- **Logs:** one JSON object per line (`ts`, `level`, `event`, fields), a `request` line per request with the route's
  pattern, status and time. `cloud/src/log.ts` cleans every field: anything named like a secret becomes
  `[redacted]`, account numbers keep their last four characters, Purser keys, session tokens, `whsec_` secrets and
  Bearer values in text are cut, e-mail addresses keep their domain only. `test/cloud-golive.test.ts` runs a whole API
  session and scans the log for keys, tokens, invite secrets, account numbers and e-mail addresses.
- **Alert webhook:** an owner sets one URL (`POST /v1/webhook`). Each alert the runner raises or clears (via
  `POST /v1/health/report`) is POSTed as `{ id, type: "alert.raised" | "alert.cleared", created_at, alert: { code,
  severity } }` with the header `x-purser-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` under the
  secret shown once. Check the signature and that `t` is recent. Three attempts per event (a 2xx ends it), at most 30
  events an hour per company, and after 20 failed events in a row the webhook is turned off (`disabled_at`); set it
  again to turn it back on. The secret is stored to sign with; it is never shown again or exported.

## Cloudflare's platform (`cloud/src/edge`)

Three parts of Cloudflare's platform beyond D1 and the engine's Durable Objects, each in its own file and each off by
configuration. Tested with fakes (`test/cloud-edge.test.ts`) and in local workerd with `cloud/wrangler.jsonc`
(`test/cloud-edge-workerd.test.ts`, in `npm run test:d1`); none has run on a deployed Worker yet. Limits on who may
start or call what (the hands-on companies' pools, per-address and per-company limits) are not here: they are the
hands-on lane's.

| What | Cloudflare feature | Binding or setting | Off |
|---|---|---|---|
| The nightly autopilot: on the Cron Trigger's first firing each UTC day (today `17 3 * * *`; an hourly trigger changes nothing), every open company that wrote to its engine has its engine synced (payments followed, booked, archived, read model fed) and a digest written: invoices by status, the overdue ones, those due within a week, payments waiting for an approval, whether both hash chains verify. `GET /v1/autopilot`. It never makes or uses an approval. A hands-on company (`t_try_`) is never in it. | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | the existing `triggers.crons`, tables `engine_companies` and `autopilot_runs` (`cloud/migrations/0002_edge.sql`) | var `AUTOPILOT=off` |
| Inbound invoices by e-mail into the engine: the Worker's email handler stores the message as before and puts `{ tenant_id, mail_id }` on a queue; the queue's consumer files the stored e-mail through the engine's own inbox (each PDF attached is filed, read and checked) and marks the `inbound_mail` row done or refused, with a note. The sender's delivery never waits on the engine. Retried later each time (30 s, 60 s, ...), 5 attempts, then marked refused with the reason (the dead-letter state a person sees); what the inbox itself refuses is marked at once. The daily job puts e-mail still waiting after an hour on the queue again. | [Queues](https://developers.cloudflare.com/queues/) | `INBOX_QUEUE` (producer and consumer), dead-letter queue `<name>-inbox-dlq`: in `cloud/wrangler.jsonc` as a comment, to put in once the queues exist | leave the block out (mail then waits for the company's runner, as before) |
| The cloud's daily counters, counted after each answer is sent (`ctx.waitUntil`), read by the public `GET /v1/stats`: requests, refused, rate_limited, errors, uploads (a duplicate is not one), payments_filed, approvals, engine_refusals. No D1 write per request: an isolate keeps its counts in memory and writes them in one batch at most every 10 seconds, at once for an upload, a payment, an approval or an engine refusal. | Workers `waitUntil` and D1 | table `daily_counts` | var `STATS=off` |

- **The autopilot runs once per company per day.** The day's row is claimed before the run, so a Cron Trigger that
  fires twice runs it once. A run that failed, or never finished (30 minutes), is taken again by a later firing that
  day: with an hourly trigger the next hour, with a daily one not before the next day (that day then has no digest,
  and its row says why). One company's engine gets 60 seconds; a firing starts no company after 10 minutes
  (Cloudflare stops a Cron run at 15) and takes at most 100, those whose last finished run is oldest first. A run's
  error is stored in the engine's words with account numbers cut (`cloud/src/log.ts` redact). Runs are kept 90 days;
  a purged company's runs go with it, whether the autopilot is on or not.
- **Never twice, by e-mail:** only a row still `queued` is filed and it is marked once; a message that comes again
  after the engine took the e-mail finds each PDF already held (by its SHA-256) and files nothing more.
- **The counters are close, not exact:** what an isolate counted in its last seconds before Cloudflare ends it is
  lost, and a write D1 kept but answered with an error is written again. They hold no company's id, route parameter or
  amount, but on a deployment with one or two companies the day's uploads and approvals are in effect that company's
  activity.
- **Deploy steps**, after the steps under "Going live":
  ```bash
  npx wrangler d1 migrations apply purser-try --remote -c cloud/wrangler.try.jsonc
  ```
  applies `0002_edge.sql` (the Worker also creates the three tables on first use if the migration was not run). Then
  deploy as before. To check: `GET /v1/stats` answers today's counters, and a company's first digest is at
  `GET /v1/autopilot` after the Cron Trigger's next firing. The inbox queue only once a mail domain routes to the
  Worker: `npx wrangler queues create <name>-inbox`, `npx wrangler queues create <name>-inbox-dlq`, put the commented
  `queues` block of the config in, deploy.

## Backups and restore

- **A company's backup** is its export: `GET /v1/export` (admin and read) plus each document from
  `/v1/documents/{sha256}`. It holds every row of every table except secrets (API key hashes, enrolment hashes, the
  webhook secret) and the raw bytes of inbound mail.
- **Restore** with `importTenant` (`cloud/src/restore.ts`) into a new, empty company in the same or a fresh database.
  It checks both hash chains from their genesis and every document against its SHA-256 before it writes anything,
  refuses a company that already holds bookkeeping data, and rewrites the document keys to the new company. Owners then
  make new API keys and set the webhook again; mail that was still queued must be sent again.
  `test/cloud-restore.test.ts` proves the round trip: every table, every document, both chains and the reports equal,
  on better-sqlite3 and, with `npm run test:d1`, on D1.
- **No command or route runs a restore yet.** It is a library function; running it against production D1 needs a
  one-off Worker or a script with the D1 binding. That is on the go-live list (`docs/go-live.md`).
- **D1 Time Travel** (Cloudflare's point-in-time restore of a whole database) is the backup for the database as a
  whole. Not checked against Cloudflare's documentation in this session (no external calls): before go-live, read
  Cloudflare's current D1 Time Travel page for the retention window on the plan used, and rehearse one restore of a
  copy with `wrangler d1 time-travel` into a scratch database. R2 has no point-in-time restore of its own here: the
  documents are written once under their hash and never changed, and the export lists them.
