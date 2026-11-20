# Verification report, 20 November 2026

**260 checks passed, 3 could not run here, 3 failed.**

Run live from 2026-11-20T17:30:02.695Z to 2026-11-20T17:30:23.688Z, on commit `f29459399`, by `npm run verify-all` (src/cli/verifyAll.ts). Re-run it: `npm ci && npm run verify-all`; the chain checks need `METAL_RPC_URL` (an Alta testnet RPC endpoint; only read). The full result, every transaction with its block: [verification-2026-11-20.json](verification-2026-11-20.json). Test money only.

Alta testnet: 137 distinct transactions linked from /proof, /alta, /runs and the README read from the chain; 137 found, 0 not found; 7 of them reverted, each one the pages label "reverted" (a refusal on chain); 137 compared with the block, sender, recipient or amount a committed record names.

## Timed /try runs (deployed, test money)

Timed on 2026-11-15 (read, not re-timed in this run), by scripts/try-timed.ts (docs/evidence/try-timed-2026-11-15.json): start to paid, 10 runs: median 21015 ms, p90 22590 ms, worst 25714 ms (raw: 22590, 21157, 22273, 25714, 19872, 19700, 17900, 21403, 19451, 20873); one-cent refusal round trip, 10 runs: median 840.5 ms, p90 866 ms, worst 1815 ms (raw: 866, 814, 845, 864, 1815, 829, 835, 836, 866, 819).

Next to them, the 5 earlier runs of docs/evidence/live-measurement-2026-11-15.json (not changed; timed per step, so not pooled with those): passkey to paid, 5 runs: median 7696 ms, p90 8176 ms, worst 8176 ms (raw: 8117, 8176, 7696, 7192, 7180); one-cent refusal, 5 runs: median 1669 ms, p90 1678 ms, worst 1678 ms (raw: 1678, 1672, 1669, 1668, 1659); start to finish, 5 runs: median 29411 ms, p90 31969 ms, worst 31969 ms (raw: 28351, 31217, 31969, 25763, 29411).

Median: the middle value (the mean of the two middle ones for an even count). p90: nearest rank. Worst: the largest. From the raw values only. Measured from a cloud sandbox in US-East, headless Chromium with a virtual passkey, at bot speed.

## The site (6 passed)

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | GET https://kit11.max-31b.workers.dev/proof | 200, 287035 bytes | the deployed site |
| pass | GET https://kit11.max-31b.workers.dev/ | 200, 72758 bytes | the deployed site |
| pass | GET https://kit11.max-31b.workers.dev/alta | 200, 113560 bytes | the deployed site |
| pass | GET https://kit11.max-31b.workers.dev/runs | 200, 244703 bytes | the deployed site |
| pass | GET https://kit11.max-31b.workers.dev/airwallex | 200, 132087 bytes | the deployed site |
| pass | GET https://kit11.max-31b.workers.dev/visa | 200, 121635 bytes | the deployed site |

## Verifiers (7 passed, 3 could not run here)

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | npm run verify-bundle -- docs/proof/try-paid.json | 11 check lines pass, 0 fail; VALID: docs/proof/try-paid.json | docs/proof/try-paid.json |
| pass | npm run verify-bundle -- docs/proof/try-refused.json | 11 check lines pass, 0 fail; VALID: docs/proof/try-refused.json | docs/proof/try-refused.json |
| pass | npm run verify-approval | 11 check lines ok, 0 fail; VALID | docs/runs/2026-11-07-awx-1/receipt-P-0002.json |
| pass | npm run verify-receipt -- docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json | 13 check lines ok, 0 fail; VALID | docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json |
| pass | npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl --anchor 194:ee07…3618 | ok chain 194 rows from docs/audit/friday-1-audit.jsonl, each hash recomputed and linked; head ee0732445a717f7386b4c6ccd94c0f5459b515e1d3e0869833c10d328fd83618; ok anchor row 194 still has hash ee0732445a71…: nothing up to it was changed or removed | docs/audit/friday-1-audit.jsonl |
| pass | npm run verify-anchor (Alta testnet, read-only) | 9 lines ok; MATCH: docs/runs/2026-11-13-anchor.json, tx 0xaa93f270a37c66e8be033949b8a6dc89278e47722ca0be5067a744a32b20e6c1 | docs/runs/2026-11-13-anchor.json |
| pass | npm run judge -- --check | 32 pages served with 200, 0 failed, offline from the main run's record | docs/demo/main-run.json |
| could not run here | npm run verify | needs the full ledger (KIT11_DB, a SQLite file), which is not committed; on an empty ledger it compares nothing, so running it here would prove nothing; its committed audit log is checked by verify-log above | docs/audit/README.md |
| could not run here | npm run reconcile | needs the full ledger (KIT11_DB, a SQLite file), which is not committed; on an empty ledger it compares nothing, so running it here would prove nothing; it also reads Airwallex with sandbox keys | src/cli/reconcile.ts |
| could not run here | npm run reconcile-books | needs the full ledger (KIT11_DB, a SQLite file), which is not committed; on an empty ledger it compares nothing, so running it here would prove nothing; it also needs the outside books' settings | src/cli/reconcileBooks.ts |

