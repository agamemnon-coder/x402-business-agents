# Stream: try-extras

Branch: `try-extras-1112` (create it; push to origin)
Base: `origin/try-core-1112` at the moment you start. That branch already contains `engine-do-1112`, C1 try-lifecycle (`cloud/src/try/*`: admin, gate, start, switches, sweep, routes) and the `src/engine/*` object. Keep it current by merging `origin/try-core-1112`, `origin/try-page-1112` and `origin/engine-do-1112` into your branch with merge commits whenever they move. Once they have merged into main, merge `origin/main`.
Pull request: draft, against `main`. Until try-core and try-page merge, the diff will include their commits. Say so in the PR body.
Estimated work: about 33 hours. Use priorities and parallel implementers.
Deadline: green by **Saturday 14 November 08:00 UTC**. Hackathon end: Saturday 13:00 UTC.

## Context

The hands-on jury demo ("Try Purser") is a fresh test company per visitor on the purser-try Worker (`cloud/wrangler.try.jsonc`), reached through `/try` and a QR code. Its plan of record is `.handover/demo/plan-of-record.md` on `origin/try-page-1112`, with lane specs in `.handover/demo/lanes/{try-core,page,engine}.md` and the larger rejected design in `.handover/demo/design-final.md` ("plan K"). Plan E (the one being built) leaves out several pieces that the owner's master list still wants. This stream builds those pieces.

Three other streams are editing the same area right now: `try-core-1112` (C1-C12), `try-page-1112` (B1-B6, the screens) and `engine-do-1112` (A1-A8). To avoid conflicts:
- **Phase A (now until the screens exist):** build every item as a new module with its own tests, in new files only: `src/try/scenarios/*`, `cloud/src/try/botCheck.ts`, `cloud/src/try/counter.ts`, `cloud/src/try/adminPage.ts`, `cloud/src/try/feedback.ts`, `src/try/endCard.ts`, `src/try/tour.ts`, `scripts/load-try.ts`, and so on. Do not edit files that those streams list in their lane specs, except the one-line registrations listed below.
- **Phase B (when try-page-1112 has its screens, at the latest Friday 13 November 18:00 UTC; ask the orchestrator):** wire the modules into the page and routes. Every visitor-facing addition sits behind a row in D1 `try_switches` (C1). It is OFF by default and fails closed, so a late merge cannot break the demo.

## Items (master-list line numbers)

