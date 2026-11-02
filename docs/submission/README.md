# Submission pack (HackerEarth form)

Copy each block into the form. Max submits; nothing here is sent by itself. Every figure comes from the recorded run
and the reports in this repo (`src/submission/facts.ts`), and `test/submission.test.ts` checks this page against them.
Sources for each claim: [docs/claims.md](../claims.md), section "The submission pack".

Fill in before submitting: the video link, the live link (the relay's address, kept out of the repo) and the repo link
once the repo is public. Max's steps: [checklist-max.md](checklist-max.md).

## Title

Purser: company cards and on-chain mandates for AI agents, with the CFO in control

## Synopsis

<!-- synopsis -->
Purser gives each AI agent an Airwallex card and a Metal on-chain mandate, within limits the CFO sets. Inside them agents pay; past a limit Airwallex declines the card, or Purser refuses against the on-chain mandate before signing and Metal records the refusal on chain; the agent asks. The CFO signs the exact terms with Face ID. Claude reads invoices and explains code's flags; it holds no key and cannot use the CFO's passkey. Each payment has proof: an Airwallex id or a Metal transaction.
<!-- /synopsis -->

## Description

**Track 1 (Adaptive Treasury Controller), Starter Kit 11 (x402 Business Agents), for the Metal Award. Your AI agents
spend through Airwallex and Metal. The CFO stays in control.**

**Visa TAP.** Our agents sign their card checkouts at TAP merchants with Visa's Trusted Agent Protocol. Their signatures are accepted by Visa's public TAP reference verifier (pinned commit 16d59bd). The TAP merchant in this demo is run by us. Body integrity, tag and payment checks are our own layer on top. The TAP run (2 November) was a separate test world, not part of the main flow: Visa's reference registry self-hosted with a test key, and our own TAP merchant. Entered for the Visa Award (organisers confirmed one project may enter both Visa and Metal; whether TAP counts as Visa tooling is still being confirmed with Visa).

Purser is for the CFO or controller of a small company that runs AI agents and wants them to spend company money only
within limits the CFO sets. The example company is Northwind Outdoor, an outdoor wholesaler that sells live stock data to retailers per query
(here one simulated customer, Summit Outfitters, whose agent we run) and pays its suppliers. In agent run 1
(2 November), 44 of the 63 sales resold data from a cache up to 300 s old, as the Sourcing agent's buy policy allowed;
Thursday's main run is planned with the cache off. It has Kit 11's three
agents, the Sourcing, Support and Treasury agent, each with its own card and its own mandate.

### From idea to build

<!-- Max: update the figures after Thursday's main run (5 November); each one has its source in docs/claims.md. -->
Our idea (submitted 24 October) promised three agents on one Metal account, each under its own on-chain mandate, and
three moments: a price rise, a dispute and a euro bill. Built as promised, each with its proof in
[docs/idea-vs-build.md](../idea-vs-build.md):
- the three mandates (10, 4 and 6 test USD, at most 3 cents a purchase for sourcing), the 20 held in code, and no
  agent with the owner key;
- x402 queries at 5 cents with a signed order, upstream data at 2 cents;
- the price rise to 4 cents refused against the mandate, two priced options, the mandates replaced on chain only after
  the approval of their exact terms;
- the dispute settled from signed orders and on-chain payments, refunds only for wrong data, each once;
- the euro licence invoice paid at Airwallex by SWIFT, with the fee in the approval: in agent run 1 (2 November)
  EUR 240.00 from the EUR balance, no FX needed (transfer `7bbb3d61…` PAID, fee EUR 13.37; payment started by the CFO
  with `npm run licence`, the Treasury agent had advised paying later). When euros are short the plan buys only the
  shortfall on a locked quote; that ran this week in separate runs (30 October end check: EUR 370.00 for an invoice;
  1 November hosted reserve check: EUR 253.48 for the licence), not in agent run 1.

What got better than the idea: the agents now decide for themselves, as Claude agents with their own tools, inside
the same limits; the approval is Face ID on the CFO's phone instead of a typed hash; every agent also has an Airwallex
company card whose limits Airwallex enforces; and Airwallex's own events (a declined card, money paid in) reach the
agents.

### How we use Airwallex

- **A company card per agent (Issuing).** Each agent has a DELEGATE cardholder and a virtual Visa card. The CFO policy
  sets its limits; its merchant categories, currency and end date are fixed per agent. Purser writes them all to the
  card and reads them back.
  Airwallex enforces them: in the recorded run it declined a €45.00 charge (`LIMIT_EXCEEDED`) and a €19.99 charge at
  the wrong kind of shop (`MERCHANT_CATEGORY_NOT_ALLOWED`). The CFO raised the limit with Face ID, Purser synced it to
  the card, and the same charge went through.
- **Single-use task cards (separate live run).** One sentence (a flight, a hotel or a train, with an amount) becomes one card for that
  task, locked to its merchant category, the amount and a date. Within the CFO's policy it is issued at once; otherwise after Face ID.
- **FX and a supplier payout.** A supplier's €1,850.00 invoice is read, checked against the payee on file, and paid
  by SWIFT. Only the shortfall after the EUR reserve and the demo plan's set-aside amount is bought (USD 418.40 → EUR 370.00 on a
  locked quote). One Face ID covers the rate,
  the payee and the most the fee may be (€20.00; it was €13.41). The transfer carries the approval's hash in its
  metadata.
