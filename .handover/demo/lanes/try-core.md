# Lane C: try core

You are the build session of lane C of the hands-on demo. Read these, in this order. All paths are in your checkout of `engine-do-1112` or a branch made from it.

1. This file.
2. `.handover/plan.md` (plan E) sections 3 and 5, and the task texts named below (plan E section 6, or `.handover/SPEC.md`). Also `.handover/RULES.md`, with lean mode.
3. Plan K is `.handover/demo/design-final.md` and `.handover/demo/tasks.json`, for the tasks that cite them.

The plan of record is `.handover/demo/plan-of-record.md`. Where this file and a source document disagree, this file wins.

## Goal

Everything a public visitor's test company needs around the engine, on the deployment `purser-try`:

- start and limits that one script or one sleepy phone cannot use to lock others out;
- three pools (public, event, jury), and switches that fail closed;
- expiry and the sweep;
- sample invoices and "write your own";
- **the one pay route**: it tries the visitor's terms with the visitor's own signature against the product's own verifier and executor, refuses a change, and pays the signed terms;
- the export in the product's sync format;
- attacks on all of it as tests;
- the claims made true;
- and, only if its gates pass, a narrow Airwallex sandbox leg after a paid payment.

## Branch, base, rules

- **Branch** `try-core-1112`, from the latest head of `engine-do-1112`. The orchestrator merges you into `engine-do-1112` after each review round; pull it before each task.
- **Test command, worktree, commit identity, no network, no secrets:** `.handover/plan.md` section 5 and `.handover/RULES.md`. Build against `testCloud({ engine: true })` (the Node engine). Workerd tests only with `CLOUD_DB=d1`.
- No real API call in any test. No secret, token, visitor token, passkey answer or account number in code, tests, fixtures or log lines.

## Neighbours

- **Lane A** (`engine-do-1112`) owns the object, `hostWorker.ts`, the caps (`src/engine/budget.ts`, `cloud/src/engine/spend.ts`, tables `try_spend` and `try_resv`) and the event allowlist. Lane A reads your switches through `readSwitches(sql)` and your scopes through `tryScopes(sql, tenantId)`: ship both first (C1).
- **Lane B** (`try-page-1112`) owns the page (`cloud/src/tryPage.ts`) and calls your routes with exactly the shapes below.
- **You own:**
  - `cloud/src/try/*`, the `/v1/try/*` route block and a block of engine routes in `cloud/src/app.ts`;
  - the try-only gate and the try cases in the router's auth catch;
  - the host methods named below in `src/engine/host.ts`, in their own section of the class;
  - two one-`if` changes in lane A's code: `hold` in `EngineHost.approve`, and `EngineDeps.maxDocuments` with its line in `cloud/src/engine/hostWorker.ts`;
  - the `cloud/src/engine/api.ts` and `node.ts` additions for them;
  - `cloud/scripts/samples.ts` and `cloud/src/engine/samples.gen.ts`;
  - the D1 tables `try_companies`, `try_switches`, `try_admin_log`, `try_rail_calls` and `try_rail_day`;
  - the docs and claims pass (C6).
- **Stream `cloud-demo-1112`** edits `cloud/src/app.ts` and `cloud/src/worker.ts`, and owns `cloud/src/demo.ts` (do not edit it). Keep your route entries in their own blocks of `ROUTES`, and your router change small and local.

## Tasks, in order

### C1 try-lifecycle (source `engine-plan:try-lifecycle`, plus switches, pools, tokens and a minimal admin API from `design-final:admission` and `admin-counters`, reduced)

As the source, with these differences.

**Switches.** `cloud/src/try/switches.ts` holds two tables, added to `cloud/migrations/0001_init.sql` and `cloud/src/schema.ts` in a block of their own:

- `try_switches (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`
- `try_admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, key TEXT NOT NULL, old TEXT, new TEXT)`

It exports `readSwitches(sql: Sql): Promise<Record<string, string>>` and `on(s: Record<string, string>, key: string): boolean` (only the value `"on"` is on). Keys and ceilings; a `set` past a ceiling is refused:

