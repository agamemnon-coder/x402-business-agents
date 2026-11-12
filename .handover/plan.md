# The engine in a Durable Object per company: decision and port plan

Written 12 November 2026 by the tech lead of the spike, after two explorers' probes and a joined check.
Everything below ran in local workerd only (wrangler 4.155.0, workerd 1.20261023.1, `nodejs_compat`, compatibility date 2026-10-01). Nothing was deployed and no network call was made by any probe.

Branches (never merged as they are):

- `origin/spike-do-chain` (bd6a42e): the chain in a Durable Object, compared with Node row for row.
- `origin/spike-do-runtime` (9d5c649): PDF reading and writing, WebAuthn, Claude SDK, Airwallex client, the cloud seams.
- `origin/spike-do-lead` (worktree `/home/user/wt/spike-do-lead`): both merged, plus the joined probe in `spike/do-lead/`. Take code from here.

## 1. Decision: go, reduced

**Build now:** one SQLite-backed Durable Object per company in the cloud Worker, running the real payables engine on test money. It covers upload, reading, the checks, the proposal, a passkey approval over the exact terms, payment on the stand-in bank, the stored ledger and the vault, and it feeds the cloud's read model through the existing `batchesFor` and `applySync`. On top of it: the console actions, and the public hands-on demo, where every visitor gets a company of their own on that same engine.

**Later (after the submission):** real money from the cloud (the live Airwallex client with keys in the Worker, long retries as alarms, a call budget that survives a request), e-mail straight into the object, the console actions for new suppliers, batches, rejections and the month close, one passkey for sign-in and approval, a separate Worker that reads untrusted PDFs, and narrowing the `DB` type.

**Why reduced and not full:** the chain on test money is proven by running code. Real money in the cloud changes what the product promises ("the cloud never moves money and holds no payment keys"), needs secrets, alarms and a review, and none of that was run. It does not belong in the last two and a half days.

## 2. Evidence

### 2.1 Run by the tech lead today

| What | Result |
|---|---|
| The chain explorer's command, re-run (`spike/do/chain/all.sh /dev/shm/tl-verify-chain 3`) | 75 of 76 shim checks give the same answer as better-sqlite3 (the one difference: binding a bigint, which the engine never does). Golden comparison: 0 differences over 71 rows in 21 tables, 947 engine statements per chain in both runtimes, the same audit head, ledger head, terms hash and sync-batch hash. Ten steps: 56.9 ms wall, 37.0 ms CPU (median of 3 fresh objects, on a machine with load 18). |
| The joined probe (`unshare -n python3 spike/do/nonet.py node spike/do-lead/run.mjs`), new | The cloud Worker (`cloud/src/worker.ts`, unchanged) with one `Engine` object per company. Inside the object: the real chain with the engine's **real PDF text reader** (no stand-in), a signature over other terms refused, the right one approved, the invoice PAID (fee EUR 13.40), 7 ledger entries. Then `batchesFor` and the cloud's own `applySync` on D1 and R2: 18 D1 round trips (68 statements), 2 R2 writes, 64 ms. Then the vault into R2: the original, the payment receipt (pdfkit) and the suppliers list, plus `index.json`. The console's own API then shows AP-0001 paid, returns the document with the uploaded bytes, 7 ledger entries, 3 matched transactions, the trial balance. Another company sees nothing and its object holds no engine rows. Result: `spike/do-lead/results/lead-run.json`. |
| The catches, in the object and in Node (`spike/do-lead/tools/node-catches.ts`) | The same answers in both: the same file again is `duplicate_document`; a renumbered copy with the same total is `needs_review` with `possible_duplicate`; the repository's changed-bank-details fixture is `needs_review` with `country_not_paid` (not `possible_fraud`); paying a stopped invoice is refused and no proposal is made. |
| The object's memory dropped (as after an eviction) | The handle is rebuilt in 3 to 8 ms; the stand-in bank comes back from the object's SQLite with its transfer and balances; `syncPayments`, `syncLedger` and the feed change nothing; both chains verify. |
| The PDF reader on its largest job, inside the object | A 200-page text PDF (the engine's page limit; 216 KB, 892,229 characters): 643 and 741 ms on a machine with load 30. One page more is refused in 7 ms. |
| Documents in the object's SQLite | 15 MB in 1 MB pieces comes back intact. One row of 5 MB is accepted locally (production's row limit was not tested). |
| The feed again after the vault | Only the one new audit row travels; 14 D1 round trips. |
| Loading the engine on first use (`spike/do-lead/lazyWorker.ts`) | A thin object that imports nothing of the engine statically: before its first engine call the engine is not loaded (checked in the Worker and in the object); after it the chain pays as before. wrangler keeps `import()` as a lazy module (866 lazy module wrappers in the bundle). |
| Bundle (`wrangler deploy --dry-run -c spike/do-lead/wrangler.jsonc`) | Cloud Worker plus the whole engine: 7,520 KiB, gzip 1,706 KiB. |
| Node tests of the modules the merged tree touches | 18 files, 196 tests pass. |
| Two runtime probes re-run (`p5-claude`, `p6-airwallex`) | The Anthropic SDK, `ClaudeReader` and the agent loop work inside an object against a stand-in fetch; so does the Airwallex client. |
| The engine's own Node tests routed through the shim (`spike/do-lead/shim/`) | 48 test files, 513 tests, all pass with every ledger handle replaced by the shim over a SqlStorage stand-in (`npx vitest run --config spike/do-lead/shim/vitest.shim.config.ts …`): payables (inbox, pay, books, credit notes, scans, the server, the red-team files), approvals, executors, the ledger, the month, passkeys, batches, payouts, stock, the vault, the cloud sync. The first attempt, with a defect in the stand-in, failed 22 of 25 tests inside `src/db/doSql.ts`, which shows the tests really cross the shim. The stand-in is better-sqlite3 underneath, so this checks the shim's own logic, not workerd's SQLite; the chain run and the 76 checks in workerd cover that. |

### 2.2 Not run, so not known

- Production Cloudflare: the start-up limit for a 7.5 MB script, CPU per request, memory with pdf.js and a 15 MB document, D1 queries per invocation, the row size limit, the account's plan. Local workerd enforces none of these. First-answer times of a fresh local workerd (1.5 to 2.4 s) were the same with and without lazy loading, so local timing does not answer the start-up question. **The deploy gate (task 7) answers it.**
- Real Claude calls and real Airwallex calls from an object (stand-in fetch only).
- A slow or hostile PDF on the object's own thread (the worker thread's 10 s and 256 MB limits are gone there).
- Two requests interleaving in one object. The plan avoids the question: one engine action at a time per company.
- The console changes: no line of UI was tried.
- Flows not run in an object: new supplier, a payment in another currency, a batch, a rejection, the recheck, e-mail, the month close. Their code is in the bundle and loads; the shim suite (above) is the evidence that the database layer carries them.

### 2.3 What exactly must change

In the engine (five small changes, none changes what Node does; all exist on `origin/spike-do-lead` with their Node tests green, except the one line in `src/ap/detail.ts`, which is still to do):

