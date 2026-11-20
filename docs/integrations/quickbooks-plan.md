# QuickBooks Online: the plan for "bills to QuickBooks"

Status (20 Nov 2026): the **connect flow is built, not tested live**. Each company's owner connects its own QuickBooks
Online company in Purser Cloud (Settings, "Connect QuickBooks"); Purser keeps the tokens sealed for that company,
refreshes them and disconnects them (`cloud/src/connect.ts`, `test/cloud-books-connect.test.ts`). **Sending bills is
planned, not built.** Until it is, a company imports the QuickBooks CSV (`GET /v1/export/csv/quickbooks/bills`).

Why it waits: a QuickBooks bill cannot be made from names alone the way a Xero bill can. It needs the id of an
existing vendor and of an expense account, so a push has to look them up (and make a missing vendor) first.

## What to build

From Intuit's Accounting API reference (Bill, Vendor, Account, Query; read 20 Nov 2026), against
`https://quickbooks.api.intuit.com/v3/company/{realmId}` (sandbox: `https://sandbox-quickbooks.api.intuit.com`), with
the company's own access token and the realmId Purser keeps per company:

1. **Vendor.** `GET …/query?query=select * from Vendor where DisplayName = '<name>'` (quote-escaped). None: `POST
   …/vendor { DisplayName }`. Keep the vendor id per Purser supplier (`books_pushes`-like table `books_refs`).
2. **Account.** The owner maps Purser's GL codes to QuickBooks expense accounts once (a small mapping in Settings,
   filled from `select Id, Name, AcctNum from Account where AccountType = 'Expense'`). An unmapped code is not sent
   and the answer says which.
3. **Bill.** `POST …/bill?minorversion=75` with `{ VendorRef: { value }, TxnDate, DueDate, DocNumber: invoice_no,
   PrivateNote: "Purser AP-…", CurrencyRef, Line: [ { DetailType: "AccountBasedExpenseLineDetail", Amount: net,
   AccountBasedExpenseLineDetail: { AccountRef: { value } } } ], TxnTaxDetail: { TotalTax } }`. A QuickBooks bill has no
   draft state, so Purser sends it as an open, unpaid bill and **never** a BillPayment: paying stays the CFO's passkey
   in Purser.
4. **Once only.** `books_pushes` (provider `quickbooks`) and Intuit's `requestid` query parameter (idempotent retries).
5. **Route and button.** `POST /v1/connect/quickbooks/bills`, the same shape as Xero's; "Send bills to QuickBooks" in
   Settings beside the connection.
6. **Tests.** A stand-in shaped like those pages; two companies with two realms, neither reaching the other's; then a
   run against an Intuit sandbox company before the label changes.

Rough size: one session (about the Xero push plus the vendor lookup and the account mapping).
