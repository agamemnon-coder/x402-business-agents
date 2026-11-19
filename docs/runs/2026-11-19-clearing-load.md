# Run log: clearing load test, re-run (19 November 2026)

The load test of [30 October](2026-10-30-clearing-load.md) run again on Alta testnet (Metal in the code's names), the
same command and size, after the loop that makes one payment was moved into tested code. The raw numbers are
[`2026-11-19-clearing-load.json`](2026-11-19-clearing-load.json); the two runs of 30 October stay as they were
([`clearing-load-1.json`](clearing-load-1.json), [`clearing-load-2.json`](clearing-load-2.json)).

    KIT11_KEYS_DIR=<a fresh keys folder outside the repo> LOAD_OUT=2026-11-19-clearing-load npm run clearing-load -- 16 125 0.001

Test money only (*USDZ), 16 fresh payer wallets, keys outside the repository and never printed; the RPC URL is never
printed or written (the script counts its calls by method only).

## Why it was run again

The evidence wall said "3,879 of 4,000 payments through Alta's clearing": the two runs of 30 October added up. All 121
misses were run 1's, and they were the load script's doing, not clearing's: one wallet's sixth payment got no receipt
back, the script did not send that request again, and the clearing client then refused the wallet's other 120 itself
("the wallet holds an earlier payment whose outcome is unknown"). Nothing was paid twice or lost. The script resent
from run 2 on, but that loop was never tested, and it counted its resends in the same counter, and against the same
budget, as the waits at an epoch boundary.

**The change.** [`src/metal/loadPayment.ts`](../../src/metal/loadPayment.ts) makes one payment: an epoch boundary
(`between_epochs`) waited out up to 10 times, a lost answer's request sent again up to 5 times, 3 s apart, each counted
on its own. [`test/clearing-load-payment.test.ts`](../../test/clearing-load-payment.test.ts) holds it, run 1's case
included. The record now has `resends_after_lost_answer` beside `between_epochs_retries`.

## Results

| | 19 Nov |
|---|---|
| Payments attempted | 2,000 (16 wallets × 125, all wallets at once) |
| Paid and delivered | **2,000** |
| Failed | 0 |
| Wall time | 482.5 s |
| Throughput | 4.15 paid a second |
| Latency p50 / p95 / p99 / max | 1,872 / 8,520 / 14,182 / 21,685 ms |
| `between_epochs` retries (3 s wait each) | 1,066 |
| Requests sent again after a lost answer | **2**, both then paid |
| Seller's spendable balance rose by | 2 (= 2,000 × 0.001) |
| Deposit-side chain transactions recorded | 32 (approvals and deposits), deposit gas 7,229,399 |
| RPC calls (this process) | 21,130 (10.56 a paid payment) |
| Facilitator calls | 2,002 |

The first two transactions are `0x75f4d85c…2b` and `0xef33a062…4320`; all 32 are in the JSON.

**What it shows.** The case that cost run 1 its 121 payments came up twice in this run: twice an answer was lost, the
same request was sent again, and the wallet paid on. Every paid request reached the seller and the seller's balance rose
by exactly the price times the payments.

## What this does not show

The same limits as 30 October: testnet, one machine and IP, 16 payers at most, a load route rather than Northwind's,
no withdrawal. Latency is close to the earlier runs' but not the same; we did not look for why.
