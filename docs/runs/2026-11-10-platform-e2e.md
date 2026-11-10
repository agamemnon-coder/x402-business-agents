# Platform end-to-end, live: three test companies on Airwallex connected accounts (10 November 2026)

Purser's SME product, run live in the Airwallex sandbox with test money: three fictional companies, each its own Purser
company on its own Airwallex connected account. Invoices came in through the real inbox and were read by Claude.
Approvals were signed with a **test passkey**, a software authenticator standing in for the CFO's phone; it is not Face
ID. Payouts went out on behalf of each company's account, with Purser's fee as `application_fee_options`, and were booked
and posted to the T:0 sandbox. Code: `npm run e2e:live` (docs/e2e-live.md), platform branch.

**Result:** 3 companies onboarded as Airwallex connected accounts. 1 payout PAID with Purser's fee taken, booked, in T:0
and with a receipt that verifies offline. 3 payouts from the two newly opened accounts refused by Airwallex: it requires
the paying company's business registration number, and they were opened as unregistered sole traders.

## Calls (every one counted before it was sent; logs in `2026-11-10-platform-e2e/`)

| Service | Used | Approved | What |
|---|---|---|---|
| Airwallex | 61 | 66 (56, then +10) | 2 attempts stopped early (6 calls), the run (55): see `calls.jsonl` per endpoint |
| Claude | 20 | 22 | 3 in the second attempt, 17 in the run (classify, read and review per invoice; `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`) |
| T:0 | 12 | 13 | the currency (1), the chart (3, read twice: 6), a refused post (1: below), the journal list and 2 posts (3 + 1) |

No key, token or secret is in any log. The T:0 key is a network secret the proxy adds, and Airwallex's token never
leaves the client.

## Attempts before the run

1. **06:37:** T:0's sandbox entity books in **USD**, and no documented EUR rate was at hand, so the run stopped before
   any Airwallex call (1 T:0 call). Decision: convert at Airwallex's own current sandbox rate, read once at run time and
   named in every T:0 entry's memo.
2. **06:39:** Airwallex's beneficiary schema for **NL, EUR, LOCAL** (SEPA) requires `bank_details.bank_name` and
   `payment_methods`, which Purser's payout beneficiary body lacked. Purser's own pre-check stopped it before the create
   (6 Airwallex, 3 Claude calls). It was funded once: €60 into `acct_SC-QD89fOneAeqaRFgOymw`, `tr_iMvoE47PN5iEEK5Lq-toFw`.
   Fixed (platform `1cdc79f`): the body sends `payment_methods` next to `transfer_methods`, and the bank's registered
   name comes from the BIC. The stand-in now checks every body against the schema the sandbox was seen to require, so
   the dry run fails the same way (the test failed on the old code).

## The run (07:06 to 07:10 UTC)

Rate: **1.111482 USD per EUR** (client rate 1.111468; USD 100.00 for EUR 89.97), Airwallex sandbox
`GET /fx/rates/current` at 2026-11-10T07:06:03Z. Every EUR entry in T:0 carries its EUR amount and this rate in its memo.

| Company | Connected account | Opened | Funding (test money) |
|---|---|---|---|
| Purser Sandbox Test (fake sole trader) | `acct_SC-QD89fOneAeqaRFgOymw` | earlier on 10 Nov | skipped: EUR 61.59 already held |
| Bakkerij De Test (fake) | `acct_O07lI0VvMLagXlj5aeOgyg` | this run: create, update, submit, sandbox activation → ACTIVE | EUR 60.00, `tr_jUpMd20pNreYz0hjLT992Q` (request `e2e-fund-bakkerij-202611100707`) |
| Fietslab Test (fake) | `acct_XFhJLpkwNp6lzl8rpySE_Q` | this run, the same → ACTIVE | EUR 60.00, `tr_wOZ5xhSIOaGB8lhcl34GKw` (request `e2e-fund-fietslab-202611100709`) |

### Invoices, read by Claude (request ids were not returned through the proxy: recorded as such)

