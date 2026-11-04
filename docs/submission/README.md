# Submission pack (HackerEarth form)

Copy each block into the form. Max submits; nothing here is sent by itself. Every run figure comes from the main run
of 3 November (`docs/demo/main-run.json`, log `docs/runs/2026-11-03-main-run.md`) and the reports in this repo
(`src/submission/facts.ts`); `test/submission.test.ts` checks this page against them. Anything from another run is under
"Other live tests (separate worlds, dated)", with its date. Sources for each claim: [docs/claims.md](../claims.md),
section "The submission pack".

Fill in before submitting: the video link. Max's steps: [checklist-max.md](checklist-max.md).

## Title

Purser: company cards and on-chain mandates for AI agents, with the CFO in control

## Synopsis

<!-- synopsis -->
A supplier doubles its price. A customer disputes 12 orders. A €240 bill is due in euros. Three Claude agents run a small data business on 20 test dollars through Metal and Airwallex; the CFO signed 5 times with Face ID. One live run, every id below. Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; the CFO approves anything beyond them.
<!-- /synopsis -->

## Description

**Starter Kit 11 (x402 Business Agents), entered for the Metal Award and the Visa Award (see the note at the end).**

**A supplier doubles its price. A customer disputes 12 orders. A €240 bill is due in euros.** Three Claude agents run a
small data business on 20 test dollars through Metal and Airwallex; the CFO signed 5 times with Face ID. One live run,
every id below.

Purser is for the CFO or controller of a small company that runs AI agents and wants them to spend company money only
within limits the CFO sets. Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code
holds the rest; the CFO approves anything beyond them. The example company is Northwind Outdoor, an outdoor wholesaler
that sells live stock data to retailers per query (here one simulated customer, Summit Outfitters, whose agent we run)
and pays its suppliers. It has Kit 11's three agents, the Sourcing, Support and Treasury agent, each with its own
Airwallex card and its own Metal mandate. The CFO in this demo is Max, the builder, on his own phone.

### The main run (3 November)

One live run, 11:16–11:33 UTC, on the Airwallex sandbox and Metal testnet with test money, real Claude decisions and
the CFO's real Face ID. Log: `docs/runs/2026-11-03-main-run.md`.

- **The price rise.** Stockline, the supplier, went from 0.02 to 0.04 a stock check, over the Sourcing mandate's 0.03
  cap. Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved
  (`mandate_cap_exceeded`, tx `0x2e92f9cb…1871`). Treasury's options 40 s after the refusal, within the same 20.00;
  the CFO signed with Face ID (1 of 2), then the second approver (2 of 2), and both mandates were replaced on chain.
- **The dispute.** A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects it with Face ID.
- **The euro bill.** The Treasury agent planned the EUR 240.00 licence itself (P-0005). After the CFO's Face ID,
  EUR 110.00 bought by FX for the shortfall (USD 124.29, conversion `3ca88196-05da-4d88-9caa-796f03704636`), then
  SWIFT: transfer `03360bfa-afce-457b-89d1-e1097fbe3985`, PAID 6 s after Face ID, fee EUR 13.42 (ceiling EUR 20.00).

Each agent's budget, when bound → after the CFO's Face ID (test USD): Sourcing 10.00 → 14.00 (cap 0.03 → 0.04 a
purchase); Support 4.00 (cap 0.10); Treasury 6.00 → 2.00. 20.00 between them before and after, held in code.

### From idea to build

Our idea (submitted 24 October) promised three agents on one Metal account, each under its own on-chain mandate, and
three moments: a price rise, a dispute and a euro bill. Built as promised, each with its proof in
[docs/idea-vs-build.md](../idea-vs-build.md): the three mandates (10, 4 and 6 test USD, at most 3 cents a purchase for
sourcing), the 20 held in code and no agent with the owner key; x402 queries at 5 cents with a signed order, upstream
data at 2 cents; and the three moments above, in one live run.

What got better than the idea: the agents decide for themselves, as Claude agents with their own tools, inside the
same limits; the approval is Face ID on the CFO's phone instead of a typed hash; every agent also has an Airwallex
company card whose limits Airwallex enforces.

### How we use Airwallex

- **A company card per agent (Issuing).** Each agent has a DELEGATE cardholder and a virtual Visa card. The CFO policy
  sets its limits; its merchant categories, currency and end date are fixed per agent. Purser writes them all to the
  card and reads them back. Airwallex enforces them. In the main run the Sourcing agent asked for a card raise first
  (P-0006, EUR 30.00 → 46.00), the CFO approved it with Face ID, Purser synced it to the card, and Airwallex approved
  the TAP-signed EUR 45.00 purchase (authorization `01a1a12f-4113-7000-b76d-014677710007`).
