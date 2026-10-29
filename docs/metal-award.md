# Metal Award checklist

What this build uses from Metal, where it runs, and the proof on Metal testnet. The transactions below come from
rehearsal 3 (29 October 2026, [run log](runs/2026-10-29-rehearsal-3.md)): a fresh world from zero, with Max approving
every proposal with Face ID. Explorer: https://testnet.metalntwx.com. Packages: `@metalntwx/metal-pay` 0.3.4,
`@metalntwx/metal-agent` 0.3.3, `@metalntwx/metal-ts` 0.3.2.

## Why this wins

- **Metal is the agents' spending rail, not a demo add-on.** Every agent that pays per request does it under its
  own on-chain mandate: a cap per payment, a total budget, one payee and an end date. When the supplier raised its
  price, the chain itself refused the next payment (`mandate_cap_exceeded`) and the customer was not charged.
- **The CFO changes on-chain limits with Face ID, safely.** A price rise becomes options; the CFO signs the exact
  terms on the phone; mandates are replaced in an order that never exceeds the 20.00 the business allows, and the old
  credential is refused (`mandate_revoked`).
- **All three ways to pay on Metal, each where it fits:** `exact` x402 with signed orders for per-request sales,
  mandate pulls for refunds and the earnings sweep, and Offer Pay-per-Call Clearing (new in October 2026) for a
  customer that prepays and pays each query with a receipt.
- **Money on Metal reaches the bank only when it is final.** The sweep is credited in Airwallex once, after
  finality, keyed by `chainId:tx:logIndex`.
- **Code checks the chain before and after.** Before signing: the CFO policy and the velocity limits (an agent that
  pays too often or too much is stopped). After: `npm run verify` re-checks every credential, pull and receipt, and
  the daily reconciliation compares each payment in the ledger with its receipt on chain. The dashboard links each
  mandate to its newest payment on the explorer.
- **Honest about what is simulated:** testnet *USDZ is shown as "test USD"; the step from *USDZ to Airwallex is a
  sandbox deposit that names the real testnet transaction.

What we do not use: Metal mainnet, bridges, swaps and on-chain FX (FX happens at Airwallex), and Metal's own card
or bank products. The packages are pinned to the versions above.

## 1. Accounts, *USDZ and the faucet

