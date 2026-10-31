# Data QA: the recorded ledger against Airwallex, Metal and the Books

Made by `npm run data-qa` (`src/cli/dataQa.ts`) on 2026-10-31T08:01:53.794Z. Every payment in the ledger `data/hooks-1.sqlite` up to audit row 194
(194 rows read; row 194 has the head the pages show for Friday run 1, 30 October 2026, with a Dispute desk case afterwards, `ee0732445a71…`; 11 later rows left out) is compared with Airwallex (read-only GET by id: status, amount, currency), with
Metal testnet (the transaction exists and succeeded and carries the *USDZ transfer with the ledger's amount, payer and
payee) and with the Books (`src/accounting/books.ts`: the double-entry postings for that ref). Nothing was created,
moved or approved, and nothing was fixed.

- **Airwallex:** sandbox reached with the environment's keys; GET requests only.
- **Metal:** Metal testnet reached (head block 10584372); eth_ reads only.

## Summary

A check is one payment on one side. Mandate binds and replaces move no money, so they have no Books side; a refused
purchase and a declined card charge must have no transaction and no posting.

| Kind | Payments | Checks | Matched | Differences | Skipped |
|---|---:|---:|---:|---:|---:|
| Airwallex transfer | 1 | 2 | 2 | 0 | 0 |
| Airwallex conversion | 1 | 2 | 2 | 0 | 0 |
| Airwallex deposit | 1 | 3 | 3 | 0 | 0 |
| Airwallex card transaction | 4 | 8 | 8 | 0 | 0 |
| Metal funding | 1 | 2 | 2 | 0 | 0 |
| Metal sale | 50 | 100 | 100 | 0 | 0 |
| Metal upstream purchase | 51 | 102 | 102 | 0 | 0 |
| Metal refund | 3 | 6 | 6 | 0 | 0 |
| Metal sweep | 1 | 2 | 2 | 0 | 0 |
| Metal mandate | 6 | 6 | 6 | 0 | 0 |
| **All** | **119** | **233** | **233** | **0** | **0** |

### Per side

| Kind | Airwallex | Metal | Books |
|---|---|---|---|
| Airwallex transfer | 1/1 match | n/a | 1/1 match |
| Airwallex conversion | 1/1 match | n/a | 1/1 match |
| Airwallex deposit | 1/1 match | 1/1 match | 1/1 match |
| Airwallex card transaction | 4/4 match | n/a | 4/4 match |
| Metal funding | n/a | 1/1 match | 1/1 match |
| Metal sale | n/a | 50/50 match | 50/50 match |
| Metal upstream purchase | n/a | 51/51 match | 51/51 match |
| Metal refund | n/a | 3/3 match | 3/3 match |
| Metal sweep | n/a | 1/1 match | 1/1 match |
| Metal mandate | n/a | 6/6 match | n/a |

## Differences

None.

## Notes on the ledger

- **Airwallex card transaction `01a18bb9-6320-7000-8874-90025a882c13`**: the audit row (seq 168) names this charge 7edb809a-48d4-440e-ab1f-3805645fd605, not the ledger's id.

## Skipped

None.

## What each side answered for the Airwallex payments

- **Airwallex transfer `4d508b0b-ef38-41d3-b96e-f6cc3f5cfeb4`**: ledger EUR 1850.00 for invoice BTX-2026-11, PAID, fee EUR 13.41. Airwallex: EUR 1850.00, PAID, fee EUR 13.41; Books: -1850.00 EUR + -13.41 EUR (accounts 6200, 1200, 6800).
- **Airwallex conversion `08736b6e-0f62-41f8-9e4c-6f5a8cbff3c7`**: ledger USD 418.40 → EUR 370.00, SETTLED. Airwallex: USD 418.40 → EUR 370.00, SETTLED; Books: -418.40 USD + 370.00 EUR (accounts 1590, 1201, 1200).
- **Airwallex deposit `56366c9d-e537-428f-8681-9c1a8c43c838`**: ledger USD 1.35 booked for Metal tx 0x808f9133…a94f (block 9401051). Airwallex: USD 1.35, SETTLED, reference 0x808f9133…a94f; Metal: success in block 9401051, 1.35 *USDZ 0x828c7DE1…C875 → 0x1fB9a22f…55A5; Books: 1.35 USD (accounts 1201, 1590).
- **Airwallex card transaction `01a18bb9-4682-7000-bd95-43a3a930b03b`**: ledger EUR 19.99 at Packwise (sourcing), approved. Airwallex: EUR 19.99, PENDING; Books: -19.99 EUR (accounts 6100, 1200).
- **Airwallex card transaction `01a18bb9-571a-7000-a390-0e6d4b0e3132`**: ledger EUR 45.00 at Packwise (sourcing), declined LIMIT_EXCEEDED. Airwallex: EUR 45.00, FAILED LIMIT_EXCEEDED; Books: not booked, as nothing moved.
- **Airwallex card transaction `01a18bb9-6320-7000-8874-90025a882c13`**: ledger EUR 19.99 at Packwise (support), declined MERCHANT_CATEGORY_NOT_ALLOWED. Airwallex: EUR 19.99, FAILED MERCHANT_CATEGORY_NOT_ALLOWED; Books: not booked, as nothing moved.
- **Airwallex card transaction `01a18bbb-6607-7000-ac01-0b4d20104e8e`**: ledger EUR 45.00 at Packwise (sourcing), approved. Airwallex: EUR 45.00, PENDING; Books: -45.00 EUR (accounts 6100, 1200).

