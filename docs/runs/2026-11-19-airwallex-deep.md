# Airwallex, deeper: 2026-11-19

`npm run airwallex:deep -- live` (src/cli/airwallexDeep.ts, src/proof/awxDeepLive.ts). The **Airwallex sandbox** only, test money only. The machine-readable record,
with every call's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-19-airwallex-deep.json.

**8 of 9 new endpoints answered 2xx.** 14 of 15 calls in the table live, 1 refused. 17 Airwallex calls of a budget of 40 (logins included), 0 answered 429.

Simulated: The customer's bank transfer is made by the sandbox's simulation endpoint (POST /simulation/deposit/create): nobody paid anything. No passkey signs in this run: the revoked transfer carries the hash of its test terms, and the run plays the CFO withdrawing it.

## What each capability showed

1. **Terms checked before the signature; a signed payment withdrawn before its day.** Airwallex accepted the exact terms (EUR 1.00 to Bergtex Textil GmbH, reference AWXDEEP-155521, request_id `a1a38646-4f43-462e-a7c5-743411cf38fb`, terms hash `af1cdd72a99e777f…`) through transfers/validate. Created for 2026-11-22: transfer `c7e7d59b-e04e-40b7-b440-a67d3d259aba`, SCHEDULED. The cancel: Airwallex answered 400 service_unavailable; the transfer was not cancelled.
2. **The seller side.** Open receivable NW-AR-155521 (Alpenhof Sport AG, EUR 312.50, due 2026-12-19). Payment link `05845896-8f23-46de-b6a7-5f208d23e6aa`: read back as exactly the invoice. The sandbox simulated the customer's transfer (deposit `6dbf1889-c25e-4d49-94b6-fdafea2cc888`). On the EUR Global Account's own statement: `6dbf1889-c25e-4d49-94b6-fdafea2cc888`, EUR 312.50, SETTLED. The receivables agent: **MATCHED** (NW-AR-155521 from Alpenhof Sport AG paid in full, 312.50 EUR). Link switched off: active false. On the wallet statement: DEPOSIT +EUR 312.50 (balance after EUR 9803243.24).
3. **An agent card's headroom.** not run
4. **The wallet statement.** 94 lines posted 08:49–08:53 UTC (the soak run). Continuity: 81 of 92 links add up (11 break(s), listed in the JSON). The soak record's payouts and conversion legs: **42 of 42 on the statement to the cent**. 35 fee line(s), reported beside the payouts.
5. **Clean-up.** The AUD Global Account `9d19f0a2-983e-4ea5-8420-23f3acadc71c` the coverage check opened this morning: ACTIVE, closed, read back **CLOSED**.

## Every endpoint call

