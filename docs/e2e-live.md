# Platform end-to-end: three test companies, invoice to T:0

Ran live on 10 November 2026: 3 connected accounts ACTIVE, 1 payout PAID (`593c340b-1752-4537-9ef2-0eb3558897cc`,
EUR 4.84, Purser's EUR 0.02 fee), 3 refused by Airwallex ([run record](runs/2026-11-10-platform-e2e.md)).

`npm run e2e:live` runs Purser's SME product end to end for three fictional small companies, each its own Purser
company on its own Airwallex connected account (src/e2e). The flow for each company, through the product's own code:

1. **Account.** The connected account is the ACTIVE one opened on 10 November, or a new one. A new one is opened,
   filled in with a fictional sole trader's details, submitted and activated with the sandbox's simulation. Test money
   is moved into it from Purser's platform account with `connected_account_transfers/create`.
2. **Binding and fee.** The company's account binding is stored. It is signed with the run's own Ed25519 key, a test
   world's stand-in for Purser Cloud's. Purser's fee (50 bps) is set in the company's CFO policy.
3. **Test passkey.** The CFO's passkey is enrolled the way a phone enrols. It is a software authenticator, labelled
   "test passkey" everywhere, not Face ID.
4. **Invoices.** They come in through the real inbox: a PDF upload or an e-mail with the PDF attached (src/ap/inbox.ts).
   They are read (Claude live, the parser in the dry run) and checked.
5. **New suppliers.** Each one is verified by a person (recorded as a test world), approved with the test passkey and
   created at Airwallex for that company.
6. **Approval.** One approval per company: a batch when it has two invoices, otherwise the single payment. The test
   passkey signs the exact terms, and the runner verifies the signature (src/passkey/process.ts).
7. **Payout.** It goes out on behalf of the connected account (`x-on-behalf-of`), with Purser's fee as
   `application_fee_options`. The sandbox's simulation moves it to PAID, and Purser follows it and books it.
8. **T:0.** All three companies' books are pushed to the one T:0 sandbox entity. Every entry's name and memo carry the
   company and its PUR id (`[BAKKERIJ] PUR-BAKKERIJ-AP-0001: …`), so the three stay separable. One entity is a
   limitation of the sandbox, not of the product: a real company has its own.
9. **Receipt.** One receipt per approval is written, in the /try/sign receipt format plus an `e2e` block with every step
   from invoice to T:0, hash-chained. `npm run verify-receipt -- <receipt>` checks it offline: the signature over the
   exact terms, every step against its row, the chain, and that the chain records this signature. The run also writes
   `summary.json` with every id.

If a payout comes back `IN_APPROVAL` (Airwallex's own approval workflow is on in its web app), the run stops and says
which payout is waiting. Only a person approves it there; the run never moves it on.

## Dry run and live run

- `npm run e2e:live` is the dry run. Every outside service is a stand-in (src/redteam/airwallex.ts, src/redteam/t0.ts),
  and nothing leaves the machine. It prints the receipts and how many calls a live run would make.
- `E2E_LIVE=yes npm run e2e:live -- --live` is the live run: Airwallex sandbox, Claude, T:0 sandbox. It runs the dry run
  first as its plan, and refuses before any call when the plan needs more calls than approved. The budget is
  `E2E_BUDGET="airwallex=26,t0=12,claude=8"` (the default). Every call is counted before it is sent and written to
  `calls.jsonl`: service, method, path with ids replaced, time. The log never holds a body, query or header. Once
  Claude's budget is spent, the parser reads without calling Claude.
- **Keys.** Airwallex: `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY`. Claude: `KIT11_ANTHROPIC_API_KEY`. T:0: the
  network secret the proxy injects for api.t0.ai, so the run's own value is a placeholder. No key is in code, git or any
  log.
- **T:0's currency.** The sandbox entity is a US company, so if its functional currency is not EUR, the live run needs
  `T0_RATES` (for example `EUR=<rate>`) for the EUR entries. The run does not pick a rate itself.

## What the live run was planned to call (measured on the dry run, 10 November, before it ran)

| Service | Planned | Approved | Where the calls go |
|---|---|---|---|
| Airwallex | 55 | 26 | 40 company calls (beneficiary look-up and create ×5, balances ×15, payout ×5, simulation SENT and PAID ×10), 4 logins, 11 platform calls (2 accounts × create, update, submit, activate; 3 fundings) |
| T:0 | 13 | 12 | chart, P&L for the currency, one list, 10 entries (one accrual and one payment per invoice) |
| Claude | 22 | 8 | every reading the inbox asks for: classification and reading per document, and checks |

With the default budget the live run refuses before its first call; for the live run of 10 November a larger budget
was approved (Airwallex 66, Claude 22, T:0 13), and it used 61, 20 and 12 ([run record](runs/2026-11-10-platform-e2e.md)). It needs either a larger budget (about 56 / 13 / 22) or a
smaller world: one invoice per company, or one new account instead of two. Balances are read three times per payout by
the planner and the four-eyes check; that is product code, not changed for this run.

## Not confirmed before the live run (written before it ran)

- **The new accounts' update body** (`soleTraderDetails` in src/e2e/platformOps.ts) follows the fields named in the
  10 November run record. It was accepted in the live run of 10 November: both new accounts went ACTIVE. Their payouts
  were refused, because Airwallex wants the paying company's registration number; next time open them as registered
  sole traders (`business_identifiers`).
- **The funding body** (`connected_account_transfers/create`) follows Airwallex's API reference, read 10 November:
  amount, currency, destination, reason (`business_expenses`), reference, request_id.
- **Metal.** It is not in this run. The SME product pays suppliers by bank transfer through Airwallex; no step in this
  flow is a Metal payment, and a forced one would prove nothing.
