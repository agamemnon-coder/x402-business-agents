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
| Tests | 1074 in 136 files (31 Oct, evening) | `npx vitest run` | |
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
| Kit 11's monthly licence fee in euros (EUR 240.00 in code, paid by the Treasury agent) | Built and tested end to end against the sandbox stand-in; joins the next live run | `test/licence-fee.test.ts`; `npm run licence` | requirements matrix K1b/K4c (🟠 until it runs live) |
| "Our agents sign their card checkouts at TAP merchants with Visa's Trusted Agent Protocol. Their signatures are accepted by Visa's public TAP reference verifier (pinned commit 16d59bd). The TAP merchant in this demo is run by us. Body integrity, tag and payment checks are our own layer on top." | **Claimed for the Visa Award** (2 November): organisers confirmed TAP on Visa's reference counts as Visa tooling and one project may enter both Visa and Metal (Max, from Airwallex in #help, 1 November; screenshot to `docs/evidence/` when Max sends it). Interop green in CI both ways (tap-interop, 21 cases, run 41425023628 on 96aa126); live TAP run 2 November in a fresh test world: the Sourcing agent (Claude Haiku) picked the card rail for the card-only merchant, Visa's unmodified reference proxy passed it (200), our layer verified both signatures, the agent's Airwallex card (brand as Airwallex returns it: VISA) was approved; an over-limit attempt was declined by Airwallex (LIMIT_EXCEEDED); both confirmed by read-only GET | `docs/runs/visa-tap-live-2026-11-02.json`; `.github/workflows/tap-interop.yml`; `test/interop/tap-interop.ts`; `docs/plans/d25-tap-design.md`; D25 in `docs/decisions.md` | /visa, landing, README, description, deck, video; matrix V1/V2 (✅) |
| Kit 11's names, word for word: Sourcing agent, Support agent, Treasury agent; the Support agent's card pays helpdesk software | In code and on every page. The 30 October recording was made with the earlier names: its recorded data shows the Kit 11 names, and every page that plays it says so at the top. The live run with Max becomes the new recording | `test/kit11-names.test.ts` (fails if a guest can see an earlier name, or if the label is missing); `src/config/brand.ts` `RECORDING_NAMES_NOTE` | every page that shows the recording; decisions D14 |
| Posting the books to T:0 | Built and tested against a fake; nothing posted yet (no key) | `test/t0.test.ts`; `docs/t0.md` | nowhere public until it has posted and matched |
| Claude agents that decide inside their mandates: the Sourcing agent meets a price rise and tells Treasury, the Treasury agent designs the rebalance and the options, the Support agent refunds wrong sales itself and escalates the rest | Built, behind `KIT11_AGENTS=on` (off by default); run end to end in throwaway dry-run worlds with real models (dry-14, dry-15); evals per agent with real models; not yet in a recorded run with Max, so no public page claims that agents decide | `docs/agents.md`; `test/agent-loop.test.ts`, `test/treasury-agent.test.ts`, `test/support-agent.test.ts`, `test/sourcing-agent.test.ts`, `test/agent-feed.test.ts`; `docs/agent-evals.md` | the public line stays "Claude agents read, plan and advise; Metal and Airwallex enforce the limits" until a recorded run proves more (`test/core-line.test.ts`) |
| Autonomous agents (D19, behind `KIT11_AUTONOMY=on`): each agent its own process with a goal, tools and memory; we change the world (price rise, dispute, licence invoice, Packwise ending Starter, money in) and the agents decide; agents talk only by messages | Autonomous dry runs in fresh worlds on Metal testnet and the Airwallex sandbox (virtual passkeys, test identities), green from dry-97 to dry-102 (dry-96 failed; fixed), the last three with the whole world. dry-101: 0 fallbacks in 18 decisions; Sourcing asked the CFO for a card raise and bought Packwise Pro once it was approved; Treasury swept the money in. Not yet in a live run with Max | `docs/runs/2026-11-01-autonomy-dry-96-97.md` (dry-96 to dry-99), the dry-run logs; `npm run verify` passed in each; `npm run dashboard-vs-chain` 4 of 4 | `docs/runs/draaiboek-wereld-donderdag.md`; PR description. Say "in dry runs", never "live with Max", until Thursday |
| The variation test and the red team against the loop, with real Claude | 20 of 20 decided by Claude, 0 unsafe; 12 of 12 attacks held. Stand-in rails, one wake per run, the Sourcing agent (Haiku) only | `docs/agents-autonomy.md`, `docs/agents-autonomy-redteam.md`, `docs/evals/autonomy-*.json` | those two pages |
| `/?autonomy`: the agents deciding, for a guest | A recording of dry-118, the first autonomous dry run with every money movement's origin recorded (a VACUUM INTO copy of its ledger, read-only source, `npm run autonomy-record`), labelled "Autonomous dry run · test passkeys and test money · not a live run" | `docs/demo/autonomy.json`, `test/autonomy-recorded.test.ts`, the page check | README, landing button "See the agents decide" |
| The control tower and "Enforced by" | On the dashboard (from the ledger) and on the landing (from the recorded run, added 1 Nov from a read-only copy of its ledger; its Metal figures equal the recorded treasury's, `test/tower-recorded.test.ts`) | `src/dashboard/tower.ts`, `test/tower.test.ts`, the page check in CI | landing, CFO dashboard |
| "The money, moving": every movement from the ledger, with its agent, who decided it, the rail and its proof (D23, D24) | Who decided is the origin recorded with each movement when it started (D24), never derived from timing; the landing's 30 October run (15 movements) was recorded before D24 and carries no origins, so it shows only explicit records (an automatic-limit row, an executed batch, the Treasury agent's plan linked by proposal) and each movement is labelled "derived from the ledger's records (an older recording)" | `src/provenance/origin.ts`, `src/dashboard/flows.ts`, `test/flows.test.ts`, `test/origin*.test.ts`, `npm run origins`, the page check | Landing, CFO dashboard, `/?autonomy` (dry-118: 20 movements, every one with its recorded origin, 0 missing) |
| Every Airwallex id a juror sees, read back with GET only | 12 found (conversions, transfers, card transactions, deposits, a quote, a beneficiary shown only as existing); the 4 card transactions of the recorded run were verified by data-qa through the card's list on 31 Oct | `docs/runs/airwallex-readback.json`; `npm run awx-readback` | requirements QA |
| Phishing-resistant MFA on the dashboard (D20): FIDO2 passkey sessions for the CFO's actions, a viewer link that only reads and expires weekly | Built behind `MFA_SESSIONS=on` / `KIT11_MFA=on` (off by default); Worker tests with real ES256 signatures and a red team (leaked link, replay, unenrolled passkey, stolen cookie, other site); the phone check passes with and without it (1 Nov). **Not on the hosted relay until Max approves the redeploy**, so the line "Phishing-resistant MFA (FIDO2 passkeys), four eyes on chain, limits enforced by Metal and Airwallex." stays off the site and deck until then | `test/relay-mfa.test.ts`, `test/worker-webauthn.test.ts`, `docs/security.md` row 31, D20 | nowhere public yet |
| `/try`: a visitor changes the world and the Sourcing agent decides with Claude (D21) | Five world changes; the same brief, rules, buy-policy tool and code check as the autonomy runtime in its variation test (a test compares the runtime's own request with /try's; no card tools here); demo world, no money; two dev runs against the real Haiku: 10 of 10 decided by Claude, about 0.0005 USD each, request ids in the run log (1 Nov). **On the hosted page after the Worker's next deploy (Max's go)**; until then the local and judge copies answer with the labelled fallback | `docs/runs/2026-11-01-try-world-dev.md`, `test/try-world.test.ts`, `test/try-desk.test.ts`, the page check | /try (labelled "Demo world · stand-in suppliers · no money moves") |
| Airwallex's own events in the autonomous world (D22): a card decline Airwallex made reaches the agent by webhook or poll; money paid into the Global Account reaches the Treasury agent; Ridgeline's one-off report on x402 (refused over the cap) or a single-use Airwallex task card the CFO approves | Built behind `KIT11_AUTONOMY=on`, with tests (`test/autonomy-airwallex.test.ts`) and dry-run steps A4b, A4d, A4e. In 19 green autonomous dry runs (dry-118 to dry-140): Airwallex's own decline reached the agent 19 of 19 times (by poll; the webhook path is the hosted relay's, Thursday), money in at Airwallex reached the Treasury agent 19 of 19 times; the report offer reached the Sourcing agent every time, and it **never chose the task card (0 of 19)**: that path is proven by tests and the 29 October card runs, not by an autonomous run | D22, [soak report](runs/2026-11-01-soak.md) | the decline and money in: yes; the task card in the autonomous world: not claimed |

