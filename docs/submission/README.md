# Submission pack (HackerEarth form)

Copy each block into the form. Max submits; nothing here is sent by itself. Every figure comes from the recorded run
and the reports in this repo (`src/submission/facts.ts`), and `test/submission.test.ts` checks this page against them.
Sources for each claim: [docs/claims.md](../claims.md).

Fill in before submitting: the video link, the live link (the relay's address, kept out of the repo) and the repo link
once the repo is public. Max's steps: [checklist-max.md](checklist-max.md).

## Title

Purser: company cards and on-chain mandates for AI agents, with the CFO in control

## Synopsis

<!-- synopsis -->
Purser gives each AI agent an Airwallex company card and a Metal on-chain mandate, both set by one CFO policy. Inside the limits agents pay on their own; past a limit Airwallex declines or the chain refuses, and the agent asks. The CFO approves the exact terms on a phone with Face ID. Claude reads invoices and flags fraud and planted instructions, but holds no key and approves nothing. Every payment carries its proof: an Airwallex id or a Metal transaction.
<!-- /synopsis -->

## Description

**Your AI agents spend through Airwallex and Metal. The CFO stays in control.**

Purser is for the CFO or controller of a small company that runs AI agents and wants them to spend company money only
within limits the CFO sets. The example company is Northwind Outdoor: it sells live stock checks to other companies'
agents and pays its suppliers. It has three agents, Operations, Sales and Finance, each with its own card and its own
mandate.

### How we use Airwallex

- **A company card per agent (Issuing).** Each agent has a DELEGATE cardholder and a virtual Visa card. The CFO policy
  sets its limits, merchant categories, currency and end date, and Purser writes them to the card and reads them back.
  Airwallex enforces them: in the recorded run it declined a €45.00 charge (`LIMIT_EXCEEDED`) and a €19.99 charge at
  the wrong kind of shop (`MERCHANT_CATEGORY_NOT_ALLOWED`). The CFO raised the limit with Face ID, Purser synced it to
  the card, and the same charge went through.
- **Single-use task cards.** One sentence (a flight, a hotel or a train, with an amount) becomes one card for that
  task, locked to its merchant category, the amount and a date. Within the CFO's policy it is issued at once; otherwise after Face ID.
- **FX and a supplier payout.** A supplier's €1,850.00 invoice is read, checked against the payee on file, and paid
  by SWIFT. Only the missing euros are bought (USD 418.40 → EUR 370.00 on a locked quote). One Face ID covers the rate,
  the payee and the most the fee may be (€20.00; it was €13.41). The transfer carries the approval's hash in its
  metadata.
- **Global Accounts (separate live run).** Retailers pay Northwind's EUR and GBP accounts (the retailers and their
  payments are sandbox simulations); a receivables agent matches each payment to its invoice by reference and sends
  anything short or unknown to the CFO.
- **Webhooks.** Card transactions reach the ledger within seconds; each delivery is signature-checked at the relay and
  again on the runner. Cards, payouts, conversions and deposits are built and tested, not yet subscribed.
- **Emergency stop.** One Face ID freezes every agent card at Airwallex and stops every agent payment (tested against
  stand-ins, not yet run live).

### How we use Metal

- **A mandate per agent.** Each agent that pays per request does it under its own on-chain mandate: a cap per payment,
  a total budget, one payee and an end date.
- **Metal refused a price rise.** When the warehouse API (a stand-in we run) raised its price above the cap, Metal refused the payment
  against the mandate on chain (`mandate_cap_exceeded`); nothing moved. The Finance agent proposed options, the CFO
  signed the new terms with Face ID, and Purser replaced the mandates; the old one is refused (`mandate_revoked`).
- **x402 with signed orders** for per-request sales, **mandate pulls** for refunds and the earnings sweep, and
  **pay-per-call clearing** for a prepaying customer (separate live run).
- **Money reaches the bank only when final.** The sweep to Airwallex is booked once, after finality.
- **The Dispute desk.** A customer's agent claimed it never placed 12 orders. Each order was checked against the chain
  with the signed order Northwind keeps; all 12 were signed and inside the mandate, so none was refunded. Claude wrote
  the explanation; code made the decision.
- **Receive policy (separate world):** the sweep wallet can be set to accept money only from the business account;
  anything else waits in quarantine for the CFO.

### Where Claude is used

Haiku sorts each incoming document, Sonnet reads it into checked fields, and Opus reviews a proposal's risk for the
CFO. Claude also played the attacker in the red team. Claude holds no key and cannot approve: code checks every
payment against the policy, and only the CFO's Face ID moves money beyond the agents' limits. In the recorded run
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
- 106 payments inside the limits with no person needed;
- 8 payments stopped by the card, the chain, the fraud checks or the CFO; €3,719.99 kept out for good;
- 4 decisions signed with Face ID;
- 194 audit rows, hash chain intact.

Red team (Claude as the attacker, in a throwaway world): 39 of 39 attacks failed, 0 inconclusive; 37 were stopped
before anything moved and 2 were found afterwards (a hidden card charge by the reconciliation, a rewritten log row by
`npm run verify`). Scenario Lab: 18 of 18 stories as expected.

### What is real and what is simulated

All money is test money: the Airwallex sandbox and Metal testnet. The cards, limits, declines, conversion, transfer and
mandates are real API and chain results. Simulated by the sandbox: the merchants' charges, the retailers' deposits and
the transfer's final status. The step from Metal to Airwallex is a sandbox deposit that names the real testnet
transaction.

## Instructions

```sh
npm ci && npm run judge
```

No keys and no network after `npm ci`. It serves the recorded run, the CFO dashboard as it stood at the end, `/metal`
(every Metal feature with its testnet proof), `/live` (the day as an animation), `/try` (needs the live link), the
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

- `purser-deck.pdf`: eight slides, made by `npm run submission` from the same figures.
- The zip: `npm run submission` writes `out/submission/purser-source.zip` (`git archive` of the current commit: the
  code, no keys, no ledger). Not committed.