- **Global Accounts (separate live run).** Retailers pay Northwind's EUR and GBP accounts (the retailers and their
  payments are sandbox simulations); a receivables agent matches each payment to its invoice by reference and sends
  anything short or unknown to the CFO.
- **Webhooks (separate live run).** Purser subscribes to Airwallex's events for cards, card transactions, payouts,
  conversions and deposits; each delivery is signature-checked at the relay and again on the runner, then compared with
  the ledger. Shown live: two retailer deposits (simulated by the sandbox), one matched and one sent to the CFO as short, by the webhook alone, and a card transaction. Payout and conversion
  events are subscribed but were not caused live.
- **Emergency stop.** One Face ID freezes every agent card at Airwallex and stops every agent payment (tested against
  stand-ins, not yet run live).

### How we use Metal

- **A mandate per agent.** Each agent that pays per request does it under its own on-chain mandate: a cap per payment,
  a total budget, one payee and an end date.
- **A price rise refused against the mandate (recorded run, 30 October).** When the warehouse API (a stand-in we run)
  raised its price above the cap, Metal's facilitator refused the payment against the mandate on chain
  (`mandate_cap_exceeded`); nothing moved. In agent run 1 (2 November) Purser refused before signing; Metal recorded
  the refusal on chain (tx `0x3ad8de2f…a84d`). The Treasury agent proposed options, the CFO
  signed the new terms with Face ID, and Purser replaced the mandates; the old one is refused (`mandate_revoked`).
- **x402 with signed orders** for per-request sales, **mandate pulls** for refunds and the earnings sweep, and
  **pay-per-call clearing** for a prepaying customer (separate live run).
- **Earnings are booked at Airwallex only when final**, exactly once: a simulated sandbox deposit that names the
  testnet transaction (no test USD actually moves to Airwallex).
- **The Dispute desk.** Summit, the simulated customer, claimed its agent never placed 12 orders (we filed the claim
  on its behalf). Each order was checked against the chain with the signed order Northwind keeps; all 12 were signed
  and inside the mandate, so this claim refunded nothing. 3 of them (orders 7, 10 and 13) had already been refunded
  earlier for wrong data. Claude wrote the explanation; code made the decision. The case ran after the recorded run, on
  a copy of its ledger.
- **Receive policy (separate world):** the sweep wallet can be set to accept money only from the business account;
  anything else waits in quarantine for the CFO.
