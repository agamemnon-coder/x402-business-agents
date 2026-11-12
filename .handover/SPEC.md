# Stream: site-after-merge

Branch: `site-after-merge-1112` (create it from the base below; push it to origin)
Base: `origin/main` **after** these four running site streams have merged into main (expected around 17:00 UTC on Thursday 12 November): `home-story-1112`, `saas-pages-1112`, `runs-timeline-1112`, `partner-pages-1112`.
Pull request: draft, against `main`.
Estimated work: about 27 hours of build time, so run the tasks in parallel where the files allow it.
Deadline: the pull request is green by **Saturday 14 November 08:00 UTC**. The hackathon ends Saturday 13:00 UTC. The owner submits before then and needs a final check window.

## Why this stream exists

The public site (the Kit 11 Worker in `worker/src`, which renders the pages from `src/redesign/*` and `src/ui/*`) is being rewritten right now by four other streams. Any change to those pages made before they merge would conflict. This stream collects every master-list item that changes the site pages, the README or the submission form text, and does them in one pass on top of the merged result.

## Before you start (gate)

1. `git fetch origin` and check that all four branches are in main:
   `for b in home-story-1112 saas-pages-1112 runs-timeline-1112 partner-pages-1112; do git merge-base --is-ancestor origin/$b origin/main && echo "$b merged" || echo "$b NOT merged"; done`
2. If one is not merged yet, do not edit `src/redesign/*`, `src/ui/*`, `README.md`, `llms.txt` or `docs/claims.md`. You may write new standalone modules and their tests (for example the pure computation for item 81), then check again every 30 minutes. If one is still not merged at 20:00 UTC, send the orchestrator a message and ask what to do.
3. `approve-design-1112` (the phone approve pages) and `try-page-1112` (the new `/try` page on purser-try) are also running. The approve-page part of item 354 waits for `approve-design-1112` to merge. The `/try` page is NOT yours: the `try-extras` stream owns it.

## Items (master-list line numbers)

