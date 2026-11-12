# Stream: books-cloud

Branch: `books-cloud-1112` (create from the base; push to origin)
Base: `origin/main`.
Pull request: draft, against `main`.
Estimated work: about 31 hours.
Deadline: green by **Saturday 14 November 08:00 UTC**. Hackathon end: Saturday 13:00 UTC.

## Context

Purser Cloud (`cloud/`) is the SME product. Supplier invoices come in, Claude agents read and check them, the CFO signs with Face ID (a passkey over the exact terms), and then each invoice is paid through Airwallex, booked in Purser's double-entry ledger (`src/ledger`, `src/ap/books.ts`), synced to T0 (`src/accounting/t0*.ts`) and Moneybird (`src/erp/moneybird.ts`, `src/erp/readback.ts`), and archived as PDF (`src/vault`). Invoices can also be tokenized on Metal testnet (`src/tokenize`).

The console UI is one file, `cloud/src/console.ts` (`booksView` around line 592). Two running streams are editing it now: `engine-console-1112` (pay and approve on the engine, upload and watch) and `cloud-demo-1112` (public read-only demo, English by default, a companies list). Work in two phases:

- **Phase A (now):** build the ledger, accounting and vault logic and the new views as **new modules**: `cloud/src/booksView.ts`, `cloud/src/vaultView.ts`, `cloud/src/tokenStatus.ts`, `cloud/src/financeFlow.ts`, `src/accounting/reconcile3.ts`, `src/ledger/fx.ts`, `src/ledger/financing.ts`. Each comes with its own tests. Do not edit `cloud/src/console.ts` yet.
- **Phase B (after `engine-console-1112` and `cloud-demo-1112` have merged into main; check with `git merge-base --is-ancestor`):** merge `origin/main` and wire the modules into `console.ts` with small edits that replace `booksView`, add the vault and token views to the router, and add the finance action. If they are not merged by Friday 13 November 16:00 UTC, ask the orchestrator.

## Items (master-list line numbers)

| Line | Item | Priority |
|---|---|---|
| 77 | One cent changed after approval is refused at payment, at booking and at tokenizing, all with the same hash | P1 |
| 134 | Live sync to T0 and Moneybird, and a 'Purser = T0 = Moneybird' reconciliation with 0 differences shown as a green tick | P1 |
| 137 | One 'Books' screen in the site's style: entries as a timeline, reports as cards, no spreadsheet look | P1 |
| 476 | Console folder view with preview, download and 'verify this proof' | P1 |
| 339 | English for the jury: jury demo and Purser Cloud in English, or EN default with NL toggle | P1 (mostly done by cloud-demo-1112; verify) |
| 126 | Double-entry for FX differences and token financing (bank / financier; discount cost at settlement); each entry linked to the Face ID hash and tx/Airwallex id | P2 |
| 684 | Tokenization status per invoice in Purser Cloud (signed > tokenized > financed > settled) with tx links | P2 |
| 685 | Factoring flow in UI: 'Finance this invoice' > proposal (discount, advance) > Face ID > token to financier (simulated, labelled) | P2 |
| 655 | T0: write via POST /v1/records with approval; sync suppliers, bills, payments | P2 |

The console part of master-list item 355 ("Empty, loading and error states human, no bare error codes") also belongs to this stream. Its main owner is site-after-merge.

## What to build, item by item

**77: One cent changed, refused at all three locks with the same hash.**
Payment already refuses it: the two-locks terms hash in the executor. Tokenizing refuses it too: `docs/tokenize.md:48`, where the stored terms no longer hash to the signed hash. Booking does not. `src/ledger` (`feed.ts`, `core.ts`, `documents.ts`) and `src/ap/books.ts` never check `terms_sha256`. Before posting the accrual or the payment entry, recompute the terms hash from the stored invoice terms and compare it with the hash the CFO signed. On a mismatch, refuse with a plain sentence and post nothing. Then add one test (`test/one-cent-three-locks.test.ts`) that changes one cent after approval and proves that all three refuse, quoting the same signed hash: payment, booking and tokenizing (the last through the existing tokenize verify path, read-only use of `src/tokenize`).