| Line | Item | Priority |
|---|---|---|
| 252 | Jury demo step 8: end card 'this is what you just did' with all ids and a 'verify yourself' button | P1 |
| 249 | Jury demo step 5: booked - entries, P&L, VAT, and T0 green tick | P1 |
| 176 | Each jury-demo step names the partner working there (Claude, Airwallex, Metal, Visa/VIC via Airi, T0), text only, no logos, never 'endorsed'/'certified' | P1 |
| 326 | Honest when AI is wrong: end card shows right answer and whether the agent had it; money stays because no signature | P1 |
| 260 | Protection: bot check | P1 |
| 342 | Admin screen for the owner during judging: visitors, errors, latency, cost, Claude status | P1 |
| 301 | Scenario library of >=24 scenarios from blocks (company x supplier/invoice x event: BEC IBAN, contract mismatch, duplicate, new supplier, price doubling, prompt injection in PDF, CEO-urgency mail, financeable invoice) | P2 |
| 315 | Seed per visitor, seed on end card with 'replay this scenario' link and 'give me another scenario' button | P2 |
| 329 | Live counter on the site: N scenarios played, X frauds caught, Y Face ID, 0 money moved without signature; real numbers, no personal data | P2 |
| 410 | Load test on /try/sign and the site; limits and budget hold | P2 |
| 73 | /try/sign 'talk the agent round' step (visitor types an attempt, Claude may go along, rail refuses) plus a live red-team counter | P2 |
| 349 | Short 30 s skippable tour for the jury with the why ('limits in a prompt can be talked out of; signatures can't') | P3 |
| 350 | Anonymous feedback button on end card, only if light and safe | P3 |

## What to build, item by item

**252: End card with ids and 'Verify yourself'.**
Screen 6 on try-page-1112 has export, start again and recorded-run links. Add a short summary of what the visitor did, in this order: invoice, decision, signature, payment, booking, archive. Each has its id, and the ids sit behind a fold. Add one "Verify yourself" button that, in the browser, recomputes SHA-256 over the stored terms and checks the passkey signature over that hash (reuse `src/try/verify.ts`). It shows "Signature matches these terms" or "Does not match". The lane spec lists in-browser verification as out of scope for plan E, which is exactly why this stream builds it. Tests: a valid case, and a case where one cent changed after signing, which must fail.

**249: Books step with P&L, VAT and a labelled T0 row.**
On the books screen, show the effect of this invoice: P&L before and after, and VAT before and after. Compute them with the existing report code (`src/ledger/reports.ts`, `src/ledger/vat.ts`: profit and loss and VAT overview from the entries), never by hand. Add one T0 row that is honestly labelled, for example "T0: not sent from this test company. Real posting on 10 November", linking to `docs/runs/2026-11-10-t0-journal-sandbox.md`. Show a green tick only for something that really happened. In this test company the T0 tick refers to the recorded run, and the label says so.

**176: Partner line per step.**
Each screen gets one plain text line naming the partner whose part ran there, derived from the visitor's own events: "Claude {model} read this invoice", "Paid on the simulated bank (test money)", or "Airwallex sandbox" only if the sandbox row ran. Metal, Visa/VIC or T0 appear only when that step actually ran for this visitor, or as a clearly labelled link to a recorded run. No logos. A test fails on "endorsed", "certified" or "approved by" (extend the existing ban in `test/redesign-numbers.test.ts`, or mirror it).

**326: Expected versus agents on the end card.**
Every sample and every scenario carries `expect` (the right answer). The end card shows the right answer, what the agents decided, and whether they matched. When they did not match, it adds one sentence: "The money stayed: nothing moves without your signature". Do not hide a wrong agent answer. Test both the match and the mismatch case.

**260: Bot check (proof of work).**
Use no third party and no owner account. Follow the plan K design in `design-final.md`: the server issues a stateless challenge, signed with an HMAC from a Worker secret, carrying a timestamp and the difficulty. The difficulty is 12 to 20 leading zero bits of SHA-256, chosen by current load. The browser solves it synchronously before `POST /v1/try/start`. The Worker checks it before the Durable Object is touched, and rejects expired, reused (bind the challenge to the visitor's start) or wrong answers with a friendly sentence. Tests: valid, wrong nonce, expired, replayed, wrong signature, and difficulty rising with load. Measure the solve time at 16 bits on a mid phone profile and note it in the PR. It must stay under about 1 s at normal load. The secret is new, so the orchestrator sets it at deploy. Never commit it.

**342: Read-only admin page.**
Build a small page for the owner during judging, on purser-try, behind the existing admin token from C1 (`cloud/src/try/admin.ts`). It shows: visitors started and finished in the last hour and the last day, errors by kind, p50 and p95 latency, Claude cost today against the cap (from the A5 spend ledger), Claude status (last success, last failure, the share of fallbacks), and the switch states. Everything is aggregated, with no personal data, no addresses and no ids. It is read-only. Switches are still set through the existing admin API. Test: refuses access without the token, and shows only aggregates.

**301: Scenario library (at least 24).**
Build it from blocks: company (the 3 cloud-demo companies or fixture companies) x supplier and invoice (NL/EN/DE) x event. The events are: clean, BEC changed IBAN, contract mismatch, duplicate, new supplier, price doubling, prompt injection inside the PDF, CEO-urgency mail, and financeable invoice. Compose each one through the engine's `compose()` path that try-core C2 uses for its samples, so that every scenario is a real PDF the engine reads. Each scenario has an `id`, a `seed`, and an `expect` (refuse / ask Face ID / pay, plus the reason). The test proves: at least 24 distinct scenarios, every event type present, deterministic per seed, and `expect` matching the deterministic checks offline without Claude. Never claim a scenario is "live" in the library itself: the live part is Claude reading it.

**315: Seed per visitor, replay and another scenario.**
Each visitor's company gets a seed that picks the scenario. The end card shows the seed with "Replay this scenario" (the same seed) and "Give me another scenario" (a new seed). Seeds are not secrets and contain no personal data.

**329: Live counter.**
Show "N scenarios played, X frauds caught, Y signed with Face ID, 0 payments without a signature". Count from the D1 try tables, aggregate only, with no ids. Compute "0 without a signature" by code: count payments without a verified signature. If that count is ever above 0, the counter must show the real number, not hide it. Cache it for about 60 s. It sits behind a switch and is placed on `/try`. On the Kit 11 site it appears only after the site streams have merged, and then only as a link. Test with seeded rows.

**410: Load test.**
Write `scripts/load-try.ts` (or extend the engine-do smoke `--parallel N --poll`) for `/try/sign` on the Kit 11 Worker and `/v1/try/start` plus polling on purser-try. Run it against local `wrangler dev` only. It records p50 and p95, the share of 429 "busy" answers, any 5xx, and that the Claude spend did not move past the caps (use stubbed Claude in the local run). A run against the deployed Workers needs the owner's word through the orchestrator. The result goes into a run record `docs/runs/2026-11-13-try-load.md`, clearly marked local or deployed.

**73: 'Talk the agent round' on /try/sign plus a red-team counter.**
`worker/src/trick.ts` today reads two fixed fake invoices and says that no visitor's words reach any code or model. Add a step, behind a switch that is off by default: the visitor types one attempt (at most 280 characters, plain text, rate-limited per address key), and Claude, through the existing budget seam `src/try/claude.ts` with a per-call dollar cap, timeout and labelled fallback, may "go along" in its reply. Then the rail refuses: the deterministic code and the signature check refuse any payment that is not covered by the signed terms. Show both the model's reply and the refusal. The visitor's text never reaches a tool call, a payee field or an executor. It is only shown, escaped. When the switch is on, the page's sentence about "no visitor's words" must change to the true sentence. The counter shows attempts, how often the model went along, how often the rail refused, and money moved without a signature (always computed). Tests: injection attempts cannot change payee or amount, output is escaped, the cap is reached, the fallback is labelled, and the copy changes with the switch. Claude in tests is stubbed. Live use waits for the orchestrator to switch it on, within the try budget.

**349: 30-second tour.**
Make it skippable, at most 4 short steps, shown once (remember the dismissal in `localStorage` inside try/catch). The why: "Limits in a prompt can be talked out of. Signatures can't." It sits behind a switch.

**350: Anonymous feedback.**
Only if it can be light and safe: three choices (useful / unclear / broken) and an optional note of at most 200 characters. That is one D1 row with no ids, no address and no user agent. It is rate-limited and never rendered back publicly, and it is readable only on the admin page (342). It sits behind a switch. If you cannot make it safe in time, drop it and say why.

## Files likely touched

New: `src/try/scenarios/{blocks,library,seed}.ts`, `src/try/endCard.ts`, `src/try/tour.ts`, `cloud/src/try/{botCheck,counter,adminPage,feedback}.ts`, `scripts/load-try.ts`, `test/try-*.test.ts`, a D1 migration in `cloud/migrations/` (additive only, next free number) for the counter, feedback and red-team rows.
Phase B registrations (small edits): `cloud/src/try/routes.ts`, `cloud/src/try/switches.ts`, `cloud/src/try/start.ts` (the bot check before the Durable Object), the try-page screen files, and `worker/src/trick.ts` plus `src/try/sign.ts` for item 73.
Use the shared animation module from the `site-after-merge` stream for the tick, shake and count-up once it lands. Do not create your own.

**Do not touch:** `src/redesign/*` and the Kit 11 site pages (site-after-merge), `cloud/src/console.ts` (books-cloud), `src/ledger/*` (read-only use is fine; the code belongs to books-cloud), `src/tokenize/*` and `src/agents/*` (agents-rails), `docs/submission/*` (proof-pack).

## Done when

- P1 items are built and wired behind switches, with tests. The end card verifies the signature in the browser, and a one-cent change fails.
- The books screen shows P&L and VAT before and after, computed, plus the labelled T0 row.
- The bot check sits before the Durable Object and its tests pass.
- The admin page is read-only and token-protected.
- The scenario library has at least 24 deterministic scenarios with `expect`, and the end card shows expected versus agents.
- The load test has run locally, with its record.
- Screens are checked at 390 and 1440 px in light and dark, plus 360 for `/try`. Screenshots are named in the PR body.
- Checks are green: typecheck, lint, the offline vitest command, `npm run -s test:d1`, judge `--check`, `trysign.check` and `pages.check` where touched, and CI including WebKit.
- The PR body lists every new switch with its default (all OFF) and the one new secret the orchestrator must set.

## Live calls

None. Claude is stubbed in tests and in the local load test. A run against the deployed Workers or with live Claude happens only after the owner's word through the orchestrator, within the existing try day cap.

## Rules (binding)

1. **No founder lines.** No founder story or bio anywhere.
2. **No quotes.** No quote from anyone on any screen or doc.
3. **No R2.** No R2 bucket, binding or mention. Uploaded or generated PDFs stay where try-core stores them.
4. **Numbers only from records.** Every number shown is read from D1 rows, a run record or computed by code. Counters are computed, never typed. "0 payments without a signature" must be a computed count.
5. **Stand-in labelled.** "Test money", "simulated bank", "sandbox", "recorded on <date>" and "illustrative" appear right next to the thing. A silent stand-in is a bug. Claude's fallback is labelled "Purser's code decided (Claude not used)".
6. Partner names as text only, with no logos. Never "certified", "endorsed" or "approved by". Never name competitors. No gendered pronouns for anonymous people.
7. No real money, no secrets in code, git or logs, and never print environment values. No personal data in counters, admin or feedback.
8. Tests never use the network. Run them with:
   `env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY npx vitest run`
9. Every Claude call follows `src/try/claude.ts` (model constants, dollar cap, timeout, labelled fallback, cost recorded). Check API parameters with the claude-api skill, not from memory.
10. Design: calm, existing tokens and components only, one main button per screen, details on click, ids last. Word budgets stay hard (`trysign.check` at most 65 words per screen).
11. English, short sentences.
12. Git: merge commits only, never rebase or force-push, never commit run data or keys. Draft PR body sections: What changed, Why, Tests and checks run, Live calls made, Not done. Do not merge or deploy.
13. When green or blocked, send one message to the orchestrator with the PR number, head, checks, live calls, switches and secrets to set, and what is not done.
