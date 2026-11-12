# Metal: a hold for exactly the approved amount (10 November, testnet; finished on 12 November)

**What we added.** Metal's "payment from reserved funds" (MIP20 holds), which Purser did not use before. After the CFO approves an invoice's exact amount, Purser can reserve that amount on chain for one spender: the funds leave the holder's spendable balance and the token lets the spender capture at most what is held. The run then checks, with a read-only simulation, that capturing one base unit more is refused by the token, and captures the exact amount to the supplier. Code: `src/metal/hold.ts`, tests: `test/metal-hold.test.ts`. Docs: https://docs.metalntwx.com/build/payments/payment-from-reserved-funds

**The live run stopped at its budget.** One run on Metal testnet with a hard cap of 15 RPC requests (enforced in code by `budgetedTransport`):

| Step | Result |
|---|---|
| Balances read | holder (Northwind sweep wallet `0xb598…962a`) 1.35 *USDZ; spender (business owner key `0xFe75…Fd8e`) enough for gas |
| `approve` (holder → spender, 0.25 *USDZ) | sent, receipt status success |
| `holdFrom` (spender places a 0.25 *USDZ hold) | sent, receipt status success |
| Simulated capture of 0.25 *USDZ + 1 base unit | sent as the 15th request; the run did not keep its answer, so a refusal is not claimed |
| `captureHold` (0.25 *USDZ to the supplier) | not sent: the 15-request budget was used up |

What this means: 0.25 *USDZ of test money is still held for the business owner key on testnet. Nothing was paid. The transaction hashes of the two sent transactions were not kept, because the first version of the script only reported ids at the end; viem's receipt wait also spent four requests per transaction instead of one.

**Fixed after the run** (in the same commit as this record):
- Each transaction's hash is now saved when it is signed, before it is sent (as Metal's docs ask), and every step is reported as soon as it exists (`runApprovedHold`'s `onStep`).
- The receipt wait reads only the receipt (one request per poll), so a full run needs about 12 requests.
- A failed over-capture simulation counts as a refusal only when the chain reverted; a budget stop or network error stops the run instead.

**Not finished, by decision (Max, 10 Nov):** no further testnet requests. The 0.25 *USDZ hold stays in place on testnet and the capture is not sent. Finishing later would take about 8 testnet requests: read the two accounts' nonces to recover the two hashes deterministically, then capture the 0.25 to the supplier or release the hold.

## Finished on 12 November 2026

Owner's go on 12 Nov. One run on Metal testnet with a hard cap of 15 RPC requests (`budgetedTransport` from `src/metal/hold.ts`, every request logged before it was sent), using the repository's own `liveHoldDeps` from a script outside the repository. Keys: the `testnet` keys folder (holder `sweep`, spender `owner-business`, supplier `supplier`).

| Step | What the chain answered |
|---|---|
| `heldBalanceOf(holder 0xb598…962a, spender 0xFe75…Fd8e)` before | 250000000000000000 base units (0.25 *USDZ): the hold was still open, as recorded |
| Nonces (latest) | holder 1, spender 8 |
| `approve` of 10 Nov, recovered by re-signing at holder nonce 0 | [0x2f2d7afc…6b64fb2a](https://testnet.metalntwx.com/tx/0x2f2d7afce9fce6b21278104828cc552c9d0aea387857f1c8384419cc6b64fb2a): receipt status success, block 23200516, from the holder to the *USDZ token |
| `holdFrom` of 10 Nov, recovered by re-signing at spender nonce 7 | [0x41ef8b79…e1bb39fb](https://testnet.metalntwx.com/tx/0x41ef8b799002e32015fad9a0a988d1f7c2772636a0552e22f8424ed4e1bb39fb): receipt status success, block 23200538, from the spender to the *USDZ token |
| Simulated `captureHold` of exactly 0.25 *USDZ to the supplier (read-only) | would succeed |
| `captureHold` (holder → supplier `0x5D72…7336`, 0.25 *USDZ), hash saved when signed | [0xb371a336…8b7a7859](https://testnet.metalntwx.com/tx/0xb371a336f5a0ec74c4e3a26691dc3f2233882535dcac92e8a74b82f28b7a7859): receipt status success |
| `heldBalanceOf(holder, spender)` after | 0 |

Requests used: 10 of 15 (3 `eth_call`, 3 `eth_getTransactionCount`, 3 `eth_getTransactionReceipt`, 1 `eth_sendRawTransaction`). The two lost hashes were recovered without any extra lookup: Metal's MIP20 signature is deterministic, so re-signing the same call at the account's previous nonce gives the same transaction hash, and the chain returned a successful receipt for each.

What this means: the 0.25 *USDZ of test money that was held on 10 Nov is now paid to the supplier, and nothing is held any more for the business owner key. The over-capture refusal (0.25 *USDZ + 1 base unit) was not re-checked in this run: with the hold captured there is nothing left to over-capture, so the 10 Nov line above still stands as "not claimed".

Full hashes:
- approve: `0x2f2d7afce9fce6b21278104828cc552c9d0aea387857f1c8384419cc6b64fb2a`
- holdFrom: `0x41ef8b799002e32015fad9a0a988d1f7c2772636a0552e22f8424ed4e1bb39fb`
- captureHold: `0xb371a336f5a0ec74c4e3a26691dc3f2233882535dcac92e8a74b82f28b7a7859`
