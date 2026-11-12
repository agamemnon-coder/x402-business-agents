# Airwallex's own approval workflow as a second lock, and money in by card

## Two independent locks on every payout

Purser already lets an agent's payout go out only after the CFO approves the exact terms with Face ID. Airwallex has
its own lock as well, which Purser does not control. In the Airwallex web app (Transfers > Transfer approvals), set
"Require API-initiated transfers to go through the same approval workflow?" to Yes.

From then on, every transfer Purser creates waits at Airwallex as `IN_APPROVAL`. A person at Airwallex then decides:

- approves it in the web app: `SCHEDULED` in Airwallex's documentation, and it pays as normal (in our sandbox run the
  first read after the approval showed `PROCESSING`);
- rejects it: `APPROVAL_REJECTED`;
- recalls it: `APPROVAL_RECALLED`;
- or nobody can approve it, because the workflow finds no next approver: `APPROVAL_BLOCKED`.

Source: airwallex.com/docs/payouts/transfers/manage-transfers/manage-approvals-for-transfers. Airwallex's advice is that
whoever submits the transfer should not also be an approver. Purser's API key submits it, so the Airwallex approver is a
person in the web app, not Purser.

A payout then needs two separate approvals. The CFO signs the exact terms with Face ID in Purser, and a person approves
it at Airwallex. Neither one can pay alone.

## What Purser does with it (`src/airwallex/approvals.ts`, `src/executors/invoicePayment.ts`)

- **When the transfer comes back `IN_APPROVAL`:** Purser records it as "waiting for Airwallex approval"
  (`transfer.awaiting_airwallex_approval` in the audit log). Its own part ends there: the proposal is `EXECUTED` with
  `waiting_for: "Airwallex approval"`. In the sandbox it does not simulate the transfer past that wait.
- **Following it:** `followTransfer` reads the transfer back by id and records each new status (`SCHEDULED`, then `PAID`;
  or a rejection, recall or block, each shown as "not paid"). It only reads: it never approves, simulates or resends.
- **Never sent twice:** the ledger row stays live while the transfer waits or after a rejection, so the
  one-payout-per-invoice rule refuses a second payout for that invoice.
- **Terms changed at Airwallex:** a rejected transfer can be edited and resubmitted in the web app. If the amount at
  Airwallex no longer matches what the CFO signed, Purser raises `transfer.terms_changed_at_airwallex` instead of
  booking it.
- **Webhooks:** Purser subscribes to `payout.transfer.in_approval`, `approval_rejected`, `approval_recalled` and
  `approval_blocked`. A rejection or recall that arrives when the ledger says paid is a disagreement and raises an alarm.

Tests: `test/airwallex-approvals.test.ts`.

Run live in the Airwallex sandbox on 10 and 12 November 2026, with test money (records:
[10 November](runs/2026-11-10-airwallex-two-locks.md), [12 November](runs/2026-11-12-airwallex-two-locks-paid.md)).
Transfer `4074d684-4704-406c-a527-2832753baf4f` (EUR 240.00) waited `IN_APPROVAL` from 10 November until the owner
approved it in Airwallex's sandbox web app on 12 November. The next read showed `PROCESSING`, and Airwallex's sandbox
simulation endpoint then moved it to `SENT` and `PAID`.

What that run does not show: Purser's lock was signed by a labelled virtual test passkey, not by a real Face ID; the
person approved only at Airwallex; `SENT` and `PAID` came from the sandbox's simulation endpoints (settlement
simulated).

The setting is the owner's to switch on in the web app. With it on, every sandbox payout also needs a person to approve
it there, including during a live demo.

## Money in by card (`src/airwallex/acceptance.ts`)

Airwallex enabled payment acceptance on our sandbox on 10 November. With `AIRWALLEX_PAYMENT_ACCEPTANCE=on`, a customer
can pay a Northwind invoice by card, and Purser books it as follows:

1. It creates a PaymentIntent for the invoice's open amount, with the invoice number as `merchant_order_id`.
2. It confirms the PaymentIntent with a documented sandbox test card. No other card number is accepted.
3. It reads the PaymentIntent back and books it only if Airwallex says `SUCCEEDED`.

Booking goes through the receivables agent, so it is matched by invoice number and recorded once per PaymentIntent.
Anything short, over or in another currency is escalated to the CFO. Every step is in the hash-chained audit log,
marked test money. A `payment_intent.succeeded` webhook books the same way, and only when the flag is on.

Live sandbox run: [docs/runs/2026-11-10-payment-acceptance-sandbox.md](runs/2026-11-10-payment-acceptance-sandbox.md),
PaymentIntent `int_sgpv9bnppho0sezgl4a`, `SUCCEEDED`, EUR 24.90, 4 calls.

Tests: `test/payment-acceptance.test.ts`.
