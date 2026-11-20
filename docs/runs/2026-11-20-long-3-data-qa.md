# Data QA: the recorded ledger against Airwallex, Metal and the Books

Made by `npm run data-qa` (`src/cli/dataQa.ts`) on 2026-11-20T17:10:46.399Z. Every payment in the ledger `data/long-3.sqlite` up to audit row 1054
(1054 rows read; this ledger does not hold the recorded run's head at row 194) is compared with Airwallex (read-only GET by id: status, amount, currency), with
Metal testnet (the transaction exists and succeeded and carries the *USDZ transfer with the ledger's amount, payer and
payee) and with the Books (`src/accounting/books.ts`: the double-entry postings for that ref). Nothing was created,
moved or approved, and nothing was fixed.

- **Airwallex:** sandbox reached with the environment's keys; GET requests only.
- **Metal:** Metal testnet reached (head block 37160868); eth_ reads only.

## Summary

A check is one payment on one side. Mandate binds and replaces move no money, so they have no Books side; a refused
purchase and a declined card charge must have no transaction and no posting.

| Kind | Payments | Checks | Matched | Differences | Skipped |
|---|---:|---:|---:|---:|---:|
| Airwallex transfer | 1 | 2 | 2 | 0 | 0 |
| Airwallex conversion | 1 | 2 | 2 | 0 | 0 |
| Airwallex deposit | 1 | 3 | 3 | 0 | 0 |
| Airwallex card transaction | 2 | 4 | 4 | 0 | 0 |
| Metal funding | 1 | 2 | 2 | 0 | 0 |
| Metal sale | 100 | 200 | 200 | 0 | 0 |
| Metal upstream purchase | 106 | 212 | 212 | 0 | 0 |
| Metal refund | 3 | 6 | 6 | 0 | 0 |
| Metal sweep | 1 | 2 | 2 | 0 | 0 |
| Metal mandate | 6 | 6 | 6 | 0 | 0 |
| **All** | **222** | **439** | **439** | **0** | **0** |

### Per side

| Kind | Airwallex | Metal | Books |
|---|---|---|---|
| Airwallex transfer | 1/1 match | n/a | 1/1 match |
| Airwallex conversion | 1/1 match | n/a | 1/1 match |
| Airwallex deposit | 1/1 match | 1/1 match | 1/1 match |
| Airwallex card transaction | 2/2 match | n/a | 2/2 match |
| Metal funding | n/a | 1/1 match | 1/1 match |
| Metal sale | n/a | 100/100 match | 100/100 match |
| Metal upstream purchase | n/a | 106/106 match | 106/106 match |
| Metal refund | n/a | 3/3 match | 3/3 match |
| Metal sweep | n/a | 1/1 match | 1/1 match |
| Metal mandate | n/a | 6/6 match | n/a |

## Differences

None.

## Notes on the ledger

- **Airwallex card transaction `01a1f9b5-1b3d-7000-a930-198a5c7980f3`**: the audit row (seq 359) names this charge 4d5bc3e8-edfb-42b2-8a16-255342633fc1, not the ledger's id.

## Skipped

None.

## What each side answered for the Airwallex payments

- **Airwallex transfer `f687a127-05b1-430e-ac38-46db31ad3b0f`**: ledger EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.66. Airwallex: EUR 240.00, PAID, fee EUR 13.66; Books: -240.00 EUR + -13.66 EUR (accounts 6350, 1200, 6800).
- **Airwallex conversion `957ee1b3-5334-47c4-9a73-df5b4f050cdb`**: ledger USD 122.10 → EUR 110.00, SETTLED. Airwallex: USD 122.10 → EUR 110.00, SETTLED; Books: -122.10 USD + 110.00 EUR (accounts 1590, 1201, 1200).
- **Airwallex deposit `f0c3e85c-d4db-4783-8e75-18eb60914cdc`**: ledger USD 0.48 booked for Metal tx 0xc120bfcf…cbe6 (block 37094841). Airwallex: USD 0.48, SETTLED, reference 0xc120bfcf…cbe6; Metal: success in block 37094841, 0.48 *USDZ 0x77dee099…A313 → 0xC09B7477…9469; Books: 0.48 USD (accounts 1201, 1590).
- **Airwallex card transaction `01a1f9b5-1b3d-7000-a930-198a5c7980f3`**: ledger EUR 45.00 at Packwise (sourcing), approved. Airwallex: EUR 45.00, PENDING; Books: -45.00 EUR (accounts 6100, 1200).
- **Airwallex card transaction `01a1f9db-6172-7000-bd82-615a8df779f2`**: ledger EUR 45.00 at Packwise (sourcing), approved. Airwallex: EUR 45.00, PENDING; Books: -45.00 EUR (accounts 6100, 1200).

## Every payment checked

| Kind | Id | Ledger | Airwallex | Metal | Books |
|---|---|---|---|---|---|
| Airwallex transfer | `f687a127-0…3b0f` | EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.66 | match | n/a | match |
| Airwallex conversion | `957ee1b3-5…0cdb` | USD 122.10 → EUR 110.00, SETTLED | match | n/a | match |
| Airwallex deposit | `f0c3e85c-d…4cdc` | USD 0.48 booked for Metal tx 0xc120bfcf…cbe6 (block 37094841) | match | match | match |
| Airwallex card transaction | `01a1f9b5-1…80f3` | EUR 45.00 at Packwise (sourcing), approved | match | n/a | match |
| Airwallex card transaction | `01a1f9db-6…79f2` | EUR 45.00 at Packwise (sourcing), approved | match | n/a | match |
| Metal funding | `0x6b4b27c9…9c18` | 20.00 *USDZ from the owner to the business account | n/a | match | match |
| Metal sale | `1` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `2` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `3` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `4` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `5` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `6` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `7` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `8` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `9` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `10` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `11` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `12` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `13` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `14` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `15` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `16` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `17` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `18` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `19` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `20` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `21` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `22` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `23` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `24` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `25` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `26` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `27` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `28` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `29` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `30` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `31` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `32` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `33` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `34` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `35` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `36` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `37` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `38` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `39` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `40` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `41` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `42` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `43` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `44` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `45` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `46` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `47` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `48` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `49` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `50` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `51` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `52` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `53` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `54` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `55` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `56` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `57` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `58` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `59` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `60` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `61` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `62` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `63` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `64` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `65` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `66` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `67` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `68` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `69` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `70` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `71` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `72` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `73` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `74` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `75` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `76` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `77` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `78` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `79` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `80` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `81` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `82` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `83` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `84` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `85` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `86` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `87` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `88` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `89` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `90` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `91` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `92` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `93` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `94` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `95` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `96` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `97` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `98` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `99` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
| Metal sale | `100` | 0.05 *USDZ from 0x8b08683d…3649, DELIVERED | n/a | match | match |
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
| Metal upstream purchase | `18` | 0.00 *USDZ to the supplier, REFUSED (mandate_cap_exceeded) | n/a | match | match |
| Metal upstream purchase | `19` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `20` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `21` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `22` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `23` | 0.00 *USDZ to the supplier, REFUSED (mandate_revoked) | n/a | match | match |
| Metal upstream purchase | `24` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `25` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `26` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `27` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `28` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `29` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `30` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `31` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `32` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `33` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `34` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `35` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `36` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `37` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
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
| Metal upstream purchase | `56` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `57` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `58` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `59` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `60` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `61` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `62` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `63` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `64` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `65` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `66` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `67` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `68` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `69` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `70` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `71` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `72` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `73` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `74` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `75` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `76` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `77` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `78` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `79` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `80` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `81` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `82` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `83` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `84` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `85` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `86` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `87` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `88` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `89` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `90` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `91` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `92` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `93` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `94` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `95` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `96` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `97` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `98` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `99` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `100` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `101` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `102` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `103` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `104` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `105` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `106` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal refund | `refund-7` | 0.05 *USDZ back to 0x8b08683d…3649 for sale 7, PAID | n/a | match | match |
| Metal refund | `refund-10` | 0.05 *USDZ back to 0x8b08683d…3649 for sale 10, PAID | n/a | match | match |
| Metal refund | `refund-13` | 0.05 *USDZ back to 0x8b08683d…3649 for sale 13, PAID | n/a | match | match |
| Metal sweep | `sweep-20261120-1` | 0.48 *USDZ to the sweep wallet, PAID | n/a | match | match |
| Metal mandate | `0x806b454d…9660` | sourcing bound: cap 0.03, budget 10.00 | n/a | match | n/a |
| Metal mandate | `0x5ed0bd99…de21` | support bound: cap 0.10, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0x880b5463…b054` | treasury bound: cap 6.00, budget 6.00 | n/a | match | n/a |
| Metal mandate | `0xdb7ae886…2393` | customer bound: cap 0.10, budget 5.00 | n/a | match | n/a |
| Metal mandate | `0x3913b0c3…0eeb` | treasury replaced (P-0002): cap 4.00, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0x3f1422e7…6d73` | sourcing replaced (P-0002): cap 0.04, budget 12.00 | n/a | match | n/a |
