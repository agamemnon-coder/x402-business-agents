# Data QA: the recorded ledger against Airwallex, Metal and the Books

Made by `npm run data-qa` (`src/cli/dataQa.ts`) on 2026-11-02T15:48:19.079Z. Every payment in the ledger `data/agent-1.sqlite` (agent run 1) up to audit row 479
(479 rows read; this ledger does not hold the recorded run's head at row 194) is compared with Airwallex (read-only GET by id: status, amount, currency), with
Metal testnet (the transaction exists and succeeded and carries the *USDZ transfer with the ledger's amount, payer and
payee) and with the Books (`src/accounting/books.ts`: the double-entry postings for that ref). Nothing was created,
moved or approved, and nothing was fixed.

- **Airwallex:** sandbox reached with the environment's keys; GET requests only.
- **Metal:** Metal testnet reached (head block 13238620); eth_ reads only.

## Summary

A check is one payment on one side. Mandate binds and replaces move no money, so they have no Books side; a refused
purchase and a declined card charge must have no transaction and no posting.

| Kind | Payments | Checks | Matched | Differences | Skipped |
|---|---:|---:|---:|---:|---:|
| Airwallex transfer | 1 | 2 | 2 | 0 | 0 |
| Airwallex deposit | 1 | 3 | 3 | 0 | 0 |
| Metal funding | 1 | 2 | 2 | 0 | 0 |
| Metal sale | 63 | 126 | 126 | 0 | 0 |
| Metal upstream purchase | 26 | 52 | 52 | 0 | 0 |
| Metal refund | 3 | 6 | 6 | 0 | 0 |
| Metal sweep | 1 | 2 | 2 | 0 | 0 |
| Metal mandate | 6 | 6 | 6 | 0 | 0 |
| **All** | **102** | **199** | **199** | **0** | **0** |

### Per side

| Kind | Airwallex | Metal | Books |
|---|---|---|---|
| Airwallex transfer | 1/1 match | n/a | 1/1 match |
| Airwallex deposit | 1/1 match | 1/1 match | 1/1 match |
| Metal funding | n/a | 1/1 match | 1/1 match |
| Metal sale | n/a | 63/63 match | 63/63 match |
| Metal upstream purchase | n/a | 26/26 match | 26/26 match |
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

- **Airwallex transfer `7bbb3d61-d9f3-4b8e-81cc-cc7cceb9c1df`**: ledger EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.37. Airwallex: EUR 240.00, PAID, fee EUR 13.37; Books: -240.00 EUR + -13.37 EUR (accounts 6350, 1200, 6800).
- **Airwallex deposit `e80c3809-626f-43ac-b688-658aab624a7c`**: ledger USD 1.97 booked for Metal tx 0x659c5ac2…e2b2 (block 13009654). Airwallex: USD 1.97, SETTLED, reference 0x659c5ac2…e2b2; Metal: success in block 13009654, 1.97 *USDZ 0xE714A62F…120B → 0x0030f9A5…7075; Books: 1.97 USD (accounts 1201, 1590).

## Every payment checked

| Kind | Id | Ledger | Airwallex | Metal | Books |
|---|---|---|---|---|---|
| Airwallex transfer | `7bbb3d61-d…c1df` | EUR 240.00 for invoice SLL-2026-11, PAID, fee EUR 13.37 | match | n/a | match |
| Airwallex deposit | `e80c3809-6…4a7c` | USD 1.97 booked for Metal tx 0x659c5ac2…e2b2 (block 13009654) | match | match | match |
| Metal funding | `0x324db78f…402f` | 20.00 *USDZ from the owner to the business account | n/a | match | match |
| Metal sale | `1` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `2` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `3` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `4` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `5` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `6` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `7` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `8` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `9` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `10` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `11` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `12` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `13` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `14` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `15` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `16` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `17` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `18` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `19` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `20` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `21` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `22` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `23` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `24` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `25` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `26` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `27` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `28` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `29` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `30` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `31` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `32` | 0.05 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `33` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `34` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `35` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `36` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `37` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `38` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `39` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `40` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `41` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `42` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `43` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `44` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `45` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `46` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `47` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `48` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `49` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `50` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `51` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `52` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `53` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `54` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `55` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `56` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `57` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `58` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `59` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `60` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `61` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `62` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
| Metal sale | `63` | 0.06 *USDZ from 0xfAEB6594…40D7, DELIVERED | n/a | match | match |
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
| Metal upstream purchase | `18` | 0.00 *USDZ to the supplier, REFUSED (mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment) | n/a | match | match |
| Metal upstream purchase | `19` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `20` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `21` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `22` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `23` | 0.00 *USDZ to the supplier, REFUSED (buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged) | n/a | match | match |
| Metal upstream purchase | `24` | 0.00 *USDZ to the supplier, REFUSED (mandate_revoked) | n/a | match | match |
| Metal upstream purchase | `25` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal upstream purchase | `26` | 0.04 *USDZ to the supplier, PAID | n/a | match | match |
| Metal refund | `refund-7` | 0.05 *USDZ back to 0xfAEB6594…40D7 for sale 7, PAID | n/a | match | match |
| Metal refund | `refund-10` | 0.05 *USDZ back to 0xfAEB6594…40D7 for sale 10, PAID | n/a | match | match |
| Metal refund | `refund-13` | 0.05 *USDZ back to 0xfAEB6594…40D7 for sale 13, PAID | n/a | match | match |
| Metal sweep | `sweep-20261102-1` | 1.97 *USDZ to the sweep wallet, PAID | n/a | match | match |
| Metal mandate | `0x725f7174…08dc` | sourcing bound: cap 0.03, budget 10.00 | n/a | match | n/a |
| Metal mandate | `0xfd869974…4c61` | support bound: cap 0.10, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0xe395bf63…43e7` | treasury bound: cap 6.00, budget 6.00 | n/a | match | n/a |
| Metal mandate | `0xa3481923…6263` | customer bound: cap 0.10, budget 5.00 | n/a | match | n/a |
| Metal mandate | `0x563d4fff…b152` | treasury replaced (P-0003): cap 4.00, budget 4.00 | n/a | match | n/a |
| Metal mandate | `0x0e7f9d0a…2d8e` | sourcing replaced (P-0003): cap 0.04, budget 12.00 | n/a | match | n/a |
