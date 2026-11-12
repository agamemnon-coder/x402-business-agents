# Jury cheat sheet: Coinbase

For Max, Demo Day (19 November). The questions a juror from Coinbase is most likely to ask, most likely first: x402,
agent wallets and custody. The angle is narrow, so the sheet is short. Each answer is two sentences at most and in line
with [docs/claims.md](../../claims.md); every figure in an answer is in that file or in a run record
(`test/jury-cheat-sheets.test.ts`).

## 1. Do you use x402?

Yes: in the main run the agents sold and bought stock data per query over x402 on Metal testnet, 41 sales and 41 supplier purchases, each its own transaction. All of it with test money.

**Source:** [docs/runs/2026-11-03-main-run-metal-transactions.md](../../runs/2026-11-03-main-run-metal-transactions.md)

## 2. Why x402 for business agents?

The seller checks each payment before it does the work and settles it before it answers, so a query is paid exactly once. x402 leaves the payer's budget to the payer, and that is where Purser and Metal's mandate come in.

**Source:** [README.md](../../../README.md), "Mandate, x402, terms hash, four eyes"

## 3. Does it run on Base?

No: the x402 payments ran on Metal testnet, and we have not run on Base. That is not tested yet.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md)

## 4. What stops an agent draining its wallet?

Each agent's mandate holds a cap per payment, a budget and one payee, and Metal refuses what is over them, as it refused #24. A velocity breach stops the agent and raises an alarm.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md); [docs/controls.md](../../controls.md), I3

## 5. Who holds the keys and the money?

The money stays in the company's own accounts, and Purser holds no funds. Each agent pays with its own mandate key, and no key ever reaches a model.

**Source:** [docs/compliance.md](../../compliance.md); `test/adversarial.test.ts`

## 6. Which stablecoin?

Test USD on Metal testnet, written *USDZ. No real stablecoin has moved.

**Source:** [docs/runs/2026-10-30-clearing-load.md](../../runs/2026-10-30-clearing-load.md)

## 7. How does the company get euros for a supplier?

Through Airwallex: Treasury converts only the shortfall and pays by SWIFT, as in the main run, where EUR 110.00 was bought to pay a EUR 240.00 invoice. That ran in the Airwallex sandbox, with settlement simulated.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md)

## 8. Can an outside agent pay a Purser agent?

Yes: the customer's agent in the main run bought data over x402 under its own mandate, and its signatures settled the dispute later. It was our own simulated customer, not an outside party.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md); [docs/submission/qa.md](../qa.md), question 3