- **FX and SWIFT for the €240 licence.** EUR 110.00 bought by FX for USD 124.29 on a locked quote (conversion
  `3ca88196-05da-4d88-9caa-796f03704636`), only the shortfall above the EUR reserve; then SWIFT, transfer
  `03360bfa-afce-457b-89d1-e1097fbe3985`, fee EUR 13.42, PAID 6 s after Face ID. One Face ID covers the rate, the
  payee and the most the fee may be (EUR 20.00). The transfer carries the approval's hash in its metadata.
- **Earnings booked once final.** The 0.69 test USD swept on Metal after finality is booked at Airwallex exactly once,
  as a simulated sandbox deposit (`b3812e05-2afa-4698-8f64-429f9608e0a0`) whose reference is the testnet transaction.

### How we use Metal

- **A mandate per agent.** Each agent that pays per request does it under its own on-chain mandate: a cap per payment,
  a total budget, one payee and an end date.
- **A price rise refused against the mandate.** Metal refused the purchase over the cap itself (tx `0x2e92f9cb…1871`);
  after the CFO's Face ID and the second signature, Purser replaced the Sourcing and Treasury mandates on chain; a
  payment under the old mandate is refused (`mandate_revoked`).
- **x402 with signed orders** for per-request sales, and **mandate pulls** for refunds and the earnings sweep.
- **The Dispute desk.** A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects it with Face ID.
  Any seller on Metal can reuse it: `examples/metal-dispute-desk`.

### Visa

Visa: each agent signs its card checkout with Visa's Trusted Agent Protocol (TAP), so a merchant can check which agent is buying. Visa's public reference verifier accepted the signatures in a separate test on 2 November; the merchant is ours.

### Where Claude is used

In the main run the three agents (Sourcing on Haiku, Support on Sonnet, Treasury on Opus) made 24 decisions, all by
Claude, 0 fallbacks, in 50 calls each with a request id, for USD 0.3170 at list prices. Claude holds no key and cannot
use the CFO's passkey; in this demo the second approver is a labelled test passkey, signed on the CFO's go. In
production this is a second person. Purser's code checks every payment against the policy, and only the CFO's Face ID
moves money beyond the agents' limits.

### Controls

- **The agent may:** pay inside its card limits and its mandate, alone.
- **Needs the CFO:** anything above a limit, a new payee, a bank-detail change, a refund batch above the threshold, a
  looser policy. The CFO signs the exact terms on the phone with Face ID; the runner checks the signature and
  the terms' hash before it moves money.
- **Exceptions:** a price rise is refused on chain and becomes options; a suspected fake invoice or a planted
  instruction is held for a person; an agent that pays too often is stopped; a payment the ledger cannot explain is
  found by the hourly reconciliation.
- **Audit:** every decision goes into an append-only, hash-chained log that `npm run verify` re-checks.

### Proof from the main run (3 November)

