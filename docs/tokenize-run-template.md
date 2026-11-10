# Run record template: invoice token on Metal testnet

Fill this in **only with what ran**. Copy it to `docs/runs/<date>-tokenize.md` after the run, then link it from
`docs/runs/README.md` and `/runs`. Test money only; the financier is simulated. ([What this is](tokenize.md))

## Before the run

- **Max's go:** (time, words)
- **Call budget:** ___ Metal RPC calls for the tokenize commands, plus ___ for funding the four test keys. Estimate:
  about 29 for the commands and up to 12 for funding (see the PR).
- **Invoice:**
  - proposal ___ in ledger ___
  - document ___ (SHA-256 ___)
  - approved by ___: the CFO's Face ID on a phone, or a labelled virtual test passkey; say which
- **Face value:** invoice amount ÷ ___ = ___ *USDZ (test money, no exchange rate)
- **Keys:** issuer ___, creditor ___, financier (simulated) ___, payer ___ (addresses only)

## Transactions

| Step | Transaction | Result |
|---|---|---|
| Deploy PurserInvoiceToken | | |
| Mint to the creditor | | |
| Offer to the financier | | |
| Financier approves the price | | |
| Financier accepts: advance to the creditor | | |
| Debtor approves the face value | | |
| Debtor settles: face value to the holder, token burned | | |

## Checks

- `verify`: the chain record matches the ledger and the document. (yes/no, output)
- The creditor received ___ *USDZ, and the financier received ___ *USDZ at settlement.
- Calls used: ___ of ___ (from `TOKENIZE_CALL_LOG`).

## What did not go as planned

(Every stop, refusal or deviation, plainly.)