**134: Purser = T0 = Moneybird, a three-way reconciliation with a green tick.**
The parts are on main: `src/accounting/t0Sink.ts` with `docs/runs/2026-11-10-t0-journal-sandbox.md` (95 entries, 0 differences), and `src/erp/readback.ts` with `docs/runs/2026-11-12-moneybird-sandbox.md` (6 purchase invoices equal to the cent). Write `src/accounting/reconcile3.ts`. It takes Purser's ledger lines, T0's read-back and Moneybird's read-back, and returns the differences per document and per account. Show it in the console Books screen as one line: a green tick with "Purser = T0 = Moneybird, 0 differences, checked <date>" only when all three agree, and otherwise the list of differences. Feed it from the recorded sandbox results with their dates, and label it "recorded sandbox check of <date>". Live syncing is the owner's budget decision (master-list line 552), so make no live calls here. Tests: zero differences shows the tick; one cent off on either side shows the difference and no tick.

**137: One Books screen in the site's style.**
Replace the two tables in `booksView` (the VAT table and the journal table) with a module `cloud/src/booksView.ts`. Entries become a timeline, newest first, one line per document showing amount, supplier and status, with the lines folded. The reports become cards: P&L, balance sheet, VAT (keep the notice "preparation, not a filing", `src/ledger/vat.ts:45` VAT_NOTICE), open payables, and the three-way tick (134). Use the console's existing tokens and components only. Numbers come from `src/ledger/reports.ts` (`profitAndLossFrom`, `balanceSheetFrom`, `trialFrom`, `ageingFrom`) and `vat.ts`. Check at 390 and 1440 px, light and dark, with `npx tsx test/browser/console.check.ts`.

**476: Console folder view with preview, download and 'verify this proof'.**
Only the local read-only page `src/vault/page.ts` exists. Build `cloud/src/vaultView.ts`: the folder tree from `src/vault/layout.ts` (Company/Year/Quarter/Inkoopfacturen | Betalingen | Rapporten), a PDF preview, download, and a "Verify this proof" button. The button recomputes the document hash and the payment receipt's Face ID hash, then compares both with the ledger entry (`doc_sha256`) and the signed approval. Corrections show as a correction with a reference: nothing is overwritten. Tests: verification passes on an untouched file and fails on a changed byte. Serve PDFs the way the console already serves blobs (`cloud/src/blobsSql.ts`).

**339: English by default.**
`cloud-demo-1112` commit 8b86a10 ("Console: English by default…") should cover this. After it merges, check that the console, the approve pages and the purser-try deployment open in English, with the NL toggle still working. Add a test if none exists. If something still opens in Dutch, fix it (`cloud/src/console.ts` around 229-245, `src/ui/i18n.ts`).

**126: Double-entry for FX differences and token financing.**
There are no FX-difference or financing postings. Add `src/ledger/fx.ts`, which realises the FX difference between the booked rate and the paid rate on settlement, with a separate FX gain/loss account in `src/ledger/accounts.ts`. Add `src/ledger/financing.ts` for token financing. On financing: debit bank, credit the liability to the financier (or derecognise the receivable, depending on the flow's terms). At settlement: post the discount cost as a finance expense. Every new entry carries `approval_sha256` (the CFO's Face ID hash) and `rail_ref` (the tx hash or Airwallex id) next to the existing `doc_sha256`. Make it an additive schema change: a new nullable column plus a migration, never rewriting existing entries. Tests: balanced to the cent, property test on rounding, the discount equals `discountedPrice` from `src/tokenize/flow.ts`, and the entries carry both links. The financier in the tokenize flow is simulated, so label the financier account "simulated financier (testnet)" in reports.

**684: Token status per invoice in the console.**
For each invoice, show the steps signed > tokenized > financed > settled, with tx links. Read the state only from token records (`src/tokenize/record.ts`, `runRecord.ts`). Without a record, show no token row. A stand-in or local-chain record is labelled "stand-in" or "local test chain". Do not add a hash that does not exist.