## The partner pages (`/airwallex`, `/claude`, added 2 November)

Both pages are built without a script from `src/partners/` (`data.ts` reads the recorded files, `page.ts` renders), and
`test/partner-pages.test.ts` fails if an id, tx or request id on them is not in the recorded files, if an agent's model
is not the one in code and in the recording, or if a part or a run label is missing. Every proof line on them is a feed
line or money movement of the two recordings, shown with the recording's label; the docs links were taken from the
partners' own site maps (airwallex.com/docs, platform.claude.com/docs) on 2 November.

| Claim | Proof |
|---|---|
| /airwallex, in our story: "Airwallex is Northwind's bank: each agent pays with its own company card, under limits Airwallex enforces on the card, and the Treasury agent's euro bills are paid by SWIFT, with euros bought at a locked rate when they are short, only after the CFO's Face ID" | `docs/airwallex.md` (Issuing, FX, Transfers); story `card`, `swift`; autonomy flows (the EUR 240.00 licence, planned by the Treasury agent, approved with Face ID) |
| Card per agent; agents never see the card number or CVV | `docs/airwallex.md` Issuing; snapshot and autonomy `rails.airwallex` (card endings) |
| Limits on the card from the CFO policy, synced and read back; Airwallex declines over them | `docs/airwallex.md` (`authorization_controls`, `GET /issuing/cards/{id}`); story `card` details; the declines in both recordings' feeds |
| 3 card charges Airwallex declined itself | counted from the flows: 2 in the recorded run (LIMIT_EXCEEDED, MERCHANT_CATEGORY_NOT_ALLOWED), 1 in dry-118 (LIMIT_EXCEEDED) |
| 2 euro invoices paid by SWIFT after Face ID (EUR 1,850.00 and EUR 240.00) | the two recordings' `airwallex_swift` flows; fees EUR 13.41 and EUR 13.48 from their feeds |
| 12 Airwallex ids read back with GET only; an id's hover text says when and with which status | `docs/runs/airwallex-readback.json` (1 November) |
| FX: only the shortfall, a quote locked for 15 minutes and checked against the current rate, booked after Face ID | `docs/airwallex.md` FX (`validity MIN_15`, `GET /fx/rates/current`) |
| SWIFT only to an allowlisted beneficiary, approval hash in the metadata, fee ceiling EUR 20.00 | `docs/airwallex.md` Beneficiaries and Transfers; the feeds' `transfer.created` and `transfer.fee` lines |
| Earnings booked once final, as a sandbox deposit that names the testnet tx | metal.json `finality`; the feeds' `credit.deposited` lines (with the tx) |
| Retailers' payments reach the Treasury agent; matched booked once, short or unknown to the CFO; the separate 30 October run (2 matched, 1 short by EUR 10.00, 1 with no invoice) | D22 row above (19 of 19); dry-118 feed `receivable.escalated`; `docs/runs/2026-10-30-receivables.md` |
| Webhooks: 23 events, checked by the relay and again by the runner, moving no money; not in the two recordings; shown live in a separate run | `docs/airwallex.md` Webhooks; `docs/runs/2026-10-30-webhooks.md`; snapshot `airwallex_events.total` 0 |
| Why: a lost answer is looked up by its `request_id`, a quote is booked once | `docs/airwallex.md` ("How Purser talks to Airwallex", FX single use) |
| Not done or simulated: sandbox only; merchants simulated; no stablecoin reaches Airwallex; PAID set by the sandbox; placeholder cardholders, KYC not shown; emergency stop and payout/conversion/card-status webhooks not yet live; decline by poll in the dry runs; the task card chosen 0 of 19 | `docs/airwallex.md`; the "Removed or softened" list below; the rows "Emergency stop", "Airwallex webhooks" and D22 above |
| /claude, in our story: "Claude is how Purser's agents read the world and decide what to do inside their limits: the Sourcing agent runs on Haiku, the Support agent on Sonnet, the Treasury agent on Opus, and code checks every decision before money moves" | models in code (`src/autonomy/sourcingProfile.ts`, `teamProfiles.ts`, `MODELS` in `src/claude/reader.ts`) and in autonomy `agent_stats.models`; deciding only as shown from the dry run, with its label (D19 row above) |
| Per agent: decisions, decided by Claude, fallback (code) and its %, Claude calls, cost at list price, median time per run | autonomy `agent_stats` and `claude.agents` (dry-118: 10/10, 3/3, 6/6 by Claude, 0 fallbacks; 37 agent calls, 0 without a request id; USD 0.18) |
| Request ids beside the money they decided: `req_011CgcUUJMu4AyUHz2TcgPQL` (refunds of orders 7, 10, 13), `req_011CgcUdBoG69KTWRWb2wkUq` (the 0.25 sweep); the /try dev run's ids | autonomy `flows[].request`; `docs/runs/2026-11-01-try-world-dev.md` |
| Every decision in the run, each labelled "Decided by Claude" or "Fallback (code)" | autonomy `traces` (status `done` is the agent's own Claude loop; anything else fell back to code, `src/dashboard/trace.ts`) |
| The recorded run's model split and cost (Haiku 7 calls, Sonnet 9, Opus 7; 23 calls USD 0.18; USD 0.093 per EUR 1,000) | snapshot `claude`; `docs/claude.md` |
| Structured outputs, the cached system prompt, effort low (Opus medium), fallback to a plain parser | `docs/claude.md`; `src/claude/reader.ts` |
| Not shown: not yet a live run with Max; in the recorded run code decided and Claude read and explained; variation test and red team with stand-in rails and Haiku only; list prices, not a bill | rows "Claude agents that decide", "Autonomous agents", "The variation test" above; `src/claude/pricing.ts` |
| "Powered by Claude" with the Claude logo on a dark ground; no Visa logo on either page | `src/ui/logos/README.md`; the page check |

## The four tabs (Home, Watch, Try, Proof; added 2 November)

Home, Watch and Proof are built without hand-typed figures from agent run 1's record (`docs/demo/agent-run.json`,
`npm run autonomy-record` on a copy of the agent-1 ledger; `src/redesign/run.ts`) and, for the Visa card, the live TAP
run's record (`docs/runs/visa-tap-live-2026-11-02.json`). `test/redesign-numbers.test.ts` fails on any number on them
that neither record holds (or that the test does not count again from the record), and `test/browser/redesign.check.ts`
checks them at 390 and 1440 px, light and dark, with a link check. Old addresses redirect: `/live` and `/demo` to `/watch`.