| Line | Item | Priority |
|---|---|---|
| 81 | Measure Face ID to paid per chain run, with median and spread on /runs | P1 |
| 686 | On-chain audit trail: 'verify on-chain' button per approval and payment (hash + tx) | P1 |
| 585 | /metal: new sections 'Face ID signs on chain' and 'Invoice -> token -> pre-financing -> settlement', real tx links only | P1 |
| 508 | Partner page /t0 (what runs, proof, why only with them) | P1 |
| 586 | Update the form text with Face ID on chain and tokenisation (<= 4,000 chars) | P1 |
| 153 | Tokenization stays as Metal Award proof on /metal and in the README (not in the recording) | P1 |
| 181 | Short URL next to the QR code | P1 |
| 356 | Typography, spacing, colour checked at 390, 768, 1280, 1440 px, light and dark | P1 |
| 357 | Accessible: contrast, focus, screen-reader labels, reduced motion | P1 |
| 358 | Copy pass: short sentences, no unexplained jargon, read as CFO and as developer | P1 |
| 597 | GitHub Topics: add the missing ones | P1 |
| 354 | Consistent animations everywhere: Face ID tick, shake on refusal, count-up on amounts | P2 |
| 355 | Empty, loading and error states human, no bare error codes | P2 |
| 594 | Animation on Home: an invoice becomes a token, with a Face ID tick | P2 |
| 512 | README: Vault folder tree as image | P2 |
| 510 | README: new hero GIF | P2 |
| 596 | Refresh the README screenshots; re-record demo.gif with tokenisation | P2 |
| 120 | If the demo world goes public, update README, llms.txt, claims.md, the form and after-the-kit.md together | P2 (switched on only at the owner's deploy go) |

## What to build, item by item

**81: Face ID to paid, median and spread on /runs.**
The times are in the run records on main: `docs/runs/2026-11-07-awx-1.md` and `docs/demo/airwallex-run.json`, the two-locks records (`docs/runs/2026-11-10-airwallex-two-locks.md` and `docs/runs/2026-11-12-airwallex-two-locks-paid.md`), and `docs/runs/2026-11-10-platform-e2e.md`. Write a pure function (for example `src/redesign/runTimes.ts`) that reads the approval time and the paid time from each record and returns `n`, the median and the minimum to maximum. Render one calm line on `/runs` (`src/redesign/runs.ts`), such as "Face ID to paid: median X, from Y to Z, over N runs". Put the per-run times behind a fold. Count only runs that reached PAID. A run without both timestamps is left out and counted as left out. Test: `test/run-times.test.ts` builds the numbers from the real records and fails if the page shows any other number.

**686: 'Verify on-chain' per approval and payment.**
Today there are only tx links (`src/redesign/agents.ts` EXPLORER_TX, `src/redesign/metalStory.ts`). Add one small "Verify" control per approval and per payment row on `/runs` (and on the `/metal` mandate rows if the partner-pages layout has them). In the browser it does three things: it recomputes SHA-256 over the stored terms with WebCrypto, compares the result with the signed terms hash, and shows the tx or Airwallex id with its explorer link. Reuse the existing verification code where it exists (`src/try/verify.ts`, `test/try-verify.test.ts`). The result is plain words, for example "Hash matches the signed terms" or "Does not match". Tests: one where the hash matches and one with tampered terms that must show a mismatch. Ids and hashes stay last, behind the fold, following the design rule.

**585: /metal sections 'Face ID signs on chain' and 'Invoice -> token -> pre-financing -> settlement'.**
The live runs have not happened yet. They are the owner's runs: `docs/runs/driver/faceid-onchain-runbook.md` and `docs/runs/driver/tokenize-runbook.md`. Build both sections so that they render only from a run record, in the format of `src/tokenize/runRecord.ts` and of the faceid-onchain run record. Follow how `src/redesign/tokenizeRun.ts` already hides its block until a record exists. Use real tx links only. Test with fixture records under `test/fixtures/`, never with records in `docs/runs`. With no record, each section shows nothing, or at most one labelled line, "Built; the live run on Metal testnet has not happened yet", with a link to the runbook. Never show a placeholder hash.

**508: Partner page /t0.**
No `/t0` route exists. Add one in `worker/src/core.ts`, with the page in `src/redesign/partners.ts` or a new `src/redesign/t0.ts`, linked under "More" (`src/ui/more.ts` from saas-pages). The content covers what runs with T0 and the proof: `docs/runs/2026-11-10-t0-journal-sandbox.md` (the journal entries, 0 differences) and `test/t0-statements.test.ts`. Read every number from the record. Phrase "why only with them" as what T0 does in this build. Do not compare with other vendors, and name no competitors. Add a word-budget test like those of the other partner pages, and add the page to `CHECK_PATHS`.

**586: Form text with Face ID on chain and tokenisation.**
The form text is `docs/submission/README.md` and must stay at or under 4,000 characters (keep or add the length test). Add one sentence each on Face ID on chain and on tokenisation, but only to the extent the run records exist on main when you do this. Without a record the sentence says "built and tested offline; live run pending", or it is left out. Re-check this just before you finalize.

**153: README tokenization line.**
Add one README line on invoice tokenization as Metal Award proof, with a link to the live run record if it exists, and otherwise to `docs/tokenize.md`, labelled "live run pending". Keep it out of the first screen: home-story owns the README first screen.

**181: Short URL next to the QR code.**
Add a short redirect path on the Kit 11 Worker, for example `/go`, that answers 302 to the hands-on demo on purser-try. The target comes from a Worker variable, for example `TRY_GO_URL`. The default is `https://purser-try.max-31b.workers.dev/try`. Never put an event token in code. Test the route. Render the short URL under the QR wherever the site shows one. The deck slide and the video end card belong to other streams, so tell the orchestrator the final URL. Deploying is the orchestrator's job, with the owner's word.

**356: 1280 px and new pages in the browser check.**
`test/browser/pages.check.ts` runs at 360/390/768/1440. Add 1280 x 800. Add every new page to `CHECK_PATHS`: `/try` is on another host, so leave it out; include `/visa`, the partner pages, the SaaS pages (pricing, security, status, docs), `/t0` and `/runs`. Fix every overflow or overlap it finds.

**357: Accessibility.**
Add `@axe-core/playwright` as a devDependency, pinned to an exact version at least two weeks old. Run it inside `pages.check.ts` on every path, in light and dark, and fail on serious and critical violations. Also check that a keyboard focus ring is visible on links and buttons, and keep the existing named-controls and reducedMotion checks (pages.check.ts lines 59 and 132). Fix what it finds using existing tokens only. Do not add new colours unless a contrast failure leaves no other option, and if so, say so in the PR body.

**358: Copy pass.**
Read every site page twice, once as a CFO and once as a developer. Write short sentences, explain each term once or drop it, and keep one story per page. Word budgets must not grow. If a test's word budget must change, change it minimally with a dated comment.

**597: GitHub topics.**
The owner asked to "upgrade everything, also the repo". The current topics are agentic-payments, ai-agents, airwallex, claude-code, fintech, hackathon, passkeys, webauthn and x402. Add payments, claude, anthropic, metal, accounting and tokenization, and keep the existing ones (GitHub allows 20 at most). Run it once with `gh api -X PUT repos/agamemnon-coder/x402-business-agents/topics -f "names[]=..."`, then read it back with `gh api repos/agamemnon-coder/x402-business-agents/topics`. Put the before and after lists in the PR body.

**354: Consistent animations.**
`src/try/sign.ts` (around lines 1812-1843) has the draw, shake and lockon keyframes. Move one shared set into `src/ui` as a single module: the Face ID tick, the shake on refusal, and a count-up on amounts. Each one respects `prefers-reduced-motion`, which turns it off. Use it on the site pages and, after `approve-design-1112` merges, on the approve pages. Export it so that the try-extras stream can use it on `/try`. Do not edit the `/try` page yourself. Count-up shows the final number at once under reduced motion and in the test.

**355: Empty, loading and error states.**
Go through every site page and the approve pages. No bare error code or "null" may reach the screen: each state gets one human sentence and one next step. The console belongs to `books-cloud` and `/try` to `try-extras`, so leave those two alone.

**594: Home animation, an invoice becomes a token, with a Face ID tick.**
Make it small, in the existing Home story (`src/redesign/home.ts`), with no new styles beyond the shared animation module. It must say "illustrative" until a tokenisation live run record exists on main. After that it may link to the record. It respects reduced motion, and the Home word budget stays.

**512: Vault folder tree as an image.**
Generate an SVG from `src/vault/layout.ts` with a script, so that the image is computed from the code and never drawn by hand. Commit it under `docs/media/`, use it in the README, and add a test that the SVG's folder names match `layout.ts` (Company/Year/Quarter/Inkoopfacturen|Betalingen|Rapporten).

**510 and 596: README hero GIF and screenshots.**
Re-record `docs/media/demo.gif` from the merged site, using the existing screenshot and GIF tooling (search `scripts/` and `src/film`), at the same size budget as now. Refresh the README screenshots that home-story did not refresh. The tokenisation part of 596 waits for the tokenisation live run record. If that record is not on main by Friday 20:00 UTC, record without it and say so in the PR.

**120: Public demo world docs.**
`docs/submission/README.md:49` still says "the console is not public". Prepare the coordinated change across README, `llms.txt`, `docs/claims.md`, the form (`docs/submission/README.md`) and `docs/after-the-kit.md`, using the URL of the public read-only demo from `cloud-demo-1112` (`docs/cloud.md`). Put it in ONE separate commit, the last one on the branch, titled "Docs: the public demo world". The PR body says that this commit goes in only when the owner has given the deploy go. Without that go, the orchestrator reverts it.

## Files likely touched

`src/redesign/runs.ts`, `src/redesign/runTimes.ts` (new), `src/redesign/partners.ts`, `src/redesign/t0.ts` (new), `src/redesign/metalStory.ts`, `src/redesign/home.ts`, `src/redesign/agents.ts`, `src/redesign/proof.ts`, `src/ui/*` (the shared animation module, `more.ts`), `worker/src/core.ts` (the `/t0` and `/go` routes), approve-page files after approve-design merges, `test/browser/pages.check.ts`, `test/*` (new tests), `package.json` (the axe devDependency), `README.md`, `llms.txt`, `docs/claims.md`, `docs/after-the-kit.md`, `docs/submission/README.md` (the form text only), `docs/media/*`.

**Do not touch:** `cloud/src/console.ts` and `cloud/src/*` (books-cloud), the `/try` page and `cloud/src/try/*` (try-extras), `src/submission/deck.ts` and `docs/submission/*` other than README.md (proof-pack), `src/tokenize/*` and `src/agents/*` (agents-rails).

## Done when

- Every P1 item is built, tested, and visible at 390, 768, 1280 and 1440 px in light and dark. Screenshots are named in the PR body.
- `/runs` shows the median and spread computed from the records. A verify control is on every approval and payment row, and a test proves that a tampered hash is caught.
- `/t0` exists under More, and its numbers come from the T0 record.
- The `/metal` sections render from fixture records in the tests and show no fake hash on main.
- The form text is at or under 4,000 characters, and every claim in it has a record.
- axe reports no serious or critical violations on any checked path. 1280 px is in the check.
- Topics are updated and read back.
- All checks are green: `npm run -s typecheck`, `npm run -s lint`, the offline vitest command below, `npm run -s judge -- --check`, `npx tsx test/browser/pages.check.ts`, `npx tsx test/browser/redesign.check.ts`, `npx tsx test/browser/trysign.check.ts`, and CI including WebKit.
- P2 items are done or listed under "Not done" with the reason.

## Rules (binding)

1. **No founder lines.** No founder story, no bio, and no "a business student builds…" anywhere: site, README, form, docs.
2. **No quotes.** No quote from anyone (the CFO, Steef, Bart, customers, partners) on any page or in any doc.
3. **No R2.** No Cloudflare R2 bucket, binding, lifecycle rule or mention of it as storage.
4. **Numbers only from records.** Every figure on a page, in the README, the form or the docs is read from a run record (`docs/runs/*`, `docs/evals/*`, `docs/demo/*.json`) or computed by code from one. Never type one by hand. Tie each new figure to its record with a test (pattern: `test/figures.test.ts`, `test/data-qa.test.ts`).
5. **Stand-in labelled.** Anything simulated, sandbox, testnet, stand-in or illustrative says so right next to it, and nothing is claimed live that did not run live. A silent stand-in is a bug.
6. Partner names as text only, with no logos. Never "certified", "endorsed" or "approved by". Never name competitors. Write "the CFO", with no gendered pronouns for anonymous people.
7. No real money and no secrets in code, git, logs or output. Never print environment variable values.
8. Live or external calls: none, except the one GitHub topics call (597). Tests never use the network. Run them with:
   `env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY npx vitest run`
9. Do not deploy. The orchestrator deploys with the owner's word.
10. Design: calm, one design system (existing tokens and components), one story per page, at most 5 menu items, details on click, ids and hashes last. Word budgets stay hard. For every screenshot ask: calmer or busier? Busier means redo.
11. Copy: English, short plain sentences.
12. Git: merge `origin/main` in with merge commits, never rebase or force-push, and never commit run data, ledgers or keys. A gitleaks false positive goes into `.gitleaksignore` as a fingerprint line. Draft PR body sections: What changed, Why, Tests and checks run, Live calls made, Not done. Do not merge.
13. When green or blocked, send one message to the orchestrator with the PR number, head commit, checks, live calls and what is not done.
