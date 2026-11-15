# Verification report, 15 November 2026

**189 checks passed, 3 could not run here, 0 failed.**

Run live from 2026-11-15T06:28:20.005Z to 2026-11-15T06:28:39.480Z, on commit `5fdaec4`, by `npm run verify-all` (src/cli/verifyAll.ts). Re-run it: `npm ci && npm run verify-all`; the chain checks need `METAL_RPC_URL` (an Alta testnet RPC endpoint; only read). The full result, every transaction with its block: [verification-2026-11-15.json](verification-2026-11-15.json). Test money only.

Alta testnet: 129 distinct transactions linked from /proof, /alta, /runs and the README read from the chain; 129 found, 0 not found; 7 of them reverted, each one the pages label "reverted" (a refusal on chain); 16 compared with the block, sender, recipient or amount a committed record names.

## Timed /try runs (deployed, test money)

Today, by scripts/try-timed.ts (docs/evidence/try-timed-2026-11-15.json): start to paid, 10 runs: median 21015 ms, p90 22590 ms, worst 25714 ms (raw: 22590, 21157, 22273, 25714, 19872, 19700, 17900, 21403, 19451, 20873); one-cent refusal round trip, 10 runs: median 840.5 ms, p90 866 ms, worst 1815 ms (raw: 866, 814, 845, 864, 1815, 829, 835, 836, 866, 819).