| Claim | Proof |
|---|---|
| "Replay of agent run 1 · 2 Nov · test money · real Claude decisions" | record `run`, `recorded_at`; `agent_stats` (26 of 26 by Claude, 0 fallback) |
| Core sentence: "Claude agents handle the exceptions — price shocks, disputes, rebalancing. Routine runs at code speed. Metal and Airwallex enforce every limit; the CFO approves anything beyond them." | the three moments below; `src/config/brand.ts` `CORE_SENTENCE` |
| The price rise: Stockline 0.02 → 0.04; refused on chain (tx `0x3ad8…a84d`); Treasury replans (`design_rebalance`); 2 of 2 signatures (Max and the test-controller); the mandate replaced, cap 0.04 | record `flows` (refused by metal, with tx), `agent_chat`, `traces`, `decisions` (`P-0003`, "Max & Test-controller · Face ID"), `tower` |
| The dispute: 12 orders checked, the 3 wrong ones (#7, #10, #13) refunded by the Support agent, the CFO rejects the rest (P-0004) | record `traces` (dispute: 12 `verify_order`), `flows` (refunds with tx), `decisions` |
| Earnings and euros: 1.97 swept after finality and booked at Airwallex; the EUR 240.00 licence approved with Face ID; Airwallex refused it (400 `fee_unknown`), nothing paid | record `flows` (sweep tx, deposit), `decisions` (`P-0005` FAILED), `refusals` ("P-0005 failed: Airwallex /transfers/create -> 400 fee_unknown"); the amount from the Treasury agent's own plan in `agent_chat` |
| Scene 3's card buy signed with Visa TAP | the TAP run's record (labelled "TAP run · 2 Nov"), a separate run of the same day |
| Five numbers: 26/26 by Claude; 85 payments inside the limits (62 of them the simulated customer's agent); 4 stopped (2 on chain, 1 by Airwallex, 1 by the CFO); 4 Face ID decisions; $0.0124 Claude cost per decision | record `agent_stats`, `counts.alone`, `flows[].refused`, `decisions`, `proof.face_id`, `agent_stats[].cost_usd_micros` (list prices) |
| Four eyes: "1 of 2 → 2 of 2 signatures", second approver a labelled test passkey | record `decisions[].by`; the run log `docs/runs/2026-11-02-agent-run-1.md` |
| World set-up: "the alternative supplier (Ridgeline) is offline in this world, so the price rise forces a choice. The agents were not told what to do." | the run log; record `agent_chat` (Ridgeline's maintenance notice) |
| Proof: the variation test (20 of 20 by Claude, 0 unsafe, 2 different choices), the switch in dry-118 (Ridgeline online), the red team, system health (353 audit rows, chain intact) | `docs/evals/autonomy-variation.json`, `docs/demo/autonomy.json` (labelled with its own name), `docs/redteam/report.json`, `docs/evals/autonomy-redteam.json`, record `audit` |
| "Built on" Airwallex, Metal, Claude (logos) and "Visa TAP" (text, no logo); the Kit line "· Metal Award + Visa Award" | `src/config/brand.ts` (`VISA_AWARD_ON`, on since the live TAP run and the interop test were green) |

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
| Metal's facilitator refused the price rise against the on-chain mandate | snapshot `rails` | Was "the chain refused". |
| Earnings booked at Airwallex only when final, as a simulated sandbox deposit | snapshot `rails` ("no test USD reached Airwallex") | Was "money reaches the bank". |
| Dispute: Summit is simulated, we filed the claim, nothing refunded, orders 7, 10 and 13 refunded earlier, ran after the run | metal.json `dispute.packs[].refunded_cents`; `docs/runs/2026-10-30-dispute-desk.md` | Was "a customer's agent … none was refunded". |
| 106 with no approval at the time, about half the simulated customer's | snapshot `counts.alone` (see the first table) | Was "with no person needed". |
| 8 stops: 6 payments and 2 planted instructions | snapshot `counts.blocked` (see the first table) | Was "8 payments stopped". |
| Red team: 35 scripted attacks plus 4 Claude-written documents, against in-memory stand-ins; 37 stopped before succeeding (the burst after 30 allowed payments), 2 found afterwards | `docs/redteam/report.json`; `src/redteam/world.ts` | Was "Claude as the attacker … stopped before anything moved". |
| Summit and Stockline are run by us | metal.json payee names | Added to "what is simulated". |
| Offline `/try` reads requests with code only | `src/cli/judge.ts` | Was "needs the live link". |
| Deck: "Metal holds the limit, not only Purser" | The mandate is checked by Metal's facilitator on every payment (`docs/metal-award.md`) | Was "the limit holds even if Purser is wrong". |

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

**What "refused on chain" means here.** Each agent's limits are its mandate, bound on chain in Metal's mandate contract.
When a payment would break them, Metal's facilitator checks it against that on-chain mandate and refuses it before
anything is sent: nothing moves and no transaction reverts (the refusal and its reason, e.g. `mandate_cap_exceeded`,
come back from Metal). `metal-agent mandate pull --record-refusal` can also record such a refusal on chain; the recorded
run did not. Pages say "refused on chain" for this; it is the chain's mandate that refuses, checked before sending.

**Since 30 October 12:23 UTC this is no longer the whole story (Metal QA, 1 November).** Friday run 1 (07:05 UTC, the
recording) predates Purser's spend holds, so its refusal came from Metal. Since the holds (`92408ed`), Purser itself
refuses a payment over the mandate's cap *before anything is signed* (`src/policy/holds.ts`, using the cap of the
credential last bound); Metal never sees it. Every dry run since says "refused before signing" now, with
`refused_by: purser` in its audit row. With the agents on (Thursday), the first such refusal under a mandate is also
put to Metal with `mandate pull --record-refusal`, which records Metal's own refusal on chain in a transaction
(`src/metal/recordRefusal.ts`, sent only when the amount is over the cap written in the bound credential, so it cannot
pay). On-chain refusals already recorded in the four-eyes world: see `docs/runs/2026-10-30-four-eyes.md`.
