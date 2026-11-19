# Alta testnet: 21 mandate-checked payments, 3 refused on chain, and a fresh anchor (19 November 2026)

Live on Alta (formerly Metal) testnet, chain id 63825, test money only (*USDZ from the testnet faucet). Run from this
session with no person's hands: no passkey, no Face ID, no phone. Made by `npm run alta-series`
(`src/cli/altaSeries.ts`, new today: it strings together what the earlier Alta runs already use, the pinned
`metal-agent` 0.3.3 CLI's `account create`, `mandate credential create`, `mandate bind` and `mandate pull`, the last
with `--record-refusal` for the payments the mandate does not allow, as `npm run four-eyes` does). Keys in a new test
keys folder outside this repository; none is in this repository, its logs or this record.

**Result:** 21 payments paid under the agent's mandate, 1.00 test USD in all, each read back from its receipt
(a `MandatePayment` event from the account, and the payee's balance up by exactly the amount). Three payments the
mandate does not allow were sent to the chain on purpose, and Alta's Mandate Binding refused each in a transaction
(`MandateRefused`, reasons `OverPerPaymentCap`, `PayeeNotAllowed`, `OverBudget`); the payee and the account moved 0.00
on each. A fresh anchor transaction pins both records of this run, and `npm run verify-anchor` reads it back: MATCH.
Not as planned, said plainly below: my first plan summed to 1.01, one cent over the budget.

| | |
|---|---|
| Account (one owner, `metal-agent account create`) | `0xB6f3903bd90e4EBa3239888a99141c2ceCcb30bD` |
| Owner (plain test key; pays the setup's gas) | `0x7B01Ae7919C1d625b003fE00429abe96bE7B6072` |
| Agent mandate | `0x795f0c6826809a83b4721c69e9e922eb0b0107a1eefb2ac46a02a8769250c07d`: cap 0.10 a payment, budget 1.00 over its life, one payee, 7 days |
| Payee the mandate names (test payee) | `0x557DE06a06591504C4Cc90d96E98d15803066a21` |
| Address the mandate does not name (stranger) | `0x2bE3449DCe3234A0D2a4B107a524F375C70Afa6f` |
| Gas-only key (pays the recorded refusals' gas and the anchor's; owns nothing) | `0xd996570d2a70991e8793a074Fe0000B099823374` |
| Records | [`2026-11-19-alta-series.json`](2026-11-19-alta-series.json) (pass 1, written 2026-11-19T09:36:11.661Z), [`2026-11-19-alta-series-finish.json`](2026-11-19-alta-series-finish.json) (pass 2, written 2026-11-19T09:37:16.059Z), [`2026-11-19-anchor.json`](2026-11-19-anchor.json) |

Setup transactions:

- create the owner's Alta account (one owner): [`0x37c987ee…b9e8`](https://testnet.metalntwx.com/tx/0x37c987ee1d824b788a6958d67b862228066e28a81ae521bd348b9a4d71dcb9e8)
- fund the account to 1.50 test USD: [`0x9dacdd4e…6568`](https://testnet.metalntwx.com/tx/0x9dacdd4e1325d6f6686d170097bd4bb9ebb5c12d43532d155df2909265e86568)
- fund the gas-only key with 0.50 (it pays the recorded refusals' gas, owns nothing): [`0xd0adc515…fbef`](https://testnet.metalntwx.com/tx/0xd0adc515075aeccaad045f8666f0725f997c983712800146f985b2aef0fafbef)
- bind the agent's mandate: cap 0.10 a payment, budget 1.00, one payee: [`0xab1466ff…917b`](https://testnet.metalntwx.com/tx/0xab1466ff154ac270f0ddc4aad9c6983218c31623f84517609f3bafdd62c7917b)
- pass 2: fund the account back to 1.50 test USD (pass 1 had spent 0.98 of it): [`0x846f6f4e…e9ac`](https://testnet.metalntwx.com/tx/0x846f6f4e161763f3ace5e70239d95470fcf77255a4b5aec48d987cd05ae7e9ac)

## Every payment and refusal, read back from its receipt

Pass 1 is `npm run alta-series`; pass 2 is `npm run alta-series -- --finish` in the same test world. "Payee" and
"account" are the balance changes read before and after each pull; "spent" is the mandate's spent figure the event
carries. Payments are signed by the agent's mandate key alone and submitted by Alta's facilitator; the three
over-mandate attempts are signed the same way and submitted by the gas-only key with `--record-refusal`, so the chain
itself checks them.

| Pass | What | Outcome | Event on chain | Payee | Account | Spent | Block | Transaction |
|---|---|---|---|---|---|---|---|---|
| 1 | payment 1 of 20: 0.10 to the test payee (exactly the cap) | paid | MandatePayment | 0.10 | -0.10 | 0.10 | 35367418 | [`0x8d992f33…ad73`](https://testnet.metalntwx.com/tx/0x8d992f3398d03b5500df2ac74541caa1bca74ffdb7785018d29dcea3a837ad73) |
| 1 | payment 2 of 20: 0.05 to the test payee | paid | MandatePayment | 0.05 | -0.05 | 0.15 | 35367524 | [`0x1ea95cc2…33c2`](https://testnet.metalntwx.com/tx/0x1ea95cc25096798b84786407c83de8df499efc5a2d55ffdd4e6019f7928d33c2) |
| 1 | payment 3 of 20: 0.03 to the test payee | paid | MandatePayment | 0.03 | -0.03 | 0.18 | 35367624 | [`0x8da87358…416d`](https://testnet.metalntwx.com/tx/0x8da8735889fc91e2a55b78f292f517829061ecfdbc965481fbe46d4aa8a6416d) |
| 1 | payment 4 of 20: 0.07 to the test payee | paid | MandatePayment | 0.07 | -0.07 | 0.25 | 35367704 | [`0x6b2f253f…b4f5`](https://testnet.metalntwx.com/tx/0x6b2f253fd6c73eacdf157376bf2bd663181bd43bc6e9caab93efcd20679ab4f5) |
| 1 | payment 5 of 20: 0.04 to the test payee | paid | MandatePayment | 0.04 | -0.04 | 0.29 | 35367780 | [`0x3c37f17d…c14d`](https://testnet.metalntwx.com/tx/0x3c37f17d2740daff96a4acde9e9f17d1696c1c38310f3b5c57a4c4a862f9c14d) |
| 1 | over the cap: the agent asks to pay 0.11 (cap 0.10) | refused on chain | MandateRefused (OverPerPaymentCap) | 0.00 | 0.00 | — | 35367874 | [`0x898ebd4a…bf6b`](https://testnet.metalntwx.com/tx/0x898ebd4ad307642d84dbec457faf68e6b95f4a1ec96c2ddd87474252fc4cbf6b) |
| 1 | payment 6 of 20: 0.06 to the test payee | paid | MandatePayment | 0.06 | -0.06 | 0.35 | 35367972 | [`0x067c3611…e3da`](https://testnet.metalntwx.com/tx/0x067c3611a77ba331e3ed85513d0506cb64a700a18db87f68fd1033fb388de3da) |
| 1 | payment 7 of 20: 0.02 to the test payee | paid | MandatePayment | 0.02 | -0.02 | 0.37 | 35368058 | [`0x60fa3add…12b9`](https://testnet.metalntwx.com/tx/0x60fa3addb906347766e9c3df9f38af2e592d65fcbf414f56f7b71f84254312b9) |
| 1 | payment 8 of 20: 0.08 to the test payee | paid | MandatePayment | 0.08 | -0.08 | 0.45 | 35368174 | [`0x630e0faa…3cfa`](https://testnet.metalntwx.com/tx/0x630e0faaff24a94b3c748f3b814d1b523844e51cd19db08e941c60c247cc3cfa) |
| 1 | payment 9 of 20: 0.05 to the test payee | paid | MandatePayment | 0.05 | -0.05 | 0.50 | 35368279 | [`0x370065bf…6a25`](https://testnet.metalntwx.com/tx/0x370065bf52065e5c1d6d96f038027aac6fc52f1e39728a2704df583daddc6a25) |
| 1 | payment 10 of 20: 0.05 to the test payee | paid | MandatePayment | 0.05 | -0.05 | 0.55 | 35368374 | [`0xb9fe1239…0104`](https://testnet.metalntwx.com/tx/0xb9fe12396226e18d7e687e9eb35491bd7a30d4d9620b50098dea56c95f3a0104) |
| 1 | payment 11 of 20: 0.01 to the test payee | paid | MandatePayment | 0.01 | -0.01 | 0.56 | 35368473 | [`0x6f8838cc…2815`](https://testnet.metalntwx.com/tx/0x6f8838cca1fe4a69ed3b06a4c1971ec5da85db3f4e33153a253ef59daf5d2815) |
| 1 | payment 12 of 20: 0.09 to the test payee | paid | MandatePayment | 0.09 | -0.09 | 0.65 | 35368564 | [`0x1533bddc…9ac3`](https://testnet.metalntwx.com/tx/0x1533bddce6d9b4543d17ad07bf6d77768099d3afbe7dfc3d83f72ad816d89ac3) |
| 1 | a payee the mandate does not name: the agent asks to pay 0.05 to a stranger's address | refused on chain | MandateRefused (PayeeNotAllowed) | 0.00 | 0.00 | — | 35368654 | [`0x04e43556…16b2`](https://testnet.metalntwx.com/tx/0x04e43556bc4f84ad7f6aeabb6d71f7d904c459db029327683d7adf8960c816b2) |
| 1 | payment 13 of 20: 0.04 to the test payee | paid | MandatePayment | 0.04 | -0.04 | 0.69 | 35368762 | [`0x28b9d05c…7cf1`](https://testnet.metalntwx.com/tx/0x28b9d05c833604a8a813769921b47612a51cc4c30a7f33bf0b57cf2381c87cf1) |
| 1 | payment 14 of 20: 0.06 to the test payee | paid | MandatePayment | 0.06 | -0.06 | 0.75 | 35368874 | [`0x08305837…f21c`](https://testnet.metalntwx.com/tx/0x08305837dc7e9061a9f6c47b49300b29be3470985b2083f400647caef85ef21c) |
| 1 | payment 15 of 20: 0.03 to the test payee | paid | MandatePayment | 0.03 | -0.03 | 0.78 | 35369008 | [`0x3f7737d1…56b5`](https://testnet.metalntwx.com/tx/0x3f7737d17ce575771e260f72bd895613e80870cebe9ed57b62a7ff12e9d956b5) |
| 1 | payment 16 of 20: 0.07 to the test payee | paid | MandatePayment | 0.07 | -0.07 | 0.85 | 35369102 | [`0xd5bf4208…2df5`](https://testnet.metalntwx.com/tx/0xd5bf420871b671c0ac2bfa62372a1292e3fa0ba7686159ace6f3a2be1f612df5) |
| 1 | payment 17 of 20: 0.05 to the test payee | paid | MandatePayment | 0.05 | -0.05 | 0.90 | 35369202 | [`0xc03b67bb…59f6`](https://testnet.metalntwx.com/tx/0xc03b67bbdf9e39ce974789663a58e8827d347d6172df7a3ae655b36a670659f6) |
| 1 | payment 18 of 20: 0.05 to the test payee | paid | MandatePayment | 0.05 | -0.05 | 0.95 | 35369308 | [`0x5a04ce59…e753`](https://testnet.metalntwx.com/tx/0x5a04ce59a29c3464c89fed135c865325f8d2e1d4e86e4cdca46e833fc274e753) |
| 1 | payment 19 of 20: 0.02 to the test payee | paid | MandatePayment | 0.02 | -0.02 | 0.97 | 35369409 | [`0xd64736a3…527a`](https://testnet.metalntwx.com/tx/0xd64736a3e1f37314e71f83ae8338fb9156bf0fa1639e0ee86f026f51605a527a) |
| 1 | payment 20 of 20: 0.04 to the test payee | not as planned (see below) | — | — | — | — | — | none |
| 1 | over the budget: the budget's 1.00 is spent; the agent asks for 0.01 more | not as planned (see below) | MandatePayment | 0.01 | -0.01 | 0.98 | 35369532 | [`0x32be4cfb…b0ce`](https://testnet.metalntwx.com/tx/0x32be4cfbaafcaa974dd02c529c3fecaf0dd95dec005de3e86512694ca457b0ce) |
| 2 | payment 21: 0.02 to the test payee, what is left of the budget | paid | MandatePayment | 0.02 | -0.02 | 1.00 | 35370414 | [`0x6118415b…d481`](https://testnet.metalntwx.com/tx/0x6118415bc330f13276b0a24bce0de0938601375767468c38bca227526903d481) |
| 2 | over the budget: the budget's 1.00 is spent; the agent asks for 0.01 more | refused on chain | MandateRefused (OverBudget) | 0.00 | 0.00 | — | 35370525 | [`0xd6d4ba5b…32de`](https://testnet.metalntwx.com/tx/0xd6d4ba5b9ccae6a9f9e8715029723beffb47a473f61831482dc92cedccdd32de) |

## Not as planned

The plan's 20 amounts summed to 1.01, not the 1.00 budget (its last amount was 0.04). So:

- **Payment 20 of 20 (0.04)** was refused by `metal-agent` before anything was sent (`mandate_budget_spent`: 0.04 would
  take the mandate past its budget, 0.03 was left). No transaction; it is not counted as a refusal on chain.
- **The "over the budget" cent** of pass 1 was then within the budget (0.03 left) and Alta paid it, correctly. It is a
  payment, not a refusal: the record marks it UNEXPECTED because the plan was wrong, not the chain.
- **Pass 2** (`--finish`, added for this) paid what was left (0.02, spent 1.00 of 1.00) and then sent the cent over the
  budget: refused on chain, `OverBudget`. The script now checks that its plan sums to the budget before it sends
  anything.

Counted honestly: 21 payments paid on chain (19 + the cent + 0.02 = 1.00), 3 attempts refused on chain, 1 refused
off chain by the CLI's own check. The mandate's own status read from the chain at the end: bound yes, revoked no,
spent 1 of 1, payments 21. Purser's policy layer (src/policy/holds.ts) would have refused all three over-mandate
attempts before signing; here they were sent to show that the chain refuses them by itself.

## The anchor, fresh, and its check

`npm run anchor -- --live --with docs/runs/2026-11-19-alta-series.json --with docs/runs/2026-11-19-alta-series-finish.json`
(the `--with` option is new today: a run record's SHA-256 over its canonical JSON joins the standing three parts, kind
`record-digest`, src/anchor/head.ts). Head `52c9477d3bd806852f6a9ef2d5cc308844250b15c4fa8f16e39c5638719770ff`, height 731, in
[`0x2bc04ccd0a4281545497a2511a790f0b85831a0e640ddd263b3ca1e64e7b38c2`](https://testnet.metalntwx.com/tx/0x2bc04ccd0a4281545497a2511a790f0b85831a0e640ddd263b3ca1e64e7b38c2), block 35371564, sent 2026-11-19T09:38:14.374Z from the gas-only key above. Record:
[2026-11-19-anchor.md](2026-11-19-anchor.md).

```
$ npm run verify-anchor -- docs/runs/2026-11-19-anchor.json
ok    decision log (recorded run, 30 Oct)  194 at ee0732445a717f73…
ok    audit chain (main run, 3 Nov)        412 at f8d2a633d27316c3…
ok    books (main run journal, 3 Nov)      95 at 7b0d846919757154…
ok    run record (2026-11-19-alta-series)  27 at 06b695ed4acf2446…
ok    run record (2026-11-19-alta-series-finish) 3 at e2e15f8f254a02c0…
ok    repo head                            recomputed 52c9477d3bd806852f6a9ef2d5cc308844250b15c4fa8f16e39c5638719770ff
ok    chain                                chain id 63825
ok    transaction                          0x2bc04ccd0a4281545497a2511a790f0b85831a0e640ddd263b3ca1e64e7b38c2 success, block 35371564
ok    block                                35371564
ok    sender                               0xd996570d2a70991e8793a074fe0000b099823374
ok    calldata                             head 52c9477d3bd806852f6a9ef2d5cc308844250b15c4fa8f16e39c5638719770ff, height 731

MATCH: docs/runs/2026-11-19-anchor.json, tx 0x2bc04ccd0a4281545497a2511a790f0b85831a0e640ddd263b3ca1e64e7b38c2
```

The 13 Nov anchor still verifies too (`npm run verify-anchor`, run this morning before the series: MATCH, head
`aaaf56a1…816f`). `verify-all` keeps checking the 13 Nov record by name.

## Not counted on the site (yet)

These files are listed in `NOT_IN_BAND` (src/redesign/scale.ts; src/cli/verifyAll.ts recounts with the same list), so
the band on /proof and Home stays as deployed: 233 Alta testnet transactions, 68 refusals on record, 27 live runs. Once
counted (by taking them off that list), the Alta testnet figure would rise by 30, from 233 to 263 (the 29 distinct
transactions linked here and the anchor's; computed with scaleFigures on this commit), and verify-all's recount of that
figure with it, so the deployed /proof (233) would fail verify-all until the site is rebuilt; the refusals figure would not change (the band
counts audit-row events that say "refus…" in lower case, and these records carry `MandateRefused`), nor would the
Claude, Airwallex or tests figures. The live-runs count is a list kept in src/redesign/runs.ts; this run is not on it.
