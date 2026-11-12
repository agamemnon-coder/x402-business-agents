# Stream: proof-pack

Branch: `proof-pack-1112` (create it from the base and push it to origin)
Base: `origin/main`.
Pull request: draft, against `main`.
Estimated work: about 35 hours. Many items repeat each other (406/521/589, 407/522, 408/523, 412/528/593), so the real work is less than the sum of the item estimates.
Deadline: the Phase A pull request is green by **Friday 13 November 20:00 UTC**. Phase B (the final pass) runs **Saturday 14 November 08:00-11:00 UTC** on merged main. The hackathon ends Saturday at 13:00 UTC.

## Context

Purser is the owner's entry for the Kit 11 hackathon. It has a public site, a hands-on jury demo, and Purser Cloud. Five build streams (site-after-merge, try-extras, books-cloud, agents-rails and this one) plus several already-running streams merge into main before Saturday. This stream does two jobs:
1. The **Demo Day pack**: the docs the owner uses to record the Demo Day video and answer jury questions. Demo Day is 19 November, 17:00-19:00 PT, which is 02:00-04:00 Dutch time. The submission deck and cheat sheets are part of it too.
2. **Quality and proof**: new tests and CI checks that can be written now, and then the final checks, reviews and fresh-clone runs on merged main.

The existing pack on main: `docs/submission/{demo-day.md, pitch.md, qa.md, cheat-sheet.md/.pdf, purser-deck.pdf, long-description.md, checklist-max.md, README.md}`, generated in part by `src/submission/deck.ts` and `npm run submission`, and checked by `test/demo-day-pack.test.ts`. It tells the old Kit 11 story (/watch → /try/sign → /proof, live pitch). The form text `docs/submission/README.md` belongs to the site-after-merge stream: do not edit it.

## Items (master-list line numbers)

### Phase A: now (new files, independent of the merges)

