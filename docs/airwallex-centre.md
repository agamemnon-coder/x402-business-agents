# Airwallex at the centre: new on 14 November

Moved from the [README](../README.md) on 15 November, to keep it short.

- **A live Airwallex FX quote inside the signed terms.** On [/try](https://kit11.max-31b.workers.dev/try), when a test company's payment needs EUR bought, Purser asks the Airwallex sandbox for a quote. Its id, rate, amounts and expiry go into the terms the passkey signs. The quote must sit within the company's FX limit (1.50% for a /try test company, 0.50% otherwise); over it, slow (over 3 s), capped or switched off, /try uses the recorded rate and says so.
- **One Airwallex sandbox transfer after the passkey.** After a verified passkey signature, /try can send one sandbox transfer of the signed payment, carrying the signed hash, so the same terms never pay twice. This is off by default (a switch); when it is off, the simulated bank alone pays, and the page says so.
- **Purser Cloud's Airwallex tab.** A read-only view of the Airwallex sandbox: balances, accounts, FX rates, financial transactions, transfers with their approval hash, beneficiaries, cards and card transactions, reconciled to the cent.
- **The signed events feed.** Webhooks from the Airwallex sandbox, shown as they arrive; only events whose signature verified, and only their type, object id and times.
- **Agent cards in the Agents tab.** Each agent's live sandbox card with its limits; the CFO freezes or unfreezes it with a passkey. The card actions are behind a switch (awx_cards) that is off by default.
- **Airwallex actions in Purser Cloud (not run live).** Purser Cloud can also run payables at the Airwallex sandbox (new supplier, pay, pay all ready, money in), each step behind the CFO's passkey over the exact terms; switched off by default (admin switches awx_act / awx_act_try, daily caps 0).
- **Agents learn from the CFO's past decisions.** When an agent decides, the most similar earlier cases and what the CFO did go to Claude as precedent. No model is trained, and code's checks still decide what may be paid. On the 49-case eval, precedent did not improve agreement ([docs/learning.md](learning.md)).
- **Built on Airwallex.** A badge in every page header and in the link preview.
- **Also today:** T:0 gates the month close (the month locks only when T:0's read-back matches Purser's journal; [read-back record](runs/2026-11-14-t0-readback.json)); /visa shows the card rail with Purser's three credential checks; Purser Cloud's books add up; stage and recording modes for the finals.

| Where | Airwallex sandbox calls | Note |
|---|---|---|
| /try FX quote | `POST authentication/login`, `POST fx/quotes/create` | read-only, capped |
| /try transfer | `GET balances/current`, `POST transfers/create`, `GET transfers/{id}`, `POST simulation/transfers/{id}/transition` | off by default |
| Cloud Airwallex tab | `GET balances/current`, `global_accounts`, `financial_transactions`, `fx/rates/current`, `transfers`, `transfers/{id}`, `beneficiaries`, `issuing/cards`, `issuing/cards/{id}`, `issuing/transactions` | read-only |
| Cloud agent cards | `GET issuing/cards`, `issuing/transactions`, `issuing/cardholders`; `POST issuing/cards/create`, `issuing/cards/{id}/update`, `issuing/cardholders/create`, `simulation/issuing/create` | writes off by default (awx_cards) |
| Events feed | Airwallex's signed webhooks, received | signature verified |

All paths under `/api/v1` on `api.sandbox.airwallex.com`. Test money only.
