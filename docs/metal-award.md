# Metal Award checklist

What this build uses from Metal, where it runs, and the proof on Metal testnet. The transactions below come from
rehearsal 3 (29 October 2026, [run log](runs/2026-10-29-rehearsal-3.md)): a fresh world from zero, with every approval
given by Max with Face ID. The same story ran live twice more on 30 October, on the frozen code, each in its own
world with a fresh passkey: [Friday run 1](runs/2026-10-30-friday-1.md) (the recorded demo) and
[Friday run 2](runs/2026-10-30-friday-2.md); `npm run verify` passes on both. Explorer: https://testnet.metalntwx.com. Packages: `@metalntwx/metal-pay` 0.3.4,
`@metalntwx/metal-agent` 0.3.3, `@metalntwx/metal-ts` 0.3.2.

The same evidence as a page: **`/metal`** ("How Purser uses Metal", served by `npm run judge` and the relay) shows a
card per Metal feature with its transaction and Metal docs page, a mandate inspector per agent (cap, budget, payee,
expiry, payments, the chain's refusal) and the Dispute desk case order by order, with its evidence report at
`/metal/report`. Built from the recorded ledger by `npm run demo:record` into `docs/demo/metal.json`; clearing and the
receive policy did not run in the recorded run, so their cards name the separate live runs in sections 4 and 5.

## Why this wins

- **Metal is the agents' spending rail, not a demo add-on.** Every agent that pays per request does it under its
  own on-chain mandate: a cap per payment, a total budget, one payee and an end date. When the supplier raised its
  price, the next payment was refused against the on-chain mandate (`mandate_cap_exceeded`) and the customer was not charged: in the recorded run by Metal's facilitator (a 402; it moves nothing, so there is no transaction), and since 1 November Purser refuses it before signing and Metal's own refusal of the same payment is recorded on chain, a `MandateRefused` event from the business account (autonomous dry runs: dry-103 [`0xd24cb5a7…6acc`](https://testnet.metalntwx.com/tx/0xd24cb5a7a8219c69783420d9d14bdbdab188d9e2a46b6aab9aa8798adf496acc), dry-101 [`0x3ea88238…be03`](https://testnet.metalntwx.com/tx/0x3ea88238d02726a8eeb129214b4b57e233fdfec76418e2995d9062a91654be03), dry-100 [`0x88bacab0…ec25`](https://testnet.metalntwx.com/tx/0x88bacab033145185b3d1f671695d569d24035a23de4193c1d08b5a8879d7ec25)).
- **The CFO changes on-chain limits with Face ID, safely.** A price rise becomes options; the CFO signs the exact
  terms on the phone; mandates are replaced in an order that never exceeds the 20.00 the business allows, and the old
  credential is refused (`mandate_revoked`).
- **Three ways to pay on Metal, each where it fits:** `exact` x402 with signed orders for per-request sales,
  mandate pulls for refunds and the earnings sweep, and Offer Pay-per-Call Clearing (new in October 2026) for a
  customer that prepays and pays each query with a receipt.
- **Purser can set the sweep wallet to accept money only from the business account** (live on testnet in a separate
  world, 30 October; not set in the recorded run). Metal's receive policy then holds a payment from anyone else in
  quarantine; the CFO returns or accepts it with Face ID, and it never reaches the bank on its own.
- **Money on Metal reaches the bank only when it is final.** The sweep is credited in Airwallex once, after
  finality, keyed by `chainId:tx:logIndex`.
- **Code checks the chain before and after.** Before signing: the CFO policy and the velocity limits (an agent that
  pays too often or too much is stopped). After: `npm run verify` re-checks every credential, pull and receipt, and
  the hourly reconciliation compares each payment in the ledger with its receipt on chain. The dashboard links each
  mandate to its newest payment on the explorer.
- **For a bigger company, more control on chain:** a 2-of-2 account (CFO + controller), a compliance send policy
  that reverted eleven attacks, finality certificates kept as evidence, and 2,000 clearing payments under load. Each
  ran live on testnet in a separate test world (section 8).
- **Honest about what is simulated:** testnet *USDZ is shown as "test USD"; the step from *USDZ to Airwallex is a
  sandbox deposit that names the real testnet transaction.

What we do not use, and why: section 7. Receive policy with quarantine on the sweep wallet: section 5.
The packages are pinned to the versions above.

## 1. Accounts, *USDZ and the faucet

| What | Where in the code | Proof | Metal docs |
|---|---|---|---|
| Metal smart accounts for the business and the customer (`metal-agent account create`) | `src/cli/bootstrap.ts` | [bootstrap run log](runs/2026-10-29-bootstrap.md) | [Create and manage a smart account](https://docs.metalntwx.com/build/controls/create-and-manage-a-smart-account.md) |
| Testnet *USDZ from the faucet (`metal-agent fund`) | `src/cli/bootstrap.ts`, `src/metal/clearing.ts` | [bootstrap run log](runs/2026-10-29-bootstrap.md) | [Fund a test account](https://docs.metalntwx.com/build/prepare/fund-a-test-account.md) |
| A MIP20 *USDZ transfer: exactly 20.00 from the owner key into the business account; *USDZ pays the gas | `src/metal/chain.ts` `transferUsdz` | [`0xe8150bf7…afd5`](https://testnet.metalntwx.com/tx/0xe8150bf7c4f98d85085d470e8f7b2ef9ca9bdc9adda812768f3aefdec26aafd5) | [Direct payment](https://docs.metalntwx.com/build/payments/direct-payment.md), [Estimate and record fees](https://docs.metalntwx.com/build/prepare/estimate-and-record-fees.md) |

## 2. Mandates: each agent's limits enforced by the account

| What | Where in the code | Proof | Metal docs |
|---|---|---|---|
| Four mandates bound on chain (three agents and the customer's; the links here are from the 29 October rehearsal world, Northwind's own binds are audit rows 2 to 5 of the recorded run, e.g. the customer's [`0x6a4622a9…59a6`](https://testnet.metalntwx.com/tx/0x6a4622a9ed5a1880b9e56f89adb59f003c9793a78c080db7ec2ae2f4f2ba59a6)), each with a per-payment cap, a total budget, one payee and an expiry (`metal-agent mandate bind`) | `src/executors/ownerSigner.ts`, `src/cli/bootstrap.ts` | sourcing [`0xd525573c…19bf`](https://testnet.metalntwx.com/tx/0xd525573c5ef06c01e4a92c39f0ab087c06ef21ec5281a3a490dfe410615919bf), support [`0x12a319f3…76ee`](https://testnet.metalntwx.com/tx/0x12a319f3baf957dbbb6a6cadfc4f1dda0a28ccda6fe4c4f766de1853fad576ee), treasury [`0x6ea66684…8e0e`](https://testnet.metalntwx.com/tx/0x6ea6668492b625f7812cbae5be1178dc2adc13f83342136b074a547283378e0e), Summit [`0xe78b3197…c729`](https://testnet.metalntwx.com/tx/0xe78b3197e617179a3a78fd0f59c4a8f05715984caca0594e82e0d293edd9c729) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| Metal refuses a payment over the cap, against the on-chain mandate: `mandate_cap_exceeded`, so the customer is not charged (S1) | `src/agents/sourcing.ts`, `src/servers/seller.ts` | [S1 run log](runs/2026-10-29-s1.md) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| Mandates replaced after Face ID, in a safe order (shrink treasury, then grow sourcing; never over 20.00) (`metal-agent mandate replace`) | `src/executors/mandateReplace.ts`, `src/policy/mandates.ts` | treasury [`0x6b77d994…6f7e`](https://testnet.metalntwx.com/tx/0x6b77d9942f5e7ff9669c0a2fd11d4cea166f7db4eaf3f9728c89bc45ac846f7e), sourcing [`0x4c995a76…ccdc`](https://testnet.metalntwx.com/tx/0x4c995a768da10d611bee3d82d0d54812b3018bbdc12969bc4c20e46f3a5dccdc) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| The replaced credential is refused: `mandate_revoked` | `src/cli/s1.ts` | [S1 run log](runs/2026-10-29-s1.md) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| Pull payments under a mandate: refunds and the earnings sweep, each with its own payment id, so a retry pays nothing twice (`metal-agent mandate pull`) | `src/executors/refunds.ts`, `src/agents/sweep.ts` | refunds [`0x0197b1c9…2281`](https://testnet.metalntwx.com/tx/0x0197b1c9e3c8339775439ff90b22d416644f9f0774fc58244826cc724c622281), [`0xa4fb723c…8e52`](https://testnet.metalntwx.com/tx/0xa4fb723c41bddbe6de84ac1064aa9abbadaab3a2d4c5be29efeba04e25b48e52), [`0x788788ee…08d1`](https://testnet.metalntwx.com/tx/0x788788eec4c8d99bb7d7129a68f0a0eea42412b87879d8ec41e66cefee0c08d1); sweep [`0x7c53378d…486b`](https://testnet.metalntwx.com/tx/0x7c53378d3e989e8f780657f39392dfd0a319a79cb0e4d84aae158a430fd0486b) | [Mandates](https://docs.metalntwx.com/agents/mandates.md), [metal-agent](https://docs.metalntwx.com/agents/metal-agent.md) |
| Every credential checked again by `metal-agent mandate verify`; mandate state read from the chain (`mandate status`) | `src/cli/verify.ts`, `src/metal/mandate.ts` | `npm run verify`: all checks pass on rehearsal 3 (20 in its run log) and on both Friday runs | [metal-agent](https://docs.metalntwx.com/agents/metal-agent.md) |

**In the recorded run (Friday run 1, 30 October),** the CFO approved P-0002 with Face ID and the mandates were
replaced in the safe order: treasury shrunk to 4.00
([`0x2909b164…8aed`](https://testnet.metalntwx.com/tx/0x2909b164c50779c342783309943901472cf1c966402c550d0d28f5ab86a08aed)),
then sourcing grown to 0.04 a check and 12.00 in total
([`0xbc70858f…b5d7`](https://testnet.metalntwx.com/tx/0xbc70858fef5ca185cb8dffb860becac2fe0876888aa5ea57d8aee2700449b5d7)).
Both are rows 102 and 103 of the run's audit log ([docs/audit/](audit/README.md)). The rows above link the
rehearsals of 29 October.

## 3. x402 on Metal: agents pay per request

| What | Where in the code | Proof | Metal docs |
|---|---|---|---|
| Our seller offers `exact` x402 on Metal through Metal's hosted facilitator (`registerMetalScheme`) | `src/servers/seller.ts`, `src/servers/supplier.ts` | first sale [`0xc1b06070…ecfa`](https://testnet.metalntwx.com/tx/0xc1b06070a050556f5e2ef820fb2826dd1babde33787fab5c75aef7d3b677ecfa); first supplier purchase [`0xf6f364ea…643d`](https://testnet.metalntwx.com/tx/0xf6f364ea7114b3b3bd47271b4938677629744a939ac9af285733c8b86a33643d) | [x402 on Metal](https://docs.metalntwx.com/agents/x402-on-metal.md), [Facilitator](https://docs.metalntwx.com/agents/facilitator.md) |
| Agents pay under their mandate (`createMandatePaymentClient`); the buyer must sign the order (`requireSignedOffer`) | `src/metal/pay.ts`, `src/servers/seller.ts` | 50 sales in rehearsal 3 | [Mandates](https://docs.metalntwx.com/agents/mandates.md), [Authorized payment](https://docs.metalntwx.com/build/payments/authorized-payment.md) |
| A dispute re-checks each payment and its signed order from the chain (`verifyMandatePayment`): 12 of 12 ordered | `src/agents/disputes.ts` | [S2 run log](runs/2026-10-29-s2.md) | [Mandates](https://docs.metalntwx.com/agents/mandates.md) |
| A payment in doubt is looked up in the facilitator's `/settlements` by its nonce, never paid twice | `src/metal/pay.ts` | tested in code (`test/` in-doubt cases); not yet exercised live (Metal QA, 1 November) | [Facilitator](https://docs.metalntwx.com/agents/facilitator.md), [Verify and reconcile payments](https://docs.metalntwx.com/build/payments/verify-and-reconcile-payments.md) |
| The sweep is credited only once final, locked once by `chainId:tx:logIndex` | `src/agents/sweep.ts` | [S3 run log](runs/2026-10-29-s3.md) | [Settlement and finality](https://docs.metalntwx.com/reference/network-fundamentals/settlement.md) |

## 4. Offer Pay-per-Call Clearing (new on testnet, October 2026)

| What | Where in the code | Proof | Metal docs |
|---|---|---|---|
| A prepaying test customer (a new account in the rehearsal-3 world) deposits 5.00 *USDZ once into the Clearing contract and pays each 0.07 query with a signed receipt, with no transaction per query | `src/metal/clearing.ts`, `src/agents/customer.ts` | deposit [`0x055ba899…6766`](https://testnet.metalntwx.com/tx/0x055ba89987f658cb038fcbd1660f4d9e98e78e4c44c86c5346946f8cca1a6766); [clearing run log](runs/2026-10-29-clearing.md) | [Clearing](https://docs.metalntwx.com/agents/clearing.md) |
| Our seller offers the `bajillion` scheme on a prepaid route beside `exact`. It offers clearing only when it can deliver (a clearing payment is counted before the seller can refuse, as seen live), and falls back to the mandate route | `src/servers/seller.ts` | [clearing run log](runs/2026-10-29-clearing.md) | [Clearing](https://docs.metalntwx.com/agents/clearing.md) |
| Our earnings leave clearing in two steps: a queued withdrawal, then a claim once its epoch is final | `src/metal/clearing.ts`, `src/cli/clearing.ts` | queue [`0x902badf6…c3d4`](https://testnet.metalntwx.com/tx/0x902badf6f82f4e453c99ff9e5fd870d3e96ab40293bff64e3a611014930cc3d4), claim of 0.70 [`0x522470d2…5092`](https://testnet.metalntwx.com/tx/0x522470d292f78b390fe153cb40905cdc6102afef1345d62e1dc975f900145092) | [Clearing](https://docs.metalntwx.com/agents/clearing.md) |
| Each clearing receipt is checked again with Metal's clearing service (`verifyClearingPayment`) | `src/cli/verify.ts` | `npm run verify` | [Clearing](https://docs.metalntwx.com/agents/clearing.md) |

Status: the deposit and five probe payments ran live; then, after the CFO approved P-0009 with Face ID, five real
clearing sales ran on the seller, all five receipts verified, and 0.70 was withdrawn (clearing run log).

## 5. Receive policy and quarantine (built into Purser, 30 October)

Metal's [receive policy](https://docs.metalntwx.com/reference/compliance/receive-policy.md) lets an account choose
whom it accepts *USDZ from. A refused credit can go to **quarantine** instead of reverting: the payment completes,
but `ReceivePolicy` (`0x…0f4d`) holds the funds until the recovery authority releases them. For Purser this fits the
sweep wallet: accept earnings only from Northwind's own business account, and hold anything else for the CFO.

We tried it with three new throwaway addresses (keys in the private keys repo, `b1-spike`), not with a Northwind
world:

| Step | Result | Transaction |
|---|---|---|
| The receiver sets allowlist-only, refusal `QUARANTINE`, recovery `RECEIVER` | `policyOf` reads `(true, false, 1, 1, 0x0)` | [`0xa5418287…4a3f`](https://testnet.metalntwx.com/tx/0xa54182873017cd2ad4c8120c1d5e2c6cd9bbbfd58ee4a01ccbca933b80f84a3f) |
| It allows one sender | `reasonFor` gives 0 for that sender, 2 (`SENDER_NOT_ALLOWED`) for any other | [`0x508a71d2…b786`](https://testnet.metalntwx.com/tx/0x508a71d2de0fda97a8d2ba2f26a500059e8841ffea7c48bed082e8e43516b786) |
| The allowed sender pays 0.01 | credited to the receiver | [`0x336b1655…698b`](https://testnet.metalntwx.com/tx/0x336b16557daa65ff2d6b49a6f2a99bfaf2578036a32b82e0dd14dc1a486a698b) |
| An unknown sender pays 0.02 | the transfer succeeds but the receiver gets nothing: `Quarantined`, reason 2, and the receipt id we recompute matches the event | [`0x695eea1d…fa83`](https://testnet.metalntwx.com/tx/0x695eea1d805f30d646e0eb530d8e55dd15fda6834a609ef53f8bd11006dcfa83) |
| The receiver accepts it after review (`claim` to itself) | `open(receiptId)` goes from true to false; the receiver is credited 0.02 less the gas for the claim | [`0x33fb24ff…44fc`](https://testnet.metalntwx.com/tx/0x33fb24ff25bdac52b38767d3e71064106bff106e51cb7bcb7f3633ac1c4f44fc) |

What testnet does not have yet, as Metal's page warns: maximum amounts, sender totals and sender frequency (an
earlier `ReceivePolicy`; `policyOf` returns five fields). Allowlist, blocklist, token filter, minimum amount,
quarantine and claim work.

**In Purser now.** `npm run receive-policy -- setup` sets it on the sweep wallet: allowlist only, quarantine, released
by the wallet itself, and only the business account allowed (the sender of every earnings sweep is the business
account, whose balance a mandate pull debits). The runner reads ReceivePolicy's `Quarantined` events for the wallet
every 30 seconds (`src/policy/quarantine.ts`). Each held payment is recorded once with chain id, transaction hash, log
index and the full receipt, shown on the dashboard (treasury panel and feed), and never bridged to Airwallex: the
finality gate only credits a transfer that reached the wallet. The CFO gets two options with Face ID, return it to the
sender or accept it; the executor checks the stored receipt against the approved terms and that Metal still holds it,
claims it, and the other option is superseded.

Live on testnet with Purser's own code, in a separate world (`b1-world`; not a Northwind run world):

| Step | Result | Transaction |
|---|---|---|
| `npm run receive-policy -- setup` on the sweep wallet `0x5eFC…6b23` | allowlist only, quarantine; the business account `0xBb24…E30F` allowed | [`0xf1a7fe96…0c37`](https://testnet.metalntwx.com/tx/0xf1a7fe9664053c9d2fdf1b2d11122bde5be0668da8afc8d4f17b08088e220c37), [`0xb29628dd…fc2f`](https://testnet.metalntwx.com/tx/0xb29628dd47cc27aebe345ebc19f0af38da6a733dc67a46698d3d8fe13a69fc2f) |
| An earnings sweep: the treasury mandate pulls 0.01 from the business account | credited to the sweep wallet | [`0x3caf1e9d…11b7`](https://testnet.metalntwx.com/tx/0x3caf1e9dbb0d2fca75e5af80dc825d3790dbeac5a0ff1c3f83a7dd700f7811b7) |
| An unknown sender `0xA262…b646` pays 0.02 | the sweep wallet gets nothing; Metal holds it | [`0x9076343b…20d3`](https://testnet.metalntwx.com/tx/0x9076343b01ba60809fad1a25c4f8dfa91bfaa15ffec45f55946ceea4e15e20d3) |
| `npm run receive-policy -- poll` | recorded as held; two proposals (return, accept) wait for the CFO's Face ID | — |
| Max approves P-0001 (return to the sender) with his passkey on the phone, 30 October 08:45 UTC | Purser checks the receipt against the approved terms and that Metal still holds it, then the sweep wallet claims it back to `0xA262…b646`; P-0002 (accept) is superseded | [`0x786686b6…fc3c`](https://testnet.metalntwx.com/tx/0x786686b6dd5112b80bbf84902c8b51f407459c3e3112a6a3d8a0e23bac60fc3c) |

So the whole path is in the evidence: a stranger's payment held by Metal, recorded by Purser, never bridged, and
returned only after the CFO's Face ID.

## 5b. The Dispute desk: what the seller can prove, then decide (Metal jury input, 30 October)

When a customer says its agent never agreed to an order or a price, or asks whether the agent acted under a mandate a
real person signed, Northwind as the seller settles it on its own terms (`src/seller/`, `npm run dispute`):

| What the seller holds | From Metal | Proves |
|---|---|---|
| The order the customer's agent signed | the signed offer in the x402 payment (`signedOfferOf`), with the checkout: amount, payee, resource | what the agent agreed to, and the price |
| The payment checked against the customer's mandate | `verifyMandatePayment` (step 4: the payment is the agent's per-payment mandate, inside the mandate at its block) | the agent acted inside limits its principal set |
| The mandate | its `MandateBound` event on the customer's account: limits, payee, expiry, bound by the owner key | who stood behind it: the account's owner |
| The settlement and the delivery | the tx and `/settlements`; the SHA-256 of the data delivered | that it was paid once and what was delivered |

The rules are code (`decideDispute`):

- A valid signed order inside the bound mandate: the "never ordered", "not authorised" and "wrong price" claims are rejected with that evidence.
- No valid signed order, a reused (replayed) order, or a second charge for the same request: refunded.
- Data the supplier's correction shows was wrong: refunded.
- A refund goes only to the payer, never twice and never above what was paid. Within the CFO's limits it is paid at once; above them it becomes a proposal for Face ID.

Opus explains the decision (advice). The customer gets a one-page report with explorer links
([example, live](disputes/DD-a88e8959.html), [run log](runs/2026-10-30-dispute-desk.md)).

**A real person?** Metal proves the owner key bound the mandate. It does not prove that a person holds that key.
Purser's optional addition: the customer's owner registers a passkey with the seller and confirms each mandate with it
(Face ID or similar), and the seller checks the signature (`src/seller/humanProof.ts`). This is labelled as Purser's,
not enforced by Metal.

## 6. Evidence: how Purser's records map to Metal's model

Metal's [Evidence and Regulatory Access](https://docs.metalntwx.com/learn/compliance/regulatory-access.md) page
describes what a payment service provider keeps so an auditor can follow a MIP20 payment: the on-chain reference
(chain id, token, transaction hash, the transfer's log index) and the provider's own records under the same payment
reference. Purser is software, not a payment service provider, but it keeps the same kinds of record:

| Metal's model | Where Purser keeps it | Gap |
|---|---|---|
| Chain id, token, transaction hash, log index of the transfer | `chain_credits.event_key` is `chainId:tx:logIndex` for the sweep; the token is always *USDZ (`src/metal/network.ts`) | Sales, refunds and upstream purchases keep the transaction hash but not the log index; the transfer is found in that transaction |
| Payment instruction, payment reference and each attempt | Refunds by `payment_id` (`refund-<sale>`), sweeps by `payment_id`, each proposal step by `executions.idempotency_key`; a signed purchase in doubt by its nonce; refusals are recorded, not only successes | — |
| Quarantine receipts and claims | `quarantines`: the full receipt with chain id, transaction hash and log index; the release transaction and the approved proposal | — |
| Policy version, checks and decision history | the limits in code (`src/config/policy.ts`) and every CFO policy change as a `policy.changed` event with its from and to values and the approved proposal, `proposals` (terms, evidence, explanation), `approvals` (the hash the CFO signed, method `passkey`), the hash-chained `audit_log` | — |
| Signed decisions | The customer's signed order per sale (`sales.signed_offer`) and the CFO's passkey signature over the terms hash (`passkey_assertions`) | A signed screening decision per payout from the policy contract (`contracts/ComplianceSendPolicy.sol`, section 8); in a separate test world, not in the recorded run |
| Original records and linked corrections | The audit log cannot be updated or deleted (triggers) and is hash-chained; a changed payee is a new record that needs a request, verification and approval (`payee_changes`) | — |
| Customer and Travel Rule records | None: the customer is simulated and Purser holds no personal data on chain | Out of scope for a testnet demo |

## 7. What we do not use, and why

| Metal feature | Why not |
|---|---|
| MIP410 shielded payments | Purser's point is that the CFO and an auditor can see every agent payment on the explorer. Private amounts and parties would hide exactly that. A business paying suppliers privately could use it later, with viewing keys for its auditor. |
| Payment messaging between institutions (Travel Rule exchange) | It is for payments between institutions (VASPs). Purser's agents pay one supplier and refund one customer inside a testnet demo; there is no counterparty institution to exchange messages with. Purser does export a paid invoice as ISO 20022 pacs.008 for a bank's or an ERP's tooling (section 9). |
| Bridges, swaps and on-chain FX | The kit says the Airwallex sandbox cannot receive stablecoins, so the step to Airwallex is a simulated deposit that names the testnet transaction. FX happens at Airwallex. |
| Metal mainnet | Test money only, as the hackathon asks. |

## 8. Enterprise controls on Metal (30 October, evening)

Each was first checked against Metal's docs, then run live on testnet in a separate test world (test keys, test
money), not in Northwind's recorded run. Risks, controls and tests: [controls-matrix.md](controls-matrix.md).

**Four eyes on chain** ([run log](runs/2026-10-30-four-eyes.md)).
- **The account.** A MetalAccount with two owners, the CFO's key and the controller's key, threshold 2 (account
  [`0x15Eb7c1322952E0C549b7Da0b57d35171518A41A`](https://testnet.metalntwx.com/address/0x15Eb7c1322952E0C549b7Da0b57d35171518A41A)).
- **Binding.** Binding the agent's mandate with the CFO alone was refused by the account; with both, it was bound:
  [`0x47f83737…0a3a`](https://testnet.metalntwx.com/tx/0x47f83737060e34446c20a07de30026bd153618b5694b42bc4141e0f055770a3a).
- **Payments from the account itself.** Each refusal below is a reverted transaction on chain:
  - signed by the CFO alone, reverted: [`0xe0976c5a…69c3`](https://testnet.metalntwx.com/tx/0xe0976c5a0ad7ebe51ed0bc9564b2f366fd141b6ba24a55b09fe71ea23e2269c3);
  - signed by the CFO and a stranger, reverted: [`0x728a9c27…c43b`](https://testnet.metalntwx.com/tx/0x728a9c270614d5bbeb11540f897a3b29fab00e2275c84cbb4022c74d7149c43b);
  - signed by the CFO and the controller, paid: [`0xd98e94ff…d30d`](https://testnet.metalntwx.com/tx/0xd98e94ffa3c859de037f944322b05c0f3a097f45780dbd1b8ec9d4689961d30d).
- **Revoking the mandate:**
  - with the CFO alone, reverted: [`0x3bf9f70e…3ab5`](https://testnet.metalntwx.com/tx/0x3bf9f70e0b7c4e3c9cef05eddc755d3a4218227251b3699ddaa77756ba303ab5);
  - with both, revoked: [`0xb1723632…6d4b`](https://testnet.metalntwx.com/tx/0xb1723632242a7951136860c69baa46561c0d7d637b73196d98b6a051037e6d4b).
- **The agent still pays alone inside its mandate.** "Large" means above the mandate's cap: Metal documents no
  per-amount threshold.

**Programmable compliance: a send policy** ([run log](runs/2026-10-30-compliance-policy.md)).
- **The contract.** `contracts/ComplianceSendPolicy.sol`, Metal's documented pattern; Metal ships no such contract.
  Funds held at it leave only with a decision Purser's compliance key signed for exactly that payment, after
  screening the payee.
- **The good payment** paid 0.50: [`0xc2eb6814…f237`](https://testnet.metalntwx.com/tx/0xc2eb68144c8285a07ac6687a8f1c8085e9ee2826f8d6043663073eca2e79f237).
- **A decision Purser cancelled** before use was refused afterwards:
  - the cancellation: [`0x217da656…f898`](https://testnet.metalntwx.com/tx/0x217da656e278a1264dad7c0ae9ed50f41b6d34c52356229e44d691a3fcf8f898);
  - the refusal: [`0x9f58cab1…206d`](https://testnet.metalntwx.com/tx/0x9f58cab1cc1e5466184da28e22d49193d7a428bb25cb73822c597bb54bba206d).
- **Eleven attacks reverted on chain**, among them:
  - the replay: [`0x222385b5…2737`](https://testnet.metalntwx.com/tx/0x222385b575d3b143e462e1146bd37d556fd263a6aa87f264fce9721b63232737);
  - a decision redirected to the attacker: [`0x03811931…e23a`](https://testnet.metalntwx.com/tx/0x0381193151a1990c4d6c829fa15243b30471e72dfb9bdfdfcd9c2ce13ad5e23a);
  - the sanctioned stand-in with a self-made decision: [`0x91ed35a5…442e`](https://testnet.metalntwx.com/tx/0x91ed35a52e1b3a0c01dbff9ab23f934d7d617b506ab89ac4022cf0739aed442e).
- **Limit:** agents' mandate payments do not pass through it (Metal's design).

**Finality certificates** (`metal_getFinalityCertificate`).
- **Stored per transaction.** The runner stores, every minute, the certificate Metal's RPC reports for each ledger
  transaction's block. Each of the 26 transactions above has one: 3 of the 4 validators named, the header hashing
  to the block.
- **Not a proof.** The BLS signature is not verified, because Metal has not published testnet's validator keys. So
  these are what the RPC reported.
- **About 2 hours.** Nodes keep certificates for about 2 hours on testnet (100,000 blocks at 13.4 a second,
  measured). The recorded run's had expired before this was built.
- **Where they appear:** the dispute evidence pack, the audit PDF and `npm run verify`.

**Clearing under load** ([run log](runs/2026-10-30-clearing-load.md)).
- **The test.** 16 payer wallets paid 125 requests each at 0.001, all at once, through Metal's clearing and
  facilitator.
- **Result.** 2,000 of 2,000 paid in 471.8 s: 4.24 a second, latency p50 1.4 s and p95 8.1 s (most of the tail is
  waiting out epoch boundaries). The seller's balance rose by exactly 2.000. 32 chain transactions in all (16 approvals and 16
  deposits).
- **Cost.** About $0.0007 of RPC calls per payment, estimated from Metal's published rates; not a bill.
- **Found.** In a first run, one wallet was held after a lost answer (1,879 of 2,000 paid, nothing paid twice).
  Resending the same request, as Metal's docs say, fixed it.
- **Not shown.** Metal's ceiling: 16 wallets, one machine, testnet.

## 9. ISO 20022: one message linking the SWIFT transfer and the Metal transaction

`npm run iso20022 -- BTX-2026-11` (`src/finance/iso20022.ts`) exports the recorded run's paid invoice as a
pacs.008.001.08 message: [`docs/iso20022/pacs008-BTX-2026-11.xml`](iso20022/pacs008-BTX-2026-11.xml).
- **Two transactions in one message:**
  - the Airwallex SWIFT transfer that paid Bergtex's invoice: EUR 1,850.00, EndToEndId `BTX-2026-11`, UETR
    `4d508b0b-ef38-41d3-b96e-f6cc3f5cfeb4` (Airwallex's transfer id), the invoice as structured remittance;
  - the Metal transaction that swept 1.35 test USD of earnings to the bank, booked at Airwallex as deposit
    `56366c9d…c838`. Test USD is written as the ISO test currency XTS; chain addresses are proxies.
- **The link.** Both carry one Purser reference, and a supplementary block names the Metal transaction and its
  block, the Airwallex deposit, the conversion, the transfer and the hash of the terms the CFO approved.
- **Checked.** It is valid against the official XSD (`test/iso20022.test.ts`, with xmllint, also in CI).
- **What it is not.** It is not a message a bank sent. The sandbox assigns no SWIFT UETR, and the IBAN is masked
  in the export (the audit log keeps the IBAN read from the invoice).

## Friday runs (30 October): the chain's answers, twice

| What Metal did | Run 1 | Run 2 |
|---|---|---|
| Stock check #41 refused against the on-chain mandate at the old cap (`mandate_cap_exceeded`), customer not charged (absent from `/settlements`) | yes | yes |
| Old Sourcing agent credential refused after the CFO's mandate replace (`mandate_revoked`) | yes | not logged |
| Disputed orders verified (`verifyMandatePayment`): signed by the customer's mandate key, inside its bound mandate | 12/12 | 12/12 |
| Refunds pulled under the support mandate, to the customer only | 3 ([`0xcf11b76d…`](https://testnet.metalntwx.com/tx/0xcf11b76d424f22ca07c514e9a9acb325238ea851f8c600ee92a578b6e421bed1)) | 3 + 9 (P-0003 approved by mistake; still paid only to Summit's own account) ([`0x3fd87766…`](https://testnet.metalntwx.com/tx/0x3fd87766d4392f93ed20a88c47d6d5e7a1c7fee2a8d534990371694aed9321a5)) |
| Earnings swept under the treasury mandate, credited to Airwallex after finality | 1.35 ([`0x808f9133…`](https://testnet.metalntwx.com/tx/0x808f913345b176d20a1a319c1fd29965c283980c7616a9c838ccc522341fa94f)) | 1.15 ([`0x1844bff9…`](https://testnet.metalntwx.com/tx/0x1844bff9d11282add2b74a3cc639e61cc6b3258bff87d44b00eb98b90e82fea8)) |

## 10. How a judge checks it

With no keys:
- **Every hash on this page and on `/metal`** opens on the Metal testnet explorer.
- **The recorded run's audit log** is in the repo. This recomputes its 194-row chain offline:

  ```bash
  npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl
  ```

  The head matches the one the pages show ([docs/audit/](audit/README.md)).
- **`npm run judge`** serves the recorded run's pages offline: start at `/`, then `/metal`.

With the ledger and a Metal RPC endpoint, `npm run verify` goes further. It re-checks every credential, pull,
disputed payment and clearing receipt against the chain and Metal's services, and every Face ID approval against its
stored passkey signature.
