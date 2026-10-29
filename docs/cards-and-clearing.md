# Company cards, clearing and the simulated month

Moved from the project README. Back to the [README](../README.md).

## Company cards (Airwallex Issuing)

| Agent | Card | Per purchase | Per month | Buys |
|---|---|---|---|---|
| sourcing | virtual Visa | 30.00 EUR | 100.00 EUR | market data (Packwise) |
| support | virtual Visa | 60.00 EUR | 150.00 EUR | helpdesk seats (Adwave) |
| treasury | virtual Visa | 25.00 EUR | 50.00 EUR | bookkeeping software (Ledgerly) |

The merchants are fictional (Microsoft's sample company names).

- **Issued and synced.** `npm run cards -- setup` gives each agent a DELEGATE cardholder and a virtual Visa card.
  It sets the card's per-purchase and monthly limits to the CFO policy's `card.<agent>.per_tx` and
  `card.<agent>.monthly`. The runner checks every few seconds that each card at Airwallex still has the policy's
  limits, and it trusts what Airwallex reads back, not what it asked for.
- **The card is the guardrail.** The agent does not check its own limit before buying, on purpose: even an agent that
  ignores its policy cannot spend past the card. `npm run cards -- buy packwise-pro` (45.00 EUR on a 30.00 card)
  is declined by Airwallex with `LIMIT_EXCEEDED`. The decline is in the audit log and shown red on the dashboard.
- **A raise needs Face ID.** `npm run cards -- raise sourcing 50.00 --reason "…"` is the agent asking. It is an
  ordinary policy change, approved on the phone. Once it runs, the card at Airwallex gets the new limit, and the same
  purchase goes through. On the phone the CFO can only lower a card limit; a raise always comes as a proposal.
- **Every authorisation is recorded once**, by Airwallex's card transaction id, whichever source sees it first:
  - our own (simulated) charge;
  - the runner's poll;
  - an Airwallex webhook to the relay. The webhook's HMAC signature is checked on the relay and again on the runner
    (`npm run cards -- webhook` subscribes, and the secret never reaches the screen).
- **Honest limits.** In the sandbox the merchant's charge is Airwallex's simulation endpoint, but the approve or
  decline is Airwallex's own. The card number and CVV never leave Airwallex: no call asks for them, and the ledger
  keeps the last four digits.

Run log: [docs/runs/2026-10-29-cards.md](runs/2026-10-29-cards.md).

## Selling by Metal clearing (prepaid, new on testnet)

Metal's [Offer Pay-per-Call Clearing](https://docs.metalntwx.com/agents/clearing) went live on testnet in October
2026. Summit deposits *USDZ once and pays each 0.07 query with a signed running total. Metal's clearing service
issues a receipt and certifies the totals on chain each epoch, so there is no transaction per query.

- **Two routes.**
  - `/v1/stock/prepaid` takes clearing only.
  - `/v1/stock` stays as it was: exact, under Summit's mandate, with its signed order.
  - Summit tries clearing first. It falls back to the mandate route whenever clearing took nothing, so a sale never
    depends on the new scheme. It never pays a tick a second way when a clearing payment may have been counted.
- **Offered only when we can deliver.** Seen live: a clearing payment is counted when the buyer makes it, before the
  seller can refuse. So before the prepaid route makes an offer, the operations agent checks the supplier's price
  against its mandate and the CFO policy, for free. If that check fails, the answer is 503 "not offered" and nobody
  pays.
- **On the dashboard,** the prepaid clearing budget is shown apart from the mandates.
- **`npm run verify`** checks every clearing sale's signed payment again with Metal's service.
- **Commands:** `npm run clearing -- deposit 5.00 | buy <from> <to> | withdraw`. Earnings leave clearing once their
  epoch is final, about 20 minutes later.
- Run log: [docs/runs/2026-10-29-clearing.md](runs/2026-10-29-clearing.md).

## A month in 90 seconds (simulated)

`npm run dashboard` and the relay serve `/month`. A seeded month at small-business scale replays in 90 seconds:
about 5,000 queries on weekdays, the supplier's price rise on day 9, the card declines, a fake invoice, a planted
instruction and the bills.

- **At the top:** what the agents did alone, what waits for the CFO, and what was blocked.
- **Below that:** the company's net day by day, and a P&L per agent:
  - what the agent earned;
  - what it spent over x402;
  - its company card spend;
  - FX and fees;
  - AI cost, priced from the tokens each call used in rehearsal 3.
- **The bills Airwallex paid** are listed under the agents.

The decisions in the simulation come from the live build's code:
- refund routing;
- the price-rise options;
- the invoice fraud check on the real allowlist;
- the card limits as Airwallex applied them.

The CFO's decisions are scripted and marked "CFO (simulated)". The data sits inside the page, so the replay needs no
network once loaded. `/month?at=end` shows the finished month. Code: `src/sim/month.ts`, `src/dashboard/month.html`.

