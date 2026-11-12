# Submission pack (HackerEarth form)

Copy each block into the form. Max submits; nothing here is sent by itself. Every run figure comes from the main run
of 3 November (`docs/demo/main-run.json`, log `docs/runs/2026-11-03-main-run.md`) and the reports in this repo
(`src/submission/facts.ts`); `test/submission.test.ts` checks this page against them. The Description tells the demo in
the site's order (Home, Try, Proof), then the main run, plus one labelled sentence on the reliability run of
6 November (in Claude's proof sentence), one on awx-1, the Airwallex-only run of 7 November (its record:
`docs/demo/airwallex-run.json`, log `docs/runs/2026-11-07-awx-1.md`), and one on the Airi run of 7 November, Visa
Intelligent Commerce via Airwallex's Airi (its record: `docs/demo/airi-run.json`, log
`docs/runs/2026-11-07-vic-1.md`); the long text ([long-description.md](long-description.md)) has every other live run under "Other live tests
(separate worlds, dated)", with its date, and what ran only on stand-ins under "Tested on stand-ins (not live)". Sources
for each claim: [docs/claims.md](../claims.md), section "The submission pack".

The video link is in. Max's steps: [checklist-max.md](checklist-max.md).

## Title

Purser · AI agents spend. You sign off.

## Synopsis

<!-- synopsis -->
For CFOs whose AI agents pay suppliers: when an agent wants to pay an invoice over its limit, you sign the exact terms with Face ID. An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. One CFO policy, a lock per rail: Airwallex card controls, Metal's mandate, the CFO's signature on invoices. A prompt is not a control. Real agents: Claude made all 24 decisions (routine payments are code); no key reaches Claude. Try it in a minute.
<!-- /synopsis -->

## Description

