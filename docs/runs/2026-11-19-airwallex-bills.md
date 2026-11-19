# Paid invoices as bills in Airwallex's own accounts payable (19 November 2026)

Airwallex sandbox, test money only. **Each transfer's SENT and PAID was simulated** by the sandbox's simulation endpoint.
The invoices were signed by a **labelled virtual test passkey**, not a person's Face ID. The bills, the vendor, the
uploaded PDFs, the read-backs and `mark_as_paid` are Airwallex's own answers. No one was paid.

Tool: `npm run airwallex-bills -- run`, then `record` (`src/cli/airwallexBills.ts`), with `AIRWALLEX_BILLS=on`.
Code: `src/airwallex/bills.ts` (Spend Bills, Vendors and the Files upload), `src/ap/billSync.ts` (one invoice, one
bill), run from `syncPayments` (`src/ap/pay.ts`). The switch is **off by default**: with `AIRWALLEX_BILLS` unset,
nothing here calls Airwallex.

Every number below is in [`2026-11-19-airwallex-bills.json`](2026-11-19-airwallex-bills.json), from the run ledger's
audit rows and the call log only. The probe before the build is below it; its calls are counted in its own log, not in
the JSON record.

## What ran

Three Stockline Data GmbH invoices (`fixtures/stockline-licence-SLL-2026-11B1.txt`, `B2`, `B3`; EUR 240.00 each, the
licence fee in code) came in through the payables inbox as PDFs, read by the parser (no model). Each was filed for
payment and signed by the virtual test passkey over its exact terms. Purser then created one SWIFT transfer for each,
with the signed hash in its metadata, and the sandbox's simulation took it to SENT and PAID. One payment sync followed:
each invoice was booked paid, and with the bills switch on, became a bill at Airwallex.

| Time (UTC) | Step | Result |
|---|---|---|
| 07:21:24 to 07:21:39 | Ingest, file, sign, `POST /transfers/create` ×3, simulation to SENT and PAID ×3 | 3 transfers, each `PAID` (simulated) |
| 07:21:40 | `GET /spend/bills` (one per invoice, matched on external_id here) | no bill held any of the three external_ids |
| 07:21:40 | `GET /account`, `GET /spend/vendors`, `POST /spend/vendors/create` | vendor `01a6eb17-ad60-38d3-952e-8705b194bf6b` ("Stockline Data GmbH"), `ACTIVE`, created once for all three |
| 07:21:40 to 07:21:52 | Per invoice: `POST /files/upload` (purpose `SPEND_ATTACHMENT`), `POST /spend/bills/create`, `GET /spend/bills/{id}`, `POST /spend/bills/{id}/mark_as_paid`, `GET /spend/bills/{id}` | 3 bills, each created `AWAITING_PAYMENT` with its PDF, then `PAID`; both read-backs agree for all three |

The audit rows of one sync carry the sync's start time (07:21:39.991Z); Airwallex's own `created_at` and `updated_at`
are in the table below.

## The bills

external_id is the SHA-256 of the terms the passkey signed. For all three it equals the signed hash
(`approvals.approved_sha256`) and the transfer's `metadata.approval_sha256`, as `GET /spend/bills/{id}` returned it.

| Invoice | Bill (Airwallex) | external_id (= signed hash) | Transfer (PAID, simulated) | Attachment (file id) | Created at Airwallex | Marked paid at Airwallex |
|---|---|---|---|---|---|---|
| SLL-2026-11B1 (AP-0001, P-0001) | `c90bdc31-e509-30c8-a1df-0d5acc0b7af8` | `75eb5d22c146031478b972a470cec89f1cc4d49ca368f7be72bd67bb9277c2c5` | `786b9dfa-0299-4c4d-b209-9a530533c6dd` | `f5135289-c042-4194-b09b-36467577c87f` | 07:21:44Z, `AWAITING_PAYMENT` | 07:21:45Z, `PAID` |
| SLL-2026-11B2 (AP-0002, P-0002) | `32ea54e7-ea10-320d-988d-f83cb601f4b6` | `d3960244252e93e16b2db9ce6e561a1be3547271a63ec77e552f8ef604c21088` | `36e4fc5c-8e8a-4596-85c4-1054c7c3ab5a` | `baae2683-7b23-4d43-89b2-e37799b9b2c0` | 07:21:47Z, `AWAITING_PAYMENT` | 07:21:48Z, `PAID` |
| SLL-2026-11B3 (AP-0003, P-0003) | `a21292c4-29f7-38a3-856b-51a44b50ccb8` | `9d55b003edcaf6182e3a005799e2919d9e80d4f2c7a1b6a14378bc9deaaa1c5d` | `2d8ada88-4293-4a22-89eb-0f5f1fb930dc` | `d5c0816c-97e3-49e7-ab2b-827e949b6bdc` | 07:21:51Z, `AWAITING_PAYMENT` | 07:21:52Z, `PAID` |

