# Claims and their proof

Every number and factual claim on the public pages, in the film, the video script, the README and compliance.md, with
where it comes from. Checked on 30 October 2026 by two independent read-only audits:
- 191 claims on the pages;
- 200 claims in the written materials.

What could not be proven was removed or softened (the "Changed" column, and the list at the end). There is no slide
deck in the repo.

Sources:
- **Recording:** the recorded run (Friday run 1, 30 October, with the Dispute desk case afterwards): `docs/demo/story.json`, `docs/demo/snapshot.json` and `docs/demo/metal.json`, recorded by `npm run demo:record`.
- **Red team:** `docs/redteam/report.json`.
- **Lab:** `docs/lab/results.json`.
- **Run logs:** `docs/runs/`.

## The recorded run (landing, dashboard, /live, film)

| Claim | Value | Proof | Changed |
|---|---|---|---|
| Payments the agents made alone, inside their limits | 106 | snapshot `counts.alone` (50 sales, 50 purchases, 3 refunds, 1 sweep, 2 card charges) | |
| Stops by the card, the chain, the fraud checks or the CFO | 8 | snapshot `counts.blocked`: 1 chain refusal, 2 card declines, 2 fake invoices, 2 planted instructions, 1 refund batch the CFO rejected | Was 9: one document flagged twice is now counted once; the label no longer says "attempts blocked before money moved". |
| Money kept out for good | €3,719.99 | snapshot `money.blocked_eur`: 2 invoices (€3,700) and the €19.99 decline at the wrong kind of shop; the €45.00 decline was paid after the raise | Was "Stopped in time €3,764.99". |
| Decisions signed with Face ID | 4 | snapshot `proof.face_id`: 3 approvals and 1 rejection by passkey | The demo's audit step counts the 3 approvals; both say which. |
| Fake invoices and AI tricks stopped | 2 + 2 | snapshot `proof.fake_invoices`, `proof.ai_tricks` (distinct documents) | Was 2 + 3. |
| Card limit raise | €30 → €50, P-0005, Face ID | story `card` | |
| Declines by Airwallex | `LIMIT_EXCEEDED` €45.00; `MERCHANT_CATEGORY_NOT_ALLOWED` €19.99 | story `card`; each re-read from the sandbox API (below) | "by the bank itself" is now "by Airwallex itself". |
| Price rise refused on chain | 0.04 over the 0.03 cap, `mandate_cap_exceeded`, nothing moved | story `refused`; metal.json mandates | |
| Mandates replaced after Face ID | P-0002, `0x2909b164…8aed`, `0xbc70858f…b5d7` | story `faceid`; on chain (below) | |
| Euro bill | €1,850.00 by SWIFT; USD 418.40 → EUR 370.00; fee €13.41 (ceiling €20.00) | story `swift`; conversion and transfer re-read from Airwallex | PAID is now said to be set by the sandbox's simulation. |
| Metal earnings at Airwallex | 1.35, after finality (block 9401051, final 9401068) | metal.json `finality`; deposit `56366c9d…` SETTLED | Now said to be a simulated sandbox deposit that names the testnet transaction. |
| Dispute desk | 12 of 12 orders signed and inside the bound mandate; not refunded | metal.json `dispute` | Now says that orders 7, 10 and 13 had already been refunded for wrong data, and that Opus's recorded explanation overlooks this. |
| Audit log | 194 rows, hash chain intact | story `audit` | |
| Claude cost | $0.093 per €1,000 paid | snapshot `claude.per_1000_eur_usd_micros` | "Per Claude decision" is now "Per Claude call". |
| Euros at Airwallex | 9,992,226.11 (sandbox test money); reserve €25,000 | snapshot `treasury.airwallex.eur` | Was "Euros on hand €25,000"; the demo plan's set-aside amount is now explained. |

## Proof links (checked read-only, 30 October)

| What | Result |
|---|---|
| Metal transactions linked on the public pages and in the dossier | 60 of 60 exist and succeeded on chain (`eth_getTransactionReceipt`). |
| Key transfers decoded (USDZ `Transfer` logs) | 3 refunds of 0.05 to Summit's account; sweep of 1.35 to the sweep wallet; first sale 0.05 to Northwind; first purchase 0.02 to Stockline; order 5 paid 0.05; quarantined 0.02 returned to its sender; clearing deposit 5.00 and claim 0.70. All match. |
| Airwallex card transactions | All 4 found by `card_transaction_id` with the recorded amount and result: 2 approved, `LIMIT_EXCEEDED`, `MERCHANT_CATEGORY_NOT_ALLOWED`. |
| Airwallex conversion, transfer, deposit | Conversion `08736b6e…` 418.40 → 370.00 SETTLED. Transfer `4d508b0b…` 1,850 PAID. Deposit `56366c9d…` 1.35 SETTLED, with the sweep tx as reference. |

