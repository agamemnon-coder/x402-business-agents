# Purser v1.0-submission

The version submitted to the Airwallex Agentic Banking Hackathon: Starter Kit 11 (x402 Business Agents), entered for
the Metal Award. Visa TAP: built and verified against Visa's public reference verifier; not eligible Visa tooling for
this hackathon (Visa, 5 Nov). Tag `v1.0-submission`.

Three Claude agents run a small data business on test money through Metal (testnet) and Airwallex (sandbox). Metal
holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; the CFO approves
anything beyond them, with Face ID on the exact terms.

## The main run (3 November, world `main-1`)

- **The price rise:** Metal refused purchase #24 on chain (`mandate_cap_exceeded`, tx `0x2e92f9cb…1871`; let through on
  purpose, Purser normally refuses first). After four eyes, both mandates were replaced on chain.
- **The dispute:** 12 orders disputed, all signed by the customer's own agent; the Support agent refunded the 3 with
  wrong data; "refund the other 9" was rejected with Face ID.
- **The euro bill:** EUR 240.00 by FX and SWIFT, PAID 6 s after Face ID (transfer
  `03360bfa-afce-457b-89d1-e1097fbe3985`; settlement simulated in the sandbox).
- 24 of 24 decisions by Claude (Sourcing on Haiku, Support on Sonnet, Treasury on Opus), 0 fallbacks.
  16 stops, nothing paid over a limit: a buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.

Record: [docs/demo/main-run.json](../demo/main-run.json); log: [docs/runs/2026-11-03-main-run.md](../runs/2026-11-03-main-run.md).

## Try it

- The site, replaying the main run: <https://kit11.max-31b.workers.dev/>
- Sign with your own Face ID in a test world of your own: <https://kit11.max-31b.workers.dev/try/sign> (nothing real
  moves).
- Offline, no keys: `npm ci && npm run judge` (Node.js 22.13 or later).

## Checked at this tag

- 2291 tests in 245 files, all passing; typecheck, lint and `npm run judge -- --check` clean; CI green.
- `gitleaks` over every commit on every branch: no leaks (the checked false positives are listed in `.gitleaksignore`).
- Every tx hash and id in the README, the submission pack, the claims, the site and the video script is in a run
  record.

## Since the tag

- 5 November: the stops are said in one sentence everywhere ("Metal refused 1 purchase over its cap; the CFO rejected 1
  proposal."), and the form's Description is short (the long text is
  [long-description.md](long-description.md)). /try/sign stays within a phone's width after the tamper. The premiere
  film (v5) runs 2:42; the hook is "So who signs off?". 2363 tests in 248 files, all passing.
- 5 November, later: the stops are the run's full story ("16 stops, nothing paid over a limit: Claude skipped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing."), counted from the record's refusal
  rows and summed to its own count; the README and the form say who does what (what Max built, what Airwallex, Metal and
  Claude provide); the film's proof card shows the 16 stops, and its end card credits the AI-generated voice and music
  (ElevenLabs) and who does what. 2363 tests in 248 files, all passing.
- 5 November, last: the film is 2:42 everywhere it is named, and its voice-over is what the end card says: an
  AI-generated voice (ElevenLabs), a narrator in the third person (“This is Purser, built by Max Geurtsen.”), with
  AI-generated music (ElevenLabs); the narrator's lines are `docs/video/narrator-script.md`, every figure in them still
  checked against the record. Home's heading is the film's line, “AI agents spend. You sign off.”. 2365 tests in 248
  files, all passing.
- 5 November, Visa's answer: TAP is not available as Visa tooling for this hackathon (VIC or ICC only), so the entry
  is the Metal Award only. The Kit line, Home's badge and the links on Home and Proof no longer name the Visa Award;
  /visa keeps the TAP work as a labelled extra, with one status line. 2365 tests in 248 files, all passing.
- 6 November, security headers and supply chain (A3, A4): every relay answer also carries `x-frame-options: DENY`
  and HSTS with `includeSubDomains`; JSON, redirects and assets a CSP that loads nothing; the 404 the permissions and
  opener policies the pages have; `/favicon.ico` serves Purser's mark, and the phone pages and the evidence report name
  it (no more CSP error in Firefox). Dependabot (weekly: npm, the Worker, the Actions); the gitleaks image pinned by
  digest; the SBOM regenerated. Live after the relay is redeployed. 2370 tests in 248 files, all passing.
- 6 November, passkey checks: test/webauthn-soundness.test.ts shows, for the runner, the relay's verifier and /try/sign,
  that challenges are random (32 bytes), used once and short-lived (an approval's is the hash of its terms, which carry
  the proposal id and expiry); that origin and RP id must match exactly and user verification is required; that a
  signature counter, once used, must grow; and, one test per field of the terms, that a changed field is refused. Two
  fixes: the runner now refuses a passkey used inside a frame on another site (cross-origin), as the relay already did;
  /try/sign's API refuses unknown or mistyped fields and answers any internal error with a fixed message. /try/sign is
  also opened in WebKit in CI: Playwright's Linux WebKit has no WebAuthn, so it checks the page's honest "no passkeys"
  answer and its layout, not the visit. 2437 tests in 249 files, all passing.
- 6 November, reliability runs: `npm run reliability` runs the full Kit 11 flow in a fresh world (sandbox, testnet,
  test money, labelled virtual test passkeys). rel-1 stopped at one step (the card purchase: Treasury told Sourcing to
  wait instead of asking the CFO itself); one rule added to Treasury's instructions, with evals; rel-1b passed every
  step. Both runs are in docs/runs/reliability-2026-11.md, failure included. 2447 tests in 251 files, all passing.
