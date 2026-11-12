# Run record template: invoice token on Metal testnet

The form of the run record. After the run, `npm run tokenize -- record` writes it as `docs/runs/<date>-tokenize.md`
and `.json` from the run's own ledger and call log: **only what ran**, no figure typed by hand. The words only a
person knows come from the operator: Max's go (`TOKENIZE_GO_NOTE`) and what did not go as planned
(`TOKENIZE_DEVIATIONS`). Test money only; the financier is simulated. ([What this is](tokenize.md) ·
[the runbook](runs/driver/tokenize-runbook.md))

## Before the run

- **Max's go:** (who, time, words; without `TOKENIZE_GO_NOTE` the record says only that `TOKENIZE_GO` was set)
- **Call budget:** ___ Metal RPC calls for the whole run, funding the four test keys included
  (`TOKENIZE_CALL_BUDGET_TOTAL`). `npm run tokenize -- preflight` prints the calls each step needs.
- **Invoice:**
  - proposal ___ in ledger ___
  - document ___ (SHA-256 ___)
  - approved by ___: the CFO's Face ID on a phone, or a labelled virtual test passkey; say which
  - status of the proposal in the source ledger ___ (`EXECUTED`: already paid there; the token run reuses the approval)
- **Face value:** invoice amount ÷ ___ = ___ *USDZ (test money, no exchange rate)
- **Keys:** issuer ___, creditor ___, financier (simulated) ___, payer ___ (addresses only)

## Transactions

| Step | Transaction | Result |
|---|---|---|
| Fund the four test keys (one row each) | | |
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