Next to them, the 5 earlier runs of docs/evidence/live-measurement-2026-11-15.json (not changed; timed per step, so not pooled with today's): passkey to paid, 5 runs: median 7696 ms, p90 8176 ms, worst 8176 ms (raw: 8117, 8176, 7696, 7192, 7180); one-cent refusal, 5 runs: median 1669 ms, p90 1678 ms, worst 1678 ms (raw: 1678, 1672, 1669, 1668, 1659); start to finish, 5 runs: median 29411 ms, p90 31969 ms, worst 31969 ms (raw: 28351, 31217, 31969, 25763, 29411).

Median: the middle value (the mean of the two middle ones for an even count). p90: nearest rank. Worst: the largest. From the raw values only. Measured from a cloud sandbox in US-East, headless Chromium with a virtual passkey, at bot speed.

## The site (4 passed)

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | GET https://kit11.max-31b.workers.dev/proof | 200, 190370 bytes | the deployed site |
| pass | GET https://kit11.max-31b.workers.dev/ | 200, 68153 bytes | the deployed site |
| pass | GET https://kit11.max-31b.workers.dev/alta | 200, 102694 bytes | the deployed site |
| pass | GET https://kit11.max-31b.workers.dev/runs | 200, 188383 bytes | the deployed site |

## Verifiers (7 passed, 3 could not run here)

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | npm run verify-bundle -- docs/proof/try-paid.json | 10 check lines pass, 0 fail; VALID: docs/proof/try-paid.json | docs/proof/try-paid.json |
| pass | npm run verify-bundle -- docs/proof/try-refused.json | 11 check lines pass, 0 fail; VALID: docs/proof/try-refused.json | docs/proof/try-refused.json |
| pass | npm run verify-approval | 11 check lines ok, 0 fail; VALID | docs/runs/2026-11-07-awx-1/receipt-P-0002.json |
| pass | npm run verify-receipt -- docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json | 13 check lines ok, 0 fail; VALID | docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json |
| pass | npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl --anchor 194:ee07…3618 | ok chain 194 rows from docs/audit/friday-1-audit.jsonl, each hash recomputed and linked; head ee0732445a717f7386b4c6ccd94c0f5459b515e1d3e0869833c10d328fd83618; ok anchor row 194 still has hash ee0732445a71…: nothing up to it was changed or removed | docs/audit/friday-1-audit.jsonl |
| pass | npm run verify-anchor (Alta testnet, read-only) | 9 lines ok; MATCH: docs/runs/2026-11-13-anchor.json, tx 0xaa93f270a37c66e8be033949b8a6dc89278e47722ca0be5067a744a32b20e6c1 | docs/runs/2026-11-13-anchor.json |
| pass | npm run judge -- --check | 29 pages served with 200, 0 failed, offline from the main run's record | docs/demo/main-run.json |
| could not run here | npm run verify | needs the full ledger (KIT11_DB, a SQLite file), which is not committed; on an empty ledger it compares nothing, so running it here would prove nothing; its committed audit log is checked by verify-log above | docs/audit/README.md |
| could not run here | npm run reconcile | needs the full ledger (KIT11_DB, a SQLite file), which is not committed; on an empty ledger it compares nothing, so running it here would prove nothing; it also reads Airwallex with sandbox keys | src/cli/reconcile.ts |
| could not run here | npm run reconcile-books | needs the full ledger (KIT11_DB, a SQLite file), which is not committed; on an empty ledger it compares nothing, so running it here would prove nothing; it also needs the outside books' settings | src/cli/reconcileBooks.ts |

## Alta transactions (129 passed)

<details><summary>Every transaction, one line each</summary>

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | tx 0x02d5bf5b…e8fd on chain, succeeded | success, block 14144676 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x03811931…e23a on chain, reverted, as the page says | reverted, block 10097390 | linked from /runs |
| pass | tx 0x03c218ce…d2f0 on chain, succeeded | success, block 14154372 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x0536400e…5dd0 on chain, succeeded | success, block 14146094 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x053d2b7c…c861 on chain, succeeded | success, block 26125973 | linked from /alta |
| pass | tx 0x055ba899…6766 on chain, succeeded | success, block 8705132 | linked from /proof, /alta, /runs |
| pass | tx 0x080cf1b0…4e1c on chain, succeeded | success, block 14146910 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x09133534…2ed9 on chain, succeeded | success, block 14154120 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x108e9e74…4136 on chain, succeeded | success, block 14153883 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x168c6579…8c2d on chain, succeeded | success, block 26125740 | linked from /proof, /alta, /runs |
| pass | tx 0x182fbd26…6668 on chain, succeeded | success, block 14149546 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x1add0f46…dcce on chain, succeeded | success, block 26134048 | linked from /alta |
| pass | tx 0x1b82bda5…2e1e on chain, succeeded | success, block 14157100 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x1b8c645f…f744 on chain, succeeded | success, block 14154632 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x222385b5…2737 on chain, reverted, as the page says | reverted, block 10097250 | linked from /runs |
| pass | tx 0x285281ea…2724 on chain, succeeded | success, block 14153634 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x2a81d430…f08a on chain, succeeded | success, block 9388477 | linked from /runs |
| pass | tx 0x2a91ac97…e790 on chain, succeeded | success, block 14153004 | linked from /proof, /alta, README.md |
| pass | tx 0x2b3a3110…7159 on chain, succeeded | success, block 14146080 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x2cc5a16e…2fc7 on chain, succeeded | success, block 14144153 | linked from /proof, /alta, README.md, docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x2e92f9cb…1871 on chain, succeeded, as its record says | success, block 14150386; matches the record's block 14150386, sender, recipient; block 14150386; block 14150386 | linked from /proof, /alta, README.md; docs/runs/2026-11-12-metal-inspector.json |
| pass | tx 0x2f2d7afc…fb2a on chain, succeeded | success, block 23200516 | linked from /runs |
| pass | tx 0x31ecebc2…2d3e on chain, succeeded | success, block 14147725 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x32127371…434e on chain, succeeded | success, block 14144436 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x32c0e691…1486 on chain, succeeded | success, block 14148741 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x3878ee90…3bcf on chain, succeeded | success, block 14156854 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x39a4a2e5…07ac on chain, succeeded | success, block 14157615 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x39c5c7b0…ee33 on chain, succeeded | success, block 14148494 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x3bf9f70e…3ab5 on chain, reverted, as the page says | reverted, block 10099200 | linked from /runs |
| pass | tx 0x3e4db1a7…eadb on chain, succeeded | success, block 14156136 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x41a963a9…24de on chain, reverted, as the page says | reverted, block 11567553 | linked from /alta, /runs |
| pass | tx 0x41ef8b79…39fb on chain, succeeded | success, block 23200538 | linked from /runs |
| pass | tx 0x4fde2db7…2b04 on chain, succeeded | success, block 14153621 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x5099fe44…4510 on chain, succeeded, as its record says | success, block 14154286; matches the record's recipient and USDZ 0.05 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/demo/main-run.json |
| pass | tx 0x51f90725…3170 on chain, succeeded | success, block 14155135 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x522470d2…5092 on chain, succeeded | success, block 8767743 | linked from /runs |
| pass | tx 0x5637860a…f4aa on chain, succeeded | success, block 14150092 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x5669f975…be41 on chain, succeeded | success, block 14146640 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x5717cfbc…8633 on chain, succeeded | success, block 14149280 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x5c3c0161…e986 on chain, succeeded | success, block 14148220 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x5f09a1fb…f594 on chain, succeeded | success, block 14145516 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x6086aa0a…c831 on chain, succeeded | success, block 14149035 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x64d22177…4c7d on chain, succeeded | success, block 14144133 | linked from /proof, /alta, docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x65fac962…3518 on chain, succeeded | success, block 14148480 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x67fb4590…1836 on chain, succeeded | success, block 14147715 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x68ab794b…67be on chain, succeeded | success, block 14147990 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x6972c97d…6bd0 on chain, succeeded | success, block 14157850 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x6b6ac4ab…a61e on chain, succeeded | success, block 14157360 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x6e751649…874c on chain, succeeded | success, block 14148234 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x6eba6d48…8caa on chain, succeeded | success, block 14154906 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x6f7d1da8…f13c on chain, succeeded | success, block 14147456 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x728a9c27…c43b on chain, reverted, as the page says | reverted, block 10099142 | linked from /runs |
| pass | tx 0x7860403e…ebe2 on chain, succeeded | success, block 14149800 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x786686b6…fc3c on chain, succeeded | success, block 9466819 | linked from /runs |
| pass | tx 0x789abb24…ebbc on chain, succeeded, as its record says | success, block 14152940; matches the record's block 14152940, sender, recipient; block 14152940; block 14152940; block 14152940; block 14152940; block 14152940 | linked from /proof, /alta; docs/runs/2026-11-12-metal-inspector.json |
| pass | tx 0x78e58558…ac3c on chain, succeeded | success, block 14146654 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x7e6d0104…1098 on chain, succeeded | success, block 14154642 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x809e7a30…3a9f on chain, succeeded | success, block 13906293 | linked from /alta |
| pass | tx 0x81897ab4…b4fe on chain, succeeded | success, block 14147972 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x86936a5b…ccb4 on chain, succeeded, as its record says | success, block 14153316; matches the record's recipient and USDZ 0.69; block 14153316 | linked from /proof, /alta, /runs, README.md, docs/runs/2026-11-03-main-run-metal-transactions.md; docs/demo/main-run.json |
| pass | tx 0x870e0c20…bc8f on chain, succeeded | success, block 14150080 | linked from /alta, docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x871c658e…4da5 on chain, succeeded | success, block 14156866 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x88d59e38…1d09 on chain, succeeded | success, block 14155407 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x8f3e8de3…9b6e on chain, succeeded | success, block 14155900 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x902badf6…c3d4 on chain, succeeded | success, block 8748888 | linked from /runs |
| pass | tx 0x9076343b…20d3 on chain, succeeded | success, block 9352421 | linked from /alta, /runs |
| pass | tx 0x91ed35a5…442e on chain, reverted, as the page says | reverted, block 10098356 | linked from /runs |
| pass | tx 0x91f25465…7ead on chain, succeeded | success, block 14157838 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x9312b362…fede on chain, succeeded | success, block 14156376 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x93b8a8b3…bcea on chain, succeeded | success, block 14156148 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x96850ad4…7d5b on chain, succeeded | success, block 11567572 | linked from /alta, /runs |
| pass | tx 0x99c7d22d…ae0d on chain, succeeded | success, block 14155648 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0x9c7d37f2…a2f7 on chain, succeeded | success, block 13906369 | linked from /alta |
| pass | tx 0x9cb93362…1808 on chain, succeeded, as its record says | success, block 13906203; matches the record's block 13906203, sender, recipient; block 13906203; block 13906203; block 13906203 | linked from /alta; docs/runs/2026-11-12-metal-inspector.json |
| pass | tx 0x9de16c5c…8fd3 on chain, succeeded | success, block 14155664 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xa2e3a329…8ed4 on chain, succeeded | success, block 14154384 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xa6b615ce…c309 on chain, succeeded | success, block 14147444 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xa86b5f04…ee11 on chain, succeeded | success, block 14155915 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xaa93f270…e6c1 on chain, succeeded, as its record says | success, block 27469355; matches the record's block 27469355, sender; block 27469355, sender | linked from /proof, /alta, /runs; docs/runs/2026-11-13-anchor.json, docs/runs/2026-11-15-anchor-verified.json |
| pass | tx 0xac6f03f2…0efd on chain, succeeded | success, block 14153872 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xad900a08…cfa3 on chain, succeeded | success, block 14149526 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xadb282a0…c79d on chain, succeeded | success, block 14146370 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xb28b5831…07ac on chain, succeeded | success, block 14145810 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xb2fbcfc4…668d on chain, succeeded | success, block 14144425 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xb371a336…7859 on chain, succeeded | success, block 26157527 | linked from /proof, /alta, /runs |
| pass | tx 0xb4f04a35…cf0b on chain, succeeded | success, block 14157114 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xb64d78ea…82bc on chain, succeeded | success, block 14155146 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xb6eff587…315d on chain, succeeded | success, block 26133904 | linked from /alta, /runs |
| pass | tx 0xb7ef08bb…44ad on chain, succeeded | success, block 13906111 | linked from /proof, /alta, README.md |
| pass | tx 0xb8fe41c8…9ffa on chain, succeeded | success, block 14147158 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xba330558…4c38 on chain, succeeded | success, block 14145234 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xbdb5b8f2…b0a8 on chain, succeeded | success, block 14148754 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xc27764be…6fad on chain, succeeded, as its record says | success, block 26148767; matches the record's block 26148767, sender | linked from /alta, /runs; docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xc2eb6814…f237 on chain, succeeded | success, block 10096702 | linked from /proof, /alta, /runs |
| pass | tx 0xc3ac51e4…56cf on chain, succeeded, as its record says | success, block 26148487; matches the record's block 26148487, sender | linked from /alta; docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xc3e7487e…c237 on chain, succeeded | success, block 14144950 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xc6e1f0b2…0723 on chain, succeeded | success, block 14144690 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xc704078e…6ded on chain, succeeded | success, block 14146358 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xc7f59df3…3b59 on chain, succeeded | success, block 14155394 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xc82912c3…b8cd on chain, succeeded | success, block 11567638 | linked from /runs |
| pass | tx 0xcf02673e…ab4e on chain, succeeded, as its record says | success, block 26148693; matches the record's block 26148693, sender | linked from /alta; docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xcfb214b1…875d on chain, succeeded | success, block 14145536 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xd00cf2e4…de7a on chain, succeeded | success, block 14147178 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xd3bf7e0d…9f3e on chain, succeeded | success, block 26135039 | linked from /alta, /runs |
| pass | tx 0xd4c40c27…9b91 on chain, succeeded, as its record says | success, block 26148264; matches the record's block 26148264, sender | linked from /alta; docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xd5a11eca…a2d8 on chain, succeeded | success, block 14157347 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xd5f54825…9134 on chain, succeeded | success, block 14156390 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xd95bf33c…900c on chain, succeeded | success, block 14145796 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xd98e94ff…d30d on chain, succeeded | success, block 10099167 | linked from /alta, /runs |
| pass | tx 0xe0976c5a…69c3 on chain, reverted, as the page says | reverted, block 10099120 | linked from /proof, /runs |
| pass | tx 0xe44a3460…75e5 on chain, succeeded, as its record says | success, block 14154236; matches the record's recipient and USDZ 0.05 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/demo/main-run.json |
| pass | tx 0xe4bf7962…c89d on chain, succeeded, as its record says | success, block 14154191; matches the record's recipient and USDZ 0.05 | linked from /proof, /alta, README.md, docs/runs/2026-11-03-main-run-metal-transactions.md; docs/demo/main-run.json |
| pass | tx 0xe6d9c7ea…5df4 on chain, succeeded | success, block 26126103 | linked from /alta, /runs |
| pass | tx 0xe892abfd…a884 on chain, succeeded | success, block 14146897 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xebd682c7…8ae0 on chain, succeeded, as its record says | success, block 26148537; matches the record's block 26148537, sender | linked from /alta; docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xee14c617…eb44 on chain, succeeded | success, block 14144963 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xef3c845b…32be on chain, succeeded, as its record says | success, block 26148587; matches the record's block 26148587, sender | linked from /alta, /runs; docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xefc68319…b575 on chain, succeeded, as its record says | success, block 26148371; matches the record's block 26148371, sender | linked from /proof, /alta, /runs; docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xf1a7fe96…0c37 on chain, succeeded | success, block 9351961 | linked from /proof, /runs |
| pass | tx 0xf23d83dc…7b0b on chain, succeeded | success, block 14149814 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xf4530112…a1a6 on chain, succeeded | success, block 14157600 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xf4bdd52d…cf23 on chain, succeeded | success, block 14154136 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xf97bcade…f98d on chain, succeeded, as its record says | success, block 10099272; matches the record's block 10099272, sender, recipient; block 10099272; block 10099272 | linked from /alta; docs/runs/2026-11-12-metal-inspector.json |
| pass | tx 0xf9be147f…e93f on chain, succeeded | success, block 14156629 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xfab9cc3d…c4c6 on chain, succeeded | success, block 14156616 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xfacf2126…36a8 on chain, succeeded | success, block 14149266 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xfd1db54e…b1d5 on chain, succeeded | success, block 14149023 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xfdfa0cfc…4fb4 on chain, succeeded | success, block 14154885 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |
| pass | tx 0xff8debd3…9516 on chain, succeeded | success, block 14145246 | linked from docs/runs/2026-11-03-main-run-metal-transactions.md |

</details>

## Figures on the pages (29 passed)

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | /proof: tests passing | page 6932, record 6932 | docs/assets/test-summary.json (passed) |
| pass | the last full test run had no failure | failed 0 | docs/assets/test-summary.json |
| pass | /proof: sandbox and testnet runs | page 25, record 25 | /runs' rows (src/redesign/runs.ts liveRunCount) |
| pass | /proof: Airwallex sandbox API calls logged | page 150, record 150 | the call logs in docs/runs and docs/demo (src/redesign/scale.ts airwallexCallsIn) |
| pass | /proof: Alta testnet transactions | page 233, record 233 | distinct explorer links in docs/runs and docs/demo, counted here |
| pass | /proof: Claude calls with request ids | page 451, record 451 | distinct req_011… ids in docs/**/*.json(l), counted here |
| pass | /proof: refusals on record | page 68, record 68 | audit rows of a refusal, decline, rejection or fraud stop in docs/runs and docs/demo, counted here |
| pass | /proof: the partner tiles add up to the note's count | page 23, record 23 | the tiles: Airwallex 7, Visa via Airi 4, Alta (formerly Metal) 9, T:0 2, Moneybird 1 |
| pass | /proof: runs listed = tiles + the main run | page 24, record 24 | /proof |
| pass | /proof: live runs = listed + on /visa | page 25, record 25 | /proof |
| pass | /proof: the note's live runs = the band's | page 25, record 25 | /proof |
| pass | /proof: decisions by Claude (main run) | page 24, record 24 | docs/demo/main-run.json agent_stats (by_claude) |
| pass | /proof: fallbacks (main run) | page 0, record 0 | docs/demo/main-run.json agent_stats (fallback) |
| pass | /proof: calls to Claude, each logged | page 50, record 50 | docs/demo/main-run.json agent_stats (claude_calls) |
| pass | main run: every Claude call has a request id | 0 calls without one | docs/demo/main-run.json agent_stats |
| pass | /proof: sourcing agent's decisions, fallbacks, calls, cost | page 11/11 0 26 0.0088, record 11/11 0 26 0.0088 | docs/demo/main-run.json agent_stats (sourcing) |
| pass | /proof: support agent's decisions, fallbacks, calls, cost | page 4/4 0 7 0.0500, record 4/4 0 7 0.0500 | docs/demo/main-run.json agent_stats (support) |
| pass | /proof: treasury agent's decisions, fallbacks, calls, cost | page 9/9 0 17 0.2582, record 9/9 0 17 0.2582 | docs/demo/main-run.json agent_stats (treasury) |
| pass | /proof: Alta payments (main run) | page 86, record 86 | docs/demo/main-run-trace.json payments (rail metal) |
| pass | /proof: card charges (main run) | page 1, record 1 | docs/demo/main-run-trace.json payments (rail airwallex_card) |
| pass | /proof: sales + purchases + refunds + sweep | page 41 41 3 1, record 41 41 3 1 | docs/demo/main-run-trace.json payments by kind |
| pass | /proof: stops (main run): total, buy rule, Alta, CFO, planted | page 16 12 2 1 1, record 16 12 2 1 1 | docs/demo/main-run.json snapshot.refusals and proof.chain_refusals |
| pass | /proof: decisions signed with Face ID | page 5, record 5 | docs/demo/main-run.json snapshot.decisions (by … Face ID) |
| pass | /proof: Face ID count = the record's proof.face_id | page 5, record 5 | docs/demo/main-run.json |
| pass | /proof: orders disputed | page 12, record 12 | docs/demo/main-run.json ledger.disputes[0].claims.sale_refs |
| pass | /proof: disputed orders refunded (wrong data) | page 3, record 3 | docs/demo/main-run-trace.json refunds on Alta |
| pass | /proof: disputed orders proven valid | page 9, record 9 | disputed minus refunded |
| pass | /proof: audit rows (main run) | page 412, record 412 | docs/demo/main-run.json snapshot.audit.rows |
| pass | main run: the audit chain is recorded intact | intact true | docs/demo/main-run.json |

## Timed /try runs (20 passed)

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | /try run 1: paid, and its proof bundle verifies | start to paid 22590 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 1: one cent more refused, and its proof bundle verifies | refusal round trip 866 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 2: paid, and its proof bundle verifies | start to paid 21157 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 2: one cent more refused, and its proof bundle verifies | refusal round trip 814 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 3: paid, and its proof bundle verifies | start to paid 22273 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 3: one cent more refused, and its proof bundle verifies | refusal round trip 845 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 4: paid, and its proof bundle verifies | start to paid 25714 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 4: one cent more refused, and its proof bundle verifies | refusal round trip 864 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 5: paid, and its proof bundle verifies | start to paid 19872 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 5: one cent more refused, and its proof bundle verifies | refusal round trip 1815 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 6: paid, and its proof bundle verifies | start to paid 19700 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 6: one cent more refused, and its proof bundle verifies | refusal round trip 829 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 7: paid, and its proof bundle verifies | start to paid 17900 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 7: one cent more refused, and its proof bundle verifies | refusal round trip 835 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 8: paid, and its proof bundle verifies | start to paid 21403 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 8: one cent more refused, and its proof bundle verifies | refusal round trip 836 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 9: paid, and its proof bundle verifies | start to paid 19451 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 9: one cent more refused, and its proof bundle verifies | refusal round trip 866 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 10: paid, and its proof bundle verifies | start to paid 20873 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |
| pass | /try run 10: one cent more refused, and its proof bundle verifies | refusal round trip 819 ms; bundle VALID | docs/evidence/try-timed-2026-11-15.json |

