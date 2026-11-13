# Purser Vault: every document in one clear place (design)

> **Status, 12 November 2026:** this is the design note of 8 November, kept as written. Where it says "on a branch" or
> "nothing is deployed", it describes that day. The code is now in this repository, and a hosted preview exists but is
> private (behind an access key), with no customer: [after-the-kit.md](../../../after-the-kit.md).

Max, 8 November 2026: "instead of CSV to Excel, everything stored by itself in a nice, clear place, as PDF, like a
Drive; or even tidier." The vault is that place: a fixed folder tree, the same on a laptop, in the cloud (R2, later)
and in a customer's Google Drive or OneDrive, that an accountant can open without Purser. Built on branch `vault`,
which merges the payables inbox (#107) and the bookkeeping core (#108). Nothing is deployed.

## The layout

```
<Company>/
  <YYYY>/
    index.json                                   every file below, with its sha256 (rewritten as files are added)
    Leveranciers <YYYY-MM-DD>.pdf                the suppliers on file on that day (last IBAN digits only)
    <YYYY> Jaarrapport.pdf                       after the year close
    <YYYY>-Q<n>/
      Inkoopfacturen/<Supplier>/<YYYY-MM-DD> <invoice no> <CUR amount>.pdf      the original, byte for byte
      Inkoopfacturen/_Geblokkeerd/<Supplier>/...                              blocked or rejected: not for booking
      Betalingen/<YYYY-MM-DD> <Supplier> <invoice no>.pdf                     the payment receipt
      Rapporten/<YYYY-MM> Maandrapport.pdf                                    after the month close
      Rapporten/<YYYY>-Q<n> Btw-overzicht.pdf                                 after all three months are closed
```

- Names are safe on every system: no path separators, no reserved characters (`<>:"/\|?*`, control characters), no
  leading or trailing dots or spaces, at most 120 characters per segment. The same data always gives the same name.
- An invoice is filed under its own date (issue date, else the date it was received), a payment under the day it was
  paid, a report under its period.
- Two different documents that would get the same name get the payables id added: ` (AP-0007)`.

## The documents

- **Invoices:** the supplier's original PDF, copied byte for byte from the payables store; its sha256 is checked
  against the ledger's record before it is filed. Never re-rendered.
- **Payment receipt** (generated): supplier, invoice, amount, FX if any (rate, bought, sold), the Airwallex transfer
  id and its fee, who approved, how (Face ID: the passkey) and when, the terms hash the approval signed, and how to
  check it (`npm run verify` re-checks every passkey approval offline).
- **Month report** (generated): invoices received, paid, open and blocked (with reasons) in the month; spend per
  supplier; SWIFT fees and FX; the month's profit and loss from the ledger.
- **VAT overview** (generated): the ledger's VAT rubrics for the quarter, with the ledger's own notice that it is an
  overview, not a filing.
- **Year report** (generated): profit and loss for the year (before the closing entry), the balance sheet on the last
  day, the trial balance.
- **Suppliers** (generated): name, last four IBAN digits, BIC, status, how many invoices.
- Dutch by default; English with `--lang en`. Every page with a figure from Airwallex says "Testgeld (Airwallex
  sandbox)": this build only talks to the sandbox. Every figure is read from the ledger or the payables tables.
- Generated PDFs are deterministic (fixed creation date from the data), so the same data gives the same bytes.

## Never overwritten, never deleted

- Each generated document has a key (`receipt:AP-0003`, `month:2026-11`, ...) and the sha256 of the data it was made
  from. Running again with the same data does nothing. When the data changed (a late correction in the ledger), the new
  version is a new file with ` (correctie)` (then ` (correctie 2)`) in its name; the old one stays.
- A file already in the vault with the same sha256 is not uploaded again. `index.json` is the one file that is
  rewritten: it lists everything.
- `verify` re-hashes every file against `index.json`.

## Where it is written (VaultSink)

- **Local folder** (default `data/vault/`): files written once (`wx`) and made read-only.
- **Google Drive** (Drive API v3) and **OneDrive / SharePoint** (Microsoft Graph): built from the official docs, with
  fakes shaped like them; tokens from the environment only. No live call has been made.

## When it runs

`npm run vault -- build|sync --to local|gdrive|onedrive [--dry-run]`, `verify`, `serve` (a read-only page on
127.0.0.1 to browse the folders and open the PDFs). The payables CLI (after `add` and `sync`) and the ledger CLI (after
`close`) also file into the local vault, unless `KIT11_VAULT=off`; a vault failure never stops them.

## Not in this version

The cloud's R2 sink (the backend branch), OAuth flows to get Drive or OneDrive tokens, sales invoices, a PDF/A
archive format, signing the PDFs themselves.
