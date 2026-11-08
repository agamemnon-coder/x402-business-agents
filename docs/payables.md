# Payables: the invoice inbox

Built after the hackathon submission (8 November 2026), on its own branch; not part of the submitted run or the live
site. Design: [superpowers/specs/2026-11-08-payables-inbox-design.md](superpowers/specs/2026-11-08-payables-inbox-design.md).
Test money only: the Airwallex sandbox.

Supplier invoices come in as PDFs; Purser reads them, checks them, files the payment for the CFO's Face ID and books
them. Every document is kept unchanged; every step is in the audit log.

## Run it

```bash
npm run payables
```

Opens the local page on http://127.0.0.1:4400: drop PDFs or saved e-mails (.eml) on it, see each invoice's status and
reasons, the insight panel and the CSV exports. The same from the command line:

```bash
npm run payables -- add invoice.pdf mail.eml
```

```bash
npm run payables -- watch ./inbox
```

`list`, `show <id>`, `insights`, `pay <id>`, `sync`, `supplier-request <id>`, `supplier-verify <N-id> ...`,
`supplier-propose <N-id>` and `export journal|invoices` are listed at the top of `src/cli/payables.ts`. The ledger is
`KIT11_DB` (default `data/kit11.sqlite`); documents go to `KIT11_AP_DIR` (default `data/ap`). Without
`KIT11_ANTHROPIC_API_KEY` the keyword rules and the parser read instead of Claude; without Airwallex sandbox keys,
paying is off.

## What happens to an invoice

1. **In.** Upload, a watched folder or an e-mail: all call one entry point, `ingestDocument`. The PDF is written once to
   `data/ap/docs/<sha256>.pdf`; the same file twice is recognised by its hash.
2. **What is it?** Claude Haiku labels it (invoice, credit note, receipt, reminder, other); code accepts only those five,
   else keyword rules decide. Only an invoice, a credit note or a reminder is read in full.
3. **Read.** Claude Sonnet reads the fields and suggests an expense account. Its reading is used only when the invoice
   number, the total and the IBAN are written in the document and agree with the parser; else the parser's reading is
   used and the audit log says why. The account is accepted only from the chart.
4. **Checked.** Blocks: a duplicate (also a reminder for an invoice already filed or paid), possible fraud (the existing
   check: changed bank details, a lookalike name, another account holder), an IBAN that fails its checksum, a total that
   is not subtotal plus tax. A person: a scan without text, a missing field, a currency other than EUR, a credit note, a
   receipt. Waits: a supplier not on file. Warns: an amount over twice the supplier's usual, a passed due date.
5. **A note.** On every irregular invoice Claude Opus writes a short note for the person who decides (the code's own
   reasons without a key). Advisory only: it is shown on the page and with the payment proposal and never changes a
   status.
6. **A new supplier** is requested from its invoice, verified by a person on a contact already on file (with its
   address), and approved by the CFO with Face ID (`payee_add`; two people with four eyes on). Only then is it added at
   Airwallex, and its waiting invoices are checked again.
7. **Paid.** A ready EUR invoice goes through the existing invoice payment (reserve floors, FX for the shortfall, the
   fee reserve) and waits for the CFO's Face ID on the phone. It is marked paid once Airwallex's transfer is PAID.
8. **Booked.** On receipt, once checked clean: expense and input VAT against accounts payable. When paid: accounts
   payable against the bank, and the SWIFT fee Airwallex charged. Debits equal credits in every entry.

## What is real, what is not in v1

- Real: the reading and checks, the documents and the ledger, the payments in the Airwallex sandbox, Face ID.
- Not in v1: paying without Face ID under a limit; reading scans (OCR); a live mailbox; direct links to bookkeeping
  packages; paying in currencies other than EUR; adding non-German accounts at Airwallex (the existing payee code's
  limit); several approvers per supplier.

## Where the next parts plug in

- **A live mailbox:** a poller hands each message's raw bytes to `ingestEmail` (`src/ap/inbox.ts`); the MIME parsing is
  its own function, `parseEml` (`src/ap/eml.ts`).
- **Bookkeeping packages:** implement `BookkeepingSink` (`src/ap/books.ts`); the CSV file sink is the first. A sink that
  fails is logged and never stops the inbox or a payment.
- **An API for companies:** the page's JSON routes are under `/api/payables/...` (`src/servers/payables.ts`); the same
  handlers can sit behind the authenticated agent API, with `source: "api"` on `ingestDocument`.
- **Accounts:** the payables accounts (1510 input VAT, 2100 accounts payable) are in `AP_CHART`, outside the chart the
  T:0 sink mirrors, until T:0 has them.
