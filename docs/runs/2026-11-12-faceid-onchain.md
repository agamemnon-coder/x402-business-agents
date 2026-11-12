# The passkey account on chain: run record (with a virtual test passkey)

Metal testnet (chain 63825); amounts are in test USD (the testnet's token USDZ): test money, nothing here has real value. It started 2026-11-12T13:43:25.504Z; its last audit row is from 2026-11-12T13:54:28.158Z.
Written from 36 audit rows and 36 call-log lines; no call was made to write it. The audit log's hash chain verifies (40 rows, head `3785a94ef97e3640…`). The run's start is the time of this world's first audit row about the account. Every time in this record is the time of an audit row (UTC); none is read from the clock.

**Stand-in:** the second approver "test-controller" is a virtual test passkey: Chromium's virtual authenticator driven by docs/runs/driver/test-controller.ts; not a person's device.

## The account

- Account `0xb5A370DCdFb60F1Ede241C9c3B28135Ac4216a3c`: 2 owners, threshold 2.
- WebAuthn verifier `0xd4c84c2bea087053691623bc463da61b528755ab`: OpenZeppelin 5.6.1, solc 0.8.36+commit.8a079791.Emscripten.clang, EVM cancun, bytecode sha256 `dcad730b48b944ad5e8bd3ced1d10fba7a191917a039eac4f6824405b2c19249`. The artifact is the one this repository compiles from OpenZeppelin's source (contracts/ERC7913WebAuthnVerifier.json), deployed on 1 November (docs/runs/passkey-owners.json). This run did not deploy it or compare the deployed code with it.

## The owners

| Role | Passkey label | Fingerprint | Enrolled | Device |
| --- | --- | --- | --- | --- |
| CFO | max | C5A6-CBEE-8AED-3B33 | 2026-11-12T13:42:41.634Z | iPhone (Face ID) (as stated by the owner) |
| second approver | test-controller | 7CB5-8D76-24F1-9D0F | 2026-11-12T13:43:17.844Z | virtual test passkey: Chromium's virtual authenticator driven by docs/runs/driver/test-controller.ts; not a person's device; a device description was stated for this owner and is not recorded: the label marks a virtual test passkey |

Attestation is none, so the device type cannot be proven: a device description here is the owner's statement, not a finding of this record. The rows show which enrolled passkey signed each approval, by its credential, and when. They do not show what kind of device holds a passkey.

## The steps, in the order of the audit rows

The terms hash is the SHA-256 of a proposal's terms (`terms_sha256`). The digest the passkeys sign is the account's own hash of the call, its sequence number and its deadline (its Execute digest). The runner relays an approved proposal as one call to the account that carries both signatures (`executeSigned`); the account checks them itself.

| # | When (UTC) | Step | Outcome | Transaction |
| --- | --- | --- | --- | --- |
| 1 | 2026-11-12T13:43:26.980Z | create the passkey account (two passkey owners, threshold 2)<br>block 26124763; 431996 gas | **done** | [`0xf5ebbba9…7fdc79`](https://testnet.metalntwx.com/tx/0xf5ebbba94f42ed0a0d7f1fdf51f4d0d51b1889eb4d8fa0db37e8f608a87fdc79) |
| 2 | 2026-11-12T13:43:29.891Z | fund the passkey account with 0.60 test USD<br>block 26124795; 62991 gas | **done** | [`0x74e8a462…5ba18c`](https://testnet.metalntwx.com/tx/0x74e8a46282c971b3497b6a9917882cb33fdad44837597897a9c9a508925ba18c) |
| 3 | 2026-11-12T13:43:37.220Z | propose P-0001: bind the sourcing mandate: up to 0.05 a payment, 0.50 in all, Stockline only<br>terms hash 5bc3f77ccf403a6395de139f2c8c1b99633a0d45418d06deb6571d766ad8763e; the digest the passkeys sign 0x7f772a9269c443be364bc28a528579bd51c0f3c9c8e0d0d60d5ee7b9f80bfe86; to be signed by 2026-11-12T13:58:37Z | **filed** |  |
| 4 | 2026-11-12T13:44:27.057Z | the owners sign P-0001<br>max (passkey C5A6-CBEE-8AED-3B33) at 2026-11-12T13:44:11.972Z; test-controller (virtual test passkey 7CB5-8D76-24F1-9D0F) at 2026-11-12T13:44:27.057Z | **2 of 2 approvals** |  |
| 5 | 2026-11-12T13:44:27.261Z | the runner relays P-0001 to the account<br>the account ran it: bind the sourcing mandate | **executed** | [`0x168c6579…2a8c2d`](https://testnet.metalntwx.com/tx/0x168c657909460959b0444f05db2e7c03728435311ac059415d3504ef7b2a8c2d) |
| 6 | 2026-11-12T13:44:46.818Z | the Sourcing agent pays 0.05 to Stockline inside the mandate<br>the Sourcing agent's mandate key alone; no owner signed | **paid** | [`0x053d2b7c…d7c861`](https://testnet.metalntwx.com/tx/0x053d2b7ce158a197e83d5c2ee143e3d9195ea4c6e7f1c5c194aba4130cd7c861) |
| 7 | 2026-11-12T13:44:54.651Z | 0.06 to Stockline, over the mandate's 0.05 cap<br>Metal's reason: mandate\_cap\_exceeded (the amount is above the mandate's per-payment cap) | **refused on chain** | [`0xe6d9c7ea…585df4`](https://testnet.metalntwx.com/tx/0xe6d9c7eab36bb2c3af40269aa2e605982f3aa3d78a93a94d13b62ef96b585df4) |
| 8 | 2026-11-12T13:45:02.337Z | propose P-0002: replace the sourcing mandate: cap 0.05 → 0.10, budget 0.50 (unchanged), Stockline only<br>terms hash 345e9c38733e5f2721334bafa0d0bca0267350ecd2529852c1d18dda9fbf3455; the digest the passkeys sign 0xa93682fb43111c4c9b4850b50f54fc1f1946670228fb05fdcb273db4a64b107d; to be signed by 2026-11-12T14:00:02Z | **filed** |  |
| 9 | 2026-11-12T13:53:14.655Z | the owners sign P-0002<br>max (passkey C5A6-CBEE-8AED-3B33) at 2026-11-12T13:52:16.119Z; test-controller (virtual test passkey 7CB5-8D76-24F1-9D0F) at 2026-11-12T13:53:14.655Z | **2 of 2 approvals** |  |
| 10 | 2026-11-12T13:53:14.670Z | the runner relays P-0002 to the account<br>the account ran it: replace the sourcing mandate | **executed** | [`0xb6eff587…dd315d`](https://testnet.metalntwx.com/tx/0xb6eff587c71ddec3014503364135c5072c6e1a1315df5abf52d26e554ddd315d) |
| 11 | 2026-11-12T13:53:27.079Z | the Sourcing agent pays 0.06 to Stockline: the amount Metal refused before, under the mandate P-0002 bound<br>the Sourcing agent's mandate key alone; no owner signed | **paid** | [`0x1add0f46…3adcce`](https://testnet.metalntwx.com/tx/0x1add0f462da3cf0a1e60666a78df7777fed1dc2ac7c1ea397ac4ecd4c53adcce) |
| 12 | 2026-11-12T13:53:33.274Z | propose P-0003: revoke the sourcing mandate: it ends the mandate that allowed up to 0.10 a payment, 0.50 in all, Stockline only<br>terms hash 5d6e5789b3ac30fcc3b45a65f7c75f17e25d1ddf209c410490e0c348738c4366; the digest the passkeys sign 0xd3d30d9ad660be9a39a8384acb04b87f037d5c9ade7d4bb5f6456d5fc516f716; to be signed by 2026-11-12T14:08:33Z | **filed** |  |
| 13 | 2026-11-12T13:54:28.143Z | the owners sign P-0003<br>max (passkey C5A6-CBEE-8AED-3B33) at 2026-11-12T13:54:15.078Z; test-controller (virtual test passkey 7CB5-8D76-24F1-9D0F) at 2026-11-12T13:54:28.143Z | **2 of 2 approvals** |  |
| 14 | 2026-11-12T13:54:28.158Z | the runner relays P-0003 to the account<br>the account ran it: revoke the sourcing mandate | **executed** | [`0xd3bf7e0d…e29f3e`](https://testnet.metalntwx.com/tx/0xd3bf7e0df56fc267ff071fdbe2356ccd9270fb62585dbf31b0c9fef8b3e29f3e) |

## Refused, then paid

0.06 to Stockline:
1. 2026-11-12T13:44:54.651Z: refused on chain under the 0.05 cap of P-0001 (mandate\_cap\_exceeded (the amount is above the mandate's per-payment cap)) [`0xe6d9c7ea…585df4`](https://testnet.metalntwx.com/tx/0xe6d9c7eab36bb2c3af40269aa2e605982f3aa3d78a93a94d13b62ef96b585df4)
2. 2026-11-12T13:53:14.670Z: both owners signed P-0002, and the account ran it: replace, cap 0.05 → 0.10 [`0xb6eff587…dd315d`](https://testnet.metalntwx.com/tx/0xb6eff587c71ddec3014503364135c5072c6e1a1315df5abf52d26e554ddd315d)
3. 2026-11-12T13:53:27.079Z: paid under the 0.10 cap of P-0002 [`0x1add0f46…3adcce`](https://testnet.metalntwx.com/tx/0x1add0f462da3cf0a1e60666a78df7777fed1dc2ac7c1ea397ac4ecd4c53adcce)

## The proposals

### P-0001: bind (EXECUTED)

- filed 2026-11-12T13:43:37.220Z; to be signed by 2026-11-12T13:58:37Z
- terms hash `5bc3f77ccf403a6395de139f2c8c1b99633a0d45418d06deb6571d766ad8763e`
- the digest the passkeys sign `0x7f772a9269c443be364bc28a528579bd51c0f3c9c8e0d0d60d5ee7b9f80bfe86`
- up to 0.05 a payment, 0.50 in all
- approval 1 of 2: max, the CFO, passkey C5A6-CBEE-8AED-3B33, at 2026-11-12T13:44:11.972Z
- approval 2 of 2: test-controller (virtual test passkey), the second approver, passkey 7CB5-8D76-24F1-9D0F, at 2026-11-12T13:44:27.057Z
- run by the account in [`0x168c6579…2a8c2d`](https://testnet.metalntwx.com/tx/0x168c657909460959b0444f05db2e7c03728435311ac059415d3504ef7b2a8c2d)

### P-0002: replace (EXECUTED)

- filed 2026-11-12T13:45:02.337Z; to be signed by 2026-11-12T14:00:02Z
- terms hash `345e9c38733e5f2721334bafa0d0bca0267350ecd2529852c1d18dda9fbf3455`
- the digest the passkeys sign `0xa93682fb43111c4c9b4850b50f54fc1f1946670228fb05fdcb273db4a64b107d`
- up to 0.10 a payment, 0.50 in all (before: 0.05 a payment, 0.50 in all)
- approval 1 of 2: max, the CFO, passkey C5A6-CBEE-8AED-3B33, at 2026-11-12T13:52:16.119Z
- approval 2 of 2: test-controller (virtual test passkey), the second approver, passkey 7CB5-8D76-24F1-9D0F, at 2026-11-12T13:53:14.655Z
- run by the account in [`0xb6eff587…dd315d`](https://testnet.metalntwx.com/tx/0xb6eff587c71ddec3014503364135c5072c6e1a1315df5abf52d26e554ddd315d)

### P-0003: revoke (EXECUTED)

- filed 2026-11-12T13:53:33.274Z; to be signed by 2026-11-12T14:08:33Z
- terms hash `5d6e5789b3ac30fcc3b45a65f7c75f17e25d1ddf209c410490e0c348738c4366`
- the digest the passkeys sign `0xd3d30d9ad660be9a39a8384acb04b87f037d5c9ade7d4bb5f6456d5fc516f716`
- ends the mandate that allowed up to 0.10 a payment, 0.50 in all
- approval 1 of 2: max, the CFO, passkey C5A6-CBEE-8AED-3B33, at 2026-11-12T13:54:15.078Z
- approval 2 of 2: test-controller (virtual test passkey), the second approver, passkey 7CB5-8D76-24F1-9D0F, at 2026-11-12T13:54:28.143Z
- run by the account in [`0xd3bf7e0d…e29f3e`](https://testnet.metalntwx.com/tx/0xd3bf7e0df56fc267ff071fdbe2356ccd9270fb62585dbf31b0c9fef8b3e29f3e)

## Calls

36 of the 60 calls agreed were used (24 left). A cli:<command> line is one whole run of the metal-agent CLI; the requests it makes inside are not counted.

| Method | Lines |
| --- | --- |
| `eth_call` | 9 |
| `eth_getTransactionCount` | 5 |
| `eth_getTransactionReceipt` | 5 |
| `eth_sendRawTransaction` | 5 |
| `eth_estimateGas` | 4 |
| `cli:mandate pull` | 3 |
| `eth_getCode` | 3 |
| `cli:fund` | 1 |
| `eth_chainId` | 1 |

| Step | Requests | CLI runs |
| --- | --- | --- |
| preflight | 2 | 0 |
| setup | 12 | 1 |
| propose | 1 | 0 |
| execute P-0001 | 4 | 0 |
| pay | 1 | 3 |
| propose-replace | 1 | 0 |
| status | 2 | 0 |
| execute P-0002 | 4 | 0 |
| propose-revoke | 1 | 0 |
| execute P-0003 | 4 | 0 |

## Deviations

- none stated

No deviations file was given (OWNERS_DEVIATIONS): none are stated here, which is not the same as none happened.
