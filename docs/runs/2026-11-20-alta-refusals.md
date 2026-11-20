# Alta testnet: four more mandate refusals on chain, and one the CLI stops before sending (2026-11-20)

Live on Alta (formerly Metal) testnet, chain id 63825, test money only (*USDZ from the testnet faucet). Run from this session with no person's hands: no passkey, no Face ID. Made by `npm run alta-refusals` ([src/cli/altaRefusals.ts](../../src/cli/altaRefusals.ts)) with the pinned `metal-agent` CLI, in a test world of its own; keys in a folder outside this repository, none in this record. This page is written from [2026-11-20-alta-refusals.json](2026-11-20-alta-refusals.json) by `npm run alta-refusals -- --md`.

**Why.** The 19 Nov series ([2026-11-19-alta-series.md](2026-11-19-alta-series.md)) sent three payments its mandate does not allow (over the cap, another payee, over the budget). This run sends the refusals it did not: a mandate whose payment count is used up, a revoked mandate, a mandate that has not started, an expired mandate, and a payment signed by a key that is not the mandate's. Each is sent with `--record-refusal`, so Alta's Mandate Binding itself refuses it in a transaction of its own: here they go to the chain on purpose.

**Result:** 5 payments paid inside their mandates (0.21 test USD); 4 of 4 refusals sent were refused on chain, 4 with the reason expected (`OverOccurrences`, `Revoked`, `OutsideRecurrence`, `Expired`), each moving 0.00 for the payee and the account. 1 more (a payment signed by another key) was refused by the pinned CLI before it signed anything, so it never reached the chain and Alta's own signature check was not exercised. 16 transactions in all; 0 unexpected.

**Note.** Step 7 was recorded at run time as UNEXPECTED with the CLI's error, which named a local keys path. Its outcome and detail here are as src/cli/altaRefusals.ts now records that error (changed the same day, after the run); the CLI's own words, checked again with nothing sent: "<keys file> is not this mandate's key". The keys folder is outside the repository. Nothing else in this record was changed.