## Alta transactions (137 passed)

<details><summary>Every transaction, one line each</summary>

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | tx 0x02d5bf5b…e8fd on chain, succeeded, as its record says | success, block 14144676; matches the record's block 14144676, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x03811931…e23a on chain, reverted, as the page says, as its record says | reverted, block 10097390; matches the record's block 10097390, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x03c218ce…d2f0 on chain, succeeded, as its record says | success, block 14154372; matches the record's block 14154372, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x04e43556…16b2 on chain, succeeded, as its record says | success, block 35368654; matches the record's block 35368654, refusal (no USDZ to the payee) | linked from /alta, /runs; docs/runs/2026-11-19-alta-series.json |
| pass | tx 0x0536400e…5dd0 on chain, succeeded, as its record says | success, block 14146094; matches the record's block 14146094, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x053d2b7c…c861 on chain, succeeded, as its record says | success, block 26125973; matches the record's block 26125973, sender, recipient | linked from /alta; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x055ba899…6766 on chain, succeeded, as its record says | success, block 8705132; matches the record's block 8705132, sender, recipient | linked from /proof, /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x080cf1b0…4e1c on chain, succeeded, as its record says | success, block 14146910; matches the record's block 14146910, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x09133534…2ed9 on chain, succeeded, as its record says | success, block 14154120; matches the record's block 14154120, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x108e9e74…4136 on chain, succeeded, as its record says | success, block 14153883; matches the record's block 14153883, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x168c6579…8c2d on chain, succeeded, as its record says | success, block 26125740; matches the record's block 26125740, sender, recipient | linked from /proof, /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x182fbd26…6668 on chain, succeeded, as its record says | success, block 14149546; matches the record's block 14149546, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x1add0f46…dcce on chain, succeeded, as its record says | success, block 26134048; matches the record's block 26134048, sender, recipient | linked from /alta; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x1b82bda5…2e1e on chain, succeeded, as its record says | success, block 14157100; matches the record's block 14157100, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x1b8c645f…f744 on chain, succeeded, as its record says | success, block 14154632; matches the record's block 14154632, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x222385b5…2737 on chain, reverted, as the page says, as its record says | reverted, block 10097250; matches the record's block 10097250, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x285281ea…2724 on chain, succeeded, as its record says | success, block 14153634; matches the record's block 14153634, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x2a81d430…f08a on chain, succeeded, as its record says | success, block 9388477; matches the record's block 9388477, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x2a91ac97…e790 on chain, succeeded, as its record says | success, block 14153004; matches the record's block 14153004, sender, recipient | linked from /proof, /alta; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x2b3a3110…7159 on chain, succeeded, as its record says | success, block 14146080; matches the record's block 14146080, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x2bc04ccd…38c2 on chain, succeeded, as its record says | success, block 35371564; matches the record's block 35371564, sender | linked from /proof, /alta, /runs; docs/runs/2026-11-19-anchor.json |
| pass | tx 0x2cc5a16e…2fc7 on chain, succeeded, as its record says | success, block 14144153; matches the record's block 14144153, sender, recipient | linked from /proof, /alta, docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x2e92f9cb…1871 on chain, succeeded, as its record says | success, block 14150386; matches the record's block 14150386, sender, recipient; block 14150386, sender, recipient; block 14150386; block 14150386 | linked from /proof, /alta, README.md; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-metal-inspector.json |
| pass | tx 0x2e981a5a…6677 on chain, succeeded, as its record says | success, block 36733984; matches the record's block 36733984, refusal (no USDZ to the payee) | linked from /runs; docs/runs/2026-11-20-alta-refusals.json |
| pass | tx 0x2f2d7afc…fb2a on chain, succeeded, as its record says | success, block 23200516; matches the record's block 23200516, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x31ecebc2…2d3e on chain, succeeded, as its record says | success, block 14147725; matches the record's block 14147725, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x32127371…434e on chain, succeeded, as its record says | success, block 14144436; matches the record's block 14144436, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x32c0e691…1486 on chain, succeeded, as its record says | success, block 14148741; matches the record's block 14148741, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x3878ee90…3bcf on chain, succeeded, as its record says | success, block 14156854; matches the record's block 14156854, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x39a4a2e5…07ac on chain, succeeded, as its record says | success, block 14157615; matches the record's block 14157615, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x39c5c7b0…ee33 on chain, succeeded, as its record says | success, block 14148494; matches the record's block 14148494, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x3bf9f70e…3ab5 on chain, reverted, as the page says, as its record says | reverted, block 10099200; matches the record's block 10099200, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x3e4db1a7…eadb on chain, succeeded, as its record says | success, block 14156136; matches the record's block 14156136, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x41a963a9…24de on chain, reverted, as the page says, as its record says | reverted, block 11567553; matches the record's block 11567553, sender, recipient | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x41ef8b79…39fb on chain, succeeded, as its record says | success, block 23200538; matches the record's block 23200538, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x48a5c5a7…1b93 on chain, succeeded, as its record says | success, block 36734258; matches the record's block 36734258, refusal (no USDZ to the payee) | linked from /runs; docs/runs/2026-11-20-alta-refusals.json |
| pass | tx 0x4fde2db7…2b04 on chain, succeeded, as its record says | success, block 14153621; matches the record's block 14153621, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x5099fe44…4510 on chain, succeeded, as its record says | success, block 14154286; matches the record's recipient and USDZ 0.05; block 14154286, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/demo/main-run.json, docs/evidence/verification-2026-11-15.json |
| pass | tx 0x51f90725…3170 on chain, succeeded, as its record says | success, block 14155135; matches the record's block 14155135, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x522470d2…5092 on chain, succeeded, as its record says | success, block 8767743; matches the record's block 8767743, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x5637860a…f4aa on chain, succeeded, as its record says | success, block 14150092; matches the record's block 14150092, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x5669f975…be41 on chain, succeeded, as its record says | success, block 14146640; matches the record's block 14146640, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x5717cfbc…8633 on chain, succeeded, as its record says | success, block 14149280; matches the record's block 14149280, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x5c3c0161…e986 on chain, succeeded, as its record says | success, block 14148220; matches the record's block 14148220, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x5f09a1fb…f594 on chain, succeeded, as its record says | success, block 14145516; matches the record's block 14145516, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x6086aa0a…c831 on chain, succeeded, as its record says | success, block 14149035; matches the record's block 14149035, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x64d22177…4c7d on chain, succeeded, as its record says | success, block 14144133; matches the record's block 14144133, sender, recipient | linked from /proof, /alta, docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x65fac962…3518 on chain, succeeded, as its record says | success, block 14148480; matches the record's block 14148480, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x67fb4590…1836 on chain, succeeded, as its record says | success, block 14147715; matches the record's block 14147715, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x68ab794b…67be on chain, succeeded, as its record says | success, block 14147990; matches the record's block 14147990, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x6972c97d…6bd0 on chain, succeeded, as its record says | success, block 14157850; matches the record's block 14157850, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x6b6ac4ab…a61e on chain, succeeded, as its record says | success, block 14157360; matches the record's block 14157360, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x6e751649…874c on chain, succeeded, as its record says | success, block 14148234; matches the record's block 14148234, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x6eba6d48…8caa on chain, succeeded, as its record says | success, block 14154906; matches the record's block 14154906, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x6f7d1da8…f13c on chain, succeeded, as its record says | success, block 14147456; matches the record's block 14147456, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x728a9c27…c43b on chain, reverted, as the page says, as its record says | reverted, block 10099142; matches the record's block 10099142, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x7860403e…ebe2 on chain, succeeded, as its record says | success, block 14149800; matches the record's block 14149800, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x786686b6…fc3c on chain, succeeded, as its record says | success, block 9466819; matches the record's block 9466819, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x789abb24…ebbc on chain, succeeded, as its record says | success, block 14152940; matches the record's block 14152940, sender, recipient; block 14152940, sender, recipient; block 14152940; block 14152940; block 14152940; block 14152940; block 14152940 | linked from /proof, /alta; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-metal-inspector.json |
| pass | tx 0x78e58558…ac3c on chain, succeeded, as its record says | success, block 14146654; matches the record's block 14146654, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x7e6d0104…1098 on chain, succeeded, as its record says | success, block 14154642; matches the record's block 14154642, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x809e7a30…3a9f on chain, succeeded, as its record says | success, block 13906293; matches the record's block 13906293, sender, recipient | linked from /alta; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x81897ab4…b4fe on chain, succeeded, as its record says | success, block 14147972; matches the record's block 14147972, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x86936a5b…ccb4 on chain, succeeded, as its record says | success, block 14153316; matches the record's recipient and USDZ 0.69; block 14153316; block 14153316, sender, recipient | linked from /proof, /alta, /runs, docs/runs/2026-11-03-main-run-metal-transactions.md; docs/demo/main-run.json, docs/evidence/verification-2026-11-15.json |
| pass | tx 0x870e0c20…bc8f on chain, succeeded, as its record says | success, block 14150080; matches the record's block 14150080, sender, recipient | linked from /alta, docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x871c658e…4da5 on chain, succeeded, as its record says | success, block 14156866; matches the record's block 14156866, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x88d59e38…1d09 on chain, succeeded, as its record says | success, block 14155407; matches the record's block 14155407, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x898ebd4a…bf6b on chain, succeeded, as its record says | success, block 35367874; matches the record's block 35367874, refusal (no USDZ to the payee) | linked from /proof, /alta, /runs; docs/runs/2026-11-19-alta-series.json |
| pass | tx 0x8f3e8de3…9b6e on chain, succeeded, as its record says | success, block 14155900; matches the record's block 14155900, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x902badf6…c3d4 on chain, succeeded, as its record says | success, block 8748888; matches the record's block 8748888, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x9076343b…20d3 on chain, succeeded, as its record says | success, block 9352421; matches the record's block 9352421, sender, recipient | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x91ed35a5…442e on chain, reverted, as the page says, as its record says | reverted, block 10098356; matches the record's block 10098356, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x91f25465…7ead on chain, succeeded, as its record says | success, block 14157838; matches the record's block 14157838, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x9312b362…fede on chain, succeeded, as its record says | success, block 14156376; matches the record's block 14156376, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x93b8a8b3…bcea on chain, succeeded, as its record says | success, block 14156148; matches the record's block 14156148, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x96850ad4…7d5b on chain, succeeded, as its record says | success, block 11567572; matches the record's block 11567572, sender, recipient | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x99c7d22d…ae0d on chain, succeeded, as its record says | success, block 14155648; matches the record's block 14155648, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x9c7d37f2…a2f7 on chain, succeeded, as its record says | success, block 13906369; matches the record's block 13906369, sender, recipient | linked from /alta; docs/evidence/verification-2026-11-15.json |
| pass | tx 0x9cb93362…1808 on chain, succeeded, as its record says | success, block 13906203; matches the record's block 13906203, sender, recipient; block 13906203, sender, recipient; block 13906203; block 13906203; block 13906203 | linked from /alta; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-metal-inspector.json |
| pass | tx 0x9de16c5c…8fd3 on chain, succeeded, as its record says | success, block 14155664; matches the record's block 14155664, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xa2e3a329…8ed4 on chain, succeeded, as its record says | success, block 14154384; matches the record's block 14154384, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xa4849dbd…b670 on chain, succeeded, as its record says | success, block 36737620; matches the record's block 36737620, refusal (no USDZ to the payee) | linked from /runs; docs/runs/2026-11-20-alta-refusals.json |
| pass | tx 0xa6b615ce…c309 on chain, succeeded, as its record says | success, block 14147444; matches the record's block 14147444, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xa86b5f04…ee11 on chain, succeeded, as its record says | success, block 14155915; matches the record's block 14155915, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xaa93f270…e6c1 on chain, succeeded, as its record says | success, block 27469355; matches the record's block 27469355, sender, recipient; block 27469355, sender; block 27469355, sender | linked from /proof, /runs; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-13-anchor.json, docs/runs/2026-11-15-anchor-verified.json |
| pass | tx 0xac6f03f2…0efd on chain, succeeded, as its record says | success, block 14153872; matches the record's block 14153872, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xad900a08…cfa3 on chain, succeeded, as its record says | success, block 14149526; matches the record's block 14149526, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xadb282a0…c79d on chain, succeeded, as its record says | success, block 14146370; matches the record's block 14146370, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xb28b5831…07ac on chain, succeeded, as its record says | success, block 14145810; matches the record's block 14145810, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xb2fbcfc4…668d on chain, succeeded, as its record says | success, block 14144425; matches the record's block 14144425, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xb371a336…7859 on chain, succeeded, as its record says | success, block 26157527; matches the record's block 26157527, sender, recipient | linked from /proof, /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xb4f04a35…cf0b on chain, succeeded, as its record says | success, block 14157114; matches the record's block 14157114, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xb64d78ea…82bc on chain, succeeded, as its record says | success, block 14155146; matches the record's block 14155146, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xb6eff587…315d on chain, succeeded, as its record says | success, block 26133904; matches the record's block 26133904, sender, recipient | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xb7ef08bb…44ad on chain, succeeded, as its record says | success, block 13906111; matches the record's block 13906111, sender, recipient | linked from /proof, /alta; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xb8fe41c8…9ffa on chain, succeeded, as its record says | success, block 14147158; matches the record's block 14147158, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xba330558…4c38 on chain, succeeded, as its record says | success, block 14145234; matches the record's block 14145234, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xbdb5b8f2…b0a8 on chain, succeeded, as its record says | success, block 14148754; matches the record's block 14148754, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xc27764be…6fad on chain, succeeded, as its record says | success, block 26148767; matches the record's block 26148767, sender, recipient; block 26148767, sender | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xc2eb6814…f237 on chain, succeeded, as its record says | success, block 10096702; matches the record's block 10096702, sender, recipient | linked from /proof, /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xc3ac51e4…56cf on chain, succeeded, as its record says | success, block 26148487; matches the record's block 26148487, sender, recipient; block 26148487, sender | linked from /alta; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xc3e7487e…c237 on chain, succeeded, as its record says | success, block 14144950; matches the record's block 14144950, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xc6e1f0b2…0723 on chain, succeeded, as its record says | success, block 14144690; matches the record's block 14144690, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xc704078e…6ded on chain, succeeded, as its record says | success, block 14146358; matches the record's block 14146358, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xc7f59df3…3b59 on chain, succeeded, as its record says | success, block 14155394; matches the record's block 14155394, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xc82912c3…b8cd on chain, succeeded, as its record says | success, block 11567638; matches the record's block 11567638, sender, recipient | linked from /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xcf02673e…ab4e on chain, succeeded, as its record says | success, block 26148693; matches the record's block 26148693, sender, recipient; block 26148693, sender | linked from /alta; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xcfb214b1…875d on chain, succeeded, as its record says | success, block 14145536; matches the record's block 14145536, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xd00cf2e4…de7a on chain, succeeded, as its record says | success, block 14147178; matches the record's block 14147178, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xd3bf7e0d…9f3e on chain, succeeded, as its record says | success, block 26135039; matches the record's block 26135039, sender, recipient | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xd4c40c27…9b91 on chain, succeeded, as its record says | success, block 26148264; matches the record's block 26148264, sender; block 26148264, sender | linked from /alta; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xd5a11eca…a2d8 on chain, succeeded, as its record says | success, block 14157347; matches the record's block 14157347, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xd5f54825…9134 on chain, succeeded, as its record says | success, block 14156390; matches the record's block 14156390, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xd6d4ba5b…32de on chain, succeeded, as its record says | success, block 35370525; matches the record's block 35370525, refusal (no USDZ to the payee) | linked from /alta, /runs; docs/runs/2026-11-19-alta-series-finish.json |
| pass | tx 0xd95bf33c…900c on chain, succeeded, as its record says | success, block 14145796; matches the record's block 14145796, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xd98e94ff…d30d on chain, succeeded, as its record says | success, block 10099167; matches the record's block 10099167, sender, recipient | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xe091e2b6…e471 on chain, succeeded, as its record says | success, block 36733781; matches the record's block 36733781, refusal (no USDZ to the payee) | linked from /proof, /runs; docs/runs/2026-11-20-alta-refusals.json |
| pass | tx 0xe0976c5a…69c3 on chain, reverted, as the page says, as its record says | reverted, block 10099120; matches the record's block 10099120, sender, recipient | linked from /proof, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xe44a3460…75e5 on chain, succeeded, as its record says | success, block 14154236; matches the record's recipient and USDZ 0.05; block 14154236, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/demo/main-run.json, docs/evidence/verification-2026-11-15.json |
| pass | tx 0xe4bf7962…c89d on chain, succeeded, as its record says | success, block 14154191; matches the record's recipient and USDZ 0.05; block 14154191, sender, recipient | linked from /proof, /alta, docs/runs/2026-11-03-main-run-metal-transactions.md; docs/demo/main-run.json, docs/evidence/verification-2026-11-15.json |
| pass | tx 0xe6d9c7ea…5df4 on chain, succeeded, as its record says | success, block 26126103; matches the record's block 26126103, sender, recipient | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xe892abfd…a884 on chain, succeeded, as its record says | success, block 14146897; matches the record's block 14146897, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xebd682c7…8ae0 on chain, succeeded, as its record says | success, block 26148537; matches the record's block 26148537, sender, recipient; block 26148537, sender | linked from /alta; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xee14c617…eb44 on chain, succeeded, as its record says | success, block 14144963; matches the record's block 14144963, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xef3c845b…32be on chain, succeeded, as its record says | success, block 26148587; matches the record's block 26148587, sender, recipient; block 26148587, sender | linked from /alta, /runs; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xefc68319…b575 on chain, succeeded, as its record says | success, block 26148371; matches the record's block 26148371, sender, recipient; block 26148371, sender | linked from /proof, /alta, /runs; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-tokenize.json |
| pass | tx 0xf1a7fe96…0c37 on chain, succeeded, as its record says | success, block 9351961; matches the record's block 9351961, sender, recipient | linked from /proof, /runs; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xf23d83dc…7b0b on chain, succeeded, as its record says | success, block 14149814; matches the record's block 14149814, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xf4530112…a1a6 on chain, succeeded, as its record says | success, block 14157600; matches the record's block 14157600, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xf4bdd52d…cf23 on chain, succeeded, as its record says | success, block 14154136; matches the record's block 14154136, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xf97bcade…f98d on chain, succeeded, as its record says | success, block 10099272; matches the record's block 10099272, sender, recipient; block 10099272, sender, recipient; block 10099272; block 10099272 | linked from /alta; docs/evidence/verification-2026-11-15.json, docs/runs/2026-11-12-metal-inspector.json |
| pass | tx 0xf9be147f…e93f on chain, succeeded, as its record says | success, block 14156629; matches the record's block 14156629, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xfab9cc3d…c4c6 on chain, succeeded, as its record says | success, block 14156616; matches the record's block 14156616, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xfacf2126…36a8 on chain, succeeded, as its record says | success, block 14149266; matches the record's block 14149266, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xfd1db54e…b1d5 on chain, succeeded, as its record says | success, block 14149023; matches the record's block 14149023, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xfdfa0cfc…4fb4 on chain, succeeded, as its record says | success, block 14154885; matches the record's block 14154885, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |
| pass | tx 0xff8debd3…9516 on chain, succeeded, as its record says | success, block 14145246; matches the record's block 14145246, sender, recipient | linked from docs/runs/2026-11-03-main-run-metal-transactions.md; docs/evidence/verification-2026-11-15.json |

