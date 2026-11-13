# Jury cheat sheet: Visa

For Max, Demo Day (19 November). The questions a juror from Visa is most likely to ask, most likely first: Visa
Intelligent Commerce, card controls, and what Purser adds. Each answer is two sentences at most and in line with
[docs/claims.md](../../claims.md); every figure in an answer is in that file or in a run record
(`test/jury-cheat-sheets.test.ts`). Nothing here is certified by Visa: never suggest it is.

## 1. How do you use Visa Intelligent Commerce?

An agent gets a single-use Visa credential for one purchase, issued through Airwallex's Airi wallet and confirmed by the cardholder's passkey, and pays with it on Airwallex's hosted checkout page. It ran on 7 November in the Airwallex sandbox, with Airi's test card and test money, and passed 5 of 5 checks.

**Source:** [docs/runs/2026-11-07-vic-1.md](../../runs/2026-11-07-vic-1.md)

## 2. What does Purser add to it?

The CFO's policy, applied before Airi is asked: a limit per purchase, the merchants allowed, and Face ID on the exact terms above the limit. A purchase outside the policy is refused before any call, and Airi's own passkey confirmation stays: Purser sits in front of it, not instead of it.

**Source:** [docs/runs/2026-11-07-vic-1.md](../../runs/2026-11-07-vic-1.md); [docs/submission/qa.md](../qa.md), question 26

## 3. Did it work the first time?

No: it passed on the fourth attempt that day, and nothing was charged in the attempts before it. Each failed attempt is in the run log, with what changed after it.

**Source:** [docs/runs/2026-11-07-vic-1.md](../../runs/2026-11-07-vic-1.md), "The attempts before this one"

## 4. What if the terms change after the CFO approves?

They no longer match the signed hash, so they are refused: in our second live run we changed EUR 30.00 to EUR 190.00 after Face ID, as our own labelled test, and it was refused. One changed cent does the same.

**Source:** [docs/runs/2026-11-07-vic-2.md](../../runs/2026-11-07-vic-2.md)

## 5. What happens when an agent goes over its card limit?

Airwallex itself declined a EUR 45.00 purchase on a 30.00 limit with `LIMIT_EXCEEDED`. The agent asked the CFO to raise its limit instead of retrying, and after Face ID the same charge was approved.

**Source:** [docs/runs/2026-11-07-awx-1.md](../../runs/2026-11-07-awx-1.md)

## 6. And a merchant the CFO does not allow?

Airwallex declined a purchase outside the card's merchant category, and the agent asked for no raise, since a higher limit would not help. On the Airi rail, Purser refuses a merchant the CFO does not allow before Airi is called at all.

**Source:** [docs/runs/2026-11-07-awx-1.md](../../runs/2026-11-07-awx-1.md); [docs/runs/2026-11-07-vic-1.md](../../runs/2026-11-07-vic-1.md)

## 7. Why not just use the card's own spend controls?

We use them: each agent's card limit is Airwallex's own control, and on 6 November all 3 cards carried the CFO policy as Airwallex's controls. Purser adds one policy across card and chain, and a signature over the exact terms for each payment beyond the limits.

**Source:** [docs/submission/qa.md](../qa.md), question 13; [docs/runs/airwallex-cards-2026-11-06.json](../../runs/airwallex-cards-2026-11-06.json)

## 8. Do you use the Trusted Agent Protocol?

As an extra: our agents sign their requests to a merchant we run, following the agent-recognition profile of the Trusted Agent Protocol specification, and the merchant checks them against our self-hosted registry. It ran as a dev test on 31 October, not against a registry run by Visa.

**Source:** [docs/runs/2026-10-31-visa-tap-dev.md](../../runs/2026-10-31-visa-tap-dev.md)

## 9. Is the Face ID real?

Max's own Face ID signed the approvals in the awx-1 run on his phone. The server checks the passkey's signature, not the face: attestation is none, so it cannot tell which authenticator made the key.

**Source:** [docs/runs/2026-11-07-awx-1.md](../../runs/2026-11-07-awx-1.md); [docs/submission/qa.md](../qa.md), question 4

## 10. Whose card is it, legally?

Each agent's card sits under a delegate cardholder the business creates under its own Airwallex account, and in the sandbox those cardholders carry placeholder details. Airwallex is the regulated party on the bank side; Purser holds no money.

**Source:** [docs/compliance.md](../../compliance.md), "Roles and money"

## 11. What about chargebacks?

A card chargeback has not run. The disputes we ran were on Metal testnet, where all 12 disputed orders carried the buying agent's own signature, checked from the chain.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md); [docs/submission/qa.md](../qa.md), question 7

## 12. Is any of this real money?

No: every run is in the Airwallex sandbox or on Metal testnet, with test money and test cards. Merchant charges and settlements there are the sandbox's simulation, and we label them so.

**Source:** [docs/runs/README.md](../../runs/README.md)
