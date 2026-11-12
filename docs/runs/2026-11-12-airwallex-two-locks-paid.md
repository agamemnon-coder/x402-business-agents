# Two locks on one payout: approved at Airwallex, then PAID (12 November 2026)

Airwallex sandbox, test money only. The times, statuses and call counts below are from the run's ledger and its call
log.

This is the second half of one run. The first half is the log of 10 November
([2026-11-10-airwallex-two-locks.md](2026-11-10-airwallex-two-locks.md)): a labelled virtual test passkey signed the
exact terms in Purser, Purser created the transfer one time (10 Nov 2026, 09:02 UTC), and Airwallex's own approval
workflow held it `IN_APPROVAL` (read back at 09:05 UTC). On 12 November the owner approved it at Airwallex and it
ended `PAID`, with simulated settlement.

## What happened on 12 November

| Time (UTC) | Step | Status |
|---|---|---|
| 09:35:59 | Purser read the transfer. | `IN_APPROVAL`, still held by Airwallex |
| between the two reads | **The owner approved the transfer in the Airwallex sandbox web app** (Business Accounts, Transfers, Pending your approval). | |
| 09:43:45 | Purser read the transfer again. | `PROCESSING` |
| 09:43:57 | Airwallex's sandbox simulation endpoint moved it on. | `SENT`, simulated settlement |
| 09:43:58 | The same simulation endpoint, a second time. | `PAID`, simulated settlement |

The first read after the approval showed `PROCESSING`, not the `SCHEDULED` that the 10 November log expected.

## The payout

- Transfer `4074d684-4704-406c-a527-2832753baf4f`: EUR 240.00 to Stockline Data GmbH, invoice `SLL-2026-11B`.
- Request id `c25bfc22-64fe-4ff3-aeb2-102a3684fc19`.
- Purser proposal `P-0001`, terms SHA-256 `f9ba0fe8758eadbef3b48f23e571ea92e3208f4ebd802703b413a414d444ac28`.

## Who signed and who approved

- **In Purser (lock 1):** "two-locks virtual test passkey", a labelled virtual test passkey, not a person's device.
- **At Airwallex (lock 2):** the owner, in the Airwallex sandbox web app.

## Calls

14 Airwallex calls in total, against a budget raised with the owner's approval from 10 to 12 to 14.

| Call | Count |
|---|---|
| `POST /authentication/login` | 5 |
| `GET /balances/current` | 3 |
| `POST /transfers/create` | 1 |
| `GET /transfers/{id}` | 3 |
| `POST /simulation/transfers/{id}/transition` | 2 |

7 of them on 10 November (2 logins, 3 balance reads, 1 create, 1 read-back) and 7 on 12 November (3 logins, 2 reads, 2 simulation transitions).

## What this run shows and what it does not

It shows one payout held by two locks, one after the other: a passkey signature over the exact terms in Purser before
the API call, and Airwallex holding the transfer `IN_APPROVAL` until a person approved it at Airwallex. Only then did
it move on to `PAID`.

It does not show:

- **A real Face ID.** Purser's lock in this run was signed by a labelled virtual test passkey, not by a real Face ID.
- **A person approving in Purser.** The person approved only at Airwallex.
- **Real settlement.** `SENT` and `PAID` came from the sandbox's simulation endpoints. Test money.
