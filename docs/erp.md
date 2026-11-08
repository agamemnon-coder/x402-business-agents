# ERP connectors

Purser keeps its own books and can also send them to a company's ERP: suppliers, purchase invoices (with the PDF),
payments and journal entries. It can read back the chart of accounts, the suppliers and whether an invoice is paid.
No CSV is needed. Design: [docs/superpowers/specs/2026-11-08-erp-connectors-design.md](superpowers/specs/2026-11-08-erp-connectors-design.md).

**Status: built and tested against the vendors' documented request and answer shapes only. Nothing has been sent to a
live ERP yet.** Each connector needs a test administration and its credentials first (below).

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
- Never posted twice: when an answer never came (a network or server error), or a run stopped between sending and
  recording, the connector first asks the ERP whether the object is already there.
- Never overwritten: something that changed after it was sent is marked `needs_correction`. An invoice is corrected with
  a credit note plus the new version (`npm run erp -- correct ...`), a journal entry with a reversal plus the new one.
  A changed supplier or payment goes to a person.
- Retries: rate limits, server and network errors, with back-off and the ERP's Retry-After. Everything else fails with
  the ERP's own message. Every result is in the audit log.
- Invoices are posted in Business Central and Odoo only when the ERP's own computed total is the invoice's, to the cent;
  otherwise they stay in draft with the difference named.

## Commands

```sh
npm run erp -- list                                  # which settings each connector still needs (names only)
npm run erp -- sync --connector exact --dry-run      # the requests a sync would send, redacted; nothing is sent
npm run erp -- sync --connector exact --live         # send what changed
npm run erp -- pull --connector exact --live         # read the ERP's chart of accounts and suppliers
npm run erp -- status                                # what was sent, what failed, what needs a correction
npm run erp -- correct --connector exact --object invoice:<id> --live
```

A dry run needs no account: without settings it uses example settings and says so.

## What is needed to go live

Secrets go in the environment only (or, for Exact's rotating refresh token, `data/erp/exact.token.json`, outside git,
mode 600). Never in the repository or the chat.

### Exact Online
1. Register an app in the Exact App Center (a client id, a client secret, a redirect URI).
2. A person with access to the administration authorises it once; the code from the redirect is exchanged for a
   refresh token (`ERP_EXACT_REFRESH_TOKEN`). Exact rotates it on every refresh and it expires after 30 days unused.
3. Settings: `ERP_EXACT_CLIENT_ID`, `ERP_EXACT_CLIENT_SECRET`, `ERP_EXACT_DIVISION`, `ERP_EXACT_PURCHASE_JOURNAL`,
   `ERP_EXACT_GENERAL_JOURNAL`, `ERP_EXACT_BANK_JOURNALS` (`{"1200":"20"}`), `ERP_EXACT_VAT_CODES`
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
   `ERP_ODOO_GENERAL_JOURNAL_ID`, `ERP_ODOO_BANK_JOURNALS` (`{"1200":6}`), `ERP_ODOO_TAX_IDS` (`account.tax` ids per
   VAT treatment, 0 for none); optional `ERP_ODOO_COMPANY_CURRENCY`, `ERP_ODOO_GL_MAP`, `ERP_ODOO_POST` (`on`).
3. A person reconciles a payment with its bill in Odoo (the payment register); journal entries go in the company's
   currency only.

## What the ledger sends today

`src/erp/source.ts` maps what Purser already records: the payees on the allowlist, the invoices, the PAID payouts, and
the GL journal's other movements. The ledger's invoices carry no issue date (the due date stands in) and no VAT split;
movements in Metal's test token (USDZ) are not an ISO currency and are left out. The payables inbox and the bookkeeping
core will send richer records through the same model.

## Next

AFAS Profit and Twinfield connectors; webhooks from the ERP; customer (sales) invoices.
