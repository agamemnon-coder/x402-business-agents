# Submission pack (HackerEarth form)

Copy each block into the form. Max submits; nothing here is sent by itself. Every run figure comes from the main run
of 3 November (`docs/demo/main-run.json`, log `docs/runs/2026-11-03-main-run.md`) and the reports in this repo
(`src/submission/facts.ts`); `test/submission.test.ts` checks this page against them. The Description tells only the main
run; the long text ([long-description.md](long-description.md)) has every other live run under "Other live tests
(separate worlds, dated)", with its date, and what ran only on stand-ins under "Tested on stand-ins (not live)". Sources
for each claim: [docs/claims.md](../claims.md), section "The submission pack".

The video link is in. Max's steps: [checklist-max.md](checklist-max.md).

## Title

Purser · AI agents spend. You sign off.

## Synopsis

<!-- synopsis -->
An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. Try it in 30 seconds. One CFO policy becomes three locks: Purser's code, Airwallex's card controls, Metal's mandate on chain. A prompt is not a control. Real agents, not scripts: Claude made all 24 decisions, and no key reaches Claude. The Kit 11 scenario, run live on 3 November.
<!-- /synopsis -->

## Description

Characters: **3,967** (the text between the markers, as pasted). Max's target is 3,000–4,000; the form's own limit is
not known yet. `test/submission.test.ts` checks this count and keeps the text under 4,000. The long text, as it stood on
5 November, with Airwallex, Metal, Claude, the controls and the other live tests in full: [long-description.md](long-description.md).

<!-- description -->
An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. Try it in 30 seconds. https://kit11.max-31b.workers.dev/try/sign

One CFO policy becomes three locks: Purser's code, Airwallex's card controls, Metal's mandate on chain. A prompt is not a control.

Real agents, not scripts: Claude made all 24 decisions, and no key reaches Claude.

**The Kit 11 scenario, run live on 3 November.** Starter Kit 11 (x402 Business Agents), entered for the Metal Award. **A supplier doubles its price. A customer disputes 12 orders. A €240 bill is due in euros.** Purser is for the CFO of a small company whose AI agents should spend company money only within limits the CFO sets.

Test money. Simulated: customer, supplier, settlement, second approver. Details → https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/submission/long-description.md#what-is-real-and-what-is-simulated

Purser gives each AI agent its own Airwallex card and its own Metal on-chain mandate. Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; the CFO approves anything beyond them, with Face ID on the exact terms. The example company, Northwind Outdoor, is an outdoor wholesaler that sells live stock data to retailers per query, with three Claude agents: Sourcing, Support and Treasury.

**Proof: the main run (3 November, world `main-1`).** One live run with real Claude decisions and Max's passkey (Face ID on his phone); Max plays the CFO. 24 of 24 decisions by Claude, 0 fallbacks; 5 decisions signed with Face ID (+1 co-signature).

1. **The price rise.** Stockline, the supplier, went from 0.02 to 0.04 a check, over the Sourcing mandate's 0.03 cap. We switched off our own check once to prove the chain holds the line: Purser refuses an over-cap purchase before signing; with that check off for one purchase, Metal refused it anyway. That was purchase #24; the refusal is recorded on chain (`mandate_cap_exceeded`, tx `0x2e92f9cb…1871`). Treasury proposed two options 40 s after the refusal; the CFO signed A (P-0002) with Face ID; after four eyes both mandates were replaced on chain.
2. **The dispute.** A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects it with Face ID. Refunds #7, #10 and #13, each on chain; the rejection is P-0004.
3. **The euro bill.** The Treasury agent planned the EUR 240.00 licence itself (P-0005). After the CFO's Face ID, EUR 110.00 bought by FX for USD 124.29 (conversion `3ca88196-05da-4d88-9caa-796f03704636`), then SWIFT: transfer `03360bfa-afce-457b-89d1-e1097fbe3985`, PAID 6 s after Face ID (settlement simulated in the sandbox).

86 Metal payments + 1 card charge, all inside the limits. 16 stops, nothing paid over a limit: a buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.

