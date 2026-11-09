# Purser: the pitch

For Max, in English, to say out loud. First the **Demo Day pitch** (3 minutes, in the site's order: Home, Watch, the
live demo of `/try/sign`, then the proof);
below it the earlier three lengths, kept for when there is no live demo (the 3-minute version there plays the main
run's replay instead). One sentence per row, at most 14 words, one message each; the only longer one is the core line,
word for word. Every figure is the main run's (3 November 2026, world `main-1`, frozen commit `35e1cac`) or a dated
record's, and every row names where it comes from. `test/pitch.test.ts` checks the figures against the record and the
length of each sentence; `test/demo-day-pack.test.ts` checks the Demo Day pitch's words against its timing.

Demo Day timing, clicks and a fallback per step: [demo-day.md](demo-day.md). Questions: [qa.md](qa.md). One page
beside the laptop: [cheat-sheet.pdf](cheat-sheet.pdf).

**Sources, short:**

- **Log:** [docs/runs/2026-11-03-main-run.md](../runs/2026-11-03-main-run.md), the main run's log.
- **Record:** [docs/demo/main-run.json](../demo/main-run.json), read through `src/redesign/run.ts` (the function is
  named in the row: `stopStory`, `timings`, `faceIdDecisions`, `split`, `disputeStory`, `fxOf`, `letThroughOf`).
- **README:** [README.md](../../README.md), "The main run" and "What is real, what is mock".
- **Try:** `/try/sign`, its code in `worker/src/trySign.ts` (`FIXED_PROPOSALS`, `checkPayment`) and `src/try/sign.ts`.
- **Airwallex read back (6 November, GET only):** [the transfer](../runs/airwallex-transfer-approval-2026-11-06.json)
  and [the cards](../runs/airwallex-cards-2026-11-06.json), matched to the record in `src/redesign/airwallexProof.ts`.
- **Business case (a hypothesis, not validated):** [docs/business/](../business/README.md).

Max says the figures as words ("twenty-four"); they are written as digits here so the test can read them.

## Demo Day: the 3-minute pitch (19 November)

Four parts, in the site's order (Max, 7 Nov): Home, then Watch, then the live demo of `/try/sign`, then the proof. Max
speaks at about **2.3 words a second**; each part's budget is its seconds times 2.3, and the words written stay under
it, so the taps, the Face ID prompts and the tab switches fit in the rest. The words are counted the way
`test/demo-day-pack.test.ts` counts them (the "Max says" column only).

- **The problem, and the agents at work:** 0:00–0:20 (20 s); budget 46 words; written 40 words; about 17 s of speech, 3 s
  for one click.
- **Live: sign, cheat, trick, change the rule:** 0:20–1:30 (70 s); budget 161 words; written 117 words; about 51 s of
  speech, 19 s for three Face ID prompts, the fake invoice and the server's answers.
- **The proof:** 1:30–2:20 (50 s); budget 115 words; written 111 words; about 48 s of speech, 2 s for two tab
  switches (tight: cut the Airi line first if it runs over).
- **The business and the ask:** 2:20–3:00 (40 s); budget 92 words; written 84 words; about 37 s of speech, 3 s for a
  pause.
- **Total:** 3:00; budget 414 words; written 352 words; about 2:33 of speech, 27 s for taps and pauses.

Before you start: the laptop's shared screen shows Home ([kit11.max-31b.workers.dev](https://kit11.max-31b.workers.dev/)).
Your iPhone is mirrored to the screen (the path tested on 6 November: Safari, Face ID), with `/try/sign` opened a minute
before you start (the test world opens when the page is shown, and its agents start at once, with a fresh FX quote
that lasts up to 15 minutes; if it has run out, the page offers **Get a new quote**). Tabs on the laptop: Home,
[/watch](https://kit11.max-31b.workers.dev/watch), [/proof](https://kit11.max-31b.workers.dev/proof),
[/metal](https://kit11.max-31b.workers.dev/metal), the deck (slide 12, the QR). If the room cannot show a phone, run
`/try/sign` in the laptop's browser instead (Touch ID). What to do when a step fails: [demo-day.md](demo-day.md), "The
Demo Day script".

### 0:00–0:20 · The problem, and the agents at work

| Do | Max says | Source |
|---|---|---|
| Laptop: Home. Look at the jury, not the screen. | AI agents are starting to spend company money. | [docs/business/problem.md](../business/problem.md), "Why now (sourced)" |
| | But a prompt is not a financial control; Airwallex says so itself. | [docs/business/problem.md](../business/problem.md) [S1]: "A prompt is not a financial control." (Airwallex, 5 October 2026) |
| Pause one beat. | So who signs off? | The film's hook (`01-hook`) |
| Click **Start: watch the agents**: [/watch](https://kit11.max-31b.workers.dev/watch) plays the main run. | This is Purser: three Claude agents running a company, replayed. | `START` and `FLOW` (`src/redesign/home.ts`); `/watch` label "Replay of the main run" (`runLabel`, `src/redesign/run.ts`) |
| Pick up the phone. | Now I take the CFO's chair. | Home's step 2, "Try it yourself" (`FLOW`) |

### 0:20–1:30 · Live: sign, cheat, trick, change the rule (`/try/sign`)

| Do | Max says | Source |
|---|---|---|
| Hold the phone up; the mirror shows `/try/sign`, opened a minute before. | Live, on my phone, in a test world; nothing real moves. | `TRY_SIGN_LABEL` (`src/try/sign.ts`); `TRY_SIGN_TTL_MS`, one hour (`worker/src/trySign.ts`) |
| Point at the heading. | My Treasury agent wants to pay an invoice above its limit. | `TRY_SIGN_SCREENS.ask.head` (`src/try/sign.ts`); T-0002 in `FIXED_PROPOSALS` (`worker/src/trySign.ts`) |
| Point at the agents' steps and the advice. | Claude Sonnet read the invoice, code checked it, and Claude Opus advises. | Screen 1's live agents (`AGENT_STEPS`, `worker/src/trySign.ts`): Sonnet reads, Purser's code checks and writes the terms, Opus advises, each labelled live, recorded or fixed |
| Tap **Sign with Face ID** (two prompts: the test passkey, then the signature). Wait for the green check. | My Face ID signs the hash of exactly these terms. | `src/try/sign.ts`: one button, the passkey made on the way |
| Tap **Now try to cheat: change one cent**. | Now I change one cent, and send the same signature. | `TRY_SIGN_SCREENS.signed.cheat`; the same verifier checks the changed terms (`worker/src/trySign.ts`) |
| Point at the red line. | One cent changed. The signature is worthless. | `TAMPER_VERDICT.cent` (`src/try/sign.ts`) |
| Tap **Next: trick the agent**, then a fake invoice. | Now a fake invoice: Claude Sonnet reads it, live. | `TRY_SIGN_SCREENS.trick` (`src/try/sign.ts`); `ATTACKS`, `runTrick` (`worker/src/trick.ts`) |
| Point at the verdict. | Whatever it reads, Purser's code blocks it. | `TRICKS` (`worker/src/trick.ts`): each fake invoice blocked by Purser's own fraud and injection code |
| Tap **Next: change the rule**, then **€2,000**. | Now I let the agent pay up to two thousand alone. | `TRY_SIGN_SCREENS.rule` (`src/try/sign.ts`) |
| Point at the worst case. | Here is my worst case, in one line. | `TRY_SIGN_SCREENS.rule.worst`; `worstAloneLine` (`src/try/sign.ts`) |
| Tap **Sign with Face ID**. | A looser rule needs my signature too. | `setPolicy` (`worker/src/trySign.ts`): looser needs a signature, stricter applies at once |
| Point at the green card. | Its next invoice: paid alone, no signature needed. | `NEXT_INVOICE` and `runAlone` (`worker/src/trySign.ts`) |
| Tap **Finish**: the closing card. Put the phone down. | That's Purser, in about a minute. | `TRY_SIGN_SCREENS.done` (`src/try/sign.ts`) |

### 1:30–2:20 · The proof

| Do | Max says | Source |
|---|---|---|
| Laptop: tab [/proof](https://kit11.max-31b.workers.dev/proof), at "The hash the CFO signed travels with the payment." | Proof one, from that run: Airwallex's record of our 240 euro SWIFT payment. | [airwallex-transfer-approval-2026-11-06.json](../runs/airwallex-transfer-approval-2026-11-06.json): transfer `03360bfa…3985`, EUR 240, SWIFT, PAID (read with GET only) |
| Point at the two hashes, side by side. | It carries the hash I signed with Face ID. | Same record, `metadata.approval_sha256` `797d4483…abcd` = P-0005's `terms_sha256`, approved by Max with his passkey (record seq 360); matched in code (`hashTravel`, `src/redesign/airwallexProof.ts`) |
| | All 3 agent cards carry my policy as Airwallex's own controls. | [airwallex-cards-2026-11-06.json](../runs/airwallex-cards-2026-11-06.json); `cardControlRows`: 3 of 3 cards match the CFO policy |
| Point at awx-1 below, "a separate run · Airwallex sandbox, test money". | On 7 November, an Airwallex-only run passed every check. | [docs/runs/2026-11-07-awx-1.md](../runs/2026-11-07-awx-1.md): ACCEPTED, checks a–g all passed; on `/proof` through `awxRunBlock` (`src/redesign/awxRun.ts`) |
| Scroll up to the Airi run under the partners: ✓ Paid alone · ✓ Paid after Face ID · ✕ Refused by Purser. | Agents also paid with Visa Intelligent Commerce, through Airwallex's Airi. | [docs/runs/2026-11-07-vic-1.md](../runs/2026-11-07-vic-1.md): PASSED, 5 of 5 checks (Airwallex sandbox, test card, test money); on `/proof` through `airiRunBlock` (`src/redesign/airiRun.ts`) |
| Tab [/metal](https://kit11.max-31b.workers.dev/metal); point at #24's refusal and its tx. | Proof two: each agent has its own mandate on Metal. | `/metal` (`src/redesign/metalStory.ts`): one mandate per agent, on chain |
| | We switched off our own check once; Metal refused purchase 24 anyway. | `CHAIN_TEST`; Record: `mandate_cap_exceeded`, tx `0x2e92f9cb…1871` |
| | That refusal is on chain, next to 86 payments, each its own transaction. | README, "On Metal testnet"; Record: `payments` (onChain 86) |
| Back to [/proof](https://kit11.max-31b.workers.dev/proof), the Claude figure. | Proof three: Claude made 24 of 24 decisions, with 0 fallbacks. | Record: `split` (24 of 24, 0 fallbacks) |
| | Said plainly: the second approver was a test passkey, and settlement is simulated. | `SECOND_APPROVER`; `SANDBOX_SETTLED` (`src/config/brand.ts`); README, "What is real, what is mock" |

### 2:20–3:00 · The business and the ask

| Do | Max says | Source |
|---|---|---|
| Deck slide 12: the QR to `/try/sign`. | Purser is for finance teams on Airwallex whose AI agents spend money. | [docs/business/model.md](../business/model.md), "Who buys and who uses it (hypothesis)" |
| | Inside its limits an agent pays alone; beyond them, the CFO signs. | `RULE_LINE` (`src/submission/deck.ts`) |
| | We'd charge a monthly fee per company, with agents included. | [docs/business/model.md](../business/model.md), "Intended pricing (hypothesis)" |
| | That is a hypothesis: no customer has seen a price yet. | [docs/business/model.md](../business/model.md): "no customer has seen a price" |
| | The more agent features Airwallex ships, the more there is to govern. | [docs/business/model.md](../business/model.md), "Risks": "the more there is for Purser to govern" |
| Look at the jury. | Our ask: we're looking for design partners on Airwallex. | The ask; [docs/business/roadmap.md](../business/roadmap.md): "Test the demand hypothesis" comes first |
| | Finance teams whose agents already spend, or soon will. | [docs/business/model.md](../business/model.md), "Buyer" (hypothesis) |
| Point at the QR; leave it up for the questions. | Scan the code, and sign one yourself. | Deck slide 12; `docs/media/try-sign-qr.png` |
| | Thank you. | Max |

If a part runs over in rehearsal, cut in this order: "Agents also paid with Visa Intelligent Commerce…" (the screen
shows the badges), then "Here is my worst case, in one line." (the screen shows it), then
"Finance teams whose agents already spend, or soon will.", then "The more agent features Airwallex ships…".

## 1. The elevator pitch (30 seconds)

| # | Max says | Source |
|---|---|---|
| 1 | AI agents will spend company money. | Problem; the film's first line (`01-hook`) |
| 2 | So who signs off? | The film's question (`01-hook`) |
| 3 | Purser gives each agent its own Airwallex card and its own Metal mandate. | README, third paragraph |
| 4 | Inside its limits an agent pays alone; beyond them, the CFO signs. | `RULE_LINE`, `src/submission/deck.ts` (Max, 5 Nov); form text, Controls |
| 5 | We proved it in one live run, on test money. | Log: the main run, 3 November, Airwallex sandbox and Metal testnet |
| 6 | 24 of 24 decisions were made by Claude. | Record: `split` (24/24, 0 fallbacks) |
| 7 | 16 stops, nothing paid over a limit: a buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing. | Record: `stopStory` (`counts.blocked` 16: the buy rule Claude set, applied by code, 12, #25–#36; Metal 2, #24 over the cap and #37 on a replaced mandate; CFO 1, P-0004; 1 planted instruction; `over_limit_eur` 0.00) |
| 8 | Every id is published. | `/proof`; README, "The main run" |
| 9 | Sign one yourself, at kit11.max-31b.workers.dev/try/sign. | Try: live since 4 November |

About 90 words: 35 seconds at a steady pace (the stops take one sentence of 27 words, as every document says them).

## 2. The demo pitch (3 minutes, with the live demo)

The order (Max, 5 Nov): the hook, who and what, the run in three beats without disclaimers, the disclaimers and the
proof in one go, then the jury's own signature, ending on "One cent. Worthless." The core line comes just before the
tamper, as the rule the tamper proves; slide 12 (the road, the line, the QR again, the links) stays up for the Q&A. What is on
screen at each step: [demo-day.md](demo-day.md), "The runbook".

| When | Max says | Source |
|---|---|---|
| **0:00 Hook** | AI agents are starting to spend money. | The film's first line (`01-hook`), in the site's wording since the jury review of 7 Nov (the film says “can now”) |
| | So who signs off? | The film (`01-hook`) |
| | I'm Max Geurtsen, and this is Purser. | Max, live (the film's narrator, an AI voice, says “This is Purser, built by Max Geurtsen.”: `docs/video/narrator-script.md`) |
| **0:15 Who and what** | Picture a small company that sells live stock data, per query. | `NORTHWIND_LINE`, `src/config/brand.ts` |
| | Three Claude agents run it: Sourcing, Support and Treasury. | Record: `snapshot.agent_stats` (three agents) |
| | Each has its own Airwallex card and its own Metal mandate. | README, third paragraph |
| | Inside its limits an agent pays alone; beyond them, the CFO signs. | `RULE_LINE` (Max, 5 Nov); form text, Controls |
| | In this demo, I play the CFO. | Log, "Approvals" (CFO = Max) |
| **0:40 The run, on /watch** | A replay of our main run, 3 November. | Log; `/watch` label "Replay of the main run, 3 Nov 11:16–11:33 UTC" |
| | The supplier doubles its price, past the Sourcing agent's cap. | Record: Stockline 0.02 → 0.04, cap 0.03 (`homeFilm`) |
| | We switched off our own check once to prove the chain holds the line. | Record: `letThroughOf` (`upstream.let_through`, seq 114); `CHAIN_TEST`, `DEFENSE_IN_DEPTH` |
| | Metal refused it; the refusal is recorded on chain. | `REFUSAL_LINE`; Record: 402 `mandate_cap_exceeded`, tx `0x2e92f9cb…1871` (seq 119) |
| | Treasury proposes two options within the same 20.00. | Record: P-0002 and P-0003, `total_budget` 20.00; `timings` (40 s after the refusal) |
| | Option A: cap 0.04, and our price stays 0.05. | Record: P-0002 terms (option A, Sourcing cap 0.04, `query_price` 0.05) |
| | Option B: the same cap, our price up to 0.07. | Record: P-0003 terms (option B, Sourcing cap 0.04, `query_price` 0.07) |
| | I sign A with Face ID; a second approver co-signs. | Record: P-0002 cosigned 1 of 2, then 2 of 2 |
| | A customer disputes 12 orders its own agent signed. | Record: `disputeStory` (12 orders claimed `never_placed`; every order `signed_order`) |
| | Support refunds the 3 with wrong data itself. | Record: refunds #7, #10, #13, 0.15 test USD |
| | The rest I reject, with Face ID. | Record: P-0004 (`refund_batch`, the other 9) rejected by Max, 11:29:37 |
| | Last, a 240 euro licence is due. | Record: P-0005, EUR 240.00 |
| | Treasury converts only the shortfall, 110 euros, and pays by SWIFT. | Record: `fxOf` (EUR 110.00 for USD 124.29); transfer `03360bfa…3985` |
| | Airwallex accepts it with my signed hash. | Record: transfer `03360bfa…3985`, metadata `approval_sha256` |
| **1:50 Said plainly** | Said plainly: the second approver was a test passkey, and the sandbox simulates settlement. | `SECOND_APPROVER`; Log, "Approvals"; `SANDBOX_SETTLED`; README (Purser moves SENT and PAID through the sandbox's simulation API) |
| | Every id is published on /proof; check it with npm run verify. | `/proof`; Record: `snapshot.audit` (412 rows, intact); README |
| **2:05 The jury signs** | Now you sign off: scan this, now or during the questions. | Deck, slides 4 and 12; `docs/media/try-sign-qr.png` |
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

### 3c. On chain, counted (after "Said plainly"; 15 s; deck slide 10)

| Max says | Source |
|---|---|
| <!-- METAL-ONCHAIN -->On Metal testnet: 86 payments, each its own transaction, on chain and checkable.<!-- /METAL-ONCHAIN --> | README, "On Metal testnet, checked against the chain on 5 November" (41 sales, 41 supplier purchases, 3 refunds, 1 sweep); Record: `payments` (onChain 86) |
| Plus 6 mandate transactions and Metal's refusal, recorded on chain. | README: 4 mandates bound at setup, 2 replacements, 1 refusal (#24) |
| No emulator and no clearing in this run. | README, same line |
| The euro licence and the card buy ran on Airwallex's sandbox. | README: "Not on Metal: the EUR licence (FX, SWIFT) and the card buy" |

### 3d. The road to production (after the chain count; 25 s; deck slide 12)

| Max says | Source |
|---|---|
| Today this runs on the Airwallex sandbox and Metal testnet. | README; deck slide 12 |
| One company per ledger, with test money only. | Deck slide 12, "Now" |
| Next: keys in a KMS, Postgres, and a pager on the health check. | `docs/roadmap.md`; deck slide 12, "Next" |
| Then Metal mainnet, with four eyes as the default. | Deck slide 12, "Then" |
| Airwallex already offers what comes next: global accounts, local payouts, refunds. | `docs/roadmap.md`, "Airwallex products that fit next" |
| Airwallex's own AgentOS says to require manual approval for agents. | `docs/roadmap.md` (`developer-tools/ai/agentos`) |
| Purser is that approval, on the exact terms, with limits in the rails. | `docs/roadmap.md`, same paragraph |

### 3e. The business case (after the road; 20 s; deck slide 11)

| Max says | Source |
|---|---|
| Who is it for? | [docs/business/model.md](../business/model.md), "Who buys and who uses it (hypothesis)" |
| Finance teams at small companies on Airwallex whose AI agents pay. | `WHY_COMPANY` "Who buys" in `src/config/brand.ts`, as the README and /proof's "Why this is a company" say it; [model.md](../business/model.md) |
| The CFO uses it and decides. | Same line; [model.md](../business/model.md), the user and the decider |
| €49 a company a month, five agents included; a hypothesis. | `PRICE_LINE` in `src/config/brand.ts` (the form's Description, "The business"); [model.md](../business/model.md), "Intended pricing (hypothesis)" |
| Why now? | [docs/business/problem.md](../business/problem.md), "Why now (sourced)" |
| Airwallex wrote it on 5 October: limits belong in infrastructure, not prompts. | [problem.md](../business/problem.md) [S1] (Airwallex, "Agentic banking starts with governance") |
| Agents can pay now; the sign-off still has to stay with a person. | Core message; `docs/roadmap.md`, "The CFO signs off" |

About 640 words in all: 4:30 of speech, plus the demo.

## Lines Max never says

- the old line that code makes the decisions and Claude only advises (`test/core-line.test.ts` guards it);
- "Shortlisted", "Finalist" (no official source);
- "safe", "guaranteed", "bank-grade", "fully compliant": no absolute claims;
- that T:0 is live, that the Cardputer is live, or that the second approver was a second person;
- that the SWIFT payment settled for real: PAID is the sandbox's simulated settlement;
- any figure from another run (the 30 October recording, agent run 1, the TAP run) as if it were the main run's.
