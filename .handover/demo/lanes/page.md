# Lane B: page

You are the build session of lane B of the hands-on demo. Read these, in this order. All paths are in your checkout of `engine-do-1112` or a branch made from it.

1. This file.
2. `.handover/plan.md` (plan E) section 5: test command, commit rules, no network, no secrets. Also `.handover/RULES.md`, with lean mode.
3. `.handover/demo/design-final.md` (plan K) sections 3 (screen rules), 8.2 (passkey), 8.4 (one endpoint for paying and for the change) and 14 (one source per step).

The plan of record is `.handover/demo/plan-of-record.md`. Where this file and a source document disagree, this file wins.

If you are the session that built the console lane (`engine-console-1112`): finish `console-proof` only if you can push it by 14:45 UTC; otherwise stop at the commit in hand. Then stop the `console-*` tasks. The orchestrator reviews your branch and merges it as it stands, and you carry this lane from about 15:00 UTC.

## Goal

One phone-first page, `GET /try` on the deployment `purser-try` (the cloud Worker), where a visitor:

1. starts a test company of their own on the product's real engine;
2. files a sample or a self-written invoice;
3. watches the engine and its agents work, including each Claude call while it is in flight;
4. approves the exact terms with their passkey;
5. tries to pay changed terms with that signature and sees them refused by Purser's own checks;
6. pays the signed terms through the same request and sees them paid on the simulated bank, booked and filed;
7. downloads their company.

It must not feel like a simulation. Every row on screen is drawn from an answer that has returned. Every label says what really ran. No timer pads anything.

## Branch, base, rules