</details>

## Figures on the pages (90 passed, 3 failed)

| Result | What was checked | Value seen | Source |
|---|---|---|---|
| pass | /proof: tests passing | page 9385, record 9385 | docs/assets/test-summary.json (passed) |
| pass | the last full test run had no failure | failed 0 | docs/assets/test-summary.json |
| pass | /proof: sandbox and testnet runs | page 36, record 36 | /runs' rows (src/redesign/runs.ts liveRunCount) |
| pass | /proof: Airwallex sandbox API calls in the run records | page 953, record 953 | the Airwallex API trail of the run records (src/airwallex/apiTrail.ts, listed on /airwallex/calls) |
| **FAIL** | /proof: Alta testnet transactions | page 280, record 305 | distinct explorer links in docs/runs and docs/demo, counted here |
| **FAIL** | /proof: Claude calls with request ids | page 1620, record 1817 | distinct req_011… ids in docs/**/*.json(l), counted here |
| **FAIL** | /proof: refusals on record | page 68, record 85 | audit rows of a refusal, decline, rejection or fraud stop in docs/runs and docs/demo, counted here |
| pass | /proof evidence wall: try-transfers | page All 116, record All 116 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: spend-bills | page All 3, record All 3 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-airwallex-bills.json) |
| pass | /proof evidence wall: soak-paid | page All 60, record All 60 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-airwallex-soak.json docs/runs/2026-11-19-airwallex-soak.md docs/runs/2026-11-20-airwallex-soak.json docs/runs/2026-11-20-airwallex-soak.md) |
| pass | /proof evidence wall: soak-fx | page All 12, record All 12 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-airwallex-soak.json docs/runs/2026-11-19-airwallex-soak.md docs/runs/2026-11-20-airwallex-soak.json docs/runs/2026-11-20-airwallex-soak.md) |
| pass | /proof evidence wall: approval-hash | page 797d4483…, record 797d4483… | docs/evidence/evidence-wall.json (from docs/runs/airwallex-transfer-approval-2026-11-06.json) |
| pass | /proof evidence wall: two-locks | page EUR 240.00, record EUR 240.00 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-12-airwallex-two-locks-paid.md) |
| pass | /proof evidence wall: alta-refusal | page #24, record #24 | docs/evidence/evidence-wall.json (from docs/demo/main-run.json) |
| pass | /proof evidence wall: alta-payments | page 86, record 86 | docs/evidence/evidence-wall.json (from docs/demo/main-run.json) |
| pass | /proof evidence wall: visa-airi | page EUR 45.00, record EUR 45.00 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-14-vic-5.json) |
| pass | /proof evidence wall: alta-series-refused | page All 3, record All 3 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-alta-series.json docs/runs/2026-11-19-alta-series-finish.json) |
| pass | /proof evidence wall: alta-series-paid | page 21, record 21 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-alta-series.json docs/runs/2026-11-19-alta-series-finish.json) |
| pass | /proof evidence wall: alta-merkle | page All 33, record All 33 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-alta-merkle.json) |
| pass | /proof evidence wall: late-failure | page Both, record Both | docs/evidence/evidence-wall.json (from docs/runs/2026-11-17-airwallex-late-failure.json) |
| pass | /proof evidence wall: awx-endpoints | page 71, record 71 | docs/evidence/evidence-wall.json (from docs/evidence/airwallex-api-coverage.json) |
| pass | /proof evidence wall: awx-statement | page All 42, record All 42 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-airwallex-deep-3.json) |
| pass | /proof evidence wall: tamper-matrix | page All 894, record All 894 | docs/evidence/evidence-wall.json (from docs/evidence/tamper-matrix.json) |
| pass | /proof evidence wall: try-cent | page All 58, record All 58 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: try-hash | page All 58, record All 58 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: try-proofs | page All 114, record All 114 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: soak-negatives | page All 10, record All 10 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-airwallex-soak.json docs/runs/2026-11-19-airwallex-soak.md docs/runs/2026-11-20-airwallex-soak.json docs/runs/2026-11-20-airwallex-soak.md) |
| pass | /proof evidence wall: card-cent | page EUR 30.01, record EUR 30.01 | docs/evidence/evidence-wall.json (from docs/runs/airwallex-card-cent-2026-11-15.json) |
| pass | /proof evidence wall: visa-refused | page 4, record 4 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-14-vic-5.json) |
| pass | /proof evidence wall: passkeys-onchain | page 3, record 3 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-12-faceid-onchain.json) |
| pass | /proof evidence wall: claude-main | page 24, record 24 | docs/evidence/evidence-wall.json (from docs/demo/main-run.json) |
| pass | /proof evidence wall: worst-case | page 0 vs 35, record 0 vs 35 | docs/evidence/evidence-wall.json (from docs/evals/worst-case-summary.json) |
| pass | /proof evidence wall: eval-v3 | page 11 vs 74, record 11 vs 74 | docs/evidence/evidence-wall.json (from docs/evals/adversarial-v3.json docs/evals/adversarial-v3-rerun-2026-11-19.json docs/evals/adversarial-v3-after.json) |
| pass | /proof evidence wall: eval-v4 | page 11 vs 72, record 11 vs 72 | docs/evidence/evidence-wall.json (from docs/evals/adversarial-v4.json docs/evals/adversarial-v4-after.json docs/evals/adversarial-v4-rerun-2026-11-19.json) |
| pass | /proof evidence wall: eval-v8 | page 20 vs 79, record 20 vs 79 | docs/evidence/evidence-wall.json (from docs/evals/adversarial-v8.json) |
| pass | /proof evidence wall: red-team | page All 35, record All 35 | docs/evidence/evidence-wall.json (from docs/redteam/rerun-2026-11-19b.json docs/redteam/rerun-2026-11-19.json docs/redteam/report.json) |
| pass | /proof evidence wall: hostile-model | page 370 of 380, record 370 of 380 | docs/evidence/evidence-wall.json (from docs/evals/ap-hostile.json docs/evals/ap-hostile-rerun-2026-11-19.json) |
| pass | /proof evidence wall: try-claude | page 0, record 0 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: try-held | page 57 of 58, record 57 of 58 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: redteam-api | page All 128, record All 128 | docs/evidence/evidence-wall.json (from docs/evidence/redteam-api.json) |
| pass | /proof evidence wall: chaos-money | page 0, record 0 | docs/evidence/evidence-wall.json (from docs/evidence/chaos-money.json) |
| pass | /proof evidence wall: fuzzing | page All 17, record All 17 | docs/evidence/evidence-wall.json (from docs/evidence/fuzzing.json) |
| pass | /proof evidence wall: verify-all | page 189, record 189 | docs/evidence/evidence-wall.json (from docs/evidence/verification-2026-11-15.json) |
| pass | /proof evidence wall: anchor | page 731, record 731 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-anchor.json) |
| pass | /proof evidence wall: clearing-load | page All 2,000, record All 2,000 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-clearing-load.json docs/runs/clearing-load-1.json docs/runs/clearing-load-2.json) |
| pass | /proof evidence wall: ci | page 8, record 8 | docs/evidence/evidence-wall.json (from .github/workflows/ci.yml) |
| pass | /proof evidence wall: site-quality | page 100, record 100 | docs/evidence/evidence-wall.json (from docs/evidence/site-quality.json) |
| pass | /proof evidence wall: webkit-try | page Both, record Both | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-webkit-try/summary.json) |
| pass | /proof evidence wall: assurance | page 6, record 6 | docs/evidence/evidence-wall.json (from docs/assurance.md) |
| pass | /proof evidence wall: openssf | page Silver, record Silver | docs/evidence/evidence-wall.json (from docs/evidence/openssf-best-practices.json) |
| pass | /proof evidence wall: supply-chain | page v1.2.0, record v1.2.0 | docs/evidence/evidence-wall.json (from docs/evidence/release-v1.2.0.json) |
| pass | /proof evidence wall: try-journeys | page 57 of 58, record 57 of 58 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: try-sign-paid | page 6.3 s, record 6.3 s | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: try-autopay | page 10.2 s, record 10.2 s | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: try-refusal | page 0.68 s, record 0.68 s | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: try-verify | page 0.12 s, record 0.12 s | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /proof evidence wall: try-cost | page USD 0.0048, record USD 0.0048 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /airwallex strip: soak-paid | page All 60, record All 60 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-airwallex-soak.json docs/runs/2026-11-19-airwallex-soak.md docs/runs/2026-11-20-airwallex-soak.json docs/runs/2026-11-20-airwallex-soak.md) |
| pass | /airwallex strip: try-transfers | page All 116, record All 116 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-live-try/summary.json docs/runs/2026-11-19-mega-run/summary.json) |
| pass | /airwallex strip: spend-bills | page All 3, record All 3 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-airwallex-bills.json) |
| pass | /airwallex strip: soak-fx | page All 12, record All 12 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-airwallex-soak.json docs/runs/2026-11-19-airwallex-soak.md docs/runs/2026-11-20-airwallex-soak.json docs/runs/2026-11-20-airwallex-soak.md) |
| pass | /airwallex strip: awx-endpoints | page 71, record 71 | docs/evidence/evidence-wall.json (from docs/evidence/airwallex-api-coverage.json) |
| pass | /airwallex strip: late-failure | page Both, record Both | docs/evidence/evidence-wall.json (from docs/runs/2026-11-17-airwallex-late-failure.json) |
| pass | /alta strip: alta-series-paid | page 21, record 21 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-alta-series.json docs/runs/2026-11-19-alta-series-finish.json) |
| pass | /alta strip: alta-series-refused | page All 3, record All 3 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-alta-series.json docs/runs/2026-11-19-alta-series-finish.json) |
| pass | /alta strip: alta-refusal | page #24, record #24 | docs/evidence/evidence-wall.json (from docs/demo/main-run.json) |
| pass | /alta strip: alta-payments | page 86, record 86 | docs/evidence/evidence-wall.json (from docs/demo/main-run.json) |
| pass | /alta strip: passkeys-onchain | page 3, record 3 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-12-faceid-onchain.json) |
| pass | /alta strip: clearing-load | page All 2,000, record All 2,000 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-clearing-load.json docs/runs/clearing-load-1.json docs/runs/clearing-load-2.json) |
| pass | /visa strip: visa-airi | page EUR 45.00, record EUR 45.00 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-14-vic-5.json) |
| pass | /visa strip: visa-refused | page 4, record 4 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-14-vic-5.json) |
| pass | /visa strip: tap-interop | page All 22, record All 22 | docs/evidence/evidence-wall.json (from docs/runs/2026-11-19-visa-tap-interop.md) |
| pass | /proof: the partner tiles add up to the note's count | page 34, record 34 | the tiles: Airwallex 15, Visa via Airi 4, Alta 12, T:0 2, Moneybird 1 |
| pass | /proof: live runs = tiles + the main run + on /visa | page 36, record 36 | /proof |
| pass | /proof: the note's live runs = the band's | page 36, record 36 | /proof |
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

