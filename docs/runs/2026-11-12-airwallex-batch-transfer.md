# One signature, ONE Airwallex batch transfer, read back before submit (12 November 2026)

Airwallex sandbox, test money only. Tool: `npm run awx-depth -- batch-create` and `batch-follow`
(`src/cli/awxDepth.ts`). Code: `src/airwallex/batchTransfers.ts`, `src/executors/airwallexBatch.ts`, behind
`AIRWALLEX_BATCH_TRANSFER=on` (off by default). Each run had its own test world (`data/awx-depth-1112*.sqlite`, local,
not committed). Every number below is in the two records, written by `npm run awx-depth -- record` from the ledgers'
audit rows and the call log only:
[`2026-11-12-airwallex-batch-transfer.json`](2026-11-12-airwallex-batch-transfer.json) (run 1) and
[`2026-11-12-airwallex-batch-transfer-2.json`](2026-11-12-airwallex-batch-transfer-2.json) (run 2).

Both batches were signed by a **labelled virtual test passkey** ("awx-depth virtual test passkey"), not a person's Face
ID. Nobody approved either one in Airwallex's web app.

## What ran (the same steps in both runs)

| Step | What happened |
|---|---|
| 1. Two invoices | Two EUR 240.00 licence invoices to the Stockline test beneficiary created in awx-1, each its own proposal with its own terms hash. Run 1: SLL-2026-11E and -11F. Run 2: SLL-2026-11G and -11H (new numbers, so no invoice is at Airwallex twice). |
| 2. One signature | A batch over both lines, signed once. The approval of each line records the batch's id and hash. |
| 3. Purser's checks | Before any Airwallex call: the batch hash and approval, each line's hash and approval, the CFO's holds, the payee still active, no other payout for either invoice, and the EUR floor for both lines together. In the same database transaction, both payout rows are written. |
| 4. ONE batch at Airwallex | `POST /batch_transfers/create`, one time, under a request_id derived from the signed hash (the same signed batch can never create a second one), with the batch hash in its metadata. Both lines go in one `add_items` call, each under its own transfer request_id with its own approval hash in metadata. |
| 5. Read back, item by item | `quote`, then `GET /batch_transfers/{id}/items`, then the comparison with the signed terms. Result: 0 differences. |
| 6. Submit | `POST /batch_transfers/{id}/submit`, one time. Airwallex answered **`IN_APPROVAL`**: its own approval workflow holds the batch until a person approves it in the Airwallex web app. |

| | Run 1 | Run 2 |
|---|---|---|
| Purser batch, signed hash | P-0003, `14c4e741…bf3f` | P-0003 (its own ledger), `31743bba…0b96` |
| Airwallex batch | `3960a081-b058-422b-95b1-6298e45fe257` | `40486a4e-a08c-4480-847b-d22012f3c604` |
| request_id | `2fb6ade9-cb48-4041-ab65-9db4629faf74` | `a4f520ea-4d0a-462e-ad1b-5279f696ea0e` |
| Read-back | 2 items, 2 valid, 0 differences (comparison as committed in `ff08387`) | 2 items, 2 valid, 0 differences under the stricter comparison below; per item EUR 240.00, fee EUR 13.53 (EUR), payer pays EUR 253.53; quote EUR 507.06 with fee EUR 27.06 |
| Status after submit | `IN_APPROVAL`; one follow read later still `IN_APPROVAL`, nothing booked | `IN_APPROVAL` |
| Calls | 13 | 10 |

In run 1, the comparison checked the fee only when Airwallex showed one, and it did not store the numbers it compared.
A review the same day made it strict:
- Every item must show a fee, in EUR and within the line's signed ceiling.
- What the payer pays must be shown and equal the amount plus the fee.
- The quote must exist, be in EUR only, add up to the items, and stay within the signed amounts plus the fee ceilings.
- The reason must match.

Run 2 ran that strict comparison live and stored each item's numbers (`awx_batch.read_back`, audit row 20 of its record).

## Not shown

- Neither batch was approved at Airwallex, booked or paid.
- Never seen live, covered by tests only (`test/airwallex-batch-transfer.test.ts`):
  - A read-back that differs: an amount changed, an item added or dropped, a payee unknown, a fee missing or in another currency, totals that do not add up. Each time the batch is deleted while DRAFTING and nothing is submitted.
  - A lost submit answer followed by a line-by-line run. Refused: a line of an Airwallex batch is never sent on its own.
  - A refusal whose delete answer was lost. Finished as refused on the re-run.
  - A batch submitted elsewhere with an item nobody signed. Not adopted.
  - The EUR floor checked again on a re-run.
  - An emergency stop set during the read-back. Deleted, nothing submitted.
  - An item Airwallex fails to book. Its payout row is closed.

## Calls

23 Airwallex calls for this capability, of 32 for the whole stream (40 approved):
- Run 1 (13): 2 logins, 3 balance reads, 1 create, 1 add_items, 1 quote, 3 item reads (read-back, after submit, follow), 1 submit, 1 batch read.
- Run 2 (10): 1 login, 3 balance reads, 1 create, 1 add_items, 1 quote, 2 item reads, 1 submit.

## Why it matters to a CFO

The CFO signs one list. Airwallex holds exactly that list as one object, carrying the signed hash. Purser refuses to
submit unless what Airwallex would book matches what was signed, item by item and to the cent, fee included. Airwallex's
approval workflow then applies to the batch as a whole: a second, independent lock.

## Wording to apply (other sessions own these pages)

- `/airwallex`, Proof: "One Face ID, one Airwallex batch. Two invoices signed once became ONE Airwallex batch
  transfer (`40486a4e…`). It was read back item by item before submit (EUR 240.00 each, fee EUR 13.53 each within the
  signed ceiling, total EUR 507.06) with 0 differences. Airwallex's approval workflow holds it IN_APPROVAL. Signed with
  a labelled virtual test passkey. Sandbox, test money; not yet approved or paid."
- `docs/runs/README.md` (generated by `src/redesign/runs.ts`): add these runs with key ids
  `3960a081-b058-422b-95b1-6298e45fe257` and `40486a4e-a08c-4480-847b-d22012f3c604`.