Characters: **3,866** (the text between the markers, as pasted; 3,892 if the form counts each line break as two). Max's target is 3,000–4,000; the form's own limit is
not known yet. `test/submission.test.ts` checks this count and keeps the text under 4,000. The long text, as it stood on
5 November, with Airwallex, Metal, Claude, the controls and the other live tests in full: [long-description.md](long-description.md).
The Airi run of 7 November (Visa Intelligent Commerce via Airwallex's Airi; Airwallex sandbox, test card, test money)
has one sentence in the Description since 7 November (the owner's decision to name Visa Intelligent Commerce), at the
end of "Airwallex, Metal and Claude", and its full story in the long text under "Other live tests". To fit it, other
sentences were tightened, no fact dropped: the solution keeps the card and the mandate (the CFO's
signature over the exact terms is the next line); the demo line keeps the fake invoice and the rule (signing and the
one-cent cheat are in the first bullet); the euro bill drops the repeated "after the CFO's Face ID" and the settlement
note ("What's real" says the settlement is simulated); awx-1's line is shorter. After the jury review of 7 November
(the hook "are starting to", "Try it in a minute.", the CFO's passkey without a name or "his") a few more words went:
"sits", "once the money left", "AI" before "agent" in the solution (the problem says it), the supplier by its name (Stockline), the demo's order with commas, figures for "two". Since 7 November (Visa, in the hackathon Slack: the VIC run counts) the award wording is: entered for
the Metal Award and the Visa Award; to fit it, awx-1's line became "7 of 7 checks; 2 Airwallex card declines; the CFO's
hash in 2 SWIFT payouts." (no fact dropped).
After the jury review of 9 November: a paragraph "After the kit (not live)" (the payables inbox, stand-ins only, not
deployed; its page is [after-the-kit.md](../after-the-kit.md), linked from the README); the buyer back in the
business line; option A says what it was (the test passkey as second approver is in Metal's sentence and "What's
real"). To fit them: the demo line went (the first bullet links /try/sign) and awx-1's line went (it stays in the
README, on /airwallex and in the long text). The text stays under 4,000 characters even with CRLF line breaks.
On 10 November that paragraph became one line: the two-locks run (Airwallex's approval workflow held a
passkey-signed payout `IN_APPROVAL`; nobody approved it there, so it is unpaid; [record](../runs/2026-11-10-airwallex-two-locks.md))
and the inbox's status (its sandbox run is in [after-the-kit.md](../after-the-kit.md); the console is not public).
On 12 November the owner approved that transfer in Airwallex's web app and it went PAID, settlement simulated, so the
line now says so in the same number of characters ([record](../runs/2026-11-12-airwallex-two-locks-paid.md)).
The same day the owner decided that no quotes appear anywhere, so the CFO's quote left the business paragraph (the
text went from 3,971 to 3,826 characters).
On 12 November the owner decided to merge the product's code into `main` now ([decisions.md](../decisions.md), D29), so
the line's last sentence, "Payables inbox: not public.", became "Payables: in repo, not live.": the code is in this
repository, the hosted preview stays private, and nothing is said to be live.
Later on 12 November (jury check) the claims were made to agree: Purser Cloud runs publicly as a test preview at
purser-try (test companies, test money on a simulated bank), so the sentence became "Purser Cloud: a public test preview
(test companies, simulated bank)." ([cloud.md](../cloud.md)).

<!-- description -->
**The problem.** AI agents are starting to spend company money.

**The solution.** Per agent, an Airwallex card and a Metal mandate.
- An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. Try it in a minute. https://kit11.max-31b.workers.dev/try/sign
- One CFO policy, a lock per rail: Airwallex card controls, Metal's mandate, the CFO's signature on invoices. A prompt is not a control.
- Real agents: Claude made all 24 decisions (routine payments are code); no key reaches Claude.

**The proof.** The Kit 11 scenario, run live on 3 November. Starter Kit 11 (x402 Business Agents), entered for the Metal Award and the Visa Award. Three Claude agents run Northwind Outdoor, an outdoor wholesaler that sells live stock data to retailers per query, on 20 test USD; Max plays the CFO and signs with a personal passkey (Face ID on a phone). The CFO signed 5 decisions with Face ID (+1 co-signature).
1. **The price rise.** Stockline's price doubled. We switched off our own check once to prove the chain holds the line: Purser refuses an over-cap purchase before signing; with that check off for one purchase, Metal refused it anyway. That was purchase #24; the refusal is recorded on chain (tx `0x2e92f9cb…1871`). The CFO signed option A, a higher cap for Sourcing (P-0002).
2. **The dispute.** A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects it with Face ID. Refunds #7, #10 and #13, each on chain.
3. **The euro bill.** The EUR 240.00 licence: EUR 110.00 bought by FX for USD 124.29, SWIFT transfer `03360bfa-afce-457b-89d1-e1097fbe3985`, accepted by Airwallex with the signed hash.

86 Metal payments + 1 card charge, all inside the limits. 16 stops, nothing paid over a limit: one buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.

**Airwallex, Metal and Claude.**
- Airwallex (sandbox): the hash of the exact terms the CFO signed with Face ID is in Airwallex's own record of the EUR 240.00 SWIFT payment, and 3 of 3 agent cards carry the CFO's policy as Airwallex's own controls, read back from Airwallex.
- Metal (testnet): a mandate on chain per agent; 86 payments, each its own transaction; purchase #24 refused on chain (mandate_cap_exceeded); the mandates replaced on chain by the owner key after the CFO's Face ID in Purser (four eyes; second approver a labelled test passkey).
- Claude: 24 of 24 decisions in the main run, 0 fallbacks; a reliability run (rel-1) found a fault in how the agents hand off a card raise, and after the fix the eval rebuilt from that moment went from 6/10 to 10/10 and the next run (rel-1b) passed every step.
- Visa Intelligent Commerce via Airwallex's Airi: 5 of 5 checks; each confirmed in Airi, above Purser's limit only after Face ID; a disallowed merchant refused first.

**After the kit.** Airwallex held a test-passkey payout; a person approved; PAID (simulated). Purser Cloud: a public test preview (test companies, simulated bank).

**The business (not validated with customers yet).** Buyer: a CFO on Airwallex. Pilot pricing: Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout. A hypothesis.

**What's real.** Test money. Simulated: customer, supplier, settlement, second approver. Details → https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/submission/long-description.md#what-is-real-and-what-is-simulated

**Links.** https://kit11.max-31b.workers.dev/proof · https://youtu.be/kCUsFHrxE-o · https://github.com/agamemnon-coder/x402-business-agents
<!-- /description -->

## Instructions

<!-- instructions -->
1. Judge it in 3 minutes: <https://kit11.max-31b.workers.dev/judge> (five steps in the menu's order, each with its time
   and a link).
2. Or the same way on your own: Home (<https://kit11.max-31b.workers.dev/>), then Try, then Proof.
   - Home (about 40 s): four steps of one payment (ask, Face ID, paid), then tap "+1 cent": the check in your
     browser says Refused, "Hash no longer matches".
   - Try (about a minute): <https://kit11.max-31b.workers.dev/try/sign> opens a test world of your own; nothing real moves.
     The agent asks: Claude Sonnet reads the invoice, Purser's code checks the reading and the terms come from it,
     Claude Opus advises live as the Treasury agent. You sign with your own passkey (Face ID, Touch ID or a PIN). Try to
     cheat: one cent changed, the same signature is refused. Try to trick the agent: Claude Sonnet reads a fake invoice
     live, and Purser's code stops it. Change the rule and see the worst case; the agent pays its next invoice alone; a
     closing card sums it up.
   - Proof: <https://kit11.max-31b.workers.dev/proof> has every id from the main run, the Metal ones checkable on
     Metal's testnet explorer, awx-1, the Airwallex-only run of 7 November (all seven checks passed), and Visa Intelligent
     Commerce via Airwallex's Airi (7 November; Airwallex sandbox, test card, test money; 5 of 5 checks). The film
     (3:58): <https://youtu.be/kCUsFHrxE-o>. The replay of the main run of 3 November (three Claude agents, a price
     rise, a dispute and a euro bill): <https://kit11.max-31b.workers.dev/watch>
3. Then the repository, offline, no keys and no network after `npm ci` (Node.js 22.13 or later):
   `npm ci`, then `npm test` (the full suite, on stand-ins), then `npm run judge -- --check` (serves Home, Watch, Proof,
   the partner pages, the CFO dashboard and the Scenario Lab from the main run's record, fetches each page once and
   exits; `npm run judge` serves them and opens the browser). Running it live (sandbox keys, a Metal RPC):
   [docs/run-it.md](../run-it.md).
<!-- /instructions -->

## Links

- Video (3:58; voice-over: an AI-generated voice, music: AI-generated, both ElevenLabs): <https://youtu.be/kCUsFHrxE-o>
- Live: <https://kit11.max-31b.workers.dev/>
- Try it yourself: <https://kit11.max-31b.workers.dev/try/sign>: sign with your own Face ID, try to cheat, try to trick
  the agent, change the rule and see the worst case, and the agent pays alone, in a test world of your own; nothing real
  moves (live since 4 November 2026).
- The Airwallex-only run, awx-1 (7 November; sandbox, test money): <https://kit11.max-31b.workers.dev/airwallex#awx-1>
- Visa Intelligent Commerce via Airwallex's Airi, a live run (7 November; Airwallex sandbox, test card, test money):
  <https://kit11.max-31b.workers.dev/airwallex#airi-run>
- Repository: <https://github.com/agamemnon-coder/x402-business-agents> (tag `v1.0-submission`)
- Outside the entry: Visa TAP, in the closed fold at the foot of <https://kit11.max-31b.workers.dev/visa>. The
  Sourcing agent signed its card checkout with Visa's Trusted Agent Protocol (TAP) in its own run; Visa TAP: built and
  verified against Visa's public reference verifier; not eligible Visa tooling for this hackathon (Visa, 5 Nov). The Visa Award entry is the Airi run above (Visa
  Intelligent Commerce).

