# Airwallex payout approved with the owner's own iPhone Face ID (13 November 2026)

Sandbox, test money. World `awx-1-faceid-1113`, step f1 of awx-1 only.

| Time (UTC) | What happened |
|---|---|
| 05:43:49 | The owner enrolled a passkey on the owner's own iPhone with Face ID (fingerprint BFA1-44B0-273F-DFEC, read off the phone and confirmed on the runner). |
| 05:44:03 | Claude read invoice SLL-2026-11 (Stockline Data GmbH, EUR 240.00). The Treasury agent (Opus) advised paying now; the review was advisory. Proposal P-0001 opened. |
| 05:44:42 | The owner approved P-0001 on the phone with Face ID (passkey `zg42VtKb`, method `passkey`). |
| 05:44:43 | Purser created SWIFT transfer `d0353daf-515f-464f-bf8e-9fb99e6cca00` at Airwallex once (POST /transfers/create). |
| 05:52 | Read back with GET: `IN_APPROVAL`. Airwallex's own approval workflow holds it for a person (lock 2). |

What this shows: lock 1 (Purser) was opened by the owner's real Face ID on the owner's own phone, not a virtual test passkey.
What it does not show: the step to PAID. That was not done today (the pending approval was not found in the
sandbox web app on the phone). The full two-lock path to PAID is the 12 November run
(`2026-11-12-airwallex-two-locks-paid.md`).

Airwallex calls: 15 of a budget of 25 (owner approved).
