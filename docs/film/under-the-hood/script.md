# Purser, under the hood (3:28)

Built by `npm run film-uth` from `src/film/uth.ts`; every figure on screen is read from its record at build time. Test money only. This build has no voice (captions only); the narrator for the voiced build: Ian (ElevenLabs voice library): professional, warm, calm (an AI voice).

| At | Scene | Narration (and the captions) | On screen |
|---|---|---|---|
| 0:00 | u01 · The question | An AI agent can pay a supplier. So who signs the terms, and how can anyone check it later? | card |
| 0:09 | u02 · The terms, hashed | Every payment becomes one set of terms: the payee, the account, the amount, the exchange-rate quote and a deadline. Purser writes them as canonical JSON and takes its SHA-256. This is the real hash from a run on the live demo. | try-walk 4.9–8.9 s + try-walk 23.1–29.4 s + card |
| 0:33 | u03 · The passkey signs the hash | That hash is the WebAuthn challenge. The CFO's passkey signs it after Face ID, and the flags say so: user present, user verified. The browser binds the signature to Purser's own domain, so a lookalike site gets nothing it can use. A PIN, a code or a click can be phished; this cannot. | card + try-walk 32.1–40.3 s · Recorded with a virtual test passkey (a browser authenticator with user verification), not a person's Face ID. |
| 1:03 | u04 · One cent | Change one cent and the terms hash to something else entirely. The signature no longer matches, so nothing moves: zero transfers. Send the paid terms again, and the executor refuses to pay twice. | try-walk 40.9–48.1 s + card |
| 1:29 | u05 · At Airwallex | The exchange-rate quote inside the signed terms is a live quote from Airwallex's sandbox, by its id. In the main run, the transfer Airwallex made carries the hash the CFO approved, in its own metadata, and Purser reads it back and compares. Then every money flow was reconciled to the cent against Airwallex and the chain: no differences. | card |
| 2:01 | u06 · The card's own limit | Agents also pay by card. When a charge goes over the card's limit, Airwallex itself declines it, whatever the agent asks. | card |
| 2:16 | u07 · The audit log, anchored | Every step lands in an audit log where each row hashes the one before. Its head is written into a transaction on Alta, formerly Metal, on testnet. Anyone can recompute it from the repository: verify-anchor prints match. | card |
| 2:40 | u08 · The numbers | Only measured numbers. In the main run: 24 decisions by Claude, 86 payments on Alta within the limits, 5 signatures with Face ID, and nothing paid over a limit. And 6,932 tests pass. | card |
| 3:00 | u09 · An agent's own card | A second use: each agent has its own card for the software it buys, with limits the CFO sets. The CFO can freeze a card with Face ID from Purser Cloud. | cloud-agents 0.0–10.0 s + card |
| 3:18 | u10 · Close | Agents act. People sign the exact terms. Every step can be checked. Try it yourself. | card |

## Sources

- The live /try walk, 2026-11-15T02:55:24.726Z: `docs/film/under-the-hood/record.json` (npm run record-uth): the terms' SHA-256 `349ff1a972a2afebd8d2e76d6547d2364ecf631d82ce534f676d196c4ddfa6d1`, the passkey's assertion (challenge = that hash, flags 0x05), the one-cent refusal (`f1cc698af83db4486838c9f716da7ba0cf0ed75b6c8f08b48883c1bbc0b477ea`), the replay (paid once). Recorded with a virtual test passkey, not a person's Face ID.
- The Airwallex transfer of the main run (3 Nov), read back with GET only on 2026-11-06: `docs/runs/airwallex-transfer-approval-2026-11-06.json`; P-0005's passkey approval with the same hash: `docs/demo/main-run.json`.
- The reconciliation (88 money flows, no differences) and the main-run figures (24 decisions by Claude, 86 Alta payments within the limits, 5 Face ID signatures, 16 stops and nothing paid over a limit): `docs/demo/main-run.json`, `docs/claims.md`.
- The card decline (recorded, awx-1, 7 Nov): `docs/demo/airwallex-run.json`, card transaction `01a1b5e8-6dc2-7000-95bf-c8fc5e6e2f38`.
- The anchor: `2026-11-13-anchor.json`, checked live by `npm run verify-anchor` (output in `docs/film/under-the-hood/verify-anchor.txt`).
- The test count (6932): README.md.
- The Purser Cloud clip: the demo company's Agents tab as a guest (made-up data, read only).
