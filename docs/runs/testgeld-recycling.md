# Test money recycled from finished dry runs

Max's rules (1 November): only from finished dry-N worlds, never the reserve world or Thursday's; each transfer with its tx; old ledgers and proofs unchanged; keys stay where they are. Written by `src/metal/testFunds.ts`.

¹ dry-121 row: not written at the time: the log line itself crashed on a sub-cent amount (15.899999999998087030; it topped up to the
target from a balance with dust). Found afterwards on chain (USDZ Transfer, block 12121635) and added by hand. Fixed:
transfers are now whole cents, rounded up for the need and down for what a donor can spare (`test/test-funds.test.ts`).
dry-121 failed on this bug, not on the agents.

| UTC | From (world · wallet) | To (world · wallet, address) | *USDZ | Tx |
|---|---|---|---|---|
| 2026-11-01 15:44 | dry-1 · owner-customer | dry-118 · business owner `0xe9bf569F725f3756D73fb4a9c8e90DCCc5Dab6d3` | 21.00 | [0x8d431637…](https://testnet.metalntwx.com/tx/0x8d431637c89484dad2cd5c1ccac82646c10c2b9e3be0f8a62cd19a957a60943c) |
| 2026-11-01 15:44 | dry-1 · owner-customer | dry-118 · customer owner `0x4B7F20c37767eF5D45Bc4FaAAbbB4421c8bb9D8B` | 1.00 | [0x228d189d…](https://testnet.metalntwx.com/tx/0x228d189dfae209a38c3e6bc5c9cde448f2e8c89784ae8a2ce3d52dc2ccf7f9cd) |
| 2026-11-01 15:44 | dry-1 · owner-customer | dry-118 · customer account `0x1E03C87C490CD0fBE09dD260B114eb2c86a9322E` | 6.00 | [0x265bad7d…](https://testnet.metalntwx.com/tx/0x265bad7d444533da4b72a0da7d56e3e9c2b254de2aac3dce6d0598e67f4c4d4e) |
| 2026-11-01 15:59 | dry-1 · owner-customer | dry-119 · business owner `0x3214099948D5d824fd58f32832c85deEeb201294` | 21.00 | [0xbd8ef495…](https://testnet.metalntwx.com/tx/0xbd8ef49515cd78f353a42dd13512cdc5c5ee796f121c3749e4eb7607414f8cee) |
| 2026-11-01 15:59 | dry-1 · owner-customer | dry-119 · customer owner `0x5CB8E91e941089CC3d986AD4e7F73059cF1816dc` | 1.00 | [0x6fd4abb8…](https://testnet.metalntwx.com/tx/0x6fd4abb8e558578b9568428aa76e38a8bd02aa4b905fd9e9a6fa89e792e4aded) |
| 2026-11-01 15:59 | dry-1 · owner-customer | dry-119 · customer account `0x978162ef4E809F32F2B9bD1A8207Cf2eD4e31130` | 6.00 | [0xc7a54542…](https://testnet.metalntwx.com/tx/0xc7a545426cdf4f8b0fd9aba4295cd1f36bc38831124b27cdd45a276c9dbc9351) |
| 2026-11-01 16:10 | dry-1 · owner-customer | dry-120 · business owner `0x7bf9a69f392b1ACA7FD9CA3ee2683Ca4e322dBA0` | 21.00 | [0xf411a33a…](https://testnet.metalntwx.com/tx/0xf411a33ae7aa1370608619a9c627fb0ee538e1a27e50682deb98d5c72ac0cb2e) |
| 2026-11-01 16:10 | dry-1 · owner-customer | dry-120 · customer owner `0xcEe6e38046F42ab3dE6787E134e3f4e1F9C27dAb` | 1.00 | [0x30ae9ff7…](https://testnet.metalntwx.com/tx/0x30ae9ff7b86473d9521df301ab1b9dea2a680e8039e38912ba807af79a58140b) |
| 2026-11-01 16:10 | dry-1 · owner-customer | dry-120 · customer account `0xb64CCAbdeb9B9442a36A43a4dB28a94804D9F844` | 6.00 | [0x29dd94eb…](https://testnet.metalntwx.com/tx/0x29dd94ebe6ca7670558fe764da7d8ac0ef2e967cd353130f019400087619cda8) |
| 2026-11-01 16:24 | dry-1 · owner-customer | dry-121 · business owner `0x9ED2244F3458e926f05CBdAb386A81fFE923778f` | 15.89 ¹ | [0x26514786…](https://testnet.metalntwx.com/tx/0x265147864a6175c888f09b3f92b961cdd587c8d0f6c9c1f2c3d3914469911ba1) |

