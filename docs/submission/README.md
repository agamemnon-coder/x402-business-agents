# Submission pack (HackerEarth form)

Copy each block into the form. Max submits; nothing here is sent by itself. Every run figure comes from the main run
of 3 November (`docs/demo/main-run.json`, log `docs/runs/2026-11-03-main-run.md`) and the reports in this repo
(`src/submission/facts.ts`); `test/submission.test.ts` checks this page against them. The Description tells the main run,
plus one labelled sentence on the reliability run of 6 November (in Claude's proof sentence); the long text ([long-description.md](long-description.md)) has every other live run under "Other live tests
(separate worlds, dated)", with its date, and what ran only on stand-ins under "Tested on stand-ins (not live)". Sources
for each claim: [docs/claims.md](../claims.md), section "The submission pack".

The video link is in. Max's steps: [checklist-max.md](checklist-max.md).

## Title

Purser · AI agents spend. You sign off.

## Synopsis

<!-- synopsis -->
AI agents can now spend company money; Purser lets them, through Airwallex and Metal, only within limits the CFO signs with Face ID. An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. One CFO policy becomes three locks: Purser's code, Airwallex's card controls, Metal's mandate on chain. A prompt is not a control. Real agents, not scripts: Claude made all 24 decisions, and no key reaches Claude. Try it in 30 seconds.
<!-- /synopsis -->

## Description

Characters: **3,995** (the text between the markers, as pasted). Max's target is 3,000–4,000; the form's own limit is
not known yet. `test/submission.test.ts` checks this count and keeps the text under 4,000. The long text, as it stood on
5 November, with Airwallex, Metal, Claude, the controls and the other live tests in full: [long-description.md](long-description.md).

<!-- description -->
**The problem.** AI agents can now spend company money. Today an agent's limit lives in a prompt it can be talked out of, or in a month-end review that finds the money after it has left.

**The solution.** Purser gives each AI agent its own Airwallex card and its own Metal on-chain mandate. Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; the CFO approves anything beyond them, with Face ID on the exact terms.
- An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. Try it in 30 seconds. https://kit11.max-31b.workers.dev/try/sign
- One CFO policy becomes three locks: Purser's code, Airwallex's card controls, Metal's mandate on chain. A prompt is not a control.
- Real agents, not scripts: Claude made all 24 decisions, and no key reaches Claude.

**The proof.** The Kit 11 scenario, run live on 3 November. Starter Kit 11 (x402 Business Agents), entered for the Metal Award. Three Claude agents run Northwind Outdoor, an outdoor wholesaler that sells live stock data to retailers per query, on 20 test dollars; Max plays the CFO, with Max's passkey (Face ID on his phone). The CFO signed 5 decisions with Face ID (+1 co-signature).
1. **The price rise.** The supplier went from 0.02 to 0.04 a check, over the Sourcing mandate's 0.03 cap. We switched off our own check once to prove the chain holds the line: Purser refuses an over-cap purchase before signing; with that check off for one purchase, Metal refused it anyway. That was purchase #24; the refusal is recorded on chain (`mandate_cap_exceeded`, tx `0x2e92f9cb…1871`). The CFO signed Treasury's option A (P-0002) with Face ID.
2. **The dispute.** A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects it with Face ID. Refunds #7, #10 and #13, each on chain.
3. **The euro bill.** Treasury planned the EUR 240.00 licence itself. After the CFO's Face ID, EUR 110.00 bought by FX for USD 124.29, then SWIFT: transfer `03360bfa-afce-457b-89d1-e1097fbe3985`, PAID 6 s after Face ID (settlement simulated in the sandbox).

86 Metal payments + 1 card charge, all inside the limits. 16 stops, nothing paid over a limit: a buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.

**Airwallex, Metal and Claude.**
- Airwallex (sandbox): the hash of the exact terms the CFO signed with Face ID is in Airwallex's own record of the EUR 240.00 SWIFT payment, and 3 of 3 agent cards carry the CFO's policy as Airwallex's own controls, read back from Airwallex.
- Metal (testnet): a mandate on chain per agent; 86 payments, each its own transaction; purchase #24 refused on chain (mandate_cap_exceeded); the mandates replaced on chain after the CFO's Face ID (four eyes; second approver a labelled test passkey).
- Claude: 24 of 24 decisions in the main run, 0 fallbacks; a reliability run (rel-1) found a fault in how the agents hand off a card raise, and after the fix the eval rebuilt from that moment went from 6/10 to 10/10 and the next run (rel-1b) passed every step.

**The business (not validated with customers yet).** Price: €49 per company a month, including 5 agents and 1,500 Claude decisions; €10 per extra agent; €3 per extra 100 decisions. A hypothesis. Who buys, why now and why Purser: docs/business in the repo.

**What's real.** Test money. Simulated: customer, supplier, settlement, second approver. Details → https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/submission/long-description.md#what-is-real-and-what-is-simulated

**Links.** https://kit11.max-31b.workers.dev/proof · https://youtu.be/jaqO2M2V6NY · https://github.com/agamemnon-coder/x402-business-agents
<!-- /description -->

## Instructions

<!-- instructions -->
1. Judge it in 3 minutes: https://kit11.max-31b.workers.dev/judge. Five steps, each with its time and a link.
2. Or step by step. First, the demo (about a minute): https://kit11.max-31b.workers.dev/try/sign. A test world of
   your own: sign the agent's payment with your own passkey (Face ID, Touch ID or a PIN), try to cheat (one cent
   changed: the same signature is refused), change the rule, and the agent pays its next invoice alone. Nothing real
   moves.
