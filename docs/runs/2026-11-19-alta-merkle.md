# Every signed payment of the day, one Alta transaction: 2026-11-19

`npm run approvals:merkle -- live` (src/cli/approvalMerkle.ts, src/anchor/merkle.ts). **Alta (formerly Metal) testnet**, test money (gas only).
The machine-readable record, with each payment's leaf and inclusion proof, is docs/runs/2026-11-19-alta-merkle.json.

The hash of the terms each payment was signed over (a labelled virtual test passkey; Airwallex holds the same hash in
the transfer's metadata.approval_sha256) is one leaf; 33 leaves, one root, one transaction.

| | |
|---|---|
| Root | `e47d3102eac753a5f7299633586f0636ad13ad99713726a75be0b63f02cd5937` |
| Leaves | 33: 30 soak payments, 3 bills payments (docs/runs/2026-11-19-airwallex-soak.json, -bills.json) |
| Transaction | [`0x39d39cd8f661afd8ddfcf4b12e69e0d6357c58cd0294be33dde6cbd4233a1384`](https://testnet.metalntwx.com/tx/0x39d39cd8f661afd8ddfcf4b12e69e0d6357c58cd0294be33dde6cbd4233a1384), block 35737169, chain id 63825 |
| Sent from | `0xd996570d2a70991e8793a074Fe0000B099823374` (a gas-only key that owns nothing) |
| Calldata | the text `purser.merkle/v1 <root> <leaves>` |
| Read back from the chain | success, block 35737169; calldata root **matches** |
| Proofs | 33 of 33 verify against the root offline; 33 of 33 hashes are the ones Airwallex read back |

Tree: leaf = SHA-256(0x00 || approval hash), node = SHA-256(0x01 || left || right), an odd node carried up (src/anchor/merkle.ts)

## Check one payment yourself

```bash
npm run approvals:merkle -- verify            # every leaf from the run records, every proof, offline
npm run approvals:merkle -- verify --chain    # and the transaction's calldata (METAL_RPC_URL set)
```

Or by hand, for one payment: leaf = SHA-256(0x00 ‖ approval hash); for each proof step, SHA-256(0x01 ‖ step ‖ h) when
the step is on the left (L), SHA-256(0x01 ‖ h ‖ step) when on the right (R); the end is the root in the calldata.

| # | Payment | Transfer | Approval hash | Proof steps | Airwallex holds it |
|---|---|---|---|---|---|
| 0 | BTX-SOAK-01 | `a63888f6-3388-498e-993f-d2efbb64b578` | `7501cf8c149879b5…` | 6 | yes |
| 1 | SLL-SOAK-02 | `11d6fbe5-76c8-404f-a528-7c200e5f794e` | `0e6eea8ee299ee01…` | 6 | yes |
| 2 | BTX-SOAK-03 | `87a403db-b7eb-4f0d-8b31-a0b2f4535251` | `bfb8bc638c2c99aa…` | 6 | yes |
| 3 | BTX-SOAK-04 | `58c77e7d-5577-463f-a43a-732a0f6966a9` | `a0d3ed704075e4bd…` | 6 | yes |
| 4 | BTX-SOAK-05 | `0acd2cad-fcf7-49a6-abc1-b5e4b37498d7` | `a120bdfe29247f0c…` | 6 | yes |
| 5 | BTX-SOAK-06 | `be24bdd5-95ab-4107-baba-9f7e5e26d4d0` | `d1a3e8c19576e237…` | 6 | yes |
| 6 | SLL-SOAK-07 | `3dd8fb2c-6d6f-4347-80dd-ff81989a6acc` | `9b225468f6579404…` | 6 | yes |
| 7 | BTX-SOAK-08 | `bf959679-2866-4bfc-a3a5-e5b0b6c5d28a` | `0aaa62bc868d86f5…` | 6 | yes |
| 8 | BTX-SOAK-09 | `b420dd66-39f0-43c7-9ddd-c2b79cb3fdd0` | `af10439c65aabacf…` | 6 | yes |
| 9 | BTX-SOAK-10 | `e821de96-a98c-4481-b0ce-5ba55a5ff521` | `570105fa571a2e84…` | 6 | yes |
| 10 | BTX-SOAK-11 | `1fbac219-4233-4827-b127-e46a7738b3a4` | `56b9d682c49f1548…` | 6 | yes |
| 11 | SLL-SOAK-12 | `76ecfaa2-8d9a-47d5-b347-6a7890233788` | `10abe463ec8c83e7…` | 6 | yes |
| 12 | BTX-SOAK-13 | `82d06707-a975-4fb6-8140-ff2611e4384c` | `514a84b5bc44dd45…` | 6 | yes |
| 13 | BTX-SOAK-14 | `11c9e397-9d8d-4b25-a02e-9e465a3e8221` | `03aa37600d11765b…` | 6 | yes |
| 14 | BTX-SOAK-15 | `02ff4a68-3a90-431f-b805-ce00b9ba1236` | `6f1e393041478f84…` | 6 | yes |
| 15 | BTX-SOAK-16 | `8c4a541f-bdea-4e1e-b69a-678ef112ebac` | `9c3ea2a5d5fd2e79…` | 6 | yes |
| 16 | SLL-SOAK-17 | `6b037188-b075-44fd-8fb0-d4e30060ea0a` | `664311c446d7d4df…` | 6 | yes |
| 17 | BTX-SOAK-18 | `c060f57f-7605-487f-af9b-bbc611528c86` | `356013128836bd0c…` | 6 | yes |
| 18 | BTX-SOAK-19 | `d1ffc499-217a-4abb-80f4-ffe9c32f75bc` | `b23555d94c919f24…` | 6 | yes |
| 19 | BTX-SOAK-20 | `024edb8b-f397-4f63-abcb-15cf7cb89100` | `f15c9f209c58b9ef…` | 6 | yes |
| 20 | SLL-SOAK-21 | `32cde8a4-58e0-4274-a4c2-a2bbe4e19003` | `0232a88e9d694814…` | 6 | yes |
| 21 | BTX-SOAK-22 | `f8c8b191-0059-428b-a2b3-97b39c2c86be` | `01fa3bec0ec41462…` | 6 | yes |
| 22 | BTX-SOAK-23 | `9a786258-e411-4fe9-8cb0-886e7c6c8f07` | `daec47c78c84b4db…` | 6 | yes |
| 23 | BTX-SOAK-24 | `bfa8d306-a416-4b5e-8f96-1651fae2c112` | `f50519f174c46f14…` | 6 | yes |
| 24 | BTX-SOAK-25 | `7b57741d-2898-4b78-979b-6954603923ef` | `c3d3d19a0611d863…` | 6 | yes |
| 25 | SLL-SOAK-26 | `995cf235-ed8d-4b39-b6fc-0c33e95d5bbc` | `e1a8cac89447c5a4…` | 6 | yes |
| 26 | BTX-SOAK-27 | `9e9f87b5-bebd-4782-8442-851ca6253e85` | `eb2fabcf038d253d…` | 6 | yes |
| 27 | BTX-SOAK-28 | `16c78339-156a-4f90-ac4a-d8348a05578b` | `abaa65d8cfbbe7d3…` | 6 | yes |
| 28 | BTX-SOAK-29 | `c7444ff4-8e55-42bf-abf8-9785f5a9ed71` | `4d67917a7cfb93dc…` | 6 | yes |
| 29 | BTX-SOAK-30 | `92ad9012-369c-4d08-9a18-4aaf808b9cd4` | `3f6419b5452a92a9…` | 6 | yes |
| 30 | SLL-2026-11B1 | `786b9dfa-0299-4c4d-b209-9a530533c6dd` | `75eb5d22c1460314…` | 6 | yes |
| 31 | SLL-2026-11B2 | `36e4fc5c-8e8a-4596-85c4-1054c7c3ab5a` | `d3960244252e93e1…` | 6 | yes |
| 32 | SLL-2026-11B3 | `2d8ada88-4293-4a22-89eb-0f5f1fb930dc` | `9d55b003edcaf618…` | 1 | yes |

## What this does not show

- That a person approved: the signatures are the runs' labelled virtual test passkeys, not anyone's Face ID.
- That the payments settled: they were PAID by the sandbox's simulation endpoint (see the soak and bills records).
- The calldata pins the root, not the terms: a leaf proves a hash was in the batch at the block's time; the terms behind
  a hash are in the run records, which the hash is recomputed from.
