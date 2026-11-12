# Purser Cloud

One place for everything a company's finance runs on: supplier invoices and their documents, suppliers, payments, the
ledger, its reports and the audit log. The company's apps, its accountant and its ERP read it through one JSON API, so
nobody exports a CSV. Design: [the spec](superpowers/specs/2026-11-08-backend-design.md). **Not deployed yet; test
money only.**

## How it fits

```
 suppliers' e-mail ──► Cloudflare Email Routing ──► Purser Cloud (Worker) ◄── apps, accountant, ERP connectors
                                                      │  D1 (EU): data                        (API keys / passkeys)
                                                      │  R2 (EU): documents, e-mails
                                                      ▲
                     the company's Purser runner ─────┘  push (POST /v1/sync), pull mail (GET /v1/mail)
                     (agents, inbox, ledger; the only part that touches Airwallex and Metal)
```

- The cloud never moves money and holds no payment keys. The runner keeps doing that, with the CFO's Face ID.
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
  `limit` is 1 to 200 (default 50). Every list pages this way.
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

## Public demo mode

For showing the product without an account: a deployment of its own, with its own D1 database and R2 bucket that hold
seeded test companies and nothing else. Two variables switch it on: `DEMO_PUBLIC` set to `on`, and `DEMO_SLUGS`, the demo
companies' addresses separated by commas. With `DEMO_PUBLIC` unset (every other deployment) no demo route exists and
nothing on this page changes. **Not deployed yet.** The code is `cloud/src/demo.ts`; the gate is `demoRoute` in
`cloud/src/app.ts`.

In demo mode there is one caller, an anonymous read-only visitor, and only this answers:

| Endpoint | What it does |
|---|---|
| `GET /v1/demo/companies` | The demo companies in the configured order: `slug`, `name`, `language` and counts from their rows (invoices, paid invoices, suppliers, payments, transactions, documents, ledger entries). Says `test_world` and `read_only`. |
| `GET /v1/demo/{company}/…` | A demo company's reads, with the same answers as the routes above: `me`, `invoices`, `invoices/{id}`, `invoices/{id}/document`, `vendors`, `payments`, `transactions`, `transactions/summary`, `transactions/export.csv`, `transactions/{id}`, `ledger/entries`, `reports/{name}`, `insights`, `documents/{sha256}`. `me` answers `kind: "demo"`. |
| `GET /v1/health`, `GET /v1/openapi.json` | As above; the OpenAPI document lists the demo's own routes only. |

- **Everything else is off.** Every other method, and every route that signs in, enrols a passkey, recovers an owner,
  makes a key, pushes, administers, exports or takes mail answers `403` with the code `demo_read_only`. The platform
  admin routes are off too. Keys, sessions and the platform token are never looked at, so nothing in a request changes
  who is asking. The e-mail handler refuses every message and the scheduled job does nothing.
- **A company that is not on the list does not exist.** It answers `404` exactly like an address nobody has, whatever
  is asked of it.
- **Nothing is written.** No schema script, no rate counters, no last-used stamps: the database must hold the schema
  and the seed before the demo is switched on. A demo deployment needs no secret (`SESSION_SECRET`,
  `ADMIN_TOKEN_SHA256`); `MAIL_DOMAIN` is ignored.
- **Cost and abuse.** Each address gets 300 requests a minute and each isolate makes at most 600 uncached reads a
  minute, both counted in memory (`429`, with `retry-after`). A good answer is remembered for 300 seconds in the
  isolate's memory and, where the deployment has one, in Cloudflare's edge cache; browsers may keep it for 60 seconds
  (`cache-control: public`), a document by its hash for 86400 seconds (a day), the health check for 30 seconds. The
  limits are per isolate: a rate rule at Cloudflare in front of the Worker is still the real bound. Not checked against
  Cloudflare's documentation in this session (no external calls): whether the edge cache stores anything on a
  `workers.dev` address. The header `x-purser-cache` (`miss`, `hit`, `edge`) shows where an answer came from.
- **Documents** go out with the content type of their stored type when it is PDF, PNG, JPEG, plain text, CSV or JSON,
  and as plain bytes otherwise; never sniffed, always as a download, under a policy that runs no script, and never
  larger than 5 MB.

`test/cloud-demo.test.ts` builds a real pushed world with one company that is not a demo company, then walks every
route in the route table in demo mode: only the reads above answer, only for the demo companies, nothing is written and
no answer carries a secret, a key hash, a session or a person's name. `test/cloud-demo-worker.test.ts` covers the
Worker's entry (variables, e-mail, the scheduled job). Both also run on local D1.

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
5. **Deploy** (after 15 November, on Max's word): `npm run cloud:pdfjs` (copies pdf.js into `cloud/public`, the Worker's static assets, so the console can draw an invoice; without it the console offers the download only), then `npx wrangler deploy -c cloud/wrangler.jsonc`.

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
5. **An independent security review** of this branch after these fixes, and a red-team run against a deployed staging copy.

## Not done yet

- Never deployed; tested only through the Worker's own handler over SQLite and a folder (`test/cloud-*.test.ts`).
- No web app beyond the JSON API; the enrolment flow is API-only (a client registers the passkey, then signs the
  enrolment's secret with it).
- ERP connectors live on their own branch; billing, SSO and per-row encryption beyond D1's and R2's are not built.
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
