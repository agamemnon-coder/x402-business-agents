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
   check: changed bank details, a lookalike name, another account holder), an IBAN that fails its checksum, an account
   number or routing code that fails its country's format (an ABA checksum, an 8-digit UK account, a 6-digit sort
   code), a total that is not subtotal plus tax. A person: a scan without text, a missing field, a currency Purser cannot
   pay or a bank country it has no payout guide for, a credit note, a receipt. Waits: a supplier not on file. Warns: an amount over twice the supplier's usual, a passed due date.
5. **A note.** On every irregular invoice Claude Opus writes a short note for the person who decides (the code's own
   reasons without a key). Advisory only: it is shown on the page and with the payment proposal and never changes a
   status.
6. **A new supplier** is requested from its invoice, verified by a person on a contact already on file (with its
   address), and approved by the CFO with Face ID (`payee_add`; two people with four eyes on). Only then is it added at
   Airwallex, and its waiting invoices are checked again.
7. **Paid.** A ready invoice is paid in its own currency (see below) and waits for the CFO's Face ID on the phone. It
   is marked paid once Airwallex's transfer is PAID.
8. **Booked.** On receipt, once checked clean: expense and input VAT against accounts payable, in the invoice's
   currency. When paid: accounts payable against that currency's bank account (1200 EUR, 1201 USD, 1202 GBP, 1203 the
   others), the conversion if one was needed (the sold currency out and the bought currency in through money in
   transit, 1590, with the rate and quote in the memo), and the fee Airwallex charged, in the currency it was charged
   in. Debits equal credits in every entry and in every currency.

## Paying suppliers abroad

Design: [superpowers/specs/2026-11-08-fx-payouts-design.md](superpowers/specs/2026-11-08-fx-payouts-design.md). Each
rule cites the Airwallex guide it comes from in `src/payouts/routes.ts`.

| Bank country | Paid by | Account details |
| --- | --- | --- |
| United States | USD by ACH (LOCAL); other currencies by SWIFT | account number and ABA routing number (checksum checked); SWIFT: account number and BIC |
| United Kingdom | GBP by Faster Payments (LOCAL); EUR to a GB IBAN (LOCAL); others by SWIFT | 8-digit account and 6-digit sort code, or a GB IBAN |
| China | CNY and others by SWIFT only | account number (8 to 34 characters) and BIC |
| Turkey | TRY to a TR IBAN (LOCAL); others by SWIFT | TR IBAN (26 characters, checksum checked) |
| Netherlands | EUR to an NL IBAN (LOCAL); others by SWIFT | NL IBAN (18 characters, checksum checked) |
| Germany | EUR to a DE IBAN (LOCAL); others by SWIFT | DE IBAN (22 characters, checksum checked) |

- **Currencies:** the two-decimal currencies SWIFT carries at Airwallex: AUD, CAD, CHF, CNY, CZK, DKK, EUR, GBP, HKD,
  HUF, ILS, NOK, NZD, PLN, RON, SEK, SGD, THB, TRY, USD, ZAR. Any other currency (JPY has no decimals) goes to a person.
- **A new supplier** in any of these countries keeps the three steps: requested from its invoice, verified by a person
  on a contact already on file, and approved by the CFO with Face ID, who sees the full account number and routing code.
  The fraud checks are unchanged and now compare every account on file, IBAN or not: an invoice from a known supplier
  with another account is blocked as possible fraud.
- **The plan:** paid from the balance Airwallex holds in the invoice's currency. If that balance is short, only the
  shortfall plus the fee reserve is bought from the funding currency (`payout.funding_currency`, EUR by default), on a
  locked quote no dearer than the market's rate plus the existing markup cap, and only from money above the funding
  currency's floor and commitments. Each currency's floor is `floor.<CUR>` (EUR and USD keep `eur_floor` and
  `usd_floor`); each method's fee reserve is `fee_reserve.<LOCAL|SWIFT>.<CUR>`. All three are rules in the CFO's policy
  (`src/policy/rules.ts`): shown with the policy for the currencies in use, bounded (a floor from 0 up; a fee reserve at
  most ten times the SWIFT default in that currency; the funding currency one Purser pays), and changed only through an
  approved `policy_change` (Face ID). Lowering a floor or a fee reserve, or changing the funding currency, loosens the
  policy, so the phone cannot do it alone.
- **Per-payout limits** from the guides' "Maximum transaction limit" rows are checked when the payment is planned,
  before any rate, quote or conversion: US ACH 15,000,000 USD, UK Faster Payments 1,000,000 GBP, local TRY 250,000
  (at least 1 TRY). Local EUR (SEPA) and SWIFT state no limit. An invoice above its route's limit goes to a person.
- **What the CFO signs** (`supplier_payment`): amount and currency, the method, the masked account, the fee reserve,
  and the conversion (sell, buy, rate, quote expiry). The executor checks the approved hash, the quote's expiry, the
  floors and the supplier again before anything moves; a lost answer from Airwallex is resolved by looking the request
  up, never by sending again.
- **Which path an EUR invoice takes:** a supplier added before this change (a Kit 11 payee, IBAN and BIC only) is paid
  through `invoice_payment` exactly as before. An EUR invoice from a supplier added through the inbox is paid through
  `supplier_payment`: EUR by SEPA (LOCAL) from the EUR balance. That path converts only from the funding currency, and
  with the default funding currency (EUR) an EUR invoice is never funded from USD the way `invoice_payment` funds it:
  when the EUR balance above its floor and commitments is short, the payment escalates to a person (add EUR, lower the
  floor or change the funding currency with Face ID, or pay later).