**685: 'Finance this invoice' flow.**
It runs inside the token flow, not as a separate agent (the owner's decision, master-list lines 438 and 487). The steps are: a button on a tokenized invoice, then a proposal showing discount, advance, cost and settlement date, then Face ID approval through the existing approve flow (the policy/proposal pattern used for limit raises), then the token goes to the financier. The financier is simulated, and the label says "simulated financier, testnet". The proposal terms and the credit check come from the `agents-rails` stream (`src/tokenize/financeProposal.ts`). Until that lands, read them through an interface with a local default (fixed discount from config), and say so in the PR. Tests: the proposal hash is what gets signed, and a changed advance after signing is refused.

**655: T0 write via POST /v1/records.**
`src/accounting/t0.ts` today calls `/v1/entities`, `/v1/gl-accounts`, `/v1/journal-entries` and `/v1/reports` only. Add a records client for `POST /v1/records` that syncs suppliers, bills and payments. Every write requires an approval: the signed approval hash travels in the request and the code refuses without it. Build and test it against a fake T0 server only. Write down the request shapes you assumed, with their source, in `docs/t0.md` or the existing T0 doc. A live write needs the owner's OK and budget (master-list line 552), so make none here. Tests: idempotency (a re-run makes 0 writes), a refusal without approval, and a 429 or lost-answer retry without double-writing.

## Files likely touched

`src/ledger/{core,feed,documents,accounts}.ts`, `src/ledger/fx.ts` (new), `src/ledger/financing.ts` (new), `src/ap/books.ts`, `src/accounting/t0.ts`, `src/accounting/t0Sink.ts`, `src/accounting/reconcile3.ts` (new), `cloud/src/booksView.ts`, `vaultView.ts`, `tokenStatus.ts`, `financeFlow.ts` (all new), `cloud/src/console.ts` (Phase B wiring only), `cloud/src/app.ts` (routes), `cloud/migrations/*` (additive), `src/ui/i18n.ts`, `test/*`, `test/browser/console.check.ts`, `docs/ledger.md`, `docs/t0.md`.

**Do not touch:** `src/redesign/*` and the Kit 11 site (site-after-merge), `cloud/src/try/*` and the `/try` page (try-extras), `src/tokenize/*` (agents-rails owns writes: you only import), `src/agents/*` and `src/erp/moneybird.ts` (agents-rails), `docs/submission/*` (proof-pack).

## Done when

- A one-cent change is refused at payment, booking and tokenizing with the same hash, in one test.
- The three-way reconciliation module and its tick work from the recorded sandbox results, labelled with the date.
- The Books screen is a timeline plus cards. It is screenshotted at 390 and 1440 px, light and dark, and is calmer than before.
- The folder view verifies a proof and catches a changed byte.
- The console opens in English.
- FX and financing postings balance and carry the approval hash and rail id.
- Token status and the finance flow are shown only from records, labelled.
- The T0 records client is tested against a fake.
- Checks are green: typecheck, lint, the offline vitest command, `npm run -s test:d1`, `npx tsx test/browser/console.check.ts`, judge `--check`, and CI.
- Coverage on money, policy and ledger code stays at or above 90% (`test/coverage-areas.ts`).

## Live calls

None. T0 and Moneybird live syncs and any Metal call need the owner's budget go (master-list line 552) and are not part of this stream.

## Rules (binding)

1. **No founder lines.** None in the UI or docs.
2. **No quotes.** None anywhere.
3. **No R2.** PDFs and blobs stay in the existing D1/SQL blob store (`cloud/src/blobsSql.ts`). Do not add R2 bindings, buckets or lifecycle rules.
4. **Numbers only from records.** Every amount on screen is computed from ledger lines or read from a run record. The tick shows only when the computed difference is 0. Never hard-code "0 differences".
5. **Stand-in labelled.** "Simulated financier (testnet)", "recorded sandbox check of <date>", "stand-in" and "local test chain" appear right next to the thing. Nothing is claimed live that was not.
6. Partner names as text only, with no logos. Never "certified", "endorsed" or "approved by". Never name competitors. No gendered pronouns for anonymous people.
7. No real money, no secrets in code, git or logs, and never print environment values.
8. Tests never use the network. Run them with:
   `env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY npx vitest run`
9. Money code: integer cents only, no floats, and a property test for every rounding rule.
10. Design: calm, existing console tokens and components only, result first, details on click, ids and hashes last. Check every screen at 390 and 1440 px, light and dark.
11. English, short sentences.
12. Git: merge commits only, never rebase or force-push, never commit ledgers or run data. Draft PR body sections: What changed, Why, Tests and checks run, Live calls made, Not done. Do not merge or deploy.
13. When green or blocked, send one message to the orchestrator with the PR number, head, checks, live calls and what is not done.
