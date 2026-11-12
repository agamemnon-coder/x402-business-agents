# Two locks on one payout: the CFO's passkey, then Airwallex's own approval workflow (10 November 2026)

**12 November 2026:** the run continued: the owner approved the transfer in Airwallex's web app and it went PAID, with simulated settlement ([2026-11-12-airwallex-two-locks-paid.md](2026-11-12-airwallex-two-locks-paid.md)). The text below is as written on 10 November.

Airwallex sandbox, test money only. Tool: `npm run two-locks` (src/cli/twoLocks.ts). Ledger: a fresh world of its own
(`data/two-locks.sqlite`, local, not committed).

## What was set up

- **Airwallex (Max, in the sandbox web app):** a transfer approval workflow with "Require API-initiated transfers to go
  through the same approval workflow?" set to **Yes**, approver Max, any amount (Transfers → Transfer approvals; source:
  Airwallex docs, "Manage approvals for transfers").
- **Purser:** invoice `SLL-2026-11B` from Stockline Data GmbH, EUR 240.00 (fixtures/stockline-licence-SLL-2026-11B.txt),
  to the licensor's beneficiary already created in the awx-1 run (`46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb`). Floors of this
  test world set so the payout comes from EUR (no FX).

## What happened

| | |
|---|---|
| **Lock 1: the CFO's passkey over the exact terms** | Proposal `P-0001` signed by a **labelled virtual test passkey** ("two-locks virtual test passkey", enrolled and confirmed like a phone; no person's Face ID in this run). Terms SHA-256 `f9ba0fe8758eadbef3b48f23e571ea92e3208f4ebd802703b413a414d444ac28`. Only then did Purser call Airwallex. |
| **The API call** | `POST /transfers/create`, one time. Transfer `4074d684-4704-406c-a527-2832753baf4f`, short reference `P261110-48HWOJN`, EUR 240.00 SWIFT, created 2026-11-10T09:02:16Z. Airwallex's own record carries `metadata.approval_sha256` = the hash the passkey signed. |
| **Lock 2: Airwallex's approval workflow** | Airwallex answered **`IN_APPROVAL`** on create and still held it there on a read-back (GET) a few minutes later (funding status `REQUIRES_FUNDING_CONFIRMATION`). Purser recorded it as "waiting for Airwallex approval", did not simulate past it and did not send it again. |
| **The web-app approval** | **Not completed.** Max could not find the transfer in the sandbox web app (it was not in "Pending your approval" or his transfer search), so nobody approved it there. It stays `IN_APPROVAL`: without a person approving it in Airwallex it cannot be paid. |

So this run shows both locks holding the same payout: Purser's signature check before the API call, and Airwallex
refusing to move an API-created transfer until a human approves it in Airwallex. It does **not** show the transfer
being approved, scheduled or paid.

## Calls

7 Airwallex calls of the 10 Max approved: 2 logins, 3 balance reads (plan, before and after the payout), 1 transfer
create, 1 read-back. 3 are kept: if Max approves it later, `npm run two-locks -- follow` (expect SCHEDULED) and
`settle` (sandbox simulation to SENT, PAID), and this record is updated.

## Checked first, offline

`npm run two-locks -- stand-in`: the same flow on the in-memory Airwallex stand-in with its approval workflow on:
IN_APPROVAL → (web-app approve) SCHEDULED → (simulated) PAID, with exactly one transfer create.
