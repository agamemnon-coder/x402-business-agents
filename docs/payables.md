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

`list`, `show <id>`, `insights`, `pay <id>`, `sync`, `supplier-request <id>`, `supplier-verify <N-id> ...`, `not-duplicate <id> ...`,
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

### Hardening after the independent review and red team (8 November)

- **A model's reading** is used only when the document's own total line, currency, invoice number, IBAN, subtotal and
  tax agree with it. No total line code can read, or a currency the lines leave open: a person decides. A euro sign in a
  footer never makes another currency's invoice EUR; an IBAN is read at its country's length (ISO 13616), so a BIC on
  the same line is not read into it.
- **Duplicates:** a number written differently (`BTX-2026-021`, `BTX/2026/21`, a zero-width space) is a possible
  duplicate for a person; the same supplier and total dated close together is too (see round 2). Only earlier invoices count, so a
  resent copy never blocks its original. A reminder is never paid on its own: it is blocked as the copy of an invoice on
  file, or goes to a person.
- **Credit notes** written as a negative or bracketed total are never paid; storno and correction keywords mark one.
- **E-mail:** at most 20 PDFs per e-mail (the rest refused with the reason), one bad attachment does not stop the others,
  an e-mail inside an e-mail is not opened. A PDF over 200 pages or taking over 10 s is refused; models get at most
  50,000 characters (the checks still read the whole text).
- **Books:** each event reaches the sink once (`ap_sink_events`); an accrual the sink missed is pushed before the
  payment, and a rejected payment's accrual is reversed there. Supplier adds run with the configured sink.
- **Stuck states:** a proposal that expired, was rejected, superseded or needs reapproval puts its invoice back to ready
  and closes its supplier request (`CLOSED`), so a new one may follow.

### Red team round 2 (8 November)

The rule behind every fix: the code's own reading of the document is the authority; anything ambiguous goes to a
person; nothing is guessed.

- **Currency** comes from the total line only; when that line names none, from the subtotal and tax lines when they
  agree. Never from the rest of the text. A currency code does not know on the total line (`kr`, `Kč`, `Fr.`, `zł`,
  `ISK`, a lower-case `sek`) leaves the currency empty: a person decides.
- **Which total:** labels are ranked (amount due, balance due, amount payable, to pay, te betalen, zu zahlen, à payer
  first; a bare "Total" last). Total lines with different amounts (a deposit, an early-payment discount, a line item
  that starts with "Total") go to a person with every amount named (`ambiguous_total`). "Total excl. VAT" is a
  subtotal, "Total VAT" a tax line.
- **Lookalike numbers:** the loose duplicate key folds lookalike letters (the fraud check's confusables: Cyrillic
  "В"), every script's digits ("٢٠٢٦") and O/0, I/l/1. A number the document's own lines cannot read is never taken
  from a model. The same supplier and total within 45 days (was a week) waits for a person as a possible duplicate.
- **Monthly invoices** (rent, a subscription) with the same total and a new number therefore wait once: a person clears
  the pair, with who and why, in `ap_duplicate_clearances` and the audit log (`ap.duplicate_cleared`). On the page this
  needs the code shown in the terminal that runs it; in the CLI (`not-duplicate <id> --by ... --note ...`) the person
  types the invoice's total back. A match on the invoice number itself is never cleared this way.
- **Credit notes and reminders** are flagged when either the keyword rules or the model say so: a model that calls a
  "Gutschrift" or a reminder an invoice cannot make it payable. A minus after the amount (`1,850.00-`), `CR`, and every
  Unicode dash before it mark a credit; so do avoir, nota di credito, abono, refund and rimborso.
- **PDFs** are read in a worker thread with a 256 MB heap, stopped after 10 s (a busy pdf.js cannot be interrupted on
  the main thread). Before that, the compressed streams are inflated against a budget (64 MB together, deflate inside
  deflate included): a deflate bomb is refused with the reason and the process stays up. The watched folder checks a
  file's size before reading it.
- **The page:** a malformed file name is a 400; a document is served with `default-src 'none'; sandbox`. Recording that
  a person verified a new supplier's bank details needs a code shown only in the terminal that runs the page
  (`POST .../verify-code`, six digits, ten minutes, three tries, used once) and the IBAN's last four characters typed
  back; the page token alone is not enough. The CLI's `supplier-verify` asks for the last four interactively. Either
  way the CFO's Face ID still gates the add.
- **What the CFO signs:** the payment terms carry the document's own total line (sanitised, at most 120 characters) and
  the currency read from that line; the approval screen shows both and warns when that currency is not the one paid.

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
