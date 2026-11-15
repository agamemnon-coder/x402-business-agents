# Purser, under the hood (4:35)

Built by `npm run film-uth` from `src/film/uth.ts`; every figure on screen is read from its record at build time. Test money only. This build has no voice (captions only); the narrator for the voiced build: Ian (ElevenLabs voice library): professional, warm, calm (an AI voice). Music: an AI-generated instrumental (ElevenLabs), out/video/v10/music-292.mp3.

| At | Scene | Narration (and the captions) | On screen |
|---|---|---|---|
| 0:00 | a01 · What Purser is | Purser lets AI agents pay a company's supplier invoices, but only within limits the CFO signs. It is built on Airwallex. Everything you see runs in its sandbox, with test money. | card |
| 0:13 | a02 · Live on /try | An agent reads the invoice and checks it: not paid before, bank details on file, a known supplier. Within the CFO's limits, the agents pay alone: 87 payments in the main run, with no approval needed. Above them, the CFO signs the exact terms with Face ID. Then it is paid, booked and filed. | try-walk 5.1–7.6 s + try-walk 13.2–16.8 s + try-walk 21.6–25.0 s + try-walk 30.0–38.8 s + card |
| 0:41 | a03 · Under the hood | So how can anyone check that the CFO signed exactly this, and nothing else? Here is what happens under the hood. | card |
| 0:51 | u02 · The terms, hashed | Every payment becomes one set of terms: the payee, the account, the amount, the exchange-rate quote and a deadline. Purser writes them as canonical JSON and takes its SHA-256. This is the real hash from the run you just saw. | card |
| 1:08 | u03 · The passkey signs the hash | That hash is the WebAuthn challenge. The CFO's passkey signs it after Face ID, and the flags say so: user present, user verified. The browser binds the signature to Purser's own domain, so a lookalike site gets nothing it can use. A PIN, a code or a click can be phished; this cannot. | card · Recorded with a virtual test passkey (a browser authenticator with user verification), not a person's Face ID. |
| 1:31 | u04 · One cent | Change one cent and the terms hash to something else entirely. The signature no longer matches, so nothing moves: zero transfers. Send the paid terms again, and the executor refuses to pay twice. | try-walk 39.4–46.6 s + card |
| 1:57 | u04v · Verify it yourself | Don't take our word for it. The finish hands over a proof file. Drop it on the verify page: your browser checks the hash, the passkey's signature and the ledger, and all 10 checks pass. Change one cent in the file, and the hash, the challenge and the decision fail. | verify 0.2–8.0 s + verify 9.7–16.5 s |
| 2:11 | u05 · At Airwallex | The exchange-rate quote inside the signed terms is a live quote from Airwallex's sandbox, by its id. In the main run, the transfer Airwallex made carries the hash the CFO approved, in its own metadata, and Purser reads it back and compares. Then every money flow was reconciled to the cent against Airwallex and the chain: no differences. | card |
| 2:43 | u06 · The card's own limit | Agents also pay by card. When a charge goes over the card's limit, Airwallex itself declines it, whatever the agent asks. | card |
| 2:58 | u07 · The audit log, anchored | Every step lands in an audit log where each row hashes the one before. Its head is written into a transaction on Alta, formerly Metal, on testnet. Anyone can recompute it from the repository: verify-anchor prints match. | card |
| 3:22 | u08 · The numbers | Only measured numbers. In the main run: 24 decisions by Claude, 86 payments on Alta within the limits, 5 signatures with Face ID, and nothing paid over a limit. And 6,932 tests pass. | card |
| 3:42 | u08s · The worst-case AI test | The worst-case test: Purser's AI replaced by a script that always says pay, on 50 hostile and clean invoices, run twice. No wrong payment, and nothing paid past the CFO. A payer with no rules made 35 wrong payments a run. Even an AI that always says pay can't make Purser pay wrongly. | card |
| 4:04 | u09 · An agent's own card | A second use: each agent has its own card for the software it buys, with limits the CFO sets. The CFO can freeze a card with Face ID from Purser Cloud. | cloud-agents 0.0–10.0 s + card |
| 4:22 | u10 · Close | Purser: AI agents pay the bills, the CFO signs the exceptions, and every step can be checked. Built on Airwallex, with test money only. Try it yourself. | card |

## Sources

- The live /try walk, 2026-11-15T04:26:28.221Z: `docs/film/under-the-hood/record.json` (npm run record-uth): the terms' SHA-256 `58b8dd275759f5cfb02e02779a7e3c411746d09d824197913f99ef7d5c666ead`, the passkey's assertion (challenge = that hash, flags 0x05), the one-cent refusal (`9c3a593ce3d5d700aae54b028b2e9821ca187548b1be7a91a3a8f7d93b7a4740`), the replay (paid once). Recorded with a virtual test passkey, not a person's Face ID.
- The Airwallex transfer of the main run (3 Nov), read back with GET only on 2026-11-06: `docs/runs/airwallex-transfer-approval-2026-11-06.json`; P-0005's passkey approval with the same hash: `docs/demo/main-run.json`.
- The reconciliation (88 money flows, no differences) and the main-run figures (24 decisions by Claude, 86 Alta payments within the limits, 5 Face ID signatures, 16 stops and nothing paid over a limit): `docs/demo/main-run.json`, `docs/claims.md`.
- The card decline (recorded, awx-1, 7 Nov): `docs/demo/airwallex-run.json`, card transaction `01a1b5e8-6dc2-7000-95bf-c8fc5e6e2f38`.
- The anchor: `2026-11-13-anchor.json`, checked live by `npm run verify-anchor` (output in `docs/film/under-the-hood/verify-anchor.txt`).
- The test count (6932): README.md.
- The Purser Cloud clip: the demo company's Agents tab as a guest (made-up data, read only).
