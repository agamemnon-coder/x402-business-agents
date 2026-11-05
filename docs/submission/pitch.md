# Purser: the pitch in three lengths

For Max, in English, to say out loud. One sentence per row, at most 14 words, one message each; the only longer one
is the core line, word for word. Every figure is the main run's (3 November 2026, world `main-1`, frozen commit
`35e1cac`), and every row names where it comes from. `test/pitch.test.ts` checks the figures against the record, the
length of each sentence and the core line.

The run order is the film's (`docs/video/premiere-script.md`): the hook, the run, the jury's own signature, why to
trust it, the close. Demo Day timing, clicks and plan B per step: [demo-day.md](demo-day.md). Questions:
[qa.md](qa.md).

**Sources, short:**

- **Log:** [docs/runs/2026-11-03-main-run.md](../runs/2026-11-03-main-run.md), the main run's log.
- **Record:** [docs/demo/main-run.json](../demo/main-run.json), read through `src/redesign/run.ts` (the function is
  named in the row: `stopStory`, `timings`, `faceIdDecisions`, `split`, `disputeStory`, `fxOf`, `letThroughOf`).
- **README:** [README.md](../../README.md), "The main run" and "What is real, what is mock".
- **Try:** `/try/sign`, its code in `worker/src/trySign.ts` (`FIXED_PROPOSALS`, `checkPayment`) and `src/try/sign.ts`.

Max says the figures as words ("twenty-four"); they are written as digits here so the test can read them.

## 1. The elevator pitch (30 seconds)