## What still needs a person

- An invoice in a currency Purser cannot pay, or to a bank country with no payout guide in `src/payouts/routes.ts`
  (adding a country is a table row plus its guide's rules and a test).
- CNY to a Chinese account by LOCAL: Airwallex needs declarant information and the names in Chinese characters, which
  an invoice does not give. Purser pays CNY by SWIFT instead.
- An invoice above its route's per-payout limit (a split, or another route, is agreed with the supplier).
- A payout whose answer was lost and that Airwallex does not list yet: its proposal fails, its invoice stays waiting
  (never offered for payment again) and its row stays under way until a re-run of the same proposal finds it, or
  `npm run reconcile` settles it. A conversion whose answer was lost keeps its hold on the funding currency the same
  way.

## To confirm in the Airwallex sandbox

Points the documentation leaves open; each is a setting or a single line, not a redesign.

1. **Fee reserves.** The SWIFT defaults (EUR 20, USD 25, GBP 20, CHF 25, CNY 200, TRY 1,000, others 25) are safety
   margins, not Airwallex's fees, and LOCAL is assumed to cost nothing. Check the fees charged on sandbox payouts and
   set `fee_reserve.*` to match.
2. **Fee currency.** The fake charges the fee in the transfer's currency; check whether Airwallex charges it there or in
   the account's settlement currency, and book accordingly.
3. **UK by SWIFT.** The UK guide lists a GB IBAN for SWIFT with no `swift_code` field; confirm a SWIFT payout to a GB
   IBAN is accepted without a BIC.
4. **NL account currency.** The Netherlands guide's "Local EUR payout" table permits all 22 currencies for
   `account_currency` (the German and UK guides say "Should be `EUR`"); Purser sends EUR only. Confirm that is what the
   sandbox expects.
5. **Address country.** The beneficiary's address country is taken to be the bank's country; confirm Airwallex accepts
   that for a supplier whose office and bank are in different countries, or ask for the address country at
   verification.
6. **Schema check.** `createPayoutBeneficiary` asks `/beneficiaries/schema` and `/beneficiaries/validate` before
   creating; confirm both answer for each route in the table above.

### Hardening after the independent review and red team (8 November)

- **A model's reading** is used only when the document's own total line, currency, invoice number, IBAN, subtotal and
  tax agree with it. No total line code can read, or a currency the lines leave open: a person decides. A euro sign in a
  footer never makes another currency's invoice EUR; an IBAN is read at its country's length (ISO 13616), so a BIC on
  the same line is not read into it.
- **Duplicates:** a number written differently (`BTX-2026-021`, `BTX/2026/21`, a zero-width space) is a possible
  duplicate for a person; the same supplier and total dated within a week is too. Only earlier invoices count, so a
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

### Red team of the FX payouts (8 November)

- **No second payout after a lost answer.** The payout follows Kit 11's discipline (`submitTransfer`): a row with a
  transfer id is fetched; a row Airwallex refused is closed and never sent again under its request_id; a row written
  before is looked up strictly by request_id before anything is sent; a row is closed as refused only on its first send
  and only for Airwallex's documented 400 refusals; a `duplicate_request` answer resolves the transfer Airwallex holds.
  A failed proposal whose payout may be live never puts its invoice back to ready.
- **The floor on every send.** Whenever no transfer exists yet, the floor is checked again on fresh balances, whatever
  an earlier attempt began; the same for a conversion a re-run has to make after all.
- **Payments at the same time.** The balances are read, judged and what the payment speaks for is held
  (`payout_reservations`: the conversion on its way, the payout not yet written) in one step, before another payment can
  read them; `freeCents` counts those holds. Within one process (the runner executes approvals).
- **A new supplier once.** Before creating a beneficiary, Purser looks for one with the same name, method and account
  details at Airwallex (an earlier create whose answer was lost) and adopts it (`payee.adopted`).
- **The phone page** for a new supplier paid to an IBAN names the currency and method too.

## What is real, what is not in v1

- Real: the reading and checks, the documents and the ledger, the payments in the Airwallex sandbox, Face ID.
- Not yet: paying without Face ID under a limit; reading scans (OCR); a live mailbox; direct links to bookkeeping
  packages; several approvers per supplier; FX booking for the Kit 11 EUR invoice payment's conversions (they are in
  the treasury ledger, not in the payables books).

## Where the next parts plug in

- **A live mailbox:** a poller hands each message's raw bytes to `ingestEmail` (`src/ap/inbox.ts`); the MIME parsing is
  its own function, `parseEml` (`src/ap/eml.ts`).
- **Bookkeeping packages:** implement `BookkeepingSink` (`src/ap/books.ts`); the CSV file sink is the first. A sink that
  fails is logged and never stops the inbox or a payment.
- **An API for companies:** the page's JSON routes are under `/api/payables/...` (`src/servers/payables.ts`); the same
  handlers can sit behind the authenticated agent API, with `source: "api"` on `ingestDocument`.
- **Accounts:** the payables accounts (1510 input VAT, 2100 accounts payable, 1203 other-currency balances) are in
  `AP_CHART`, outside the chart the T:0 sink mirrors, until T:0 has them.