| | |
|---|---|
| Account (one owner) | `0x47bf9476d3690467F154ff76cEE667D2E3c3706D` |
| Owner (plain test key) | `0x9ccB3B89660Ba79f0934928A51b5287dbF47961A` |
| Payee every mandate names (test payee) | `0xfc3c86a7B6fEE39203934A6D8E7705494DE617cB` |
| Gas-only key (pays the recorded refusals' gas, owns nothing) | `0xe0Ccad257c88b22226f44Cbfd33f0FDF1B3Ad8E4` |
| Ran | 2026-11-20T09:35:02.843Z to 2026-11-20T09:40:23.058Z |

## The mandates, as the chain has them after the run

| Mandate | Terms | Starts | Expiry | Revoked | Spent | Payments | Reference |
|---|---|---|---|---|---|---|---|
| A | cap 0.10 a payment, budget 1.00, one payee, at most 4 payments, 7 days | 1795132800 (2026-11-20T00:00:00.000Z) | 1795772120 (2026-11-27T09:35:20.000Z) | yes | 0.2 *USDZ of 1 *USDZ | 4 | `0x96e6dd68098ba74e64647f779248c9f99cefa9fff8e47946e5fc4efbbc7d1609` |
| B | cap 0.10, budget 1.00, one payee, starting 24 hours after it was issued | 1795253781 (2026-11-21T09:36:21.000Z) | 1795772181 (2026-11-27T09:36:21.000Z) | no | 0 *USDZ of 1 *USDZ | 0 | `0xf493b3c06c11a08594889076625d63ffcfd1d383aae4230d109e972920778e6a` |
| C | cap 0.10, budget 1.00, one payee, expiring 3 minutes after it was issued | 1795132800 (2026-11-20T00:00:00.000Z) | 1795167577 (2026-11-20T09:39:37.000Z) | no | 0.01 *USDZ of 1 *USDZ | 1 | `0x33116e19fce4b27f319fe2ab1a799301def391364f827a60794209eb7f9b5ad3` |

## Every step, read back from its receipt

"Payee" and "Account" are the balance changes read before and after each pull.

| # | Mandate | Step | Outcome | Expected | Event on chain | Payee | Account | Block | Transaction |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | - | create the owner's Alta account (one owner) | done | – | – | – | – | – | [`0x029b3179…4f11`](https://testnet.metalntwx.com/tx/0x029b3179b2f271659f16cc9672ef1bfac218487df2a265970121020db3484f11) |
| 2 | - | fund the account to 1.00 test USD | done | – | – | – | – | – | [`0x05d83efd…103b`](https://testnet.metalntwx.com/tx/0x05d83efdf4a00b1b2365a20dab002ed650958380bdbc2a3ed4d5615dddcd103b) |
| 3 | - | fund the gas-only key with 0.50 (it pays the recorded refusals' gas, owns nothing) | done | – | – | – | – | – | [`0x2ae75f23…8738`](https://testnet.metalntwx.com/tx/0x2ae75f230a878cc316a0b1a52f414940c48eac7960f3033f24eaf7e30f158738) |
| 4 | A | bind mandate A: cap 0.10 a payment, budget 1.00, one payee, at most 4 payments, 7 days | done | – | – | – | – | – | [`0xf7a435de…ce36`](https://testnet.metalntwx.com/tx/0xf7a435def7e9c691503dce3ea81f1e8dce155acaa973e5e3a52fa1e2fce6ce36) |
| 5 | A | payment 1 of 4: 0.05 to the test payee | paid | – | MandatePayment | 0.05 | -0.05 | 36733342 | [`0x618d2a14…153a`](https://testnet.metalntwx.com/tx/0x618d2a14a3592d1e94f8d5d05efa53585584811f5d276babd304c752be3a153a) |
| 6 | A | payment 2 of 4: 0.05 to the test payee | paid | – | MandatePayment | 0.05 | -0.05 | 36733442 | [`0x01e0ccbf…743e`](https://testnet.metalntwx.com/tx/0x01e0ccbf02cd05a2dfdadfd0ec63bfca69093fada182c4c30afc3a6794b3743e) |
| 7 | A | signed by a key that is not the mandate's: 0.05 to the test payee | refused before sending | BadSignature | – | – | – | – | not sent |
| 8 | A | payment 3 of 4: 0.05 to the test payee | paid | – | MandatePayment | 0.05 | -0.05 | 36733572 | [`0xa976ee29…c07f`](https://testnet.metalntwx.com/tx/0xa976ee293ae33697c81727411625b8a84d2321be77102430a19909311985c07f) |
| 9 | A | payment 4 of 4: 0.05 to the test payee | paid | – | MandatePayment | 0.05 | -0.05 | 36733682 | [`0x7349de31…1594`](https://testnet.metalntwx.com/tx/0x7349de31aa434c017928020124f63863826a80010368d62088e71526dcd91594) |
| 10 | A | a fifth payment, the mandate allows 4: 0.05 to the test payee | refused on chain (OverOccurrences) | OverOccurrences | MandateRefused | 0.00 | 0.00 | 36733781 | [`0xe091e2b6…e471`](https://testnet.metalntwx.com/tx/0xe091e2b6af2ad83ca015538fc721d1fbc2a883a5d86c896e03301a775699e471) |
| 11 | A | the owner revokes mandate A | done | – | – | – | – | – | [`0x31b98390…2973`](https://testnet.metalntwx.com/tx/0x31b98390b11cb2fe11cafbcb232f8eec8574c27a92d23a20c171d1533a672973) |
| 12 | A | after the revoke: 0.01 to the test payee | refused on chain (Revoked) | Revoked | MandateRefused | 0.00 | 0.00 | 36733984 | [`0x2e981a5a…6677`](https://testnet.metalntwx.com/tx/0x2e981a5a59da2601512a65a61da1e6f7125068073a1447059335c3492d426677) |
| 13 | B | bind mandate B: cap 0.10, budget 1.00, one payee, starting 24 hours after it was issued | done | – | – | – | – | – | [`0x2fa9acde…2ed0`](https://testnet.metalntwx.com/tx/0x2fa9acde65ffcb3bfe0eac7811d510114ed75205b7d42161feb435d3601b2ed0) |
| 14 | B | before the mandate's start: 0.01 to the test payee | refused on chain (OutsideRecurrence) | OutsideRecurrence | MandateRefused | 0.00 | 0.00 | 36734258 | [`0x48a5c5a7…1b93`](https://testnet.metalntwx.com/tx/0x48a5c5a7eeb406d63a9ad773a2d182d93cad9d6fcd15c35631578e578ac01b93) |
| 15 | C | bind mandate C: cap 0.10, budget 1.00, one payee, expiring 3 minutes after it was issued | done | – | – | – | – | – | [`0xcb2c485f…d32b`](https://testnet.metalntwx.com/tx/0xcb2c485feb53f0df8e9c5c5a7952603b48f5c7901d3418fdb7c538d8012ad32b) |
| 16 | C | inside the 3 minutes: 0.01 to the test payee | paid | – | MandatePayment | 0.01 | -0.01 | 36734498 | [`0xcad6a984…c70a`](https://testnet.metalntwx.com/tx/0xcad6a984523583a7e048e2e02e9d4c2510df379813d221cfce0b506137dac70a) |
| 17 | C | after the mandate expired: 0.01 to the test payee | refused on chain (Expired) | Expired | MandateRefused | 0.00 | 0.00 | 36737620 | [`0xa4849dbd…b670`](https://testnet.metalntwx.com/tx/0xa4849dbd3ab93ca2bbdf8a43a7e2c6743107bddd774e68011ce7368f0d13b670) |

## What this does not show

- `NonceUsed` (the same signed payment sent twice): the CLI keeps each payment id and reports a paid one again instead of sending it, so it was not sent.
- `BadSignature` on chain: the pinned CLI refuses a key that is not the mandate's before signing; a payment signed by another key would need a client other than the CLI.
- Anything about real money: testnet, test USD from the faucet.
