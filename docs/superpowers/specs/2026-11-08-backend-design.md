# Purser Cloud: the hosted backend (design)

> **Status, 12 November 2026:** this is the design note of 8 November, kept as written. Where it says "on a branch" or
> "nothing is deployed", it describes that day. The code is now in this repository, and a hosted preview exists but is
> private (behind an access key), with no customer: [after-the-kit.md](../../after-the-kit.md).

Max, 8 November 2026: "connect to ERPs instead of building one, but collect everything in Purser; we need the backend
now." Purser keeps everything a company's finance runs on in one place, readable by its apps, its accountant and its
ERP through one API, so nobody exports a CSV again. Built on a branch that already holds the payables inbox (#107) and
the bookkeeping core (#108). Nothing is deployed before 15 November.

## Shape

- **Where it runs:** a Cloudflare Worker (`cloud/`), next to the relay that already serves the site. Relational data in
  **D1** (SQLite, created with location hint `weur`); documents (invoice PDFs, inbound e-mails) in **R2** with the
  `eu` jurisdiction. EU data stays in the EU.
- **Who writes:** the company's Purser runner (the agents, the inbox, the ledger) pushes what it records; the cloud never
  moves money and holds no payment keys. Inbound e-mail is the one thing the cloud receives itself, and it only stores
  and queues it for the runner.
- **Who reads:** people (passkey sign-in), and systems (API keys): the company's apps, its accountant, its ERP
  connectors.
- **Storage behind two interfaces** (`Sql`, `Blobs`): D1 and R2 in production; better-sqlite3 and a directory in tests,
  where the Worker's request handler runs directly, with no network.

## Tenancy

Every row carries `tenant_id`. Routes never write SQL: they use a tenant-scoped data layer, built with the tenant from
the authenticated caller, that adds `tenant_id = ?` to every read and write and whose table and column names are a
fixed allowlist. Another tenant's object answers 404, exactly like a missing one. A test walks every route with tenant
A's credentials against tenant B's objects.

## Auth

- **People:** sign in with a passkey. The runner already verifies a passkey's enrolment; it pushes the credential's
  public key (x, y) to the cloud. Sign-in: the cloud issues a one-time challenge, verifies the assertion in the Worker
  (WebCrypto, `worker/src/webauthn.ts`, the code the relay already uses) and returns a session token: HMAC-SHA-256
  signed, 15 minutes, carrying tenant, user and role.
- **Roles:** owner, cfo, accountant, viewer. All may read; only the owner manages keys, exports and erasure.
- **Systems:** API keys per tenant (`pck_<id>_<secret>`), shown once, stored as a SHA-256 hash, scopes `read`, `sync`,
  `admin`; revocable; last use recorded.
- **Rate limits:** per key or session, a fixed window stored in D1.
- **Creating a tenant:** a platform admin token (a Worker secret) creates a tenant and its first owner key.

## Sync (runner to cloud)

`POST /v1/sync` with a batch of canonical objects: vendors, payables invoices, documents (bytes with their SHA-256),
ledger entries, payments, audit rows, passkey credentials. Idempotent: the same object again changes nothing.

- Ledger entries and audit rows are append-only. A batch must continue the cloud's chain (next sequence number, the
  previous hash equal to the cloud's head), and every hash is recomputed with the same formula the runner uses. A
  posted entry or row that comes back changed is refused (409): corrections go in as new, reversing entries.
- Vendors, invoices and payments change status over time; a new version replaces the current one, and every earlier
  version is kept in an append-only history.
- A document is accepted only when its bytes hash to the SHA-256 it is sent under.

## Read API

JSON only, `/v1/...`: invoices (filter by status and dates, paginated with a cursor), one invoice and its document,
vendors, ledger entries, reports (trial balance, profit and loss, balance sheet, the Dutch VAT overview per quarter),
insight (open, due, overdue, blocked, spend per supplier). An OpenAPI document at `/v1/openapi.json`; a test holds it to
the router, route for route.

## Inbound e-mail

Cloudflare Email Routing hands each message for `<tenant-slug>@<domain>` to the Worker's `email` handler. It stores the
raw message in R2 and queues it; an unknown address is rejected. The runner pulls queued mail
(`GET /v1/mail`), files it through the inbox (`ingestEmail`), and acknowledges it. No domain is configured yet.

## Privacy and retention

- **Export:** the owner downloads everything the tenant holds: every table as JSON and every document.
- **Erasure:** a person's personal data (name, e-mail, passkeys, sessions, keys they created) is erased on request.
  Bookkeeping records (invoices, ledger, payments, documents) are kept for the seven years Dutch law requires
  (Article 52 AWR), counted from the end of the year they belong to; a closed tenant's records are purged only after
  that, by the scheduled job.

## Not in this step

Deploying; a web app beyond the JSON API; ERP connectors (their own branch); billing; per-row encryption beyond what D1
and R2 give; SSO.
