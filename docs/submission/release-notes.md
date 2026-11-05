# Purser v1.0-submission

The version submitted to the Airwallex Agentic Banking Hackathon: Starter Kit 11 (x402 Business Agents), entered for
the Metal Award, with a note for the Visa Award. Tag `v1.0-submission`.

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
  Metal refused 1 purchase over its cap; the CFO rejected 1 proposal.

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

## Real, and ours

Real: the Airwallex sandbox, Metal testnet, Claude, and Face ID; all money is test money. Ours or simulated: the
suppliers, the customer, the merchant, and the second approver (a labelled test passkey, pressed by our build tool,
Claude Code, on Max's go; in production a second person). Sources for every claim:
[docs/claims.md](../claims.md).