**Who does what.** Max Geurtsen built Purser (limits, approvals, agent tools, site, audit log, books, tests). Airwallex: cards and limits, FX, SWIFT. Metal: mandates, payments. Claude: the agents' decisions.

**What is real.** The Airwallex sandbox, Metal testnet, Claude and Max's Face ID. Metal tx: on chain, checkable. Airwallex ids: published on /proof.

**Links.**
- The site: https://kit11.max-31b.workers.dev/
- Sign one yourself: https://kit11.max-31b.workers.dev/try/sign
- The run, replayed: https://kit11.max-31b.workers.dev/watch
- Every id: https://kit11.max-31b.workers.dev/proof
- The repo: https://github.com/agamemnon-coder/x402-business-agents; offline, no keys: `npm ci && npm run judge`
- More: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/submission/long-description.md
<!-- /description -->

## Instructions

```sh
npm ci && npm run judge
```

Needs Node.js 22.13 or later. No keys and no network after `npm ci`. It serves Home, Watch and Proof replaying the main
run, the CFO dashboard as it stood at the end, `/metal`, `/airwallex`, `/visa`, `/claude`, `/try` (offline it reads
requests with code only; the hosted page asks Claude), the Scenario Lab and a simulated month, and opens the browser.
Running it live (sandbox keys, a Metal RPC) is in [docs/run-it.md](../run-it.md).

## Links

- Video (2:42; voice-over: an AI-generated voice, music: AI-generated, both ElevenLabs): <https://youtu.be/jaqO2M2V6NY>
- Live: <https://kit11.max-31b.workers.dev/>
- Try it yourself: <https://kit11.max-31b.workers.dev/try/sign>: sign a test proposal with your own Face ID, in a test
  world of your own; nothing real moves (live since 4 November 2026).
- Repository: <https://github.com/agamemnon-coder/x402-business-agents> (tag `v1.0-submission`)
- Extra, not an award entry: <https://kit11.max-31b.workers.dev/visa>. Each agent signs its card checkout with Visa's
  Trusted Agent Protocol (TAP); Visa TAP: built and verified against Visa's public reference verifier; not eligible Visa
  tooling for this hackathon (Visa, 5 Nov), so Purser is entered for the Metal Award only.

## Screenshots

`npm run submission` makes them from the pages that replay the main run (3 November), at 1440 × 900:

1. `screens/1-landing.png`: Home, the three moments and the run's numbers
2. `screens/15-watch.png`: Watch, replaying the main run
3. `screens/14-dispute.png`: the dispute on Watch, at the CFO's rejection of "refund the other 9"
4. `screens/16-proof.png`: Proof, every id from the run
5. `screens/3-metal.png`: How Purser uses Metal, with the refusal on chain
6. `screens/18-try-sign.png`: Sign one yourself (/try/sign): the exact terms signed and verified, then the same
   signature refused on the amount + 0.01
7. `screens/2-dashboard.png`: the CFO dashboard at the end of the run
8. `screens/6-books.png`: the books, from the same ledger

## Deck and zip

- `purser-deck.pdf`: ten slides, one message each, made by `npm run submission` from the same figures.
- The zip: `npm run submission` writes `out/submission/purser-source.zip` (`git archive` of the current commit: the
  code, no keys, no ledger). Not committed.

## Proof sentences (Airwallex)

Note for section D: two sentences for the form, not yet placed in it. Each is shown on /proof and /airwallex, computed
from the GET-only records `docs/runs/airwallex-transfer-approval-2026-11-06.json` and
`docs/runs/airwallex-cards-2026-11-06.json` (sources in [docs/claims.md](../claims.md)).

1. Airwallex's own record of the EUR 240.00 SWIFT payment carries, in its metadata, the exact SHA-256 hash of the terms
   the CFO signed with Face ID, so the payment at the bank is provably the one that was approved, to the cent.
2. Each agent's Airwallex card carries the CFO's policy as Airwallex's own controls (limit per purchase and per month,
   merchant category, euros only, end date), read back from Airwallex and matching on all 3 cards, so Airwallex itself
   declines anything outside the policy, whatever the agent does.