The pages no longer say the Airwallex web app shows these ids. The ids are the ones the API returns; which one the web app
displays was not checked.

## Controls and tests

| Claim | Value | Proof | Changed |
|---|---|---|---|
| Red team | 39 of 39 blocked, 0 inconclusive: 35 scripted attacks and 4 documents written by Claude Opus as the attacker, in a throwaway test world | `docs/redteam/report.json` (30 Oct) | The harness now gives every attempt an outcome, and inconclusive never counts as blocked. The task card is tested at a hotel while still fresh (`MERCHANT_CATEGORY_NOT_ALLOWED`). The revoked agent is named correctly. The film's "thirty-four" is now thirty-nine. |
| Duplicate invoices | A paid invoice sent again as "btx-dup" or with an en dash is refused | `test/invoice-duplicate-key.test.ts`; red team document 4 | Found by the red team and fixed. |
| Scenario Lab | 18 of 18 as expected | `docs/lab/results.json` | hardening.md said 12. |
| Tests | 795 in 100 files | `npx vitest run` | |
| Speed limit (Operations agent) | 30 payments a minute, 4.00 test USD an hour | `src/config/policy.ts` `VELOCITY` | Kept on purpose, above the busiest minute of the recorded run (18). |
| Hidden card payment | Found by the reconciliation within the hour, not prevented | `src/ops/health.ts` `RECONCILE_EVERY_MS`; red team `hidden-payment` | Was daily. The runner now reconciles every hour, and an alarm fires after three missed rounds. |
| Four eyes | Optional, off in the recorded run | `src/policy/fourEyes.ts` | Was "Above your threshold, two different people approve". |
| Emergency stop | Stops every agent payment and freezes every card at Airwallex | `test/freeze.test.ts`; Lab scenario | Now says it is tested against stand-ins and not yet run live. |
| Task cards (Ask Purser) | Issued at once within the CFO's policy (up to €300, 3 a day, asked at the runner); otherwise after Face ID | `src/agents/askPurser.ts`, `src/policy/rules.ts` | The README and the film said "after Face ID" or "anything new waits for Face ID". /live no longer shows Face ID for it. |

## Things that happened in separate live runs, not in the recorded one

| Feature | Run | Said where |
|---|---|---|
| Pay-per-call clearing | Separate run, 29 October (`docs/runs/2026-10-29-clearing.md`) | /metal card and comparison table, film, metal-award.md |
| Receive policy and quarantine | Separate world, 30 October (`docs/metal-award.md` section 5) | /metal card, /live scene source, compliance.md |
| Ask Purser single-use card | On a backup of Friday run 2 (`docs/runs/2026-10-30-single-use.md`) | /live scene source, film footer |
| Receivables on Global Accounts | On a copy of the recorded ledger (`docs/runs/2026-10-30-receivables.md`) | Run log, docs/airwallex.md |

## The video

| Claim | Proof | Changed |
|---|---|---|
| $3,046,598,558 in business email compromise losses | FBI IC3, 2025 Internet Crime Report (April 2026) | Now "reported by victims to the FBI". |
| Pace | `docs/video/script.md` computes words per minute from the words; the hybrid script is about 440 words in 3:55 | Was "about 115" and "about 120". |

## Removed or softened after the audits (summary)

**Landing and dashboard**
- "only your Face ID moves money" → "only your Face ID can move money beyond the agents' limits".
- "Nothing an AI says can move money" → "Nothing an AI reads or writes can raise a limit or move money outside it".
- "Purser holds no money" → "holds no funds of its own", noting that the runner keeps the testnet owner key.
- "re-checkable from public sources" → the chain and signatures from public sources, the Airwallex bookings with read-only keys.
- "thousands of tiny payments" → "payments of a few cents each".
- Internal agent ids (sourcing, support, treasury) are replaced by the agents' names on every public page and in refusal reasons.

**Written materials**
- **compliance.md:** Airwallex's KYC and screening are its own, not shown here; agent cardholders carry placeholder details in the sandbox; reconciliation is hourly; the scope of `npm run verify` is stated exactly.
- **airwallex.md:** `GET /fx/rates/current` and `POST /beneficiaries/schema` are called; a bank-detail change needs four eyes at any amount once four eyes is on; fees ranged from €13.40 to €13.47.
- **metal-award.md:** the clearing customer was a test account in the rehearsal-3 world, not Summit; clearing sales did run after P-0009; the sweep-wallet allowlist was live in a separate world.