Each bill: EUR 240.00, one line (quantity 1, tax included), invoice number and due date (2026-12-15) from the invoice,
`sync_status` `NOT_SYNCED`. Read back after create: external_id, invoice number, currency, amount, vendor and attachment
agree, 0 differences. Read back after `mark_as_paid`: `PAID`, external_id agrees, 0 differences. The bill's description
names the proposal and the Airwallex transfer that paid it.

## What did not work as hoped, said plainly

- **The transfer cannot be linked to the bill by API.** `mark_as_paid` takes no body: Airwallex records a bill payment
  of type `EXTERNAL` with `transfer: null` (as read back for all three). The transfer id is only in the bill's
  description. A bill paid through Airwallex's own bill pay would carry a `TRANSFER` payment; Purser's transfers do not
  go through bill pay.
- **Airwallex does not keep external_id unique, and List bills ignores an `external_id` filter** (probe, below). Purser
  keeps it unique itself: its own record first, then every list page matched on external_id before a create, then a
  request_id derived from the invoice and its hash (a resend is refused by Airwallex). Listing every page before each
  create costs one call per page; this account had one page.
- Not run live, tested only (`test/airwallex-bills.test.ts`): a lost create answer (adopted on the next sync, never
  resent), two bills under one external_id (refused, a person picks), a read-back that differs (never marked paid), a
  Spend error (recorded, the payment sync carries on), an invoice paid with no person's signature (external_id is the
  invoice id), and a bill created before its transfer is PAID (marked paid on a later sync).

## The probe before the build (07:03 to 07:05 UTC, read-only first, then one of each create)

| Call | HTTP | What it showed |
|---|---|---|
| `GET /spend/bills` | 200 | Spend Bills is on for this sandbox account (0 bills then) |
| `GET /spend/vendors` | 200 | Vendors on too (0 vendors then) |
| `GET /account` | 200 | the legal entity id is at `account_details.legal_entity_id` (not at the top level, as the vendors guide shows) |
| `POST /spend/vendors/create` | 201 | probe vendor `a4ec4844-2f40-3855-b2a0-3144e537a10d`, `ACTIVE` |
| `POST /files/upload` (files.sandbox.airwallex.com) | 201 | probe file `40d947c9-567d-4199-a32e-f21fb45a1269`, 1,408 bytes, purpose `SPEND_ATTACHMENT` |
| `POST /spend/bills/create`, a 64-character hex external_id | 201 | probe bill `2fb0af32-9939-3787-9cbc-a130f20cffd7`, `AWAITING_PAYMENT`, external_id kept whole, file attached |
| the same create, same request_id | 400 `invalid_argument` ("An invalid argument was provided.", trace `771bbe3369a4410daf7e90f1949d9cb7`) | a resend cannot make a second bill |
| `GET /spend/bills?external_id=<made up>` | 200 | the filter is ignored: it listed the one bill there was |
| `POST /spend/bills/create`, same external_id, new request_id | 201 | a second probe bill, `a4c8cb08-91b2-3636-a456-69961d8aefae`: external_id is not unique at Airwallex (left `AWAITING_PAYMENT`) |
| `POST /spend/bills/{id}/mark_as_paid` | 200 | `PAID`, one bill payment of type `EXTERNAL`, `transfer: null`; asked again: 200, still `PAID` |

The two probe bills and the probe vendor are labelled as probes in their own text and stay in the sandbox. No permission
was missing: the account's API key could read and write Spend bills, vendors and files.

## Calls

Live run: **50 Airwallex calls of the 60 approved**, 07:21:24.799Z to 07:21:52.334Z: 2 logins, 9
`GET /balances/current`, 3 `POST /transfers/create`, 9 `GET /transfers/{id}`, 6
`POST /simulation/transfers/{id}/transition`; for the bills 21: 3 `GET /spend/bills`, 1 `GET /account`, 1
`GET /spend/vendors`, 1 `POST /spend/vendors/create`, 3 `POST /files/upload`, 3 `POST /spend/bills/create`, 6
`GET /spend/bills/{id}`, 3 `POST /spend/bills/{id}/mark_as_paid`.

Probe: 22 calls, 07:03:08 to 07:05:55 (4 logins, 3 `GET /spend/bills`, 3 `GET /account`, 2 `GET /spend/vendors`, 1
`POST /spend/vendors/create`, 1 `POST /files/upload`, 3 `POST /spend/bills/create`, 3 `GET /spend/bills/{id}`, 2
`POST /spend/bills/{id}/mark_as_paid`).