3. Then the proof and the film: every id from the main run (3 November) on https://kit11.max-31b.workers.dev/proof, the
   Metal ones checkable on Metal's testnet explorer; the film (2:42) at https://youtu.be/jaqO2M2V6NY.
4. Then the repository, offline, no keys and no network after `npm ci` (Node.js 22.13 or later):
   `npm ci`, then `npm test` (the full suite, on stand-ins), then `npm run judge -- --check` (serves Home, Watch, Proof,
   the partner pages, the CFO dashboard and the Scenario Lab from the main run's record, fetches each page once and
   exits; `npm run judge` serves them and opens the browser). Running it live (sandbox keys, a Metal RPC):
   [docs/run-it.md](../run-it.md).
<!-- /instructions -->

## Links

- Video (2:42; voice-over: an AI-generated voice, music: AI-generated, both ElevenLabs): <https://youtu.be/jaqO2M2V6NY>
- Live: <https://kit11.max-31b.workers.dev/>
- Try it yourself: <https://kit11.max-31b.workers.dev/try/sign>: sign, try to cheat, change the rule, with your own
  Face ID, in a test world of your own; nothing real moves (live since 4 November 2026).
- Repository: <https://github.com/agamemnon-coder/x402-business-agents> (tag `v1.0-submission`)
- Extra, not an award entry: <https://kit11.max-31b.workers.dev/visa>. Each agent signs its card checkout with Visa's
  Trusted Agent Protocol (TAP); Visa TAP: built and verified against Visa's public reference verifier; not eligible Visa
  tooling for this hackathon (Visa, 5 Nov), so Purser is entered for the Metal Award only.

## Screenshots

From the live site (https://kit11.max-31b.workers.dev, main 60569ef, Worker 3e8cd078) on 6 November, 1280 px wide at
2× (2560 px; 1600 px high, screens 2–4 as tall as their card), light mode, in the form's order: the problem, try it, the proof per partner, the business. Screens
2–4 come from one test world on /try/sign (one live Airwallex FX quote, read-only, and one live Claude Haiku
sentence; a test passkey; nothing real moves). The other pages replay the main run (3 November) and make no outside
call.

1. `screens/form/form-1-home.png`: Home's first screen: what Purser is, the three sentences, "Try it in 30 seconds."
2. `screens/form/form-2-try-sign-sheet.png`: /try/sign, the approval sheet: the Treasury agent's sentence by Claude
   Haiku (live), the exact terms with the FX quote; beside it the payment a rule stopped, and which lock stopped it
3. `screens/form/form-3-try-sign-verified.png`: signed with the test passkey and verified by the server: "Signed and
   verified. This signature only fits these exact terms."
4. `screens/form/form-4-try-sign-tamper.png`: the amount + 0.01 sent with the same signature: refused, the two hashes
   side by side
5. `screens/form/form-5-airwallex.png`: /airwallex: the hash the CFO signed beside the one Airwallex returns with the
   EUR 240.00 SWIFT payment (match), then 3 of 3 cards matching the CFO policy, the cards' fold open
6. `screens/form/form-6-metal.png`: /metal: 3 mandates on chain, 86 payments each its own transaction, #24 refused on
   chain, the mandates replaced after Face ID
7. `screens/form/form-7-claude.png`: /claude: 24 of 24 decisions by Claude, 0 fallbacks; Haiku, Sonnet, Opus
8. `screens/form/form-8-business.png`: Home's "Why this is a company": the problem, who buys, the intended pricing, why
   now, why Purser (not validated with customers yet)

The earlier set, made by `npm run submission` from the pages that replay the main run (1440 × 900), stays in
`screens/` for the deck.

## Deck and zip

- `purser-deck.pdf`: twelve slides, one message each, in the story's order (the problem, the three sentences, the demo,
  the run, the Airwallex proof, the Metal proof, the agents, security and tests, what is real, the business, the roadmap),
  made by `npm run submission` from the same figures (`npm run submission -- --deck-only` for the deck alone). Each slide
  as a PNG: [docs/evidence/deck/](../evidence/deck/).
- The zip: `npm run submission` writes `out/submission/purser-source.zip` (`git archive` of the current commit: the
  code, no keys, no ledger). Not committed.

## Proof sentences

One sentence per partner (Airwallex, Metal, Claude), word for word in the Description above, the README, Home and the
deck, from one source: `PROOF_SENTENCES` in `src/config/brand.ts`. `test/proof-sentences.test.ts` reads every number in
them from its record (the GET-only Airwallex read-backs `docs/runs/airwallex-transfer-approval-2026-11-06.json` and
`docs/runs/airwallex-cards-2026-11-06.json`, the main run's record, `docs/demo/reliability.json`,
`docs/runs/reliability-2026-11.md` and `docs/evals/agents.json`). Sources: [docs/claims.md](../claims.md).
