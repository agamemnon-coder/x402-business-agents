# Receivables on Airwallex Global Accounts, live in the sandbox (2026-10-30, evening)

On a copy of the recorded Friday run 1 ledger (the run itself unchanged), with the build/next code and the Airwallex
sandbox. `npm run receivables -- demo`, then `npm run receivables -- poll` until the simulated payments settled.

- **Global Accounts:** Northwind's EUR account (NL, SEPA) was already there; a GBP account (GB) was created for this run.
- **Invoices opened:** NW-R-101 Alpenweg Sport AG 1,240.00 EUR; NW-R-102 Fellside Outdoor Ltd 860.50 GBP;
  NW-R-103 Kustlijn Buitensport BV 510.00 EUR.
- **Payments**, simulated by the sandbox (`/simulation/deposit/create`) and read back from `/deposits` once SETTLED:

| Deposit | Amount | Reference | Result |
|---|---|---|---|
| `50f623ac…` | 1,240.00 EUR | "Invoice NW-R-101 Alpenweg" | MATCHED: NW-R-101 paid in full |
| `95fcf339…` | 860.50 GBP | "NW-R-102" | MATCHED: NW-R-102 paid in full |
| `5a6323a6…` | 500.00 EUR | "nw-r-103" | SHORT by 10.00 EUR: escalated; the rest stays open |
| `acf543d2…` | 25.00 EUR | "Payment" | UNMATCHED: no invoice; held in suspense for the CFO |

- **Books:** matched payments are wholesale revenue (4200) in their own currency (EUR on 1200, GBP on 1202); the
  unknown 25.00 EUR waits in suspense (2900). Each deposit is recorded once, by its Airwallex id.
- **What is simulated:** the retailers and their payments (the sandbox's deposit simulation). The Global Accounts,
  the deposits and their ids are Airwallex's.
