# Payables: suppliers in any country, paid in their own currency (design)

> **Status, 12 November 2026:** this is the design note of 8 November, kept as written. Where it says "on a branch" or
> "nothing is deployed", it describes that day. The code is now in this repository, and a hosted preview exists but is
> private (behind an access key), with no customer: [after-the-kit.md](../../../after-the-kit.md).

Max, 8 November 2026: the first customers are Dutch SMEs (e-commerce, wholesale) that buy from suppliers in China,
Turkey, the US and the UK. The inbox (#107) pays EUR only, and a new supplier can only have a German IBAN, because the
Airwallex beneficiary code was written for the Kit 11 manufacturer. This change pays a supplier in the invoice's own
currency, to an account in the supplier's own country, on Airwallex's local rails where they exist. Test money only;
no live Airwallex call in tests; nothing deployed.

## Sources (read 8 November 2026)

- Bank details per country and method: the payout network guides,
  `https://www.airwallex.com/docs/payouts/payout-network/bank-accounts/{united-states,united-kingdom,china,turkey,netherlands,germany}.md`.
- Creating and validating a beneficiary, the `beneficiary.bank_details` fields and `transfer_methods`:
  `https://www.airwallex.com/docs/payouts/beneficiaries/create-beneficiaries.md`,
  `https://www.airwallex.com/docs/payouts/beneficiaries/validate-a-beneficiary.md`.
- Creating a transfer (`transfer_method`, `transfer_currency`, `source_currency`, `transfer_amount`, `reason`):
  `https://www.airwallex.com/docs/payouts/transfers/create-a-transfer.md`.
- China's LOCAL CNY rules: `https://www.airwallex.com/docs/payouts/transfers/transfers-to-from-countries-with-regulatory-requirements.md`.
- Currency precision: `https://www.airwallex.com/docs/payouts/how-airwallex-payouts-work/currency-precision.md`.

## Decisions

1. **A route table in code** (`src/payouts/routes.ts`), one entry per country we have read the guide for: US, GB, CN,
   TR, NL, DE. Each names its LOCAL routes (currency, clearing system, required bank details) and its SWIFT route
   (the 22 SWIFT currencies, required bank details). A country not in the table is not paid by Purser yet: a person
   adds it from its guide. Airwallex's own `/beneficiaries/schema` and `/beneficiaries/validate` still run before a
   beneficiary is created (as today): the table is our check first, not instead.
2. **Code checks bank details before anything is sent**: IBAN country, length and mod-97; ABA routing number with its
   checksum; UK sort code (6 digits) and account number (8 digits); BIC shape and its country letters; account number
   length per route. A failure blocks with the reason; nothing reaches Airwallex.
3. **LOCAL where the guide offers it, else SWIFT.** China is the exception: LOCAL CNY needs declarant and order
   information and a Chinese-character account name (the regulatory guide), so CN is paid by SWIFT only (CNY or USD),
   and the beneficiary declares to its own bank, as the guide says.
4. **Only currencies with two decimals** are paid (our cents model; JPY and others with 0 or 3 decimals are read and
   booked, paid by a person).
5. **A new supplier, any country**: the same three steps as today (request, a person's out-of-band verification, the
   CFO's Face ID). The request carries the full bank details; the payee_add terms show them; the executor creates the
   beneficiary for the chosen route.
6. **One account identity** for the fraud check: an IBAN where there is one (the same hash as today), else
   country + routing + account number. Changed details on a known supplier, a lookalike name, another account holder:
   blocked, as today, now for every currency.
7. **Paying** (`supplier_payment`, a new proposal kind; the Kit 11 `invoice_payment` path and its figures stay as they
   are): plan from the balances Airwallex holds. Need = amount + the fee reserve for the method. Free = available −
   the currency's floor − payouts under way (EUR also minus its commitments, as today). Short: convert only the
   shortfall from the funding currency the CFO policy names (`payout.funding_currency`, default EUR), on a locked quote,
   with today's markup check against the market rate and the funding currency's own floor. The terms the CFO signs show
   amount, currency, method, the masked account, the conversion (sell, buy, rate, quote expiry) and the fee reserve.
   The executor re-checks the approved hash, the holds, the payee and the floors, converts under its request_id, then
   pays under its request_id; a lost answer is resolved by a strict look-up by request_id, never a blind resend.
8. **Floors and fee reserves per currency** are settings (`floor.<CUR>`, `fee_reserve.<METHOD>.<CUR>`); EUR and USD keep
   `eur_floor` and `usd_floor`. The fee reserve defaults are safety margins, not fee claims, and are marked to confirm in
   the sandbox.
9. **Books**: a foreign-currency invoice is booked in its own currency; its payment comes out of that currency's bank
   account; a conversion that funded it is booked in both currencies through money in transit (1590), so every entry
   balances per currency.

## Not in this change

LOCAL CNY (declarant flow); countries outside the table; currencies without two decimals; paying several invoices in
one batch; fees paid by the beneficiary.