| # | Max says | Source |
|---|---|---|
| 1 | AI agents will spend company money. | Problem; the film's first line (`01-hook`) |
| 2 | So who signs off? | The film's question (`01-hook`) |
| 3 | Purser gives each agent its own Airwallex card and its own Metal mandate. | README, third paragraph |
| 4 | Inside its limits an agent pays alone; beyond them, the CFO signs. | `RULE_LINE`, `src/submission/deck.ts` (Max, 5 Nov); form text, Controls |
| 5 | We proved it in one live run, on test money. | Log: the main run, 3 November, Airwallex sandbox and Metal testnet |
| 6 | 24 of 24 decisions were made by Claude. | Record: `split` (24/24, 0 fallbacks) |
| 7 | 16 stops, nothing paid over a limit: Claude skipped 12 overpriced checks, Metal refused 2 purchases on chain, the CFO rejected 1 proposal, and 1 planted instruction changed nothing. | Record: `stopStory` (`counts.blocked` 16: Claude 12, #25–#36; Metal 2, #24 over the cap and #37 on a replaced mandate; CFO 1, P-0004; 1 planted instruction; `over_limit_eur` 0.00) |
| 8 | Every id is published. | `/proof`; README, "The main run" |
| 9 | Sign one yourself, at kit11.max-31b.workers.dev/try/sign. | Try: live since 4 November |

About 90 words: 35 seconds at a steady pace (the stops take one sentence of 27 words, as every document says them).

## 2. The demo pitch (3 minutes, with the live demo)

The order (Max, 5 Nov): the hook, who and what, the run in three beats without disclaimers, the disclaimers and the
proof in one go, then the jury's own signature, ending on "One cent. Worthless." The core line comes just before the
tamper, as the rule the tamper proves; slide 10 (the line, the QR again, the links) stays up for the Q&A. What is on
screen at each step: [demo-day.md](demo-day.md), "The runbook".

| When | Max says | Source |
|---|---|---|
| **0:00 Hook** | AI agents can now spend money. | The film's first line (`01-hook`) |
| | So who signs off? | The film (`01-hook`) |
| | I'm Max Geurtsen, and this is Purser. | `docs/video/max-opening-close.md` |
| **0:15 Who and what** | Picture a small company that sells live stock data, per query. | `NORTHWIND_LINE`, `src/config/brand.ts` |
| | Three Claude agents run it: Sourcing, Support and Treasury. | Record: `snapshot.agent_stats` (three agents) |
| | Each has its own Airwallex card and its own Metal mandate. | README, third paragraph |
| | Inside its limits an agent pays alone; beyond them, the CFO signs. | `RULE_LINE` (Max, 5 Nov); form text, Controls |
| | In this demo, I play the CFO. | Log, "Approvals" (CFO = Max) |
| **0:40 The run, on /watch** | A replay of our main run, 3 November. | Log; `/watch` label "Replay of the main run, 3 Nov 11:16–11:33 UTC" |
| | The supplier doubles its price, past the Sourcing agent's cap. | Record: Stockline 0.02 → 0.04, cap 0.03 (`homeFilm`) |
| | We let one purchase through on purpose. | Record: `letThroughOf` (`upstream.let_through`, seq 114); `DEFENSE_IN_DEPTH` |
| | Metal refused it; the refusal is recorded on chain. | `REFUSAL_LINE`; Record: 402 `mandate_cap_exceeded`, tx `0x2e92f9cb…1871` (seq 119) |
| | Treasury proposes two options within the same 20.00. | Record: P-0002 and P-0003, `total_budget` 20.00; `timings` (40 s after the refusal) |
| | Option A: cap 0.04, and our price stays 0.05. | Record: P-0002 terms (option A, Sourcing cap 0.04, `query_price` 0.05) |
| | Option B: the same cap, our price up to 0.07. | Record: P-0003 terms (option B, Sourcing cap 0.04, `query_price` 0.07) |
| | I sign A with Face ID; a second approver co-signs. | Record: P-0002 cosigned 1 of 2, then 2 of 2 |
| | A customer then disputes 12 orders its own agent signed. | Record: `disputeStory` (12 orders claimed `never_placed`; every order `signed_order`) |
| | Support refunds the 3 with wrong data itself. | Record: refunds #7, #10, #13, 0.15 test USD |
| | The rest I reject, with Face ID. | Record: P-0004 (`refund_batch`, the other 9) rejected by Max, 11:29:37 |
| | Last, a 240 euro licence is due. | Record: P-0005, EUR 240.00 |
| | Treasury converts only the shortfall, 110 euros, and pays by SWIFT. | Record: `fxOf` (EUR 110.00 for USD 124.29); transfer `03360bfa…3985` |
| | PAID, 6 seconds after my Face ID. | Record: `timings` (faceToPaid 6) |
| **1:50 Said plainly** | Said plainly: the second approver was a test passkey, and the sandbox simulates settlement. | `SECOND_APPROVER`; Log, "Approvals"; `SANDBOX_SETTLED`; README (Purser moves SENT and PAID through the sandbox's simulation API) |
| | Every id is published on /proof; check it with npm run verify. | `/proof`; Record: `snapshot.audit` (412 rows, intact); README |
| **2:05 The jury signs** | Now you sign off: scan this, now or during the questions. | Deck, slides 5 and 10; `docs/media/try-sign-qr.png` |
| | Your own test world; nothing real moves. | Try: `TRY_SIGN_LABEL` |
| | A rule blocks one payment; you sign the other with your passkey. | Try: `checkPayment` (reserve floor blocks T-0001; T-0002 waits for a signature) |
| | Claude explains and proposes, the rules in code hold every limit, and a person signs before money moves beyond them. | The core line (Max, 5 Nov); `CORE_LINE`, `src/submission/deck.ts` |
| | On mine, signed before, I change the amount by one cent. | Try: "Try to tamper: change the amount by 0.01" (Max's tab, signed before the demo) |
| | The same signature is refused. | Try: "Refused: the same signature does not verify for the changed terms" |
| | One cent. Worthless. | The film (`12-tamper`) |

About 280 words: 2:00 of speech; the rest is clicks on /watch and the pause while the jury scans. If a rehearsal runs
over, cut first "Your own test world; nothing real moves." (the slide says it), then "Last, a 240 euro licence is due."

## 3. The full pitch (5 minutes, when there is time)

The 3-minute pitch, with four parts added in this order: the architecture after "Who and what", the models after the
run, the chain count and the road to production after "Said plainly", the business case after the road. The jury's
own signature and "One cent. Worthless." stay last.

### 3a. The architecture (after 0:15 "Who and what"; 25 s; deck slide 3)

| Max says | Source |
|---|---|
| Here is the whole design in one line. | Deck, slide 3 |
| A Claude agent explains the situation and proposes a payment. | `docs/claude.md`; Record: 24 decisions |
| Rules in code check every limit before anything moves. | `docs/controls.md` (executor pre-checks) |
| Beyond a limit, a person signs the exact terms with Face ID. | `docs/phone-approval.md` |
| Then Airwallex or Metal moves the money, and the books record it. | README; `npm run books` |
| <!-- T0-STATUS -->T:0 bookkeeping is built; posting failed, so nothing is posted.<!-- /T0-STATUS --> | `T0_STATUS` (README, form, claims, `docs/t0.md`): "posting failed (shared key 403 CAPI71 on 3 Nov, new key 401 CAPI11 on 5 Nov)"; [docs/runs/2026-11-05-t0-live.md](../runs/2026-11-05-t0-live.md) |

### 3b. Why three models (after the run; 30 s; deck slide 8)

| Max says | Source |
|---|---|
| Sourcing runs on Haiku, Support on Sonnet, Treasury on Opus. | Record: `snapshot.agent_stats[].models` |
| We measured whether we need all three. | `docs/model-benchmark.md` (`npm run model-bench`) |
| On everyday cases, Haiku alone was just as good. | `docs/claude.md`: Haiku for every role, 18 of 18 |
| On a harder dispute, Haiku alone misread one order. | `docs/claude.md`: 14 of 15 against 15 of 15 |
| So Sonnet reads the documents that move money. | `docs/claude.md`, "Why these models" |
| Opus is the least proven; a person reads its advice before signing. | `docs/claude.md`: "the most expensive part and the least proven" |
| All 24 decisions together cost USD 0.3170 in Claude calls. | Record: `agent_stats[].cost_usd_micros` (316,966 µUSD); Log, "Cost" |

### 3c. On chain, counted (after "Said plainly"; 15 s; deck slide 7)

| Max says | Source |
|---|---|
| <!-- METAL-ONCHAIN -->On Metal testnet: 86 payments, each its own transaction, on chain and checkable.<!-- /METAL-ONCHAIN --> | README, "On Metal testnet, checked against the chain on 5 November" (41 sales, 41 supplier purchases, 3 refunds, 1 sweep); Record: `payments` (onChain 86) |
| Plus 6 mandate transactions and Metal's refusal, recorded on chain. | README: 4 mandates bound at setup, 2 replacements, 1 refusal (#24) |
| No emulator and no clearing in this run. | README, same line |
| The euro licence and the card buy ran on Airwallex's sandbox. | README: "Not on Metal: the EUR licence (FX, SWIFT) and the card buy" |

### 3d. The road to production (after the chain count; 25 s; deck slide 9)

| Max says | Source |
|---|---|
| Today this runs on the Airwallex sandbox and Metal testnet. | README; deck slide 9 |
| One company per ledger, with test money only. | Deck slide 9, "Now" |
| Next: keys in a KMS, Postgres, and a pager on the health check. | `docs/roadmap.md`; deck slide 9, "Next" |
| Then Metal mainnet, with four eyes as the default. | Deck slide 9, "Then" |
| Airwallex already offers what comes next: global accounts, local payouts, refunds. | `docs/roadmap.md`, "Airwallex products that fit next" |
| Airwallex's own AgentOS says to require manual approval for agents. | `docs/roadmap.md` (`developer-tools/ai/agentos`) |
| Purser is that approval, on the exact terms, with limits in the rails. | `docs/roadmap.md`, same paragraph |

### 3e. The business case (after the road; 20 s; no slide)

| Max says | Source |
|---|---|
| Who is it for? | Form text, Description ("Purser is for the CFO or controller…") |
| Small cross-border companies on Airwallex that let AI agents spend. | `docs/roadmap.md`; form text |
| We charge a monthly fee per company and per active agent. | Business model (a plan, not a price list), earlier deck |
| We take no cut of the payments. | Same plan |
| Why now? | `docs/claims.md`, market facts |
| In 2025, Mastercard and Google launched protocols for agents that pay. | `docs/claims.md` (Agent Pay, April 2025; AP2, 16 September 2025) |
| Agents can pay now; the pen still has to stay with a person. | Core message; `docs/roadmap.md`, "The CFO signs off" |

About 640 words in all: 4:30 of speech, plus the demo.

## Lines Max never says

- the old line that code makes the decisions and Claude only advises (`test/core-line.test.ts` guards it);
- "Shortlisted", "Finalist" (no official source);
- "safe", "guaranteed", "bank-grade", "fully compliant": no absolute claims;
- that T:0 is live, that the Cardputer is live, or that the second approver was a second person;
- that the SWIFT payment settled for real: PAID is the sandbox's simulated settlement;
- any figure from another run (the 30 October recording, agent run 1, the TAP run) as if it were the main run's.