1. `src/db/open.ts` split: the schema steps and migrations move unchanged to `src/db/migrate.ts` (`prepareDb`), which imports nothing from Node.
2. `src/db/doSql.ts`, new (381 lines): the better-sqlite3-shaped handle over `ctx.storage.sql` and `transactionSync`.
3. `src/ap/docStore.ts`, new: where a filed document's bytes live, per ledger. Used at six places: `inbox.ts` (write, recheck), `pay.ts`, `detail.ts`, `vault/build.ts`, `cloudsync/client.ts`.
4. `src/ap/pdfText.ts`: nothing Node-only runs at import, and a host may supply the reader; `src/ap/pdfTextInline.ts` is that reader for a runtime without worker threads.
5. `src/executors/index.ts`: `execute()` takes the rails as an optional last argument.

In the cloud Worker's config: the Durable Object binding and its migration (`new_sqlite_classes`), `define` for `import.meta.url`, `import.meta.dirname` and `import.meta.filename`, `alias` of `playwright` and `better-sqlite3` to a stub, a Text rule for `**/*.sql`. In Worker-only start code: `usePdfReader(readPdfInline)` and pdfkit's `registerStdFonts`.

New code: the engine's host (`src/engine/`), the feed, the object and its routes (`cloud/src/engine/`), the console actions, the visitor's company. The engine's schema, checks, executors, ledger and vault are not touched: `schema.sql` and `ledger.sql` are accepted by a Durable Object's SQLite as they are (71 tables, 83 indexes, 13 triggers).

## 3. Architecture

```
browser (console, cloud/src/console.ts)
   |  /v1/engine/*  (session or key; the tenant comes from the caller, never from the request)
cloud Worker (cloud/src/app.ts ROUTES)            cloud/src/entry.ts exports the Worker and the class
   |  env.engine(tenantId) -> EngineApi           CloudEnv.engine absent: every engine route answers 404
   |-- in tests and local runs: cloud/src/engine/node.ts   (EngineHost over openDb(":memory:"))
   |-- in the Worker: stub of CompanyEngine (cloud/src/engine/object.ts), named by the tenant id
          thin shell; loads cloud/src/engine/hostWorker.ts with import() on its first engine call
          EngineHost (src/engine/host.ts) over doDb(ctx.storage)   <- the REAL engine, unchanged
             documents: 1 MB pieces in the object's SQLite          (src/ap/docStore.ts seam)
             PDF text: readPdfInline                                 (src/ap/pdfText.ts seam)
             bank: FakeAirwallex kept in the object's SQLite         (src/engine/standInBank.ts)
             vault: R2 under t/<tenant>/vault/                       (src/vault VaultSink)
             feed: feedCloud -> batchesFor -> applySync(D1, R2)      (src/engine/feed.ts)
```

One class, `EngineHost`, holds every action. It takes a ledger handle and its outside world as arguments, so the plain vitest run tests it on better-sqlite3 and the object runs the same code on its own SQLite. Only two files know about Cloudflare: `object.ts` and `hostWorker.ts`.

Deployment switches (vars of the cloud Worker): `ENGINE_MODE=test_money` turns the engine routes on (with the `ENGINE` binding); `HANDS_ON=on` adds the public start of a visitor's company; `ENGINE_CLAUDE=on` lets the object call Claude under its caps. Unset, the Worker behaves as today.

## 4. Gates and the fallback

