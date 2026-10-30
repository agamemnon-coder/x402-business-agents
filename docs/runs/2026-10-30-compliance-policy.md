# Run log: programmable compliance on Metal (30 October 2026, late evening)

Enterprise item 2 asked: can the chain refuse an outgoing payment unless Purser signed a compliance decision for it?

Yes, as a contract of our own:
- **Metal documents the pattern** (a "send policy contract", docs.metalntwx.com/learn/compliance/programmable-compliance).
- **It ships no such contract** of its own, and none in its packages.
- **Ours** is `contracts/ComplianceSendPolicy.sol`, compiled with pinned solc 0.8.36 (EVM paris) to the committed
  artifact. `test/compliance-contract.test.ts` checks the artifact is exactly what the source compiles to.
- **Live:** `npm run compliance-policy` (`src/cli/compliancePolicy.ts`) ran it on Metal testnet.
- **Full record:** [`compliance-policy.json`](compliance-policy.json).

**A separate test world**, with test keys (operator, Purser's compliance key, an attacker) and test money. "Sanctioned"
means a stand-in address on a test list, not a real sanctions list.

## How it works

1. The business's outgoing funds sit at the contract. They leave only through `send`.
2. `signDecision` (`src/compliance/screening.ts`) screens the payee itself; it never takes a result handed to it. The
   payee must be one the CFO approved and must not be on the sanctions list.
3. Only for a payee that passes does Purser's compliance key sign a decision: EIP-712 in the contract's own domain,
   bound to the payment id, payee, amount and an expiry of at most an hour. It also carries a screening reference: a
   hash of the lists' contents, the payee, the result and the time.
4. `send` checks, in order:
   - the caller is the operator;
   - the decision has not expired;
   - the payment id has not been used;
   - the signature is canonical;
   - the signature recovers to the compliance key over exactly these terms.

   Otherwise it reverts.
5. **Withdrawing a decision.** Purser can withdraw one before it is used: a cancellation the compliance key signed
   marks its id spent. Anyone may submit the cancellation, and it can only stop a payment.
6. **Fork safety.** The contract's domain includes the chain id and is recomputed if the chain id changes (a fork).

## What ran

Contract `0x498d1f70c57a869799b44bcf869983b0e121fa4f`, funded with 2.00.

| Step | Result | Contract's reason | Transaction |
|---|---|---|---|
| Deploy (signer = compliance key, operator = payer key) | deployed | | `0xec54efc4…8dbf` |
| Fund with 2.00 | done | | `0x819201e3…8908` |
| Pay 0.50 to the screened payee, with Purser's decision | **paid**, payee received 0.50 | | `0xc2eb6814…f237` |
| Purser cancels an unused decision | cancelled: its id is spent | | `0x217da656…f898` |
| Purser screens the sanctioned stand-in | **no decision signed** ("on the sanctions list") | | none |
| No decision at all | reverted | `BadSignature` | `0x8a380828…3ca2` |
| A decision signed by the attacker's key | reverted | `NotCleared` | `0x5c037a1c…a0ce` |
| The good decision a second time (replay) | reverted | `PaymentIdSpent` | `0x222385b5…2737` |
| The payee's decision used to pay the attacker | reverted | `NotCleared` | `0x03811931…e23a` |
| The amount raised from 0.50 to 1.50 | reverted | `NotCleared` | `0x7e6bfa28…fbfc` |
| An expired decision | reverted | `DecisionExpired` | `0x25915601…02f0` |
| A valid decision submitted by the attacker | reverted | `NotOperator` | `0xcd0ef962…3250` |
| The valid signature malleated (high s) | reverted | `BadSignature` | `0xa8150620…12e5` |
| A decision Purser signed for another contract | reverted | `NotCleared` | `0xb40ea239…0858` |
| The decision Purser cancelled | reverted | `PaymentIdSpent` | `0x9f58cab1…206d` |
| The sanctioned payee, with a decision the attacker made | reverted | `NotCleared` | `0x91ed35a5…442e` |

- **Only the good payment left the contract:** it holds 1.50 afterwards.
- **The reverts are the contract's checks, not a lack of gas.** Each attack was sent with the gas the good payment
  needed (349,194) and used 26,823 to 220,993 of it. The reason in each row comes from simulating the same call
  against the contract's ABI.
- **Finality:** all 15 transactions have the certificate Metal's RPC reported for their block, stored at once. It
  passes the header, number and quorum checks. The BLS signature is not verified.

## What this does not cover

- **Agents paying under their mandates bypass this contract.** Their payments come from the MetalAccount by mandate
  pull, and Metal's docs say MetalAccount spending does not pass through a send policy. This contract governs funds
  placed in it: in production, the payouts a business routes through it (supplier payouts on Metal, the sweep). The
  agents keep their mandates' own on-chain limits.
- **The chain proves the compliance key signed, not that screening ran.** `signDecision` screens before signing,
  but any code holding the compliance key could sign anyway. In production that key lives in a signer of its own,
  apart from the payer key. Here both sat in one test keys directory.
- **The screening here is two checks against test lists.** In production the same decision is signed after a
  screening provider's check. Airwallex screens its own payments itself.
- **The decision is public once used:** the amount, payee and screening reference are in the transaction data.
- **The compliance key is fixed at deployment.** Rotating it means a new contract.
- **The funds have no way out but `send`, on purpose.** An owner's withdrawal would bypass the policy. A production
  version needs a time-locked recovery controlled by the CFO's quorum (enterprise item 1).
- **No local unit tests of the contract.** This build has no local EVM to run it in, so the contract's behaviour is
  shown by this live run. The TypeScript signer is unit-tested against the same typed data
  (`test/compliance-screening.test.ts`).

The first run (contract `0xdd659fbe…42b2`, before the review) had the same results without the cancellation.
