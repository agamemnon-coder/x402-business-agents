# Jury cheat sheet: Metal

For Max, Demo Day (19 November). The questions a juror from Metal is most likely to ask, most likely first: mandates,
what ran on chain, and what has not run yet. Each answer is two sentences at most and in line with
[docs/claims.md](../../claims.md); every figure in an answer is in that file or in a run record
(`test/jury-cheat-sheets.test.ts`). Everything on Metal is testnet and test money.

## 1. Why Metal?

Because the limit then lives outside our code: each agent's Metal mandate holds its cap, its budget and its payee. With our own check switched off once, Metal refused #24 itself, and the refusal is on chain.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md); [docs/submission/qa.md](../qa.md), question 30

## 2. What ran on Metal?

In the main run: 86 payments, each its own transaction (41 sales over x402, 41 supplier purchases, 3 refunds and 1 sweep), plus 6 mandate transactions and the refusal of #24. All of it on testnet, every id listed on the site and checkable on the explorer.

**Source:** [docs/runs/2026-11-03-main-run-metal-transactions.md](../../runs/2026-11-03-main-run-metal-transactions.md); [docs/submission/qa.md](../qa.md), question 3

## 3. Was the refusal of #24 staged?

Letting it through was, and we say so: we switched off our own check once to prove the chain holds the line. Purser refuses an over-cap purchase before signing, and with that check off for #24, Metal refused it anyway.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md), acceptance row 5

## 4. What do the mandates hold?

A cap per payment for each agent (Sourcing 0.03, Support 0.10, Treasury 6.00) and a budget, the three budgets held to 20.00 test USD in total. Each mandate names one payee, so an agent cannot pay anyone else.

**Source:** [docs/claims.md](../../claims.md); `src/config/policy.ts`

## 5. How much load did you put through Metal?

A separate load run pushed 2,000 clearing payments from 16 wallets through Metal's clearing on testnet. Throughput, latency and cost are in its run log.

**Source:** [docs/runs/2026-10-30-clearing-load.md](../../runs/2026-10-30-clearing-load.md)

## 6. How do disputes use the chain?

A customer disputed 12 orders, and the chain showed that all 12 carried the buying agent's own signature, so the claim that they were never placed failed. Support refunded the 3 with wrong data as mandate pulls, and the CFO rejected the rest with Face ID.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md); [docs/submission/qa.md](../qa.md), question 7

## 7. Are invoice tokens live on Metal?

Not yet: the token contract is built and tested on an in-memory chain, and the live run on Metal testnet is pending. A CFO-approved invoice becomes one token, financed at a discount and settled to whoever holds it.

**Source:** [docs/tokenize.md](../../tokenize.md)

## 8. What about money from unknown senders?

Metal's receive policy holds it in quarantine, and the CFO returns or accepts it with Face ID. That ran live on testnet in a separate world on 30 October; it was not set in the main run.

**Source:** [docs/compliance.md](../../compliance.md), section 1

## 9. Can anyone check the payments?

Yes: every Metal id is on the site's Metal page and on the testnet explorer, and the data check compared every payment of the main run with the chain one by one. The repository's verify command checks the published record offline.

**Source:** [docs/runs/2026-11-03-main-run-data-qa.md](../../runs/2026-11-03-main-run-data-qa.md)

## 10. What if Metal's RPC goes down?

The quarantine poll records nothing and keeps its place, so a held payment is found once the RPC is back. For the token run, a transaction is recorded before it is sent, and after an outage the same signed bytes are offered once, never a second payment.

**Source:** `test/chaos.test.ts`; `test/chaos-partners.test.ts`; `test/tokenize-live.test.ts`

## 11. Why x402 on Metal?

x402 lets an agent pay per data query over HTTP, and the seller checks each payment before it does the work. The protocol leaves the payer's budget to the payer, and Metal's mandate is what holds it.

**Source:** [README.md](../../../README.md), "Mandate, x402, terms hash, four eyes"

## 12. Is anything on mainnet?

No: testnet and test money only. We would move only after a real second approver, keys in a KMS and the other production basics are in place.

**Source:** [docs/business/roadmap.md](../../business/roadmap.md); [docs/security.md](../../security.md)
