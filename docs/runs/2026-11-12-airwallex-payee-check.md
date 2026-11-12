# The payee's bank checks the name before the CFO is asked (12 November 2026)

Airwallex sandbox. Tool: `npm run awx-depth -- payee-check`, `payee-check-doc-example`, `payee-check-doc-resolved`
(`src/cli/awxDepth.ts`). Code: `src/airwallex/payeeName.ts` (`POST /beneficiaries/verify_account`), wired into the
new-supplier and bank-detail-change proposals (`src/ap/vendors.ts`, `src/policy/payeeChange.ts`) behind
`AIRWALLEX_PAYEE_CHECK=on` (off by default). Every number below is in
[`2026-11-12-airwallex-payee-check.json`](2026-11-12-airwallex-payee-check.json), from audit rows and the call log only.

## What ran

| # | Account and name asked | Airwallex's answer | Purser's verdict |
|---|---|---|---|
| 1 | Stockline test IBAN (`…2051`), "Stockline Data GmbH" (the name the test beneficiary was created with) | `VERIFIED`, `NOT_MATCHED`, no resolved name | refused: not proposed |
| 2 | the same IBAN, "Northbridge Trading Ltd" | `VERIFIED`, `NOT_MATCHED` | refused: not proposed |
| 3 | Airwallex's own documented example request (UK, sort code 040568, account 10006132), "Betty Morras" | `VERIFIED`, `PARTIAL_MATCH`, held as "Betty Morris" | refused: the label names the bank's spelling |
| 4 | the same account, under the name the bank gave back (read from the ledger, not typed) | `VERIFIED`, `FULL_MATCH` | proceeds; the answer goes into the signed terms |

So the endpoint is enabled on this sandbox key and the sandbox does compare names (3 and 4). For our German test IBAN
it answered `NOT_MATCHED` whatever the name (1 and 2): the sandbox's answer for that test account, recorded as given.

What Purser does with it (with the flag on): a person's call-back to the supplier, then this check, then the proposal.
Only `VERIFIED` with `FULL_MATCH`, or `CANNOT_VERIFY` (shown to the CFO as "could not verify"), may be proposed; any
other answer, or no check from the last 24 hours on exactly this name and account, refuses the proposal, so the CFO's
phone never shows it. Tests: `test/airwallex-payee-name.test.ts` (in-memory bank; a new supplier and a bank-detail
change).

Not shown live: a payee proposal refused or filed on a live check (the checks above were made directly, on test
accounts); `CANNOT_VERIFY` and `EXTERNAL_SERVICE_UNAVAILABLE` (tests only).

## Calls

7 Airwallex calls for this capability: 3 logins, 4 `POST /beneficiaries/verify_account`.

## Wording to apply (other sessions own these pages)

- New supplier and bank-detail change pages: "Checked with the payee's bank through Airwallex before you are asked:
  account exists, name matches." When refused: "The payee's bank holds this account as <name>, not as <name>."
- `/airwallex`: "Account name checked with the payee's bank (Airwallex account verification) before a new payee is
  proposed; a mismatch never reaches the CFO. Sandbox: FULL_MATCH, PARTIAL_MATCH and NOT_MATCHED answers seen live."
