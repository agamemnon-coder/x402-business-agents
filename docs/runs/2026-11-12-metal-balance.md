# Metal testnet balances, read-only (2026-11-12)

Read at 2026-11-12T14:08:58Z UTC, block 26148542, chain id 63825 (Metal testnet). Test money only.
Made by `npm run metal-balance` (`src/cli/metalBalance.ts`): 7 read-only RPC calls, cap 10. Nothing was signed or sent, no faucet was asked.
Gas on Metal is paid in *USDZ, so each balance below is also that wallet's gas. Balances are rounded down to the cent.

| Wallet | Address | *USDZ | Named in |
|---|---|---|---|
| Northwind business account (sourcing, support, treasury mandates) | `0x828c7DE12cab8149AA516958433F6EEe23aEC875` | 20.00 | docs/demo/metal.json |
| Summit Outfitters, simulated customer account | `0xB6C24EC17Ab3fa37d80eC7739AaF387e49a1eB25` | 97.45 | docs/demo/metal.json |
| Northwind sweep wallet (treasury payee) | `0x1fB9a22f89D6Df92abF20efDe0E7d4cC5f0455A5` | 1.35 | docs/demo/metal.json |
| Sweep wallet W, holder of the 0.25 hold of 10 November | `0xb598Ae440Ff61d234999f2E9923fECB94E85962a` | 1.09 | docs/runs/2026-10-29-bootstrap.md, docs/runs/2026-11-10-metal-extra.md |
| Business account B (Tidemark Data) | `0x4F95173f1EA61579dD03f81E73D74E6BDBbA1462` | 20.03 | docs/runs/2026-10-29-bootstrap.md |
| Customer account C (Kestrel Quant) | `0xeB27B08240f4FE24e629c41D3db82bc5228Ca9E5` | 97.38 | docs/runs/2026-10-29-bootstrap.md |
## What this does not cover

- The owner's key wallets (business owner, customer owner, the tokenize donor key) are not in this container, so their
  balances were not read. The addresses above are the public ones named in the records. With the keys at hand, the
  same command reads up to nine wallets: `npm run metal-balance -- <wallets.json>`.
- The run is dated Thursday 12 November (the spec named 13 November; Thursday is the 12th).
- Faucet: not asked, by rule. A claim is the owner's go.

The wallet list is `docs/runs/metal-balance-wallets.json`.
