# Stream family: the engine in a Durable Object per company

Decision of the tech lead after a spike with running code (12 Nov): go_reduced.

Decision: build the engine in a Durable Object per company now, on test money (stand-in bank), with the console actions and the public hands-on demo on top; real money from the cloud and the less-used flows' screens come after the submission.

RAN by me today (local workerd 1.20261023.1 through wrangler 4.155.0, nodejs_compat, SQLite-backed Durable Object, local D1 and R2, no network; branch spike-do-lead, head 2b952eb, worktree /home/user/wt/spike-do-lead):
1. The chain explorer's command, re-run: 75 of 76 shim checks equal to better-sqlite3 (the one difference is binding a bigint, which the engine never does); golden comparison 0 differences over 71 rows in 21 tables; 947 engine statements per chain in both runtimes; same audit head, ledger head, terms hash and sync-batch hash; ten steps 56.9 ms wall, 37.0 ms CPU (median of 3, machine load 18).
2. A joined probe neither explorer ran (spike/do-lead/run.mjs): the cloud Worker, unchanged, with one Engine object per company. In the object: the real chain with the engine's REAL PDF reader (no stand-in), a signature over other terms refused, the right one approved, invoice PAID (fee EUR 13.40), 7 ledger entries; then batchesFor and the cloud's own applySync on D1 and R2 (18 D1 round trips, 68 statements, 2 R2 writes, 64 ms); then syncVault into R2 (original, pdfkit receipt, suppliers list, index.json). The console's own API then shows AP-0001 paid, the document with the uploaded bytes, 7 ledger entries, 3 matched transactions, the trial balance. Another company sees nothing and its object holds no engine rows.
3. The catches give the same answers in the object and in Node: same file again duplicate_document; renumbered copy needs_review with possible_duplicate; the changed-bank-details fixture needs_review with country_not_paid; paying a stopped invoice refused, no proposal made.
4. Object memory dropped (as after eviction): handle rebuilt in 3 to 8 ms, the stand-in bank restored from the object's SQLite, nothing booked twice, both chains verify.
5. The engine's own Node tests routed through the shim (a SqlStorage stand-in over better-sqlite3): 48 files, 513 tests, all pass (payables, approvals, executors, ledger, month, passkeys, batches, payouts, stock, vault, cloud sync). A first attempt with a defect in the stand-in failed 22 of 25 tests inside the shim, so the tests really cross it.
6. Documents: 15 MB in 1 MB pieces back intact. PDF reader on a 200-page text PDF inside the object: 643 and 741 ms (load 30); 201 pages refused.
7. Engine loaded on first use by a thin object (lazyWorker.ts): not loaded before the first engine call, chain pays after it; wrangler keeps import() lazy.
8. Bundle of cloud Worker plus whole engine (wrangler dry run): 7,520 KiB, gzip 1,706 KiB. Node tests of the touched modules on the merged tree: 18 files, 196 tests pass. Runtime probes p5 (Claude SDK, reader, agent loop in an object, stand-in fetch) and p6 (Airwallex client) re-run: both pass.

INFERRED, not run: that Cloudflare's production accepts the script (start-up limit, CPU, memory, D1 queries per invocation, row size limit, the account's plan are all unverified; local first-answer times, 1.5 to 2.4 s, were the same with and without lazy loading, so they do not answer it); that real Claude and real Airwallex calls behave from an object as against the stand-in fetch; that the console work fits its three tasks (no UI was tried); that a day of multi-agent work is enough: 17 tasks of 30 to 60 minutes, about 15 agent-hours, three lanes at best after task 5, so tasks 1 to 10 plus the deploy gate are a long day and the demo is a second day.

Why reduced and not full: the test-money chain is proven by running code and is the same code as the runner to the row. Real money from the cloud needs secrets in the Worker, alarms for the executor's long retries, a durable call budget and a review, changes what the product promises today (the cloud never moves money and holds no payment keys), and none of it was run.

Why not no_go: the alternative for the demo (design v1, the /go page with its own books, PDF writer, archive, rails and tables) is itself about 25 unbuilt tasks and is a second implementation of a chain that already runs in the object. One build instead of two.

What exactly must change in the engine (all small, Node behaviour unchanged, on spike-do-lead with tests green except one line in src/ap/detail.ts): open.ts split into migrate.ts (prepareDb); doSql.ts shim (381 lines); a document store seam at six readers; pdfText reader seam plus an inline reader; execute() takes the rails as an optional argument. Worker config: Durable Object binding and new_sqlite_classes migration, define for import.meta.url, dirname and filename, alias of playwright and better-sqlite3 to a stub, a Text rule for .sql; Worker-only start code: usePdfReader(readPdfInline) and pdfkit registerStdFonts. schema.sql and ledger.sql are accepted unmodified.

The full plan is `.handover/plan.md` (read it; where a task says 'Read first: ... plan.md', it is that file). The spike's code is on the public branches origin/spike-do-lead, origin/spike-do-chain and origin/spike-do-runtime (fetch them; tasks say which files to take). Spike branches are never merged as they are.

## What the demo gains

