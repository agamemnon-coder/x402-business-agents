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
2. Before a payment, Purser screens the payee (`src/compliance/screening.ts`). The payee must be one the CFO approved,
   and must not be on the sanctions list.
3. Only for a payee that passes does Purser's compliance key sign a decision: EIP-712 in the contract's own domain,
   bound to the payment id, payee, amount, an expiry, and a reference to the list and the result.
4. `send` checks, in order:
   - the caller is the operator;
   - the decision has not expired;
   - the payment id has not been used;
   - the signature is canonical;
   - the signature recovers to the compliance key over exactly these terms.

   Otherwise it reverts.

## What ran

Contract `0xdd659fbe72e9170ce7d8099636a45121173342b2`, funded with 2.00.

| Step | Result | Contract's reason | Transaction |
|---|---|---|---|
| Deploy (signer = compliance key, operator = payer key) | deployed | | `0x93533e4a…faa5` |
| Fund with 2.00 | done | | `0xbad409c3…850c` |
| Pay 0.50 to the screened payee, with Purser's decision | **paid**, payee received 0.50 | | `0xf35de591…331a` |
| Purser screens the sanctioned stand-in | **no decision signed** ("on the sanctions list") | | none |
| No decision at all | reverted | `BadSignature` | `0x9e642db4…1e1e` |
| A decision signed by the attacker's key | reverted | `NotCleared` | `0x44dfdef4…cb62` |
| The good decision a second time (replay) | reverted | `PaymentIdSpent` | `0xfc112291…72b7` |
| The payee's decision used to pay the attacker | reverted | `NotCleared` | `0xcd8ce25d…9c2c` |
| The amount raised from 0.50 to 1.50 | reverted | `NotCleared` | `0x05af39ff…3125` |
| An expired decision | reverted | `DecisionExpired` | `0xd2f81433…afd3` |
| A valid decision submitted by the attacker | reverted | `NotOperator` | `0x86029260…a679` |
| The valid signature malleated (high s) | reverted | `BadSignature` | `0xc1949a03…3e49` |
| A decision Purser signed for another contract | reverted | `NotCleared` | `0x81a926c2…595b` |
| The sanctioned payee, with a decision the attacker made | reverted | `NotCleared` | `0xbf8775d2…f573` |

- **Only the good payment left the contract:** it holds 1.50 afterwards.
- **The reverts are the contract's checks, not a lack of gas.** Each attack was sent with the gas the good payment
  needed (349,026) and used 26,676 to 220,846 of it. The reason in each row comes from simulating the same call
  against the contract's ABI.
- **Finality:** all 13 transactions have Metal's finality certificate stored. Not checked: the BLS signature.

## What this does not cover

- **Agents paying under their mandates bypass this contract.** Their payments come from the MetalAccount by mandate
  pull, and Metal's docs say MetalAccount spending does not pass through a send policy. This contract governs funds
  placed in it: in production, the payouts a business routes through it (supplier payouts on Metal, the sweep). The
  agents keep their mandates' own on-chain limits.
- **The screening here is two checks against test lists.** In production the same decision is signed after a
  screening provider's check. Airwallex screens its own payments itself.
- **The decision is public once used:** the amount, payee and screening reference are in the transaction data.
- **The funds have no way out but `send`, on purpose.** An owner's withdrawal would bypass the policy. A production
  version needs a time-locked recovery controlled by the CFO's quorum (enterprise item 1).
- **No local unit tests of the contract.** This build has no local EVM to run it in, so the contract's behaviour is
  shown by this live run. The TypeScript signer is unit-tested against the same typed data
  (`test/compliance-screening.test.ts`).