- **For a bigger company, more control on chain (separate test worlds, Metal testnet, 30 October):**
  - **Four eyes on chain.** A 2-of-2 Metal account: the CFO and a controller. A payment signed by the CFO alone, the
    same payment co-signed by a stranger's key, and a mandate revoke by the CFO alone each reverted on chain; with both
    owners signing, they went through.
  - **Compliance before a payout.** Our send-policy contract pays only with Purser's signed screening decision for
    that payee, amount and moment. Eleven attacks reverted on chain, among them a replay, a redirect to the attacker
    and a self-made decision for a sanctioned stand-in. Agents' mandate payments do not pass through it (Metal's
    design).
  - **Finality certificates.** For each payment the runner sees within about 2 hours, Purser keeps the finality
    certificate Metal's RPC reports, in the dispute pack, the audit report and `npm run verify`. The validators' BLS
    signature is not verified: Metal has not published testnet's validator keys.
  - **Clearing under load.** 2,000 of 2,000 pay-per-call payments in 471.8 s (4.24 a second, p50 1.4 s, p95 8.1 s), at
    about $0.0007 of RPC calls per payment (an estimate from Metal's published rates, not a bill). A first run paid
    1,879 before one wallet was held by a lost answer; resending the same request fixed it.
- **ISO 20022.** The recorded run's paid invoice exports as one pacs.008.001.08 message linking the Airwallex SWIFT
  transfer and the Metal transaction, valid against the official XSD. Not sent to any bank.

### Where Claude is used

Haiku sorts each incoming document, Sonnet reads it into checked fields, and Opus reviews a proposal's risk for the
CFO. Claude also played the attacker in the red team. Claude holds no key and cannot use the CFO's passkey; in this demo
the second approver is a labelled test passkey, signed on the CFO's go. In production this is a second person. Code
checks every payment against the policy, and only the CFO's Face ID moves money beyond the agents' limits. In the recorded run
Claude cost $0.093 per €1,000 the agents paid.

### Controls

- **The agent may:** pay inside its card limits and its mandate, alone.
- **Needs the CFO:** anything above a limit, a new payee, a bank-detail change, a refund batch above the threshold, a
  looser policy. The CFO signs the exact terms on the phone with Face ID; the runner checks the signature and
  the terms' hash before it moves money.
- **Exceptions:** a price rise is refused on chain and becomes options; a suspected fake invoice or a planted
  instruction is held for a person; an agent that pays too often is stopped; a payment the ledger cannot explain is
  found by the hourly reconciliation.
- **Audit:** every decision goes into an append-only, hash-chained log that `npm run verify` re-checks.

### Proof from the recorded run

From Friday run 1, 30 October 2026, with a Dispute desk case afterwards:
- 106 payments inside the limits with no approval at the time, about half of them the simulated customer's agent
  buying stock checks from Northwind;
- 8 stops by the card, the chain, the fraud checks or the CFO (6 payments, 2 planted instructions); €3,719.99 kept
  out for good;
- 4 decisions signed with Face ID;
- 194 audit rows, hash chain intact.

Red team (35 scripted attacks plus 4 documents written by Claude Opus as the attacker, run against in-memory stand-ins
for Airwallex, Metal and the phone): 39 of 39 attacks failed, 0 inconclusive; 37 were stopped before the attack
succeeded (a burst of payments at the speed limit, after 30 allowed ones) and 2 were found afterwards, not prevented (a
hidden card charge by the reconciliation, a rewritten log row by `npm run verify`). Three more runs on 31 October: 118 of 120 attacks failed and 2 were inconclusive (nothing was paid or changed). Scenario Lab: 18 of 18 stories as expected (run against stand-ins for Airwallex and Metal).

### What is real and what is simulated

All money is test money: the Airwallex sandbox and Metal testnet. The cards, limits, declines, conversion, transfer and
mandates are real API and chain results. Simulated by the sandbox: the merchants' charges, the retailers' deposits and
the transfer's final status. Run by us: the customer Summit Outfitters and its agent, and Stockline, the warehouse
API. The step from Metal to Airwallex is a sandbox deposit that names the real testnet
transaction.

## Instructions

```sh
npm ci && npm run judge
```

No keys and no network after `npm ci`. It serves the recorded run, the CFO dashboard as it stood at the end, `/metal`
(every Metal feature with its testnet proof; some from separate live runs), `/live` (the day as an animation), `/try` (offline it reads requests with code only; the hosted page asks Claude), the
Scenario Lab and a simulated month, and opens the browser. Running it live (sandbox keys, a Metal RPC) is in
[docs/run-it.md](../run-it.md).

## Links

- Video: _(Max fills in: the unlisted YouTube link)_
- Live: _(Max fills in: the relay's address; `/try` needs it)_
- Repository: _(Max fills in once public)_

## Screenshots

`npm run submission` makes them from the recorded pages, at 1440 × 900:

1. `screens/1-landing.png`: the landing, with what each rail did and its proof
2. `screens/2-dashboard.png`: the CFO dashboard at the end of the run
3. `screens/3-metal.png`: How Purser uses Metal
4. `screens/4-live.png`: the working day on the two rails
5. `screens/5-disputes.png`: the Dispute desk case, order by order
6. `screens/6-books.png`: the books, from the same ledger

## Deck and zip

- `purser-deck.pdf`: twelve slides, one message each, made by `npm run submission` from the same figures.
- The zip: `npm run submission` writes `out/submission/purser-source.zip` (`git archive` of the current commit: the
  code, no keys, no ledger). Not committed.