- 6 November, the jury review: every surface opens with what only Purser has, three sentences word for word
  (`DIFFERENTIATORS`: the signature over the exact terms, one CFO policy as three locks, real agents with no key reaching
  Claude), then "The Kit 11 scenario, run live on 3 November.". The 12 overpriced checks are said as they happened: "a
  buy rule Claude set stopped 12 overpriced checks" (code applied the rule; the film keeps its older line). One set of
  numbers: "86 Metal payments + 1 card charge", "5 decisions signed with Face ID (+1 co-signature)". The let-through is
  framed as a test of the chain, both layers shown. The form's caveats are one line with a link; Visa TAP is a footer
  link on Home and Proof, and the form's screenshot 6 is /try/sign, signed and tampered. 2459 tests in 252 files, all
  passing.
- 6 November, the jury's technical QA: /try fits a 320–375 px phone (the tabs take their own line) and the replay's
  tables stack below 900 px, both checked at 360 and 768 px now; /film is labelled as the earlier animation of
  30 October, and Home and Proof link the film (2:42); every public page carries the same link-preview tags with an
  absolute image, and the favicon where its CSP allows one; one tagline everywhere, "AI agents spend. You sign off.";
  the deck's slide count is right (ten); the claims' site section is the main run's. 2468 tests in 253 files, all
  passing.