| Company | Invoice | Came in | Supplier | Total | Supplier at Airwallex (SEPA, LOCAL) |
|---|---|---|---|---|---|
| SANDBOXTEST | AP-0001 ZV-5001 | upload | Zeeland Verpakkingen B.V. | EUR 4.84 | `e8599d32-5f16-42e6-842c-f7356d5de239` (ABNANL2A, NL91…4300) |
| BAKKERIJ | AP-0001 MM-2026-114 | e-mail | Meelhandel Molenaar B.V. | EUR 3.63 | `2488dd1d-f481-4ea1-81eb-2eba2e4cef1a` (ABNANL2A, NL02…6789) |
| BAKKERIJ | AP-0002 VE-889 | upload | Verpakking Express B.V. | EUR 2.42 | `276d70ed-bf34-4c64-a11a-139d3e2e8be7` (INGBNL2A, NL20…4567) |
| FIETSLAB | AP-0001 OD-77 | e-mail | Onderdelen Direct B.V. | EUR 6.05 | `94860af0-d078-4e66-a06e-2b140e677380` (RABONL2U, NL44…6789) |

Claude read the supplier names without the "(test)" the fictional invoices carry: the name as printed on the first line.

### Approvals (test passkey over the exact terms; the runner verified each signature)

- SANDBOXTEST: supplier P-0001 (`abbfa7d5…`), payment P-0002 `e3057c735d9b8381baa9c59315f204fe8c686d8c92214777cab6765d5e82a236`.
- BAKKERIJ: suppliers P-0001 and P-0002, batch P-0005 `8fcb2a4fc4e054b8…` for both invoices.
- FIETSLAB: supplier P-0001, payment P-0002 `d2658f30cdf3e461…`.

### Payouts

| Company | Payout | Status | Purser's fee | Airwallex fee |
|---|---|---|---|---|
| SANDBOXTEST | `593c340b-1752-4537-9ef2-0eb3558897cc`, EUR 4.84 | **PAID** (sandbox simulation SENT, PAID) | EUR 0.02, SETTLED, to `acct_op0_QItiOyWKsYb5pwQihA` | EUR 2.69 |
| BAKKERIJ | MM-2026-114, EUR 3.63 | **refused at create** (trace `9bd733ccc0694443a94f56da9c3491b6`) | not taken | none |
| BAKKERIJ | VE-889, EUR 2.42 | **refused at create** (trace `64bd007328c1478eb1d16c3d834bb92e`) | not taken | none |
| FIETSLAB | OD-77, EUR 6.05 | **refused at create** (trace `9e367dfa7dff41ab896be161dfeaea93`) | not taken | none |

Every refusal: `400 validation_failed`, source `payer.additional_info.business_registration_number`. The two new accounts
were opened as **non-registered sole traders** (no business identifier, as Airwallex's NL requirements allow for
onboarding), and a payout from them needs the payer's registration number. The earlier account paid without one.

### Books, T:0 and receipt

- **Books:** SANDBOXTEST, 9 lines (accrual, payment, Airwallex fee, Purser's fee); debits equal credits. Audit chain ok:
  34 rows, head `2ede0e7dac1311c9f72feccd1971685b68e38ea64d26272a928921f54194d9ad`. The audit chains of BAKKERIJ (61 rows)
  and FIETSLAB (29 rows) are ok too.
- **T:0** (one sandbox entity shared by the three companies; every entry tagged `[SANDBOXTEST] PUR-SANDBOXTEST-…`):
  `je_prod_wop0vx1B8xOmHQl0` and `je_prod_WN96JsvKXGCY7mYs`, converted at the rate above.
  - Mapping (`T0_SANDBOX_AP_MAP`, src/e2e/platformRun.ts): input VAT → 15100 Other Current Assets - General (the US
    chart has no VAT account). Owed to suppliers → 24000 Other Current Liabilities.
  - T:0 refused the first post on its A/P account 21110 because it needs a T:0 vendor as counterparty (400 CAPI33).
    Nothing was posted by that refusal.
- **Receipt:** `2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json`. `npm run verify-receipt` checks it offline: the
  test passkey's signature over the exact terms, then 8 steps from account to T:0 in a hash chain. **VALID.**
- **Facts:** every id per company is in `2026-11-10-platform-e2e/facts.json`.

## Found and fixed during the run

- **SEPA beneficiaries** (`1cdc79f`): see attempt 2.
- **Stop rule** (`7039520`): a batch line refused at create was caught per line, so the run went on to the next company
  (about 10 calls). Now any payout not PAID stops the run there.
- **Open:** Purser's fee for a payout refused at create stays DUE in the fee table; it is never taken, because the
  payout does not exist. It should be marked void.

## Not done

- The two new companies' payouts: retrying them needs the paying company's registration number. That means a clearly
  fake TEST number on the transfer's `payer.additional_info` (with payer entity type, name and address) or on the
  account's `business_identifiers`, and a new approval.
- Metal: not part of this flow.