| Capability | Endpoint | New | Function | HTTP | Live | What happened | Id | Our request_id | Airwallex trace id (x-b3-traceid) |
|---|---|---|---|---|---|---|---|---|---|
| 1 validate and revoke | `POST /transfers/validate` | new | validateTransfer (src/airwallex/transferRevoke.ts) | 200 | **yes** | Airwallex accepted the exact terms (EUR 1.00 to Bergtex Textil GmbH, SWIFT, for 2026-11-22) without creating a transfer | – | `a1a38646-4f43-462e-a7c5-743411cf38fb` | `b6d7664e25984167aed3da01ed91c135` |
| 1 validate and revoke | `POST /transfers/create` |  | createScheduledTransfer (src/airwallex/transferRevoke.ts) | 201 | **yes** | created for 2026-11-22: SCHEDULED | `c7e7d59b-e04e-40b7-b440-a67d3d259aba` | `a1a38646-4f43-462e-a7c5-743411cf38fb` | `38a3bdb67b6f42968ce7041c9e7c2178` |
| 1 validate and revoke | `GET /transfers/{id}` |  | revokeScheduledTransfer (src/airwallex/transferRevoke.ts) | 200 | **yes** | Airwallex answered 400 service_unavailable | – | `a1a38646-4f43-462e-a7c5-743411cf38fb` | `13ffdcba840c4648bbf5b1bd01f3a59f` |
| 1 validate and revoke | `POST /transfers/{id}/cancel` | new | revokeScheduledTransfer (src/airwallex/transferRevoke.ts) | 400 `service_unavailable` | no | Airwallex answered 400 service_unavailable | – | `a1a38646-4f43-462e-a7c5-743411cf38fb` | `9496acfefae748498b5b52af9a9f8cab` |
| 2 receivable: link, arrival, match | `POST /pa/payment_links/create` | new | createInvoiceLink (src/airwallex/paymentLinks.ts) | 201 | **yes** | a single-use link for EUR 312.50, reference NW-AR-155521, active | `05845896-8f23-46de-b6a7-5f208d23e6aa` | – | `fce33a40cd124a8a95bb4123ee45fc88` |
| 2 receivable: link, arrival, match | `GET /pa/payment_links/{id}` | new | getLink (src/airwallex/paymentLinks.ts) | 200 | **yes** | read back: exactly the invoice (amount, currency, reference, single use) | `05845896-8f23-46de-b6a7-5f208d23e6aa` | – | `16a9206e8f9845518b741562f3fe3c93` |
| 2 receivable: link, arrival, match | `GET /global_accounts` |  | the EUR Global Account (GET /global_accounts, src/proof/awxDeepLive.ts) | 200 | **yes** | 4 ACTIVE Global Accounts | – | – | `7e391520324341c3bb83f06d7060d346` |
| 2 receivable: link, arrival, match | `POST /simulation/deposit/create` |  | simulateDeposit (src/airwallex/deposits.ts; the sandbox's simulation) | 201 | **yes** | SIMULATED by the sandbox: EUR 312.50 from Alpenhof Sport AG, reference NW-AR-155521 (PENDING) | `6dbf1889-c25e-4d49-94b6-fdafea2cc888` | – | `13bc5397fb3441cdbd572bd03b44ff55` |
| 2 receivable: link, arrival, match | `GET /global_accounts/{id}/transactions` | new | listGlobalAccountTransactions (src/airwallex/globalAccountTx.ts) | 200 | **yes** | 1 transaction(s) on the EUR account in the window; one arrival with this amount, currency and the payer's reference or name | `6dbf1889-c25e-4d49-94b6-fdafea2cc888` | – | `930edec5212442b099e4fac74ed12b2c` |
| 2 receivable: link, arrival, match | `POST /pa/payment_links/{id}/deactivate` | new | retireLink (src/airwallex/paymentLinks.ts) | 200 | **yes** | the invoice is PAID: link deactivated (active: false) | `05845896-8f23-46de-b6a7-5f208d23e6aa` | – | `4b95821e24244439b6227becb9464b64` |
| 3 agent card headroom | `GET /issuing/cards` |  | the newest ACTIVE agent card (GET /issuing/cards, src/proof/awxDeepLive.ts) | 200 | **yes** | 19 ACTIVE card(s) | – | – | `e0db0cb58c9040119e2606f18d5fa410` |
| 4 balance history | `GET /balances/history` | new | listBalanceHistory (src/airwallex/balanceHistory.ts) | 200 | **yes** | 94 statement line(s) posted 08:49–08:53 UTC | – | – | `6f0a7108bad14e3d8f5dcc2291e7922a` |
| 4 balance history | `GET /balances/history` | new | listBalanceHistory, this run's window (src/airwallex/balanceHistory.ts) | 200 | **yes** | 1 line(s) in this run's window; the deposit: DEPOSIT EUR 312.50, balance after EUR 9803243.24; 0 under the cancelled transfer | – | – | `e03e7aa6a97f42e3ab607cead3f8bd5c` |
| 5 clean-up | `GET /global_accounts/{id}` | new | closeUnusedGlobalAccount (src/airwallex/globalAccountTx.ts) | 200 | **yes** | was ACTIVE (AUD); closed; read back: CLOSED | `9d19f0a2-983e-4ea5-8420-23f3acadc71c` | – | `515e35bb3e6a40f9879fe33096a2145b` |
| 5 clean-up | `POST /global_accounts/{id}/close` | new | closeUnusedGlobalAccount (src/airwallex/globalAccountTx.ts) | 200 | **yes** | was ACTIVE (AUD); closed; read back: CLOSED | `9d19f0a2-983e-4ea5-8420-23f3acadc71c` | – | `ca0d7388610a4193b62685249e5b4a53` |

## Every call (UTC; no body, header, token or key)

| # | Time | Call | HTTP | Airwallex request id | Trace id |
|---|---|---|---|---|---|
| 1 | 15:55:22.031 | `POST /authentication/login` | 201 | – | `520cfd92169944d4b6ca5a2f27ecfc01` |
| 2 | 15:55:22.821 | `POST /transfers/validate` | 200 | – | `b6d7664e25984167aed3da01ed91c135` |
| 3 | 15:55:23.724 | `POST /transfers/create` | 201 | – | `38a3bdb67b6f42968ce7041c9e7c2178` |
| 4 | 15:55:25.070 | `GET /transfers/{id}` | 200 | – | `13ffdcba840c4648bbf5b1bd01f3a59f` |
| 5 | 15:55:25.384 | `POST /transfers/{id}/cancel` | 400 `service_unavailable` | – | `9496acfefae748498b5b52af9a9f8cab` |
| 6 | 15:55:26.094 | `POST /pa/payment_links/create` | 201 | – | `fce33a40cd124a8a95bb4123ee45fc88` |
| 7 | 15:55:26.548 | `GET /pa/payment_links/{id}` | 200 | – | `16a9206e8f9845518b741562f3fe3c93` |
| 8 | 15:55:26.863 | `GET /global_accounts` | 200 | – | `7e391520324341c3bb83f06d7060d346` |
| 9 | 15:55:27.235 | `POST /simulation/deposit/create` | 201 | – | `13bc5397fb3441cdbd572bd03b44ff55` |
| 10 | 15:55:28.051 | `GET /global_accounts/{id}/transactions` | 200 | – | `930edec5212442b099e4fac74ed12b2c` |
| 11 | 15:55:28.396 | `POST /pa/payment_links/{id}/deactivate` | 200 | – | `4b95821e24244439b6227becb9464b64` |
| 12 | 15:55:28.710 | `GET /issuing/cards` | 200 | – | `e0db0cb58c9040119e2606f18d5fa410` |
| 13 | 15:55:29.058 | `GET /balances/history` | 200 | – | `6f0a7108bad14e3d8f5dcc2291e7922a` |
| 14 | 15:55:29.659 | `GET /balances/history` | 200 | – | `e03e7aa6a97f42e3ab607cead3f8bd5c` |
| 15 | 15:55:30.024 | `GET /global_accounts/{id}` | 200 | – | `6799711d0bd94159b4f3e1a2c7ea1cf9` |
| 16 | 15:55:30.398 | `POST /global_accounts/{id}/close` | 200 | – | `ca0d7388610a4193b62685249e5b4a53` |
| 17 | 15:55:31.103 | `GET /global_accounts/{id}` | 200 | – | `515e35bb3e6a40f9879fe33096a2145b` |

## What this does not show

- One run each: not every branch around each call. The unit tests (test/airwallex-deep.test.ts) cover the refusals and edge cases on stand-ins.
- The customer's payment is the sandbox's simulation, not a bank's; the payment link was not paid (its checkout is a browser page), it was switched off once the invoice was paid by the simulated transfer.
- The revoked transfer was never signed with a passkey: it shows Airwallex's side (SCHEDULED, then cancelled), not the CFO's withdrawal screen.
- `POST /hosted_flows/{id}/authorize` stays not live: it needs Airwallex's onboarding template id, which this sandbox account was never issued (docs/runs/2026-11-19-airwallex-coverage.md).
