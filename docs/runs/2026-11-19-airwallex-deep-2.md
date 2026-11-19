# Airwallex, deeper: 2026-11-19

`npm run airwallex:deep -- live` (src/cli/airwallexDeep.ts, src/proof/awxDeepLive.ts). The **Airwallex sandbox** only, test money only. The machine-readable record,
with every call's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-19-airwallex-deep-2.json.

**3 of 3 new endpoints answered 2xx.** 6 of 6 calls in the table live, 0 refused. 7 Airwallex calls of a budget of 20 (logins included), 0 answered 429.

Simulated: The customer's bank transfer is made by the sandbox's simulation endpoint (POST /simulation/deposit/create): nobody paid anything. No passkey signs in this run: the revoked transfer carries the hash of its test terms, and the run plays the CFO withdrawing it.

## What each capability showed

1. **Terms checked before the signature; a signed payment withdrawn before its day.** The transfer an earlier pass scheduled, `c7e7d59b-e04e-40b7-b440-a67d3d259aba`: read first (not read); not cancelled (see the table).
2. **The seller side.** not run
3. **An agent card's headroom.** Card `f46783c9-a17c-4095-801f-aa258fb79e4b` (support agent: helpdesk software (857fe1)): PER_TRANSACTION EUR 60.00 left of EUR 60.00; MONTHLY EUR 150.00 left of EUR 150.00; spendable in one go EUR 60.00; 0 pending hold(s), EUR 0.00. Against Purser's limits (EUR 60.00 per transaction, EUR 150.00 a month): agree.
4. **The wallet statement.** 94 lines posted 08:49–08:53 UTC (the soak run). Continuity: 81 of 92 links add up (11 break(s), listed in the JSON). The soak record's payouts and conversion legs: **42 of 42 on the statement to the cent**. 35 fee line(s), reported beside the payouts.
5. **Clean-up.** not run (see the table)

## Every endpoint call

| Capability | Endpoint | New | Function | HTTP | Live | What happened | Id | Our request_id | Airwallex trace id (x-b3-traceid) |
|---|---|---|---|---|---|---|---|---|---|
| 1 validate and revoke | `GET /transfers/{id}` |  | revokeScheduledTransfer, the transfer the first pass scheduled (src/airwallex/transferRevoke.ts) | 200 | **yes** | this call answered 200; the step failed after it: transfer c7e7d59b-e04e-40b7-b440-a67d3d259aba is CANCELLED, not SCHEDULED: Purser cancels only a payment that has not started; nothing was cancelled | – | – | `750d3c0e617147d484745cadf53bd355` |
| 3 agent card headroom | `GET /issuing/cards` |  | the newest ACTIVE agent card (GET /issuing/cards, src/proof/awxDeepLive.ts) | 200 | **yes** | 19 ACTIVE card(s) | – | – | `808b0f7dc2ef4313960353f03726f917` |
| 3 agent card headroom | `GET /issuing/cards/{id}` |  | the card's limits as Purser set them (GET /issuing/cards/{id}, src/proof/awxDeepLive.ts) | 200 | **yes** | support agent: helpdesk software (857fe1): EUR 60.00 per transaction, EUR 150.00 a month | `f46783c9-a17c-4095-801f-aa258fb79e4b` | – | `f158e65ee89b4f438e7bbcf79643e4e5` |
| 3 agent card headroom | `GET /issuing/cards/{id}/limits` | new | cardRemainingLimits (src/airwallex/cardHeadroom.ts) | 200 | **yes** | PER_TRANSACTION EUR 60.00 of 60.00 left; MONTHLY EUR 150.00 of 150.00 left | `f46783c9-a17c-4095-801f-aa258fb79e4b` | – | `04d7bfc7b491433d9b3a0c1f78ff78ac` |
| 3 agent card headroom | `GET /issuing/authorizations` | new | cardAuthorizations (src/airwallex/cardHeadroom.ts) | 200 | **yes** | 1 authorisation(s) in 30 days, 0 PENDING | `f46783c9-a17c-4095-801f-aa258fb79e4b` | – | `6ad5572809c542608ae41409344ed93e` |
| 4 balance history | `GET /balances/history` | new | listBalanceHistory (src/airwallex/balanceHistory.ts) | 200 | **yes** | 94 statement line(s) posted 08:49–08:53 UTC | – | – | `0d4a0d2deb544222867748bc85ce9802` |

## Every call (UTC; no body, header, token or key)

| # | Time | Call | HTTP | Airwallex request id | Trace id |
|---|---|---|---|---|---|
| 1 | 15:57:34.929 | `POST /authentication/login` | 201 | – | `fd6942d564664af9a365d3137f9a9a2b` |
| 2 | 15:57:35.879 | `GET /transfers/{id}` | 200 | – | `750d3c0e617147d484745cadf53bd355` |
| 3 | 15:57:36.369 | `GET /issuing/cards` | 200 | – | `808b0f7dc2ef4313960353f03726f917` |
| 4 | 15:57:36.716 | `GET /issuing/cards/{id}` | 200 | – | `f158e65ee89b4f438e7bbcf79643e4e5` |
| 5 | 15:57:37.037 | `GET /issuing/cards/{id}/limits` | 200 | – | `04d7bfc7b491433d9b3a0c1f78ff78ac` |
| 6 | 15:57:37.388 | `GET /issuing/authorizations` | 200 | – | `6ad5572809c542608ae41409344ed93e` |
| 7 | 15:57:37.734 | `GET /balances/history` | 200 | – | `0d4a0d2deb544222867748bc85ce9802` |

## What this does not show

- One run each: not every branch around each call. The unit tests (test/airwallex-deep.test.ts) cover the refusals and edge cases on stand-ins.
- The customer's payment is the sandbox's simulation, not a bank's; the payment link was not paid (its checkout is a browser page), it was switched off once the invoice was paid by the simulated transfer.
- The revoked transfer was never signed with a passkey: it shows Airwallex's side (SCHEDULED, then cancelled), not the CFO's withdrawal screen.
- `POST /hosted_flows/{id}/authorize` stays not live: it needs Airwallex's onboarding template id, which this sandbox account was never issued (docs/runs/2026-11-19-airwallex-coverage.md).
