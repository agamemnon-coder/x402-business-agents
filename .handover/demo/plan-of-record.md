# Hands-on demo: plan of record

Written Thursday 12 November 2026, about 13:00 UTC, by the tech lead who judged the two plans (plan E "engine", plan K "kit11 /go"). Revised about 13:30 UTC after a verified review (section 12). This file is the plan. The lane specs in `lanes/` are what build sessions read.

**Where the build sessions read their sources.** Each lane works in a checkout of `engine-do-1112` (or a branch made from it). Before lanes B and C start, the orchestrator commits this file, `lanes/*.md`, plan K's `design-final.md` and `tasks.json` into `.handover/demo/` on `engine-do-1112`. Plan E's `plan.md` is already on that branch as `.handover/plan.md` (byte for byte the same file, checked), and its task texts are in `.handover/SPEC.md`. The lane specs name those paths, not a scratchpad. Before a lane starts, the orchestrator checks that every path resolves in a fresh checkout.

Source keys used below: `engine-plan:<key>` is a task in `.handover/plan.md` section 6; `design-final:<key>` is a task in `tasks.json`; `new` is a task written here.

## 1. Decision

**Plan E is the base. The hands-on demo runs on the product's real engine, one Durable Object per visitor company, on a deployment of its own called `purser-try` (the cloud Worker).** It is one build with one visitor journey. From plan K it takes:

- the visitor's page rules: one story, phone first, one main button, word budgets, nothing drawn before its response, browser-measured time, one vocabulary for labels;
- the one pay endpoint, used both for paying and for the visitor's own change (design-final section 8.4);
- the reduced caps, pools and switches;
- the narrow Airwallex sandbox client, as a conditional, labelled second leg.

Plan K's `/go` build on kit11 is not started.

One change to plan E itself: the visitor does not use the product's console. One purpose-built, phone-first page at `/try` on `purser-try` calls the engine's routes. For the visitor it replaces plan E's console path (`engine-plan:console-upload-live`, `console-approve`, `console-proof`, `try-console`).

What the console lane built today stays as product work: `console-upload-live` and `console-approve` on `engine-console-1112` (last commit `997e347`, 13:16 UTC). It is reviewed and merged. It is not on the visitor's path; stretch B8 links to it. `console-proof` and `try-console` move to after the submission, unless `console-proof` can be pushed by 14:45 UTC (section 10, action 3).

Why a page and not the console: a first-time judge on a phone from a QR code needs one guided story with one main button per screen. The console is a menu of pages, shared with `cloud-demo-1112` (merge churn in `console.ts` and `i18n.ts`). Lane B copies the console's tested WebAuthn and event-line logic instead of importing it.

### Why (plain words)

1. **Capacity decides first.** At most about 25 finished tasks fit before the freeze. Plan K needs 23 new build tasks plus reviews, from zero. They include two things this codebase has never done: server-sent events through a Durable Object, and a new page build. Plan E has a lot built and tested on `engine-do-1112`: the seams, the engine host, the feed, the routes and the shim suite. It also has:
   - since 12:45 UTC, the object itself (`dd8e682` to `9b8f709`);
   - since 13:14, main merged in;
   - by 13:26 (`b511a54`): the `purser-try` config with a test (`ec3cfe6`), a smoke script (`npm run cloud:smoke`), a retry route for a failed payment (`993efdf`), refusals in plain words (`99c9852`), and a document store in D1 for a deployment without R2 (`6cc478e`).

   All checked on origin. This plan has 22 firm tasks (A1 and half of A2 are done), 3 conditional and 3 stretch.
2. **Typing alone is not the fix.** `/try/sign` on kit11 already has typed amount and IBAN fields, both hashes, and a server check that receives the browser's own signature (`src/try/sign.ts` lines 1035 to 1125, checked). The owner still called it fake. It lacks three things: a company of your own, an invoice of your own going through the real product, and agents and money that visibly act.
3. **The agents are in the engine's own path.** Since 12:20 UTC branch `ap-agents-1112` (head `5203bf5`) runs the Checker and the Payer inside the engine's inbox and payment path. It uses the loop that writes one `agent.tool` audit row per tool call, and it writes decision rows `ap.checker_decided` and `ap.payer_proposed` (checked). Lane A merges that branch from its own head. It does not wait for main.
4. **Crowd and blast radius.** One object per company scales out with no shared coordinator. Plan E runs on its own deployment. Plan K would change the production kit11 Worker that serves the public site and the CFO relay the owner uses this week, and it touches files four site streams are editing.
5. **Addendum point 4** ("the demo is the product, on the real engine if that proves possible") is met in full only by plan E.

### What we give up (said now, not at the freeze)

- **Money moves on a simulated bank inside the visitor's company.** Every screen where money moves says "simulated bank · test money". A real Airwallex sandbox transfer is a conditional second leg (gates GR and GR2), not the payment the books follow.
- **No overspend scene, no real declined card, no Metal read on Saturday.** These are dated links to recorded real runs. Metal is a stretch task. The card scene moves to after the submission.
- **Agents arrive step by step, not word by word.** While the page waits on a request, it polls the engine's events every second. Before each Claude call, the engine writes a row `claude.asking` (the agent or reader, the model, the turn), so the panel shows "Checker · Claude {model} · asking…" with a running time measured in the browser while the call is in flight. Each tool call, code's answer and the model's own words for that turn follow when the turn ends. Addendum (3) asks for streaming while the call is in flight. Showing a call as in flight but not its words is a change to that requirement, and the owner is asked to accept it (section 11, ask 4).
- **No recorded agent runs.** When a cap is reached, a switch is off or the API fails, Purser's code decides and the screen says so.
- **The account ending, not the full IBAN.** The product's signed payables terms name the beneficiary record and the IBAN's last four characters (`InvoicePaymentTerms` in `src/agents/euroBill.ts`: `beneficiary_id`, `beneficiary_name`, `iban_last4`; checked). The change screen offers amount, payee name and account ending. A full-IBAN field would have to fake its effect.
- **A second host and a second passkey.** The visitor makes a new passkey on `purser-try.max-31b.workers.dev`.
- **The first deploy of the cloud Worker with the engine.** The product's documents say a private preview of the cloud exists, behind an access key (`docs/cloud.md` lines 5 and 299; `docs/claims.md` row 344; `docs/decisions.md` D29). Nobody has said where it runs. The owner is asked (ask 2). Either way, `purser-try` is a separate Worker with its own stores and no real data. Since A1, `cloud/wrangler.jsonc` (the product's `purser-cloud`) carries the `CompanyEngine` class and its migration. So **nobody deploys `cloud/wrangler.jsonc` before 15 November** without the owner's word. If a preview runs under that name, such a deploy would add a class and migration that cannot be rolled back.

