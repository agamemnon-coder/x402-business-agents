# spike-do-lead: the tech lead's check (12 November 2026)

Both explorers' branches merged (`spike-do-chain`, `spike-do-runtime`), plus one probe that joins them. Never merged as it is.

What ran (local workerd through wrangler 4.155.0, nodejs_compat, a SQLite-backed Durable Object, local D1 and R2; no network):

- `spike/do/chain/all.sh /dev/shm/tl-verify-chain 3` (the chain explorer's command, re-run): 75 of 76 shim checks the same, the golden
  comparison 0 differences over 71 rows in 21 tables, 947 engine statements in both runtimes.
- `unshare -n python3 spike/do/nonet.py node spike/do-lead/run.mjs` (new): the cloud Worker with one Engine object per company.
  The object runs the real chain with the engine's real PDF reader, feeds the read model with `applySync` on D1 and R2,
  files the vault into R2, and the console's own API shows the invoice paid with its document. Result: `results/lead-run.json`.
- `wrangler deploy --dry-run -c spike/do-lead/wrangler.jsonc`: 7519.59 KiB, gzip 1706.02 KiB (cloud Worker plus the whole engine).
- Node tests of the modules the merged tree touches: 18 files, 196 tests pass (vault-*, ap-inbox, ap-pay, ap-detail,
  ap-migration, ap-redteam2, cloud-sync, cloud-core, executors-dispatch, passkey, payment-batch, rt4-web).

- The catches, in the object and on better-sqlite3 in Node (`npx tsx spike/do-lead/tools/node-catches.ts`), same answers in both:
  the same file again is `duplicate_document`; a renumbered copy with the same total is `needs_review` with
  `possible_duplicate`; the repository's changed-bank-details fixture is `needs_review` with `country_not_paid`
  (not `possible_fraud`: the demo's scenarios should pick their catch invoices by what the checks answer).
- The two runtime probes not covered by the joined one, re-run: `node spike/do-runtime/run.mjs p5-claude p6-airwallex`, both HTTP 200.

- The engine loaded on first use (`spike/do-lead/lazyWorker.ts`, `startup.mjs`): before the object's first engine call the engine is
  not loaded; after it the chain pays as before. First-answer times of a fresh local workerd were the same with and without
  (1.5 to 2.4 s on a machine with load 30), so local timing does not answer the start-up question.
- The engine's own Node tests through the shim (`spike/do-lead/shim/`): 48 files, 513 tests, all pass:
  `npx vitest run --config spike/do-lead/shim/vitest.shim.config.ts --maxWorkers=2 test/ap-*.test.ts test/approvals*.test.ts
  test/books.test.ts test/close-unsent.test.ts test/executors-*.test.ts test/gl-export.test.ts test/ledger-*.test.ts
  test/month*.test.ts test/passkey*.test.ts test/payment-batch.test.ts test/payouts-*.test.ts test/stock.test.ts
  test/supplier-facts.test.ts test/vault-*.test.ts test/cloud-sync.test.ts`

One engine change beyond the explorers': `src/vault/build.ts` reads a filed document through the document store seam.
