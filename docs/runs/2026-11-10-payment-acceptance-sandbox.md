# Money in by card: Airwallex payment acceptance, sandbox run, 10 November 2026

Airwallex enabled payment acceptance on our sandbox account on 10 November. This run checks the first live pass of
`src/airwallex/acceptance.ts`: a test customer pays one Northwind invoice by card, and Purser books it only after
Airwallex reports the PaymentIntent `SUCCEEDED`.

Sandbox only, test money, Airwallex's documented success test card (`4035501000000008`, from
airwallex.com/docs/payments/test-and-go-live/test-card-numbers). No real card was used. Nobody was paid out.

- Command: `AIRWALLEX_PAYMENT_ACCEPTANCE=on AIRWALLEX_CALL_BUDGET=15 npm run card-payment -- NW-R-PA1`, with a throwaway ledger.
- Call budget: 15 approved, **4 used**.
- Invoice: NW-R-PA1, Fjord & Fell Outfitters (a test customer), EUR 24.90.

## Every call (UTC; no tokens, bodies or card data)

| # | Time | Call | Answer |
|---|---|---|---|
| 1 | 05:15:55.949 | `POST /api/v1/authentication/login` | 200 |
| 2 | 05:15:56.787 | `POST /api/v1/pa/payment_intents/create` (EUR 24.90, merchant_order_id NW-R-PA1) | 200, `int_sgpv9bnppho0sezgl4a`, `REQUIRES_PAYMENT_METHOD` |
| 3 | 05:15:57.469 | `POST /api/v1/pa/payment_intents/int_sgpv9bnppho0sezgl4a/confirm` (test card, auto capture) | 200 |
| 4 | 05:15:58.542 | `GET /api/v1/pa/payment_intents/int_sgpv9bnppho0sezgl4a` | 200, `SUCCEEDED`, card ending 0008 |

The call log's endpoint column shows `/pa/{id}/create`, because the logger's id pattern also matches the word
`payment_intents`. The real paths are the ones in the table.

## What Purser did with it

- Booked the receipt only from the status it read back in call 4, not from the confirm's answer.
- Matched it to NW-R-PA1 by `merchant_order_id`: `MATCHED`, invoice paid in full, EUR 24.90. Recorded once, under the
  PaymentIntent id. A later `payment_intent.succeeded` webhook for the same id changes nothing.
- Wrote three rows to the hash-chained audit log (`payment_acceptance.created`, `receivable.matched`,
  `payment_acceptance.succeeded`). Each carries `test_money: true`, and the chain verified: 3 rows, ok.

## What this run does not show

- No webhook was received. The webhook path (`payment_intent.succeeded`) is covered by tests only.
- No settlement of the card money into the Airwallex wallet was checked.
- No decline was tested live. The decline path is covered by tests only.
