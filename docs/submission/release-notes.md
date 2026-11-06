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
- 6 November, the first screen (section D): the README, Home and the form's synopsis open the same way, from one
  source (`FIRST_SCREEN` in `src/config/brand.ts`): what Purser is in one sentence, the three sentences, then "Try it
  in 30 seconds." on its own line to /try/sign; only then the badges and the details. "Why this is a company": five
  lines from docs/business/ (the problem, who buys, the intended pricing as a hypothesis, why now with Airwallex's own
  post as the source, why Purser) on the README and Home, under one note that it is not validated with customers yet.
  2577 tests in 262 files, all passing.
- 6 November, the proof and the form (section D): one sentence per partner (`PROOF_SENTENCES` in
  `src/config/brand.ts`), word for word on the README, Home and the form, every number read from its record by
  `test/proof-sentences.test.ts`. Airwallex: the hash the CFO signed is in Airwallex's own record of the EUR 240.00
  SWIFT payment; 3 of 3 cards carry the CFO's policy as Airwallex's own controls. Metal: a mandate on chain per agent;
  86 payments, each its own transaction; #24 refused on chain; the mandates replaced after the CFO's Face ID (four
  eyes; second approver a labelled test passkey). Claude: 24 of 24 decisions, 0 fallbacks; rel-1 found a fault in how
  the agents hand off a card raise; after the fix the eval rebuilt from that moment went from 6/10 to 10/10 and rel-1b
  passed every step. The form's Description now goes problem, solution, proof, Airwallex and Metal, business, what's
  real (3,967 characters); the Instructions go /try/sign, then /proof and the film, then the repository. 2581 tests in
  263 files, all passing.

## Real, and ours

Real: the Airwallex sandbox, Metal testnet, Claude, and Face ID; all money is test money. Ours or simulated: the
suppliers, the customer, the merchant, and the second approver (a labelled test passkey, pressed by our build tool,
Claude Code, on Max's go; in production a second person). Sources for every claim:
[docs/claims.md](../claims.md).