## 2. The visitor journey at the freeze (Saturday 13:00 UTC)

The visitor arrives on a phone at 390 px, from the kit11 Try tab, the submission's link (`https://purser-try.max-31b.workers.dev/try#j=<jury token>`) or a QR code (`#e=<event token>`). One page, seven screens, one main button each, and at most 45 words outside the live panel and the invoice. Every number is read from an answer that has returned.

| # | Screen | What the visitor does and sees | Real / test money / recorded |
|---|---|---|---|
| 0 | Start | Product sentence: "In Purser, AI agents read and check each invoice, and nothing is paid until a person signs the exact terms." Then: this is a test company made for them on Purser's real engine, with test money, deleted after 24 hours. Button "Start with a test company". After the start, the band says what this visit runs on, from the start answer's `mode`: "Claude reads live" or "Purser's code reads today". | **Real**: a tenant and a Durable Object with the product's engine and its own SQLite ledger, seeded with suppliers on file and an opening balance. |
| 1 | Invoice | "Pick a sample" or "Write your own". The five samples are each chosen by what the engine really answers: a clean one, the same file again, a renumbered copy, changed bank details, an unknown supplier. "Write your own" has: supplier on file, invoice number, amount, due date, and the IBAN, prefilled and editable. | **Real**: the typed invoice is rendered to a PDF inside the object and filed through the product's inbox. The reader and the checks answer it with the product's own answers. |
| 2 | At work | The live panel while the request is in flight, polled every second. Per Claude call: first "{who} · Claude {model} · asking…" with a running time. Then the Checker's rows "→ {tool} ← {code's answer}", and its own words per turn marked "its own words, not checked yet". The verdict line comes only after code's check row ("Purser's code agrees", or "Purser's code is stricter: {why}"). Model, request id and cost per call sit in a fold. | **Real** Claude under hard per-action dollar ceilings. Over a cap, with the switch off or without a key: "read by Purser's code" / "decided by Purser's code: {reason}". Checker and Payer appear only if gate GA passed (Friday 11:00 UTC). Otherwise the Reader's calls are the live agent. |
| 3 | Approve | The proposal's facts (amount, payee, account ending, due date), the short hash, and the full terms in a fold. One button in two labelled stages: "Create your approval passkey", then "Approve EUR {amount} with {method}". Answer: "Approved. Nothing is paid yet." | **Real** WebAuthn over the SHA-256 of the exact terms, verified by the engine's own `processAssertion`. For a try company the approval is stored and the payment is held. |
| 4 | Pay with your signature | Three fields hold the signed amount, payee name and account ending. Text: "Your signature covers exactly these terms. Change one and try to pay, or pay them as signed." One button, "Pay with my signature", sends the terms in the fields with the signature this browser made on screen 3. **Changed:** "Refused by Purser" with one row per layer that refused: "Your signature: {the verifier's reason}" and "Purser's payment check: {the executor's own words}". Then: the signed hash and the sent hash with differing characters marked; "Round trip {n} ms, measured in your browser"; "Transfers made: 0", read from the company's records before and after; the raw answer in a fold; and the link "Put back what you signed". **As signed:** the same request pays. | **Real** on the one pay route. The product's verifier checks the browser's own signature against the sent terms. The product's executor gate is then asked with the sent terms written into the payment instruction, inside a savepoint that is always rolled back. Only when both say yes does the real executor pay, on the simulated bank (transfers +1). The route cannot reach the Airwallex client (import-graph test). |
| 5 | Paid, booked, filed | Each block appears when its answer is back. "Paid on the simulated bank · test money" (transfer status, fee). "Booked in Purser's ledger" (the journal lines, the ledger chain's head). "Filed in the archive" (the original and the payment receipt, downloadable PDFs). If the payment failed: the engine's words and "Try the payment again" (the engine's retry route, which never pays twice). If the rail ran, one more row: "Airwallex sandbox: transfer {id} · PAID · settlement simulated in the sandbox at Purser's request". | **Test money** on the simulated bank inside the company. **Real** product code on test data: the hash-chained ledger and the vault in the deployment's document store (R2, or D1 where R2 is not enabled). The Airwallex row is **real** sandbox (test money), only after gates GR and GR2. |
| 6 | Your company | "Download your company (SyncBatch)": the invoices with their documents, the payments, the ledger and the audit log. "Start again". Dated links to recorded real runs on kit11 `/runs`: the agent's overspend declined by Airwallex (`awx-1`), the connected-account payout (`connected-1`), the T:0 posting (`t0-1`). | **Real** export in the product's sync format (a test applies it to a fresh tenant with `applySync`). The links are **recorded** runs, labelled with their dates. |

A device without a platform passkey gets one clear sentence and cannot approve (the test signer is stretch C11). A paused demo or a reached cap shows one static sentence and the recorded runs. After a reload, a page that lost the kept signature asks the passkey again for the same terms. The challenge is the terms' hash, so the result is the same signature check.

The page shows no server-measured verification time. A Worker's clock does not advance while code computes, so a server figure would read 0 ms. The browser's round trip is the measured time.

## 3. Slices

| Slice | Done by (UTC) | What a visitor gains |
|---|---|---|
| 1. Your company, your invoice, your signature, your change refused, then paid | Fri 13 Nov 12:00, on `purser-try` | Screens 0, 1, 3, 4 and 5 end to end on a phone. Screen 2 shows the parser's rows (labelled) unless the Claude key is set early. The samples and "write your own". Caps, pools and switches in place, all failing closed. |
| 2. Agents watched live; export; safe for a crowd | Sat 14 Nov 02:00 | Screen 2 with real Claude under caps: the Reader, plus Checker and Payer after gate GA. Screen 6's export. The guard tests. A burst of 50 companies polling at the page's rate. The measured cost per visit sets the caps. |
| 3. Claims true, linked, rehearsed; the rail if green | Sat 14 Nov 13:00 (freeze) | The Try tab and the QR code lead here behind a flag. Every claim matches what ran. Three rehearsals on real devices. The Airwallex row is switched on only if gate GR2 passed. |

## 4. Lanes

Three lanes, at most one implementer at a time in each. Each lane has a review round with two lenses (correctness-and-safety; honesty-and-design) and a fix round per slice. Hours are agent hours.

Branches: lane A works on `engine-do-1112`, the integration branch. Lanes B and C branch from `engine-do-1112` at its latest head. The orchestrator merges each into `engine-do-1112` after its review. `engine-do-1112` is merged into main after gate G1 and again at the freeze.

**Sessions.**

- **Lane A** is the engine stream's own session (`session_017bq3BwKpAqG3KaNBn72Twq`). It stopped at about 12:45 UTC for usage credits, resumed, and has been committing again since 13:14. It gets `lanes/engine.md` as its next instructions.
- **Lane B.** A console-lane session (`session_017bq3BzhkcdsYszVbb1F3PM`, branch `engine-console-1112`) is also running; it would be a fourth lane. It finishes `console-proof` only if that can be pushed by 14:45 UTC, then stops the `console-*` tasks and carries lane B. If it cannot switch, lane B gets a fresh session.
- **The console's files.** Its `src/ui/engineEvents.ts` belongs to the console. Lane B writes its own `cloud/src/tryEvents.ts` and edits neither that file nor `src/ui/i18n.ts`.

### Lane A: engine (`lanes/engine.md`) — branch `engine-do-1112`

| # | Task | Source and what changes | Hours | Window (UTC) |
|---|---|---|---|---|
| A1 | engine-object | `engine-plan:engine-object`. Pushed (`dd8e682` to `9b8f709`). Left: confirm gate G0 and send milestone (b). | 0.5 | Thu 14:00–15:00 |
| A2 | deploy-prep | `engine-plan:deploy-gate` steps 1 and 2. Already on the branch: `cloud/wrangler.try.jsonc` with its own stores, D1 `purser-try` and R2 `purser-try-docs` (`ec3cfe6`), and `npm run cloud:smoke` (`b511a54`). Left, pushed by 16:00 for G1a: the vars `ENGINE_CLAUDE` and `HANDS_ON` and an hourly cron. Then the smoke modes `--plain`, `--try`, `--parallel N` and `--poll <ms>`, the run-record template and the deploy section of the docs. | 1 | Thu 15:00–17:00 |
| A3 | review-fix-a1 | new: review of A1 and A2, and fixes. A limit on event reads inside the object. The one allowed retry if Cloudflare refuses (payables-only executor entry, pdfkit and unpdf through `import()`). | 1 | Thu 20:00–23:00 |
| A4 | event-shapes | new: the agent events from `ap-agents-1112`, read at its head (`5203bf5` had the payloads), go on the allowlist, masked, with `claude.asking`, `agent.said` and `claude.capped`. Written into `.handover/agent-events.md` for lane B. | 0.5 | Thu 23:00–Fri 00:30 |
| A5 | try-claude | `engine-plan:try-claude`, extended. A reservation per action, equal to its worst case. A hard ceiling per call (budget seam in `ClaudeReader`). Lower `max_tokens` for try companies. A 30 s timeout with no SDK retries. Reservations stay in flight until settled. Pools, the address scope and per-action caps come from lane C's switches. `claude.asking` rows for the reader. | 2 | Fri 00:30–04:00 |
| A6 | agents-live | new: merge `origin/ap-agents-1112` at its head (no wait for main). Per-call `agents` and `claude` in `InboxDeps` and `payApInvoice` (no global switch). `AgentSpec` fields `budget`, `maxTokens`, `announce` and `sayRows`. An interleaving test with two companies. The polling contract test. | 2.5 | Fri 06:00–10:30 |
| A7 | review-fix-a2 | new: review of A4 to A6, and fixes. The slice-2 deploy. The 50-company burst polling at 1 s. The measured cost per visit. Caps set from it. | 1.5 | Fri 14:00–Sat 02:00 |
| A8 | go-live | `design-final:go-live`, reduced: the final deploy and version ids; the one-page runbook (pause, caps, tokens, rollback, the rail secret's removal if GR2 failed); three rehearsals with the owner; the freeze. | 1.5 | Sat 08:00–13:00 |

### Lane B: page (`lanes/page.md`) — branch `try-page-1112` from `engine-do-1112`

| # | Task | Source and what changes | Hours | Window (UTC) |
|---|---|---|---|---|
| B1 | page-shell | Replaces `engine-plan:try-console`; rules from `design-final:page-shell`. `cloud/src/tryPage.ts` at `GET /try`. Screens 0 to 2, and the live panel polling `GET /v1/engine/events` every second. Session renewal on visibility. Polling stops at the first 401. | 2 | Thu 15:00–18:00 |
| B2 | page-sign-pay | Replaces `engine-plan:console-approve`; rules from `design-final:page-sign` and section 8.4. Screen 3 (passkey in two stages; approval held). Screen 4 (pay with your signature: the fields, the browser's own signature, both layers' answers, both hashes, ms, transfers, the raw answer). | 2.5 | Thu 18:00–Fri 00:30 |
| B3 | page-books | Replaces `engine-plan:console-proof`. Screen 5 (paid, booked, filed, with the vault downloads). Screen 6 (export, start again, recorded-run links). | 1.5 | Fri 00:30–04:00 |
| B4 | review-fix-b1 | new: review and fixes. The Chromium check (virtual authenticator) at 390 px light and 1440 px dark, against lane C's real routes. The 800 ms delay test. Ready for gate G2. | 1.25 | Fri 05:00–10:00 |
| B5 | page-agents | new: renders A4's event shapes and A6's live rows (asking with its running time, tool call, code's answer, words marked unchecked, verdict after code). Also lane C's rail rows when present. | 1.5 | Fri 12:00–17:00 |
| B6 | site-link-check | `design-final:site-wiring`, reduced. A `TRY_ENGINE_URL` build flag on kit11. `/try/sign` untouched. The live browser check. | 2 | Fri 20:00–Sat 02:00 |
| B7 | review-fix-b2 | new: review of B5 and B6, and the fixes from the owner's rehearsals. | 1.25 | Sat 08:00–12:00 |
| B8 | console-link (stretch) | new: "Open your company in Purser Cloud" (the console's read-only pages and its upload-and-watch view). Only after B7. | 1 | after B7 |

### Lane C: try core (`lanes/try-core.md`) — branch `try-core-1112` from `engine-do-1112`

| # | Task | Source and what changes | Hours | Window (UTC) |
|---|---|---|---|---|
| C1 | try-lifecycle | `engine-plan:try-lifecycle`, plus, from `design-final:admission` and `admin-counters` (reduced): the switches (fail closed); three pools (public, event, jury) with tokens; the address keyed by the IPv6 /64; an explicit try-route list without the upload; a try session's expired 401 counted by company, not by address; no rate-bucket write on a try session's event polls; `POST /v1/try/admin`. | 2.5 | Thu 14:00–17:30 |
| C2 | try-world | `engine-plan:try-world`, plus "write your own" (`suppliers`, `compose`) and one cap of 8 documents per company across upload, samples and compose. | 2 | Thu 17:30–21:00 |
| C3 | try-pay-core | new (design-final section 8.4): `hold` on approve for try companies; `POST /v1/engine/proposals/{id}/pay {terms, credential}` with both layers; `terms`; `export` (SyncBatch). | 2 | Thu 21:00–Fri 01:00 |
| C4 | review-fix-c1 | new: review and fixes of C1 to C3. | 1.25 | Fri 01:00–05:00 |
| C5 | try-guard | `design-final:red-team` reduced, plus `engine-plan:truth-and-guard` steps 3 and 4: the attacks on the try surface as tests. | 2 | Fri 05:00–08:30 |
| C6 | truth-claims | `engine-plan:truth-and-guard` steps 1, 2 and 5, plus `design-final:docs-claims` reduced. **Never cut.** It now comes before the rail. | 1.5 | Fri 08:30–11:30 |
| C7 | review-fix-c2 | new: review and fixes of C5 and C6, then merged. | 1.25 | Fri 11:30–14:30 |
| C8 | rail-client (conditional) | `design-final:rails-awx` reduced: host-agnostic, four allowed calls, a D1 call ledger keyed by visitor (5 a day) and company (5), 1,500 calls and a EUR ceiling a day, labels. **Starts only if gate GR passed and C7 is merged by Fri 14:30.** | 2 | Fri 14:30–17:30 |
| C9 | rail-wire (conditional) | `design-final:rails-wire` reduced: `POST /v1/try/rail/{proposal_id}` after an executed payment; never retried after a lost answer; the first `IN_APPROVAL` switches the rail off for everyone. | 1.5 | Fri 17:30–21:00 |
| C10 | review-fix-rail (conditional) | new: review and fixes of C8 and C9 (lenses: money and rails; labels and claims). | 1 | Sat 00:00–03:00 |
| C11 | try-signer (stretch) | `engine-plan:try-signer`, for the try page. Lane B wires the button in B7 if this is merged. | 1.5 | after C10 or C7 |
| C12 | metal-read (stretch) | `design-final:rails-metal` reduced: one row on screen 3 with the demo agent's mandate state on Metal testnet (2 reads a visit, 1,000 a day, cached 10 s). | 1.5 | after C11 |

Count: 22 firm tasks (A1–A8, B1–B7, C1–C7), 3 conditional (C8–C10) and 3 stretch (B8, C11, C12). About 35 firm agent hours, 4.5 conditional.

### Interfaces fixed now (so lanes do not wait for each other)

All are on `purser-try`, in route blocks of `cloud/src/app.ts` owned as stated. Bodies are JSON. Errors never carry exception text.

- **Lane C, `/v1/try/*` block** (public unless noted):
  - `POST /v1/try/start {token?}` → `201 {tenant, session, visitor_token, expires_at, company: {name}, pool: "public"|"event"|"jury", mode: {claude: "live"|"code", agents: "live"|"code", rail_awx: "on"|"off"}}`. Errors: `429 {code: "limit"|"busy", message}`, `503 {code: "paused", message}`.
  - `POST /v1/try/session {tenant_id, visitor_token}` → `{session, expires_at}`, or `410 {code: "gone", message}` once the company was swept. Limited per company, not per address.
  - `POST /v1/try/admin`, with `Authorization: Bearer <admin token>`. Three ops: `{op: "get"}`, `{op: "set", key, value}`, and `{op: "token", pool: "event"|"jury", until}`. `token` returns a new token once and stores only its hash.
  - Conditional (C9): `POST /v1/try/rail/{proposal_id}` (session) and `GET /v1/try/rail/{proposal_id}` → `{rows: [{op, status, transfer_id?, http, ms, at}], state, label}`.
- **Lane C, in the engine block:**
  - The samples and suppliers: `GET /v1/engine/samples`, `POST /v1/engine/samples/{key}` and `GET /v1/engine/suppliers`.
  - `POST /v1/engine/compose {supplier_key, invoice_no, amount, issue_date, due_date, iban}`.
  - `GET /v1/engine/proposals/{id}/terms` → `{proposal_id, status, terms, canonical, terms_sha256, approved, expires_at}`.
  - **`POST /v1/engine/proposals/{id}/pay {terms, credential}`** → `200 {outcome: "paid"|"refused"|"paid_once"|"not_signed"|"expired"|"failed", layers: {signature: {verified, reason}, executor: {accepted, said}}, signed_sha256, sent_sha256, changed, transfers_before, transfers_after, sandbox_calls, settled, request_id}`. `settled` has the shape of `approve`'s, and is null unless paid.
  - `GET /v1/engine/export`.
- **Lane C, the existing approve route for a try company:** `POST /v1/engine/proposals/{id}/approve` answers `{status: "approved", message, settled: null, held: true}`, and nothing is executed. Companies made by the admin path, and the console, are unchanged.
- **Lane C, the try-only gate.** A session of a `t_try_` company may call only the routes listed one by one in `TRY_ROUTES` (lanes/try-core.md C1). `POST /v1/engine/documents` is in the list only while the switch `own_upload` is on, and a missing switch is off. `POST /v1/engine/sync` is never in the list.
- **D1 table `try_switches`** `(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`. C1 owns it. It is read through `readSwitches(sql)` in `cloud/src/try/switches.ts`. A missing row means **off** for `starts`, `claude`, `agents`, `rail_awx`, `rail_metal` and `own_upload`, and **0** for every cap. The owner turns them on at go-live.
- **Lane C: `tryScopes(sql, tenantId)`** in `cloud/src/try/start.ts` → `{pool, addr} | null`. `addr` is the day-salted hash of the start address (the IPv6 /64), null for admin-made companies. Lane A's spend ledger reads it (A5); until C1 is merged, A5 stubs it.
- **Lane A, events.** The allowlist in `src/engine/events.ts` gains the events of `.handover/agent-events.md` (A4, Thursday night). Lane B renders an unknown event as a neutral line, never as raw JSON.

## 5. Gates

| Gate | When (UTC) | Pass | If it fails |
|---|---|---|---|
| G0 engine object local | Thu 12 Nov 16:00 | A1's milestone (b) reports three things: the workerd test runs the chain through the routes against the real object, D1 and R2; the bundle test shows the engine only behind the dynamic import; the dry run prints the `ENGINE` binding. | One more attempt until 20:00. Later than that, G1a moves to the next morning and G1's hard stop holds. |
| G1a first deploy (required) | Thu 18:00, if the owner's go and access come by 16:00 | `purser-try` (its own D1 `purser-try` and R2 `purser-try-docs`, never the product's `purser-cloud` stores) is deployed from `cloud/wrangler.try.jsonc` at the head of the day. One chain through the smoke's admin path ends paid. The upload size, start-up and first-request time go into the run record. | A refusal for size or start-up sends A3 straight to the one retry tonight. A second refusal triggers fallback F at once. Never deploy `spike/do-lead/wrangler.jsonc` as it is: it names the product's stores. |
| G1 Cloudflare runs the engine | target Thu 23:00, hard stop Fri 08:00 | The deploy is accepted. `--plain` passes. Three engine smoke runs with fresh companies end paid, booked and archived, and a signature over other terms is refused (the smoke's existing step; the pay route's `--try` run follows once lane C is merged, from Friday 05:00). A burst of 20 fresh companies, each polling events every second while its upload and proposal run, gives no 5xx; D1 latency is recorded. `docs/runs/2026-11-13-engine-in-cloud.md` is written. | Refused for size or start-up: one retry (A3). A second refusal, any other failure, or no pass by Fri 08:00: **fallback F** (section 6), triggered at once. The retry runs at night only if the owner gave a scoped Cloudflare token (ask 3); otherwise it waits for him at 07:00. |
| GA agents in the engine | Fri 11:00 | A6 has merged `ap-agents-1112` at its head into `engine-do-1112`, with all tests, the shim suite and the workerd test green. Main is not required. | A6 ships the Reader's calls only. The Checker and Payer follow as a small deploy before Demo Day. The page and claims say "the Reader", not "three agents". |
| GR sandbox go or no-go | as soon as the owner allows, latest Fri 12:00 | The owner gives his go. A verify run of at most 10 calls on the connected test account (`acct_SC-QD89fOneAeqaRFgOymw`) pays a seeded beneficiary to PAID, not `IN_APPROVAL`. The owner sets the sandbox key as a secret on `purser-try`. | C8 to C10 are not built. Screen 5 says "simulated bank" only. Addendum point 2 is shown by the dated recorded runs. The rail becomes a small deploy before Demo Day. |
| G2 slice 1 on a phone | Fri 12:00 | On the owner's iPhone and one laptop, on `purser-try`: start; an invoice he typed; Face ID; a one-cent change refused, with both layers, both hashes, the raw answer and the milliseconds; then the signed terms paid; booked; filed. | A slip of at most four hours. No pass by 16:00: cut B5's polish to the bare rows, cut C8 to C12 and B8, and lane C helps lane B. |
| GR1 rail start | Fri 14:30 | GR passed and C7 (the review of C5 and C6) is merged. | The rail is cut (C8 to C10 not built) and becomes a small deploy before Demo Day. Lane C goes to the stretch tasks or helps lane B. |
| G3 agents live and a crowd | Sat 02:00 | A real Claude run appears step by step on `purser-try`, with "asking…" rows. With the day cap set to a few cents, the next reading is code's, labelled. 50 companies in parallel, polling at 1 s, give no 5xx. The cost per visit is measured and the caps are set. | If Claude fails in the object: code decides, labelled, and live agents follow before Demo Day. If the burst fails: lower the in-flight cap and the starts per pool; a "busy, try in a minute" sentence. |
| GR2 rail green | Sat 08:00 | Three visitors' payments on `purser-try` each made one sandbox transfer that reached PAID within 4 calls. The ledger's counts are exact. The switch stops the next one before any request. | `rail_awx` stays off. **The owner deletes `TRY_AWX_CLIENT_ID` and `TRY_AWX_API_KEY` on `purser-try` before the freeze** (`wrangler secret delete`). The version id is written down, and A8 removes the "holds one Airwallex sandbox key" sentence. |
| G4 feature stop | Sat 09:00 | Everything merged is green in CI. | Anything not green is cut in the order of section 7 before the last review. Nothing new starts. |
| G5 freeze | Sat 13:00 | Three rehearsals passed: iPhone with Face ID, a second phone, a laptop. The browser check is green at 390 and 1440 px, light and dark. The claims tests are green. The claims match the secrets on `purser-try`. The site link is deployed on the owner's word. Version ids are written down. | The site flag stays off and the Try tab keeps pointing to `/try/sign`. The `purser-try` link goes into the form only on the owner's word. Roll `purser-try` back to the last version that passed its smoke (no migration change after G1a). |

## 6. Fallback F (if G1 fails; trigger at once, at the latest Friday 08:00 UTC)

The public hands-on stays `/try/sign` on kit11, made to meet the addendum where it can:

1. **Lane B** (about 1 task):
   - Remove the chips (`#cheat-chips`). A chip sets a fixed change and sends it at once, which is what the owner called fake.
   - The visitor types the change and presses the one existing button, `t-send` ("Send with the same signature").
   - Draw the hash table and both hashes only from the server's answer; today they are drawn before it.
   - Add the raw answer in a fold, the browser-measured round trip and "Transfers made: 0".
   - Keep the server call that sends the browser's own credential (`credential: s.a`).
   - Update the pinned chip tests to the typed flow; remove none.
2. **Lane C** (about 2 tasks): C8, which is host-agnostic on purpose, wired into `/try/sign`'s pay step behind a switch in the try-sign Durable Object instance, if gate GR passes. It uses the per-visitor call ledger in that instance's SQLite.
3. **Lane A**: `engine-do-1112` merged into main dark (`ENGINE_MODE`, `HANDS_ON`, `ENGINE_CLAUDE` unset; the cloud behaves as today). The run record of the refusal is written. The engine demo ships after the submission.
4. The read-only cloud demo (`cloud-demo-1112`) is linked as "the product's console with three test companies".
5. The submission says plainly that the engine-per-company demo was not accepted by Cloudflare in time.

Every kit11 deploy needs the owner's word and a version id written down first. Plan K's `/go` is not started in the fallback either: it does not fit in the time left.

## 7. Cut line

**Cut first, in this order, never further than the next gate needs:**

1. C12 Metal read.
2. B8 console link.
3. C11 test signer.
4. The rail (C8 to C10). This cut is automatic at GR1, Fri 14:30, unless GR passed and C7 is merged.
5. B5's extras: keep the rows and the "asking…" running time; drop the cost fold and the per-call request ids.
6. Screen 6's recorded-run links (keep the export).
7. The samples beyond three (keep clean, same file again, changed bank details).
8. A7's burst reduced from 50 to 20 (still polling).

**Never cut:**

- The caps, the hard per-action ceilings and the fail-closed switches (starts, Claude, agents, rails, own upload).
- The three pools with their tokens, the per-address and per-day limits keyed by the /64, and a try session's 401 counted by company.
- The explicit try-route list.
- The daily sweep of expired companies.
- Honest labels and one vocabulary: "simulated bank · test money", "decided by Purser's code", "recorded {date}".
- The one pay route: the browser's own signature checked by the product's verifier, the executor's gate asked with the sent terms, and the same route paying the signed terms.
- "Nothing drawn before its response".
- The export in SyncBatch format.
- The claims task (C6), and the review rounds.

## 8. After the submission, before Demo Day (each a small deploy on the owner's word)

1. Recorded real agent runs shown when live agents are not available, so a crowd past the caps still sees agents, labelled "recorded".
2. Word-by-word model text: the SDK's stream into a buffer the page polls, or a long poll on events.
3. "Check it in your browser": the page verifies the visitor's own signature with WebCrypto against the hash of the changed terms, with no server (the public key kept from the passkey's creation).
4. The Airwallex rail, if it missed the freeze; the declined-card overspend scene (plan K screens 6 and 7) on its own sandbox card.
5. The Metal read and the test signer, if cut. The Checker and Payer live, if gate GA missed.
6. A load test at 150 visitors on `purser-try`, a bot check and WAF rate rules, the Workers rate-limit binding.
7. The console's remaining engine tasks for hosted companies (`engine-plan:console-proof` if it was not finished, and `try-console`). The visitor's own file upload (switch `own_upload`), once a hostile PDF has been tried on the deployment.
8. The Demo Day settings: an event token and its QR code, the event pool's day cap raised for 20 November 00:30–04:30 UTC, and a warm-up before the QR moment.

## 9. Claims and documents that must change (task C6, never cut)

- **The claim "the cloud never moves money and holds no payment keys":**
  - Where it stands: `docs/cloud.md` line 20, `docs/runbook.md` lines 310 and 381, and the comment in `src/cloudsync/client.ts` line 3. Search also for "never moves money", "holds no payment keys", "cannot move money" and "only stores and shows".
  - It becomes "Purser Cloud moves no real money. Its hands-on deployment runs the engine on test money and a simulated bank".
  - The clause "and holds one Airwallex sandbox key" is added only while that secret is set on `purser-try`. One constant holds the sentence, so A8 can change it at the freeze in one line.
  - `test/platform-in-main.test.ts` follows.
- **"A hosted preview exists but is private (behind an access key)":** `docs/cloud.md` lines 5 and 299, `docs/claims.md` row 344, `docs/decisions.md` D29, `docs/after-the-kit.md` lines 18 and 44, `docs/go-live.md` line 5, `docs/runbook.md` line 311 and `README.md`. These stay if the owner confirms the preview (ask 2). If he says there is none, they are corrected, with a test. Either way, `docs/cloud.md`'s deploy step gains the warning that `cloud/wrangler.jsonc` now adds the engine's class and migration, which cannot be rolled back.
- **`docs/cloud.md`**: a section on the engine in the cloud and the hands-on deployment. What runs where; the switches, pools and caps; the measured limits (a link to the G1 run record, numbers not copied); what is not there.
- **`docs/claims.md`**: rows for the hands-on demo. What is live; what is simulated; the caps per visitor, per pool and per day; the models that ran (a link to A7's run record); the export; the tokens.
- **`README.md`, `llms.txt`, the form's text**: the hands-on link (only after G5) and one line on what is real.
- **The kit11 site**: the Try tab's target behind the flag (B6). `/try/sign` and its pinned tests stay as they are, unless fallback F runs.
- **Not claimed anywhere**, unless that step ran in this demo: Metal, a declined card or an Airwallex payment. Also never claimed: "streamed word by word", and "three agents" unless gate GA passed.

## 10. Orchestrator actions, in order

1. **Before 14:00:** commit to `engine-do-1112` a folder `.handover/demo/` holding this file, `lanes/engine.md`, `lanes/page.md`, `lanes/try-core.md`, `design-final.md` and `tasks.json`. Check in a fresh checkout that every path each lane file names resolves.
2. **Now, lane A:** send `lanes/engine.md` to the engine session (`session_017bq3BwKpAqG3KaNBn72Twq`, active again since 13:14). It confirms A1 and sends milestone (b), then finishes A2 on top of what it already pushed (`ec3cfe6`, `b511a54`). It does not start any `console-*` or `try-*` task of `.handover/SPEC.md`.
3. **Now, the console session** (`session_017bq3BzhkcdsYszVbb1F3PM`, branch `engine-console-1112`, `console-approve` done at 13:16):
   - It may finish `console-proof` only if that can be pushed by 14:45. Otherwise it stops at the commit in hand.
   - Then it stops the `console-*` tasks and carries lane B from about 15:00 (`lanes/page.md`, branch `try-page-1112` from `engine-do-1112`). If it cannot switch, lane B gets a fresh session.
   - Review `engine-console-1112` with the two lenses and merge it into `engine-do-1112` when convenient. It is product work, not on the visitor's path.
4. **14:00:** start lane C (`lanes/try-core.md`, branch `try-core-1112`). Lane B follows by 15:00. Do not start plan K's `/go` build.
5. **Today:** put the owner's asks of section 11 to him, with their deadlines.
6. **On the owner's go:**
   - Create D1 `purser-try` (`weur`) and R2 `purser-try-docs` (`eu`). If R2 cannot be enabled on the account today, drop the `DOCS` binding: the Worker then keeps documents in its D1 (`sqlBlobs`, `6cc478e`), and the run record says so.
   - Set `SESSION_SECRET` and `ADMIN_TOKEN_SHA256` with `wrangler secret put`, never in a file or log.
   - **G1a at 18:00:** deploy `cloud/wrangler.try.jsonc` from `engine-do-1112`'s head after A2's first push, and run `npm run cloud:smoke` once (the admin path).
   - Never deploy `cloud/wrangler.jsonc` or the spike's config.
7. **G1** (target 23:00, hard stop Fri 08:00): after A3, deploy and run the smoke: `--plain`, the engine part three times, and `--parallel 20 --poll 1000`. Write the run record. If G1 fails, trigger fallback F and tell all three lanes.
8. **Fri 06:00:** name the `ap-agents-1112` head that lane A merges (A6). Merge `ap-agents-1112` into main when its stream is green. Then merge main into `engine-do-1112`.
9. **Tell neighbouring streams:**
   - Tell the `cloud-demo-1112` stream that `cloud/src/app.ts` and `cloud/src/worker.ts` get: the try-only gate; the engine and try route blocks; one change in the router's auth catch (a try session's expired 401 is counted by company); and no rate-bucket write on a try session's event polls.
   - Tell the four site streams that the Try tab change lands last, behind `TRY_ENGINE_URL` (B6).
10. **After each review round:** merge the lane into `engine-do-1112`. Run the plain tests, `test:shim` and `test:d1`. Deploy to `purser-try` (no migration change after G1a). Run the smoke with `--poll`.
11. **Gate GR:**
    - The owner sets `TRY_AWX_CLIENT_ID` and `TRY_AWX_API_KEY` on `purser-try`.
    - Run the verify (at most 10 calls) and write its run record.
    - At Fri 14:30 (GR1), tell lane C go for C8 to C10 only if GR passed and C7 is merged; otherwise the rail is cut.
12. **Fri 12:00:** gate G2 with the owner. **Sat 02:00:** gate G3 (burst of 50 polling at 1 s, measured cost, caps set through the admin route).
13. **Saturday morning:**
    - **08:00:** GR2. If it fails, the owner deletes the two `TRY_AWX_*` secrets before the freeze, and the version id is written down.
    - **09:00:** feature stop.
    - **09:00–11:00:** three rehearsals with the owner.
    - Then make the jury token (`{op: "token", pool: "jury"}`); the owner puts the link in the form.
    - Deploy the site with `TRY_ENGINE_URL` on the owner's word, with the previous version id written down.
14. **Sat 13:00:** the freeze. Write down the `purser-try` and kit11 version ids. Merge `engine-do-1112` into main. Flip the README and `llms.txt` hands-on marker.

## 11. Owner's asks (most urgent first)

1. **Today before 16:00 UTC:** agree to this plan. That includes the order: approve first, then try a change, then pay what you signed. Also agree that the console session stops and carries lane B, and that the three demo lanes come before site polish when the usage limit bites.
2. **Today before 16:00 UTC:** is a Purser Cloud preview (`purser-cloud`, behind an access key) deployed on Cloudflare? If yes, nobody deploys `cloud/wrangler.jsonc` to it before 15 November. If no, the documents that say it exists are corrected.
3. **Today before 17:00 UTC:**
   - Your go for `purser-try`: its own D1 and R2, no real data. The product's own deploy stays after 15 November.
   - Cloudflare access for the night's retry: preferably an API token limited to Workers, D1 and R2 edit, entered in the secure credential form and never in chat. Otherwise you deploy, and the hard stop is Friday 08:00 UTC.
   - Confirm Workers Paid in the dashboard and set a usage notification.
4. **Accept a change to addendum point 3:** no word-by-word text. While a Claude call is in flight, the panel shows "asking Claude…" with a running time. The steps (tool calls, code's answers, the model's words) appear as each turn ends, about a second later. Word by word can come as a small deploy before Demo Day.
5. **By Friday 06:00 UTC:** a Claude key of the demo's own, in a separate workspace with a USD 80 spend limit, set by you as a secret on `purser-try`. The split: about USD 5 for measuring and rehearsals, USD 75 in the Worker under per-action, per-company, per-pool, per-day and all-time caps. The Demo Day evening gets USD 25 of it.
6. **Tonight if you can, Friday 12:00 UTC at the latest:** your go for an Airwallex sandbox verify run (at most 10 calls) and a sandbox key on `purser-try`. The published sentence follows the key. If the rail is not green by Saturday 08:00, you delete the key before the freeze.
7. An admin token (at least 32 random bytes) kept on your phone; only its hash goes to `purser-try`. On Saturday we make a jury token for the link in the form, so a script on the public link cannot use up the judges' share.
8. **Friday 12:00 UTC, ten minutes:** walk slice 1 on your iPhone and a laptop (gate G2).
9. **Accept:**
   - The change screen offers amount, payee and account ending; the signed terms hold the IBAN's last four characters, not the whole IBAN.
   - No overspend, card or Metal on Saturday; dated links to recorded runs instead.
   - The money moves on a simulated bank, with an Airwallex sandbox row only if it ran green.
10. **Saturday 09:00–11:00 UTC:** three rehearsals (your iPhone, a second phone, a laptop), then your word for the site deploy.
11. **Accept in advance fallback F** if Cloudflare refuses the engine by Friday 08:00 UTC. `/try/sign` stays, with no chips: the visitor types the change, presses one button, and the hashes appear only after the answer.

## 12. Review (about 13:30 UTC): what changed, and the findings not taken

All 14 findings were checked against the code. All were valid, and the plan was fixed for each. Five are taken with a change, recorded below.

Facts newer than the review, found on origin while checking (13:20–13:30 UTC):

- `engine-do-1112` holds A1 and half of A2 (`ec3cfe6`, `b511a54`), a retry route for a failed payment (`993efdf`), refusals in plain words (`99c9852`) and a D1 document store (`6cc478e`).
- Its session is active again.
- A console-lane session has built `console-upload-live` and `console-approve` (`997e347`) and owns `src/ui/engineEvents.ts`.
- `ap-agents-1112` has moved to `df5df1a` (evals).

They are handled in sections 1 and 4 and in actions 2, 3 and 6. The page now offers the retry route after a failed payment instead of saying "Purser will retry", which nothing does by itself.

### Review findings not taken (or taken with a change)

1. **Blocker, the change route.** Taken: the approval is held for try companies, and the change goes through the one pay route that pays the signed terms. **The change:** the executor is not run as a whole `execute()` on the changed terms. `execute()` awaits outside work before it reaches its gate (`consultHub`, the balance snapshot), so no transaction can wrap it. Writing the changed terms outside a transaction would leave them in the payment instruction if the object stopped mid-request. So the route does three things:
   - It checks the browser's own signature with the product's verifier.
   - It writes the sent terms into the instruction and calls the executor's own gate, `beginExecution`, the check every executor runs. Both happen inside a synchronous savepoint that is always rolled back.
   - Only when both say yes does it call the real `execute()`, which runs the same gate again for real.

   Plan K's "Check it in your browser" moves to after the submission (section 8, item 3).
2. **Major, the schedule.** Taken. **The change:** the rail starts at Fri 14:30, not 12:00. The claims task (now C6) and its review (C7) cannot be merged by 12:00 if they are to come before the rail. The rule the review asked for holds: the rail never sits in front of the claims or their review.
3. **Major, the hard ceiling.** Taken. **The change:** `max_tokens` for try companies starts at 4,000 for the reader and 2,000 per agent turn, not 2,000 for both, because a reading cut off at 2,000 falls back to code too often to be worth it. A7 measures and sets the values. The real bound is the per-call budget check, whatever `max_tokens` is.
4. **Minor, the probe.** Taken. **The change:** with A1 pushed, the probe is `purser-try` itself, from A2's config with its own stores, deployed at 18:00. A separate `purser-probe` config is not written. The spike's config is never deployed as it is.
5. **Minor, the sources.** Taken. **The change:** the files go to `.handover/demo/` on `engine-do-1112`, not into the scratchpad's `lanes/` folder, so a build session in another container reads them in its own checkout.
