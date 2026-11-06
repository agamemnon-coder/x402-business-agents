# Data QA: the recorded ledger against Airwallex, Metal and the Books

Made by `npm run data-qa` (`src/cli/dataQa.ts`) on 2026-11-06T05:55:47.344Z. Every payment in the ledger `/tmp/claude-0/-home-user/688ec361-72ad-554b-b31d-67a034944a81/scratchpad/wt-rel/data/rel-1.sqlite` up to audit row 374
(374 rows read; this ledger does not hold the recorded run's head at row 194) is compared with Airwallex (read-only GET by id: status, amount, currency), with
Metal testnet (the transaction exists and succeeded and carries the *USDZ transfer with the ledger's amount, payer and
payee) and with the Books (`src/accounting/books.ts`: the double-entry postings for that ref). Nothing was created,
moved or approved, and nothing was fixed.

- **Airwallex:** sandbox reached with the environment's keys; GET requests only.
- **Metal:** Metal testnet reached (head block 17683910); eth_ reads only.

## Summary

A check is one payment on one side. Mandate binds and replaces move no money, so they have no Books side; a refused
purchase and a declined card charge must have no transaction and no posting.

| Kind | Payments | Checks | Matched | Differences | Skipped |
|---|---:|---:|---:|---:|---:|
| Airwallex transfer | 1 | 2 | 2 | 0 | 0 |
| Airwallex conversion | 1 | 2 | 2 | 0 | 0 |
| Airwallex deposit | 1 | 3 | 3 | 0 | 0 |
| Metal funding | 1 | 2 | 2 | 0 | 0 |
| Metal sale | 47 | 94 | 94 | 0 | 0 |
| Metal upstream purchase | 52 | 104 | 104 | 0 | 0 |
| Metal refund | 3 | 6 | 6 | 0 | 0 |
| Metal sweep | 1 | 2 | 2 | 0 | 0 |
| Metal mandate | 6 | 6 | 6 | 0 | 0 |
| **All** | **113** | **221** | **221** | **0** | **0** |

### Per side

| Kind | Airwallex | Metal | Books |
|---|---|---|---|
| Airwallex transfer | 1/1 match | n/a | 1/1 match |
| Airwallex conversion | 1/1 match | n/a | 1/1 match |
| Airwallex deposit | 1/1 match | 1/1 match | 1/1 match |
| Metal funding | n/a | 1/1 match | 1/1 match |
| Metal sale | n/a | 47/47 match | 47/47 match |
| Metal upstream purchase | n/a | 52/52 match | 52/52 match |
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

- **Airwallex transfer `6c64ffac-17a0-403d-94e3-a26501431de4`**: ledger EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.40. Airwallex: EUR 240.00, PAID, fee EUR 13.40; Books: -240.00 EUR + -13.40 EUR (accounts 6350, 1200, 6800).
- **Airwallex conversion `89f33427-81be-474b-b018-6e813d4c577b`**: ledger USD 124.52 → EUR 110.00, SETTLED. Airwallex: USD 124.52 → EUR 110.00, SETTLED; Books: -124.52 USD + 110.00 EUR (accounts 1590, 1201, 1200).
- **Airwallex deposit `2fc282ff-5ec5-4ea8-85e2-b1e64f9d9335`**: ledger USD 0.51 booked for Metal tx 0x5287e9e3…82bb (block 17672593). Airwallex: USD 0.51, SETTLED, reference 0x5287e9e3…82bb; Metal: success in block 17672593, 0.51 *USDZ 0x052cEd04…4312 → 0xF9309e82…1E86; Books: 0.51 USD (accounts 1201, 1590).

## Every payment checked

| Kind | Id | Ledger | Airwallex | Metal | Books |
|---|---|---|---|---|---|
| Airwallex transfer | `6c64ffac-1…1de4` | EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.40 | match | n/a | match |
| Airwallex conversion | `89f33427-8…577b` | USD 124.52 → EUR 110.00, SETTLED | match | n/a | match |
| Airwallex deposit | `2fc282ff-5…9335` | USD 0.51 booked for Metal tx 0x5287e9e3…82bb (block 17672593) | match | match | match |
| Metal funding | `0x64ed77f2…1d2f` | 20.00 *USDZ from the owner to the business account | n/a | match | match |
| Metal sale | `1` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `2` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `3` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `4` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `5` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `6` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `7` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `8` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `9` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `10` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `11` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `12` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `13` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `14` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `15` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `16` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `17` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `18` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `19` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `20` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `21` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `22` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `23` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `24` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `25` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `26` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `27` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `28` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `29` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `30` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `31` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `32` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `33` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `34` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `35` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `36` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `37` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `38` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `39` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `40` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `41` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `42` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `43` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `44` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `45` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `46` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
| Metal sale | `47` | 0.05 *USDZ from 0xf5Dee8E8…1268, DELIVERED | n/a | match | match |
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
| Metal refund | `refund-7` | 0.05 *USDZ back to 0xf5Dee8E8…1268 for sale 7, PAID | n/a | match | match |
| Metal refund | `refund-10` | 0.05 *USDZ back to 0xf5Dee8E8…1268 for sale 10, PAID | n/a | match | match |
| Metal refund | `refund-13` | 0.05 *USDZ back to 0xf5Dee8E8…1268 for sale 13, PAID | n/a | match | match |
| Metal sweep | `sweep-20261106-1` | 0.51 *USDZ to the sweep wallet, PAID | n/a | match | match |
| Metal mandate | `0xee2c9302…71ea` | sourcing bound: cap 0.03, budget 10.00 | n/a | match | n/a |
| Metal mandate | `0x851d5bb2…5f90` | support bound: cap 0.10, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0x1efa9ada…bad5` | treasury bound: cap 6.00, budget 6.00 | n/a | match | n/a |
| Metal mandate | `0x8bfd9c0d…8940` | customer bound: cap 0.10, budget 5.00 | n/a | match | n/a |
| Metal mandate | `0xbb1f9b5d…d65d` | treasury replaced (P-0002): cap 2.00, budget 2.00 | n/a | match | n/a |
| Metal mandate | `0x1d2b65a1…404a` | sourcing replaced (P-0002): cap 0.04, budget 14.00 | n/a | match | n/a |
