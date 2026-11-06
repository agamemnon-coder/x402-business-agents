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
  16 stops, nothing paid over a limit: Claude skipped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.

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
- 6 November, the jury review: every surface opens with what only Purser has, three sentences word for word
  (`DIFFERENTIATORS`: the signature over the exact terms, one CFO policy as three locks, real agents with no key reaching
  Claude), then "The Kit 11 scenario, run live on 3 November.". The 12 overpriced checks are said as they happened: "a
  buy rule Claude set stopped 12 overpriced checks" (code applied the rule; the film keeps its older line). One set of
  numbers: "86 Metal payments + 1 card charge", "5 decisions signed with Face ID (+1 co-signature)". The let-through is
  framed as a test of the chain, both layers shown. The form's caveats are one line with a link; Visa TAP is a footer
  link on Home and Proof, and the form's screenshot 6 is /try/sign, signed and tampered. 2377 tests in 249 files, all
  passing.
- 6 November, the jury's technical QA: /try fits a 320–375 px phone (the tabs take their own line) and the replay's
  tables stack below 900 px, both checked at 360 and 768 px now; /film is labelled as the earlier animation of
  30 October, and Home and Proof link the film (2:42); every public page carries the same link-preview tags with an
  absolute image, and the favicon where its CSP allows one; one tagline everywhere, "AI agents spend. You sign off.";
  the deck's slide count is right (ten); the claims' site section is the main run's. 2386 tests in 250 files, all
  passing.

## Real, and ours

Real: the Airwallex sandbox, Metal testnet, Claude, and Face ID; all money is test money. Ours or simulated: the
suppliers, the customer, the merchant, and the second approver (a labelled test passkey, pressed by our build tool,
Claude Code, on Max's go; in production a second person). Sources for every claim:
[docs/claims.md](../claims.md).