Compared with a small orchestration layer in the demo Worker over shared pure modules (design v1):
1. It is the product, not a model of it. The checks are the engine's evaluate, the payment is the executor's own state machine against the stand-in bank, the books are syncLedger posting into the hash-chained ledger, the archive is syncVault writing the product's own PDFs into R2. Measured: 947 SQL statements per invoice and the same audit head, ledger head and terms hash as a runner; the catches give the same answers as Node.
2. One implementation instead of two. Design v1 writes its own books, PDF writer, archive, rails, terms and tables (src/jury/*), about 25 tasks, each with its own tests and its own claims to police. Here none of that is written, and every later change to the engine is in the demo the same day.
3. The visitor works in the real console, in a company of their own that lasts a day: the demo doubles as a product trial, and what they sign with their passkey is a real proposal in a real ledger whose chains verify.
4. A visitor's own invoice becomes possible (the real reader and checks run), once a hostile PDF has been tried on a deployment; design v1 lists it as a stretch.
What it does not bring by itself: design v1's 24 choreographed scenarios, the stepwise tool-use agents (Checker, Payer, Buyer), the overspend scene, grading and recorded fallbacks. The first hands-on version is the payables chain with its catches and the refused signature; the agents arrive when branch ap-agents-1112 lands in the engine and then run in the object as on a runner (the agent loop ran in an object against a stand-in fetch).

## What the hosted product gains

1. The hosted product works without a runner: a company uploads an invoice in the console and it is read, checked, proposed, approved with a passkey over the exact terms, paid on test money, booked and archived in the cloud. Today the cloud only stores and shows what a runner pushes.
2. One engine, two hosts. The object builds the same batches a runner pushes (byte-identical in the comparison) and feeds the read model through the existing applySync, so every console screen and report keeps working and nothing is implemented twice.
3. Companies are apart by construction: one SQLite per company, one writer, no shared tables at the engine's level; another company's object held no engine rows in the probe.
4. Speed and cost shape: the whole chain is about 57 ms wall and 37 ms CPU locally, an object rebuilds its handle in 3 to 8 ms after its memory is dropped, and it costs nothing while idle.
5. A short, visible path to real money later: the same executor with the live Airwallex client (which ran in workerd against a stand-in fetch), secrets in the Worker, alarms for the long retries, a durable call budget and a review.
6. A place for what runs by itself: an object can wake on an alarm, which is what the cloud autopilot and the bookkeeper agent need.
7. A standing safety net that did not exist: the engine's own 513 Node tests can run through the Durable Object handle on every CI run.

## Risks

- Production limits are unknown: nothing was deployed. Start-up time for a 7.5 MB script (1.7 MB gzip), CPU per request, memory with pdf.js and a 15 MB document, D1 queries per invocation (a feed for one invoice made 18 round trips; the limits I recall, 50 on the free plan and 1,000 on the paid one, were not checked today), the row size limit and the account's plan are all unverified. Local timing cannot answer the start-up question (1.5 to 2.4 s to a first answer with and without lazy loading). Only the deploy gate answers it; mitigations that ran locally: engine loaded on first use, documents in 1 MB pieces; planned: the feed sends only what changed, a payables-only executor entry.
- Untrusted PDFs are read on the object's own thread: the worker thread's 10 s and 256 MB limits are gone. Measured only for an honest file (200 pages in 0.64 to 0.74 s); a slow or hostile PDF was not tried. A hostile file can only hurt its own company's object, but a visitor's own upload must stay off until tried on a deployment.
- The console work has no spike: three tasks in a 900-line page script plus the demo entry, with the Chromium check as the only real test. This is where the schedule is most likely to slip.
- A Durable Object class and its migration are hard to take back: a class is SQLite-backed only from its first deploy and a deploy with a migration cannot be rolled back past it. Deploy first to a deployment of its own (purser-try), never to an existing Worker.
- Claims: the docs and pages say the cloud never moves money and holds no payment keys. That stays true only while the engine in the cloud is test money only; every such sentence must be reworded and the status-text test updated (task truth-and-guard).
- Concurrent branches: cloud-demo-1112 edits cloud/src/app.ts and cloud/src/worker.ts; ap-agents-1112 rewrites src/ap/checks.ts from an older base. The seams touch src/ap/inbox.ts, pay.ts, detail.ts, pdfText.ts, src/vault/build.ts, src/cloudsync/client.ts, src/executors/index.ts and src/db/open.ts: land tasks 1 and 2 first and fast.
- Public cost and abuse: Claude spend per visitor (caps in task try-claude; no bot check or WAF rule exists yet), D1 and R2 writes per visitor, about 1 MB of object storage per company until the daily sweep.
- Passkeys: bound to the deployment's host; creating and signing from one tap is not certain on every phone; for hosted companies the engine's approval passkey is a second passkey beside the sign-in one until the two are joined; devices without WebAuthn need the stretch task try-signer.
- Local workerd is not production: eviction, a restart in the middle of an action and real concurrency were only imitated (memory dropped by hand; one action at a time per company is planned, not yet built). Real Claude and real Airwallex calls from an object ran only against a stand-in fetch.
- Time: 17 tasks of 30 to 60 minutes, about 15 agent-hours, three lanes at best after task 5. Tasks 1 to 10 and the deploy gate are a long day, the demo a second day, leaving little for polish before a submission in 2.5 days. The fallback decision must fall at gate 1, not later, and gate 1 depends on the owner's go for a deploy.
- Side finding for the demo's story: the repository's changed-bank-details fixture is stopped as country_not_paid, not as possible_fraud, in Node and in the object alike; the sample invoices must be chosen by what the checks really answer.

## Fallback

If gate 1 fails (Cloudflare refuses the Worker for start-up time or size twice, or the three production smoke runs do not end paid, booked and archived), or the engine object is not green in workerd through the routes by midday 13 November: build the jury demo of design v1 instead ((a private design document; not needed here): the /go page on the kit11 Worker with a small orchestration layer over shared pure modules), cut to its must-have line, beside the read-only cloud demo of branch cloud-demo-1112. The seams of tasks 1 and 2 stay merged (they change nothing in Node), the sample invoices (try-world) and the Claude caps (try-claude) are reused, and the engine object ships after the submission. Do not start the design v1 build while gate 1 is still open: it is a second implementation of a chain that already runs in the object.

# LANE engine-core

## Task db-seam: Migrations split from the opener; the Durable Object handle (shim) with its checks

Size: 60 min. Depends on: nothing.

Read first: .handover/plan.md, sections 3 and 5 (worktree from origin/platform, the test command, commit rules).

Goal: the engine's schema and migrations run on any SQLite handle, and a better-sqlite3-shaped handle exists for a Durable Object's SQLite. Nothing changes in Node.

Start from: git checkout origin/spike-do-lead -- src/db/migrate.ts src/db/open.ts src/db/doSql.ts. The 76 checks are in spike/do/conformance.ts; a SqlStorage stand-in over better-sqlite3 is in spike/do-lead/shim/doStorage.ts; the workerd run is in spike/do/conformance-run.ts, spike/do/conformanceWorker.ts and spike/do/mf.mjs.

Files and interfaces:
- src/db/migrate.ts (new): prepareDb(db: DB, schema: string, ledger: string): void and settlementsTable, with no Node import.
- src/db/open.ts: keeps openDb, type DB and the WAL retry; reads the two .sql files and calls prepareDb.
- src/db/doSql.ts (new): DoStorage, DoCursor, DoDatabase, DoStatement, SqliteError, scanSql, asSqliteError, and export function doDb(storage: DoStorage, name?: string): DB (the one documented cast from DoDatabase to DB).
- test/support/doStorage.ts (new): sqliteDoStorage(db: Database.Database): DoStorage. It answers as SqlStorage does where the shim depends on it: values by position (named parameters included), BLOBs as ArrayBuffer, errors worded '<message>: SQLITE_X (extended: SQLITE_X_Y)', BEGIN, COMMIT and SAVEPOINT refused, transactionSync as savepoints.
- test/support/dbConformance.ts (new): conformance(db): [string, string][].

Tests first: test/db-do-sql.test.ts: (1) scanSql on positional, numbered (?3), @a, :a, $a and repeated names; parameters inside strings and comments ignored; CREATE TRIGGER ... BEGIN ... END counted as one statement; RETURNING. (2) The 76 checks give the same answer on better-sqlite3 and on doDb(sqliteDoStorage(...)), except 'bind bigint'. (3) prepareDb over the shim leaves the same sqlite_master rows (type, name, sql) as openDb(':memory:'). test/db-do-sql-workerd.test.ts (only with CLOUD_DB=d1, where wrangler's toolchain is linked; add it to vitest.d1.config.ts; in the plain run one test that says it is skipped): the same checks inside a SQLite-backed Durable Object through Miniflare, 75 of 76 equal.

Checks: the test command on the two new files and test/ap-migration.test.ts test/ap-inbox.test.ts test/passkey.test.ts test/cloud-sync.test.ts test/ledger-core.test.ts; npx tsc --noEmit; npx eslint src test cloud/src.

Out of scope: narrowing type DB; any change to schema.sql or ledger.sql; cloud/; merging anything under spike/.

## Task io-seams: Documents, PDF text and payment rails handed in by the host

Size: 60 min. Depends on: nothing.

Read first: .handover/plan.md, sections 3 and 5 (worktree from origin/platform).

Goal: document bytes, PDF text and payment rails become things a host hands in. With nothing handed in, Node behaves exactly as today.

Start from origin/spike-do-lead: src/ap/docStore.ts, src/ap/inbox.ts, src/ap/pay.ts, src/cloudsync/client.ts, src/executors/index.ts, src/ap/pdfText.ts, src/ap/pdfTextInline.ts, src/vault/build.ts.

Files and interfaces:
- src/ap/docStore.ts (new): interface DocStore { put(sha256: string, bytes: Uint8Array): string; get(path: string): Buffer }, useDocStore(db: DB, store: DocStore): void, docStoreOf(db), readDoc(db: DB, path: string): Buffer. put returns what ap_documents.path keeps.
- Readers switched to readDoc: src/ap/inbox.ts (the write in ingestDocument, the read in recheck), src/ap/pay.ts, src/ap/detail.ts (the readFileSync(doc.path) near line 142, not yet done on the spike), src/vault/build.ts (in plan), src/cloudsync/client.ts (batchesFor).
- src/ap/pdfText.ts: type PdfReader = (bytes: Uint8Array, maxPages: number) => Promise<{ text: string; pages: number }>, usePdfReader(r: PdfReader | null): void; the unpdf path is worked out when the first worker thread starts, not at import; the decode budget is checked first either way. src/ap/pdfTextInline.ts (new): readPdfInline: PdfReader.
- src/executors/index.ts: export type Rails; execute(db, proposalId, read?, hub?, rails?), the rails passed to executeApproved and to the batch executor; without them airwallexFromEnv() as before.

Tests first:
- test/ap-docstore.test.ts: with a memory store, ingestDocument writes no file under <dir>/docs and ap_documents.path is put()'s value; payApInvoice, recheck, the invoice detail, batchesFor and syncVault read through it; with no store, as today.
- test/ap-pdftext-reader.test.ts: readPdfInline gives the same text as the worker-thread reader for pdfOf(EN) of test/fakes; with a reader set the decode budget still refuses the bomb used in test/ap-redteam2.test.ts; usePdfReader(null) puts the worker thread back (reset in afterEach).
- test/executors-rails.test.ts: execute with { rail, sim } of a FakeAirwallex pays with no AIRWALLEX_* set.

Checks: the test command on the three new files and test/ap-inbox.test.ts test/ap-pay.test.ts test/ap-detail.test.ts test/ap-redteam2.test.ts test/ap-review-fixes.test.ts test/rt4-web.test.ts test/vault-build.test.ts test/vault-data.test.ts test/vault-hook.test.ts test/vault-pdf.test.ts test/vault-reports.test.ts test/vault-remote.test.ts test/vault-page.test.ts test/cloud-sync.test.ts test/cloud-cli-exit.test.ts test/executors-dispatch.test.ts test/payment-batch.test.ts; npx tsc --noEmit; npx eslint src test cloud/src.

Out of scope: R2, storage in pieces, cloud/. The Node servers that serve a PDF from disk (src/servers/payables.ts, src/vault/page.ts) stay on files.

## Task engine-host: One company's engine as a set of actions, on any ledger handle

Size: 60 min. Depends on: io-seams.

Read first: .handover/plan.md, sections 3, 5 and 'Task 3' (the full TypeScript interface is there). Work from the integration branch engine-do.

Goal: one company's engine as a small set of actions on a ledger handle: the same class for the Node tests and for the Durable Object. Every call it makes already exists; spike/do/chain/chain.ts and spike/do-lead/leadWorker.ts on origin/spike-do-lead show each one.

Files and interfaces:
- src/engine/standInBank.ts (new): interface BankStore { load(): string | null; save(text: string): void }; bankToText(b: FakeAirwallex): string (every own field that is not a function; a Map as { __map: [...] }); bankFromText(text): FakeAirwallex; standInBank(store: BankStore): FakeAirwallex.
- src/engine/events.ts (new): interface EngineEvent { seq: number; ts: string; actor: string; event: string; subject: string | null; fields: Record<string, string | number | boolean | null> }; publicEvent(row): EngineEvent with a short allowlist of fields per event (model, source claude or fallback, status, finding codes, amount, currency, request id, cost in micro-USD); an event not on the list carries no fields. List the events from the audit( calls of src/ap, src/claude, src/passkey, src/policy/approvals.ts, src/executors, src/ledger, src/vault.
- src/engine/host.ts (new): export const parserOnly: Asker; interface EngineDeps { db: DB; reader: Asker; rails: Rails; afterMoney?: () => void; rp: { rpId: string; origin: string }; company: { name: string; lang: 'en' | 'nl' }; vault: VaultSink | null; feed: ((db: DB, now: Date) => Promise<unknown>) | null; now?: () => Date }; class EngineHost with: status(), seed() (seedTreasury, safe to repeat), upload({ bytes, filename, mime? }) -> { kind, sha256, invoice }, invoices(), invoice(id), propose(invoiceId) -> { ok: true, proposal } | { ok: false, reason }, proposal(id), passkeyStart() -> { challenge, code, exclude }, passkeyFinish({ code, credential, label }), approve({ proposal_id, terms_sha256, credential }) -> { status, message, settled }, sync() -> Settled (syncPayments, syncLedger, the vault, the feed; safe to repeat), events(after, limit?) -> { items, next }, vaultFiles(), vaultFile(path) (only a path the index lists). ProposalView = { id, kind, status, terms_sha256, challenge: challengeFor(terms_sha256), facts: [string, string][] } with facts from payablesFacts and firstScreenFacts of src/approve/client.ts. Settled = { invoice_status, transfer_status, ledger_entries, vault_added, fed, error }.
- passkeyFinish runs processRegistration and then confirms the pending passkey itself (pendingPasskeys, confirmPasskey): in the cloud the signed-in owner's session is the confirmation.
- approve runs processAssertion; on 'approved' it runs execute(db, id, undefined, undefined, rails), calls afterMoney, then sync(). An error in execute or sync comes back in settled.error, never swallowed.
- Every method that writes runs through one queue per host (one engine action at a time); the reads do not wait for it.

Tests first (test/engine-host.test.ts, on openDb(':memory:'), standInBank with a memory store, parserOnly, an in-memory VaultSink, FakeAuthenticator): (1) the chain: upload pdfOf(EN), ready with no findings; propose; passkey set up; a signature over other terms refused and nothing runs; the right one approves; settled says paid, PAID, 7 ledger entries, three vault files; verifyAuditChain and verifyLedger pass. (2) The catches: same bytes again duplicate_document; a renumbered copy needs_review; propose on it answers ok:false with the engine's reason and adds no proposal. (3) sync() twice: the second adds nothing. (4) A second host on the same ledger and bank store shows the same balances and its sync() changes nothing. (5) Two approve calls at once run one after the other and make one transfer. (6) events pages by seq and no event carries the invoice's IBAN.

Checks: the test command on the new file and test/ap-inbox.test.ts test/ap-pay.test.ts test/passkey.test.ts test/executors-dispatch.test.ts test/vault-build.test.ts; tsc; eslint.

Out of scope: cloud/, the Durable Object, real Claude, rejecting, new suppliers, batches, the month close.

## Task engine-feed: The read model's feed: only what changed, through applySync

Size: 45 min. Depends on: engine-host.

Read first: .handover/plan.md, sections 3 and 5. Work from the integration branch engine-do.

Goal: after an engine action the cloud's read model holds what the ledger holds, through the code a runner's push uses, and a feed costs D1 only for what changed (measured on the spike: a full feed of one invoice made 18 D1 round trips, a repeat 13 to 14).

Files and interfaces:
- src/engine/feed.ts (new): interface FeedTarget { state(): Promise<CloudState>; apply(batch: Record<string, unknown>): Promise<unknown> }; feedCloud(db: DB, target: FeedTarget, now?: Date, opts?: { all?: boolean }): Promise<{ batches: number; sent: Record<'documents' | 'vendors' | 'invoices' | 'payments' | 'transactions' | 'ledger_entries' | 'audit_rows', number>; applied: unknown[] }>. It runs syncLedger (as pushToCloud does), then batchesFor(db, await target.state(), { now }), then drops every vendor, invoice, payment and transaction whose content was already sent. A table the feed makes itself with CREATE TABLE IF NOT EXISTS, cloud_feed_sent (kind TEXT, id TEXT, sha256 TEXT, PRIMARY KEY (kind, id)), holds a hash per row (leave a vendor's updated_at out of its hash: batchesFor stamps it with now). Hashes are stored only after apply succeeded. A batch left empty is not sent. all: true sends everything. Do not add the table to src/db/schema.sql.
- cloud/src/sync.ts: export async function syncState(db: TenantDb): Promise<{ audit: { seq: number; hash: string | null }; ledger: { entry_id: number; hash: string | null }; documents: string[] }>, taken out of the GET /v1/sync/state route in cloud/src/app.ts, which then calls it.
- cloud/src/engine/target.ts (new): cloudTarget(db: TenantDb, blobs: Blobs, now: () => Date): FeedTarget; apply is applySync(db, blobs, SyncBatch.parse(batch), now()) with no caller named (no key guard: the engine is not a sync key).

Tests first (test/engine-feed.test.ts, Node: an EngineHost world from task engine-host and testCloud() of test/support/cloud.ts, a TenantDb over its env.sql): after the chain and a feed, GET /v1/invoices with the tenant's key shows AP-0001 paid, the document's bytes are the uploaded ones, 7 ledger entries; a second feed sends nothing and makes at most 3 Sql calls (count through a wrapper around Sql); a second invoice sends only that invoice, its document and the new chain rows; a changed invoice status travels as a new version (the earlier one is in object_history).

Checks: the test command on the new file and test/cloud-sync.test.ts test/cloud-core.test.ts; tsc; eslint.

Out of scope: the Durable Object, routes, the health report, the Airwallex binding, mail.

## Task engine-routes: The /v1/engine routes, with a Node engine for tests

Size: 60 min. Depends on: engine-host, engine-feed.

Read first: .handover/plan.md, sections 3, 5 and 'Task 5' (the route table). Work from engine-do.

Goal: the engine's actions as routes of the cloud's API, with the cloud's own gates, tested in the plain run on a Node engine.

Files and interfaces:
- cloud/src/engine/api.ts (new): interface EngineApi: the methods of EngineHost, every one async, arguments and results plain data (bytes as Uint8Array), plus wipe(): Promise<void>.
- cloud/src/engine/node.ts (new): nodeEngines(env: { sql: Sql; blobs: Blobs; rpId: string; origin: string; now?: () => Date }): (tenantId: string) => EngineApi. One EngineHost per tenant over openDb(':memory:'), the stand-in bank in memory, a vault sink over blobs under t/<tenant>/vault/, the feed through cloudTarget.
- cloud/src/app.ts: CloudEnv.engine?: (tenantId: string) => EngineApi and one block of ROUTES. The tenant is always c.caller.tenantId. With engine absent every route below answers 404.
- test/support/cloud.ts: testCloud({ engine: true }) wires nodeEngines.

Routes (need in brackets):
GET /v1/engine [read] -> status().
POST /v1/engine/documents [admin] { filename (1 to 200 chars), mime?, base64 }, body at most 22,000,000 bytes, 15 MB decoded -> { kind, sha256, invoice }.
GET /v1/engine/invoices [read] -> { items }.
POST /v1/engine/invoices/{id}/pay [admin] -> 200 { proposal } or 409 with the engine's reason.
GET /v1/engine/proposals/{id} [read].
POST /v1/engine/passkey/start [admin, a session only] -> { challenge, code, rp: { id, name: 'Purser' }, user: { id, name, displayName }, exclude }.
POST /v1/engine/passkey/finish [admin, a session only] { code, credential }; the label is the signed-in person's display name.
POST /v1/engine/proposals/{id}/approve [admin, a session only] { terms_sha256, credential } -> { status, message, settled }.
POST /v1/engine/sync [admin].
GET /v1/engine/events [read] ?after=<seq>&limit=<1 to 200> -> { items, next }.
GET /v1/engine/vault [read] -> { files }.
GET /v1/engine/vault/file [read] ?path= -> the PDF (content-disposition attachment, nosniff, no-store); 404 for a path the index does not list.
A key cannot run a passkey ceremony for a person: the three passkey routes answer 403 to a caller whose kind is not 'session'.

Tests first (test/cloud-engine.test.ts): the whole flow over HTTP with an owner's session (upload, pay, passkey start and finish with FakeAuthenticator on the test cloud's RP and origin, a signature over other terms refused, approve, settled), then the read model's GET /v1/invoices shows paid; a viewer and a read-only key get 403 on every POST and 200 on the reads; an admin key gets 403 on the passkey routes; another company's session gets 404 for the invoice, the proposal and the vault file; with no engine wired every route answers 404; a body over the cap is refused; a POST with another Origin is refused. Extend test/cloud-tenancy.test.ts so its walk over ROUTES covers the new routes.

Checks: the test command on the new file and test/cloud-core.test.ts test/cloud-auth.test.ts test/cloud-tenancy.test.ts test/cloud-security.test.ts test/cloud-console.test.ts test/cloud-golive.test.ts; tsc; eslint.

Out of scope: the Durable Object, the console, the visitor's company, real Claude.

## Task engine-object: The Durable Object, its wrangler config and the workerd test

Size: 60 min. Depends on: db-seam, engine-routes.

Read first: .handover/plan.md, sections 3, 5 and 'Task 6'. Work from engine-do.

Goal: one Durable Object per company running the real engine on its own SQLite, behind the routes of task engine-routes. A transplant of spike/do-lead/leadWorker.ts (which ran) into the cloud's tree, with the engine loaded on first use as in spike/do-lead/lazyWorker.ts (both on origin/spike-do-lead).

Files and interfaces:
- cloud/src/engine/object.ts (new): export class CompanyEngine extends DurableObject. Types only are imported statically. async call(tenantId: string, method: keyof EngineApi, args: unknown[]): Promise<unknown> loads ./hostWorker.js with import() on first use and passes the call on; wipe() runs ctx.storage.deleteAll(). The tenant id comes with every call and is pinned on first use (a row in the object's own table); another id is refused. Do not rely on ctx.id.name.
- cloud/src/engine/hostWorker.ts (new): openHost(ctx, env, tenantId): Promise<{ api: EngineApi }>: doDb(ctx.storage); prepareDb(db, SCHEMA, LEDGER) with the two .sql files imported as text; documents through cloud/src/engine/docChunks.ts (new: a DocStore in 1 MB pieces, table do_doc_chunks (sha256, n, bytes)); usePdfReader(readPdfInline); pdfkit registerStdFonts(Helvetica, HelveticaBold, HelveticaOblique) once; standInBank kept in a row of the object's table, saved in afterMoney; parserOnly as the reader; the vault through cloud/src/engine/vaultR2.ts (new: a VaultSink over Blobs under t/<tenant>/vault/); the feed through cloudTarget(new TenantDb(d1Sql(env.DB), tenantId), r2Blobs(env.DOCS), ...); the company's name and language read once from D1's tenants.
- cloud/src/entry.ts (new): export { default } from './worker.js'; export { CompanyEngine } from './engine/object.js'. cloud/src/worker.ts stays importable in Node: Bindings gains ENGINE? and ENGINE_MODE?, and envOf sets engine (a stub whose every method is stub.call(tenantId, method, args)) only when both are there.
- cloud/wrangler.jsonc: main src/entry.ts; durable_objects.bindings [{ name: 'ENGINE', class_name: 'CompanyEngine' }]; migrations [{ tag: 'v1', new_sqlite_classes: ['CompanyEngine'] }]; define for import.meta.url, import.meta.dirname and import.meta.filename; alias of playwright and better-sqlite3 to cloud/src/engine/stub.ts (throws when used); rules [{ type: 'Text', globs: ['**/*.sql'], fallthrough: true }]. Values that passed a dry run: spike/do-runtime/wrangler.cloud-engine.jsonc and spike/do-lead/wrangler.jsonc.
- cloud/src/engine/modules.d.ts (new): ambient modules for *.sql, cloudflare:workers and pdfkit/standard-fonts/*.

Tests first:
- test/cloud-engine-bundle.test.ts (plain run; esbuild from node_modules with a metafile): from cloud/src/entry.ts no static import reaches src/ap/, src/executors/, src/ledger/, src/vault/, src/passkey/, pdfkit, unpdf or viem (only the dynamic import of hostWorker does), and the bundle stays under 9 MB.
- test/cloud-engine-workerd.test.ts (only with CLOUD_DB=d1; add to vitest.d1.config.ts; plain run: one test that says it is skipped): the bundle of cloud/src/entry.ts, built with the alias, define and rules read from cloud/wrangler.jsonc, in Miniflare with the object (useSQLite), D1 and R2; through the routes only (a session made with sessionToken and the test's secret): the chain of the engine-routes test, the read model shows paid, the document's bytes match, the vault lists three files, another company gets 404 and an empty engine.

Checks: npm run test:d1 -- test/cloud-engine-workerd.test.ts test/db-do-sql-workerd.test.ts; the plain test command on test/cloud-*.test.ts; worker/node_modules/.bin/wrangler deploy --dry-run --outdir /dev/shm/x -c cloud/wrangler.jsonc (no deploy, no network) prints the ENGINE binding; tsc; eslint.

Out of scope: any deploy; alarms; e-mail; real Airwallex; real Claude; the visitor's company.

## Task shim-suite: The engine's Node tests routed through the shim, as a standing check

Size: 45 min. Depends on: db-seam.

Read first: .handover/plan.md, sections 2 and 5. Worktree from origin/platform after db-seam has merged.

Goal: the engine's own Node tests run through the shim on every CI run, so every flow (new supplier, batch, rejection, recheck, e-mail, scans, credit notes, the month close, payouts in other currencies) crosses the shim's parameter layout, change counting and transactions, not only the one chain the object ran. The spike did this once: 48 files, 513 tests, all green.

Start from origin/spike-do-lead: spike/do-lead/shim/openShim.ts, vitest.shim.config.ts and which.test.ts, plus the db-seam task's test/support/doStorage.ts.

Files:
- test/support/openShim.ts (new): the same exports as src/db/open.ts (openDb, type DB, settlementsTable); openDb opens better-sqlite3 (busy_timeout, WAL, foreign_keys), wraps it as doDb(sqliteDoStorage(raw)) and runs prepareDb.
- vitest.shim.config.ts (new, at the repository root): the base config plus a resolve.alias that swaps every import of .../db/open.js for test/support/openShim.ts.
- test/shim-handle.test.ts (new): under the shim config the handle's constructor is DoDatabase; under the plain config it is better-sqlite3's.
- package.json: "test:shim": the vitest run with that config over test/ap-*.test.ts test/approvals*.test.ts test/books.test.ts test/close-unsent.test.ts test/executors-*.test.ts test/gl-export.test.ts test/ledger-*.test.ts test/month*.test.ts test/passkey*.test.ts test/payment-batch.test.ts test/payouts-*.test.ts test/stock.test.ts test/supplier-facts.test.ts test/vault-*.test.ts test/cloud-sync.test.ts.
- .github/workflows/ci.yml: a step that runs npm run test:shim.

Rule: a failure is a defect of the shim or of the stand-in, to be fixed there, not in engine code. A test that needs better-sqlite3 itself (a second connection to one file, backup) is excluded by name in the config with the reason in a comment.

Checks: npm run test:shim green (use --maxWorkers=2 on this machine); the plain run untouched; tsc; eslint.

Out of scope: engine code; the workerd run (the db-seam task has it).

# LANE engine-console

## Task console-upload-live: Console: upload an invoice and watch the engine work

Size: 60 min. Depends on: engine-routes.

Read first: .handover/plan.md, sections 3, 5 and 'Task 8'. Work from engine-do. The console can be driven without workerd: testCloud({ engine: true }) serves the same routes from a Node engine.

Goal: in the console a person uploads an invoice and watches the engine work on it.

Files: cloud/src/console.ts (SCRIPT, BODY, CSS), src/ui/i18n.ts (keys cs.eng.* in both catalogues), src/ui/engineEvents.ts (new, pure: eventLine(e: EngineEvent, lang: 'en' | 'nl'): { who: string; text: string; tag: 'claude' | 'parser' | 'code' | null }), tests.

Behaviour: when GET /v1/engine answers 200, the Invoices page shows 'Upload invoice' (a button and a drop zone; PDF, JPEG or PNG up to 15 MB; read with FileReader, sent as base64 to POST /v1/engine/documents) and a panel 'At work' that lists the engine's events as they arrive: it polls GET /v1/engine/events?after=<seq> every 800 ms while a request is under way and for 10 s after, and stops when the page is hidden. Each line says who did it (the model's name with 'Claude', or 'the parser', or 'code'), what, and when. The invoice list reloads when an event says an invoice arrived, was paid or was filed. The header says 'Engine: test money' beside the existing 'Test money' chip. A refused upload shows the engine's reason. DOM through el() and textContent only; the nonce CSP unchanged.

Tests first: test/ui-engine-events.test.ts: every event on the allowlist of src/engine/events.ts has a line in English and Dutch; an unknown event gives a neutral line, never raw JSON. test/cloud-console.test.ts: the page carries the new keys, both catalogues hold them, the CSP is unchanged. test/browser/console.check.ts (the Chromium check, with engine: true): upload the fixture PDF, the row appears as ready, the panel shows lines, no console or CSP error, no overflow at 390 px.

Checks: the test command on the two test files and test/i18n-keys-used.test.ts test/i18n.test.ts test/cloud-console-invites.test.ts; tsc; eslint; the Chromium check where Chromium is installed (npx tsx test/browser/console.check.ts test-results/console).

Out of scope: paying and approving, the archive, the visitor's company.

## Task console-approve: Console: pay, set up the passkey, approve the exact terms

Size: 60 min. Depends on: console-upload-live.

Read first: .handover/plan.md, sections 3, 5 and 'Task 9'. Work from engine-do.

Goal: from a ready invoice to an approved payment, with a passkey that signs exactly the terms on the screen.

Files: cloud/src/console.ts (invoiceView and helpers), src/ui/i18n.ts (EN and NL), tests.

Behaviour: a ready invoice shows 'Pay...'; it calls POST /v1/engine/invoices/{id}/pay and shows the proposal: the facts as the phone page words them (proposal.facts), the full terms hash behind a fold, and one sentence saying the passkey signs exactly these terms. The first time: 'Set up approval on this device': POST /v1/engine/passkey/start, then navigator.credentials.create with the server's user id, excludeCredentials from exclude, user verification required, attestation none, then POST /v1/engine/passkey/finish. Then 'Approve with passkey': navigator.credentials.get with challenge = the proposal's challenge (base64url of the terms hash's 32 bytes), rpId, allowCredentials holding the engine's credential id, user verification required; the answer serialised as @simplewebauthn/server reads it (id, rawId, type, response { clientDataJSON, authenticatorData, signature, userHandle }, clientExtensionResults, authenticatorAttachment; adapt the serialisers of src/approve/client.ts) and posted with terms_sha256 to POST /v1/engine/proposals/{id}/approve. The page shows the engine's own message for approved and for refused. An invoice that is not ready shows its findings and the engine's reason why it cannot be paid. After approval the 'At work' panel carries on (paid, booked, filed) and the status chip follows.

Tests first: test/cloud-console.test.ts: the new keys in both catalogues and the unchanged CSP. The Chromium check (test/browser/console.check.ts) with its virtual authenticator: upload, pay, set up, approve, the status reads paid; a second pass changes terms_sha256 in the request and the page shows the refusal.

Checks: the test command on test/cloud-console.test.ts test/i18n-keys-used.test.ts test/i18n.test.ts test/cloud-engine.test.ts; tsc; eslint; the Chromium check where Chromium is installed.

Out of scope: rejecting, batches, new suppliers, the archive page, a second approver, joining the approval passkey with the sign-in passkey.

## Task console-proof: Console: paid, booked and archived on the invoice, and the archive page

Size: 45 min. Depends on: console-approve.

Read first: .handover/plan.md, sections 3, 5 and 'Task 10'. Work from engine-do.

Goal: on a paid invoice a person sees it paid, booked and archived, each with its proof.

Files: cloud/src/console.ts, src/ui/i18n.ts (EN and NL), tests.

Behaviour: three blocks on the invoice detail. Paid: the transfer's status, amount, fee and reference from GET /v1/payments and GET /v1/transactions, labelled 'stand-in bank, test money'. Booked: this invoice's journal lines from GET /v1/ledger/entries (debit and credit per account) and the ledger chain's head. Archived: this invoice's files from GET /v1/engine/vault (the original and the receipt), opened in the existing /pdfview frame from GET /v1/engine/vault/file. A new page #/archive shows the vault's folder tree with the same viewer. The folder names in the tree are the product's Dutch ones (Inkoopfacturen, Betalingen); show them as they are. DOM through el() and textContent only; the CSP unchanged.

Tests first: the string and CSP tests in test/cloud-console.test.ts; the Chromium check: after the approval of the console-approve task the three blocks are filled and a vault file opens in the viewer; no overflow at 390 px.

Checks: the test command on test/cloud-console.test.ts test/i18n-keys-used.test.ts test/i18n.test.ts; tsc; eslint; the Chromium check where Chromium is installed.

Out of scope: verifying the vault in the page, downloads as a zip, the month report (it needs a closed month).

# LANE engine-try

## Task try-lifecycle: A visitor's company: start, limits, what it may call, expiry

Size: 60 min. Depends on: engine-routes.

Read first: .handover/plan.md, sections 3, 5 and 'Task 11'. Work from engine-do. Do not edit cloud/src/demo.ts (branch cloud-demo-1112 owns the read-only demo mode).

Goal: a visitor gets a company of their own, for a day, on the same engine, and can call nothing but what the hands-on demo needs.

Files and interfaces:
- cloud/migrations/0001_init.sql: add CREATE TABLE IF NOT EXISTS try_companies (tenant_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, address_sha256 TEXT NOT NULL, visitor_sha256 TEXT NOT NULL, wiped_at TEXT) and an index on created_at; regenerate cloud/src/schema.ts (the same text as a string) so the schema test in test/cloud-core.test.ts stays green. ensureSchema applies it at run time.
- cloud/src/try.ts (new) and CloudEnv.tryIt?: { perAddressPerHour: number; perDay: number; hours: number } (set by the var HANDS_ON=on in cloud/src/worker.ts; defaults 5, 400 and 24; needs engine).
- POST /v1/try/start (public): makes tenant t_try_<16 hex> (a name from a fixed list ending in '(test)', language en) and an owner 'You (visitor)' the way POST /v1/admin/tenants does, seeds the engine (seed()), and answers { tenant, session, visitor_token, expires_at }. The address (cf-connecting-ip) is kept only as a hash salted per day. Over a limit: 429 with a sentence a person can read.
- POST /v1/try/session (public): { tenant_id, visitor_token } gives a fresh 15-minute session while the company lives; the token is stored hashed.
- The gate in route(): a caller whose tenant id starts with t_try_ may call only the routes in TRY_ROUTES (the reads of the read model, GET /v1/me, /v1/engine/*, POST /v1/auth/logout); every other route answers 403 with code try_only. Nobody can sign in to, enrol in or mail a try company. An expired one answers 410.
- scheduled: for every expired company not yet wiped: engine(id).wipe(), the tenant's rows deleted from every tenant table and its R2 prefix t/<id>/ removed (reuse what cloud/src/privacy.ts does for a closed company), then wiped_at set.

Tests first (test/cloud-try.test.ts, Node engine): off by default (404); start gives a session that works on the reads and the engine routes and is refused with try_only on keys, users, export, company, webhook and close; the sixth start from one address in an hour and a start over the day's limit are refused; the visitor token renews the session and a wrong one does not; an expired company answers 410; the sweep removes rows and blobs and calls wipe; a try session cannot read another try company; a try company's slug cannot be signed in to.

Checks: the test command on the new file and test/cloud-core.test.ts test/cloud-tenancy.test.ts test/cloud-security.test.ts test/cloud-golive.test.ts; tsc; eslint.

Out of scope: the console, the samples, Claude, a bot check (Turnstile) and WAF rules (the truth-and-guard task names them).

## Task try-world: The seeded world and the sample invoices

Size: 60 min. Depends on: engine-host.

Read first: .handover/plan.md, sections 3, 5 and 'Task 12'. Work from engine-do.

Goal: a visitor's company starts with money on its stand-in bank and a tray of sample invoices whose outcomes are what the engine's checks really answer. Nothing in a visitor's ledger is fabricated: no invented approvals or history.

Files and interfaces:
- cloud/scripts/samples.ts (new; npm run cloud:samples): renders the chosen fixture texts to PDF in Node (pdfOf of src/e2e/documents.ts) and writes cloud/src/engine/samples.gen.ts: export const SAMPLES: { key: string; title: string; filename: string; expect: { kind: string; status?: string; finding?: string }; base64: string }[].
- src/engine/host.ts: EngineDeps.samples?: the list; samples(): { key: string; title: string; filename: string }[] and uploadSample(key: string) (the same result as upload).
- Routes in the engine block of cloud/src/app.ts: GET /v1/engine/samples (read) and POST /v1/engine/samples/{key} (admin); 404 when the deployment has no samples. Add both to EngineApi and to cloud/src/engine/node.ts.

The samples (at least five; pick each by running it through the engine, and put the measured answer in expect): a clean invoice from a supplier on file that can be paid to the end (Bergtex Textil GmbH, EUR 1,850.00; test/fakes/apInvoices.ts EN, or fixtures/bergtex-invoice-BTX-2026-11.txt); the same file a second time (duplicate_document); a renumbered copy with the same total (fixtures/hard/bergtex-invoice-renumbered.txt: needs_review with possible_duplicate, measured on the spike in Node and in the object); changed bank details (try fixtures/hard/bergtex-invoice-subtle-iban.txt and bergtex-invoice-subtle-beneficiary.txt first; fixtures/bergtex-invoice-BTX-2027-01-BANKCHANGE.txt answers country_not_paid today, a true stop but not the fraud story); an unknown supplier (NL of test/fakes/apInvoices.ts); a hidden instruction to the reader (fixtures/hard/bergtex-invoice-hidden-injection.txt).

Tests first (test/engine-try-world.test.ts, Node, parserOnly): after seed() every sample gives exactly its expect; the clean one goes through propose, approve (FakeAuthenticator) and settle to paid with the stand-in bank's balance reduced; a test regenerates the samples and compares the extracted text with the committed file (and the bytes, if pdfkit's output proves stable).

Checks: the test command on the new file and test/cloud-engine.test.ts; tsc; eslint.

Out of scope: a visitor's own upload (the route exists; whether the demo offers it is decided in the truth-and-guard task); the console; Claude.

## Task try-claude: Real Claude in the object, under caps

Size: 60 min. Depends on: engine-host.

Read first: .handover/plan.md, sections 3, 5 and 'Task 13'. Work from engine-do. No real API call in any test, and no key in code, tests or logs.

Goal: the object reads invoices with Claude, as the runner does (Haiku classifies, Sonnet reads, Opus writes the review note, all through ClaudeReader), and can never spend past its caps: then the parser reads, and the events say so.

Files and interfaces:
- src/engine/budget.ts (new): interface Spend { reserve(micros: number): Promise<boolean>; settle(reserved: number, actual: number): Promise<void> }; cappedReader(inner: Asker, a: { db: DB; perCompanyMicros: number; day: Spend | null; estimateMicros: number }): Asker. Before a call it sums this ledger's claude.read audit rows (payload field cost_usd_micros) and reserves against the day; over either cap it answers with the fallback and the note 'budget', as budgetedReader in src/e2e/setup.ts does. Wrap ask and askPdf.
- cloud/src/engine/hostWorker.ts: with the var ENGINE_CLAUDE=on and the key in the Worker's secrets (KIT11_ANTHROPIC_API_KEY, read through process.env as claudeClient() does; this ran in workerd on the spike) the reader is cappedReader(new ClaudeReader(db), ...). Defaults: USD 0.15 per company (ENGINE_CLAUDE_COMPANY_MICROS = 150000) and USD 6 per UTC day (ENGINE_CLAUDE_DAY_MICROS = 6000000). The day's spend lives in a D1 table engine_spend (day TEXT PRIMARY KEY, micros INTEGER NOT NULL), added to cloud/migrations/0001_init.sql and cloud/src/schema.ts, reserved with one conditional UPDATE. Unset: parserOnly.
- EngineHost.status() gains reader: 'claude' | 'parser' and spent_micros.

Tests first (test/engine-budget.test.ts, with an Anthropic client on a stand-in fetch as in spike/do-runtime/probes/p5-claude.ts on origin/spike-do-lead): a reading by Claude is counted and its event carries the model and the cost; at the company cap the next reading is the parser's with the note; at the day cap likewise; with no key the parser reads and nothing is reserved; a refusal or a wrong shape falls back as today; a failed call settles its reservation back.

Checks: the test command on the new file and test/ap-inbox.test.ts test/ap-models.test.ts test/cloud-core.test.ts; tsc; eslint.

Out of scope: the tool-use agents of branch ap-agents-1112 (they join the engine when that branch lands), recorded fallbacks, per-network caps, an admin view.

## Task try-console: The hands-on entry of the console (the public demo)

Size: 60 min. Depends on: console-approve, try-lifecycle, try-world.

Read first: .handover/plan.md, sections 3, 5 and 'Task 14'. Work from engine-do.

Goal: the public hands-on demo: a visitor opens one address, gets a company of their own, and takes an invoice from the tray to paid, booked and archived with their own passkey.

Files: cloud/src/console.ts (a new open view and the try state), src/ui/i18n.ts (EN and NL), tests.

Behaviour: a new open view #/try (no session needed): one sentence on what this is, one button 'Start with a test company'. It calls POST /v1/try/start, keeps the answer ({ tenant, session, visitor_token, expires_at }) in sessionStorage, and opens the Invoices page with a banner ('A test company made for you. Test money. Gone at <time>.') and a tray 'Sample invoices' (GET /v1/engine/samples, one button each, POST /v1/engine/samples/{key}). Three short hints follow the visitor: drop an invoice, approve with your passkey, open the proof. The session renews through POST /v1/try/session before it ends. Settings, people, keys and sign-out are hidden for a try company; 'Start again' makes a new one. English by default for a try company. A device without passkeys (hasPasskeys() false) gets a clear sentence saying a passkey is needed (the test signer replaces it once the try-signer task lands). A 429 from start shows its sentence. DOM through el() and textContent only; the CSP unchanged; every label true ('test money', 'stand-in bank').

Tests first: test/cloud-console.test.ts: the new keys in both catalogues and the CSP. The Chromium check (test/browser/console.check.ts, engine and tryIt on): start, the clean sample, set up and approve with the virtual authenticator, paid, a vault file opens; the duplicate sample shows its finding; at 390 px nothing overflows; no console or CSP error.

Checks: the test command on test/cloud-console.test.ts test/cloud-try.test.ts test/i18n-keys-used.test.ts test/i18n.test.ts; tsc; eslint; the Chromium check where Chromium is installed.

Out of scope: the site's links to the demo, a tour, counters, an admin view, a visitor's own upload.

## Task truth-and-guard: Docs, claims, tenancy and abuse checks of the new surface

Size: 45 min. Depends on: engine-object, try-console.

Read first: .handover/plan.md, sections 2, 5, 7 and 'Task 15'. Work from engine-do.

Goal: what the product says stays true, and the new public surface is checked like the rest.

Steps:
1. docs/cloud.md: a section on the engine in the cloud: what runs where (one Durable Object per company, its own SQLite, the same engine as the runner), test money and the stand-in bank, the switches ENGINE_MODE, HANDS_ON and ENGINE_CLAUDE, the limits measured at the deploy gate (docs/runs/2026-11-13-engine-in-cloud.md), and what is not there: live Airwallex, e-mail into the object, new suppliers, batches and the month close in the console.
2. Every sentence that says the cloud only stores and shows, or never moves money or holds payment keys (search docs/, the header comment of cloud/src/console.ts, src/ui/i18n.ts, the site's pages and README), reworded to what is true: no real money moves from the cloud and it holds no payment keys; the engine there runs on test money. Update test/platform-in-main.test.ts (the test that holds status texts to the truth).
3. Extend test/cloud-golive.test.ts: no token, passkey answer, visitor token or account number in a log line of the engine and try routes. Check test/cloud-tenancy.test.ts covers every /v1/engine and /v1/try route against another company's objects.
4. Decide and record in docs/cloud.md: a visitor's own upload stays off (no var set) until a hostile PDF has been tried on a deployment, because PDFs are read on the object's own thread without the worker thread's 10 s and 256 MB limits; write down the limits that then apply (size, 200 pages, CPU per request).
5. List what a public launch still needs: a bot check, WAF rate rules, a budget alert, the daily sweep watched.

Checks: the test command on the touched tests; npm run lint; npm run typecheck.

Out of scope: new features; the site's design.

## Task try-signer: A test signer for devices without a passkey (stretch)

Size: 60 min. Depends on: console-approve.

Read first: .handover/plan.md, sections 3, 5 and 'Task 17'. Work from engine-do. Stretch: only after gate 2.

Goal: a visitor without a passkey can still sign: a key made in the page signs the same terms, the engine verifies it as any passkey, and every screen calls it what it is.

Files and interfaces:
- src/ui/testSigner.ts (new, WebCrypto only, no imports, runs in a browser and in Node 22): makeTestSigner(): Promise<{ register(c: { challenge: string; origin: string; rpId: string }): Promise<RegistrationResponseJSON>; sign(c: { challenge: string; origin: string; rpId: string; counter: number }): Promise<AuthenticationResponseJSON> }>. The same shapes src/redteam/authenticator.ts produces: ES256 (ECDSA P-256), user-verified flags, attestation 'none'; the COSE key and the attestation object encoded by hand (CBOR for these fixed shapes only); the signature converted from WebCrypto's raw r||s to DER. The private key is not extractable and lives for the page's life.
- cloud/src/console.ts: when hasPasskeys() is false (or creating a passkey failed twice) the approval set-up offers 'Use a test signer in this browser'. The passkey's label is 'Test signer (this browser), not Face ID'; it shows on the approval panel, in the events and on the receipt PDF (the label is what the engine records as the approver).
- src/ui/i18n.ts: the strings in EN and NL.

Tests first (test/ui-test-signer.test.ts, Node): verifyEnrolmentResponse and verifyApprovalSignature of src/passkey/webauthn.ts accept what it produces for the right challenge, origin and RP; other terms, another origin and a replayed counter are refused; through EngineHost the approval's audit row and the receipt PDF's extracted text carry the label.

Checks: the test command on the new file and test/passkey.test.ts test/cloud-console.test.ts test/i18n-keys-used.test.ts; tsc; eslint.

Out of scope: replacing WebAuthn where it exists; storing the key; the hosted product's own companies (the test signer is for try companies only: refuse it elsewhere).

# NOT IN A LANE (the orchestrator does these)

## Task deploy-gate: A deployment of its own, the chain once in production, and the record (gate 1)

Size: 45 min plus the owner's go. Depends on: engine-object.

Read first: .handover/plan.md, sections 4, 5 and 'Task 7'.

Goal: answer what local workerd cannot: does Cloudflare accept and run this Worker (start-up limit for a 7.5 MB script, CPU, memory, D1 queries per invocation). This needs the owner's go and Cloudflare credentials. Without them: prepare everything, run the dry run, and stop with a clear request.

Steps:
1. cloud/wrangler.try.jsonc (new): name purser-try, workers_dev true, its own D1 (location weur) and R2 (jurisdiction eu), RP_ID and ORIGIN of its workers.dev host, ENGINE_MODE 'test_money'. Secrets SESSION_SECRET and ADMIN_TOKEN_SHA256 set with wrangler secret put, never in a file or a log. No mail domain. No real data. Never deploy to an existing Worker: a Durable Object migration cannot be rolled back past.
2. scripts/engine-smoke.ts (new): against a base URL and the admin token it makes a company, enrols a software passkey for sign-in the way tenant() in test/support/cloud.ts does, signs in, then runs the engine flow with a FakeAuthenticator on the deployment's RP and origin: upload the fixture invoice, pay, set up the approval passkey, a signature over other terms (must be refused), approve, then read the invoice, the ledger entries and the vault files back. It prints the wall time of every step and exits non-zero on any mismatch.
3. Deploy, run the script three times with fresh companies, and write docs/runs/2026-11-13-engine-in-cloud.md: what ran, the upload size wrangler reported, whether the start-up check passed, time per step, every error word for word, and what was not tried.

Gate: pass when the three runs end paid, booked and archived. If the deploy is refused for start-up time or size: move execute for the host to a payables-only entry (new src/executors/payables.ts with the four payables kinds, so viem, ox and the browser code leave the bundle), load pdfkit and unpdf with import(), and try once more. Any other failure, or a second refusal: stop and report; the fallback of plan section 4 applies.

Checks: the dry run passes; the smoke script passes against the local cloud (testCloud with engine: true, or npm run cloud locally) before it is pointed at the deployment.

Out of scope: the product's own deployment, real companies, the console, real Claude or Airwallex keys.

