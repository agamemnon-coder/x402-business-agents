# ERP connectors

Purser keeps its own books and can also send them to a company's ERP: suppliers, purchase invoices (with the PDF),
payments and journal entries. It can read back the chart of accounts, the suppliers and whether an invoice is paid.
No CSV is needed. Design: [docs/superpowers/specs/2026-11-08-erp-connectors-design.md](superpowers/specs/2026-11-08-erp-connectors-design.md).

**Status: built and tested against the vendors' documented request and answer shapes. Moneybird ran live once, in a
sandbox administration with test data, on 12 November 2026: sent, corrected, read back and reconciled to the cent
(docs/moneybird.md). Exact Online, Business Central and Odoo have not been tested against a live system yet.** Each
connector needs a test administration and its credentials first (below).

Moneybird, for small companies, has its own page: [docs/moneybird.md](moneybird.md).

## What it does

| | Exact Online | Business Central | Odoo |
|---|---|---|---|
| Supplier | `crm/Accounts` (IsSupplier) + `crm/BankAccounts` | `vendors` (bank account: a person adds it) | `res.partner` + `res.partner.bank` |
| Purchase invoice | `purchaseentry/PurchaseEntries` (type 30) with lines | `purchaseInvoices` + `purchaseInvoiceLines`, posted only if its total matches | `account.move` `in_invoice`, posted only if its total matches |
| The PDF | `documents/Documents` + `DocumentAttachments` | `attachments` + `attachmentContent` | `ir.attachment` |
| Correction | credit note (type 31) | `purchaseCreditMemos` linked to the invoice | `account.move` `in_refund` (`reversed_entry_id`) |
| Payment | `financialtransaction/BankEntries` | `vendorPayments` (in the payment journal; a person posts it) | `account.payment` outbound |
| Journal entry | `generaljournalentry/GeneralJournalEntries` | `journals({id})/journalLines` | `account.move` `entry` |
| Paid or not | `cashflow/Payments` | `purchaseInvoices.status` | `account.move.payment_state` |

## How a sync behaves

- Order: suppliers, then invoices, then payments, then journal entries. Something whose supplier or invoice is not in
  the ERP yet waits for the next run.
- Sent once: `erp_sync` keeps the ERP's id and the hash of what was sent. Unchanged objects are skipped.
- Step by step: a push made of several requests (a supplier and its bank account; an invoice header, its lines, the PDF
  and the post action; journal lines) records each step that succeeded in `erp_sync.progress_json`. A retry or the next
  run resumes from the first step not done, so a rate limit on a later request never makes a second header or repeats
  an earlier line.
- Never posted twice: whenever an earlier run left a row (pending or failed) with no step recorded, or an answer never
  came, the connector first asks the ERP whether the object is already there. A lookup that fails is retried as a
  lookup; nothing is sent blind. An object found only in part (an invoice header without all its lines, a supplier
  without its bank account, an Odoo bill not posted) is not taken as sent: it goes to a person (`needs_review`).
- Waits for a person (`needs_review`): when the ERP holds the object in a state a person must look at. Business Central
  and Odoo post an invoice only when their own computed total is the invoice's, to the cent; otherwise it stays in draft
  with the difference named. Such an object is never sent again, never looked up and never marked sent by a sync, and a
  payment against it waits. A person settles it: `npm run erp -- resolve --connector bc --object invoice:<id> --as
  synced --by <who>` once they finished it in the ERP, or `--as retry` to let the next sync try again.
- Never overwritten: something that changed after it was sent is marked `needs_correction`. An invoice is corrected with
  a credit note plus the new version (`npm run erp -- correct ...`), a journal entry with a reversal plus the new one.
  Each part is recorded as soon as it succeeds, so a correction run again after a failure goes on from there. If the
  answer to a part never came, the ERP may hold it, and a lookup cannot tell two versions of one invoice apart. So
  that part is not sent again: it goes to a person (`needs_review`), who looks in the ERP and says `--as retry` (not
  there) or `--as synced --external-id <its id>` (there, complete). The next `correct` goes on from there. A changed
  supplier or payment goes to a person.
- The PDF: an invoice from the inbox takes the PDF the inbox stored, checked against its SHA-256. If that file is not on
  this machine, or is another file now, the invoice is not sent: it fails with that reason. Whether the file is here is
  not a change to an invoice already sent: the hash holds the document's own hash, not the file.
- Retries: rate limits, server and network errors, with back-off and the ERP's Retry-After up to two minutes; an ERP
  that asks to wait longer fails the push, naming the wait. Everything else fails with the ERP's own message. Every
  result is in the audit log.
- Stops at the call budget (below): the object it was sending fails with that reason and keeps the steps already done,
  and what follows is not tried. The next run goes on from there.

## A go and a call budget

Every `--live` command needs three settings, or it refuses to run and calls nothing:

- `ERP_LIVE_GO=yes`: the owner's go for this run.
- `ERP_CALL_BUDGET`: the approved number of requests, for every command of the run together.
- `ERP_CALL_LOG`: a file outside the repository that counts them.

Each request is written to the log before it is sent, a retry and a lookup too: the time, the method and the endpoint,
never a body or a header. The request that would go over the number is not sent. Each live command ends by saying how
many are used, and `npm run erp -- calls` shows the log by endpoint.

## Commands