## Every payment checked

| Kind | Id | Ledger | Airwallex | Metal | Books |
|---|---|---|---|---|---|
| Airwallex transfer | `4d508b0b-e…feb4` | EUR 1850.00 for invoice BTX-2026-11, PAID, fee EUR 13.41 | match | n/a | match |
| Airwallex conversion | `08736b6e-0…f3c7` | USD 418.40 → EUR 370.00, SETTLED | match | n/a | match |
| Airwallex deposit | `56366c9d-e…c838` | USD 1.35 booked for Metal tx 0x808f9133…a94f (block 9401051) | match | match | match |
| Airwallex card transaction | `01a18bb9-4…b03b` | EUR 19.99 at Packwise (sourcing), approved | match | n/a | match |
| Airwallex card transaction | `01a18bb9-5…3132` | EUR 45.00 at Packwise (sourcing), declined LIMIT_EXCEEDED | match | n/a | match |
| Airwallex card transaction | `01a18bb9-6…2c13` | EUR 19.99 at Packwise (support), declined MERCHANT_CATEGORY_NOT_ALLOWED | match | n/a | match |
| Airwallex card transaction | `01a18bbb-6…4e8e` | EUR 45.00 at Packwise (sourcing), approved | match | n/a | match |
| Metal funding | `0x1fbcf64b…93e2` | 20.00 *USDZ from the owner to the business account | n/a | match | match |
| Metal sale | `1` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `2` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `3` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `4` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `5` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `6` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `7` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `8` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `9` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `10` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `11` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `12` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `13` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `14` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `15` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `16` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `17` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `18` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `19` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `20` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `21` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `22` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `23` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `24` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `25` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `26` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `27` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `28` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `29` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `30` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `31` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `32` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `33` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `34` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `35` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `36` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `37` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `38` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `39` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `40` | 0.05 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `41` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `42` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `43` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `44` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `45` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `46` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `47` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `48` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `49` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal sale | `50` | 0.07 *USDZ from 0xB6C24EC1…eB25, DELIVERED | n/a | match | match |
| Metal upstream purchase | `1` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `2` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `3` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `4` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `5` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `6` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `7` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `8` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `9` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `10` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `11` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `12` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `13` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `14` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `15` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `16` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `17` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `18` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `19` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `20` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `21` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `22` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `23` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `24` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `25` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `26` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `27` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `28` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `29` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `30` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `31` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `32` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `33` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `34` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `35` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `36` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `37` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `38` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `39` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `40` | 0.02 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `41` | 0.00 *USDZ to the supplier, REFUSED (mandate_cap_exceeded) | n/a | match | match |
| Metal upstream purchase | `42` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `43` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `44` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `45` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `46` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `47` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `48` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `49` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `50` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `51` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal refund | `refund-7` | 0.05 *USDZ back to 0xB6C24EC1…eB25 for sale 7, PAID | n/a | match | match |
| Metal refund | `refund-10` | 0.05 *USDZ back to 0xB6C24EC1…eB25 for sale 10, PAID | n/a | match | match |
| Metal refund | `refund-13` | 0.05 *USDZ back to 0xB6C24EC1…eB25 for sale 13, PAID | n/a | match | match |
| Metal sweep | `sweep-20261030-1` | 1.35 *USDZ to the sweep wallet, PAID | n/a | match | match |
| Metal mandate | `0x25952ab9…60aa` | sourcing bound: cap 0.03, budget 10.00 | n/a | match | n/a |
| Metal mandate | `0x1b3308e2…f7d1` | support bound: cap 0.10, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0xb89ea437…7585` | treasury bound: cap 6.00, budget 6.00 | n/a | match | n/a |
| Metal mandate | `0x6a4622a9…59a6` | customer bound: cap 0.10, budget 5.00 | n/a | match | n/a |
| Metal mandate | `0x2909b164…8aed` | treasury replaced (P-0002): cap 4.00, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0xbc70858f…b5d7` | sourcing replaced (P-0002): cap 0.04, budget 12.00 | n/a | match | n/a |