- **Branch.** `try-page-1112`, from the latest head of `engine-do-1112`. The orchestrator merges you into `engine-do-1112` after each review round. Pull `engine-do-1112` before each task.
- **Building before lane C lands.** Build against the Node engine: `testCloud({ engine: true })` of `test/support/cloud.ts` serves every `/v1/engine` route from an engine in the process. Lane C's routes land on `engine-do-1112` from about **Friday 05:00 UTC** (after its review C4). Until then, stub them in your tests with the exact shapes below.
- **The page's pattern** follows the console's (`cloud/src/console.ts`):
  - one TypeScript module that returns the HTML, with one inline `<script type="module" nonce>` built from a `String.raw` template;
  - a nonce CSP (`consoleCsp`'s rules);
  - DOM only through `el()` and `textContent`: no `innerHTML`, no external script, no inline handler.

  Copy the small helpers you need: base64url, `el`, the WebAuthn serialisers in `src/approve/client.ts`, and the console lane's passkey set-up and approve flow on `engine-console-1112` (`46f1e24`, tested in Chromium in `997e347`). Do not import the console's script.
- **Copy.** English only on this page. No `src/ui/i18n.ts` keys: that file is shared with stream `cloud-demo-1112` and the console lane. The copy lives in `cloud/src/tryCopy.ts` as plain constants, so a test can count words.
- **Event lines.** Write your own event lines in `cloud/src/tryEvents.ts`. The console lane's `src/ui/engineEvents.ts` (on `engine-console-1112`) turns an engine event into a line for the console, with its who/tag rules (Claude with the model name, the parser, code, a person). Read it for those rules; do not import or edit it, because it reads the shared i18n catalogue.

## Neighbours

- **Lane A** (`engine-do-1112`) owns the engine, the object, the caps and the event shapes. Read `.handover/agent-events.md` when it appears (Thursday night; updated Friday about 10:30 UTC after A6).
- **Lane C** (`try-core-1112`) owns:
  - `/v1/try/*`, the try-only gate, and the routes `samples`, `suppliers`, `compose`, `proposals/{id}/terms`, `proposals/{id}/pay` and `export`;
  - the held approval for try companies;
  - the switches and, if it ships, `/v1/try/rail/*`.
- **You own:**
  - `cloud/src/tryPage.ts`, `cloud/src/tryCopy.ts`, `cloud/src/tryEvents.ts`;
  - `test/try-page*.test.ts`, `test/try-events.test.ts`, `test/browser/try.check.ts`;
  - the one line in `consoleResponse` (`cloud/src/console.ts`) that serves `/try` (and, when `HANDS_ON=on`, redirects `/` to `/try`);
  - in B6, the kit11 link files named there.
- **Stream `cloud-demo-1112`** and the console lane edit `cloud/src/console.ts`, `app.ts` and `worker.ts`. Keep your line in `consoleResponse` to one `if`.

## The routes you call (all JSON; session as `Authorization: Bearer <session>`)

**From the engine (built):**

- `GET /v1/engine` → status: mode, passkey, balances. After lane A's A5 it also has `reader`, `agents`, `spent_micros` and `cap_micros`.
- `GET /v1/engine/invoices`.
- `POST /v1/engine/invoices/{id}/pay` → 200 `{proposal}`, or 409 with the engine's reason. This files the payment for approval.
- `GET /v1/engine/proposals/{id}`.
- `POST /v1/engine/passkey/start` → `{challenge, code, rp: {id, name}, user: {id, name, displayName}, exclude}`.
- `POST /v1/engine/passkey/finish {code, credential}`.
- `POST /v1/engine/proposals/{id}/approve {terms_sha256, credential}`. **For a try company the approval is held:** `{status: "approved", message, settled: null, held: true}`, and nothing is paid. A refused signature comes back in the engine's plain words (`99c9852`).
- `POST /v1/engine/proposals/{id}/retry` → `{status: "retried", message, settled}`, or 409 with the engine's reason when there is nothing to retry. It runs a failed payment once more.
- `GET /v1/engine/events?after=<seq>&limit=200` → `{items: [{seq, ts, actor, event, subject, fields}], next}`. Past 2 reads a second for a company: `429 {code: "slow_down", retry_ms}`.
- `GET /v1/engine/vault` → `{files}`, and `GET /v1/engine/vault/file?path=`.
- The cloud's read model: `GET /v1/payments`, `GET /v1/transactions`, `GET /v1/ledger/entries`.

**From lane C** (shapes fixed in the plan of record, section 4):

- `POST /v1/try/start {token?}` → `{tenant, session, visitor_token, expires_at, company, pool, mode}`.
- `POST /v1/try/session {tenant_id, visitor_token}` → `{session, expires_at}`, or `410 {code: "gone"}`.
- `GET /v1/engine/samples` and `POST /v1/engine/samples/{key}`.
- `GET /v1/engine/suppliers` → `{items: [{key, name, iban, bic}]}` (test suppliers only).
- `POST /v1/engine/compose {supplier_key, invoice_no, amount, issue_date, due_date, iban}` → `{kind, sha256, invoice}`, or 400 `{code, message}`.
- `GET /v1/engine/proposals/{id}/terms` → `{proposal_id, status, terms, canonical, terms_sha256, approved, expires_at}`.
- **`POST /v1/engine/proposals/{id}/pay {terms, credential}`** → `{outcome, layers: {signature: {verified, reason}, executor: {accepted, said}}, signed_sha256, sent_sha256, changed, transfers_before, transfers_after, sandbox_calls, settled, request_id}`. `outcome` is one of `paid`, `refused`, `paid_once`, `not_signed`, `expired` or `failed` (an earlier payment attempt failed; use the retry route).
- `GET /v1/engine/export` (a JSON file).
- Conditional: `POST|GET /v1/try/rail/{proposal_id}` → `{rows, state, label}`.

## Page rules (from `design-final.md` section 3, reduced)

- **Layout.** Phone first at 390 px, also 1440 px. Light and dark (`prefers-color-scheme` and a `data-theme` override). Reduced motion respected.
- **One story, seven screens.** Exactly one main button per screen (`.btn.primary`). At most 45 visible words per screen outside the live panel and the invoice. Details behind a fold. Focus moves to the heading on every screen change.
- **The band.** On every screen after the start, a band reads "Your test company · test money · simulated bank", plus the start answer's mode: "Claude reads live" or "Purser's code reads today". The word "stand-in" never appears on this page (a test).
- **Nothing is drawn before its response.** No row, hash, status, tick or count appears until the request that produces it has returned. No `setTimeout` delays an outcome. Timers exist only for three things, and a test greps the script for that: polling, session renewal, and the running time of an open Claude call.
- **Times.** Times shown are measured in the browser with `performance.now()` around the request. No server-measured time is shown: a Worker's clock does not advance while code computes.
- **Labels follow their source.**
  - An agent row says `Claude {model} · live` only when its event's `fields.source` or `fields.model` says Claude answered. Otherwise it says "read by Purser's code" or "decided by Purser's code: {reason}", from the event.
  - Money rows say "simulated bank · test money".
  - An Airwallex row appears only when a rail row with an Airwallex transfer id came back.
- **Session.**
  - Keep `{tenant, session, visitor_token, expires_at, pool}` and the approval's credential in `sessionStorage`, wrapped in try/catch. Keep them in memory when storage throws.
  - Renew through `/v1/try/session` two minutes before the session ends, **and on `visibilitychange` to visible, before any poll**.
  - **Stop polling at the first 401.** Renew once. A 410 shows "Your test company was deleted after 24 hours." with "Start again".
  - Never poll while hidden. A 429 `slow_down` waits `retry_ms`.
  - A reload returns to the same screen from the server's state (`GET /v1/engine/invoices` and the last proposal).
- **Tokens.** The page reads `#e=<token>` or `#j=<token>` from the fragment and sends it as `token` in the start request, never in a URL to the server. It then removes the fragment with `history.replaceState`.

## Tasks, in order

### B1 page-shell (replaces `engine-plan:try-console`; rules from `design-final:page-shell`)

Files: `cloud/src/tryPage.ts` (`tryPage(nonce, cfg: { origin; rpId }): string` and `tryPageResponse(req, url, env)`), `cloud/src/tryCopy.ts`, `cloud/src/tryEvents.ts`, and the `/try` line in `consoleResponse`. `cloud/src/tryEvents.ts` is pure: `eventLine(e: EngineEvent): { who: string; text: string; tag: "claude" | "code" | "money" | "sign" | null; asking: boolean }`.

Screens:

- **0 Start.**
  - Heading: "Run a company's payables with Purser."
  - Text (draft; keep the meaning, stay inside 45 words): "In Purser, AI agents read and check each invoice, and nothing is paid until a person signs the exact terms. This test company is made for you on Purser's real engine, with test money, and deleted after 24 hours."
  - Button: "Start with a test company".
  - The sentence describes the product, never this visit. What this visit runs on comes from the start answer's `mode`, in the band.
  - 429 and 503 answers show the server's sentence and the link "Watch the recorded runs" (kit11 `/runs`).
- **1 Invoice.**
  - Heading: "An invoice comes in."
  - Tab "Pick a sample": one button per sample from `GET /v1/engine/samples`, the title only.
  - Tab "Write your own": supplier from `GET /v1/engine/suppliers`; invoice number; amount with `inputmode="decimal"`, accepting a comma or a dot; issue date today; due date +14 days; IBAN prefilled from the supplier and editable. One line under it: "Change the IBAN and see what Purser does".
  - Sending either goes to screen 2 at once and starts the request.
- **2 At work (live panel).**
  - **Polling.** While the request is in flight, poll `GET /v1/engine/events?after=<last seq>` every 1,000 ms, then once more 1 s after it returned. Stop while the page is hidden. Each new event becomes one row from `eventLine`: who (the model's name with "Claude", or "Purser's code"), what, and the time since the request started.
  - **An open call.** A `claude.asking` row is shown as "{agent or Reader} · Claude {model} · asking…" with a running time, counted in the browser from the moment that row arrived. The count stops when the next row of the same agent or reader arrives.
  - **Height.** At most three rows tall on a phone, with the rest behind "All steps".
  - **When the request returns**, the screen shows the invoice's status from its answer: "Ready to pay", or the engine's findings in plain words with the engine's reason.
  - **Button:** "Pay this invoice" (ready) or "Try another invoice".
  - An unknown event gives a neutral line ("Purser recorded a step"), never raw JSON.

Tests first:

- `test/try-page.test.ts`, on the page's HTML: one script with the nonce; the CSP header; no `innerHTML`; no "stand-in"; no timer outside polling, renewal and the open-call count; the word budget per screen from `tryCopy.ts`; the fragment removed after the token is read.
- `test/try-events.test.ts`: every event on `src/engine/events.ts`'s allowlist has a line; an unknown event is neutral; no field value is shown that is not on the allowlist; `claude.asking` gives `asking: true`.
- A page test with a stand-in clock: a 401 stops the polling and renews once; a hidden page makes no request.

Done when these pass and the page loads from `testCloud({ engine: true })` with a session from the test helpers.

### B2 page-sign-pay (replaces `engine-plan:console-approve`; rules from `design-final:page-sign` and sections 8.2 and 8.4)

- **3 Approve.**
  - **The proposal.** `POST /v1/engine/invoices/{id}/pay`. Show the proposal's `facts` as rows: amount once, payee, account ending, due date. Show the first 12 characters of `terms_sha256`, with "Show the exact terms" folding open `GET /v1/engine/proposals/{id}/terms`'s `canonical`.
  - **One sentence:** "Your passkey signs exactly these terms. This saves a test passkey for {host} on this device; you can delete it afterwards."
  - **One button in two labelled stages.**
    1. "Create your approval passkey", when `GET /v1/engine`'s `passkey` is null: passkey start; then `navigator.credentials.create` with the server's user id, `excludeCredentials`, user verification required, attestation none and `residentKey: "discouraged"`; then finish.
    2. "Approve EUR {amount} with {method}": `navigator.credentials.get` with the proposal's `challenge`, `rpId`, and `allowCredentials` holding the engine's credential, user verification required. The answer is serialised as `@simplewebauthn/server` reads it, posted to `approve` with `terms_sha256`, and **kept** (sessionStorage, else memory) for screen 4.
  - **`{method}`** is the device's own word, by a simple platform guess (Face ID, Touch ID, fingerprint, Windows Hello), else "your passkey". The page never says the server proved Face ID.
  - **The answer** (held): "Approved. Nothing is paid yet." The button "Pay it with your signature" goes to screen 4.
  - **Errors.**
    - A cancelled prompt: "Nothing was signed. Try again when you are ready."
    - A 409 because the quote expired: the engine's words and the button "File it again".
    - A device where `PublicKeyCredential` is missing: "This device cannot make a passkey here. Open this page in Safari or Chrome on your phone." Add the test signer's button if lane C's C11 is merged (B7).
- **4 Pay with your signature.**
  - **Heading:** "Pay it with your signature."
  - **Three fields**, filled from `GET /v1/engine/proposals/{id}/terms`: Amount, Payee and Account ending (the terms' `amount`, `beneficiary_name` and `iban_last4`).
  - **One line:** "Your signature covers exactly these terms. Change one and try to pay, or pay them as signed."
  - **The deadline:** the time left before the proposal expires, from `expires_at`.
  - **The one button**, "Pay with my signature", sends the stored terms with the fields' values, plus the kept credential, to `POST /v1/engine/proposals/{id}/pay`. Measure the round trip, and only then draw.
  - **`refused`.** Draw, in order:
    1. The stamp "Refused by Purser".
    2. One row per layer, from `layers`: "Your signature: {signature.reason in plain words}", and "Purser's payment check: refused (the terms do not match what was approved)". The executor's own words (`executor.said`) go in a fold, with the note "asked with your changed terms; nothing was kept".
    3. "Signed {signed_sha256}" and "Sent {sent_sha256}" as two monospace lines, with every differing character marked.
    4. The verdict from `changed`, computed from the two values ("You changed the amount by one cent. Your signature does not cover that.", and the like).
    5. "Round trip {n} ms, measured in your browser".
    6. "Transfers made: {transfers_after − transfers_before}". Add "Airwallex sandbox calls: {sandbox_calls}" only when the rail is on.
    7. "Raw answer", folding open the JSON exactly as received.
    8. The text link "Put back what you signed", which resets the fields.

    Edits can be repeated.
  - **`paid`.** The same request paid. Go to screen 5 with the answer's `settled`.
  - **`paid_once`:** "These are the terms you signed. They were paid once."
  - **`expired`:** the engine's words and "File it again".
  - **`not_signed`:** back to screen 3.
  - **`failed`:** the engine's words and "Try the payment again" (the retry route, as on screen 5).
  - **After a reload without the kept credential**, the page asks the passkey again for the same terms (the challenge is their hash) before it sends.

Tests first:

- page tests for the new copy and budgets;
- a test of the WebAuthn serialiser on a fixed credential, as `src/approve/client.ts`'s tests do;
- a unit test of the hash diff marker;
- a page test that the pay request carries the credential and the terms from the fields, and nothing else.

Done when the Chromium check (below, started here) runs, against the local cloud: start → clean sample → passkey (virtual authenticator) → approve (held) → one cent more refused → signed terms paid.

### B3 page-books (replaces `engine-plan:console-proof`)

- **5 Paid, booked, filed.** Drawn from `pay`'s `settled` and then the reads, each block when its own request has returned:
  - "Paid on the simulated bank · test money": status and fee from `GET /v1/payments` for this invoice.
  - "Booked in Purser's ledger": this invoice's journal lines from `GET /v1/ledger/entries` (account, debit, credit), with the ledger chain's head in a fold.
  - "Filed in the archive": the original and the payment receipt from `GET /v1/engine/vault`. Each is a download link to `/v1/engine/vault/file?path=` with the session: fetch, then `URL.createObjectURL`, opened in a new tab.

  If `settled.error` is set, show it word for word, with the button "Try the payment again". It calls `POST /v1/engine/proposals/{id}/retry`, the engine's own resume path, which never pays twice, and draws its answer when it returns. Never write that Purser will retry by itself: nothing does. Button: "See your company".
- **6 Your company.**
  - "Download your company (SyncBatch)": `GET /v1/engine/export`, saved as a file. One line: "Purser Cloud's own sync format: your test company's invoices with their documents, payments, ledger and audit log." The payment receipts are the downloads on screen 5.
  - "Start again": a new company.
  - "Recorded real runs" with dates, each a link to kit11 `/runs#<key>` for keys that exist in `src/redesign/runs.ts`: `awx-1` (the agent's overspend declined by Airwallex), `connected-1` (a connected-account payout), `t0-1` (the T:0 posting). A test fails if a linked key is not in that file. Label: "recorded {date}".

Tests first:

- page tests for the copy;
- the Chromium check's pay step with an 800 ms server delay. It asserts that no part of the outcome (stamp, layers, hashes, ms, transfers) is in the DOM before the response.

### B4 review-fix-b1 (new)

The orchestrator runs a review with two lenses: honesty and phone UX at 390 px; and security (no token in a URL or log, no `innerHTML`, the CSP, the credential sent only to `approve` and `pay`). Fix what it finds.

Finish `test/browser/try.check.ts`. It uses Playwright Chromium with the virtual authenticator, following `test/browser/console.check.ts`, against the local cloud with `engine` and lane C's merged routes. It covers:

- one whole visit at 390 px light and one at 1440 px dark;
- the duplicate sample shows its finding;
- a changed payment is refused with both layers, and the signed terms are paid;
- no horizontal overflow;
- no console or CSP error;
- one main button per screen;
- the 800 ms test.

Done when it is green and the orchestrator can deploy slice 1 for gate G2 (Friday 12:00 UTC).

### B5 page-agents (new)

On lane A's event shapes (`.handover/agent-events.md`), the live panel shows:

- the open call ("Checker · Claude {model} · asking…" with its running time);
- per agent, "→ {tool}" and "← {answer}" as two halves of one row;
- the agent's words as "its own words, not checked yet", in a muted style;
- the verdict line only after the `ap.checker_decided` row: "Purser's code agrees" when `overridden` is false, "Purser's code is stricter: {codes}" when it is true;
- on screen 3, "Payer · Claude {model}: {rail}, {pay_on}" when present;
- `claude.capped` as "Decided by Purser's code: {reason in plain words}";
- a fold "Cost and ids" per agent: model, request ids, and cost in USD from `cost_usd_micros`.

If lane C's rail ships: screen 5's Airwallex rows from `GET /v1/try/rail/{proposal_id}`, polled every 1,000 ms while the `POST` is in flight, each drawn when it arrives, with the label from the answer.

Tests: `eventLine` for each new event; a page test that the verdict row cannot render before the decision row; a page test that the running time stops when the agent's next row arrives.

### B6 site-link-check (source `design-final:site-wiring`, reduced)

On the kit11 site (repository root `src/`, not `cloud/`):

- Add a build-time setting `TRY_ENGINE_URL`, read where `npm run relay:deploy` builds `src/pages.gen.ts`.
- When it is set, the Try tab and Home's one button (`flowLinks` in `src/relay/assets.ts`, the button in `src/redesign/home.ts`) point to it. When it is unset, nothing changes: that is the rollback.
- `/try/sign` and its pinned tests are not touched. A test builds the pages with and without the setting.
- Read the navigation as it is on the day (four site streams are changing it). Land this last and small, and tell the orchestrator.

Then run the final browser check on the deployed `purser-try` (`try.check.ts --live <base>`, two companies marked internal): one whole visit per size. The kit11 deploy itself is the orchestrator's, on the owner's word.

### B7 review-fix-b2 (new)

Review of B5 and B6, and the fixes from the owner's three rehearsals on Saturday morning: copy, error states, "Start again", slow networks, a phone that slept with the page open. If lane C's test signer (C11) is merged: the button "Use a test signer in this browser" when no passkey can be made, labelled "Test signer, not Face ID" on screens 3, 4 and 5.

### B8 console-link (stretch, only after B7)

"Open your company in Purser Cloud": the console's read-only pages (Invoices, Transactions, Books) and its upload-and-watch view from the merged console lane, for the try session. Only if the console accepts it with no change to `console.ts` beyond one link. Otherwise drop it.

## Fallback F (only if the orchestrator says gate G1 failed)

Stop the tasks above and do one task on kit11's `/try/sign`: `src/try/sign.ts`, its change step at about lines 1035 to 1150.

- **Remove the chips** (`#cheat-chips`, `cheat()`). A chip sets a fixed change and sends it at once, which is what the owner called fake.
- **Type and press.** The visitor types the change in the existing fields and presses the one button `t-send`. It is enabled only when a field differs.
- **Draw from the answer.** The hash table and both hashes are drawn only from the server's answer (today they are drawn before it).
- **Add** "Raw answer" in a fold, the round trip measured in the browser, and "Transfers made: 0".
- **Keep** the server call that sends the browser's own credential (`credential: s.a`).
- **Tests.** Update the pinned chip tests to the typed flow; remove none.

Then run the browser check of `/try/sign` at 390 px.

## Out of scope for lane B

The console's engine actions, any engine or route code, the caps, the rail client, word-by-word text, recorded agent runs, Metal, the overspend scene, a tour, counters, a visitor's own file upload, and in-browser verification of the signature (after the submission).

## Honesty wording (use these words)

- "test company", "test money", "simulated bank" (never "stand-in", never "real money"). "Purser's real engine" only for the engine itself.
- "Claude {model} · live" only for a row whose event says Claude answered. "Claude {model} · asking…" only for a `claude.asking` row whose call has not yet answered. Otherwise "read by Purser's code" or "decided by Purser's code: {reason}".
- "its own words, not checked yet" for model text. The verdict only after code's row.
- "Refused by Purser" for a refused payment, with one row per layer that refused. "Round trip {n} ms, measured in your browser".
- "Airwallex sandbox" only on a row that carries an Airwallex transfer id from the rail answer. "settlement simulated in the sandbox at Purser's request" beside PAID.
- "recorded {date}" for every link to a past run.