The CFO on his own phone with Face ID; the agents decided with Claude; test money only (Metal testnet, Airwallex
sandbox). Second approver: a labelled test passkey in this demo. In production this is a second person.
- 55 queries, 55 upstream purchases (the cache was off): 41 paid. 14 queries got an error and were not charged (1
  refused by Metal at the cap, #24; 12 the Sourcing agent chose not to buy at the higher price, #25–#36, until the new
  mandate was in place; 1 refused `mandate_revoked` while the mandate was being replaced, #37);
- 87 inside the limits = 41 sales + 41 supplier purchases + 3 refunds + 1 sweep + 1 card buy, with no approval at the
  time; 86 of them on Metal (all but the card buy);
- 24 of 24 decisions by Claude, 0 fallbacks; 5 decisions signed with Face ID by the CFO (P-0001, P-0002, P-0004,
  P-0005, P-0006);
- the books match the chain and Airwallex: `verify` passes; `reconcile` checked 88 (the 86 Metal payments, the SWIFT
  transfer and the card buy), 0 differences; `data-qa` 217 of 217 checks; 110 money movements, 0 without an origin;
- 2 stopped at a limit: Metal refused purchase #24 over the mandate cap, and the CFO rejected P-0004 with Face ID
  (query #37, refused `mandate_revoked` while the mandate was being replaced, is not counted);
- Separate run, not counted: Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November.

### What is real and what is simulated

All money is test money: the Airwallex sandbox and Metal testnet. The cards, limits, conversion, transfer and mandates
are real API and chain results. Simulated by the sandbox: the merchants' charges, the deposit that stands in for Metal
earnings and the transfer's final status. Run by us: the customer Summit Outfitters and its agent, and Stockline, the
warehouse API.

### Other live tests (separate worlds, dated)

Not part of the main run; each in its own test world, with its own date.

- **Visa TAP run (2 November).** Visa's reference registry self-hosted with a test key, and our own TAP merchant;
  Airwallex approved one card buy and declined EUR 45.00 over the card limit (LIMIT_EXCEEDED).
- **Single-use task cards (30 October).** One sentence (a flight, a hotel or a train, with an amount) becomes one card
  for that task, locked to its merchant category, the amount and a date. Within the CFO's policy it is issued at once;
  otherwise after Face ID.
- **Global Accounts and webhooks (30 October).** Retailers pay Northwind's EUR and GBP accounts (sandbox simulations); a
  receivables agent matches each payment to its invoice by reference and sends anything short or unknown to the CFO.
  Each webhook delivery is signature-checked at the relay and again on the runner. Shown live: two retailer deposits,
  one matched and one sent to the CFO as short, by the webhook alone, and a card transaction. Payout and conversion
  events are subscribed but were not caused live.
- **For a bigger company, more control on chain (separate test worlds, Metal testnet, 30 October):**
  - **Four eyes on chain.** A 2-of-2 Metal account: the CFO and a controller. A payment signed by the CFO alone, the
    same payment co-signed by a stranger's key, and a mandate revoke by the CFO alone each reverted on chain; with both
    owners signing, they went through.
  - **Compliance before a payout.** Our send-policy contract pays only with Purser's signed screening decision for
    that payee, amount and moment. Eleven attacks reverted on chain, among them a replay, a redirect to the attacker
    and a self-made decision for a sanctioned stand-in. Agents' mandate payments do not pass through it (Metal's
    design).
  - **Clearing under load.** 2,000 of 2,000 pay-per-call payments in 471.8 s (4.24 a second, p50 1.4 s, p95 8.1 s), at
    about $0.0007 of RPC calls per payment (an estimate from Metal's published rates, not a bill). A first run paid
    1,879 before one wallet was held by a lost answer; resending the same request fixed it.
  - **Receive policy (dry run, 31 October):** the sweep wallet can be set to accept money only from the business
    account; anything else waits in quarantine for the CFO.
- **Emergency stop.** One Face ID freezes every agent card at Airwallex and stops every agent payment (tested against
  stand-ins, not yet run live).
- **Red team (30 October, in-memory stand-ins for Airwallex, Metal and the phone).** 35 scripted attacks plus 4
  documents written by Claude Opus as the attacker: 39 of 39 attacks failed, 0 inconclusive; 37 were stopped before
  the attack succeeded and 2 were found afterwards, not prevented (a hidden card charge by the reconciliation, a
  rewritten log row by `npm run verify`). Three more runs on 31 October: 118 of 120 attacks failed and 2 were
  inconclusive (nothing was paid or changed). Scenario Lab: 18 of 18 stories as expected (stand-ins).

*Visa Award: Entered for the Visa Award (organisers confirmed one project may enter both Visa and Metal; whether TAP counts as Visa tooling is still being confirmed with Visa).*

## Instructions

```sh
npm ci && npm run judge
```

Needs Node.js 22.13 or later. No keys and no network after `npm ci`. It serves Home, Watch and Proof replaying the main
run, the CFO dashboard as it stood at the end, `/metal`, `/airwallex`, `/visa`, `/claude`, `/try` (offline it reads
requests with code only; the hosted page asks Claude), the Scenario Lab and a simulated month, and opens the browser.
Running it live (sandbox keys, a Metal RPC) is in [docs/run-it.md](../run-it.md).

## Links

- Video: _(Max fills in: the unlisted YouTube link)_
- Live: <https://kit11.max-31b.workers.dev/>
- Try it yourself: <https://kit11.max-31b.workers.dev/try/sign>: sign a test proposal with your own Face ID, in a test
  world of your own; nothing real moves (live since 4 November 2026).
- Repository: <https://github.com/agamemnon-coder/x402-business-agents> (tag `v1.0-submission`)

## Screenshots

`npm run submission` makes them from the pages that replay the main run (3 November), at 1440 × 900:

1. `screens/1-landing.png`: Home, the three moments and the run's numbers
2. `screens/15-watch.png`: Watch, replaying the main run
3. `screens/14-dispute.png`: the dispute on Watch, at the CFO's rejection of "refund the other 9"
4. `screens/16-proof.png`: Proof, every id from the run
5. `screens/3-metal.png`: How Purser uses Metal, with the refusal on chain
6. `screens/17-visa.png`: the TAP-signed card buy, approved by Airwallex
7. `screens/2-dashboard.png`: the CFO dashboard at the end of the run
8. `screens/6-books.png`: the books, from the same ledger

## Deck and zip

- `purser-deck.pdf`: twelve slides, one message each, made by `npm run submission` from the same figures.
- The zip: `npm run submission` writes `out/submission/purser-source.zip` (`git archive` of the current commit: the
  code, no keys, no ledger). Not committed.