```sh
npm run erp -- list                                  # which settings each connector still needs (names only)
npm run erp -- sync --connector exact --dry-run      # the requests a sync would send, redacted; nothing is sent
npm run erp -- sync --connector exact --live         # send what changed
npm run erp -- pull --connector exact --live         # read the ERP's chart of accounts and suppliers
npm run erp -- status                                # what was sent, what failed, what needs a correction
npm run erp -- correct --connector exact --object invoice:<id> --live
npm run erp -- resolve --connector bc --object invoice:<id> --as synced|retry --by <who> [--external-id <id>]   # a person settles needs_review
npm run erp -- calls                                 # the run's call log by endpoint, against the approved number
```

A dry run needs no account: without settings it uses example settings and says so.

## What is needed to go live

Secrets go in the environment only (or, for Exact's rotating refresh token, `data/erp/exact.token.json`, outside git,
mode 600). Never in the repository or the chat. Two runs never refresh Exact's token at once: load, refresh and save
happen under a lock file next to it (`exact.token.json.lock`; one left by a run that died is taken over after a minute),
and the file is written to a temporary file and renamed, so a crash leaves the old token or the new one. A token file
that cannot be read says so and asks to authorise Exact Online again.

### Exact Online
1. Register an app in the Exact App Center (a client id, a client secret, a redirect URI).
2. A person with access to the administration authorises it once; the code from the redirect is exchanged for a
   refresh token (`ERP_EXACT_REFRESH_TOKEN`). Exact rotates it on every refresh and it expires after 30 days unused.
3. Settings: `ERP_EXACT_CLIENT_ID`, `ERP_EXACT_CLIENT_SECRET`, `ERP_EXACT_DIVISION`, `ERP_EXACT_PURCHASE_JOURNAL`,
   `ERP_EXACT_GENERAL_JOURNAL`, `ERP_EXACT_BANK_JOURNALS` (`{"1200":"20"}`; a payment in a currency other than EUR, USD or GBP leaves from 1203, so map it too when FX payouts are used), `ERP_EXACT_VAT_CODES`
   (`{"NL21":"…","NL9":"…","NL0":"…","EU_RC":"…","NONEU_RC":"…","EXEMPT":"…","NONE":"…"}`, exclusive codes); optional
   `ERP_EXACT_GL_MAP`, `ERP_EXACT_DOCUMENT_TYPE` (from `documents/DocumentTypes`), `ERP_EXACT_AP_ACCOUNT`,
   `ERP_EXACT_BASE_URL` (other countries).
4. To confirm in a test division before going live: the sign of a payment on a bank entry line
   (`ERP_EXACT_PAYMENT_SIGN`, default -1), and that lines of a credit note take negative amounts.

### Business Central
1. Register an application in Microsoft Entra ID with the application permission **API.ReadWrite.All** for Dynamics 365
   Business Central, grant admin consent, and add the application in Business Central (Microsoft Entra Applications)
   with the permission sets it needs.
2. Settings: `ERP_BC_TENANT`, `ERP_BC_ENVIRONMENT`, `ERP_BC_COMPANY_ID`, `ERP_BC_CLIENT_ID`, `ERP_BC_CLIENT_SECRET`,
   `ERP_BC_GENERAL_JOURNAL_ID`, `ERP_BC_PAYMENT_JOURNAL_ID`, `ERP_BC_VAT_CODES`; optional `ERP_BC_LOCAL_CURRENCY`
   (default EUR), `ERP_BC_GL_MAP`, `ERP_BC_POST_INVOICES` (`on` posts a matching invoice; otherwise it stays in Draft).
3. Not in API v2.0's standard resources, so a person does it in Business Central: a vendor's bank account, posting the
   payment journal. Journal entries go in the company's currency only.

### Odoo (17, 18)
1. Create an API key for an integration user (Preferences, Account Security, New API Key).
2. Settings: `ERP_ODOO_URL`, `ERP_ODOO_DB`, `ERP_ODOO_LOGIN`, `ERP_ODOO_API_KEY`, `ERP_ODOO_PURCHASE_JOURNAL_ID`,
   `ERP_ODOO_GENERAL_JOURNAL_ID`, `ERP_ODOO_BANK_JOURNALS` (`{"1200":6}`; map 1203 too for FX payouts), `ERP_ODOO_TAX_IDS` (`account.tax` ids per
   VAT treatment, 0 for none); optional `ERP_ODOO_COMPANY_CURRENCY`, `ERP_ODOO_GL_MAP`, `ERP_ODOO_POST` (`on`).
3. A person reconciles a payment with its bill in Odoo (the payment register); journal entries go in the company's
   currency only.
4. Odoo 17 and 18 differ on a payment's reference: `account.payment.memo` exists from 18.0; 17.0 has no such field
   (create refuses it) and takes `ref` through its `_inherits` of `account.move` (odoo/odoo 17.0 and 18.0,
   `addons/account/models/account_payment.py`). The connector asks the server's version once (`common.version`) and
   uses the right field to create and to find a payment. A dry run asks no server and prints Odoo 18's shapes.

## What the ledger sends today

`src/erp/source.ts` maps what Purser already records: the payees on the allowlist, the invoices, the PAID payouts, and
the GL journal's other movements. The ledger's invoices carry no issue date (the due date stands in) and no VAT split;
movements in Metal's test token (USDZ) are not an ISO currency and are left out. The payables inbox and the bookkeeping
core will send richer records through the same model.

## Next

AFAS Profit and Twinfield connectors (Moneybird is in: docs/moneybird.md); webhooks from the ERP; customer (sales) invoices.
