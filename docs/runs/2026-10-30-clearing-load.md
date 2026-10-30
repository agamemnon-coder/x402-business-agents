# Run log: clearing load test (30 October 2026, late evening)

Enterprise item 5 asked: put thousands of payments through Metal's clearing and report throughput, latency and cost
honestly.

`npm run clearing-load -- 16 125 0.001` (`src/cli/clearingLoad.ts`) ran it twice on Metal testnet. The raw numbers
are [`clearing-load-1.json`](clearing-load-1.json) and [`clearing-load-2.json`](clearing-load-2.json).

**A separate test world**, not Northwind's recorded one. Test money only (*USDZ); test keys kept outside the repo and
never printed. The RPC credential is never printed: the script counts calls by method only.

## The set-up

- **Seller.** One local route, `GET /v1/load`, priced at 0.001 and paid only by clearing (scheme `bajillion`,
  settled through Metal's facilitator). It is the same x402 path Purser's prepaid route uses.
- **Payers.** 16 wallets, each with its own clearing deposit (0.125 for the payments plus 0.05 spare).
  - All 16 pay at once.
  - Each wallet pays its 125 requests one after another, because a clearing account pays one request at a time.
- **Measured.**
  - The time per paid request, including its retries.
  - Refusals by reason.
  - The seller's spendable balance before and after.
  - The deposits' gas.
  - The RPC calls this process made, by method. Payers and seller run in the same process, so this includes the
    seller's checks of each payment.

## Results

| | Run 1 | Run 2 (after the fix below) |
|---|---|---|
| Payments attempted | 2,000 | 2,000 |
| Paid and delivered | **1,879** | **2,000** |
| Failed | 121 (one wallet stuck, see below) | 0 |
| Wall time | 473.9 s | 471.8 s |
| Throughput | 3.97 paid a second | **4.24 paid a second** |
| Latency p50 / p95 / p99 / max | 1,670 / 8,636 / 13,382 / 21,228 ms | **1,388 / 8,139 / 8,780 / 16,637 ms** |
| `between_epochs` retries (3 s wait each) | 1,092 | 1,016 |
| Seller's spendable balance rose by | 1.879 (= 1,879 × 0.001) | **2.000 (= 2,000 × 0.001)** |
| Chain transactions | 32 (16 approvals, 16 deposits) | 32 (16 approvals, 16 deposits) |
| Deposit gas | 7,229,040 (0.000000000007 *USDZ) | 7,229,156 (0.000000000007 *USDZ) |
| RPC calls (this process) | 19,705 (10.49 a paid payment) | 20,366 (10.18 a paid payment) |
| Facilitator calls | 1,881 | 2,002 |

Run 2's deposit transactions start with `0x5fcf7ef9…5eb3` and `0xdcbeb74d…c17a`. All 32 of each run are in the JSON.

In both runs, every paid request reached the seller and the seller's balance rose by exactly the price times the
payments. No payment was counted twice and none was lost.

## Finding 1: a lost answer holds a wallet

In run 1, one wallet stopped after its fifth payment.
- Its sixth payment got no receipt back (`no receipt this wallet could check came back for this payment`).
- Its remaining 120 were refused by the client itself (`the wallet holds an earlier payment whose outcome is unknown`).
- Nothing was paid twice and no money was lost. The wallet refused to sign a new payment while one was unresolved.

Metal's docs say what to do: send the same request again, so the client can resolve the earlier payment.

**The fix.** The load script now resends a request whose outcome is unknown, up to five times, 3 s apart. Run 2, in
fresh wallets, paid 2,000 of 2,000.

Purser's customer agent marks such a payment **in doubt** and does not pay again another way (`src/agents/customer.ts`).
It does not yet resend the request as the load script does; that is a small follow-up. The load test showed the
clearing client's own guard against paying twice holds under load.

## Finding 2: latency is mostly epoch boundaries

- The median paid request takes about 1.4 s.
- The 95th percentile is about 8 s. Clearing refuses payments for a moment at each epoch boundary (`between_epochs`),
  and the client waits 3 s and tries again. Run 2 had 1,016 such retries over 2,000 payments.
- A shorter wait would lower the tail. 3 s is the wait Purser uses elsewhere; it was not tuned here.

## Finding 3: throughput is limited by one-at-a-time wallets, not by Metal

- 16 wallets gave 4.24 paid payments a second. That is about 3.8 s a payment per wallet, retries included.
- More wallets (one per agent or per customer) would raise it. We did not find Metal's ceiling.
- Metal's published limits are much higher:
  - the facilitator allows 1,200 `/settle` calls a minute per IP (20 a second);
  - clearing payments do not count against the 120-a-minute and 1,000-a-day settlement caps
    (docs.metalntwx.com/agents/facilitator);
  - the RPC gateway allows about 1,000 requests a second (docs.metalntwx.com/network/endpoints).
- We stayed far below all of these.

## Cost

- **Chain.** 32 transactions per run: the approvals and deposits, not one per payment. Their gas cost about
  0.000000000007 *USDZ in total at Metal testnet's gas price (1 wei).
- **RPC.** Metal bills RPC per call: $0.05 per 1,000 base calls and $0.08 per 1,000 `eth_call`s
  (docs.metalntwx.com/network/credits, read 30 October).
  - Run 2: 12,562 `eth_call`s and 7,804 other calls, about **$1.40 for 2,000 payments, $0.0007 a payment**.
  - Run 1: about $1.35.
  - This is an estimate from the published rates and the calls counted, not a bill. Payer and seller are both counted,
    so each side pays roughly half.
- **Facilitator.** The facilitator calls (2,002 in run 2) are not in the RPC estimate. Metal's docs do not list a
  price for them.

So one 0.001 payment cost about 0.0007 in RPC calls to check. At this price point, clearing is worth it only because
there is no transaction per payment. For prices below about a tenth of a cent, the RPC checks would cost more than
the payment.

## What this does not show

- **Not production numbers.** This was testnet, from one machine with one IP, at one time of day.
- **No more than 16 payers at once.** We did not push to find where Metal starts refusing.
- **The seller is a load route,** not Northwind's stock-check route. The payment path is the same; the response is
  smaller.
- **Withdrawing** the earnings (two steps, after the epoch closes) was not part of this test. It ran on 29 October
  ([2026-10-29-clearing.md](2026-10-29-clearing.md)).