| Line | Item | Priority |
|---|---|---|
| 155 | Demo Day script (one use case: forged IBAN caught, over-limit asks CFO, Face ID on mirrored iPhone, one cent refused, paid via Airwallex + booked + archived, agent overspends own Airwallex card and Metal mandate and is refused, outcome, What's next, QR) written out with words per beat | P1 |
| 166 | What's next beat: Purser Cloud for SMB, Moneybird and Exact, invoice tokens on Metal (live on testnet), design partners, then QR 'try it yourself' | P1 |
| 191 | [C] Demo Day recording pack: practice checklist and recording order (which tabs open, which scenario, iPhone mirroring setup) | P1 |
| 211 | Update the Demo Day runbook (docs/submission/demo-day.md) to the new format: known time slot, recorded video played, QR to purser-try, backup video file and demo link, Q&A technique (repeat, 2 sentences, honest 'not tested yet', point to QR) | P1 |
| 220 | Seven near-certain Q&A answers (Claude mistake, why not spending limit/2FA, hold money/regulated, why Metal, how you make money, customers, real vs simulated) checked against run records and added to qa.md | P1 |
| 533 | 3-minute demo path (problem, invoice, forged IBAN refused, Face ID -> Airwallex, T0+Moneybird+Vault, token on Metal, agent overview, proof) | P1 |
| 230 | [C] Cheat sheet of ~40 questions per jury company (Anthropic, AWS, Visa, Metal, Coinbase, Base44), each answer 2 sentences and in line with claims.md | P2 |
| 409 | Chaos per partner (Airwallex, Metal, T0, Moneybird, Claude down or slow): clear behaviour, no double payment | P1 |
| 726 | Chaos tests per external party (Airwallex, Metal, Moneybird, Claude), clear outage behaviour | P1 |
| 725 | Keep >=90% coverage on money/policy/passkeys/executors; extend property and fuzz tests to tokenization and integrations | P1 |
| 408 | Browsers and screens: Chrome, Firefox, Safari; 390/768/1280/1440 px; light and dark (iPhone Face ID part needs owner) | P1 |
| 523 | Browsers Chrome/Safari/Firefox, 4 widths, light/dark (Phase 3 repeat) | P1 |
| 526 | Link check: every link and tx hash on site and README exists | P1 |

### Phase B: after all streams merge (Friday evening to Saturday 11:00 UTC)

| Line | Item | Priority |
|---|---|---|
| 516 | Deck (<=12 slides), form (<=4,000 chars), cheat sheets fully updated | P1 |
| 588 | Rebuild the deck and cheat sheets with the new runs | P1 |
| 406 | All checks green: typecheck, lint, suite, D1, judge, pages, redesign, trysign, console, webkit, CodeQL, gitleaks | P1 |
| 521 | All automatic checks (Phase 3 repeat) | P1 |
| 589 | Full QA: typecheck, lint, tests, judge, pages, redesign, trysign, webkit; links check; mobile at 390 px | P1 |
| 407 | End-to-end from zero 2x: fresh clone -> npm run judge | P1 |
| 522 | E2E from zero 2x offline (Phase 3 repeat) | P1 |
| 525 | Red team 3x on final code | P1 |
| 412 | Jury panel (4 reviewers) plus a fresh Claude with only the repo, until no red points | P1 |
| 528 | Jury panel of 4 Claude reviewers (Metal, Visa, Airwallex, founder/investor), fix, second round | P1 |
| 593 | Independent jury review (Claude panel as Metal, Visa, Airwallex and founder jury), then fix every point | P1 |
| 529 | Claude pre-screen test: fresh Claude with only repo URL explains Purser in 2 minutes | P1 |
| 549 | Release tag v1.0-submission, last fresh-clone check, checklist | P1 (tag needs the owner's word) |
| 604 | Release tag v1.0-submission, then npm run judge and the checklist in a fresh clone | P1 (tag needs the owner's word) |

## What to build, item by item

### Demo Day pack (Phase A)

**155 + 166: `docs/submission/demo-day-video.md`.**
This is a new file, separate from the submission film. The Demo Day organiser asked for a video "so different than the submission", so do not reuse the 3:00 submission cut from `watch-film-1112`. The video is under 3 minutes, with Max on camera, about agentic banking only, ending on a QR code. Write it out beat by beat, and for each beat give the words, the screen, and the seconds (about 2.3 words per second, the same rule `test/demo-day-pack.test.ts` uses for the pitch). The beats are:
1. A forged IBAN is caught.
2. An invoice over the limit asks the CFO.
3. Face ID on a mirrored iPhone.
4. One cent changed and refused.
5. Paid via Airwallex, booked, archived.
6. An agent overspends its own Airwallex card and its Metal mandate and is refused.
7. The outcome.
8. What's next.
9. The QR code with the short URL. Get the URL from the site-after-merge stream (the `/go` route); until it exists, write `<short URL from /go>` and leave a TODO line in the PR body.

For What's next (166): Purser Cloud for SMBs, Moneybird (live sandbox run: `docs/runs/2026-11-12-moneybird-sandbox.md`), Exact ("next", because there is no run yet), invoice tokens on Metal ("live on testnet" only if the tokenisation live run record exists on main, otherwise "built, live run pending"), design partners ("we are looking for", with no names and no claimed partners), then the QR code "try it yourself".

Every claim has a source line pointing to a run record. Extend `test/demo-day-pack.test.ts` so that it checks this file: the length per beat, the total under 3:00, and a source for every claim.

**191: `docs/submission/demo-day-recording.md`.**
The recording pack for Screen Studio or Tella. It covers:
- The practice checklist.
- The recording order.
- Which browser tabs to open and with which URLs: the public demo world from cloud-demo-1112 (`docs/cloud.md`) and purser-try `/try`.
- Which fixed scenario to use: the cloud-demo fixed world, with the forged IBAN plus the invoice over the limit, from `src/demoworld/companies.ts` once merged.
- The iPhone Mirroring setup steps.
- What to do on a retake.
- The organiser's checklist, copied into a tickable list: under 4 min; product shown within 30-45 s; no slides; one use case; legible; camera and light; followable without context; why it matters and what's next; watched fully before sending.

**211: Update `docs/submission/demo-day.md` (runbook).**
Change it from the live-pitch format of 7 November to the new one:
- The known time slot: 19 November, 17:00-19:00 PT = 02:00-04:00 NL.
- The recorded video is played.
- The QR code points to purser-try.
- A backup video file and a backup demo link.
- The offline fallback `npm run judge`.
- The Q&A technique: repeat the question, answer in 2 sentences, say "not tested yet" honestly, point to the QR code.

Remove the old start-up list of tabs (/watch, /proof, /try/sign).

**220: Seven answers in `docs/submission/qa.md`.**
Add these questions, each answered in at most 2 sentences with evidence (a path or link), in the format `test/demo-day-pack.test.ts` already checks:
- What if Claude makes a mistake?
- Why not a spending limit or 2FA?
- Do you hold money? Are you regulated?
- Why Metal?
- How do you make money?
- Customers?
- What is real and what is simulated?

Two of them need extra care. For pricing, read `src/config/pricing.ts` and `src/redesign/pricing.ts` after saas-pages-1112 merges, with per-invoice pricing as decided in pricing-thesis-1112. Do not type prices by hand: import them, or test them against that config. For customers, say honestly that there are no paying customers yet and that design partners are wanted. Invent nothing.

**533: 3-minute demo path.**
In `docs/submission/demo-day.md` (or a section of it), lay out the click path with times: problem, invoice, forged IBAN refused, Face ID → Airwallex, T0 + Moneybird + Vault, token on Metal (labelled by record status), agent overview, proof. Each step names the URL and the fallback if it fails. Performing it is the owner's job.

**230: Cheat sheets per jury company.**
Create `docs/submission/jury/{anthropic,aws,visa,metal,coinbase,base44}.md`. Aim for up to about 40 likely questions per company, ordered by likelihood. Never pad: fewer is fine if the angle is narrow. Each answer is 2 sentences and consistent with `docs/claims.md`. Add a test (`test/jury-cheat-sheets.test.ts`) that checks the answer length, that every number in an answer appears in `docs/claims.md` or a run record, and the banned words: "certified", "endorsed", competitor names, and quotes. The old `docs/submission/cheat-sheet.md` is the one-page sheet. Update it in Phase B (588).

### Quality (Phase A)

**409 + 726: Chaos per partner.**
`test/chaos.test.ts` covers Anthropic, the relay, Metal RPC and Airwallex. `test/erp-hardening.test.ts` covers Business Central and Exact 429s. Add a new file `test/chaos-partners.test.ts` with these cases:
- T0 down and T0 slow.
- Moneybird down and Moneybird slow.
- Claude slow: the timeout fires and the labelled fallback takes over.
- A tokenization RPC outage in the middle of a flow.

Each case asserts clear behaviour (a plain message, a retry or stop, a run record entry) and **no double payment or double posting** after recovery. Use fakes only.

**725: Property tests for tokenize and the integrations.**
Add `test/property-tokenize.test.ts`, covering discountedPrice bounds, mint and settle amounts conserved, and a tampered record always refused. Add `test/property-erp.test.ts`, covering the cents round trip through the Moneybird, Exact and T0 mappers and idempotent re-sync. Use fast-check, which is already a devDependency. Keep the 90% floor in `test/coverage-areas.ts`, and add `src/tokenize` to the areas if the floor holds.

**408 + 523: Firefox, and all four widths.**
CI runs Chromium and WebKit (the `webkit` job in `.github/workflows/ci.yml`). Add a `firefox` job that installs only Playwright Firefox in CI (`npx playwright install --with-deps firefox`) and runs `pages.check.ts` and `trysign.check.ts` with a browser switch (add a `BROWSER=firefox` option to the check support code in `test/browser/support`). The 1280 px width is added by the site-after-merge stream (item 356). After that merges, make sure all three browsers run 390/768/1280/1440 in light and dark. The real iPhone Face ID check is the owner's job.

**526: Link check.**
There are two parts.
1. An offline test: every tx hash and Airwallex id that appears in `README.md`, `llms.txt`, `docs/claims.md` and the site pages must also appear in a run record under `docs/runs` or `docs/demo`.
2. A script `scripts/linkcheck-external.ts` (`npm run links:external`, never part of the default test run) that checks every external link and explorer URL in the README, the site and the docs. Run it once in Phase B with a budget of **at most 400 HEAD/GET requests** to public hosts: GitHub, the block explorers, partner docs. Write the result to `docs/runs/2026-11-14-link-check.md`.

### Phase B (on merged main)

**516 + 588: Deck and cheat sheets.**
Rebuild `docs/submission/purser-deck.pdf` (at most 12 slides) and `cheat-sheet.md/.pdf` from `src/submission/deck.ts` and `npm run submission`, using the new runs: two locks PAID, Moneybird, the T0 journal, the platform fee, and Face ID on chain and tokenisation only if their records exist. Put the short URL from `/go` under the QR code. Use no founder or team-bio slide, no quotes, and no competitors. The form text is the site stream's job: only check its 4,000-character test.

**406 / 521 / 589: All checks on merged main.**
Run on a fresh checkout of `origin/main`:
- typecheck and lint
- the full suite with coverage
- `npm run -s test:d1`
- `judge -- --check`
- pages, redesign, trysign, console and trace checks in Chromium, WebKit and Firefox
- gitleaks
- the CodeQL status (GitHub default setup: read it with `gh api repos/agamemnon-coder/x402-business-agents/code-scanning/alerts?state=open`)
- mobile at 390 px

Fix what is red, or hand it to the owning stream through the orchestrator. Record the results in `docs/runs/2026-11-14-final-checks.md`.

**407 / 522 / 604: Fresh clone, twice.**
Run this twice in a new temporary directory, offline (with the API keys unset): `git clone`, then `npm ci`, then `npm run judge`, then the checklist in `docs/submission/checklist-max.md`. Record the times and the results.

**525: Red team three times.**
Run `npm run redteam`, `npm run redteam-night` and `npm run autonomy-redteam` on final main, three rounds. These call Claude, so the budget is **at most $15 in total, from the `redteam` block of `src/claude/budget.ts`**. Use the cheapest configured model where the CLI allows it. Record the results under `docs/redteam/` with the date.

**412 / 528 / 593 + 529: Jury panel and pre-screen.**
Run four independent reviewer subagents with no shared context, each given only the repository and the public URLs. Their personas are: Metal juror, Visa juror, Airwallex juror, and founder/investor juror. The last one is a reviewer persona only: nothing about the founder goes into any doc. Each lists red, amber and green points with evidence. Fix every red point: small ones in this branch, page ones through the owning stream or a follow-up, coordinated by the orchestrator. Then run a second round, until no red points remain.

Then run one fresh subagent with only the repository URL, which must explain Purser in 2 minutes of reading (529). Record both in `docs/reviews/2026-11-14-jury-panel.md`. Reviewer subagents are Claude Code sessions, not API spend.

**549 / 604: Release tag.**
The tag `v1.0-submission` already exists on origin (b704672, 8 November). Moving it is a force tag push and **needs the owner's word**. Prepare everything: the release notes (`docs/submission/release-notes.md`), the exact commands, and a non-destructive alternative (a new tag such as `v1.1-submission`). Ask through the orchestrator, and do not push any tag without the owner's explicit yes.

## Files likely touched

New: `docs/submission/demo-day-video.md`, `docs/submission/demo-day-recording.md`, `docs/submission/jury/*.md`, `test/chaos-partners.test.ts`, `test/property-tokenize.test.ts`, `test/property-erp.test.ts`, `test/jury-cheat-sheets.test.ts`, `test/link-records.test.ts`, `scripts/linkcheck-external.ts`, `docs/runs/2026-11-14-*.md`, `docs/reviews/2026-11-14-jury-panel.md`, `docs/redteam/2026-11-14-*`.
Edited: `docs/submission/{demo-day.md, qa.md, cheat-sheet.md, cheat-sheet.pdf, purser-deck.pdf, checklist-max.md, release-notes.md, pitch.md}`, `src/submission/deck.ts`, `test/demo-day-pack.test.ts`, `test/coverage-areas.ts`, `test/browser/support/*`, `.github/workflows/ci.yml` (the firefox job), `package.json` (scripts).

**Do not touch:** `docs/submission/README.md` (the form text: site-after-merge), `README.md`, `llms.txt`, `docs/claims.md` (site-after-merge; send them your findings), `src/redesign/*`, `cloud/src/*`, `src/ledger/*`, `src/tokenize/*` and `src/agents/*` (tests only).

## Done when

- **Phase A:** the Demo Day video script, the recording pack, the runbook, the seven Q&A answers, the demo path and the per-company cheat sheets are written and tested against records and claims. The chaos tests for T0, Moneybird, slow Claude and the tokenize RPC pass with no double payment. Property tests for tokenize and the ERP mappers pass, with coverage at or above 90%. The Firefox CI job is green. The offline link-to-record test passes. The PR is green by Friday 20:00 UTC.
- **Phase B:** on merged main the deck and cheat sheets are rebuilt. Every check is green in three browsers at four widths. Two fresh-clone judge runs are recorded. Three red-team rounds are recorded within $15. The external link check is recorded. The jury panel's second round has no red points, and the pre-screen is recorded. The release commands are ready, and a tag is pushed only on the owner's yes.

## Live calls (budget for this stream)

- Claude: at most $15 in total for the three red-team rounds, from the `redteam` block.
- External links: at most 400 HEAD/GET requests to public hosts, once, in Phase B.
- GitHub API reads for the CodeQL status.
- No Airwallex, Metal, T0, Moneybird or Airi calls, and no tag push without the owner's yes.

## Rules (binding)

1. **No founder lines.** No founder story, bio or team slide in the script, deck, cheat sheets or answers. "Founder/investor juror" is only a reviewer persona.
2. **No quotes.** No quote from anyone (the CFO, Steef, Bart, customers, partners) in any doc, slide or script.
3. **No R2.** Never mention R2 as storage or as a plan.
4. **Numbers only from records.** Every figure in the script, deck, Q&A and cheat sheets comes from a run record or `docs/claims.md`, and a test checks it. Prices come from the pricing config.
5. **Stand-in labelled.** Simulated, sandbox, testnet, stand-in and "not run yet" are said plainly. Say "next", not "live", for anything without a run (Exact, real customers).
6. Partner names as text only, with no logos. Never "certified", "endorsed" or "approved by". Never name competitors. No gendered pronouns for anonymous people.
7. No real money. No secrets in code, git, logs or output. Never print environment values.
8. Tests never use the network. Run them with:
   `env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY npx vitest run`
9. English, short sentences: answers in 2 sentences, script beats in plain spoken words.
10. Git: merge commits only. Never rebase or force-push, never push or move tags without the owner's yes, never commit raw run data or keys. Draft PR body: What changed, Why, Tests and checks run, Live calls made (counts and dollars), Not done. Do not merge or deploy.
11. When Phase A is green, when Phase B is done, or when you are blocked, send one message to the orchestrator: the PR number, the head, the checks, the live calls, the red points and who owns them, and the tag question for the owner.
