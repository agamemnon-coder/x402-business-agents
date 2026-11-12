# Metal: a read-only check for the mandate inspector (12 November 2026, testnet)

**What this is.** 8 read-only JSON-RPC calls to the Metal testnet, made once on 12 November 2026 between 11:30:56 and 11:31:02 UTC, to check what the mandate inspector on /metal reads and to fetch the two refusal receipts shown there. Nothing was signed or sent, and no money moved. The budget was 8 calls, counted before each call was sent; 8 were used (4 `eth_getTransactionReceipt`, 1 `eth_blockNumber`, 3 `eth_call`). The RPC URL is a credential and is not in this record. Every request and answer is in [2026-11-12-metal-inspector.json](2026-11-12-metal-inspector.json), from which this page is written; the check itself is [check.mts](2026-11-12-metal-inspector/check.mts).

## The calls

| # | Method | What for | Answer |
|---|---|---|---|
| 1 | `eth_getTransactionReceipt` | the refusal recorded on chain in the main run (purchase #24): [`0x2e92f9cb…1871`](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871) | succeeded, block 14150386; events: MandateRefused |
| 2 | `eth_getTransactionReceipt` | Treasury's mandate replace (P-0002): the new mandate's reference and terms: [`0x789abb24…ebbc`](https://testnet.metalntwx.com/tx/0x789abb249896e01cee8e3641d7794676b6f2ce5d05f45093f6cc64101c9aebbc) | succeeded, block 14152940; events: MandateBound, MandateRevoked, MandateReplaced |
| 3 | `eth_getTransactionReceipt` | Support's mandate bind: the mandate's reference and terms: [`0x9cb93362…1808`](https://testnet.metalntwx.com/tx/0x9cb933624be5946c890f77a33aceb2adde3d75d138890a6e1abb91fdad721808) | succeeded, block 13906203; events: MandateBound |
| 4 | `eth_blockNumber` | the block to read at | 26003049 |
| 5 | `eth_call` | `mandates(ref)` on Northwind's account for Sourcing, at block 26003049 | bound, not revoked, spent 1.18 |
| 6 | `eth_call` | `mandates(ref)` on Northwind's account for Support, at block 26003049 | bound, not revoked, spent 0.15 |
| 7 | `eth_call` | `mandates(ref)` on Northwind's account for Treasury, at block 26003049 | bound, not revoked, spent 0.69 |
| 8 | `eth_getTransactionReceipt` | the revoked-credential refusal recorded on chain on 30 October (four-eyes world, a separate run): [`0xf97bcade…f98d`](https://testnet.metalntwx.com/tx/0xf97bcade4a83d7a23198660bee37e1c84d72d6da153eaf6d49f39cd8f542f98d) | succeeded, block 10099272; events: MandateRefused |

## What the chain says

**The mandates' state at block 26003049** (read 12 November 2026, 11:31:00 UTC), beside the main run's record of 3 November ([main-run.json](../demo/main-run.json), `snapshot.budgets`):

| Agent | Mandate reference | Bound | Revoked | Spent on chain | Spent in the record | Payments on chain | Bound in block |
|---|---|---|---|---|---|---|---|
| Sourcing | `0x272d82e8…5418` | yes | no | 1.18 \*USDZ | 1.18 | 41 | 14153004 |
| Support | `0x094188b0…e919` | yes | no | 0.15 \*USDZ | 0.15 | 3 | 13906203 |
| Treasury | `0x2380640e…8452` | yes | no | 0.69 \*USDZ | 0.69 | 1 | 14152940 |

The chain and the record agree on every amount. A replaced mandate carries its predecessor's spend: Sourcing's mandate was replaced during the run, and the mandate that replaced it counts all 41 purchases.

**What a read returns, and what it does not.** `mandates(ref)` returns a mandate's running state: its principal, whether it is revoked, its spend, its number of payments and the block it was bound in. The terms (cap per payment, budget, expiry, payee) cannot be read this way: they are in the `MandateBound` event of the bind or replace transaction. This check read that event for two mandates:

| Mandate | Transaction | Cap per payment | Budget | Expiry | Payee |
|---|---|---|---|---|---|
| Treasury, after the CFO's change | [`0x789abb24…ebbc`](https://testnet.metalntwx.com/tx/0x789abb249896e01cee8e3641d7794676b6f2ce5d05f45093f6cc64101c9aebbc), 3 November 2026, 11:26:53 UTC | 2.00 \*USDZ | 2.00 \*USDZ | 13 December 2026, 11:24:09 UTC | Northwind sweep, [`0x24c1…44C4`](https://testnet.metalntwx.com/address/0x24c159D585981113357aE805fA49ce1B0f2044C4) |
| Support | [`0x9cb93362…1808`](https://testnet.metalntwx.com/tx/0x9cb933624be5946c890f77a33aceb2adde3d75d138890a6e1abb91fdad721808), 3 November 2026, 06:06:02 UTC | 0.10 \*USDZ | 4.00 \*USDZ | 13 December 2026, 06:05:57 UTC | Summit Outfitters, [`0x7b71…6cdf`](https://testnet.metalntwx.com/address/0x7b71643913d05D14376562B3682dd1A45CCa6cdf) |

Both match the main run's ledger. Treasury's replace also revoked its predecessor (`0x2576d7e4…1190`) in the same transaction. Sourcing's replace receipt and the customer's bind receipt were not fetched (the budget was used); their terms on /metal come from the main run's ledger.

**The two refusals.**

- Main run, purchase #24 (3 November 2026, 11:23:32 UTC, block 14150386, [`0x2e92f9cb…1871`](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871)): `MandateRefused` on Northwind's account, mandate `0x11734e63…9901` (the Sourcing mandate the ledger names), payee [`0x1936…42ED`](https://testnet.metalntwx.com/address/0x1936e1869FadF65a53B8492fb6ccCf21200d42ED), amount 0.04 \*USDZ, reason 8 (`OverPerPaymentCap`). The transaction itself succeeded: it is the call that records the refusal, and it moved nothing.
- Four-eyes world, a separate run (30 October 2026, 21:56:53 UTC, block 10099272, [`0xf97bcade…f98d`](https://testnet.metalntwx.com/tx/0xf97bcade4a83d7a23198660bee37e1c84d72d6da153eaf6d49f39cd8f542f98d)): `MandateRefused` on account [`0x15eb…a41a`](https://testnet.metalntwx.com/address/0x15eb7c1322952e0c549b7da0b57d35171518a41a), mandate `0x27dbcea7…c5a7`, amount 0.05 \*USDZ, reason 2 (`Revoked`).

**How Sourcing's reference was found.** A mandate's reference is keccak256(principal ‖ typed agent key ‖ hash of the credential), as Metal's SDK computes it. The rule was first checked on Treasury: the derived reference equals the one in its `MandateBound` event, and the event's credential hash equals the ledger's. Sourcing's current reference was then derived from the agent key in the #24 refusal event (a replacement keeps the agent's key) and the replace's credential hash in the ledger, and the read confirmed that a mandate is bound under it.

## Not done

- The customer's mandate, on the customer's own account, was not read.
- No block range was scanned for events: only the four named receipts were read.
- This is a check made once. The inspector on /metal makes its own reads, behind its own cache, daily ceiling and switch (see [metal-award.md](../metal-award.md)).