## Screenshots

From the live site (https://kit11.max-31b.workers.dev, deployed from main 877151f) on 7 November, 1280 px wide at 2×
(2560 px; screens 1, 6 and 7 the first 800 px of the page, the others as tall as their part of the page), light mode,
PNG under 500 KB each, in the form's order: the problem, try it, the proof per partner, the business. Screens 2–4 come
from one test world on /try/sign (one live Airwallex FX quote, read-only, and the Treasury agent's advice by Claude
Opus, live; a test passkey; nothing real moves). The other pages replay the main run (3 November) or show the separate
runs of 7 November, and make no outside call.

1. `screens/form/form-1-home.png`: Home's first screen: "AI agents spend. You sign off.", the synopsis line, the three
   sentences, "Start: watch the agents" and the 3-minute tour; beside it the main run replayed: the three agents and
   Metal's on-chain refusal
2. `screens/form/form-2-try-sign-sheet.png`: /try/sign, step 1 of 6, "The agent asks": the Treasury agent's advice by
   Claude Opus (live), the invoice above the agent's limit with the live Airwallex quote, "Sign with Face ID"; beside it
   one policy, three locks, and the test payment Purser stopped in this world
3. `screens/form/form-3-try-sign-verified.png`: step 2, signed with the test passkey: "Signed and verified. Purser checked
   your signature. It only fits these exact terms.", executed in the test world, the receipt to download and check
4. `screens/form/form-4-try-sign-tamper.png`: step 3, "Try to cheat": the amount + 1 cent sent with the same signature:
   "One cent changed. The signature is worthless.", refused by Purser, signed and sent side by side with both hashes
5. `screens/form/form-5-airwallex.png`: /airwallex: the hash the CFO signed beside the one Airwallex returns with the
   EUR 240.00 SWIFT payment (match), 3 of 3 cards matching the CFO policy, awx-1 (7 of 7 checks), and Visa Intelligent
   Commerce via Airwallex's Airi, a live run (7 November; Airwallex sandbox, test card, test money): paid alone, paid
   after Face ID, refused by Purser, 5 of 5 checks
6. `screens/form/form-6-metal.png`: /metal: 3 mandates on chain, 86 payments each its own transaction, #24 refused on
   chain, the mandates replaced after Face ID
7. `screens/form/form-7-claude.png`: /claude: Sourcing · Haiku, Support · Sonnet, Treasury · Opus; 24/24 decisions by
   Claude (0 fallbacks), 82 routine payments by code, 50 Claude calls each with a request id, 5 Face ID decisions
8. `screens/form/form-8-business.png`: /proof, "Why this is a company" opened: the problem, who buys, the intended
   pricing, why now, why Purser; not validated with customers yet

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

One sentence per partner (Airwallex, Metal, Claude), word for word in the Description above, the README and the deck,
from one source: `PROOF_SENTENCES` in `src/config/brand.ts`. On the site, /proof's partner cards open with the same
claims in fewer words, each linked to its proof (`src/redesign/proofLead.ts`, `test/proof-first.test.ts`). `test/proof-sentences.test.ts` reads every number in
them from its record (the GET-only Airwallex read-backs `docs/runs/airwallex-transfer-approval-2026-11-06.json` and
`docs/runs/airwallex-cards-2026-11-06.json`, the main run's record, `docs/demo/reliability.json`,
`docs/runs/reliability-2026-11.md` and `docs/evals/agents.json`). Sources: [docs/claims.md](../claims.md).