- **Gate 1, the deploy gate (task 7, as early as possible, needs the owner's go and Cloudflare credentials):** a deployment of its own (`purser-try`, own D1 and R2, no real data), the chain run once in production by a script, and what it measured written down. Pass: continue with the console and the demo. Fail on start-up or size: one retry with the payables-only executor entry and lazy pdfkit and unpdf. Fail again: the fallback.
- **Gate 2 (end of the next working day):** on that deployment a visitor's company goes from a sample invoice to paid, booked and archived with a real passkey on a phone.
- **Fallback:** the jury demo of design v1 (`/home/user/x402-business-agents-keys/plans/2026-11-12/jury-demo/design-v1.md`: the `/go` page on the kit11 Worker with a small orchestration layer over shared pure modules), cut to its must-have line, beside the read-only cloud demo of branch `cloud-demo-1112`. The seams of tasks 1 and 2 stay merged (they change nothing in Node) and the engine object ships after the submission. The sample invoices (task 12) and the Claude caps (task 13) are written so that the fallback can use them too.
- Do not start the design v1 build while gate 1 is open: it is a second implementation of the same chain.

## 5. Rules for every task

- Work in your own git worktree from `origin/platform` (tasks 1, 2 and 16) or from the integration branch `engine-do` (all others; it starts at `origin/platform` plus tasks 1 and 2). Link `node_modules` and `worker/node_modules` from `/home/user/x402-business-agents`. Install nothing.
- Tests first. The test command: `env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY TMPDIR=/dev/shm npx vitest run --maxWorkers=2 <files>`. Then `npx tsc --noEmit` and `npx eslint src test cloud/src`.
- workerd tests run only where wrangler's toolchain is linked (`CLOUD_DB=d1`, `npm run test:d1`); in the plain run such a file registers one test that says so. No network: run local workerd under `unshare -n python3 spike/do/nonet.py` or with proxies unset, as the spikes do.
- Small commits, pushed after each: `git -c user.name="Max Geurtsen" -c user.email="278151174+agamemnon-coder@users.noreply.github.com" commit`, each message ending with the two trailer lines the orchestrator gives. Never force-push. No secrets in code, tests or logs.
- A change to a shared engine module must keep that module's Node tests green and must change nothing when no store, reader or rails are handed in.
- Console work: DOM through `el()` and `textContent` only, the nonce CSP unchanged, every string in both catalogues of `src/ui/i18n.ts` (`cs.` keys). Words on a page must be true: "test money" and "stand-in bank" wherever money moves.
- Names are fixed by this plan: binding `ENGINE`, class `CompanyEngine`, vars `ENGINE_MODE`, `HANDS_ON`, `ENGINE_CLAUDE`, directories `src/engine/` and `cloud/src/engine/`, routes under `/v1/engine/` and `/v1/try/`.
- Concurrent work: branch `cloud-demo-1112` (the read-only demo mode) also edits `cloud/src/app.ts` and `cloud/src/worker.ts`. Do not edit `cloud/src/demo.ts`; keep engine and try code in their own files and their route entries in one block of `ROUTES`.

## 6. Tasks

Order: 1 and 2 (in parallel), 3, 4, 5, 6, 7 (gate), then 8 to 10 and 11 to 14 (two lanes), 15; 16 and 17 beside them.

| # | Key | What | Size | Needs |
|---|---|---|---|---|
| 1 | db-seam | Migrations split from the opener; the Durable Object handle (shim) with its checks | 60 min | none |
| 2 | io-seams | Documents, PDF text and rails handed in by the host | 60 min | none |
| 3 | engine-host | One company's engine as a set of actions, on any ledger handle | 60 min | 2 |
| 4 | engine-feed | The read model's feed: only what changed, through `applySync` | 45 min | 3 |
| 5 | engine-routes | `/v1/engine/*` with a Node engine for tests | 60 min | 3, 4 |
| 6 | engine-object | The Durable Object, its wrangler config, the workerd test | 60 min | 1, 5 |
| 7 | deploy-gate | A deployment of its own, the chain once in production, the record | 45 min plus the owner | 6 |
| 8 | console-upload-live | Upload an invoice; watch the agents work | 60 min | 5 |
| 9 | console-approve | Pay, set up the passkey, approve the exact terms | 60 min | 8 |
| 10 | console-proof | Paid, booked, archived on the invoice; the archive page | 45 min | 9 |
| 11 | try-lifecycle | A visitor's company: start, limits, what it may call, expiry | 60 min | 5 |
| 12 | try-world | The seeded world and the sample invoices | 60 min | 3 |
| 13 | try-claude | Real Claude in the object, under caps | 60 min | 3 |
| 14 | try-console | The hands-on entry of the console | 60 min | 9, 11, 12 |
| 15 | truth-and-guard | Docs, claims, tenancy and abuse checks of the new surface | 45 min | 6, 14 |
| 16 | shim-suite | The engine's Node tests routed through the shim, as a standing check | 45 min | 1 |
| 17 | try-signer | A test signer for devices without a passkey (stretch) | 60 min | 9 |

### Task 1: db-seam

**Goal.** The engine's schema and migrations run on any SQLite handle, and a better-sqlite3-shaped handle exists for a Durable Object's SQLite. Nothing changes in Node.

**Start from.** `git checkout origin/spike-do-lead -- src/db/migrate.ts src/db/open.ts src/db/doSql.ts`. The 76 checks are in `spike/do/conformance.ts`; a SqlStorage stand-in over better-sqlite3 is in `spike/do-lead/shim/doStorage.ts`; the workerd run is in `spike/do/conformance-run.ts`, `spike/do/conformanceWorker.ts` and `spike/do/mf.mjs`.

**Files and interfaces.**
- `src/db/migrate.ts` (new): `prepareDb(db: DB, schema: string, ledger: string): void` and `settlementsTable`, with no Node import.
- `src/db/open.ts`: keeps `openDb`, `type DB`, the WAL retry; reads the two `.sql` files and calls `prepareDb`.
- `src/db/doSql.ts` (new): `DoStorage`, `DoCursor`, `DoDatabase`, `DoStatement`, `SqliteError`, `scanSql`, `asSqliteError`, and `export function doDb(storage: DoStorage, name?: string): DB`, the one documented cast from `DoDatabase` to `DB`.
- `test/support/doStorage.ts` (new): `sqliteDoStorage(db: Database.Database): DoStorage`. It answers as SqlStorage does where the shim depends on it: values by position, BLOBs as ArrayBuffer, errors worded `<message>: SQLITE_X (extended: SQLITE_X_Y)`, BEGIN, COMMIT and SAVEPOINT refused, `transactionSync` as savepoints.
- `test/support/dbConformance.ts` (new): `conformance(db): [string, string][]`.

**Tests first.** `test/db-do-sql.test.ts`: (1) `scanSql` on positional, numbered (`?3`), `@a`, `:a`, `$a` and repeated names, parameters inside strings and comments ignored, a `CREATE TRIGGER … BEGIN … END` counted as one statement, `RETURNING`; (2) the 76 checks give the same answer on better-sqlite3 and on `doDb(sqliteDoStorage(…))`, except "bind bigint"; (3) `prepareDb` over the shim leaves the same `sqlite_master` rows (type, name, sql) as `openDb(":memory:")`. `test/db-do-sql-workerd.test.ts` (only with `CLOUD_DB=d1`; add it to `vitest.d1.config.ts`): the same checks inside a SQLite-backed Durable Object through Miniflare, 75 of 76 equal.

**Checks.** The test command on the two new files and `test/ap-migration.test.ts test/ap-inbox.test.ts test/passkey.test.ts test/cloud-sync.test.ts test/ledger-core.test.ts`; tsc; eslint.

**Out of scope.** Narrowing `type DB`; any change to `schema.sql` or `ledger.sql`; `cloud/`; the `spike/` directories.

### Task 2: io-seams

**Goal.** Document bytes, PDF text and payment rails become things a host hands in. With nothing handed in, Node behaves exactly as today.

**Start from.** `origin/spike-do-lead`: `src/ap/docStore.ts`, `src/ap/inbox.ts`, `src/ap/pay.ts`, `src/cloudsync/client.ts`, `src/executors/index.ts`, `src/ap/pdfText.ts`, `src/ap/pdfTextInline.ts`, `src/vault/build.ts`.

**Files and interfaces.**
- `src/ap/docStore.ts` (new): `interface DocStore { put(sha256: string, bytes: Uint8Array): string; get(path: string): Buffer }`, `useDocStore(db: DB, store: DocStore): void`, `docStoreOf(db)`, `readDoc(db: DB, path: string): Buffer`. `put` returns what `ap_documents.path` keeps.
- Readers switched to `readDoc`: `src/ap/inbox.ts` (the write in `ingestDocument`, the read in `recheck`), `src/ap/pay.ts`, `src/ap/detail.ts` (the `readFileSync(doc.path)` near line 142), `src/vault/build.ts` (in `plan`), `src/cloudsync/client.ts` (`batchesFor`).
- `src/ap/pdfText.ts`: `type PdfReader = (bytes: Uint8Array, maxPages: number) => Promise<{ text: string; pages: number }>`, `usePdfReader(r: PdfReader | null): void`; the unpdf path is worked out when the first worker thread starts, not at import. The decode budget is checked first either way. `src/ap/pdfTextInline.ts` (new): `readPdfInline: PdfReader`.
- `src/executors/index.ts`: `export type Rails`; `execute(db, proposalId, read?, hub?, rails?)`, the rails passed to `executeApproved` and to the batch executor; without them `airwallexFromEnv()` as before.

**Tests first.** `test/ap-docstore.test.ts`: with a memory store, `ingestDocument` writes no file under `<dir>/docs` and `ap_documents.path` is `put()`'s value; `payApInvoice`, `recheck`, the invoice detail, `batchesFor` and `syncVault` read through it; with no store, as today. `test/ap-pdftext-reader.test.ts`: `readPdfInline` gives the same text as the worker-thread reader for `pdfOf(EN)` of `test/fakes`; with a reader set the decode budget still refuses the bomb of `test/ap-redteam2.test.ts`; `usePdfReader(null)` puts the worker thread back (reset in `afterEach`). `test/executors-rails.test.ts`: `execute` with `{ rail, sim }` of a `FakeAirwallex` pays with no `AIRWALLEX_*` set.

**Checks.** The test command on the three new files and `test/ap-inbox.test.ts test/ap-pay.test.ts test/ap-detail.test.ts test/ap-redteam2.test.ts test/ap-review-fixes.test.ts test/rt4-web.test.ts test/vault-build.test.ts test/vault-data.test.ts test/vault-hook.test.ts test/vault-pdf.test.ts test/vault-reports.test.ts test/vault-remote.test.ts test/vault-page.test.ts test/cloud-sync.test.ts test/cloud-cli-exit.test.ts test/executors-dispatch.test.ts test/payment-batch.test.ts`; tsc; eslint.

**Out of scope.** R2, storage in pieces, `cloud/`. The Node servers that serve a PDF from disk (`src/servers/payables.ts`, `src/vault/page.ts`) stay on files.

### Task 3: engine-host

**Goal.** One company's engine as a small set of actions on a ledger handle: the same class for the Node tests and for the Durable Object. Every call it makes already exists; `spike/do/chain/chain.ts` and `spike/do-lead/leadWorker.ts` show each one.

**Files and interfaces.**
- `src/engine/standInBank.ts` (new): `interface BankStore { load(): string | null; save(text: string): void }`; `bankToText(b: FakeAirwallex): string` (every own field that is not a function; a Map as `{ __map: [...] }`); `bankFromText(text): FakeAirwallex`; `standInBank(store: BankStore): FakeAirwallex` (restored when the store holds one).
- `src/engine/events.ts` (new): `interface EngineEvent { seq: number; ts: string; actor: string; event: string; subject: string | null; fields: Record<string, string | number | boolean | null> }` and `publicEvent(row): EngineEvent`. `fields` holds a short allowlist per event (model, source `claude` or `fallback`, status, finding codes, amount, currency, request id, cost in micro-USD); an event not on the list carries no fields. List the events by reading the `audit(` calls of `src/ap`, `src/claude`, `src/passkey`, `src/policy/approvals.ts`, `src/executors`, `src/ledger`, `src/vault`.
- `src/engine/host.ts` (new):

```ts
export const parserOnly: Asker;   // the reader that always takes the parser
export interface EngineDeps {
  db: DB; reader: Asker; rails: Rails; afterMoney?: () => void;
  rp: { rpId: string; origin: string }; company: { name: string; lang: "en" | "nl" };
  vault: VaultSink | null; feed: ((db: DB, now: Date) => Promise<unknown>) | null; now?: () => Date;
}
export interface ProposalView { id: string; kind: string; status: string; terms_sha256: string; challenge: string; facts: [string, string][] }
export interface InvoiceView { id: string; status: string; status_words: string; payable: boolean; vendor: string; invoice_no: string; currency: string; total: string; due_date: string; read_by: string; findings: { level: string; code: string; message: string }[]; doc_sha256: string; proposal: ProposalView | null }
export interface Settled { invoice_status: string | null; transfer_status: string | null; ledger_entries: number; vault_added: string[]; fed: boolean; error: string | null }
export class EngineHost {
  constructor(deps: EngineDeps);
  status(): Promise<{ mode: "test_money"; passkey: { credential_id: string; label: string } | null; balances: Record<string, string>; chains: { audit: boolean; ledger: boolean } }>;
  seed(): Promise<void>;                                   // seedTreasury on the rails; safe to repeat
  upload(doc: { bytes: Uint8Array; filename: string; mime?: string }): Promise<{ kind: string; sha256: string; invoice: InvoiceView | null }>;
  invoices(): InvoiceView[];
  invoice(id: string): InvoiceView | null;
  propose(invoiceId: string): Promise<{ ok: true; proposal: ProposalView } | { ok: false; reason: string }>;
  proposal(id: string): ProposalView | null;
  passkeyStart(): { challenge: string; code: string; exclude: string[] };
  passkeyFinish(a: { code: string; credential: unknown; label: string }): Promise<{ ok: true; credential_id: string } | { ok: false; reason: string }>;
  approve(a: { proposal_id: string; terms_sha256: string; credential: unknown }): Promise<{ status: string; message: string; settled: Settled | null }>;
  sync(): Promise<Settled>;                                // syncPayments, syncLedger, the vault, the feed; safe to repeat
  events(after: number, limit?: number): { items: EngineEvent[]; next: number };
  vaultFiles(): Promise<{ path: string; kind: string; bytes: number; sha256: string; added_at: string }[]>;
  vaultFile(path: string): Promise<Uint8Array | null>;    // only a path the index lists
}
```

- `ProposalView.challenge` is `challengeFor(terms_sha256)`; `facts` come from `payablesFacts` and `firstScreenFacts` of `src/approve/client.ts`, so the console shows what the phone page shows.
- `passkeyFinish` runs `processRegistration` and then confirms the pending passkey itself (`pendingPasskeys`, `confirmPasskey`): in the cloud the signed-in owner's session is the confirmation a person gives on a runner.
- `approve` runs `processAssertion`; on `approved` it runs `execute(db, id, undefined, undefined, rails)`, calls `afterMoney`, then `sync()`. An error in `execute` or `sync` comes back in `settled.error` and is never swallowed; the approval stays.
- Every method that writes runs through one queue per host (one engine action at a time); `invoices`, `invoice`, `proposal`, `events` and `status` do not wait for it.

**Tests first** (`test/engine-host.test.ts`, on `openDb(":memory:")`, `standInBank` with a memory store, `parserOnly`, an in-memory `VaultSink`, `FakeAuthenticator`): (1) the chain: upload `pdfOf(EN)`, ready with no findings; propose; set up the passkey; a signature over other terms is refused and nothing runs; the right one approves; settled says paid, PAID, 7 entries, three vault files; both chains verify. (2) The catches: the same bytes again is `duplicate_document`; a renumbered copy is `needs_review`; `propose` on it answers `ok: false` with the engine's reason and adds no proposal. (3) `sync()` twice: the second adds nothing. (4) A second host on the same ledger and bank store shows the same balances and its `sync()` changes nothing. (5) Two `approve` calls at once run one after the other and make one transfer. (6) `events` pages by `seq`, and no event carries the invoice's IBAN.

**Checks.** The test command on the new file and `test/ap-inbox.test.ts test/ap-pay.test.ts test/passkey.test.ts test/executors-dispatch.test.ts test/vault-build.test.ts`; tsc; eslint.

**Out of scope.** `cloud/`, the Durable Object, real Claude, rejecting, new suppliers, batches, the month close.

### Task 4: engine-feed

**Goal.** After an engine action the cloud's read model holds what the ledger holds, through the code a runner's push uses, and a feed costs D1 only for what changed.

**Files and interfaces.**
- `src/engine/feed.ts` (new): `interface FeedTarget { state(): Promise<CloudState>; apply(batch: Record<string, unknown>): Promise<unknown> }`; `feedCloud(db: DB, target: FeedTarget, now?: Date, opts?: { all?: boolean }): Promise<{ batches: number; sent: Record<"documents" | "vendors" | "invoices" | "payments" | "transactions" | "ledger_entries" | "audit_rows", number>; applied: unknown[] }>`. It runs `syncLedger` (as `pushToCloud` does), then `batchesFor(db, await target.state(), { now })`, then drops every vendor, invoice, payment and transaction whose content was already sent: a table the feed makes itself, `cloud_feed_sent (kind TEXT, id TEXT, sha256 TEXT, PRIMARY KEY (kind, id))`, holds a hash per row (a vendor's `updated_at` is left out of its hash: `batchesFor` stamps it with now). Hashes are stored only after `apply` succeeded. A batch left empty is not sent. `all: true` sends everything.
- `cloud/src/sync.ts`: `export async function syncState(db: TenantDb): Promise<{ audit: { seq: number; hash: string | null }; ledger: { entry_id: number; hash: string | null }; documents: string[] }>`, taken out of the `GET /v1/sync/state` route in `cloud/src/app.ts`, which then calls it.
- `cloud/src/engine/target.ts` (new): `cloudTarget(db: TenantDb, blobs: Blobs, now: () => Date): FeedTarget`; `apply` is `applySync(db, blobs, SyncBatch.parse(batch), now())` with no caller named (no key guard: the engine is not a sync key).

**Tests first** (`test/engine-feed.test.ts`, Node: an `EngineHost` world and `testCloud()` from `test/support/cloud.ts`, a `TenantDb` over its `env.sql`): after the chain and a feed, `GET /v1/invoices` with the tenant's key shows AP-0001 paid, the document's bytes are the uploaded ones, 7 ledger entries; a second feed sends nothing and makes at most 3 Sql calls (count through a wrapper); a second invoice sends only that invoice, its document and the new chain rows; a changed invoice status travels as a new version.

**Checks.** The test command on the new file and `test/cloud-sync.test.ts test/cloud-core.test.ts`; tsc; eslint.

**Out of scope.** The Durable Object, routes, the health report, the Airwallex binding, mail.

### Task 5: engine-routes

**Goal.** The engine's actions as routes of the cloud's API, with the cloud's own gates, tested in the plain run on a Node engine.

**Files and interfaces.**
- `cloud/src/engine/api.ts` (new): `interface EngineApi`: the methods of `EngineHost` (task 3), every one async, arguments and results plain data (bytes as `Uint8Array`), plus `wipe(): Promise<void>`.
- `cloud/src/engine/node.ts` (new): `nodeEngines(env: { sql: Sql; blobs: Blobs; rpId: string; origin: string; now?: () => Date }): (tenantId: string) => EngineApi`: one `EngineHost` per tenant over `openDb(":memory:")`, the stand-in bank in memory, a vault sink over `blobs` under `t/<tenant>/vault/`, the feed through `cloudTarget`. For tests and local runs.
- `cloud/src/app.ts`: `CloudEnv.engine?: (tenantId: string) => EngineApi` and one block of `ROUTES`. The tenant is always `c.caller.tenantId`. With `engine` absent every route below answers 404.

| Route | Needs | Body and answer |
|---|---|---|
| `GET /v1/engine` | read | `status()` |
| `POST /v1/engine/documents` | admin | `{ filename (1 to 200), mime?, base64 }`, body at most 22,000,000 bytes, 15 MB decoded; answers `{ kind, sha256, invoice }` |
| `GET /v1/engine/invoices` | read | `{ items: InvoiceView[] }` |
| `POST /v1/engine/invoices/{id}/pay` | admin | 200 `{ proposal }`, or 409 with the engine's reason |
| `GET /v1/engine/proposals/{id}` | read | `{ proposal }` or 404 |
| `POST /v1/engine/passkey/start` | admin, a session only | `{ challenge, code, rp: { id, name: "Purser" }, user: { id, name, displayName }, exclude }` |
| `POST /v1/engine/passkey/finish` | admin, a session only | `{ code, credential }`; the label is the signed-in person's display name |
| `POST /v1/engine/proposals/{id}/approve` | admin, a session only | `{ terms_sha256, credential }`; answers `{ status, message, settled }` |
| `POST /v1/engine/sync` | admin | `Settled` |
| `GET /v1/engine/events` | read | `?after=<seq>&limit=<1 to 200>`; answers `{ items, next }` |
| `GET /v1/engine/vault` | read | `{ files }` |
| `GET /v1/engine/vault/file` | read | `?path=`; the PDF, `content-disposition: attachment`, `nosniff`, `no-store`; 404 for a path the index does not list |

A key cannot run a passkey ceremony for a person: the three passkey routes refuse a caller whose `kind` is not `session` with 403.

- `test/support/cloud.ts`: `testCloud({ engine: true })` wires `nodeEngines`.

**Tests first** (`test/cloud-engine.test.ts`): the whole flow over HTTP with an owner's session (upload, pay, passkey start and finish with `FakeAuthenticator` on the test cloud's RP and origin, a signature over other terms refused, approve, settled), then the read model's `GET /v1/invoices` shows paid; a viewer and a read-only key get 403 on every POST and 200 on the reads; an admin key gets 403 on the passkey routes; another company's session gets 404 for the invoice, the proposal and the vault file; with no engine wired every route answers 404; a body over the cap is refused; a POST with another Origin is refused. Extend `test/cloud-tenancy.test.ts` so its walk over `ROUTES` covers the new routes.

**Checks.** The test command on the new file and `test/cloud-core.test.ts test/cloud-auth.test.ts test/cloud-tenancy.test.ts test/cloud-security.test.ts test/cloud-console.test.ts test/cloud-golive.test.ts`; tsc; eslint.

**Out of scope.** The Durable Object, the console, the visitor's company, real Claude.

### Task 6: engine-object

**Goal.** The Durable Object: one per company, the real engine on its own SQLite, behind the routes of task 5. A transplant of `spike/do-lead/leadWorker.ts` (which ran) into the cloud's tree, with the engine loaded on first use as in `spike/do-lead/lazyWorker.ts`.

**Files and interfaces.**
- `cloud/src/engine/object.ts` (new): `export class CompanyEngine extends DurableObject`. It imports types only; `async call(tenantId: string, method: keyof EngineApi, args: unknown[]): Promise<unknown>` loads `./hostWorker.js` with `import()` on first use and passes the call on; `wipe()` runs `ctx.storage.deleteAll()`. The tenant id comes with every call and is pinned on first use (a row in the object's own table); another id is refused. Do not rely on `ctx.id.name`.
- `cloud/src/engine/hostWorker.ts` (new): `openHost(ctx, env, tenantId): Promise<{ api: EngineApi }>`. `doDb(ctx.storage)`, `prepareDb(db, SCHEMA, LEDGER)` with the two `.sql` files imported as text; documents through `cloud/src/engine/docChunks.ts` (new: a `DocStore` in 1 MB pieces, table `do_doc_chunks (sha256, n, bytes)`); `usePdfReader(readPdfInline)`; pdfkit's `registerStdFonts(Helvetica, HelveticaBold, HelveticaOblique)` once; `standInBank` kept in a row of the object's table and saved in `afterMoney`; `parserOnly` as the reader; the vault through `cloud/src/engine/vaultR2.ts` (new: a `VaultSink` over `Blobs` under `t/<tenant>/vault/`); the feed through `cloudTarget(new TenantDb(d1Sql(env.DB), tenantId), r2Blobs(env.DOCS), …)`; the company's name and language read once from D1's `tenants`.
- `cloud/src/entry.ts` (new): `export { default } from "./worker.js"; export { CompanyEngine } from "./engine/object.js";`. `cloud/src/worker.ts` stays importable in Node: `Bindings` gains `ENGINE?` and `ENGINE_MODE?`, and `envOf` sets `engine` (a stub whose every method is `stub.call(tenantId, method, args)`) only when both are there.
- `cloud/wrangler.jsonc`: `main: "src/entry.ts"`; `durable_objects.bindings: [{ name: "ENGINE", class_name: "CompanyEngine" }]`; `migrations: [{ tag: "v1", new_sqlite_classes: ["CompanyEngine"] }]`; `define` for `import.meta.url`, `import.meta.dirname` and `import.meta.filename`; `alias` of `playwright` and `better-sqlite3` to `cloud/src/engine/stub.ts` (throws when used); `rules: [{ type: "Text", globs: ["**/*.sql"], fallthrough: true }]`. The values that passed a dry run are in `spike/do-runtime/wrangler.cloud-engine.jsonc` and `spike/do-lead/wrangler.jsonc`.
- `cloud/src/engine/modules.d.ts` (new): ambient modules for `*.sql`, `cloudflare:workers` and `pdfkit/standard-fonts/*`.

**Tests first.** `test/cloud-engine-bundle.test.ts` (plain run, esbuild from `node_modules` with a metafile): from `cloud/src/entry.ts` no static import reaches `src/ap/`, `src/executors/`, `src/ledger/`, `src/vault/`, `src/passkey/`, pdfkit, unpdf or viem (only the dynamic import of `hostWorker` does), and the bundle stays under 9 MB. `test/cloud-engine-workerd.test.ts` (only with `CLOUD_DB=d1`; add to `vitest.d1.config.ts`): the bundle of `cloud/src/entry.ts`, built with the alias, define and rules read from `cloud/wrangler.jsonc`, in Miniflare with the object, D1 and R2; through the routes only (a session made with `sessionToken` and the test's secret): the chain of task 5's test, the read model shows paid, the document's bytes match, the vault lists three files, another company gets 404 and an empty engine.

**Checks.** `npm run test:d1 -- test/cloud-engine-workerd.test.ts test/db-do-sql-workerd.test.ts`; the plain test command on `test/cloud-*.test.ts`; `worker/node_modules/.bin/wrangler deploy --dry-run --outdir /dev/shm/x -c cloud/wrangler.jsonc` (no deploy) prints the `ENGINE` binding; tsc; eslint.

**Out of scope.** Any deploy; alarms; e-mail; real Airwallex; real Claude; the visitor's company.

### Task 7: deploy-gate

**Goal.** Answer what local workerd cannot: does Cloudflare accept and run this Worker. Needs the owner's go and the Cloudflare credentials; without them prepare everything, run the dry run and stop.

**Steps.**
1. `cloud/wrangler.try.jsonc` (new): name `purser-try`, `workers_dev: true`, its own D1 (weur) and R2 (eu), `RP_ID` and `ORIGIN` of its workers.dev host, `ENGINE_MODE: "test_money"`; secrets `SESSION_SECRET` and `ADMIN_TOKEN_SHA256` set with `wrangler secret put`, never in a file. No mail domain. No real data.
2. `scripts/engine-smoke.ts` (new): against a base URL and the admin token it makes a company, enrols a software passkey for sign-in the way `test/support/cloud.ts` `tenant()` does, signs in, then runs the engine flow with a `FakeAuthenticator` on the deployment's RP and origin: upload the fixture invoice, pay, set up the passkey, a signature over other terms (refused), approve, then read the invoice, the ledger entries and the vault files back. It prints the wall time of every step.
3. Deploy, run the script three times with fresh companies, and write `docs/runs/2026-11-13-engine-in-cloud.md`: what ran, the upload size wrangler reported, whether the start-up check passed, time per step, every error word for word, and what was not tried.

**Gate.** Pass: the three runs end paid, booked and archived. If the deploy is refused for start-up time or size: move `execute` for the host to a payables-only entry (new `src/executors/payables.ts` with the four payables kinds, so viem, ox and the browser code leave the bundle), load pdfkit and unpdf with `import()`, and try once more. Any other failure, or a second refusal: stop and report; the fallback of section 4 applies.

**Out of scope.** The product's own deployment, real companies, the console.

### Task 8: console-upload-live

**Goal.** In the console a person uploads an invoice and watches the engine work on it.

**Files.** `cloud/src/console.ts`, `src/ui/i18n.ts` (keys `cs.eng.*` in both catalogues), `src/ui/engineEvents.ts` (new, pure: `eventLine(e: EngineEvent, lang): { who: string; text: string; tag: "claude" | "parser" | "code" | null }`), tests.

**Behaviour.** When `GET /v1/engine` answers 200: the Invoices page shows "Upload invoice" (a button and a drop zone; PDF, JPEG or PNG up to 15 MB; read with `FileReader`, sent as base64 to `POST /v1/engine/documents`) and a panel "At work" that lists the engine's events as they arrive: it polls `GET /v1/engine/events?after=<seq>` every 800 ms while a request is under way and for 10 s after, and stops when the page is hidden. Each line says who did it (the model's name with "Claude", or "the parser", or "code"), what, and when. The invoice list reloads when an event says an invoice arrived, was paid or was filed. The header says "Engine: test money" beside the existing "Test money" chip. A refused upload shows the engine's reason.

**Tests first.** `test/ui-engine-events.test.ts`: every event on the allowlist of `src/engine/events.ts` has a line in English and Dutch; an unknown event gives a neutral line, never raw JSON. `test/cloud-console.test.ts`: the page carries the new keys, both catalogues hold them, the CSP is unchanged. `test/browser/console.check.ts` (the Chromium check, with `engine: true`): upload the fixture PDF, the row appears as ready, the panel shows lines, no console or CSP error, no overflow at 390 px.

**Checks.** The test command on the two test files and `test/i18n-keys-used.test.ts test/i18n.test.ts test/cloud-console-invites.test.ts`; tsc; eslint; the Chromium check where Chromium is installed.

**Out of scope.** Paying and approving, the archive, the visitor's company.

### Task 9: console-approve

**Goal.** From a ready invoice to an approved payment, with a passkey that signs exactly the terms on the screen.

**Behaviour** (invoice detail, `invoiceView` in `cloud/src/console.ts`): a ready invoice shows "Pay…"; it calls `POST /v1/engine/invoices/{id}/pay` and shows the proposal: the facts as the phone page words them, the full terms hash behind a fold, and one sentence saying that the passkey signs exactly these terms. The first time: "Set up approval on this device" (`/v1/engine/passkey/start`, then `navigator.credentials.create` with the server's user id, `excludeCredentials`, user verification required, attestation none, then `/v1/engine/passkey/finish`). Then "Approve with passkey": `navigator.credentials.get` with `challenge` the proposal's `challenge`, `rpId`, `allowCredentials` holding the engine's credential, user verification required; the answer serialised as `@simplewebauthn/server` reads it (adapt the serialisers of `src/approve/client.ts`) and posted to `/v1/engine/proposals/{id}/approve`. The page shows the engine's own message for approved and for refused. An invoice that is not ready shows its findings and the engine's reason why it cannot be paid. After approval the "At work" panel carries on (paid, booked, filed) and the status chip follows.

**Tests first.** `test/cloud-console.test.ts`: the new keys and the unchanged CSP. The Chromium check with its virtual authenticator: upload, pay, set up, approve, the status reads paid; a second pass changes `terms_sha256` in the request and the page shows the refusal.

**Checks.** As task 8.

**Out of scope.** Rejecting, batches, new suppliers, the archive page, a second approver.

### Task 10: console-proof

**Goal.** On a paid invoice a person sees it paid, booked and archived, each with its proof.

**Behaviour.** Three blocks on the invoice detail. Paid: the transfer's status, amount, fee and reference from `GET /v1/payments` and `GET /v1/transactions`, labelled "stand-in bank, test money". Booked: this invoice's journal lines from `GET /v1/ledger/entries` (debit and credit per account) and the ledger chain's head. Archived: this invoice's files from `GET /v1/engine/vault` (the original and the receipt), opened in the existing `/pdfview` frame from `GET /v1/engine/vault/file`. A new page `#/archive` shows the vault's folder tree with the same viewer. The folder names in the tree are the product's Dutch ones; show them as they are.

**Tests first.** The string and CSP tests; the Chromium check: after the approval of task 9 the three blocks are filled and a vault file opens in the viewer.

**Checks.** As task 8.

**Out of scope.** Verifying the vault in the page, downloads as a zip, the month report (it needs a closed month).

### Task 11: try-lifecycle

**Goal.** A visitor gets a company of their own, for a day, on the same engine, and can call nothing but what the hands-on demo needs.

**Files and interfaces.**
- `cloud/migrations/0001_init.sql`: add `CREATE TABLE IF NOT EXISTS try_companies (tenant_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, address_sha256 TEXT NOT NULL, visitor_sha256 TEXT NOT NULL, wiped_at TEXT)` with an index on `created_at`; regenerate `cloud/src/schema.ts` so the schema test in `test/cloud-core.test.ts` stays green (`ensureSchema` applies it at run time).
- `cloud/src/try.ts` (new) and `CloudEnv.tryIt?: { perAddressPerHour: number; perDay: number; hours: number }` (set by `HANDS_ON=on`, defaults 5, 400 and 24; needs `engine`).
- `POST /v1/try/start` (public): makes tenant `t_try_<16 hex>` (a name from a fixed list ending in "(test)", language `en`), an owner "You (visitor)", seeds the engine (`seed()`), and answers `{ tenant, session, visitor_token, expires_at }`. The address (`cf-connecting-ip`) is kept only as a hash salted per day. Over a limit: 429 with a sentence a person can read.
- `POST /v1/try/session` (public): `{ tenant_id, visitor_token }` gives a fresh 15-minute session while the company lives.
- The gate in `route()`: a caller whose tenant id starts with `t_try_` may call only the routes in `TRY_ROUTES` (the reads of the read model, `GET /v1/me`, `/v1/engine/*`, `POST /v1/auth/logout`); every other route answers 403 with code `try_only`. Nobody can sign in to, enrol in or mail a try company. An expired one answers 410.
- `scheduled`: for every expired company not yet wiped, `engine(id).wipe()`, the tenant's rows deleted from every tenant table and its R2 prefix `t/<id>/` removed (reuse what `cloud/src/privacy.ts` does for a closed company), then `wiped_at` set.

**Tests first** (`test/cloud-try.test.ts`, Node engine): off by default (404); start gives a session that works on the reads and the engine routes and is refused with `try_only` on keys, users, export, company, webhook and close; the sixth start from one address in an hour and the start over the day's limit are refused; the visitor token renews the session, a wrong one does not; an expired company answers 410; the sweep removes rows and blobs and calls `wipe`; a try session cannot read another try company; a try company's slug cannot be signed in to.

**Checks.** The test command on the new file and `test/cloud-core.test.ts test/cloud-tenancy.test.ts test/cloud-security.test.ts test/cloud-golive.test.ts`; tsc; eslint.

**Out of scope.** The console, the samples, Claude, a bot check (Turnstile) and WAF rules (name them in the docs task).

### Task 12: try-world

**Goal.** A visitor's company starts with money on its stand-in bank and a tray of sample invoices whose outcomes are what the engine's checks really answer.

**Files and interfaces.**
- `cloud/scripts/samples.ts` (new; `npm run cloud:samples`): renders the chosen fixture texts to PDF in Node (`pdfOf` of `src/e2e/documents.ts`) and writes `cloud/src/engine/samples.gen.ts`: `export const SAMPLES: { key: string; title: string; filename: string; expect: { kind: string; status?: string; finding?: string }; base64: string }[]`. A test regenerates and compares the extracted text (and the bytes, if pdfkit's output proves stable).
- `src/engine/host.ts`: `samples(): { key: string; title: string; filename: string }[]` and `uploadSample(key: string)`, given the list through `EngineDeps.samples?`.
- Routes (task 5's block): `GET /v1/engine/samples` (read) and `POST /v1/engine/samples/{key}` (admin); 404 when the deployment has no samples.

**The samples** (at least five; pick each by running it through the engine, and put the answer in `expect`): a clean invoice from a supplier on file that can be paid to the end (Bergtex, EUR 1,850.00); the same file a second time (`duplicate_document`); a renumbered copy with the same total (`fixtures/hard/bergtex-invoice-renumbered.txt`: `needs_review`, `possible_duplicate`, measured); changed bank details (try `fixtures/hard/bergtex-invoice-subtle-iban.txt` and `bergtex-invoice-subtle-beneficiary.txt` first: the fixture `bergtex-invoice-BTX-2027-01-BANKCHANGE.txt` answers `country_not_paid` today, in Node and in the object, which is a true stop but not the fraud story); an unknown supplier (`NL` of `test/fakes/apInvoices.ts`); a hidden instruction to the reader (`fixtures/hard/bergtex-invoice-hidden-injection.txt`).

**Tests first** (`test/engine-try-world.test.ts`, Node): after `seed()` every sample gives exactly its `expect`; the clean one goes through propose, approve and settle to paid; the generated file is up to date.

**Checks.** The test command on the new file; tsc; eslint.

**Out of scope.** History made of invented approvals (none: nothing in a visitor's ledger is fabricated); a visitor's own upload (the route exists from task 5; whether the demo offers it is decided in task 15); the console.

### Task 13: try-claude

**Goal.** The object reads invoices with Claude, as the runner does, and can never spend past its caps: then the parser reads, and the page says so.

**Files and interfaces.**
- `src/engine/budget.ts` (new): `interface Spend { reserve(micros: number): Promise<boolean>; settle(reserved: number, actual: number): Promise<void> }` and `cappedReader(inner: Asker, a: { db: DB; perCompanyMicros: number; day: Spend | null; estimateMicros: number }): Asker`. Before a call it sums this ledger's `claude.read` audit rows (`cost_usd_micros`) and reserves against the day; over either cap it answers with the fallback and the note "budget", as `budgetedReader` in `src/e2e/setup.ts` does.
- `cloud/src/engine/hostWorker.ts`: with `ENGINE_CLAUDE=on` and the key in the Worker's secrets (`KIT11_ANTHROPIC_API_KEY`, read through `process.env` as `claudeClient()` does) the reader is `cappedReader(new ClaudeReader(db), …)`; defaults USD 0.15 per company (`ENGINE_CLAUDE_COMPANY_MICROS`) and USD 6 per UTC day (`ENGINE_CLAUDE_DAY_MICROS`); the day's spend in a D1 table `engine_spend (day TEXT PRIMARY KEY, micros INTEGER NOT NULL)` (added to the schema as in task 11), reserved with one conditional `UPDATE`. Unset: the parser.
- `status()` gains `reader: "claude" | "parser"` and `spent_micros`.

**Tests first** (`test/engine-budget.test.ts`, with a stand-in fetch as in `spike/do-runtime/probes/p5-claude.ts`): a reading by Claude is counted and its event carries the model and the cost; at the company cap the next reading is the parser's with the note; at the day cap likewise; with no key the parser reads and nothing is reserved; a refusal or a wrong shape falls back as today.

**Checks.** The test command on the new file and `test/ap-inbox.test.ts test/ap-models.test.ts`; tsc; eslint. No real API call in any test.

**Out of scope.** The agents of branch `ap-agents-1112` (they join the engine when that branch lands), recorded fallbacks, per-network caps.

### Task 14: try-console

**Goal.** The public hands-on demo: a visitor opens one address, gets a company, and takes an invoice from the tray to paid, booked and archived with their own passkey.

**Behaviour.** A new open view `#/try`: one sentence on what this is, one button "Start with a test company". It calls `POST /v1/try/start`, keeps the answer in `sessionStorage`, and opens the Invoices page with a banner ("A test company made for you. Test money. Gone at <time>.") and a tray "Sample invoices" (`GET /v1/engine/samples`, one button each, `POST /v1/engine/samples/{key}`). Three short hints follow the visitor: drop an invoice, approve with your passkey, open the proof. The session renews through `/v1/try/session` before it ends. Settings, people, keys and sign-out are hidden for a try company; "Start again" makes a new one. English by default. A device without passkeys gets a clear sentence (and the test signer once task 17 lands).

**Tests first.** `test/cloud-console.test.ts`: keys and CSP. The Chromium check: start, the clean sample, set up and approve with the virtual authenticator, paid, a vault file opens; the duplicate sample shows its finding; at 390 px nothing overflows; no console or CSP error.

**Checks.** As task 8, plus `test/cloud-try.test.ts`.

**Out of scope.** The site's links to the demo, a tour, counters, an admin view.

### Task 15: truth-and-guard

**Goal.** What the product says stays true, and the new public surface is checked like the rest.

**Steps.** `docs/cloud.md`: a section on the engine in the cloud (what runs where, test money and the stand-in bank, the switches, the limits measured at the deploy gate, what is not there: live Airwallex, e-mail into the object). Every sentence that says the cloud only stores and shows, or never moves money (search `docs/`, the header comment of `cloud/src/console.ts`, `src/ui/i18n.ts`, the site's pages), reworded to what is true: no real money moves from the cloud; the engine there runs on test money. Update `test/platform-in-main.test.ts` (the test that holds status texts to the truth). Extend `test/cloud-golive.test.ts` (no token, passkey answer or account number in a log line of the engine and try routes) and `test/cloud-tenancy.test.ts`. Decide and record: a visitor's own upload stays off (`TRY_OWN_UPLOAD` unset) until a hostile PDF has been tried on a deployment; write down the limits that then apply (size, pages, CPU per request). List what a public launch still needs: a bot check, WAF rate rules, a budget alert.

**Checks.** The test command on the touched tests; `npm run lint`; `npm run typecheck`.

**Out of scope.** New features.

### Task 16: shim-suite

**Goal.** The engine's own Node tests run through the shim on every CI run, so every flow crosses the shim's parameter layout, change counting and transactions, not only the chain the object ran. The spike already did this once: 48 files, 513 tests, all green.

**Start from.** `spike/do-lead/shim/` (`openShim.ts`, `vitest.shim.config.ts`, `which.test.ts`) and task 1's `test/support/doStorage.ts`.

**Files.** `test/support/openShim.ts`, `vitest.shim.config.ts` (an alias that swaps `src/db/open.ts` for the shim opener), `npm run test:shim`, a CI step. Run `test/ap-*.test.ts test/approvals*.test.ts test/books.test.ts test/close-unsent.test.ts test/executors-*.test.ts test/gl-export.test.ts test/ledger-*.test.ts test/month*.test.ts test/passkey*.test.ts test/payment-batch.test.ts test/payouts-*.test.ts test/stock.test.ts test/supplier-facts.test.ts test/vault-*.test.ts test/cloud-sync.test.ts`. A failure is a defect of the shim or of the stand-in, to be fixed there; a test that needs better-sqlite3 itself (a second connection, `backup`) is listed by name in the config with the reason.

**Checks.** `npm run test:shim` green; the plain run untouched.

**Out of scope.** Engine code.

### Task 17: try-signer (stretch)

**Goal.** A visitor without a passkey can still sign: a key made in the page signs the same terms, the engine verifies it as any passkey, and every screen calls it what it is.

**Files and interfaces.** `src/ui/testSigner.ts` (new, WebCrypto only, runs in a browser and in Node 22): `makeTestSigner(): Promise<{ register(c: { challenge: string; origin: string; rpId: string }): Promise<RegistrationResponseJSON>; sign(c: { challenge: string; origin: string; rpId: string; counter: number }): Promise<AuthenticationResponseJSON> }>`, the same shapes `src/redteam/authenticator.ts` produces (ES256, attestation none; the COSE key and the attestation object encoded by hand; the signature converted from raw to DER). The passkey's label is "Test signer (this browser), not Face ID" and shows on the approval, in the events and on the receipt.

**Tests first.** `test/ui-test-signer.test.ts`: `verifyEnrolmentResponse` and `verifyApprovalSignature` accept it; other terms are refused; the label is in the audit row and on the receipt PDF's text.

**Out of scope.** Replacing WebAuthn where it exists.

## 7. Risks

1. **Production limits are unknown.** Start-up time for a 7.5 MB script (1.7 MB gzip), CPU per request, memory, D1 queries per invocation (a feed for one invoice made 18 round trips; the limit is said to be 50 on the free plan and 1,000 on the paid one, not checked today), the row size limit, the account's plan. Answered only by the deploy gate. Mitigations ready: the engine loads on first use (ran), the feed sends only what changed (task 4), documents live in 1 MB pieces (ran), a payables-only executor entry.
2. **Untrusted PDFs are read on the object's own thread.** The worker thread's time and memory limits are gone; a hostile file costs CPU up to the platform's limit and can only hurt its own company's object. A visitor's own upload stays off until tried on a deployment.
3. **The console work has no spike.** Three tasks in a 900-line page script, plus the demo entry; the Chromium check is the only real test of it. This is where the schedule can slip.
4. **A Durable Object class and its migration are hard to take back.** A class is SQLite-backed only from its first deploy, and a deploy with a migration cannot be rolled back past it. Deploy first to a deployment of its own (`purser-try`), never to an existing one.
5. **Claims.** The docs say the cloud never moves money and holds no payment keys. That stays true for real money only if the engine in the cloud is test money only; task 15 words it.
6. **Concurrent branches.** `cloud-demo-1112` edits `cloud/src/app.ts` and `cloud/src/worker.ts`; `ap-agents-1112` rewrites `src/ap/checks.ts` from an older base. Land tasks 1 and 2 first and fast.
7. **Public cost and abuse.** Claude spend (caps in task 13), D1 and R2 writes per visitor (limits in task 11), about 1 MB of object storage per company until the daily sweep.
8. **Passkeys.** Bound to the deployment's host; creating and signing from one tap is not certain on every phone; the engine's approval passkey is a second passkey beside the sign-in one for hosted companies until the two are joined.
9. **Local workerd is not production.** Eviction, restarts in the middle of an action and real concurrency were only imitated. The engine's own resume logic (its money state machine) is what a restart falls back on; one action at a time per company removes interleaving.
10. **Time.** Seventeen tasks of 30 to 60 minutes, about 15 agent-hours, three lanes at best after task 5: a long day for tasks 1 to 10 and the gate, a second day for the demo, then polish. The fallback decision must fall at gate 1, not later.

## 8. What each side gains

**The public demo**, compared with a small orchestration layer in the demo Worker over shared pure modules (design v1):

- It is the product, not a model of it. The checks are `evaluate`, the payment is the executor's own state machine, the books are `syncLedger` posting into the hash-chained ledger, the archive is `syncVault` writing the product's PDFs into R2. The golden comparison says so to the row: 947 statements, the same chain heads as a runner.
- One implementation. Design v1 writes its own books, PDF writer, archive, rails, terms and tables (`src/jury/*`), each with its own tests and its own claims to police. Here none of that exists, and every later change to the engine is in the demo the same day.
- The visitor works in the real console, in a company of their own that lasts a day: the demo is a product trial.
- A visitor's own invoice becomes possible (the real reader and the real checks run), where design v1 lists it as a stretch.
- What it does not bring by itself: design v1's 24 choreographed scenarios, the stepwise tool-use agents (Checker, Payer, Buyer), the overspend scene, grading and recorded fallbacks. The first hands-on version is the payables chain with its catches and the refused signature. The agents arrive when `ap-agents-1112` lands in the engine; they then run in the object as they run on a runner.

**The hosted product:**

- It works without a runner. A company uploads an invoice in the console and it is read, checked, proposed, approved with a passkey, paid on test money, booked and archived there.
- One engine, two hosts. The cloud's read model is fed by the same batches a runner pushes, so every console screen and report keeps working, and nothing is implemented twice.
- Companies are apart by construction: one SQLite per company, one writer, no shared tables at the engine's level.
- The path to real money is short and visible: the same executor with the live Airwallex client (which ran in workerd against a stand-in), secrets, alarms for the long retries, and a review.
- A place for what runs by itself: the object can wake on an alarm, which is what the autopilot and the bookkeeper agent need.
