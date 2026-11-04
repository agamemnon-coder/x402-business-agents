# Claims and their proof

Every number and factual claim on the public pages, in the film, the video script, the README and compliance.md, with
where it comes from. Checked on 30 October 2026 by two separate read-only audits by fresh reviewers:
- 191 claims on the pages;
- 200 claims in the written materials.

What could not be proven was removed or softened (the "Changed" column, and the list at the end). The submission
pack's own sentences, including the deck's, are in "The submission pack" below.

Sources:
- **Recording:** the recorded run (Friday run 1, 30 October, 07:05 to 07:38 UTC; the Dispute desk case ran afterwards, 08:32, on a copy of its ledger with later code): `docs/demo/story.json`, `docs/demo/snapshot.json` and `docs/demo/metal.json`, recorded by `npm run demo:record`.
- **Red team:** `docs/redteam/report.json`.
- **Lab:** `docs/lab/results.json`.
- **Run logs:** `docs/runs/`.
- **Main run (3 November):** `docs/runs/2026-11-03-main-run.md`, its data-qa report, and the record `docs/demo/main-run.json` (the run the pages play since 3 November).

## The recorded run (landing, dashboard, /live, film)

| Claim | Value | Proof | Changed |
|---|---|---|---|
| Payments inside the limits with no person needed | 106 | snapshot `counts.alone`: 56 by Northwind's agents (50 purchases, 3 refunds, 1 sweep, 2 card charges) and 50 stock checks the customer's agent bought from us | The label says about half are the customer's agent. |
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
| Dispute desk | 12 of 12 orders signed and verified against the chain with the signed order the seller keeps; not refunded. Summit is a simulated customer; we filed the claim on its behalf | metal.json `dispute` | Now says that orders 7, 10 and 13 had already been refunded for wrong data, and that Opus's recorded explanation overlooks this (also in the report the customer gets). "Hash matches" is now "as Northwind recorded it": it is not proof the data was right. |
| Audit log | 194 rows, hash chain intact (the run and the dispute case afterwards) | story `audit` | |
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
| Red team | 39 of 39 failed, 0 inconclusive: 37 stopped before anything moved, 2 found afterwards (a hidden card charge by the reconciliation, a rewritten log row by `npm run verify`); 35 scripted attacks and 4 documents written by Claude Opus as the attacker, in a throwaway test world (30 Oct). Then three runs in a row on 31 Oct: 118 of 120 failed, 2 inconclusive (bank-change notices the classifier read as data corrections: nothing was paid or changed, but not counted as stopped; [runs](runs/redteam-2026-10-31/README.md)) | `docs/redteam/report.json` (30 Oct; `caught` per attempt) | The harness now gives every attempt an outcome, and inconclusive never counts as blocked. The task card is tested at a hotel while still fresh (`MERCHANT_CATEGORY_NOT_ALLOWED`). The revoked agent is named correctly. The film's "thirty-four" is now thirty-nine. |
| Duplicate invoices | A paid invoice sent again as "btx-dup" or with an en dash is refused | `test/invoice-duplicate-key.test.ts`; red team document 4 | Found by the red team and fixed. |
| Scenario Lab | 18 of 18 as expected | `docs/lab/results.json` | hardening.md said 12. |
| Tests | 2256 in 244 files, all passing (4 Nov, tag v1.0-submission) | `npx vitest run` | Was 1074 in 136 files (31 Oct). |
| `/try/sign`: "Try it yourself: sign with your own Face ID" | A test world per visitor for one hour, with stand-in executors (nothing reaches Airwallex or Metal) and fixed-text proposals (no model call); its own store (Durable Object instance `try-sign`, `ts_*` tables), apart from the CFO's. Real: the visitor's passkey signature over the SHA-256 of the canonical terms, and the Worker's check with the D20 verifier against the public key the visitor's device registered. Not proven: which authenticator made the key (attestation "none": a software key verifies too), so the page never says the server proved Face ID. A test passkey is not enrolled anywhere else, so it approves nothing real and opens no session. Behind `TRY_SIGN_ENABLED`; **live since 4 November 2026** (the Worker deploy of commit `852b323`, flag on) at https://kit11.max-31b.workers.dev/try/sign | `worker/src/trySign.ts`; `test/try-sign.test.ts`, `test/try-sign-separation.test.ts`; `test/browser/trysign.check.ts` (390 and 1440 px, light and dark; with `--live` against the hosted site, green on 4 November: passkey made, the waiting proposal signed and verified, the tampered amount refused, the blocked one without a button) | New, 4 November |
| `/health` for anyone | Between live runs (no runner sync for 30 minutes and no live run declared with the Worker variable `LIVE_RUN`): 200, "Recorded demo · the live runner runs during live runs", with the alarm codes that stood at the runner's last sync. During a live run: 503 on `runner_down` or any alarm, as before. `/health/live` is that alarm at all times, for a monitor and the CFO | `src/ops/publicHealth.ts` (`publicStatus`, `LIVE_RUN_EXPECTED_MS`); `test/health.test.ts` | New, 4 November; live with the next deploy (until then `/health` answers 503 `runner_down` whenever the runner is off) |
| Speed limit (Sourcing agent) | 30 payments a minute, 4.00 test USD an hour | `src/config/policy.ts` `VELOCITY` | Kept on purpose, above the busiest minute of the recorded run (18). |
| Hidden card payment | Found by the reconciliation within the hour, not prevented | `src/ops/health.ts` `RECONCILE_EVERY_MS`; red team `hidden-payment` | Was daily. The runner now reconciles every hour, and an alarm fires after three missed rounds. |
| Four eyes | "Four eyes on chain: two signatures required (second approver = a labelled test passkey in this demo)". In agent run 1 (2 Nov) the mandate change P-0003 was signed by Max with Face ID and then by the test-controller, a labelled test passkey (`docs/demo/agent-run.json` `decisions[].by`); P-0001 set four eyes above EUR 1,000. Second approver: a labelled test passkey in this demo. In production this is a second person. | `src/policy/fourEyes.ts`, `docs/runs/2026-11-02-agent-run-1.md` | Was "Optional, off in the recorded run" (2 Nov). |
| Four eyes on chain | A 2-of-2 Metal account (CFO + controller): the CFO's signature alone reverted on chain twice (a payment, a mandate revoke), and so did the CFO with a stranger's key; the CFO and the controller together passed. In a separate test world; Northwind's recorded account is one-owner | `docs/runs/2026-10-30-four-eyes.md`; `test/four-eyes-onchain.test.ts` | New (30 Oct). |
| Emergency stop | Stops every agent payment and freezes every card at Airwallex | `test/freeze.test.ts`; Lab scenario | Now says it is tested against stand-ins and not yet run live. |
| Airwallex webhooks | Subscribed to 23 events since 30 October (Max's go): card transactions, cards, payouts, conversions (not `conversion.overdue`: no permission) and deposits. Shown live: two deposits matched or escalated by the webhook alone, and a card transaction. Payout, conversion and card status events: subscribed, not yet caused live; covered by tests | `docs/runs/2026-10-30-webhooks.md`; `test/airwallex-events.test.ts` | Was "card transactions only". The pages show the webhook panel only when events exist; the recording has none. |
| Data QA | Every payment in the recorded run, up to audit row 194, checked read-only against Airwallex, Metal testnet and the Books: 119 payments, 233 of 233 checks matched, none skipped | `docs/data-qa.md` (`npm run data-qa`); `test/data-qa.test.ts` | New (31 Oct). |
| Which Claude model for which job | On the agents' 6 eval cases (3 runs each) every setup passed 18 of 18. On 5 harder documents (3 runs each): Purser's split 15 of 15 (USD 0.0116 a run), Sonnet alone 15 of 15 (USD 0.0159), Opus alone 15 of 15 (USD 0.0333), Haiku alone 14 of 15 (USD 0.0011; it folded the excluded order #9 into a disputed range). Shown as "Built with Claude, and measured" | `docs/model-benchmark.md` (`npm run model-bench`), `src/evals/hard.ts` | "Three models, each for what it does best" is gone: it was a design choice, not a measurement. |
| Task cards (Ask Purser) | Issued at once within the CFO's policy (up to €300, 3 a day, asked at the runner); otherwise after Face ID | `src/agents/askPurser.ts`, `src/policy/rules.ts` | The README and the film said "after Face ID" or "anything new waits for Face ID". /live no longer shows Face ID for it. |

## Things that happened in separate live runs, not in the recorded one

| Feature | Run | Said where |
|---|---|---|
| Pay-per-call clearing | Separate run, 29 October (`docs/runs/2026-10-29-clearing.md`) | /metal card and comparison table, film, metal-award.md |
| Receive policy and quarantine | Separate world, 30 October (`docs/metal-award.md` section 5) | /metal card, /live scene source, compliance.md |
| Ask Purser single-use card | On a backup of Friday run 2 (`docs/runs/2026-10-30-single-use.md`) | /live scene source, film footer |
| Receivables on Global Accounts | Live in the sandbox, on a copy of the recorded ledger after the run (`docs/runs/2026-10-30-receivables.md`): 2 matched, 1 short by 10.00 EUR, 1 with no invoice. Kept out of the recording so its balances, reconciliation and waiting items stay one consistent moment. | Run log, docs/airwallex.md |
| Four eyes on chain (2-of-2 account) | Separate test world, 30 October (`docs/runs/2026-10-30-four-eyes.md`) | /metal card, controls-matrix.md, metal-award.md, film |
| Compliance send policy | Separate test world, 30 October (`docs/runs/2026-10-30-compliance-policy.md`): 11 attacks reverted on chain, the sanctioned stand-in got no decision | /metal card, controls-matrix.md, compliance.md, metal-award.md, film |
| Finality certificates | 26 transactions of the two runs above, with certificates as Metal's RPC reported them (header, number and pinned quorum checked; BLS signature not verified). The recorded run's certificates had expired (nodes keep about 2 hours) | /metal card, controls-matrix.md, requirements-matrix.md X3 (🟠) |
| ISO 20022 pacs.008 export | Made from the recorded run's ledger (`docs/iso20022/pacs008-BTX-2026-11.xml`), valid against the official XSD; not sent to any bank | controls-matrix.md, metal-award.md |
| Clearing load test | Separate test world, 30 October (`docs/runs/2026-10-30-clearing-load.md`): 2,000 of 2,000 paid in 471.8 s (4.24 a second), p50 1.4 s, p95 8.1 s; about $0.0007 RPC per payment (estimate from Metal's published rates, not a bill). A first run paid 1,879: one wallet held by a lost answer, fixed by resending | /metal card, controls-matrix.md, metal-award.md |
| Runbook | Procedures say which were exercised live, tested, or not yet exercised; the full emergency stop has not been pulled live | `docs/runbook.md` |

## Built after the recording, not yet in a live run with Max

| Feature | Status | Proof | Said where |
|---|---|---|---|
| Kit 11's monthly licence fee in euros (EUR 240.00 in code, paid by the business at Airwallex by SWIFT) | **Main run (3 November): planned by the Treasury agent itself (P-0005), FX EUR 110.00 for the shortfall, PAID 6 s after Max's Face ID (transfer `03360bfa…`, fee EUR 13.42)**, see the main-run section. Earlier, **agent run 1 (2 November), after Max's Face ID:** P-0007, EUR 240.00 by SWIFT, Airwallex transfer `7bbb3d61-d9f3-4b8e-81cc-cc7cceb9c1df` PAID, fee EUR 13.37 (ceiling EUR 20.00). Before it, the Treasury agent's own plan P-0005 was refused by Airwallex's sandbox (400 `fee_unknown`, nothing paid) and its re-plan P-0006 expired unsigned; at 14:25 UTC it chose not to re-plan ("13 days remain"). Never say the Treasury agent paid it of its own accord | `docs/runs/2026-11-02-agent-run-1.md` ("The licence after the run"); `docs/demo/agent-run.json` and `docs/demo/agent-run-notes.json` (the flow's `decided`); `test/licence-fee.test.ts`; `npm run licence` | requirements matrix K1b (🟠: the paid one was not the agent's own choice), K5 (✅) |
| "Our agents sign their card checkouts at TAP merchants with Visa's Trusted Agent Protocol. Their signatures are accepted by Visa's public TAP reference verifier (pinned commit 16d59bd). The TAP merchant in this demo is run by us. Body integrity, tag and payment checks are our own layer on top." | **Technical claim: proven.** Award status (2 November, evening): "Entered for the Visa Award (organisers confirmed one project may enter both Visa and Metal; whether TAP counts as Visa tooling is still being confirmed with Visa)." Airwallex in #help first answered (1) "Yes", then changed (1) to "TBD" and added Visa to the thread; (2) stays "Yes" (Max; screenshot of the thread as it is now: `docs/evidence/2026-11-02-slack-visa-answer-tbd.png`). No page may say the organisers confirmed TAP counts as Visa tooling. Interop green in CI both ways (tap-interop, 21 cases, run 41425023628 on 96aa126); live TAP run 2 November in a fresh, separate test world (Visa's reference registry self-hosted with a test key; the TAP merchant is ours): the Sourcing agent (Claude Haiku) picked the card rail for the card-only merchant, Visa's unmodified reference proxy passed it (200), our layer verified both signatures, the agent's Airwallex card (brand as Airwallex returns it: VISA) was approved; an over-limit attempt was declined by Airwallex (LIMIT_EXCEEDED); both confirmed by read-only GET | `docs/runs/visa-tap-live-2026-11-02.json`; `.github/workflows/tap-interop.yml`; `test/interop/tap-interop.ts`; `docs/plans/d25-tap-design.md`; D25 in `docs/decisions.md` | /visa, landing, README, description, deck, video; matrix V1 (🟠, eligibility TBD), V2 (✅, TAP). **Main run, 3 November:** a TAP-signed card buy in the run's own world (our layer verified both signatures; Airwallex approved EUR 45.00 on card ····1423), see the main-run section |
| Kit 11's names, word for word: Sourcing agent, Support agent, Treasury agent; the Support agent's card pays helpdesk software | In code and on every page. The 30 October recording was made with the earlier names: its recorded data shows the Kit 11 names, and every page that plays it says so at the top. The live run with Max becomes the new recording | `test/kit11-names.test.ts` (fails if a guest can see an earlier name, or if the label is missing); `src/config/brand.ts` `RECORDING_NAMES_NOTE` | every page that shows the recording; decisions D14 |
| Posting the books to T:0 | Built and tested against a fake; tried on 2026-11-03 against a shared T:0 sandbox: reads work, the first POST was refused (403 CAPI71, the key lacks post permission), nothing posted | `docs/runs/2026-11-03-t0-sandbox.md`; `test/t0.test.ts` | nowhere public until it has posted and matched |
| Claude agents that decide inside their mandates: the Sourcing agent meets a price rise and tells Treasury, the Treasury agent designs the rebalance and the options, the Support agent refunds wrong sales itself and escalates the rest | **Shown in the main run with Max, 3 November** (24 of 24 by Claude, 0 fallbacks; section below), and before it in agent run 1 (rehearsal), 2 November. Before that: behind `KIT11_AGENTS=on`, 20 green autonomous dry runs | `docs/runs/2026-11-02-agent-run-1.md`; `docs/demo/agent-run.json`; `docs/runs/2026-11-01-soak.md` | landing, /watch, /claude, /proof |
| Autonomous agents (D19, behind `KIT11_AUTONOMY=on`): each agent its own process with a goal, tools and memory; we change the world (price rise, dispute, licence invoice, Packwise ending Starter, money in) and the agents decide; agents talk only by messages | Autonomous dry runs in fresh worlds on Metal testnet and the Airwallex sandbox (virtual passkeys, test identities), green from dry-97 to dry-102 (dry-96 failed; fixed), the last three with the whole world. dry-101: 0 fallbacks in 18 decisions; Sourcing asked the CFO for a card raise and bought Packwise Pro once it was approved; Treasury swept the money in. Not yet in a live run with Max | `docs/runs/2026-11-01-autonomy-dry-96-97.md` (dry-96 to dry-99), the dry-run logs; `npm run verify` passed in each; `npm run dashboard-vs-chain` 4 of 4 | `docs/internal/draaiboek-wereld-donderdag.md`; PR description. Say "in dry runs", never "live with Max", until Thursday |
| The variation test and the red team against the loop, with real Claude | 20 of 20 decided by Claude; 12 of 12 attacks held. **Not claimed (Max, 2 Nov):** the safety count is not claimed until sim-31's fix is merged and re-run; the 2 November batch's sim-31 reported 1 unsafe action, under review. Stand-in rails, one wake per run, the Sourcing agent (Haiku) only | `docs/agents-autonomy.md`, `docs/agents-autonomy-redteam.md`, `docs/evals/autonomy-*.json` | those two pages |
| `/?autonomy`: the agents deciding, for a guest | A recording of dry-118, the first autonomous dry run with every money movement's origin recorded (a VACUUM INTO copy of its ledger, read-only source, `npm run autonomy-record`), labelled "Autonomous dry run · test passkeys and test money · not a live run" | `docs/demo/autonomy.json`, `test/autonomy-recorded.test.ts`, the page check | README, landing button "See the agents decide" |
| The control tower and "Enforced by" | On the dashboard (from the ledger) and on the landing (from the recorded run, added 1 Nov from a read-only copy of its ledger; its Metal figures equal the recorded treasury's, `test/tower-recorded.test.ts`) | `src/dashboard/tower.ts`, `test/tower.test.ts`, the page check in CI | landing, CFO dashboard |
| "The money, moving": every movement from the ledger, with its agent, who decided it, the rail and its proof (D23, D24) | Who decided is the origin recorded with each movement when it started (D24), never derived from timing; the landing's 30 October run (15 movements) was recorded before D24 and carries no origins, so it shows only explicit records (an automatic-limit row, an executed batch, the Treasury agent's plan linked by proposal) and each movement is labelled "derived from the ledger's records (an older recording)" | `src/provenance/origin.ts`, `src/dashboard/flows.ts`, `test/flows.test.ts`, `test/origin*.test.ts`, `npm run origins`, the page check | Landing, CFO dashboard, `/?autonomy` (dry-118: 20 movements, every one with its recorded origin, 0 missing) |
| Every Airwallex id a juror sees, read back with GET only | 12 found (conversions, transfers, card transactions, deposits, a quote, a beneficiary shown only as existing); the 4 card transactions of the recorded run were verified by data-qa through the card's list on 31 Oct | `docs/runs/airwallex-readback.json`; `npm run awx-readback` | requirements QA |
| Phishing-resistant MFA on the dashboard (D20): FIDO2 passkey sessions for the CFO's actions, a viewer link that only reads and expires weekly | Built behind `MFA_SESSIONS=on` / `KIT11_MFA=on` (off by default); Worker tests with real ES256 signatures and a red team (leaked link, replay, unenrolled passkey, stolen cookie, other site); the phone check passes with and without it (1 Nov). **Not on the hosted relay until Max approves the redeploy**, so the line "Phishing-resistant MFA (FIDO2 passkeys), four eyes on chain, limits enforced by Metal and Airwallex." stays off the site and deck until then | `test/relay-mfa.test.ts`, `test/worker-webauthn.test.ts`, `docs/security.md` row 31, D20 | nowhere public yet |
| `/try`: a visitor changes the world and the Sourcing agent decides with Claude (D21) | Five world changes; the same brief, rules, buy-policy tool and code check as the autonomy runtime in its variation test (a test compares the runtime's own request with /try's; no card tools here); demo world, no money; two dev runs against the real Haiku: 10 of 10 decided by Claude, about 0.0005 USD each, request ids in the run log (1 Nov). **On the hosted page after the Worker's next deploy (Max's go)**; until then the local and judge copies answer with the labelled fallback | `docs/runs/2026-11-01-try-world-dev.md`, `test/try-world.test.ts`, `test/try-desk.test.ts`, the page check | /try (labelled "Demo world · stand-in suppliers · no money moves") |
| Airwallex's own events in the autonomous world (D22): a card decline Airwallex made reaches the agent by webhook or poll; money paid into the Global Account reaches the Treasury agent; Ridgeline's one-off report on x402 (refused over the cap) or a single-use Airwallex task card the CFO approves | Built behind `KIT11_AUTONOMY=on`, with tests (`test/autonomy-airwallex.test.ts`) and dry-run steps A4b, A4d, A4e. In 19 green autonomous dry runs (dry-118 to dry-140): Airwallex's own decline reached the agent 19 of 19 times (by poll; the webhook path is the hosted relay's, Thursday), money in at Airwallex reached the Treasury agent 19 of 19 times; the report offer reached the Sourcing agent every time, and it **never chose the task card (0 of 19)**: that path is proven by tests and the 29 October card runs, not by an autonomous run | D22, [soak report](runs/2026-11-01-soak.md) | the decline and money in: yes; the task card in the autonomous world: not claimed |

## The main run, 3 November (Home, Watch, Proof, the partner pages, the video)

Max on his own phone with his real Face ID; second approver a labelled test passkey; real Claude agents (Sourcing on
Haiku, Support on Sonnet, Treasury on Opus); test money (Metal testnet, Airwallex sandbox); one world (`main-1`), code
frozen at 35e1cac. Every page that told agent run 1 now plays this run. Sources: the run log
`docs/runs/2026-11-03-main-run.md` (every step, tx, id and timing), its data-qa report
`docs/runs/2026-11-03-main-run-data-qa.md`, and the record `docs/demo/main-run.json` (`npm run autonomy-record` on a
copy of the main-1 ledger, 3 November; the ledger itself opened read-only). `test/redesign-numbers.test.ts`,
`test/figures.test.ts`, `test/site-v4.test.ts` and `test/watch-highlights.test.ts` fail on a figure the record does not
hold.

| Claim on a page | Value | Source |
|---|---|---|
| "Replay of the main run, 3 Nov 11:16–11:33 UTC · test money · real Claude decisions" | record `run`; the span from its own rows | record; `src/redesign/run.ts` `runLabel` |
| Decisions made by Claude | 24/24, 0 fallbacks (Sourcing 11, Support 4, Treasury 9); 50 Claude calls, each with a request id | record `agent_stats`, `traces`; run log, acceptance "§2 Fallbacks" |
| Claude cost per decision | $0.0132 (USD 0.316966 ÷ 24, list prices; a decision may be several calls). The run's Claude cost: 0.3170 USD | record `agent_stats[].cost_usd_micros`; run log, "Cost" |
| Payments inside the limits | 87 (41 of them the simulated customer's agent buying from us) | record `counts.alone`; `flows` (sales) |
| Stopped at a limit | 2 stopped at a limit, both in the main run: Metal refused purchase #24 over the mandate cap (tx `0x2e92f9cb…1871`), and Max rejected P-0004 with Face ID. Airwallex declined nothing in the main run (Sourcing asked for the card raise P-0006 first, and the purchase was approved). Not counted: query #37, refused `mandate_revoked` while the replace swapped the mandate. Shown directly below the figure, on its own labelled line and not counted: "Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November". The same figure on the site, the README, the submission README, the deck and the video script (`test/redesign-numbers.test.ts`) | record `flows[].refused`, `decisions`; `docs/runs/visa-tap-live-2026-11-02.json` (the separate line); run log, deviation 3; `src/redesign/run.ts` `stops`, `stoppedAtLimit`, `tapLimitLine` |
| "Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved." | Shown word for word with that refusal (Watch, Proof, /metal). Purchase #24 at 0.04 over the 0.03 cap: `upstream.let_through` (seq 114), Metal refused it with 402 `mandate_cap_exceeded`, put on chain in tx `0x2e92f9cb…1871` (seq 119); the label is the ledger's own row (seq 121); nothing settled | run log, acceptance #5; record `ledger.events` (`upstream.let_through`, `upstream.refused_on_chain`, `upstream.let_through_refused`); `src/config/brand.ts` `DEFENSE_IN_DEPTH` |
| The customer gets an error status and is not charged | 14 queries answered 503 with `settled: false` (#24 at the cap, #25–#36 while Sourcing paused buying, #37 during the replace) | run log, acceptance #6; record `ledger.events` (`sale.refused`) |
| Treasury's options 40 s after the refusal | 11:23:26.882 (Metal's refusal) → 11:24:07.012 (P-0002/P-0003 created): 40 s, before any customer was turned away | record `ledger.events`; `src/redesign/run.ts` `timings`; run log, "Timings" |
| Four eyes on the mandate change | P-0002: Max's Face ID (1 of 2, 11:26:28), then the test-controller (2 of 2, 11:26:46), both over terms `bf7ec3a0…`; the replace on chain by 11:26:59 (treasury cap 2.00, tx `0x789abb24…ebbc`; sourcing cap 0.04, budget 14.00, tx `0x2a91ac97…e790`). "Second approver: a labelled test passkey in this demo. In production this is a second person." | run log, acceptance #9 and the flow row; record `ledger.events` (`proposal.cosigned`, `proposal.approved`, `mandate.replaced`) |
| The dispute | 12 orders checked; #7, #10, #13 refunded by the Support agent (0.15); "refund the other 9" (P-0004) rejected by Max with Face ID; the planted 0x…dEaD instruction ignored | run log, the dispute row; record `traces`, `flows`, `refusals` |
| Sweep after finality | 0.69, tx `0x86936a5b…ccb4`, block 14153316 finalized at 14153325; booked at Airwallex as a simulated sandbox deposit (`b3812e05…`) naming the tx | run log, the sweep row; record `flows`, `rails` |
| The EUR licence, planned by the Treasury agent itself | P-0005 created by the Treasury agent (Claude Opus) at 11:30:30; Max approved it with Face ID at 11:31:18; FX first: EUR 110.00 for USD 124.29 (conversion `3ca88196…`, only the shortfall: 240.00 + the 20.00 fee ceiling − 150.00 free); then SWIFT: transfer `03360bfa-afce-457b-89d1-e1097fbe3985` **PAID** at 11:31:24, fee EUR 13.42 (ceiling 20.00). No `fee_unknown`, no retry | run log, acceptance #17 and #18/25; record `ledger.events` (`fx.converted`, `transfer.*`, `proposal.executed`) and `ledger.proposals` (`created_by` treasury) |
| "6 s after Face ID" | 11:31:18.218 (Face ID) → 11:31:24.283 (PAID): 6 s | record `ledger.events`; `src/redesign/run.ts` `timings` |
| The card buy signed with Visa TAP, in this world | `tap.checkout_verified` (seq 401): our layer verified both signatures (key `sourcing-HsPFvr0tERIp`); Airwallex approved `01a1a12f…`, EUR 45.00 on the Sourcing agent's card ····1423, after the card raise P-0006 (Face ID). In this run the signatures were verified by our layer in-process; Visa's reference verifier accepting them is the TAP run's and CI's proof (row above) | run log, acceptance #20; record `ledger.events` (`tap.checkout_verified`, `card.charge_approved`) |
| Face ID decisions | 5 (P-0001, P-0002, the rejection of P-0004, P-0005, P-0006); plus 1 co-signature by the test passkey | record `ledger.events`; `faceIdDecisions` |
| The books match | `verify` all checks pass; `reconcile` 88 flows, no differences; `data-qa` 111 payments, 217 checks, 0 differences, 0 skipped; `dashboard-vs-chain` 4 of 4 mandates; `origins` 110 money movements, 0 without an origin | run log, acceptance §2; `docs/runs/2026-11-03-main-run-data-qa.md` |
| Audit log | 412 rows in the record (to 11:35:42 UTC), hash chain intact | record `audit` |

Not claimed: any safety count; any approval by Visa; that TAP counts as Visa tooling.
The first `world serve` lacked the agent environment and sold #1 and #2 before any agent ran (run log, deviation 1).

## Agent run 1 (rehearsal), 2 November (archive: no longer played on the pages)

Kept for the honest notes that cite it (the licence started by the CFO, the agents' wrong facts and their evals, the
fixes it led to). Its record `docs/demo/agent-run.json` and notes `docs/demo/agent-run-notes.json` are unchanged.

Max alone, his real Face ID; second approver a labelled test passkey; real Claude agents; test money (Metal testnet,
Airwallex sandbox). Sources: `docs/runs/2026-11-02-agent-run-1.md` (every step, tx, quote), the ledger copy behind
`docs/demo/agent-run.json`, `npm run verify` / `reconcile` / `origins` output recorded in the run log.

| Claim on a page | Status | Source |
|---|---|---|
| "38/38 decisions made by Claude, 0 fallbacks" (Sourcing 16 Haiku, Support 8 Sonnet, Treasury 14 Opus) | Measured | record `agent_stats` (recorded 14:30 UTC, after the licence; the run log's 26 is the count at 11:12 UTC); `traces`: 38, every one `done` |
| A purchase at 0.04 refused against the 0.03 mandate cap, then recorded by Metal on chain | Shown (tx 0x3ad8de2f…a84d). Purser refused before signing; Metal recorded the same refusal on chain: say both, never "Metal refused" alone | run log, 10:48 |
| Treasury proposed the rebalance (P-0002/P-0003) after Sourcing reported the block | Shown | run log, 10:49 |
| Four eyes on the mandate change: Max's Face ID, then a second signature. Claude cannot use the CFO's passkey; in this demo the second approver is a labelled test passkey, signed on the CFO's go. In production this is a second person | Shown (P-0003, Max's passkey then the test-controller's) | `npm run verify`: P-0003 signed by both passkeys; record `decisions[].by` ("Max & Test-controller · Face ID") |
| Mandates replaced on chain (sourcing cap 0.04 budget 12.00; treasury 4.00) | Shown (tx 0x0e7f9d0a…ba2d8e, 0x563d4fff…b152) | run log, 10:54 |
| Dispute on 12 sold orders: Support refunded the 3 with supplier-corrected data (#7, #10, #13, 0.15); "refund the other 9" rejected by Max with Face ID (Opus advised reject) | Shown | run log, 10:55–10:57; `verify`: dispute 12/12 signed |
| Sweep of 1.97 after finality; Airwallex side a simulated deposit | Shown (tx 0x659c5ac2…e2b2) | run log, 10:59 |
| Licence EUR 240.00: the Treasury agent's plan P-0005, approved by Max with Face ID; **Airwallex's sandbox answered 400 `fee_unknown` (it could not price the fee); nothing paid.** The re-plan P-0006 expired unsigned. P-0007, started by the CFO (`npm run licence`) and approved by Max with Face ID, was **PAID** at 14:30 UTC (transfer `7bbb3d61…`, fee EUR 13.37) | Shown. `fee_unknown` is not an Airwallex *limit*: never present it as Airwallex enforcing a limit. The Airwallex limit example is the TAP run's EUR 45.00 `LIMIT_EXCEEDED` | run log, 11:01, 12:44–14:30; read-only lookup by request_id; record `flows` (licence, PAID) |
| Payment and stop counts on Home/Proof (86 inside the limits, 63 of them the simulated customer's agent). The stop count the pages showed for agent run 1 is withdrawn: it counted a `mandate_revoked` refusal and the TAP run's decline as limits. The pages now show only the main run's figure, 2 stopped at a limit (main-run section above) | Counted from the agent run 1 record; the licence's `fee_unknown` is shown apart as "not a limit" and not counted (`src/redesign/run.ts` `stops`, `test/redesign-numbers.test.ts`). Agent run 1 had 0 card declines (`proof.card_declines`) | `docs/demo/agent-run.json` (`counts.alone` 86; 63 sales in `tower.money_in`), `docs/runs/visa-tap-live-2026-11-02.json` |
| "$0.0141 Claude cost per decision" | Measured: the agents' Claude cost ÷ decisions in agent run 1 (USD 0.535249 ÷ 38, list prices; say "per decision", each decision may be several calls) | record `agent_stats[].cost_usd_micros` and `decisions` |
| Reconcile: 88 flows, no differences; origins: 102 money movements, 0 without an origin; data-qa: 199 of 199 checks matched (after the licence, 15:48 UTC; at 11:12 UTC: 86 flows, 98 movements) | Measured after the run | run log, "After the run" and "Data check after the licence"; `docs/runs/2026-11-02-agent-run-1-data-qa.md` |

## The partner pages (`/airwallex`, `/claude`, added 2 November)

Both pages are built without a script from `src/partners/` (`data.ts` reads the recorded files, `page.ts` renders), and
`test/partner-pages.test.ts` fails if an id, tx or request id on them is not in the recorded files, if an agent's model
is not the one in code and in the recording, or if a part or a run label is missing. Every proof line on them is a feed
line or money movement of the two recordings, shown with the recording's label; the docs links were taken from the
partners' own site maps (airwallex.com/docs, platform.claude.com/docs) on 2 November.

| Claim | Proof |
|---|---|
| /airwallex, in our story: "Airwallex is Northwind's bank: each agent pays with its own company card, under limits Airwallex enforces on the card, and the Treasury agent's euro bills are paid by SWIFT, with euros bought at a locked rate when they are short, only after the CFO's Face ID" | `docs/airwallex.md` (Issuing, FX, Transfers); story `card`, `swift`; agent run 1 flows (the EUR 240.00 licence P-0007, payment started by the CFO with `npm run licence`, approved with Face ID; the Treasury agent's own plan P-0005 was refused with `fee_unknown`) |
| Card per agent; agents never see the card number or CVV | `docs/airwallex.md` Issuing; snapshot and autonomy `rails.airwallex` (card endings) |
| Limits on the card from the CFO policy, synced and read back; Airwallex declines over them | `docs/airwallex.md` (`authorization_controls`, `GET /issuing/cards/{id}`); story `card` details; the declines in both recordings' feeds |
| 2 card charges Airwallex declined itself | counted from the flows of the two recordings: 2 in the recorded run of 30 October (LIMIT_EXCEEDED, MERCHANT_CATEGORY_NOT_ALLOWED), 0 in agent run 1 |
| 2 euro invoices paid by SWIFT after Face ID (EUR 1,850.00 and EUR 240.00) | the two recordings' `airwallex_swift` flows: the recorded run (fee EUR 13.41) and agent run 1 (P-0007, fee EUR 13.37; payment started by the CFO) |
| 12 Airwallex ids read back with GET only; an id's hover text says when and with which status | `docs/runs/airwallex-readback.json` (1 November) |
| FX: only the shortfall, a quote locked for 15 minutes and checked against the current rate, booked after Face ID | `docs/airwallex.md` FX (`validity MIN_15`, `GET /fx/rates/current`) |
| SWIFT only to an allowlisted beneficiary, approval hash in the metadata, fee ceiling EUR 20.00 | `docs/airwallex.md` Beneficiaries and Transfers; the feeds' `transfer.created` and `transfer.fee` lines |
| Earnings booked once final, as a sandbox deposit that names the testnet tx | metal.json `finality`; the feeds' `credit.deposited` lines (with the tx) |
| Retailers' payments reach the Treasury agent; matched booked once, short or unknown to the CFO; the separate 30 October run (2 matched, 1 short by EUR 10.00, 1 with no invoice) | D22 row above (19 of 19); `docs/runs/2026-10-30-receivables.md` |
| Webhooks: 23 events, checked by the relay and again by the runner, moving no money; not in the two recordings; shown live in a separate run | `docs/airwallex.md` Webhooks; `docs/runs/2026-10-30-webhooks.md`; snapshot `airwallex_events.total` 0 |
| Why: a lost answer is looked up by its `request_id`, a quote is booked once | `docs/airwallex.md` ("How Purser talks to Airwallex", FX single use) |
| Not done or simulated: sandbox only; merchants simulated; no stablecoin reaches Airwallex; PAID set by the sandbox; placeholder cardholders, KYC not shown; emergency stop and payout/conversion/card-status webhooks not yet live; decline by poll in the dry runs; the task card chosen 0 of 19 | `docs/airwallex.md`; the "Removed or softened" list below; the rows "Emergency stop", "Airwallex webhooks" and D22 above |
| /claude, in our story: "Claude is how Purser's agents read the world and decide what to do inside their limits: the Sourcing agent runs on Haiku, the Support agent on Sonnet, the Treasury agent on Opus, and code checks every decision before money moves" | models in code (`src/autonomy/sourcingProfile.ts`, `teamProfiles.ts`, `MODELS` in `src/claude/reader.ts`) and in agent run 1's `agent_stats.models`; deciding as shown in agent run 1, with its label |
| Per agent: decisions, decided by Claude, fallback (code) and its %, Claude calls, cost at list price, median time per run | agent run 1 record `agent_stats` and `claude.agents` (16/16, 8/8, 14/14 by Claude, 0 fallbacks; 82 agent calls, 0 without a request id; USD 0.54 at list prices) |
| Request ids beside the money they decided: `req_011CgdypNe4Pua3cLhBqs6hD` (refunds of orders 7, 10, 13), `req_011Cgdz3eJzsCLcbxKpRNwbd` (the 1.97 sweep); the /try dev run's ids | agent run 1 record `flows[].request`; `docs/runs/2026-11-01-try-world-dev.md` |
| Every decision in the run, each labelled "Decided by Claude" or "Fallback (code)" | agent run 1 record `traces` (38, all `done`: the agent's own Claude loop; anything else would be a fallback to code, `src/dashboard/trace.ts`) |
| The recorded run's model split and cost (Haiku 7 calls, Sonnet 9, Opus 7; 23 calls USD 0.18; USD 0.093 per EUR 1,000) | snapshot `claude`; `docs/claude.md` |
| Structured outputs, the cached system prompt, effort low (Opus medium), fallback to a plain parser | `docs/claude.md`; `src/claude/reader.ts` |
| Not shown: not yet a live run with Max; in the recorded run code decided and Claude read and explained; variation test and red team with stand-in rails and Haiku only; list prices, not a bill | rows "Claude agents that decide", "Autonomous agents", "The variation test" above; `src/claude/pricing.ts` |
| "Powered by Claude" with the Claude logo on a dark ground; no Visa logo on either page | `src/ui/logos/README.md`; the page check |

## The four tabs (Home, Watch, Try, Proof; added 2 November)

**Since 3 November the four tabs play the main run** (section above; `docs/demo/main-run.json`); the rows below are
agent run 1's, as the pages showed them on 2 November, kept as the record of what was claimed then. Home, Watch and
Proof are built without hand-typed figures from the played run's record (`npm run autonomy-record` on a copy of the
ledger; `src/redesign/run.ts`) and, for the Airwallex limit decline and Visa's reference verifier, the live TAP run's
record (`docs/runs/visa-tap-live-2026-11-02.json`). `test/redesign-numbers.test.ts` fails on any number on them
that neither record holds (or that the test does not count again from the record), and `test/browser/redesign.check.ts`
checks them at 390 and 1440 px, light and dark, with a link check. Old addresses redirect: `/live` and `/demo` to `/watch`.
Since 4 November (live with the next deploy) `/` is Home itself for a guest, with no redirect, so a reader without
script sees Home too; with a query (`?recorded`, `?autonomy`, `?signin`) it is the CFO dashboard's page, and the CFO's
viewer link (`/#view=…`) goes on from Home to the dashboard (`test/first-impression.test.ts`, `test/browser/root.check.ts`).

| Claim | Proof |
|---|---|
| "Replay of agent run 1 · 2 Nov · test money · real Claude decisions" | record `run`, `recorded_at`; `agent_stats` (38 of 38 by Claude, 0 fallback) |
| Home's heading "AI agents that run a business. Inside limits the CFO sets." and the core sentence: "Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; the CFO approves anything beyond them." (jury review, 4 Nov: no "limits they can't break", no "enforce every limit") | the three moments below; `src/config/brand.ts` `CORE_SENTENCE` |
| The price rise: Stockline 0.02 → 0.04; Purser refused before signing and Metal recorded the refusal on chain (tx `0x3ad8…a84d`); Treasury replans (`design_rebalance`); four eyes on the mandate change (Max's Face ID, then the second approver: a labelled test passkey, signed on the CFO's go; in production a second person); the mandate replaced, cap 0.04 | record `flows` (refused by Purser, then recorded by Metal, with tx), `agent_chat`, `traces`, `decisions` (`P-0003`, "Max & Test-controller · Face ID"), `tower` |
| The dispute: 12 orders checked, the 3 wrong ones (#7, #10, #13) refunded by the Support agent, the CFO rejects the rest (P-0004) | record `traces` (dispute: 12 `verify_order`), `flows` (refunds with tx), `decisions` |
| Earnings and euros: 1.97 swept after finality and booked at Airwallex; the EUR 240.00 licence: the Treasury agent's plan P-0005 was refused by Airwallex (400 `fee_unknown`, nothing paid); P-0007, started by the CFO (`npm run licence`) and approved with Face ID, was PAID (fee EUR 13.37) | record `flows` (sweep tx, deposit; licence `7bbb3d61…` PAID, `decided` from `docs/demo/agent-run-notes.json`), `decisions` (`P-0005` FAILED), `refusals` ("P-0005 failed: Airwallex /transfers/create -> 400 fee_unknown"), feed (`transfer.fee` EUR 13.37) |
| Scene 3's card buy signed with Visa TAP | the TAP run's record (labelled "TAP run · 2 Nov"): a separate test world of the same day, with Visa's reference registry self-hosted with a test key and our own TAP merchant; not part of agent run 1 |
| Five numbers: 38/38 by Claude; 86 payments inside the limits (63 of them the simulated customer's agent); a stop count, now withdrawn (it counted a `mandate_revoked` refusal and the TAP run's decline; the pages show the main run's 2 stopped at a limit); 5 Face ID decisions (P-0001, P-0003, the rejection of P-0004, P-0005, P-0007); $0.0141 Claude cost per decision | record `agent_stats`, `counts.alone`, `flows[].refused`, `decisions`, `proof.face_id`, `agent_stats[].cost_usd_micros` (list prices) |
| Four eyes: Claude cannot use the CFO's passkey; in this demo the second approver is a labelled test passkey, signed on the CFO's go. In production this is a second person | record `decisions[].by`; the run log `docs/runs/2026-11-02-agent-run-1.md` |
| World set-up: "the alternative supplier (Ridgeline) is offline in this world, so the price rise forces a choice. The agents were not told what to do." | the run log; record `agent_chat` (Ridgeline's maintenance notice) |
| Proof: the variation test (20 of 20 by Claude, 2 different choices; the safety count is not claimed until sim-31's fix is merged and re-run), the red team, system health (460 audit rows, chain intact) | `docs/evals/autonomy-variation.json`, `docs/demo/autonomy.json` (labelled with its own name), `docs/redteam/report.json`, `docs/evals/autonomy-redteam.json`, record `audit` |
| "Built on" Airwallex, Metal, Claude (logos) and "Visa TAP" (text, no logo); the Kit line names the Metal Award and the Visa Award entry. Visa: "Entered for the Visa Award (organisers confirmed one project may enter both Visa and Metal; whether TAP counts as Visa tooling is still being confirmed with Visa)." The TAP run was a separate test world (self-hosted reference registry, our own TAP merchant) | `src/config/brand.ts` (`VISA_AWARD_ON`, on since the live TAP run and the interop test were green); `docs/evidence/2026-11-02-slack-visa-answer-tbd.png` |
| Site v4 (Home's animation): "Stockline raises its price 0.02 → 0.04. Refused on chain." (tx); "Treasury replans. Face ID 1 of 2 → 2 of 2. New cap 0.04."; "12 orders disputed: 9 valid, 3 refunded."; "1.97 swept · €240 licence paid by SWIFT · Face ID · Visa TAP ✓ (TAP run)" | `src/redesign/run.ts` `homeFilm` from the record (`flows`, `ledger.events`, `traces`), the card buy from the TAP run's record; the failed fee_unknown attempt is not on Home (Watch's full run and Proof label it "earlier attempt, nothing paid") |
| Site v4 (D2): "Claude call ✓ · Opus · 13,572 tokens · 12.4 s · req_011CgdyH…" on each decision | the decision's trace in the record: `tokens` (input + output + cache read + cache write), `claude_ms` summed (Claude's own time; the whole decision's `latency_ms` is in the tooltip), the first of `request_ids`; `test/site-v4.test.ts` counts each badge again |
| Site v4 (D3): "Claude decides the exceptions; routine buying and selling per query is code." with "decisions by Claude: 38 (0 fallbacks)" and "routine payments by code: 82" | record `agent_stats` (decisions, by_claude, fallback); `flows` not refused, the customer's per-query purchases (`sale`) and the Sourcing agent's per-query buys whose `decided` is code (`upstream`), counted by `count` |
| Site v4: one Face ID number, 5 | the proposals Max decided with his passkey in the run's ledger (`proposal.approved`/`rejected` with approver max: P-0001, P-0003, P-0004, P-0005, P-0007), equal to the record's `proof.face_id` (`test/site-v4.test.ts`) |
| Site v4: the partner pages (/metal, /airwallex, /visa, /claude), short with the details folded | the same records; /visa is labelled with the TAP run, the others with agent run 1 |

## The video

| Claim | Proof | Changed |
|---|---|---|
| $3,046,598,558 in business email compromise losses | FBI IC3, 2025 Internet Crime Report (April 2026) | Now "reported by victims to the FBI". |
| Pace | `docs/video/script.md` computes words per minute from the words; the hybrid script is about 500 words in 4:10 (counted, stage directions left out) | Was "about 115" and "about 120"; 4:10 since the enterprise beat (30 Oct), which also names the clearing load test. |

## The deck's market slide ("Why now")

| Claim | Source |
|---|---|
| Visa Intelligent Commerce: credentials and controls for AI-initiated payments | visa.com/en-us/solutions/intelligent-commerce (read 31 October 2026) |
| Mastercard Agent Pay, announced April 2025 | mastercard.com/us/en/news-and-trends/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai.html |
| AI agents could mediate $3 trillion to $5 trillion of global consumer commerce by 2030 | McKinsey, "The agentic commerce opportunity: How AI agents are ushering in a new era for consumers and merchants", 17 October 2025 (mckinsey.com/capabilities/quantumblack/our-insights) |
| Google's Agent Payments Protocol (AP2), announced 16 September 2025 | cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol |
| "Why Airwallex customers need this" (landing and deck) | Northwind is the example company; the only market figure is McKinsey's, above |
| Team: Max Geurtsen, International Business student with an e-commerce background | Max, 31 October 2026 |
| Business model and roadmap slides | Labelled as a plan; the roadmap follows docs/architecture.md ("Not now" / "Production path") |

## The submission pack (`docs/submission/`)

The form text and the deck take every figure from `src/submission/facts.ts` (the recorded files above);
`test/submission.test.ts` checks the form text against it. A fresh reviewer read the pack against this page and the
code on 30 October; the sentences below were changed on its findings.

| Claim | Proof | Changed |
|---|---|---|
| Claude reads invoices and explains what code flags | `src/policy/fraud.ts`, `src/policy/injection.ts` (code checks; Opus may explain) | Was "Claude flags fraud and planted instructions". |
| The card's limits come from the CFO policy; merchant categories, currency and end date are fixed per agent | `src/policy/rules.ts`; `PLANS`, `CARD_ACTIVE_DAYS` in `src/config/policy.ts` | Was "the CFO policy sets its limits, merchant categories, currency and end date". |
| Card and mandate "within limits the CFO sets" | The card limits from the policy; mandate terms change only by a Face ID proposal (P-0002); the policy is an optional stricter cap inside the mandate (`docs/cfo-policy.md`) | Was "both set by one CFO policy". |
| Single-use task cards, separate live run | `docs/runs/2026-10-30-single-use.md` | Now labelled. |
| Card-transaction webhooks live since 29 October, none in the recorded run | `docs/runs/2026-10-29-cards.md`; snapshot `airwallex_events.total` 0 | Now says so. |
| Only the EUR shortfall after the reserve and the demo plan's set-aside is bought | snapshot `treasury` | Was "only the missing euros". |
| The price rise refused against the on-chain mandate: in the recorded run of 30 October by Metal's facilitator; in agent run 1 Purser refused before signing; Metal recorded the refusal on chain (a separate recorded-refusal pull, `src/metal/recordRefusal.ts`) | snapshot `rails`; agent run 1 record `flows` (tx `0x3ad8…a84d`) | Was "the chain refused"; then "Metal's facilitator refused" without the run (2 Nov). |
| Earnings booked at Airwallex only when final, as a simulated sandbox deposit | snapshot `rails` ("no test USD reached Airwallex") | Was "money reaches the bank". |
| Dispute: Summit is simulated, we filed the claim, nothing refunded, orders 7, 10 and 13 refunded earlier, ran after the run | metal.json `dispute.packs[].refunded_cents`; `docs/runs/2026-10-30-dispute-desk.md` | Was "a customer's agent … none was refunded". |
| Archive (30 October run): 106 with no approval at the time; 8 stops (6 payments, 2 planted instructions) | snapshot `counts.alone`, `counts.blocked` (see the first table) | Removed from the form text on 4 November: its run figures are the main run's now (2 stopped at a limit, with the TAP run's decline on its own labelled line). |
| The card story, main run: the Sourcing agent asked for a card raise first (P-0006, EUR 30.00 → 46.00), the CFO approved it with Face ID, Airwallex approved the TAP-signed EUR 45.00 purchase (authorization `01a1a12f-4113-7000-b76d-014677710007`); the decline only as the line "Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November" | record `ledger.events` (`proposal.created`/`approved` P-0006, `card.limits_synced` 30.00 → 46.00, `card.charge_approved`); run log, 11:31:4x → 11:33:13; `src/submission/facts.ts` `card_raise` | 4 November: the form text, the README's demo step 2 and the deck's slide 3 told the 30 October decline (€45.00 `LIMIT_EXCEEDED`, €19.99 wrong kind of shop) instead. |
| Red team: 35 scripted attacks plus 4 Claude-written documents, against in-memory stand-ins; 37 stopped before succeeding (the burst after 30 allowed payments), 2 found afterwards | `docs/redteam/report.json`; `src/redteam/world.ts` | Was "Claude as the attacker … stopped before anything moved". |
| Summit and Stockline are run by us | metal.json payee names | Added to "what is simulated". |
| Offline `/try` reads requests with code only | `src/cli/judge.ts` | Was "needs the live link". |
| Jury review, 4 November: the form tells only the main run; everything else is under "Other live tests (separate worlds, dated)" | `docs/demo/main-run.json`; `test/submission.test.ts` ("tells only the main run up front") | The €1,850 invoice (USD 418.40 → EUR 370.00, fee €13.41), the 30 October price-rise bullet, the 30 October dispute ("nothing refunded") and "$0.093 per €1,000" were removed from the form. |
| The dispute, one text everywhere: "A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects it with Face ID." | record `ledger.disputes[0]` (claim `never_placed`, all 12 `signed_order: true`), `flows` (refunds #7, #10, #13, 0.05 each), P-0004 `REJECTED`; `src/redesign/run.ts` `disputeStory` | Home, the form, the README and the deck now share it. |
| Payments: 87 inside the limits = 41 sales + 41 supplier purchases + 3 refunds + 1 sweep + 1 card buy; 86 on Metal (all but the card buy); 82 routine by code (the sales and supplier purchases); reconcile checked 88 (the 86 Metal payments, the SWIFT transfer and the card buy); 14 queries got an error and were not charged (#24 at the cap, #25–#36 not bought by the Sourcing agent's own policy, #37 `mandate_revoked`) | record `counts.alone`, `flows`, `reconciliation.checked`, `refusals`; `src/redesign/run.ts` `payments`; `test/redesign-numbers.test.ts` | Home said 87, Proof 82 and /metal 86 with no line tying them together. |
| Mandates, main run: Sourcing 10.00 → 14.00 (cap 0.03 → 0.04), Support 4.00 (cap 0.10), Treasury 6.00 → 2.00 | record `tower.agents[].mandate`; `INITIAL_MANDATES` in `src/config/policy.ts` | The README said "10→12", "6→4 in the brief" and "e.g. 14/2/4". |
| Visa, said once per surface: "Visa: each agent signs its card checkout with Visa's Trusted Agent Protocol (TAP), so a merchant can check which agent is buying. Visa's public reference verifier accepted the signatures in a separate test on 2 November; the merchant is ours." The award status as one note | `docs/runs/visa-tap-live-2026-11-02.json`; `src/config/brand.ts` `VISA_CLAIM`, `VISA_AWARD_STATUS` | Was a longer paragraph repeated about seven times. "Public", not "open source": Visa's reference has no open-source licence (docs/decisions.md). |
| Deck: "Metal holds the limit, not only Purser" | The mandate is checked by Metal's facilitator on every payment (`docs/metal-award.md`) | Was "the limit holds even if Purser is wrong". |

## Night batch, 2 November (D26 proof: variation, holdouts, red team)

Source for every row: `docs/runs/2026-11-02-night-batch.md` and the files it names. Not yet on any page.

| Claim | Value | Proof | Changed |
|---|---|---|---|
| Variation, simulated rails | 40 simulated worlds (seeds 1–40): 2 where an agent passed an unvetted payee address to another agent (no payment possible; code now withholds it). Full 40-world re-run on the fix: pending. 6 targeted re-runs (sim-31, sim-38, 3 times each): no address passed on, no money moved outside the rules | `docs/runs/variation/2026-11-02/summary.md`, `sim-31.json`, `sim-38.json`; `docs/runs/variation-after-fix-final/2026-11-02/` | New |
| Variation, live | 10 live worlds on Metal testnet and the Airwallex sandbox (dry-142 to dry-151): 174 decisions, all by Claude; no money moved outside the rules, 0 double payments, 0 movements without origin (live verdict: the limits in force at each payment). Each world maps only part of its seed | `docs/runs/variation/2026-11-02/live-*.json` (`mapping.not_mapped`, `safety.not_judged`), `live-logs/` | New |
| Calibration, 3 seeds | the refusal over the cap (`mandate_cap_exceeded`, recorded on chain) and the card decline (`LIMIT_EXCEEDED`) answer live as the stand-ins do; the SWIFT fee was EUR 13.39 to 13.40 live against 13.47 in the stand-in | night-batch report, section 3 | New |
| Holdouts | 10 run on simulated rails and 4 of them live (live: no money moved outside the rules, 0 double payments, 0 movements without origin). No headline number: a fresh review tagged 1 CLEAN and 9 WEAK (2 leaked ones retired), and a new set of blind holdouts replaces this one | `docs/runs/holdouts/2026-11-02/summary.md`, `leak-review.md`, `leak-review-new.md`, `live-*.json` | New |
| Red team, Opus as the attacker | Opus wrote 119 tests in rounds (it declined to attack through tools); 118 reached the system (63 against the agents, 8 TAP, 16 passkey, 8 relay, 24 Try): code judged 111 blocked, 5 not blocked, 3 inconclusive. All 5 re-checked by hand: none is a breach (two small Try reading bugs filed) | `docs/redteam/night-2026-11-02.json`, `-b.json`, `-c.json`; night-batch report, section 5 | New |
| A second finding (live) | In 1 of 14 live runs the Support agent settled a dispute that never came in (3 orders refunded within the rules, 0.15); fixed (support-dispute-gate, merged); a keyed follow-up is on dispute-gate-keyed | `docs/runs/variation/2026-11-02/live-14.json`, `live-logs/dry-147.txt`; branch `support-dispute-gate` | New |

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

**What "refused on chain" meant in the recorded run of 30 October.** Each agent's limits are its mandate, bound on
chain in Metal's mandate contract. In that run, when a payment would break them, Metal's facilitator checked it against
that on-chain mandate and refused it before anything was sent: nothing moved and no transaction reverted (the refusal
and its reason, e.g. `mandate_cap_exceeded`, came back from Metal). `metal-agent mandate pull --record-refusal` can also
record such a refusal on chain; the recorded run did not. In agent run 1 (2 November) it is worded differently: Purser
refused before signing; Metal recorded the refusal on chain (tx `0x3ad8…a84d`), through a separate recorded-refusal
pull (`src/metal/recordRefusal.ts`). Never "Metal refused" alone for agent run 1.

**Since 30 October 12:23 UTC this is no longer the whole story (Metal QA, 1 November).** Friday run 1 (07:05 UTC, the
recording) predates Purser's spend holds, so its refusal came from Metal. Since the holds (`92408ed`), Purser itself
refuses a payment over the mandate's cap *before anything is signed* (`src/policy/holds.ts`, using the cap of the
credential last bound); Metal never sees it. Every dry run since says "refused before signing" now, with
`refused_by: purser` in its audit row. With the agents on (Thursday), the first such refusal under a mandate is also
put to Metal with `mandate pull --record-refusal`, which records Metal's own refusal on chain in a transaction
(`src/metal/recordRefusal.ts`, sent only when the amount is over the cap written in the bound credential, so it cannot
pay). On-chain refusals already recorded in the four-eyes world: see `docs/runs/2026-10-30-four-eyes.md`.
