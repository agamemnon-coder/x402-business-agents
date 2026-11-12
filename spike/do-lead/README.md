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

One engine change beyond the explorers': `src/vault/build.ts` reads a filed document through the document store seam.
