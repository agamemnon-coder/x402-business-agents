# Data QA: the recorded ledger against Airwallex, Metal and the Books

Made by `npm run data-qa` (`src/cli/dataQa.ts`) on 2026-11-03T11:36:10.397Z. Every payment in the ledger `data/main-1.sqlite` up to audit row 412
(412 rows read; this ledger does not hold the recorded run's head at row 194) is compared with Airwallex (read-only GET by id: status, amount, currency), with
Metal testnet (the transaction exists and succeeded and carries the *USDZ transfer with the ledger's amount, payer and
payee) and with the Books (`src/accounting/books.ts`: the double-entry postings for that ref). Nothing was created,
moved or approved, and nothing was fixed.

- **Airwallex:** sandbox reached with the environment's keys; GET requests only.
- **Metal:** Metal testnet reached (head block 14159965); eth_ reads only.

## Summary

A check is one payment on one side. Mandate binds and replaces move no money, so they have no Books side; a refused
purchase and a declined card charge must have no transaction and no posting.

| Kind | Payments | Checks | Matched | Differences | Skipped |
|---|---:|---:|---:|---:|---:|
| Airwallex transfer | 1 | 2 | 2 | 0 | 0 |
| Airwallex conversion | 1 | 2 | 2 | 0 | 0 |
| Airwallex deposit | 1 | 3 | 3 | 0 | 0 |
| Airwallex card transaction | 1 | 2 | 2 | 0 | 0 |
| Metal funding | 1 | 2 | 2 | 0 | 0 |
| Metal sale | 41 | 82 | 82 | 0 | 0 |
| Metal upstream purchase | 55 | 110 | 110 | 0 | 0 |
| Metal refund | 3 | 6 | 6 | 0 | 0 |
| Metal sweep | 1 | 2 | 2 | 0 | 0 |
| Metal mandate | 6 | 6 | 6 | 0 | 0 |
| **All** | **111** | **217** | **217** | **0** | **0** |

### Per side

| Kind | Airwallex | Metal | Books |
|---|---|---|---|
| Airwallex transfer | 1/1 match | n/a | 1/1 match |
| Airwallex conversion | 1/1 match | n/a | 1/1 match |
| Airwallex deposit | 1/1 match | 1/1 match | 1/1 match |
| Airwallex card transaction | 1/1 match | n/a | 1/1 match |
| Metal funding | n/a | 1/1 match | 1/1 match |
| Metal sale | n/a | 41/41 match | 41/41 match |
| Metal upstream purchase | n/a | 55/55 match | 55/55 match |
| Metal refund | n/a | 3/3 match | 3/3 match |
| Metal sweep | n/a | 1/1 match | 1/1 match |
| Metal mandate | n/a | 6/6 match | n/a |

## Differences

None.

## Notes on the ledger

None.

## Skipped

None.

## What each side answered for the Airwallex payments

- **Airwallex transfer `03360bfa-afce-457b-89d1-e1097fbe3985`**: ledger EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.42. Airwallex: EUR 240.00, PAID, fee EUR 13.42; Books: -240.00 EUR + -13.42 EUR (accounts 6350, 1200, 6800).
- **Airwallex conversion `3ca88196-05da-4d88-9caa-796f03704636`**: ledger USD 124.29 → EUR 110.00, SETTLED. Airwallex: USD 124.29 → EUR 110.00, SETTLED; Books: -124.29 USD + 110.00 EUR (accounts 1590, 1201, 1200).
- **Airwallex deposit `b3812e05-2afa-4698-8f64-429f9608e0a0`**: ledger USD 0.69 booked for Metal tx 0x86936a5b…ccb4 (block 14153316). Airwallex: USD 0.69, SETTLED, reference 0x86936a5b…ccb4; Metal: success in block 14153316, 0.69 *USDZ 0x6e621D0f…fefc → 0x24c159D5…44C4; Books: 0.69 USD (accounts 1201, 1590).
- **Airwallex card transaction `01a1a12f-4113-7000-b76d-014677710007`**: ledger EUR 45.00 at Packwise (sourcing), approved. Airwallex: EUR 45.00, PENDING; Books: -45.00 EUR (accounts 6100, 1200).

## Every payment checked

| Kind | Id | Ledger | Airwallex | Metal | Books |
|---|---|---|---|---|---|
| Airwallex transfer | `03360bfa-a…3985` | EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.42 | match | n/a | match |
| Airwallex conversion | `3ca88196-0…4636` | USD 124.29 → EUR 110.00, SETTLED | match | n/a | match |
| Airwallex deposit | `b3812e05-2…e0a0` | USD 0.69 booked for Metal tx 0x86936a5b…ccb4 (block 14153316) | match | match | match |
| Airwallex card transaction | `01a1a12f-4…0007` | EUR 45.00 at Packwise (sourcing), approved | match | n/a | match |
| Metal funding | `0x7d5a7a59…ad9e` | 20.00 *USDZ from the owner to the business account | n/a | match | match |
| Metal sale | `1` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `2` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `3` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `4` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `5` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `6` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `7` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `8` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `9` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `10` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `11` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `12` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `13` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `14` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `15` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `16` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `17` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `18` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `19` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `20` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `21` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `22` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `23` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `24` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `25` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `26` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `27` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `28` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `29` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `30` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `31` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `32` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `33` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `34` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `35` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `36` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `37` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `38` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `39` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `40` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
| Metal sale | `41` | 0.05 *USDZ from 0x7b716439…6cdf, DELIVERED | n/a | match | match |
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
| Metal upstream purchase | `24` | 0.00 *USDZ to the supplier, REFUSED (mandate_cap_exceeded) | n/a | match | match |
| Metal upstream purchase | `25` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `26` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `27` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `28` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `29` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `30` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `31` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `32` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `33` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `34` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `35` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `36` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `37` | 0.00 *USDZ to the supplier, REFUSED (mandate_revoked) | n/a | match | match |
| Metal upstream purchase | `38` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `39` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `40` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `41` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
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
| Metal upstream purchase | `52` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `53` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `54` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `55` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal refund | `refund-7` | 0.05 *USDZ back to 0x7b716439…6cdf for sale 7, PAID | n/a | match | match |
| Metal refund | `refund-10` | 0.05 *USDZ back to 0x7b716439…6cdf for sale 10, PAID | n/a | match | match |
| Metal refund | `refund-13` | 0.05 *USDZ back to 0x7b716439…6cdf for sale 13, PAID | n/a | match | match |
| Metal sweep | `sweep-20261103-1` | 0.69 *USDZ to the sweep wallet, PAID | n/a | match | match |
| Metal mandate | `0xb7ef08bb…44ad` | sourcing bound: cap 0.03, budget 10.00 | n/a | match | n/a |
| Metal mandate | `0x9cb93362…1808` | support bound: cap 0.10, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0x809e7a30…3a9f` | treasury bound: cap 6.00, budget 6.00 | n/a | match | n/a |
| Metal mandate | `0x9c7d37f2…a2f7` | customer bound: cap 0.10, budget 5.00 | n/a | match | n/a |
| Metal mandate | `0x789abb24…ebbc` | treasury replaced (P-0002): cap 2.00, budget 2.00 | n/a | match | n/a |
| Metal mandate | `0x2a91ac97…e790` | sourcing replaced (P-0002): cap 0.04, budget 14.00 | n/a | match | n/a |