- 6 November, /try/sign as the demo: three steps with a progress indicator ("The agent proposes" → "You sign with Face
  ID" → "Purser verifies"), the start button above the fold on a phone; the waiting proposal shown as the CFO's approval
  sheet (amount, beneficiary, IBAN, reference, expiry, the terms hash short with Copy and a tap for all of it), naming
  the real sheet it follows (P-0005, from the main run's record); the disclaimer one line plus "What's real?". The
  visitor tampers with a field of their own choosing (the amount, the IBAN or the currency) and sees which field
  changed, the new hash next to the signed one, and the server refusing the same signature. The blocked proposal shows
  which of three locks stopped it (Purser's policy; simulated in the test world) and links each lock's real example:
  Metal's on-chain refusal in the main run, Airwallex's LIMIT_EXCEEDED of EUR 45.00 in the separate TAP run of 2
  November, and Purser's floors holding at P-0005 in the main run (only the shortfall converted: EUR 110.00 for USD
  124.29). After review: one "What's real?" only, opaque sticky header and steps, one sentence per explanation with
  "more" for the rest, a green check after signing, and one closing line after a refused tamper ("One cent changed. The
  signature is worthless."). The terms now carry the payee's IBAN (a test one, check
  digits 00; schema kit11.try-terms/v2); the film and the social preview keep the v1 terms they were made with. Live
  after the Worker is redeployed. 2482 tests in 254 files, all passing.
- 6 November, /try/sign's receipt: after signing, the page offers receipt.json (the exact terms, their hash, the
  passkey's assertion, its public key, the algorithm; no world token), and `npm run verify-receipt -- receipt.json`
  checks it offline with Node's own crypto: the terms' hash, the challenge, the origin and RP id, user presence and
  verification, the ES256 signature. One changed field or one cent fails. The Worker's answer to a good signature now
  carries the public key it verified against. 2495 tests in 255 files, all passing.
- 6 November, /try/sign's live FX quote: the waiting payment's terms carry a quote from the Airwallex sandbox (EUR
  bought, USD sold; schema kit11.try-terms/v3), so the signature binds to the quote id; once the quote expires the
  server refuses even a good signature ("Quote expired. Get a fresh one and sign again.") and the page offers a new
  quote, which means new terms, signed again. The Worker may call only login and quote creation on the sandbox host
  (a fixed table, tested: no conversion, no transfer); the key stays in the Worker, never in an answer or a log; quotes
  are limited per address and for everyone. Without Max's scoped key in the Worker's secrets the page shows the main
  run's recorded quote, labelled. The receipt carries the quote and verify-receipt reports it. Tested on Max's iPhone
  (Safari, Face ID) on 6 November: signed, tamper refused, receipt downloaded. 2521 tests in 256 files, all passing.
- 6 November, Airwallex read back (section B): /proof and /airwallex show what the Airwallex sandbox itself returns for
  the main run, read with GET only (nothing created, updated or cancelled) into two dated, sanitized records. "The hash
  the CFO signed travels with the payment": the terms hash Max signed with Face ID for P-0005 next to the
  `metadata.approval_sha256` Airwallex returns for transfer `03360bfa…3985`, matched in code
  (`docs/runs/airwallex-transfer-approval-2026-11-06.json`). Each agent's card: the CFO policy rule next to the control
  Airwallex enforces (limit per purchase and per month, merchant category, currency, end date), 3 of 3 cards matching;
  on /airwallex one line at the top, each card side by side in a fold
  (`docs/runs/airwallex-cards-2026-11-06.json`; no card number beyond its last four digits). Live after the Worker is
  redeployed. 2529 tests in 257 files, all passing.
- 6 November, the Metal story: /metal opens with the main run on one screen, each claim linked to Metal's testnet
  explorer and every figure read from the record (`src/redesign/metalStory.ts`): 3 mandates on chain, one per agent;
  86 Metal payments, each its own transaction (41 sales, 41 supplier purchases, 3 refunds, 1 sweep; each matched on
  chain by the run's data-qa); #24 refused on chain; the mandates replaced after Face ID. The separate runs (four eyes,
  passkeys as owners, clearing, clearing load, receive policy, compliance) are folded below it, each dated with its
  run record. A review of Purser's use of `metal-agent` and `metal-pay` against their own docs
  ([metal-review.md](../metal-review.md)) fixed four things: a pull retried after a mandate replace first asks the old
  credential, so it is never paid twice (this did not occur in the main run: its 4 pulls, 1 sweep and 3 refunds, were each paid once with their own transaction, and none was retried across a mandate replace; a regression test, `test/metal-pull-after-replace.test.ts`, fails without the fix); a clearing wallet is kept for one Clearing deployment; a lost clearing answer
  is read from `ClearingRefusal.reason`; a disputed order counts as signed from `verifyMandatePayment`'s outcome, not
  its wording. The feedback for Metal and Airwallex is cut to what worked and what was hard, and corrected where
  metal-pay already had what we asked for. 2557 tests in 260 files, all passing (after Airwallex read back).
- 6 November, the Demo Day pack (docs only): a 3-minute Demo Day pitch in [pitch.md](pitch.md), live `/try/sign`
  first (sign, then tamper one cent), then the three proofs (the hash the CFO signed in Airwallex's own record of the
  EUR 240.00 SWIFT payment, #24 refused on Metal, Claude 24 of 24), then the business and the ask; each part's words
  checked against about 2.3 words a second. [demo-day.md](demo-day.md) gets a script with a fallback per step (network
  down, Face ID failing, the FX quote expiring); [qa.md](qa.md) the 15 hardest questions, each answered in three
  sentences or fewer with its evidence; [cheat-sheet.pdf](cheat-sheet.pdf) one A4 page. The earlier pitch versions and
  the replay runbook stay. 2568 tests in 261 files, all passing.
- 6 November, /try/sign's expired quote: the sheet's rows read "Proposal expires" and "Quote expires"; while the quote
  is expired, "Create your test passkey" and "Sign with Face ID" are off until a new quote is fetched. The deploy
  guard also covers ANTHROPIC_API_KEY, and checks that METAL_RPC_URL never becomes a Worker secret or var. 2569 tests
  in 261 files, all passing (with main's).
- 6 November, /try/sign's Treasury agent speaks through Claude Haiku: the waiting payment's sentence is one real Haiku
  call, given only the test world's invoice, balance, floor and limit (never a visitor's words), labelled "Claude
  Haiku · live" with its request id behind "more"; USD 1 a day, 10 a minute for everyone, 6 an hour per address, 8 s;
  otherwise the fixed sentence, labelled with why. The model only proposes: limits and approval stay in code and the
  passkey. 2534 tests in 257 files, all passing.
- 6 November, /try/verify: "Don't trust our server: check it yourself." receipt.json is checked in the browser with
  WebCrypto, with verify-receipt's own checks (tested equal), and no server call (the page's CSP allows no
  connection). "Signature valid for these terms", or "Invalid" with the failing check named; a "Change one field"
  toggle and file upload. After signing, "Verify this receipt here" opens it. 2537 tests in 258 files, all passing.
- 6 November, /try/sign shorter and wider: from 1024 px the start screen shows "One policy → three locks" on the
  right; after signing at most about 150 words (118 on a phone); a refused signature answers HTTP 200 {verified:
  false, reason}, so the visit logs 0 console errors; the quick tamper on one line, "Try another field" after the
  first refusal, then three buttons: the real run's P-0005 on /proof, the film, the code. 2538 tests in 258 files, all
  passing.
- 6 November, the Haiku sentence after review: the amounts go in written the page's way ("EUR 1,850.00"), and code
  checks every amount that comes back against the four it was given, exactly as given; else the fixed sentence,
  labelled "fixed text (sentence did not match the terms)". The sentence goes on the page as text, never markup.
  2589 tests in 262 files, all passing (with main's); 2592 in 263 with /try/verify.
- 6 November, /try/sign from 1024 px: the left column under the start button shows the three steps once more, one
  line each with a short gloss ("A payment above its limit, with its exact terms." / "A test passkey signs the hash of
  those terms." / "The server checks it; one cent changed and it fails."), beside "One policy → three locks". 2594
  tests in 263 files, all passing (with main's).
- 6 November, the first screen (section D): the README, Home and the form's synopsis open the same way, from one
  source (`FIRST_SCREEN` in `src/config/brand.ts`): what Purser is in one sentence, the three sentences, then "Try it
  in 30 seconds." on its own line to /try/sign; only then the badges and the details. "Why this is a company": five
  lines from docs/business/ (the problem, who buys, the intended pricing as a hypothesis, why now with Airwallex's own
  post as the source, why Purser) on the README and Home, under one note that it is not validated with customers yet.
  2602 tests in 264 files, all passing (with main's).
- 6 November, the proof and the form (section D): one sentence per partner (`PROOF_SENTENCES` in
  `src/config/brand.ts`), word for word on the README, Home and the form, every number read from its record by
  `test/proof-sentences.test.ts`. Airwallex: the hash the CFO signed is in Airwallex's own record of the EUR 240.00
  SWIFT payment; 3 of 3 cards carry the CFO's policy as Airwallex's own controls. Metal: a mandate on chain per agent;
  86 payments, each its own transaction; #24 refused on chain; the mandates replaced after the CFO's Face ID (four
  eyes; second approver a labelled test passkey). Claude: 24 of 24 decisions, 0 fallbacks; rel-1 found a fault in how
  the agents hand off a card raise; after the fix the eval rebuilt from that moment went from 6/10 to 10/10 and rel-1b
  passed every step. The form's Description now goes problem, solution, proof, Airwallex and Metal, business, what's
  real (3,967 characters); the Instructions go /try/sign, then /proof and the film, then the repository. 2607 tests in
  265 files, all passing (with main's).
- 6 November, /proof's "Policy and card side by side" lands on /airwallex with the cards' fold open: the fold is
  `#controls` and each card has its own anchor (`#card-sourcing`, …); a few lines of script, hashed into the page's
  CSP, open the fold around whatever the link points at and scroll to it (Chromium and WebKit checked at 390 and
  1440 px).
- 6 November, an emergency switch for /try/sign's Haiku sentence: the Worker var `TRY_SIGN_HAIKU` set to `off` (any
  case, trimmed) stops the call, with no request to Anthropic and no budget spent; the page shows the fixed sentence,
  labelled "fixed text (live model switched off)", and "What's real?" says the switch exists. Missing or any other
  value, the call runs as before. Max sets it by hand; no script or config sets it.
- 6 November, /try/sign's layout after Max's review: on a laptop the steps are said once (the step bar); the left
  column is the start button, the hook and one line, level with "One policy → three locks". On a phone the terms'
  labels stay on one line ("Proposal expires" and "Quote expires" kept apart), the last row of the terms clears the
  sticky buttons, and "You are approving" lands below the sticky step bar. 2618 tests in 266 files, all passing (with main's).
- 6 November, the deck (section D): twelve slides in the story's order, the problem, the three sentences with "Try it
  in 30 seconds.", the demo (/try/sign), the main run, the Airwallex proof (the hash the CFO signed beside the one in
  Airwallex's record of the SWIFT payment; each card's controls), the Metal proof, the agents, security and tests (the
  suite's size from the README, 412 audit rows, the red team and the Scenario Lab on stand-ins, CI), what is real, the
  business, the roadmap. `npm run submission -- --deck-only` renders the deck alone and each slide as a PNG in
  docs/evidence/deck/. 2619 tests in 266 files, all passing (with main's).
- 6 November, the form's 8 screenshots (section D, D6): from the live site (main 60569ef, Worker 3e8cd078), 1280 px at
  2×, light, in the form's order: Home's first screen; /try/sign's approval sheet with the live Claude Haiku sentence,
  signed and verified, the tamper refused (all three from one test world: one FX quote, one Haiku call); /airwallex,
  the signed hash and the cards; /metal; /claude; Home's "Why this is a company". In `docs/submission/screens/form/`.
- 6 November, the README's "How it works in 5 files" for a developer judge: one hand-written diagram
  (docs/how-it-works.svg, light and dark) of the path as the code runs it, the five places that enforce the limits
  and the approval, each linked to the line that defines it (a test fails if a link stops pointing at its symbol), and
  "Verify it yourself in 3 commands" (`npm ci`, `npm test`, `npm run judge -- --check`, plus
  `npm run verify-receipt -- receipt.json`), each with what it proves. 2632 tests in 267 files, all passing (with main's).
- 6 November, /proof puts the strongest proof first (Max's last round, item 2): each partner card opens with its
  claims, each one a link. Airwallex: "The hash the CFO signed is in Airwallex's own record of the SWIFT payment" and
  "3 of 3 cards carry the CFO's policy", to their anchors on /airwallex; Metal: "#24 refused on chain" and "86
  payments, each its own tx", to Metal's testnet explorer; Claude: "24/24, 0 fallbacks" and "a reliability run found a
  hand-off fault; fixed: 6/10 → 10/10", with a note that 6/10 → 10/10 is the eval rebuilt from rel-1's moment, before
  and after the fix, and that rel-1b then passed every step. Every number is read from its record. The TAP remark under
  the figures is gone: TAP is on /visa and in the footer link. 2647 tests in 268 files, all passing (with main's).
- 6 November, the CFO's view, visible (Max's last round, item 4): "See the CFO's view" on Home and in Proof's head, to
  the CFO dashboard's replay of the main run (/?autonomy: public, read-only, no viewer key). It opens at its top with
  one line: "This is what the CFO opens: what the agents did, what waits for a signature, and each limit the CFO set." Before the
  link, the page was audited for anything private (keys, tokens, viewer keys, RPC URLs, emails, personal data), in its
  HTML, its inline data and its requests; test/cfo-view.test.ts keeps that audit. 2657 tests in 269 files, all passing (with main's).
- 6 November, /try/sign step 0, "Set the policy" (Max's item 1): "One policy → three locks", interactive. In the
  visitor's test world, each agent's CFO policy (limit per purchase and per month, merchant categories, currencies,
  end date, "may pay alone up to", and the company's reserve floor) and, beside it, three panels computed on the server
  by Purser's own code: Purser's rule (its settings and the world's payment check), the Airwallex card controls as
  IssuingRest sends them ("what Purser would send; not sent"), and the Metal mandate's terms as the owner signer passes
  them to metal-agent ("not sent"). A stricter policy holds at once; a looser one (decided field by field) is refused
  until the visitor signs its exact terms with the world's passkey, verified as a payment's signature. The new policy
  holds for the rest of the visit: a lower floor, signed, lets the blocked T-0001 be signed and run; a higher one
  blocks T-0002. Max's three choices: step 0 is behind a button, "Optional: set the policy first"; the Metal panel says
  its amounts are *USDZ (test USD), the policy's numbers unconverted; and "may pay alone up to" works: raised and
  signed, a payment at or below it runs without a signature by the same stand-in, its card saying "paid alone under
  your new policy" (above it, or once it is lowered again, a payment not yet run waits for a signature). No call to
  Airwallex, Metal or Claude. 2732 tests in 271 files, all passing (with main's).
- 6 November, trace any payment (Max's last round, 1.2): /trace. Pick any of the 88 payments of the main run (88 = 86
  on Metal + 1 card charge + 1 SWIFT transfer; 87 of them inside the limits, the SWIFT transfer through a proposal) and
  see its chain: the policy, the decision (agent, model, request id), the lock that held it or the proposal, the
  signature, the executor's hash check, the rail id, the booking line and the audit row; a step a payment does not have
  says so and why. What the main run's record keeps only per group comes from a companion record,
  docs/demo/main-run-trace.json, derived from the main run's ledger (3 Nov) with the same scrub as the record's ledger
  rows; per audit row it publishes only seq, prev_hash and row_hash, so the chain's linkage and head are checkable and
  each row's content is not. The main run's record is unchanged. Linked from the CFO's view and from /proof. 2754 tests in 272 files, all passing.
- 6 November, the month-end pack (Max's last round, 1.3): "Download the month-end pack" on the CFO's view and /proof,
  one zip for the main run, built with the pages from the record and its companion, byte for byte the same on every
  build (`npm run month-end-pack` writes it too). Inside: the GL export with each line's rail id and approval hash, the
  postings, the payments (88 = 86 on Metal + 1 card charge + 1 SWIFT transfer, the 88 flows reconcile checked), the
  approvals, the audit chain's published links with their check, and a README on how to check it. "From the main run
  of 3 November, test money."; T:0: "Posting to T:0 is built; nothing posted (keys refused: 403 CAPI71 on 3 Nov, 401
  CAPI11 on 5 Nov)." A stored zip, written with Node's own CRC-32: no new dependency. 2773 tests in 273 files, all passing.
- 6 November, "Unit economics (hypothesis)" (Max's last round, item 5.2; assumptions approved by Max): in
  docs/business/model.md, what a company of 5 agents costs a month against the intended price, from the main run's
  Claude cost per decision and a list of labelled assumptions (usage, Cloudflare hosting at its published prices, the
  ECB's EUR/USD rate), with the gross margin at low, mid and high usage (77%, 48%, 52%). The price now includes
  decisions, word for word everywhere: "€49 per company a month, including 5 agents and 1,500 Claude decisions; €10
  per extra agent; €3 per extra 100 decisions." One line says what Opus for every agent would cost (about 2.1×, the
  run repriced), one what Claude decided (24 decisions; of the 88 payments (88 = 86 on Metal + 1 card charge + 1 SWIFT transfer), 82 were routine code). The deck's business
  slide shows the same numbers ("Why this is a company" merged into it, so the deck stays at twelve).
  src/business/unitEconomics.ts computes them; a test checks that none is unsourced. 2792 tests in 274 files,
  all passing (with main's).
- 6 November, the test suite makes 0 external calls: building the seller or a supplier no longer asks Metal's
  facilitator for its /supported list (test/support/facilitatorStandIn.ts, in test/clearing.test.ts and
  test/world-thursday.test.ts), and a vitest setup file removes every live key from the tests' environment and refuses
  any request to a host that is not this machine, also in the child processes a test starts
  (test/support/noNetwork.ts, test/support/no-network.cjs). Checked with a logging preload over the full suite: 0
  attempts. 2736 tests in 272 files, all passing.
- 6 November, awx-1 prepared, not run (Max's last round, item 2.1): the Airwallex-only run's plan and runbook
  (docs/runs/awx-1-plan.md): every Airwallex call by step and endpoint (85 expected, 96 at most), the Claude estimate from
  the main run's own costs, the abort criteria. `npm run awx-1` runs the scenario on the stand-ins with 0 network and
  checks a–g, verify and reconcile; live it waits for Max's Face ID and a call guard keeps to the approved count.
  Max approved 96 Airwallex calls at most (117 with one second attempt), 14 Claude calls, 0 Metal. A stand-in test's
  accidental Claude calls while preparing it are booked as an upper bound (at most 24 calls, 0.18 USD).
  2802 tests in 277 files, all passing (with main's and the network guard).
- 6 November, the worst case (1.1) and the unit economics (5.2) merged with the network guard and awx-1's preparation:
  2844 tests in 279 files, all passing.
- 6 November, the worst case, set by policy (1.1): per agent and in all, per day and per month, computed from the
  policy by Purser's own code: each card's monthly limit (EUR), each Metal mandate's budget (test USD) and the
  Treasury agent's task cards without Face ID, on a line of their own (Max: "apart"). EUR and test USD apart, an EUR
  total only at the main run's recorded rate (3 Nov). Clear at a glance (Max): the figure, two lines, and the rest behind
  one closed fold, "How this is computed". At the top of the CFO's view, in step 0 of /try/sign (changing with the visitor's card limits) and in
  the README; `worstCaseLine()` holds the form's sentence for its rewrite. No call to Airwallex, Metal or Claude.
  2796 tests in 274 files, all passing (with main's).
- 7 November, "Judge it in 3 minutes" (Max's last round, item 5.1): /judge, five steps for a juror with little time,
  each with a checkbox, a time (60 + 30 + 30 + 30 + 30 s) and one line of what they will see, each a link to a page
  that already exists: sign one and tamper one cent (/try/sign); set a looser policy and see the worst case change
  (step 0 of /try/sign); trace any payment from policy to bank (/trace); see Airwallex and Metal enforce it
  themselves (/airwallex, /metal, the refusal on Metal's testnet explorer); check the receipt with no server
  (/try/verify). Then "Want the code? How it works in 5 files" and the film. The ticks stay in the browser
  (localStorage, in try/catch); the page has no fetch and its CSP allows no connection. Linked once at the top of Home,
  the README and the form's instructions. test/judge-tour.test.ts fails while a step links to a route the site does
  not serve. 2671 tests in 270 files, all passing (with main's).
- 7 November, /judge merged with the worst case, the unit economics, /trace, the month-end pack and awx-1's
  preparation: every step's route now served. 2858 tests in 280 files, all passing.
- 7 November, /try/sign as one story of five screens (Max's plan "De demo opnieuw"): (1) "Your Treasury agent wants to
  pay an invoice above its limit." with one button, "Sign with Face ID", which makes the test passkey on the way; (2)
  "Signed and verified."; (3) "Try to cheat.": one cent, another IBAN or another currency, refused by the server; (4)
  "Change the rule.": how much the agent may pay alone, a looser rule signed, a stricter one applied at once; (5) "The
  agent pays it alone.": its next invoice (T-0003, fixed text, no quote, no model call), which arrives once
  T-0002 is signed, runs without a signature under the new rule. Every field of the policy (#71) behind "Show all
  fields". The test world opens when the page is shown (Max's choice), one quote and one model call per world as before.
  The server's checks are unchanged; the next invoice is checked by the same rules. On every screen at most 60 words in
  sight and one main button, on the screen without scrolling (test/browser/trysign.check.ts measures it at 360, 390 and
  1440 px, light and dark); the whole story runs in WebKit too, with a test-only software passkey whose signatures the
  server verifies. /judge's steps 1 and 2, the README, the form and the pitch follow the new order.
  2864 tests in 281 files, all passing.
- 7 November, the worst case counts what an agent may pay alone (Max): in the /try/sign test world the Treasury agent's
  "may pay alone up to" is counted, at most 3 payments alone in 24 hours (Purser's existing per-day rule for what an
  agent does without a person, now enforced where payments run alone), 31 days a month; choosing EUR 2,000 on screen 4
  raises the figure before you sign, and the server sends the figure for each amount. Purser's own policy has no
  payments alone, so the README's and the CFO's figure stay as they were. The phone strip "One policy, three locks" is
  gone; the lock lines are shorter. 2868 tests in 281 files, all passing.
- 7 November, /try/sign as the demo's strongest minute (Max's plan "De demo geweldig maken", part 1): an opening line
  ("You're the CFO. Your AI agents pay suppliers on their own. One of them wants €1,850.") and one button; a new step,
  "Try to trick the agent": two fixed fake invoices ("Pre-approved by the CFO", a lookalike supplier) run through
  Purser's own injection screen and invoice-fraud check (src/policy/fraudCore.ts, the pure part of fraud.ts, now shared
  by the runner and the Worker), each blocked before anything is proposed, "A prompt is not a control."; a split invoice
  is left out, as no rule in the code detects one. The worst case in a CFO's words ("the agent may pay up to €X alone, at
  most 3 times a day") with what a looser rule adds a month ("+€139,500"), and why the main run's is EUR 300 behind
  "more". A closing card: what you did in about a minute, then "See the real run", "Trace a real payment", "Read the
  code". 2875 tests in 282 files, all passing.
- 7 November, the real agent in "Try to trick the agent" (Max's section 6, part 1): the agent that reads invoices, live
  (Claude Sonnet, the runner's own reader: the same system prompt, instruction and schema, now in
  src/claude/invoiceReading.ts and shared by runner and Worker), reads each fixed fake invoice; code checks its reading
  against the document's own lines, as the runner does; then Purser's code blocks it whatever the agent read. The page
  shows what the agent read ("Claude Sonnet · live"), "Purser's code checks it either way.", the verdict, and "What the
  agent did" (the call, its model, time and request id). Without the live agent (no key, switched off, over budget,
  past 8 s) code reads the invoice, labelled so. One budget for every live call on the page, USD 10 a day (was USD 1
  for the sentence alone), per-address and overall limits, the emergency switch TRY_SIGN_HAIKU for all of them, and
  today's spend on /health. 2881 tests in 282 files, all passing.
- 7 November, awx-1 recorded and on the site: the Airwallex-only run (a separate world, Airwallex sandbox, test money,
  0 Metal calls) ran live that day and was accepted, checks a–g all passed. Its log, docs/runs/2026-11-07-awx-1.md, has
  every id, decline code, webhook and attempt and the Claude calls with their request ids; its record is
  docs/demo/airwallex-run.json. /airwallex shows it dated and labelled "Airwallex sandbox, test money" (7 of 7 checks,
  every step and id in a fold; the page's word budget 190 → 210 for it), Proof's "Airwallex, read back" a short version
  linking there (no decline code on /proof); every figure and id from the record (src/redesign/awxRun.ts,
  test/awx-run-page.test.ts). README, docs/claims.md and docs/airwallex.md carry it; its 0.0839 USD of Claude is booked
  in docs/runs/api-budget.jsonl. 2887 tests in 283 files, all passing.
- 7 November, every jury-facing text in the demo's order (Max): Home → Watch → Try (/try/sign) → Proof, and /try/sign's
  story as it now runs: the agent asks (Claude Sonnet reads the invoice, Purser's code checks the reading and the terms
  come from it, Claude Opus advises live as the Treasury agent), signed with Face ID, try to cheat, try to trick the
  agent (Claude Sonnet reads a fake invoice live; Purser's code blocks it), change the rule and see the worst case, the
  agent pays alone, the closing card. /judge's five steps follow it (watch the agents 30 s; sign, then try to cheat
  40 s; try to trick the agent 30 s; change the rule, see the worst case 30 s; see the proof 50 s, with awx-1 on
  /airwallex), with /trace and the receipt check under "More time?"; test/judge-tour.test.ts checks each line against
  its page. The README's top tells the same order and the seven steps, and its evidence carries awx-1 again (its
  section, its line among the proof sentences and under "Other live tests", which a merge had dropped on main; the
  same for its rows in docs/claims.md). The form's Description (3,998 characters, under the 4,000 the test allows)
  adds the demo's order and one line on awx-1; the Instructions go /judge, then Home, Watch, Try and Proof; the long
  text lists awx-1 under "Other live tests". The Demo Day pitch opens on Home and /watch, then the live demo with the
  trick, the worst case and the closing card, then the proof with awx-1 (341 words, about 2:28 of speech); the runbook
  has a fallback for each of its 14 steps. The Q&A adds five questions (18–22) on the live agents and on awx-1.
  2941 tests in 287 files, all passing.
- 7 November, the Treasury agent works live on /try/sign's first screen, Purser-style (spec 6b): the test world holds
  EUR 26,000.00 (floor EUR 25,000.00) and USD 8,000.00 (floor USD 3,000.00). The agents' work comes in step by step,
  one request each (POST /agents): Claude Sonnet, the runner's invoice reader, reads Alpine Packaging's invoice (a
  document code writes); Purser's code checks the reading against the invoice's own lines, the payee against the
  allowlist and the amount against the limit; code plans the payment with Purser's planInvoice (EUR 1,870.00 needed,
  EUR 1,000.00 free) and the Airwallex sandbox quotes the EUR 870.00 short; Claude Opus, the runner's Treasury timing
  agent (the same prompt, tools, effort and turns, now in src/agents/timingCore.ts), advises paying now or waiting, its
  reason checked by code against code's numbers. The terms (kit11.try-terms/v4) come from the checked reading and carry
  the agent's advice; T-0001 stays blocked by the floors; the next invoice gets a second live quote of its own. Never
  silent: without a live answer the page shows a recorded real one (docs/demo/try-agents-recorded.json, written by
  `npm run record-try-agents`; not recorded yet) or code's reading and a fixed sentence, each labelled with the reason.
  The emergency switch is now TRY_SIGN_AGENTS (TRY_SIGN_HAIKU still works). 2906 tests in 283 files, all passing.
- 7 November, a fix found by live Claude Opus while recording: without a recorded rate the plan before the quote
  could not price the conversion, the quote step read that as "no FX needed", and the agent was told EUR free after the
  payment -870.00, which the shared licence numbers read as +870.00 ("free EUR 2,740.00, shortfall 0.00"). Opus refused
  to advise paying and said why. Now the plan names the shortfall with or without a rate, code checks the agent's facts
  against the plan before asking, and the licence numbers refuse a negative amount (the runner falls back, labelled).
  2911 tests in 283 files, all passing.
- 7 November, the Treasury agent's own tool holds its reason to the page's rule: live Opus advised well but in three
  sentences (321 to 326 characters), which the page refused every time. submit_advice now refuses a reason that is not
  one or two plain sentences of at most 400 characters ("Not recorded: …"), in the runner and on /try/sign alike (one
  rule, src/agents/timingCore.ts plainReason), and the agent writes again within its turns. The quote's end as a time
  of day, and code's own phrases ("EUR free 0.00"), count as code's numbers. 2915 tests in 283 files, all passing.
- 7 November, the Airi rail after its first live run (vic-1b): our Airwallex sandbox refuses a PaymentIntent confirm
  with raw card fields over the API ("This account is not enabled for native API access"), so the agent now pays on
  Airwallex's own Hosted Payment Page, typing the card from Airi's single-use credential into it like a shopper in
  headless Chromium; one read of the PaymentIntent then gives the real outcome, and 3DS that does not finish by itself
  is a decline, THREE_DS_REQUIRED (src/airi/hostedCheckout.ts; AIRI_CHECKOUT=api keeps the old confirm). A probe with
  Airwallex's test card paid on the sandbox's hosted page headless (SUCCEEDED). The vic-1 conductor now prints the
  one-time Airi link for a purchase above the limit as a labelled "AIRI TAP B" line the moment the runner writes it,
  with a notice in the run log, and waits until that purchase has an outcome or its 5-minute tap window has run out.
  The checkout's order ref (Airwallex's request_id, unique per account) is now the purchase's id plus its start, not
  the bare proposal id: every world numbers from P-0001, and vic-1c's first B was refused as duplicate_request before
  any card was used. CI's test job now has Chromium for the hosted-page test. 2994 tests in 290 files, all passing.
- 7 November, /try/sign in motion (Max: the demo as the hackathon's most impressive moment): the same colours, type and
  layout; the cards with a subtle shadow and a light gradient, no glass. "Signed and verified": the tick draws itself in,
  with a soft green glow. A refused cheat: the card shakes once, the changed field lights red, and both hashes stand side
  by side in the table, every character that differs marked. "Trick the agent": the fake invoice slides in, its IBAN
  beside the one on file with the difference in red, then the block. "Change the rule": the worst case and what it adds
  count up to the new figures (the final words are in the page at once; the counting is drawn over them) and the three
  locks light up one by one. "Pays alone": the payment moves through Purser, Airwallex and Metal, and ends green. On a
  laptop the diagram lights each step's part as it opens. Each animation runs 150 to 400 ms and nothing waits for one;
  with prefers-reduced-motion the end state shows at once (a browser check walks that path). 2980 tests in 289 files,
  all passing.
- 7 November, /try/sign after Max's review: each lock shows its channel (Purser: invoices and proposals; the Airwallex
  card: card spend; the Metal mandate: on-chain payments), on screen 5's lines, in the diagram, on the blocked payment's
  locks and on the full policy's panels. The worst case is the argument for the signature: a looser rule shows the
  figure with what it adds, and right under it "That risk needs your Face ID." "Try to trick the agent" is calmer: a
  plain card, red only for what differs and for the block, the invoice's IBAN beside the one on file. The band at the
  top is thin: 22 px in one line from 390 px (it was 63 px in two at 390 px, 44 px on a laptop). A fix: with no advice
  from the agent, screen 1 no longer shows a stray "null". 2985 tests in 290 files, all passing.
- 7 November, a hash chain per /try/sign test world (6c): every event in a world (opened, each agent's step, each
  proposal, signature, refusal and execution, each policy change) appends a row {seq, at, kind, data_sha256, prev,
  hash}, its hash the SHA-256 of the row's canonical JSON without the hash, so each row covers the one before
  (worker/src/worldChain.ts; written in the same synchronous stretch as the event, so with a plain-code SHA-256 checked
  against Node's). The last screen shows the chain's length and head, and "Verify the chain" recomputes every row in
  the browser. The receipt carries the chain as it was when signed; `npm run verify-receipt` and /try/verify check it
  and find the row that records this signature (its data is the proposal and the hash signed). Tests: a tampered row is
  found (its data, time, kind, order, a dropped row, a rewritten hash), the chain survives a reload of the store, and it
  is per world. The server keeps the chain: it shows the order and that no row changed after the next was written, not
  that the server could not rewrite all of it. 2992 tests in 291 files, all passing.
- 7 November, the approval view and a new run's key (Max, on his iPhone in the live runs): the approval page puts
  what he decides on in the first screen at 390 × 844: the amount, the payee, the agent, why it needs him in one line,
  "Approve with Face ID" and Reject; the exact terms, the hash, the options it is not and the review sit behind one
  fold, "Details". The checks stay: the page hashes the terms itself and shows only what the runner signed; the buttons
  arm after 0.8 s (3 s against Opus's advice, Reject first), and choosing an option signs nothing. A new run's viewer
  link no longer locks the phone out: the page shows the old and new runner key's fingerprints (the runner prints its
  own beside the viewer link) and one button, "This is a new run: use the new key"; only that press replaces the pin,
  only for a key a link brought and that signed what the relay sends; a key no link offered is still refused
  (test/approve-runner-key.test.ts, the browser check). Live after the relay is redeployed. 2950 tests in 288 files,
  all passing.
- 7 November, the Airi run recorded and on the site: vic-1 passed live that day in world vic-1c, its second attempt
  there (13:56–14:10 UTC; Airwallex sandbox, Airi's test card, test money; 0 Metal and 0 Claude calls), all five
  checks. The Sourcing agent paid with a single-use card credential from Airwallex's Airi wallet on Airwallex's hosted
  checkout page for our own sandbox merchant: EUR 12.00 within the CFO's limit alone (Max tapped once in Airi with his
  passkey; PaymentIntent int_sgpvzc9hjhnxvpblt2r SUCCEEDED); EUR 45.00 above it only after the CFO's Face ID on P-0002,
  then Max's tap in Airi (mandate mdt_nlpdgv8gqhnxvxcjxbv, PaymentIntent int_sgpvzc9hjhnxvxc26ie SUCCEEDED, P-0002
  EXECUTED); a merchant the CFO does not allow refused by Purser, PURSER_MERCHANT_NOT_ALLOWED, 0 Airi calls. Its log,
  docs/runs/2026-11-07-vic-1.md, has every id, step, timing and call, and the three attempts before it as they
  happened (vic-1, vic-1b, vic-1c's first; nothing charged in any). Its sanitised record is docs/demo/airi-run.json.
  /airwallex shows it below awx-1, dated and labelled "Airwallex sandbox, test card, test money" (5 of 5 checks, every
  step and id in a fold; the page's word budget 210 → 235 for it); Proof's "Airwallex, read back" a short version
  linking there (src/redesign/airiRun.ts, test/airi-run-page.test.ts). README, docs/claims.md, docs/airwallex.md (with
  the PaymentIntent endpoints the rail calls), the long text and qa.md (18, 19) carry it; the form's Description does
  not (no room). 3001 tests in 291 files, all passing.

## Real, and ours

Real: the Airwallex sandbox, Metal testnet, Claude, and Face ID; all money is test money. Ours or simulated: the
suppliers, the customer, the merchant, and the second approver (a labelled test passkey, pressed by our build tool,
Claude Code, on Max's go; in production a second person). Sources for every claim:
[docs/claims.md](../claims.md).
- 7 November, the Treasury agent's own tool also holds its reason to the page's amount rule: after the deploy of #87,
  live Opus once named a number the page did not accept, and the page fell back to the fixed text. submit_advice on
  /try/sign now refuses such a reason first ("Not recorded: "…" is not one of code's numbers", with code's numbers as
  it may write them), and the agent writes again within its turns; the page's own check stays behind it
  (worker/src/agentLine.ts strayRefusal, test/try-agent-line.test.ts).
- 7 November, one release of the day's branches together (release-7nov): the Airi hosted-page checkout and its order
  ref fix (#89), the Treasury advice retry, /try/sign's animations, review points and hash chain (#90), the jury texts in
  the demo's order (#91), the phone approval page on one screen with an explicit switch to a new run's key (#92), and
  the Airi run on /airwallex, /proof and in the docs (vic-1-record). 3028 tests in 295 files, all passing.
- 7 November, after the release deploy: live Opus's advice was refused for naming a currency apart from its amount ("a
  USD floor of 3000.00", "free euros"), so it often took two extra turns and sometimes ran past the deadline. Now a
  currency next to a number must be one of code's amounts as written (another currency's "USD 1,850.00" still fails),
  and a currency named on its own is no amount; every digit and number word must still be code's. 3028 tests in 295
  files, all passing.
- 7 November, a fresh juror's review (jury-fixes): Home has the three sentences back under the subtitle (its word
  budget 130 → 190); one time per step everywhere ("about 40 s" for Watch's highlights, measured at 42 s by the
  stage's own timings; "about a minute" and "Try it in a minute." for /try/sign; /judge 40 + 40 + 30 + 30 + 40 s);
  "AI agents are starting to spend company money" on the site, the README, the form, the deck source and the pitch (the
  film keeps its own line). /metal, Proof and /judge say what Metal's explorer shows for the refusal of #24 (the
  MandateRefused log, undecoded there; topic 1 the Sourcing mandate, 0.04 in its data; /metal's budget 150 → 175);
  the Defense-in-depth label is no longer shown beside the chain test that says the same. No page says code
  "decided" any more: a payment by code reads "Applied by code under the default buy policy" (Watch, /trace), the fake invoice's
  "Checked by Purser's code". Proof: the Airwallex card first, its first chip "Signed hash in Airwallex's SWIFT record
  ✓"; the cost tile says "(agent calls)"; the planted line in plain words; the business case link fixed (a folder:
  tree, not blob). /airwallex: the TAP decline's GET status said as Airwallex's decline; awx-1's amounts grouped
  ("EUR 1,500.00"), its calls "71 Airwallex API calls (run budget: 96)". /claude: the 24 decisions include holding
  and doing nothing. Watch: "3 × 0.05 test USD (0.15)" for the refunds. /try/sign: the payment stopped on screen 1
  said as the visitor's own test payment, with a real example linked; the worst case's difference kept on one line;
  the Treasury agent asked for one short sentence a CFO can read on a phone (HH:MM UTC, grouped amounts), on /try/sign
  only, still checked by code. The Worker sends a path pasted with a trailing "." or "," to the same path without it.
  The form: one character count, no punctuation glued to a link, "Max plays the CFO and signs with a personal passkey
  (Face ID on a phone)."; pitch 3e with the current price; qa.md's title and range; README's TAP and T:0 lines
  rewritten; claims checked on 7 November.