- **On or off** (a missing row is **off**): `starts`, `claude`, `agents`, `rail_awx`, `rail_metal`, `own_upload`.
- **Claude caps, in micro-dollars** (a missing row is 0):

  | Key | Ceiling |
  |---|---|
  | `cap_all_micros` | 78,000,000 |
  | `cap_day_micros_public` | 30,000,000 |
  | `cap_day_micros_event` | 30,000,000 |
  | `cap_day_micros_jury` | 30,000,000 |
  | `cap_day_micros_smoke` | 5,000,000 |
  | `cap_company_micros` | 1,000,000 |
  | `cap_addr_micros` | 3,000,000 |
  | `cap_action_micros` | 500,000 |
  | `max_inflight` | 20 |

- **Start limits:**

  | Key | Ceiling | Default when missing |
  |---|---|---|
  | `starts_per_address_hour` (public pool) | 50 | 5 |
  | `starts_per_day_public` | 2,000 | 300 |
  | `starts_per_day_event` | 2,000 | 300 |
  | `starts_per_day_jury` | 500 | 100 |

- **Rail limits** (a missing row is 0, so no calls): `awx_calls_day` (≤ 1,500), `awx_eur_day` (≤ 10,000), `metal_calls_day` (≤ 1,000).
- **`tokens`:** JSON `[{ "sha256": "<hex>", "pool": "event"|"jury", "until": "<ISO>" }]`, at most 8.

**The start: `POST /v1/try/start {token?}`** (public).

- Refused with 503 `{code: "paused"}` unless `starts` is on.
- **The pool.** A `token` whose SHA-256 is in `tokens` and not past `until` puts the company in that token's pool. Otherwise the company is public.
- **The address.** It is never stored. It is keyed as a SHA-256 with a random salt that changes each UTC day; the salt is deleted after 48 hours. Before hashing: an IPv6 address is cut to its **/64**; an IPv4 address is used whole.
- **Limits.** Public starts are limited by `starts_per_address_hour` per keyed address and by `starts_per_day_public`. Event and jury starts skip the address limit and count against their own pool's day limit.
- **Over a limit:** 429 `{code: "limit", message}`, with a sentence a person can read.
- **The answer:** `201 {tenant, session, visitor_token, expires_at, company: {name}, pool, mode: {claude, agents, rail_awx}}`. Each mode is read from the switches.
- **`try_companies`** stores `pool` and the day-keyed address hash (`addr`, null for event and jury).
- **Export:** `tryScopes(sql, tenantId): Promise<{ pool: "public"|"event"|"jury"|"smoke"; addr: string | null } | null>` from `cloud/src/try/start.ts`. An admin-made company is `smoke`. Lane A's spend ledger calls it.

**The session: `POST /v1/try/session {tenant_id, visitor_token}`** (public).

- Limited per company (30 a minute), never per address.
- A swept or expired company answers 410 `{code: "gone"}`.
- A wrong visitor token is a 401 counted per company.

**The router** (`cloud/src/app.ts`, kept to its own small blocks):

- **The try-only gate.** A caller whose tenant id starts with `t_try_` may call only the routes in `TRY_ROUTES`. Each is listed by method and path; there is no wildcard:
  - `POST /v1/auth/logout` and `GET /v1/me`;
  - the reads `GET /v1/invoices`, `GET /v1/invoices/{id}`, `GET /v1/payments`, `GET /v1/transactions`, `GET /v1/ledger/entries`;
  - the engine's `GET /v1/engine`, `GET /v1/engine/invoices`, `POST /v1/engine/invoices/{id}/pay`, `GET /v1/engine/proposals/{id}`, `POST /v1/engine/passkey/start`, `POST /v1/engine/passkey/finish`, `POST /v1/engine/proposals/{id}/approve`, `POST /v1/engine/proposals/{id}/retry` (a failed payment once more, `993efdf`), `GET /v1/engine/events`, `GET /v1/engine/vault`, `GET /v1/engine/vault/file`;
  - this lane's `GET /v1/engine/samples`, `POST /v1/engine/samples/{key}`, `GET /v1/engine/suppliers`, `POST /v1/engine/compose`, `GET /v1/engine/proposals/{id}/terms`, `POST /v1/engine/proposals/{id}/pay`, `GET /v1/engine/export`;
  - the session routes of `/v1/try/*`.

  `POST /v1/engine/documents` is allowed only while `own_upload` is on (missing means off). `POST /v1/engine/sync` is never allowed. Every other route answers 403 with code `try_only`. Nobody can sign in to, enrol in or mail a try company. An expired company answers 410. B8's stretch may add read routes later, through a reviewed change to this list.
