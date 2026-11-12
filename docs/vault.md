# The Purser vault

Every document the books hold, filed by itself in one clear folder tree that anyone can open without Purser: the
supplier's original invoices, a receipt for every payment, the month report, the quarter's VAT overview, the year
report and the suppliers list. No CSV to sort in Excel. Test money only: this build talks to the Airwallex sandbox, and
every page with a payment figure says so. Design: [the spec](superpowers/specs/2026-11-08-vault-design.md).

## The tree

```
Northwind Outdoor/
  2026/
    index.json                                         every file below, with its sha256
    Leveranciers 2026-11-08.pdf
    2026 Jaarrapport.pdf                               after the year close
    2026-Q4/
      Inkoopfacturen/Bergtex Textil GmbH/2026-11-02 BTX-2026-21 EUR 1850.00.pdf
      Inkoopfacturen/_Geblokkeerd/Bergtex Textil GmbH/2026-11-02 BTX-2026-22 EUR 1850.00.pdf
      Betalingen/2026-11-08 Bergtex Textil GmbH BTX-2026-21.pdf
      Rapporten/2026-11 Maandrapport.pdf               after the month close
      Rapporten/2026-Q4 Btw-overzicht.pdf              after all three months are closed
```

- **Inkoopfacturen**: the supplier's own PDF, byte for byte. Its sha256 is checked against the payables record before
  it is filed; a document that no longer matches is refused. Blocked or rejected invoices (possible fraud, a duplicate,
  a total that does not add up) go to `_Geblokkeerd`: kept, but not for booking.
- **Betalingen**: one receipt per paid invoice, for both payment kinds (the EUR invoice payment and the supplier
  payment in the invoice's own currency, FX payouts): the amount and currency, the supplier's account as approved
  (IBAN last four and BIC, or the masked account and its route), any currency exchange (rate, bought, sold), the Airwallex
  transfer and the fee Airwallex charged, who approved, how (Face ID: the passkey) and when, and the terms hash that
  approval signed. `npm run verify` re-checks every Face ID approval offline.
- **Rapporten**: the month report (received, paid, open, blocked with reasons, spend per supplier, fees and FX, the
  month's profit and loss), the VAT overview (the ledger's rubrics, with the notice that it is not a filing), and the
  year report (profit and loss before the closing entry, the balance sheet, the trial balance). Reports are made only
  for periods closed in the ledger (`npm run ledger -- close --month 2026-11`).
- **Leveranciers**: the suppliers on file on that day: name, the last four IBAN digits, BIC, status, number of invoices.

Names are safe on every system (no path tricks, no reserved characters, at most 120 characters per folder or file name)
and always the same for the same data. Dutch by default; `--lang en` makes the generated PDFs in English.

## Never overwritten, never deleted

Files are only ever added. The same data is never filed twice. When data changes after a document was filed (a late
correction), the new version is filed beside the original as `… (correctie).pdf`, then `(correctie 2)`. Each year's
`index.json` lists every file with its sha256, its kind and the hash of the data it was made from; it is the one file
that is rewritten. `npm run vault -- verify` re-hashes every file against it.

## For the accountant

Open the company folder; everything for a quarter is in that quarter's folder. Book from `Inkoopfacturen` (not from
`_Geblokkeerd`), match payments with `Betalingen`, and use the month reports and the VAT overview as the summary. A
document's sha256 in `index.json` shows it has not changed since it was filed.

## Running it

```bash
npm run vault -- build                                  # file everything new into data/vault
npm run vault -- build --dry-run                        # what would be added; writes nothing
npm run vault -- sync --to gdrive                       # the same tree in Google Drive
npm run vault -- sync --to onedrive                     # the same tree in OneDrive or SharePoint
npm run vault -- verify [--to local|gdrive|onedrive] [--year 2026]
npm run vault -- serve                                  # browse it: http://127.0.0.1:4600 (read-only)
```

The payables CLI (after `add`, `watch` and `sync`) and the ledger CLI (after `close`) file into the local vault by
themselves; `KIT11_VAULT=off` turns that off, and `KIT11_VAULT_DIR` moves the folder. A vault failure is recorded in the
audit log and never stops them. `KIT11_COMPANY` sets the top folder's name (default: Northwind Outdoor).

## Google Drive and OneDrive: what is needed

Nothing here has called Google or Microsoft yet: both sinks are built from the official documentation (each endpoint
is cited in `src/vault/gdrive.ts` and `src/vault/onedrive.ts`) and tested against fakes shaped like it. Tokens come from
the environment only, never from code, git, logs or the chat.

- **Google Drive** (Drive API v3): a Google Cloud project with the Drive API on, an OAuth client, and a token with the
  narrow `https://www.googleapis.com/auth/drive.file` scope (Purser sees only the files it made). The customer makes one
  folder for the vault and gives its id. Settings: `KIT11_GDRIVE_TOKEN`, `KIT11_GDRIVE_FOLDER_ID`.
- **OneDrive / SharePoint** (Microsoft Graph v1.0): an app registration in Microsoft Entra ID with `Files.ReadWrite`
  (a user's OneDrive) or `Files.ReadWrite.All` / `Sites.Selected` (a SharePoint library), and the drive id. Settings:
  `KIT11_GRAPH_TOKEN`, `KIT11_GRAPH_DRIVE_ID`. OneDrive does not always report a sha256; verify then reads each file
  back and hashes it.
- Getting and refreshing these tokens (the OAuth flow) is not built yet; a short-lived token in the environment works
  for a test.

## Not done yet

A sink to the cloud's own store (R2; the cloud is in `cloud/`, [cloud.md](cloud.md)), the OAuth flows for Drive and
OneDrive, sales invoices, PDF/A, signing the PDFs themselves, and OCR for scanned invoices (a scan is filed as it came
in).
