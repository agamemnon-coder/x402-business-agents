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

`GET /v1/openapi.json` describes every route; the table in `cloud/src/app.ts` is its source. The main ones:

| Route | Who | What |
|---|---|---|
| `POST /v1/admin/tenants` | platform admin | create a company and its first owner key (shown once) |
| `POST /v1/auth/challenge`, `POST /v1/auth/login` | anyone | passkey sign-in → a 15-minute session |
| `GET /v1/invoices`, `/v1/invoices/{id}`, `/v1/invoices/{id}/document` | read | invoices, versions, the PDF |
| `GET /v1/vendors`, `/v1/payments`, `/v1/ledger/entries` | read | paginated (`limit`, `cursor`) |
| `GET /v1/reports/{trial,pnl,balance,vat,payables,receivables}` | read | computed from the ledger with the runner's own report code |
| `GET /v1/insights` | read | open, due, overdue, waiting, blocked, spend per supplier |
| `POST /v1/sync`, `GET /v1/sync/state` | sync | the runner's push |
| `GET /v1/mail`, `/v1/mail/{id}/raw`, `POST /v1/mail/{id}/done` | sync | inbound e-mail for the runner |
| `GET/POST /v1/keys`, `DELETE /v1/keys/{id}` | admin | API keys (scopes `read`, `sync`, `admin`) |
| `GET/POST /v1/users`, `POST /v1/users/{id}/erase` | admin | people and roles (owner, cfo, accountant, viewer) |
| `GET /v1/export`, `POST /v1/close` | admin | take everything out; close the account |

From the runner: `npm run cloud -- push` and `npm run cloud -- mail`, with `PURSER_CLOUD_URL` and `PURSER_CLOUD_KEY`
(a key with the `sync` scope) in the environment, and `PURSER_CLOUD_PEOPLE` mapping each passkey's label to the cloud
person it belongs to.

## Privacy and retention

- **Export:** `GET /v1/export` returns every table and every document. No secret leaves, not even a key's hash.
- **Erasure:** `POST /v1/users/{id}/erase` replaces the person's name and e-mail, removes their passkeys and revokes the
  keys they made. The bookkeeping records stay: Dutch law keeps them for seven years (Article 52 AWR).
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
5. **Deploy** (after 15 November, on Max's word): `npx wrangler deploy -c cloud/wrangler.jsonc`.

## Not done yet

- Never deployed; tested only through the Worker's own handler over SQLite and a folder (`test/cloud-*.test.ts`).
- No web app beyond the JSON API; passkeys are enrolled on the runner and pushed, not enrolled in the cloud.
- ERP connectors live on their own branch; billing, SSO and per-row encryption beyond D1's and R2's are not built.
- Exports and reports per company are read in one piece; very large companies would need streaming.
