# Metal: a hold for exactly the approved amount (10 November, testnet, partial)

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
