# Bootstrap run, 2026-10-29 (Metal testnet, live)

`npm run bootstrap` with `@metalntwx/metal-agent@0.3.3`. A second run changed nothing (every step reported "exists" or "already bound").

| Role | Address |
|---|---|
| Business account B (Tidemark Data) | `0x4F95173f1EA61579dD03f81E73D74E6BDBbA1462` |
| Customer account C (Kestrel Quant) | `0xeB27B08240f4FE24e629c41D3db82bc5228Ca9E5` |
| Supplier S (Feedstock Labs) | `0x5D72985B418C6eF4753BA630B285882a14e47336` |
| Sweep wallet W | `0xb598Ae440Ff61d234999f2E9923fECB94E85962a` |

| Step | Tx |
|---|---|
| Create customer account C | [`0xe84330d5…6f0b`](https://testnet.metalntwx.com/tx/0xe84330d5b6869679d11596a2ef235dc9bd5cc280e38f7509b4835172fb006f0b) |
| Move 20.00 *USDZ owner → B | [`0x76fac750…73ed`](https://testnet.metalntwx.com/tx/0x76fac750da15ed1f616533b528d16b1095caa04c4283da3ba675e43eb5f673ed) |
| Bind sourcing (cap 0.03, budget 10, payee S) | [`0xfbb55b23…b201`](https://testnet.metalntwx.com/tx/0xfbb55b23f8514a2579a65bb57f66e5be99eff3c4983adcd73601fe64193ab201) |
| Bind support (cap 0.10, budget 4, payee C) | [`0x5e903a73…7a96`](https://testnet.metalntwx.com/tx/0x5e903a732c3895cda73a26dd6bc22645f350235e9a99042d4830c0f8ebf97a96) |
| Bind treasury (cap 6, budget 6, payee W) | [`0xb5ad2ce8…f6cf`](https://testnet.metalntwx.com/tx/0xb5ad2ce898f56c1233b0e20d5ef231cf1517354e591f8e4ba246481d74acf6cf) |
| Bind customer (cap 0.10, budget 5, payee B) | [`0x52275a11…c6f0`](https://testnet.metalntwx.com/tx/0x52275a117c8a164b8d5e7601fc43bb994d93b8ffe6699ad5548809977437c6f0) |

All mandates expire 2026-12-08, after Demo Day.
