# The anchor, verified live (15 November 2026)

`npm run verify-anchor` run live on 15 Nov, 2026-11-15T03:50:40Z to 2026-11-15T03:50:43Z, against Alta (formerly Metal) testnet
(chain id 63825). Read only: it read the anchor transaction and its receipt from the chain. Nothing was signed or sent,
and no key was used. The figures are in `2026-11-15-anchor-verified.json`.

It recomputed the anchor head from this repository's committed records, read the 13 Nov anchor transaction
([`0xaa93f270a37c66e8be033949b8a6dc89278e47722ca0be5067a744a32b20e6c1`](https://testnet.metalntwx.com/tx/0xaa93f270a37c66e8be033949b8a6dc89278e47722ca0be5067a744a32b20e6c1), block 27469355; record
[2026-11-13-anchor.md](2026-11-13-anchor.md)) and compared the two.

**Result: MATCH.** The head on chain, `aaaf56a1616d6e1210bfbe27d23c9aa58d40930675148b6f6870aaba28fd816f` at height 701, is the head the repository gives today:
none of the anchored records was rewritten after 13 Nov.

```
ok    decision log (recorded run, 30 Oct)  194 at ee0732445a717f73…
ok    audit chain (main run, 3 Nov)        412 at f8d2a633d27316c3…
ok    books (main run journal, 3 Nov)      95 at 7b0d846919757154…
ok    repo head                            recomputed aaaf56a1616d6e1210bfbe27d23c9aa58d40930675148b6f6870aaba28fd816f
ok    chain                                chain id 63825
ok    transaction                          0xaa93f270a37c66e8be033949b8a6dc89278e47722ca0be5067a744a32b20e6c1 success, block 27469355
ok    block                                27469355
ok    sender                               0xe62ddb110aa0d9123bac397487e1a70c92db0d93
ok    calldata                             head aaaf56a1616d6e1210bfbe27d23c9aa58d40930675148b6f6870aaba28fd816f, height 701

MATCH: docs/runs/2026-11-13-anchor.json, tx 0xaa93f270a37c66e8be033949b8a6dc89278e47722ca0be5067a744a32b20e6c1
```

No new anchor or other Alta transaction was made on 15 Nov: no key is in this environment.
