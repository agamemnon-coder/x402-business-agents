# Slack-concepten voor Max

Niet zelf plaatsen; Max plaatst dit. Geen link naar de live omgeving in een openbaar kanaal: die alleen per DM.

## 1. Vraag aan de organisatie (Visa Award)

> Hi! Quick question on the Visa Award ("requires use of Visa and Airwallex tooling"). Our agents each pay with their
> own Airwallex-issued Visa card, inside limits the CFO sets. Before paying, each agent signs its request to the
> merchant following the agent-recognition part of Visa's Trusted Agent Protocol spec (RFC 9421 signatures, tags
> agent-browser-auth / agent-payer-auth, 8-minute window, nonce replay block), and the merchant checks it against a
> self-hosted registry. We do not have Visa's directory, ID token or payment container, and we say so.
> 1. Does this count as "Visa tooling" for the Visa Award?
> 2. Can one project be considered for both the Visa Award and the Metal Award?
> Thanks!

## 2. Antwoord aan Man (Metal), met een screenshot van de Dispute desk

Screenshot: `docs/submission/screens/14-dispute.png` (of `5-disputes.png`). De live link alleen per DM.

> Thanks for the Dispute desk idea, Man! We built it: when a customer disputes payments, the seller checks each one
> against the chain (the customer's signed order, its mandate via verifyMandatePayment, first use, the delivery
> record) and code checks each refund against the evidence; Claude writes the explanation. In our run, 12 disputed orders all verified,
> so the claim refunded nothing new (3 had been refunded earlier for wrong data).
> It is now a small open-source example any seller on Metal can use: `examples/metal-dispute-desk` (MIT, 59 tests).
> We also wrote down what we ran into on testnet, with reproductions: `docs/feedback-for-metal-and-airwallex.md`.
> The three biggest: finality certificates can't be fully verified (testnet validator BLS keys aren't published),
> a clearing wallet stays held after a lost answer until the same request is resent, and `between_epochs` pauses
> make up most of our p95 latency. Happy to share more!
