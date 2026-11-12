# Moneybird

Purser's first accounting link for small companies. When Purser has booked or paid a supplier invoice, the
invoice lands in the company's Moneybird administration, together with its supplier, the PDF, the VAT, the ledger
account and the payment.

**Status: built and tested against Moneybird's own OpenAPI request schemas only. Nothing has been sent to a live
Moneybird administration yet. There is no Moneybird account or token yet.**

## What it sends

| Purser | Moneybird (API v2, `https://moneybird.com/api/v2/{administration_id}/…json`) |
|---|---|
| Supplier | `POST contacts`: `company_name`, `tax_number`, `bank_account` (IBAN), `country`, and `customer_id` = `PURSER-<id>` |
| Purchase invoice | `POST documents/purchase_invoices`: the supplier's number as `reference`, date, due date, currency, `prices_are_incl_tax: false`, and one detail per line (net price, mapped `tax_rate_id`, mapped `ledger_account_id`, optional `project_id`) |
| The PDF | `POST documents/purchase_invoices/{id}/attachments` (multipart, field `file`) |
| Payment | `POST documents/purchase_invoices/{id}/payments`: `payment_date`, `price`, and the Airwallex transfer id as `transaction_identifier`, so Moneybird can match the bank line |
| Journal entry | `POST documents/general_journal_documents`: `reference` = `Purser <id>`, with debit and credit per ledger account |
| Credit note (a correction) | the same lines with negative prices, reference `<number> (credit note)` |
| Paid or not | `GET documents/purchase_invoices/{id}`: its `state` and payments |

## How it behaves

- **Sent once.** The ERP sync (`docs/erp.md`) records Moneybird's id per object, so a second run sends nothing.
- **Lost answers.** If an answer was lost, Purser looks the object up before sending again:
  - a supplier by its `customer_id`;
  - an invoice by supplier and reference;
  - a payment by its transaction identifier;
  - a journal entry by its reference.
- **Totals checked.** Moneybird computes the VAT itself. Its totals on the answer must match the invoice to the cent.
  If they don't, the invoice waits for a person (`needs_review`), and nothing is paid against it.
  - The same goes for an invoice found without its PDF.
- **No guessing.** Purser refuses an account, VAT kind or cost centre that has no Moneybird counterpart, and names it.
  - It also refuses a ledger account that is not allowed on purchase invoices.
  - It also refuses a tax rate that is not a purchase rate.
- **Errors and limits.**
  - A 401 is tried once more, then stops.
  - A 429 waits out Moneybird's `Retry-After`, whether given as seconds, a date or a moment.
  - A 5xx is retried after looking first.
  - The limit is 150 requests per 5 minutes per IP address.
- **Other currencies.** A payment or journal entry in another currency than the administration's is refused for now.
  Moneybird needs the base-currency amount too (`price_base`).
- **Ids and money are exact.** Moneybird's ids go past 2^53, so they are read as strings. Amounts are sent as exact
  decimal strings.
- **Console.** The **Koppelingen** card in the settings shows the link's state: niet gekoppeld, gekoppeld or vraagt
  aandacht. It also shows the last sync and what was sent, failed or waits.
  - The card reads it from the sync results in the audit log.
  - The cloud never holds the token.

## Going live (Max)

1. **Account and administration.** Create a Moneybird account.
   - For testing first, use a sandbox administration: moneybird.com/administrations/sandboxes/new.
   - Note the administration's number from the web app's address.
2. **API token.** Create one at moneybird.com/user/applications/new.
   - Choose a **personal API token** with only the **`documents`** scope. That one scope covers purchase invoices,
     their payments and attachments, journal documents, contacts, ledger accounts and tax rates.
   - For customers later, register an **OAuth application** with the same scope (`documents`).
   - Moneybird's access tokens do not expire for now.
3. **Settings on the runner** (environment only, never in git or chat):
   - `ERP_MONEYBIRD_TOKEN`;
   - `ERP_MONEYBIRD_ADMINISTRATION_ID`;
   - `ERP_MONEYBIRD_TAX_RATES`, for example `{"NL21":"<id>","NL9":"<id>","NL0":"<id>"}`.
   - Optional:
     - `ERP_MONEYBIRD_GL_MAP` (a Purser account to a ledger account id; otherwise the codes are matched);
     - `ERP_MONEYBIRD_PROJECTS` (a cost centre to a project id);
     - `ERP_MONEYBIRD_IGNORE_COST_CENTRES=on`;
     - `ERP_MONEYBIRD_BASE_CURRENCY` (default EUR).
4. **Look before sending.** `npm run erp -- pull --connector moneybird --live` lists the ledger accounts and tax rates
   with their ids, for the maps above. `npm run erp -- sync --connector moneybird --dry-run` shows the requests without
   sending them.
5. **Confirm in the sandbox before a real administration:**
   - that a negative-price purchase invoice is the right correction;
   - Moneybird's VAT rounding on a few real invoices.

   Then `npm run erp -- sync --connector moneybird --live`.

Sources:
- developer.moneybird.com ("Welcome to Moneybird", "Authentication");
- Moneybird's OpenAPI file, version v2-20261110-3df079017e. The subset the tests use is in
  `test/fixtures/moneybird/openapi-subset.json`, rebuilt with `test/fixtures/moneybird/extract.py`.