| What | Where in the code | Proof | Metal docs |
|---|---|---|---|
| Metal smart accounts for the business and the customer (`metal-agent account create`) | `src/cli/bootstrap.ts` | [bootstrap run log](runs/2026-10-29-bootstrap.md) | [Create and manage a smart account](https://docs.metalntwx.com/build/controls/create-and-manage-a-smart-account.md) |
| Testnet *USDZ from the faucet (`metal-agent fund`) | `src/cli/bootstrap.ts`, `src/metal/clearing.ts` | [bootstrap run log](runs/2026-10-29-bootstrap.md) | [Fund a test account](https://docs.metalntwx.com/build/prepare/fund-a-test-account.md) |
| A MIP20 *USDZ transfer: exactly 20.00 from the owner key into the business account; *USDZ pays the gas | `src/metal/chain.ts` `transferUsdz` | [`0xe8150bf7…afd5`](https://testnet.metalntwx.com/tx/0xe8150bf7c4f98d85085d470e8f7b2ef9ca9bdc9adda812768f3aefdec26aafd5) | [Direct payment](https://docs.metalntwx.com/build/payments/direct-payment.md), [Estimate and record fees](https://docs.metalntwx.com/build/prepare/estimate-and-record-fees.md) |

## 2. Mandates: each agent's limits enforced by the account

| What | Where in the code | Proof | Metal docs |
|---|---|---|---|
| Four mandates bound on chain, each with a per-payment cap, a total budget, one payee and an expiry (`metal-agent mandate bind`) | `src/executors/ownerSigner.ts`, `src/cli/bootstrap.ts` | sourcing [`0xd525573c…19bf`](https://testnet.metalntwx.com/tx/0xd525573c5ef06c01e4a92c39f0ab087c06ef21ec5281a3a490dfe410615919bf), support [`0x12a319f3…76ee`](https://testnet.metalntwx.com/tx/0x12a319f3baf957dbbb6a6cadfc4f1dda0a28ccda6fe4c4f766de1853fad576ee), treasury [`0x6ea66684…8e0e`](https://testnet.metalntwx.com/tx/0x6ea6668492b625f7812cbae5be1178dc2adc13f83342136b074a547283378e0e), Summit [`0xe78b3197…c729`](https://testnet.metalntwx.com/tx/0xe78b3197e617179a3a78fd0f59c4a8f05715984caca0594e82e0d293edd9c729) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| The chain refuses a payment over the cap: `mandate_cap_exceeded`, so the customer is not charged (S1) | `src/agents/sourcing.ts`, `src/servers/seller.ts` | [S1 run log](runs/2026-10-29-s1.md) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| Mandates replaced after Face ID, in a safe order (shrink treasury, then grow sourcing; never over 20.00) (`metal-agent mandate replace`) | `src/executors/mandateReplace.ts`, `src/policy/mandates.ts` | treasury [`0x6b77d994…6f7e`](https://testnet.metalntwx.com/tx/0x6b77d9942f5e7ff9669c0a2fd11d4cea166f7db4eaf3f9728c89bc45ac846f7e), sourcing [`0x4c995a76…ccdc`](https://testnet.metalntwx.com/tx/0x4c995a768da10d611bee3d82d0d54812b3018bbdc12969bc4c20e46f3a5dccdc) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| The replaced credential is refused: `mandate_revoked` | `src/cli/s1.ts` | [S1 run log](runs/2026-10-29-s1.md) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| Pull payments under a mandate: refunds and the earnings sweep, each with its own payment id, so a retry pays nothing twice (`metal-agent mandate pull`) | `src/executors/refunds.ts`, `src/agents/sweep.ts` | refunds [`0x0197b1c9…2281`](https://testnet.metalntwx.com/tx/0x0197b1c9e3c8339775439ff90b22d416644f9f0774fc58244826cc724c622281), [`0xa4fb723c…8e52`](https://testnet.metalntwx.com/tx/0xa4fb723c41bddbe6de84ac1064aa9abbadaab3a2d4c5be29efeba04e25b48e52), [`0x788788ee…08d1`](https://testnet.metalntwx.com/tx/0x788788eec4c8d99bb7d7129a68f0a0eea42412b87879d8ec41e66cefee0c08d1); sweep [`0x7c53378d…486b`](https://testnet.metalntwx.com/tx/0x7c53378d3e989e8f780657f39392dfd0a319a79cb0e4d84aae158a430fd0486b) | [Mandates](https://docs.metalntwx.com/agents/mandates.md), [metal-agent](https://docs.metalntwx.com/agents/metal-agent.md) |
| Every credential checked again by `metal-agent mandate verify`; mandate state read from the chain (`mandate status`) | `src/cli/verify.ts`, `src/metal/mandate.ts` | `npm run verify`: 21 checks, all pass on rehearsal 3 (rerun 29 Oct, 17:30 UTC) | [metal-agent](https://docs.metalntwx.com/agents/metal-agent.md) |

## 3. x402 on Metal: agents pay per request

| What | Where in the code | Proof | Metal docs |
|---|---|---|---|
| Our seller offers `exact` x402 on Metal through Metal's hosted facilitator (`registerMetalScheme`) | `src/servers/seller.ts`, `src/servers/supplier.ts` | first sale [`0xc1b06070…ecfa`](https://testnet.metalntwx.com/tx/0xc1b06070a050556f5e2ef820fb2826dd1babde33787fab5c75aef7d3b677ecfa); first supplier purchase [`0xf6f364ea…643d`](https://testnet.metalntwx.com/tx/0xf6f364ea7114b3b3bd47271b4938677629744a939ac9af285733c8b86a33643d) | [x402 on Metal](https://docs.metalntwx.com/agents/x402-on-metal.md), [Facilitator](https://docs.metalntwx.com/agents/facilitator.md) |
| Agents pay under their mandate (`createMandatePaymentClient`); the buyer must sign the order (`requireSignedOffer`) | `src/metal/pay.ts`, `src/servers/seller.ts` | 50 sales in rehearsal 3 | [Mandates](https://docs.metalntwx.com/agents/mandates.md), [Authorized payment](https://docs.metalntwx.com/build/payments/authorized-payment.md) |
| A dispute re-checks each payment and its signed order from the chain (`verifyMandatePayment`): 12 of 12 ordered | `src/agents/disputes.ts` | [S2 run log](runs/2026-10-29-s2.md) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| A payment in doubt is looked up in the facilitator's `/settlements` by its nonce, never paid twice | `src/metal/pay.ts` | [F-tests](runs/2026-10-29-f1.md) | [Facilitator](https://docs.metalntwx.com/agents/facilitator.md), [Verify and reconcile payments](https://docs.metalntwx.com/build/payments/verify-and-reconcile-payments.md) |
| The sweep is credited only once final, locked once by `chainId:tx:logIndex` | `src/agents/sweep.ts` | [S3 run log](runs/2026-10-29-s3.md) | [Settlement and finality](https://docs.metalntwx.com/reference/network-fundamentals/settlement.md) |

## 4. Offer Pay-per-Call Clearing (new on testnet, October 2026)

| What | Where in the code | Proof | Metal docs |
|---|---|---|---|
| Summit deposits *USDZ once into the Clearing contract and pays each 0.07 query with a signed receipt, with no transaction per query | `src/metal/clearing.ts`, `src/agents/customer.ts` | deposit [`0x055ba899…6766`](https://testnet.metalntwx.com/tx/0x055ba89987f658cb038fcbd1660f4d9e98e78e4c44c86c5346946f8cca1a6766); [clearing run log](runs/2026-10-29-clearing.md) | [Clearing](https://docs.metalntwx.com/agents/clearing.md) |
| Our seller offers the `bajillion` scheme on a prepaid route beside `exact`. It offers clearing only when it can deliver (a clearing payment is counted before the seller can refuse, as seen live), and falls back to the mandate route | `src/servers/seller.ts` | [clearing run log](runs/2026-10-29-clearing.md) | [Clearing](https://docs.metalntwx.com/agents/clearing.md) |
| Our earnings leave clearing in two steps: a queued withdrawal, then a claim once its epoch is final | `src/metal/clearing.ts`, `src/cli/clearing.ts` | queue [`0x902badf6…c3d4`](https://testnet.metalntwx.com/tx/0x902badf6f82f4e453c99ff9e5fd870d3e96ab40293bff64e3a611014930cc3d4), claim of 0.70 [`0x522470d2…5092`](https://testnet.metalntwx.com/tx/0x522470d292f78b390fe153cb40905cdc6102afef1345d62e1dc975f900145092) | [Clearing](https://docs.metalntwx.com/agents/clearing.md) |
| Each clearing receipt is checked again with Metal's clearing service (`verifyClearingPayment`) | `src/cli/verify.ts` | `npm run verify` | [Clearing](https://docs.metalntwx.com/agents/clearing.md) |

Status: the deposit and five payments ran live. Sales on the real seller wait for the CFO's Face ID on the sourcing
limit.

## 5. How a judge checks it

```bash
npm run verify
```

This checks the audit chain, every credential, pull, disputed payment, clearing receipt and Face ID approval again
from the chain and from Metal's services. The public demo replays the recorded run at `/demo` on the relay.