- **A try session's 401.** A session token whose signature is valid but which has expired, or whose `t_try_` company was swept, is not counted in `authfail:<ip>`. It is counted in `authfail-tenant:<tenant>`. A room on one Wi-Fi is never turned away because one phone woke up with an old session. Forged or unknown tokens are counted per address as today, and the product's own callers are unchanged (a test).
- **Event polls.** A try session's `GET /v1/engine/events` skips the router's rate-bucket write. Lane A's object limits those reads (A3).

**The admin route: `POST /v1/try/admin`**, with `Authorization: Bearer <admin token>`, checked first with the cloud's `isPlatformAdmin` (`ADMIN_TOKEN_SHA256`). A wrong token is a plain 401 and never locks out a right one.

- `{op: "get"}` → `{switches, today: {starts_by_pool, open_companies, spent_micros_by_pool, awx_calls, metal_calls}, all_time: {spent_micros}}`. Spend is read from lane A's `try_spend` when it exists, else 0.
- `{op: "set", key, value}` refuses unknown keys and values past a ceiling. It writes `try_admin_log`, without the token.
- `{op: "token", pool, until}` makes a token of 32 random bytes, stores only its hash in `tokens`, and returns the token once.

**The sweep** (`scheduled`, hourly on `purser-try`): as the source says (wipe the object, delete the tenant's rows, remove `t/<id>/` from R2, set `wiped_at`), in batches of 50 per run. It also deletes address salts older than 48 hours, and settles lane A's reservations older than 10 minutes once `spend.ts` exists.

**Expiry:** 24 hours from start.

Tests first: the source's `test/cloud-try.test.ts` cases, plus:

- everything off with no switch rows (start 503);
- a jury token puts the company in the jury pool and skips the address limit, but not the jury day limit; an expired token does not;
- two IPv6 addresses in one /64 share one address limit;
- the try-route list: every engine and read route the page needs answers, and `POST /v1/engine/documents` gets 403 `try_only` until `own_upload` is on;
- 30 expired-session 401s from one address leave a fresh session from the same address answered, while 30 forged tokens from one address do not;
- a try session's event polls write no `rate_hits` row;
- admin get; set within and past a ceiling; an unknown key; a wrong token; a flood of 100 wrong tokens, then a right one answered 200;
- no token or visitor token in any log line (capture `logEvent`).

Done when the tests pass and `readSwitches` and `tryScopes` are merged. Lane A waits for them from Friday 00:30 UTC.

### C2 try-world (source `engine-plan:try-world`, plus "write your own" and one document cap)

As the source: five samples chosen by running them through the engine, with `expect` measured; `GET /v1/engine/samples` and `POST /v1/engine/samples/{key}`. These additions:

- **Sample order for the tray:**
  1. The clean invoice, first, so "the same file again" means something.
  2. The same file again.
  3. The renumbered copy.
  4. Changed bank details. Pick the fixture whose answer is the fraud story if there is one; otherwise `country_not_paid`, worded as the engine words it.
  5. An unknown supplier.

  Titles say what the visitor does, not what the engine will answer ("The same invoice, sent twice"), so the outcome is the engine's to tell.
- **`GET /v1/engine/suppliers`** → `{items: [{key, name, iban, bic}]}`: the suppliers the engine's `seed()` puts on file for this company. Read them from the engine; do not invent any. Their IBANs are test IBANs; say so in a comment and in `docs/cloud.md`.
- **`POST /v1/engine/compose {supplier_key, invoice_no, amount, issue_date, due_date, iban}`** (admin, a try company only).
  - **Validation:**
    - amount EUR 1.00 to 5,000.00, with two decimals;
    - `invoice_no` matches `^[A-Za-z0-9][A-Za-z0-9/-]{0,31}$`;
    - dates ISO, within 60 days of today;
    - an IBAN of 15 to 34 characters with a valid mod-97 check.
  - **Filing.** It writes the invoice's text in the same layout as the fixture the clean sample uses, renders it to a PDF inside the object with the product's PDF writer (the one the samples script uses; pdfkit already runs in the object for receipts), and files it through `upload()`.
  - **Answers.** As `POST /v1/engine/documents`. A refused field is 400 `{code, message}` naming the field.
  - **Host method:** `compose(input): Promise<UploadResult>` in your section of `EngineHost`; add it to `EngineApi` and `node.ts`.
- **One document cap per company.** `EngineDeps.maxDocuments?: number` is checked in one private helper used by `upload`, `uploadSample` and `compose`. One line in `hostWorker.ts` sets it to 8 for `t_try_` companies. Absent, Node is unchanged (a test). The ninth document is refused with the engine's sentence, whatever route brought it.
- **Privacy.** The typed text goes into this company's own ledger only. It is never sent to Claude in a prompt outside the engine's own reader, never sent to a partner, and never logged.

Tests first (`test/engine-try-world.test.ts`, Node, `parserOnly`):

- after `seed()`, every sample gives its `expect`, and the clean one goes to paid;
- a composed invoice for a supplier on file, with its own IBAN, is ready to pay;
- the same invoice with a changed IBAN gets the engine's changed-bank-details answer;
- a repeated invoice number gets the engine's duplicate answer;
- each validation refusal;
- the ninth document is refused through compose, through a sample and through upload;
- the generated samples file is up to date.

### C3 try-pay-core (new, modelled on `design-final.md` section 8.4: one endpoint for paying and for the change)

The visitor's change must go through the product's real payment path, with the visitor's own signature, and the same request must pay when the terms are the signed ones. Nothing about the refusal may be guaranteed by a route that cannot pay.

**1. The held approval.** `EngineHost.approve` gains `hold?: boolean`, one `if` after `processAssertion`. When the approval is stored and `hold` is set, the method returns `{status, message, settled: null, held: true}` without running the payment (the host's private `pay` helper). The approve route sets `hold` for a `t_try_` company; the body cannot set it. The console and admin-made companies are unchanged (a test).

**2. `terms(proposalId)` and `GET /v1/engine/proposals/{id}/terms`** (read) → `{proposal_id, status, terms, canonical, terms_sha256, approved, expires_at}`: the stored terms object, `canonicalTerms(terms)` and `termsHash(terms)` of `src/lib/terms.ts`, and whether an approval is stored.

**3. `paySigned(proposalId, sent, credential)` and `POST /v1/engine/proposals/{id}/pay {terms, credential}`** (admin, a try company only, body at most 8 KB, at most 30 a company). The whole method runs as one action of the host's queue (`act`).

1. **Shape.** `sent` must have exactly the stored terms' keys. Only `amount`, `beneficiary_name` and `iban_last4` may differ; anything else is a 400: "only the amount, the payee and the account ending can be changed here". Values are checked for shape: amount with two decimals, last4 four digits or letters, name at most 140 characters. `credential` is an `AuthenticationResponseJSON`, at most 4 KB.
2. **Hashes and counts.** `sent_sha256 = termsHash(sent)`; `signed_sha256` = the stored proposal's `terms_sha256`; `changed` = the keys whose values differ. `transfers_before` = the company's transfer count from its own records.
3. **No approval stored:** `outcome: "not_signed"`. Nothing else runs.
4. **The signature layer.** `verifyApprovalSignature(credential, sent_sha256, activePasskey, 0)` of `src/passkey/webauthn.ts`, on the credential **the browser sent**, as `reverifyPasskeyApprovals` does with counter 0. The answer is `layers.signature = {verified, reason}`. The reason is the verifier's verdict in the host's plain words: `plainRefusal`, for example `REFUSED_OTHER_TERMS` (`99c9852`). Never the WebAuthn library's sentence.
5. **The executor layer.** Inside one synchronous `db.transaction(...)` that is always rolled back (end it by throwing a private sentinel):
   - write `sent` into the proposal's `terms_json`;
   - call `beginExecution(db, proposalId)` of `src/policy/approvals.ts`, the gate every executor runs, which re-hashes the stored terms against the approved hash.

   If it throws, `layers.executor = {accepted: false, said: <its message>}`. If it returns, `{accepted: true}`. Nothing of this transaction is kept: the terms, the status and the expiry are as they were. Do not call `execute()` with changed terms. It awaits outside work before its gate, so no transaction can wrap it, and changed terms left in the row would outlive a stopped object.
6. **Pay only when both layers say yes and the proposal is approved and held** (status `APPROVED`). A proposal whose payment already failed (`FAILED`) is not run here: the answer is `outcome: "failed"`, and the page offers the engine's retry route. Then run the real executor through the host's private `pay(proposalId)` helper, which `approve` and `retry` share (`84a4961`). It calls `execute()` on the host's rails, runs the same gate again for real, and pays on the company's simulated bank from the stored terms, which are the signed ones. Then it follows, books, archives and feeds. Answer `outcome: "paid"` with `settled`. A payment that fails there can be run again through the engine's retry route.
7. **Every other outcome**, decided in this order:
   1. The proposal was already executed: `outcome: "paid_once"` if the signature layer verified (these are the signed terms, paid once), else `refused`.
   2. The executor's words say it expired: `outcome: "expired"`.
   3. Either layer said no: `outcome: "refused"`.

   Both layers' answers are always in the response.
8. **Closing counts.** `transfers_after` is read again. `sandbox_calls` is the count of `try_rail_calls` rows for this proposal written during this request. An audit row `try.pay` `{outcome, changed, signature_verified, executor_accepted}` is written, with no values, so every attempt is on the company's own record.

**The import graph.** The pay route and `paySigned` reach the company's simulated bank through the host's rails only. They import nothing from the Airwallex sandbox client (`src/rails/sandboxPayout.ts`, `cloud/src/try/rail*.ts`): an import-graph test, with `test/support/importGraph.ts`.

**4. `exportBatch()` and `GET /v1/engine/export`** (read) → the batches `batchesFor` builds from an empty cloud state (as `src/engine/feed.ts` uses it), as one JSON document `{format: "purser.cloud-sync/v1", company, made_at, batches}`. It is sent with `content-disposition: attachment; filename="purser-test-company.json"`, at most 5 MB and at most 5 a company. It holds the invoices with their documents, payments, transactions, ledger and audit log. It has no vault files, and no document may say it has.

Tests first, through HTTP on the Node engine with a software authenticator from the test helpers:

- **Held.** Approve answers `held: true` and nothing is paid. The console path still pays at once.
- **One cent more** with the approval's own credential is refused by both layers (`signature.verified: false`, the executor's message names the approved hash). It reports both hashes, `changed: ["amount"]` and `transfers_after === transfers_before`, and the proposal's stored terms are byte for byte unchanged. The same for the payee and for the account ending.
- **Then the signed terms**, through the same route, pay: `outcome: "paid"`, `transfers_after === transfers_before + 1`, invoice paid, ledger lines written. A second send answers `paid_once` and pays nothing.
- **A fresh signature over the changed terms**, made by the same authenticator, passes the signature layer, is refused by the executor layer, and moves nothing.
- **A wrong or missing credential with unchanged terms** is refused by the signature layer and pays nothing.
- **Before approval:** `not_signed`.
- **Another key changed:** a 400.
- **Another company's proposal:** 404.
- **An expired proposal:** `expired`.
- **A proposal whose payment failed:** `failed`, and nothing runs here (the retry route does that).
- **The export** parses with `SyncBatch.parse`, and `applySync` writes it into a fresh tenant of `testCloud()` whose `GET /v1/invoices` and `GET /v1/ledger/entries` match the company's.

### C4 review-fix-c1 (new)

The orchestrator runs a review of C1 to C3 with two lenses. The first is correctness and safety: tenancy, the try-route list, limits under parallel requests, the 401 handling, fail-closed switches, and the pay route's two layers and its rollback. The second is honesty and design: every answer says what ran. Fix what it finds. After this round the orchestrator merges you (about Friday 05:00 UTC), and lane B builds on the real routes.

### C5 try-guard (source `design-final:red-team` reduced, plus steps 3 and 4 of `engine-plan:truth-and-guard`)

`test/try-redteam.test.ts`; each hole is fixed in the module that owns it. The attacks:

- **Tenancy:**
  - another company's session or visitor token on every `/v1/engine` and `/v1/try` route;
  - a try session on every route outside the try-route list (403 `try_only`), including `POST /v1/engine/documents` and `POST /v1/engine/sync`;
  - a replayed approval signature on another proposal and in another company.
- **The pay route:**
  - 20 parallel pays with changed terms make no transfer and leave the stored terms unchanged;
  - 20 parallel pays with the signed terms make exactly one transfer, and the rest answer `paid_once`;
  - `approve` with a fresh signature over edited terms is refused (the challenge is the stored terms' hash).
- **Limits under parallel requests:**
  - 20 parallel starts against `starts_per_day_public = 3` admit exactly 3;
  - one /64 cannot pass the address limit by changing its last 64 bits;
  - a jury token cannot be used past its `until`, or for another pool;
  - spend past each of lane A's caps from 20 parallel uploads (with lane A's `spend` merged; otherwise a stub with the same interface);
  - 20 expired-session polls from one address do not block a second visitor at that address.
- **Bodies:**
  - a body one byte over each cap;
  - a cross-site or missing `Origin` on every POST;
  - a compose with control characters, a 10,000-character field, or an IBAN with a bad check digit.
- **Admin:** the admin route under a flood of wrong tokens.

Extend two existing tests:

- `test/cloud-golive.test.ts`: no token, visitor token, passkey answer or account number in a log line of the engine and try routes.
- `test/cloud-tenancy.test.ts`: its walk covers the new routes.

On the deployment, with the orchestrator, once: send a hostile PDF (the bomb of `test/ap-redteam2.test.ts`) through `POST /v1/engine/documents` of an **admin-made** company, because try sessions cannot upload. Write what happened into the G1 run record.

### C6 truth-claims (source `engine-plan:truth-and-guard` steps 1, 2 and 5, plus `design-final:docs-claims` reduced). Never cut. It comes before the rail.

**"The cloud never moves money and holds no payment keys."** The sentence stands at `docs/cloud.md` line 20, `docs/runbook.md` lines 310 and 381, and `src/cloudsync/client.ts` line 3. Also search for "never moves money", "holds no payment keys", "cannot move money" and "only stores and shows" in `docs/`, `src/`, `cloud/`, the README and the site's pages. Every hit is reworded to: "Purser Cloud moves no real money. Its hands-on deployment runs the engine on test money and a simulated bank".

The clause "and holds one Airwallex sandbox key" is added only while `TRY_AWX_API_KEY` is set on `purser-try`, which is from gate GR on. Keep it as one exported constant that the docs test reads, so that A8 changes one line at the freeze if gate GR2 failed and the owner deleted the key. `test/platform-in-main.test.ts` is updated to the new sentences.

**"A hosted preview exists but is private (behind an access key)."** This is in `docs/cloud.md` lines 5 and 299, `docs/claims.md` row 344, `docs/decisions.md` D29, `docs/after-the-kit.md` lines 18 and 44, `docs/go-live.md` line 5, `docs/runbook.md` line 311 and `README.md`. Do what the owner's answer (plan of record, ask 2) says, given to you by the orchestrator:

- **The preview exists:** keep these, and add that the hands-on deployment `purser-try` is separate.
- **It does not:** correct each one to say what is deployed: `purser-try`, a separate hands-on deployment with test data only, while the product's own deployment is still to come. Add a test that the sentence is gone.

Either way, `docs/cloud.md`'s deploy step warns that `cloud/wrangler.jsonc` now adds the engine's class and migration, which cannot be rolled back.

**`docs/cloud.md`, a section "The hands-on deployment":**

- one object per company with the product's engine on its own SQLite;
- test money on a simulated bank;
- the held approval and the one pay route, with its two layers;
- the switches, pools and caps;
- the measured limits: a link to `docs/runs/2026-11-13-engine-in-cloud.md`, with numbers not copied;
- the sweep;
- what is not there: real money, e-mail into the object, the console's engine actions, a visitor's own file upload (switch `own_upload`, off), and live Airwallex unless the rail shipped.

Also: what a public launch still needs (a bot check, WAF rate rules, a budget alert, the sweep watched, a hostile-PDF limit).

**`docs/claims.md`:** rows for the hands-on demo. What is live; what is simulated; the caps per visitor, per pool and per day; the models that ran with the measured cost (a link to A7's run record); the export (what it holds and what not); the tokens. The rows for `/try/sign` stay.

**`README.md` and `llms.txt`:** the hands-on link and one sentence on what is real, behind a marker the orchestrator flips after gate G5. Until then the line says "coming".

**A test** that the words "real money", "Airwallex", "Metal", "streamed" and "three agents" appear in the hands-on docs only next to what ran.

### C7 review-fix-c2 (new)

Review of C5 and C6. Lenses: money, caps and the pay route; claims and labels. Fix what it finds. The orchestrator merges you before Friday 14:30 UTC (gate GR1).

### C8 rail-client (conditional; source `design-final:rails-awx`, reduced)

**Start only when the orchestrator says gate GR1 passed**: gate GR passed and C7 is merged by Friday 14:30 UTC. Otherwise go to C11, or help lane B as the orchestrator says. Build against the recorded answers of 7 and 10 November in the repository's fixtures until the verify run's answers replace them.

**`src/rails/sandboxPayout.ts`** (new): host-agnostic, no `node:` import, `fetch` injected. Host `api.sandbox.airwallex.com` only, HTTPS only, 8 s per call. Exactly four calls are allowed; any other method, path, host or query throws before `fetch`:

- `POST /api/v1/authentication/login`, never on behalf of an account;
- `POST /api/v1/transfers/create`, on behalf of the connected test account (required);
- `POST /api/v1/simulation/transfers/{uuid}/transition`, on behalf of the account (required), to SENT, then to PAID;
- `GET /api/v1/transfers?request_id=…`, on behalf of the account (required), only after a lost create answer.

Further rules:

- **The body.** The transfer body is the product's: move `payoutTransferBody` out of `src/airwallex/adapter.ts`, with a re-export, as `design-final.md` section 4.2 says. The reference is the invoice number, and `metadata` is `{approval_sha256, purser_demo: "1"}`.
- **No resend.** A `POST` whose answer was lost is never sent again.
- **Failures** become fixed reasons. No Airwallex body, key or token goes into an answer, an error or a log.
- **Interface:** `payOnce(i: { requestId; beneficiaryId; amount; currency; reference; approvalSha256; visitor }, ledger: CallLedger, emit: (row) => void): Promise<RailOutcome>`, with `interface CallLedger { reserve(n: number, visitor: string, eurCents: number): Promise<boolean>; record(row): Promise<void> }`. The same client can then sit in a Durable Object's SQLite (fallback F) or in D1 (here).

**`cloud/src/try/railLedger.ts`.** Tables:

- `try_rail_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, tenant_id TEXT, visitor TEXT, proposal_id TEXT, op TEXT, request_id TEXT, status TEXT, http INTEGER, ms INTEGER)`
- `try_rail_day (day TEXT PRIMARY KEY, n INTEGER NOT NULL, reserved INTEGER NOT NULL, eur_cents INTEGER NOT NULL)`

A chain reserves 4 calls (3 and a spare) before its first request, in one D1 batch, within these limits:

- **per visitor:** at most 5 a day, keyed by the company's day-keyed address hash, or by the company for event and jury companies (addendum point 2);
- **per company:** at most 5 in all;
- **per day:** at most `awx_calls_day` (≤ 1,500), logins counted;
- **money:** at most `awx_eur_day` euros sent a day.

**Labels** (`cloud/src/try/railLabels.ts`): one sentence per outcome, from `design-final.md` section 9.6's table, adapted:

- **PAID:** "Airwallex sandbox · test money · transfer {id} · PAID · settlement simulated in the sandbox at Purser's request · paid from Purser's shared sandbox test account to the sandbox beneficiary for {supplier}".
- **Created but not paid.**
- **`IN_APPROVAL`:** "Held by Airwallex for its own approval. Purser sent it once and will not send it again."
- **Refused.**
- **Not sent:** "Not sent to the Airwallex sandbox: {reason}. Paid on the simulated bank only." The reasons are: switch off, a cap, no key, a payee without a sandbox beneficiary, an amount over EUR 2,500.

**Secrets on `purser-try`**, set by the owner: `TRY_AWX_CLIENT_ID` and `TRY_AWX_API_KEY`. Also a plain var `TRY_AWX_ACCOUNT` (the connected account's id), and `cloud/src/try/sandbox.json` (supplier key → sandbox beneficiary id, from the verify run; no secret). A test asserts that `cloud/wrangler.jsonc` (the product's) has none of these names, and that no file in the repository sets them.

Tests first:

- the allowlist: every other call throws before `fetch`;
- the chain on a fake at HTTP level: three calls to PAID;
- a lost create answer → one lookup, never a second create;
- `IN_APPROVAL` → held, and the caller is told to switch the rail off;
- a 5xx at create → the refused label;
- the visitor's sixth call of the day, the company's sixth call, the day's 1,501st call and the euro ceiling are each refused before `fetch`;
- no key → not sent.

### C9 rail-wire (conditional; source `design-final:rails-wire`, reduced)

**`POST /v1/try/rail/{proposal_id}`** (session, a try company only).

- **When:** only when `rail_awx` is on, the key is set, and the proposal was paid through the pay route on the simulated bank.
- **First** it re-reads the stored approval and verifies it against the stored terms (`verifyApprovalSignature` with counter 0).
- **The payment** takes amount, currency, reference and supplier only from the stored signed terms. It maps the supplier to its sandbox beneficiary (`sandbox.json`; none → not sent), reserves the chain, and runs `payOnce` with `request_id = try-<tenant>-<proposal>`.
- **Idempotent:** a second call returns the stored outcome.
- **The first `IN_APPROVAL` answer** sets `rail_awx` to off for everyone, and an admin-log row says why.

**`GET /v1/try/rail/{proposal_id}`** → `{rows, state, label}` from `try_rail_calls`, each row written when its answer came back.

The engine's books still come from the simulated bank, and the label says so. Nothing a visitor typed reaches the sandbox: the reference is the invoice number the engine stored, which for a composed invoice is validated by C2's pattern.

Tests first:

- three parallel `POST`s make one chain;
- switch off → not sent, zero calls;
- a pay with changed terms after a rail chain shows `sandbox_calls: 0`;
- a payee without a sandbox beneficiary → not sent, with its sentence.

Gate GR2 (Saturday 08:00 UTC): three visitors' payments on `purser-try` each reach PAID within 4 calls. If not, the switch stays off and the owner deletes the two secrets before the freeze.

### C10 review-fix-rail (conditional; new)

Review of C8 and C9. Lenses: money and rails (the allowlist, never twice, the per-visitor ledger, the euro ceiling, no secret anywhere); labels and claims (C6's sentence constant follows the secret). Fix what it finds. Merged before GR2.

### C11 try-signer (stretch; source `engine-plan:try-signer`)

As the source, for the try page instead of the console: `src/ui/testSigner.ts` (WebCrypto ES256, in the WebAuthn shapes the engine verifies), plus its source as a string constant (`TEST_SIGNER_JS`) for lane B's inline script, tested by evaluating that string in Node 22. Allowed for try companies only. The label "Test signer (this browser), not Face ID" goes on the approval, in the events and on the receipt.

### C12 metal-read (stretch; source `design-final:rails-metal`, reduced)

One read per visit of the demo agent's mandate on Metal testnet: `eth_blockNumber` and one `eth_call`, for one address, with fixed call data from a committed file. Cached 10 s. At most 2 a visit and `metal_calls_day` a day, in a D1 ledger. Switch `rail_metal`.

Lane B shows it as one row on screen 3: "The Payer agent's mandate on Metal testnet now: bound, not revoked, block {n}".

The RPC URL is a secret, `TRY_METAL_RPC_URL`, set by the owner; it never appears in an answer, error or log. Build this only if the owner confirms a bound mandate valid past 21 November.

## Fallback F (only if the orchestrator says gate G1 failed)

Do C8 as written (it is host-agnostic on purpose, with the per-visitor ledger), then wire it into kit11's `/try/sign` pay step:

- a `CallLedger` over the try-sign Durable Object instance's SQLite;
- a switch in that instance's config;
- the same labels;
- behind gate GR.

kit11 rules: `test/try-fx.test.ts` must pass unchanged (the new module uses its own secret names); no new Durable Object class, no migration; deploy only by the orchestrator on the owner's word. Then C6 for what changed.

## Out of scope for lane C

The page, the engine object, the caps ledger (lane A), the console, the declined-card scene, recorded agent runs, word-by-word text, a bot check, a visitor's own file upload (the switch stays off), and in-browser verification of the signature.

## Honesty rules

- **Test data only.** Everything a visitor's company holds is test data and test money. Nothing in it is invented history: no approvals, payments or invoices the visitor did not cause, apart from the seed's opening balance and suppliers, which `docs/cloud.md` names as seeded.
- **Sources.** An outcome names its source: "simulated bank", "Airwallex sandbox", "Purser's code". A refusal names the layer that refused, in that layer's own words. A rail row exists only for a request that was sent; a not-sent payment says why.
- **Fail closed.** Limits and switches fail closed and say so in a sentence a person can read.
