# Purser Payables: the invoice inbox (design)

Max, 8 November 2026: "a kind of inbox where PDFs come in, then check and do everything, process every invoice and
store it properly". Max said go for all four parts; this note records the decisions so the build can be checked against
them. Built on a branch; nothing is deployed until after 15 November (the submission freeze).

## Who it is for

E-commerce brands and wholesalers of 5 to 50 people that buy from suppliers abroad: tens to hundreds of supplier
invoices a month, several currencies, no big finance team. The demo company stays Northwind Outdoor.

## What success looks like

A supplier invoice (PDF) goes in; without anyone typing, it comes out as one of:

- **paid**: read, checked, approved by the CFO with Face ID, paid through Airwallex, booked;
- **waiting**: for the CFO's Face ID, or for a new supplier to be verified;
- **blocked**: with the reason in plain words (possible fraud, a duplicate, a total that does not add up).

Every document is kept, unchanged, and every step is in the audit log. The CFO sees what is due, what is blocked and
where the money goes.

## Rules that do not change

- Test money only: the Airwallex sandbox. No real card, no real account.
- Claude reads; code decides. A reading is used only when every key field is literally in the document.
- Every payment is approved with the CFO's Face ID (passkey), as today. **No auto-pay in v1**: a payment under a
  CFO-signed limit without Face ID would be a new way to approve money, so it is v2 and gets its own security review.
- A new supplier is never paid on the strength of its own invoice: its bank details are verified by a person on a
  contact we already had, then added with Face ID (the payee-change flow, E3, applied to a new payee).
- No secrets in code, git or logs. No outside calls in tests.

## The four parts

### 1. Inbox and storage (`src/ap/inbox.ts`, `src/ap/store.ts`)

- **Ways in:** upload on a local page; a watched folder (`npm run payables -- watch <dir>`); an e-mail saved as `.eml`
  (dropped in the folder or uploaded), whose PDF attachments are taken out. A live mailbox (IMAP or a mail-forwarding
  service) needs Max's choice of provider and its credentials: next step, not v1.
- **Storage:** each document is written once to `data/ap/docs/<sha256>.<ext>` and never changed; the ledger keeps its
  hash, name, size, source and time. The same file twice is recognised by its hash.
- **Text:** the PDF's text layer (library `unpdf`, pinned). A scan with no text layer is kept and marked
  "needs a person: no text in this PDF (scan)"; OCR is a later step.

### 2. Reading and checks (`src/ap/read.ts`, `src/ap/checks.ts`)

- **Reading:** Claude Sonnet through the existing reader (`ClaudeReader.ask`, cached system prompt, audit, cost)
  extracts: vendor, VAT id, invoice number, issue and due date, currency, subtotal, tax, total, IBAN, BIC, payment
  reference. Without a key, or when the reading fails the check, a multilingual parser (EN, NL, DE labels) reads the
  same fields from the text.
- **The reading check:** the invoice number, the total and the IBAN the model returns must appear in the document's
  text (after normalising spaces and number notation); otherwise the model's reading is not used.
- **Checks, each with a plain reason:**
  - *blocks:* duplicate (same document, or same vendor and invoice number, also against paid invoices); possible
    fraud (bank details differ from the supplier on file, a lookalike name, another account holder: the existing
    `assessAgainst`); subtotal plus tax differs from the total; a field needed to pay is missing.
  - *waits:* a supplier not on file yet (needs verification, below).
  - *warns:* the amount is far above this supplier's usual (more than twice the median of its earlier invoices); the
    due date has passed; a currency Purser cannot pay yet (only EUR is paid in v1; the rest is read and booked).
- **Status:** `received → blocked | needs_review | needs_vendor | ready → waiting_cfo → paid`, or `rejected`.

### 3. Paying (`src/ap/pay.ts`, `src/ap/vendors.ts`)

- **New supplier:** from an invoice, a *payee-add request* (changes nothing); a person records that the supplier
  confirmed the account on a contact we already had; a `payee_add` proposal carrying the full IBAN is approved with
  Face ID; its executor adds the account at Airwallex and to the ledger's beneficiaries. The invoices waiting for that
  supplier are checked again and become `ready`.
- **Paying a ready invoice:** the existing `proposeInvoicePayment` (reserve floors, FX for the shortfall only, the fee
  reserve, the duplicate guard) files an `invoice_payment` proposal; the CFO approves with Face ID; the existing
  executor pays by SWIFT. The inbox marks the invoice paid when the ledger's transfer for it is PAID.

### 4. Booking and insight (`src/ap/books.ts`, `src/ap/insights.ts`)

- **Booking:** on receipt, an accrual: debit the expense account (the supplier's default, or a suggestion from Claude
  that code accepts only from the chart), debit input VAT when there is tax, credit accounts payable. On payment: debit
  accounts payable, credit the bank. Two new accounts in the chart: 1510 input VAT, 1600 accounts payable.
- **Exports:** the journal as CSV (date, account, debit, credit, memo, document hash) and the invoices as CSV, for any
  bookkeeping package. A direct link to Exact, Moneybird or Xero needs their credentials: next step.
- **Insight (the BI):** open payables per currency; due in 7 and 30 days; overdue; blocked, with reasons; spend per
  supplier over 90 days; a supplier whose price rose (last invoice against its median); time from receipt to payment;
  the FX and SWIFT costs Airwallex actually charged.
- **Page:** `npm run payables` serves a local page on 127.0.0.1 (Origin check and a CSRF token, like the approvals
  page): upload, the list with status and reasons, one invoice with its document, the insight panel, the exports.

## Testing

Unit tests for the parser (EN, NL, DE invoices), the reading check (a planted line, a wrong total), every check, the
status machine, the payee-add flow (no payment before Face ID), booking (debits equal credits), insight figures and
the page (upload, CSRF, Origin). PDFs are made in the tests with `pdfkit`. The repo's full suite, typecheck and lint
stay green.

## Not in v1

Auto-pay under a CFO limit; OCR for scans; a live mailbox; direct links to bookkeeping packages; paying in currencies
other than EUR; several approvers per supplier.
