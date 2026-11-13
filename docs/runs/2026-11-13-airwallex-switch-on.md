# Three Airwallex products switched on in the flow, run live (13 November 2026)

Airwallex sandbox, test money only. Tool: `npm run awx-switch-on -- live`, then `record` (`src/cli/awxSwitchOn.ts`).
Every number below is in [`2026-11-13-airwallex-switch-on.json`](2026-11-13-airwallex-switch-on.json), written from the
run ledger's audit rows and the call log only. The ledger (`awx-switch-on-1113.sqlite`) and the keys folder were outside
the repository; no key is in the record, the log or this page.

**What changed before the run.** The payee check, the batch transfer and the ledger reconciliation used to sit behind
`AIRWALLEX_PAYEE_CHECK=on`, `AIRWALLEX_BATCH_TRANSFER=on` and `AIRWALLEX_FINANCIAL_TX=on`, all off by default
([12 Nov runs](2026-11-12-airwallex-payee-check.md)). From this change they are on by default. `=off` is kept only as
an emergency stop. The run refuses to start if any of the three is set, so it shows the defaults: none was set.

The run called the flow's own functions:
- the payee check through `checkThenProposePayeeAdd`, which the autopilot, the payables page and the CLI use;
- the batch through `execute()`, the payment executor the runner calls, which made its own rails from the environment;
- the ledger through `reconcile()`, the hourly reconciliation, with `reconcileSourcesFromEnv`.

## 1. Payee check: the bank is asked before the CFO is (3 calls)

| New supplier request | Airwallex's answer | What the CFO's phone gets |
|---|---|---|
| N-0001: Stockline Data GmbH, Airwallex's test IBAN `…2051` | `VERIFIED`, `NOT_MATCHED` | nothing: stopped before the CFO (`PayeeNameRefused`) |
| N-0002: "Betty Morris" (the name the bank gave back on 12 Nov, read from that record), Airwallex's documented UK example account (sort code 040568, 10006132) | `VERIFIED`, `FULL_MATCH_INCORRECT_TYPE` | nothing: stopped before the CFO |

Both requests were verified first by the operator, labelled "live sandbox run: Airwallex's own test account, no real
supplier exists to call". 0 payee proposals were made.

The second answer is a full name match on a personal account. Purser asks as a company, as it does for every supplier,
so the bank answered `_INCORRECT_TYPE` and the gate refused it. On 12 Nov the same account under the same name, asked as
`PERSONAL` and directly rather than through the flow, gave `FULL_MATCH`.

The wording recorded for that refusal ("holds this account as "Betty Morris", not as "Betty Morris"") was unclear. It was
fixed after the run: an `_INCORRECT_TYPE` answer now says the account is held for another kind of holder than a company.

**Not shown live:** a full match let through to a proposal *in the flow*. No sandbox account answered `FULL_MATCH` to a
company name in this run. Covered by tests: `test/airwallex-payee-name.test.ts` ("in the flow") and
`test/ap-autopilot.test.ts` (a mismatch is parked for the CFO at once and never proposed).

## 2. Batch transfer: one signature, ONE Airwallex batch (11 calls)

| Step | What happened |
|---|---|
| Two invoices | SLL-2026-11I and SLL-2026-11J, EUR 240.00 each, to the Stockline test beneficiary: P-0001 and P-0002. |
| One signature | Batch P-0003 (hash `443538a5…40ec`), EUR 480.00, signed once by the **awx-switch-on virtual test passkey** (labelled; not a person's Face ID). Each line's approval records the batch and its hash. |
| The executor | `execute()` checked that both lines fit one Airwallex batch (EUR SWIFT invoice payments, no conversion) and took the batch path. No setting was in the environment. |
| ONE batch at Airwallex | `a77101ae-71aa-4c17-82f2-e02ff0b88904`, request_id `8dfbb673-0b95-4650-a75e-6863019d2f75` (derived from the signed hash), created once with both items. |
| Read back | 2 items, 2 `VALIDATED`, 0 differences: EUR 240.00 each, fee EUR 13.58 each (EUR, within the signed ceiling), payer pays EUR 253.58 each; quote EUR 507.16 with fee EUR 27.16. |
| Submit | `IN_APPROVAL`: Airwallex's approval workflow holds it until a person approves it in the web app. |

Nobody approved it at Airwallex. It was not booked or paid.

## 3. Ledger reconciliation: Purser's ledger against Airwallex's, to the cent (6 calls)

The run ledger was given the awx-1 payouts and conversion (7 November) exactly as the committed record
[`docs/demo/airwallex-run.json`](../demo/airwallex-run.json) holds them. These are real sandbox movements Purser made
then. The hourly `reconcile()` then ran with the environment's sources.

| Movement | Airwallex's financial transactions, by source_id | Result |
|---|---|---|
| SLL-2026-11 payout `738a4263…`: EUR 240.00 + fee EUR 13.50 | a PAYOUT debit EUR -240.00 and a FEE debit EUR -13.50 | agrees |
| BTX-2026-11 payout `4140dee2…`: EUR 1,850.00 + fee EUR 13.50 | a PAYOUT debit EUR -1,850.00 and a FEE debit EUR -13.50 | agrees |
| BTX-2026-11 conversion `fafcc208…`: buy EUR 623.50, sell USD 704.45 | a credit EUR 623.50, a debit USD -704.45 | agrees |

The reconciliation checked 5 things (the two transfers' status and amount, plus the three movements above) and found
0 differences. Nothing was skipped.

**Not shown live:** the check *right after a payout* (`reconcileAfterPayout`). This run's only payouts are the batch's,
and they are held `IN_APPROVAL`, not sent or paid, so there was nothing booked to compare. Covered by tests:
`test/reconcile.test.ts` (right after a payout; one cent off; not booked yet is pending for two hours, then flagged).

## Calls

20 Airwallex calls of the 30 approved for this run (the tool's ceiling is 40). The calls per step are counted from the
run's phase markers.

| Step | Calls |
|---|---|
| Payee check | 1 login, 2 `POST /beneficiaries/verify_account` |
| Batch transfer | 2 logins, 3 balance reads, 1 create, 1 add_items, 1 quote, 2 item reads, 1 submit |
| Ledger reconciliation | 1 login, 2 `GET /transfers/{id}`, 3 `GET /financial_transactions` |

## What moves on /airwallex

The page now reads this record (`switchedOnKeys` in `src/redesign/airwallexProducts.ts`). A product moves to "In use"
only when the record shows all of the following with no setting in the environment:
- **Payee check:** the bank was asked live (Airwallex, not a stand-in) and each answer was enforced before the CFO.
- **Batch:** one Airwallex batch, read back with 0 differences, submitted and held `IN_APPROVAL`.
- **Ledger:** a reconciliation with movements checked and 0 differences.

All three are shown here, so all three are in use. Their cards keep the figures of their 12 Nov records.
