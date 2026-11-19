# Airwallex, deeper: 2026-11-19

`npm run airwallex:deep -- live` (src/cli/airwallexDeep.ts, src/proof/awxDeepLive.ts). The **Airwallex sandbox** only, test money only. The machine-readable record,
with every call's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-19-airwallex-deep-3.json.

**3 of 3 new endpoints answered 2xx.** 5 of 5 calls in the table live, 0 refused. 7 Airwallex calls of a budget of 20 (logins included), 0 answered 429.

Simulated: The customer's bank transfer is made by the sandbox's simulation endpoint (POST /simulation/deposit/create): nobody paid anything. No passkey signs in this run: the revoked transfer carries the hash of its test terms, and the run plays the CFO withdrawing it.

## What each capability showed

1. **Terms checked before the signature; a signed payment withdrawn before its day.** Airwallex accepted the exact terms (EUR 1.00 to Bergtex Textil GmbH, reference AWXDEEP-155842, request_id `a9fffb43-283b-42f4-b33e-3b71034feb5d`, terms hash `037b58f3c036ca0b…`) through transfers/validate. Created for 2026-11-22: transfer `45381b57-ec1c-4e15-b1cb-7cb0d2a2b854`, SCHEDULED. Read first: SCHEDULED; cancelled; read back: **CANCELLED**.
2. **The seller side.** not run
3. **An agent card's headroom.** not run
4. **The wallet statement.** 94 lines posted 08:49–08:53 UTC (the soak run). Continuity: 92 of 92 links add up. The soak record's payouts and conversion legs: **42 of 42 on the statement to the cent**. 35 fee line(s), reported beside the payouts; 12 conversion hold and release line(s), read with the amount's sign inverted (src/airwallex/balanceHistory.ts, HOLD_SIGN_INVERTED).
5. **Clean-up.** not run (see the table)

## Every endpoint call

| Capability | Endpoint | New | Function | HTTP | Live | What happened | Id | Our request_id | Airwallex trace id (x-b3-traceid) |
|---|---|---|---|---|---|---|---|---|---|
| 1 validate and revoke | `POST /transfers/validate` | new | validateTransfer (src/airwallex/transferRevoke.ts) | 200 | **yes** | Airwallex accepted the exact terms (EUR 1.00 to Bergtex Textil GmbH, SWIFT, for 2026-11-22) without creating a transfer | – | `a9fffb43-283b-42f4-b33e-3b71034feb5d` | `04f051d660bc4340b700e09c47a62ce7` |
| 1 validate and revoke | `POST /transfers/create` |  | createScheduledTransfer (src/airwallex/transferRevoke.ts) | 201 | **yes** | created for 2026-11-22: SCHEDULED | `45381b57-ec1c-4e15-b1cb-7cb0d2a2b854` | `a9fffb43-283b-42f4-b33e-3b71034feb5d` | `b738a736aed74808834c862ca8f0d4a8` |
| 1 validate and revoke | `GET /transfers/{id}` |  | revokeScheduledTransfer (src/airwallex/transferRevoke.ts) | 200 | **yes** | read first: SCHEDULED; the cancel answered 2xx; read back: CANCELLED | `45381b57-ec1c-4e15-b1cb-7cb0d2a2b854` | `a9fffb43-283b-42f4-b33e-3b71034feb5d` | `a57f21d004d2402eb9362c6c6d5be6e7` |
| 1 validate and revoke | `POST /transfers/{id}/cancel` | new | revokeScheduledTransfer (src/airwallex/transferRevoke.ts) | 200 | **yes** | read first: SCHEDULED; the cancel answered 2xx; read back: CANCELLED | `45381b57-ec1c-4e15-b1cb-7cb0d2a2b854` | `a9fffb43-283b-42f4-b33e-3b71034feb5d` | `f3ec723a3c8b4333bbf421f098d677b4` |
| 4 balance history | `GET /balances/history` | new | listBalanceHistory (src/airwallex/balanceHistory.ts) | 200 | **yes** | 94 statement line(s) posted 08:49–08:53 UTC | – | – | `6dede0bd94dd4edc90636a4a57c7663b` |

## Every call (UTC; no body, header, token or key)

| # | Time | Call | HTTP | Airwallex request id | Trace id |
|---|---|---|---|---|---|
| 1 | 15:58:42.204 | `POST /authentication/login` | 201 | – | `8764e514494548e6bbc15698463f0d75` |
| 2 | 15:58:42.975 | `POST /transfers/validate` | 200 | – | `04f051d660bc4340b700e09c47a62ce7` |
| 3 | 15:58:43.813 | `POST /transfers/create` | 201 | – | `b738a736aed74808834c862ca8f0d4a8` |
| 4 | 15:58:44.822 | `GET /transfers/{id}` | 200 | – | `f4cbe41ffc8e46f889fa6cd07f58a6d4` |
| 5 | 15:58:45.246 | `POST /transfers/{id}/cancel` | 200 | – | `f3ec723a3c8b4333bbf421f098d677b4` |
| 6 | 15:58:45.795 | `GET /transfers/{id}` | 200 | – | `a57f21d004d2402eb9362c6c6d5be6e7` |
| 7 | 15:58:46.108 | `GET /balances/history` | 200 | – | `6dede0bd94dd4edc90636a4a57c7663b` |

## What this does not show

- One run each: not every branch around each call. The unit tests (test/airwallex-deep.test.ts) cover the refusals and edge cases on stand-ins.
- The customer's payment is the sandbox's simulation, not a bank's; the payment link was not paid (its checkout is a browser page), it was switched off once the invoice was paid by the simulated transfer.
- The revoked transfer was never signed with a passkey: it shows Airwallex's side (SCHEDULED, then cancelled), not the CFO's withdrawal screen.
- `POST /hosted_flows/{id}/authorize` stays not live: it needs Airwallex's onboarding template id, which this sandbox account was never issued (docs/runs/2026-11-19-airwallex-coverage.md).
