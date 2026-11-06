# Data QA: the recorded ledger against Airwallex, Metal and the Books

Made by `npm run data-qa` (`src/cli/dataQa.ts`) on 2026-11-06T06:24:47.978Z. Every payment in the ledger `/tmp/claude-0/-home-user/688ec361-72ad-554b-b31d-67a034944a81/scratchpad/wt-rel/data/rel-1b.sqlite` up to audit row 342
(342 rows read; this ledger does not hold the recorded run's head at row 194) is compared with Airwallex (read-only GET by id: status, amount, currency), with
Metal testnet (the transaction exists and succeeded and carries the *USDZ transfer with the ledger's amount, payer and
payee) and with the Books (`src/accounting/books.ts`: the double-entry postings for that ref). Nothing was created,
moved or approved, and nothing was fixed.

- **Airwallex:** sandbox reached with the environment's keys; GET requests only.
- **Metal:** Metal testnet reached (head block 17710654); eth_ reads only.

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
| Metal sale | 25 | 50 | 50 | 0 | 0 |
| Metal upstream purchase | 30 | 60 | 60 | 0 | 0 |
| Metal refund | 3 | 6 | 6 | 0 | 0 |
| Metal sweep | 1 | 2 | 2 | 0 | 0 |
| Metal mandate | 6 | 6 | 6 | 0 | 0 |
| **All** | **70** | **135** | **135** | **0** | **0** |

### Per side

| Kind | Airwallex | Metal | Books |
|---|---|---|---|
| Airwallex transfer | 1/1 match | n/a | 1/1 match |
| Airwallex conversion | 1/1 match | n/a | 1/1 match |
| Airwallex deposit | 1/1 match | 1/1 match | 1/1 match |
| Airwallex card transaction | 1/1 match | n/a | 1/1 match |
| Metal funding | n/a | 1/1 match | 1/1 match |
| Metal sale | n/a | 25/25 match | 25/25 match |
| Metal upstream purchase | n/a | 30/30 match | 30/30 match |
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

- **Airwallex transfer `e08f5f76-baed-4a94-8039-3f246503c805`**: ledger EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.40. Airwallex: EUR 240.00, PAID, fee EUR 13.40; Books: -240.00 EUR + -13.40 EUR (accounts 6350, 1200, 6800).
- **Airwallex conversion `b7c71ab8-56f7-40e1-beaa-7c48762696fd`**: ledger USD 124.49 → EUR 110.00, SETTLED. Airwallex: USD 124.49 → EUR 110.00, SETTLED; Books: -124.49 USD + 110.00 EUR (accounts 1590, 1201, 1200).
- **Airwallex deposit `4487ff44-5c1b-4081-9e19-fe62b6b9327a`**: ledger USD 0.51 booked for Metal tx 0xa8f948d7…54e4 (block 17706175). Airwallex: USD 0.51, SETTLED, reference 0xa8f948d7…54e4; Metal: success in block 17706175, 0.51 *USDZ 0x1cd2A3B6…6f97 → 0xAF02ac9d…75b2; Books: 0.51 USD (accounts 1201, 1590).
- **Airwallex card transaction `01a1af85-eaa9-7000-8984-bfcdcec399f6`**: ledger EUR 45.00 at Packwise (sourcing), approved. Airwallex: EUR 45.00, PENDING; Books: -45.00 EUR (accounts 6100, 1200).

## Every payment checked

| Kind | Id | Ledger | Airwallex | Metal | Books |
|---|---|---|---|---|---|
| Airwallex transfer | `e08f5f76-b…c805` | EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.40 | match | n/a | match |
| Airwallex conversion | `b7c71ab8-5…96fd` | USD 124.49 → EUR 110.00, SETTLED | match | n/a | match |
| Airwallex deposit | `4487ff44-5…327a` | USD 0.51 booked for Metal tx 0xa8f948d7…54e4 (block 17706175) | match | match | match |
| Airwallex card transaction | `01a1af85-e…99f6` | EUR 45.00 at Packwise (sourcing), approved | match | n/a | match |
| Metal funding | `0x387e3221…f4d5` | 20.00 *USDZ from the owner to the business account | n/a | match | match |
| Metal sale | `1` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `2` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `3` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `4` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `5` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `6` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `7` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `8` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `9` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `10` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `11` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `12` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `13` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `14` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `15` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `16` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `17` | 0.05 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `18` | 0.07 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `19` | 0.07 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `20` | 0.07 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `21` | 0.07 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `22` | 0.07 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `23` | 0.07 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `24` | 0.07 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
| Metal sale | `25` | 0.07 *USDZ from 0x951a8CE5…b81f, DELIVERED | n/a | match | match |
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
| Metal upstream purchase | `22` | 0.00 *USDZ to the supplier, REFUSED (mandate_revoked) | n/a | match | match |
| Metal upstream purchase | `23` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `24` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `25` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `26` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `27` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `28` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `29` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `30` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal refund | `refund-7` | 0.05 *USDZ back to 0x951a8CE5…b81f for sale 7, PAID | n/a | match | match |
| Metal refund | `refund-10` | 0.05 *USDZ back to 0x951a8CE5…b81f for sale 10, PAID | n/a | match | match |
| Metal refund | `refund-13` | 0.05 *USDZ back to 0x951a8CE5…b81f for sale 13, PAID | n/a | match | match |
| Metal sweep | `sweep-20261106-1` | 0.51 *USDZ to the sweep wallet, PAID | n/a | match | match |
| Metal mandate | `0xb8ac1273…a401` | sourcing bound: cap 0.03, budget 10.00 | n/a | match | n/a |
| Metal mandate | `0xaf53d2a1…2802` | support bound: cap 0.10, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0x03ae298e…e025` | treasury bound: cap 6.00, budget 6.00 | n/a | match | n/a |
| Metal mandate | `0x0d967f0a…9180` | customer bound: cap 0.10, budget 5.00 | n/a | match | n/a |
| Metal mandate | `0x8906e40f…e33b` | treasury replaced (P-0003): cap 2.00, budget 2.00 | n/a | match | n/a |
| Metal mandate | `0xdb53b68c…f606` | sourcing replaced (P-0003): cap 0.04, budget 14.00 | n/a | match | n/a |
