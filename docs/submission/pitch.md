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
  named in the row: `stops`, `timings`, `faceIdDecisions`, `split`, `disputeStory`, `fxOf`, `letThroughOf`).
- **README:** [README.md](../../README.md), "The main run" and "What is real, what is mock".
- **Try:** `/try/sign`, its code in `worker/src/trySign.ts` (`FIXED_PROPOSALS`, `checkPayment`) and `src/try/sign.ts`.

Max says the figures as words ("twenty-four"); they are written as digits here so the test can read them.

## 1. The elevator pitch (30 seconds)

| # | Max says | Source |
|---|---|---|
| 1 | AI agents will spend company money. | Problem; the film's first line (`01-line`) |
| 2 | So who holds the pen? | The film's question (`03-pen`) |
| 3 | Purser gives each agent its own Airwallex card and its own Metal mandate. | README, third paragraph |
| 4 | Inside those limits, the agent pays alone. | Form text, Controls ("The agent may: pay inside its card limits and its mandate, alone") |
| 5 | Beyond them, the CFO signs the exact terms with Face ID. | README; `docs/phone-approval.md` (the passkey signs the SHA-256 of the exact terms) |
| 6 | We proved it in one live run, on test money. | Log: the main run, 3 November, Airwallex sandbox and Metal testnet |
| 7 | 24 of 24 decisions were made by Claude, and 2 stopped at a limit. | Record: `split` (24/24), `stops` (Metal 1, CFO 1) |
| 8 | Every id is public. | `/proof`; README, "The main run" |
| 9 | Sign one yourself, at kit11.max-31b.workers.dev/try/sign. | Try: live since 4 November |

About 70 words, 30 seconds with pauses.

## 2. The demo pitch (3 minutes, with the live demo)

The times may shift; the order may not. What is on screen at each step: [demo-day.md](demo-day.md), "The runbook".

| When | Max says | Source |
|---|---|---|
| **0:00 Hook** | AI agents can now spend money. | The film's first line (`01-line`) |
| | So who holds the pen? | The film (`03-pen`) |
| | I'm Max Geurtsen, and this is Purser. | `docs/video/max-opening-close.md` |
| **0:15 Who and what** | Picture the CFO of a small company. | Form text: "Purser is for the CFO or controller of a small company" |
| | Three Claude agents run its business: Sourcing, Support and Treasury. | Record: `snapshot.agent_stats` (three agents) |
| | Between them, they hold 20 test dollars. | README, first lines; `INITIAL_MANDATES` in `src/config/policy.ts` (10.00 + 4.00 + 6.00) |
| | Metal holds each agent's budget on chain; Airwallex holds each card's limit. | `CORE_SENTENCE`, `src/config/brand.ts` |
| **0:35 The run, on /watch** | This is a replay of our main run, on 3 November. | Log; `/watch` label "Replay of the main run, 3 Nov 11:16–11:33 UTC" |
| | The supplier doubles its price, past the Sourcing agent's cap. | Record: Stockline 0.02 → 0.04, cap 0.03 (`homeFilm`) |
| | We let one purchase through on purpose. | Record: `letThroughOf` (`upstream.let_through`, seq 114) |
| | Metal refused it, on chain: here is the transaction. | Record: tx `0x2e92f9cb…1871` (seq 119) |
| | 40 seconds later, Treasury proposes two options within the same 20. | Record: `timings` (toOptions 40); P-0002 and P-0003 |
| | I sign one with Face ID, and a second approver signs too. | Record: P-0002 cosigned 1 of 2, then 2 of 2 |
| | In this demo, that second approver is a labelled test passkey. | `SECOND_APPROVER`, `src/config/brand.ts`; Log, "Approvals" |
| | Then a customer disputes 12 orders, claiming its agent never placed them. | Record: `disputeStory` (12 orders, `never_placed`) |
| | Every order carries that agent's signature. | Record: `disputeStory` (every order `signed_order`) |
| | Support refunds the 3 with wrong data, by itself. | Record: refunds #7, #10, #13, 0.15 test USD |
| | Refund the other 9? | Record: P-0004, `refund_batch` |
| | I reject it with Face ID. | Record: P-0004 rejected by Max, 11:29:37 |
| | Last, a 240 euro licence is due. | Record: P-0005, EUR 240.00 |
| | Treasury plans it, and Airwallex converts only the shortfall: 110 euros. | Record: `fxOf` (EUR 110.00 for USD 124.29) |
| | SWIFT shows PAID 6 seconds after my Face ID. | Record: `timings` (faceToPaid 6) |
| | That settlement is simulated by Airwallex's sandbox. | `SANDBOX_SETTLED`; README: Purser moves SENT and PAID through the sandbox's simulation API |
| **1:50 The jury signs** | Now you hold the pen. | The hook's question, answered; Try: the jury signs itself |
| | Take out your phone and scan this code. | Deck, slide 5; `docs/media/try-sign-qr.png` |
| | You get your own test world, and nothing real moves. | Try: `TRY_SIGN_LABEL` |
| | A rule blocks one payment; you sign the other with Face ID. | Try: `checkPayment` (reserve floor blocks T-0001; T-0002 waits for a signature) |
| | Now I change the amount by one cent. | Try: "Try to tamper: change the amount by 0.01" |
| | The same signature is refused. | Try: "Refused: the same signature does not verify for the changed terms" |
| | One cent. Worthless. | The film (`11-one-cent`) |
| **2:30 Why trust it** | Every id from the run is public, on /proof. | `/proof`; README, "The main run" |
| | The audit log is hash-chained; run npm run verify yourself. | Record: `snapshot.audit` (412 rows, intact); README |
| | Real: the Airwallex sandbox, Metal testnet, Claude and my Face ID. | README, "What is real, what is mock" |
| | Ours or simulated: the supplier, the customer, the merchant, the second approver. | README, "Run by us"; `SECOND_APPROVER` |
| **2:50 Close** | Claude explains and proposes, the rules in code hold every limit, and a person signs before money moves beyond them. | The core line (Max, 5 Nov); `CORE_LINE`, `src/submission/deck.ts` |
| | Purser. | The film's close (`15-close`) |

About 330 words: 2:20 of speech, plus the clicks on /watch and the time the jury needs to scan.

## 3. The full pitch (5 minutes, when there is time)

The 3-minute pitch, with four parts added in this order: the architecture after "Who and what", the models after the
run, the road to production and the business case after "Why trust it". The close stays last.

### 3a. The architecture (after 0:15 "Who and what"; 25 s; deck slide 3)

| Max says | Source |
|---|---|
| Here is the whole design in one line. | Deck, slide 3 |
| A Claude agent explains the situation and proposes a payment. | `docs/claude.md`; Record: 24 decisions |
| Rules in code check every limit before anything moves. | `docs/controls.md` (executor pre-checks) |
| Beyond a limit, a person signs the exact terms with Face ID. | `docs/phone-approval.md` |
| Then Airwallex or Metal moves the money, and the books record it. | README; `npm run books` |
| <!-- T0-STATUS -->Posting those books to T:0 is built, not yet live.<!-- /T0-STATUS --> | README, "Built, not yet live" (T:0 refused the new key on 5 November, `401 CAPI11`); [docs/runs/2026-11-05-t0-live.md](../runs/2026-11-05-t0-live.md) |

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

### 3c. On chain, counted (in "Why trust it"; 15 s; deck slide 7)

| Max says | Source |
|---|---|
| <!-- METAL-ONCHAIN -->On Metal testnet: 86 payments, each its own transaction.<!-- /METAL-ONCHAIN --> | README, "On Metal testnet, checked against the chain on 5 November" (41 sales, 41 supplier purchases, 3 refunds, 1 sweep); Record: `payments` (onChain 86) |
| Plus 6 mandate transactions and Metal's refusal, recorded on chain. | README: 4 mandates bound at setup, 2 replacements, 1 refusal (#24) |
| No emulator and no clearing in this run. | README, same line |
| The euro licence and the card buy ran on Airwallex's sandbox. | README: "Not on Metal: the EUR licence (FX, SWIFT) and the card buy" |

### 3d. The road to production (after "Why trust it"; 25 s; deck slide 9)

| Max says | Source |
|---|---|
| Today this runs on the Airwallex sandbox and Metal testnet. | README; deck slide 9 |
| One company per ledger, with test money only. | Deck slide 9, "Now" |
| Next: keys in a KMS, Postgres, and a pager on the health check. | `docs/roadmap.md`; deck slide 9, "Next" |
| Then Metal mainnet, with four eyes as the default. | Deck slide 9, "Then" |
| Airwallex already offers what comes next: global accounts, local payouts, refunds. | `docs/roadmap.md`, "Airwallex products that fit next" |
| Airwallex's own AgentOS says to require manual approval for agents. | `docs/roadmap.md` (`developer-tools/ai/agentos`) |
| Purser is that approval, on the exact terms, with limits in the rails. | `docs/roadmap.md`, same paragraph |

### 3e. The business case (after the road; 20 s; deck slide 9)

| Max says | Source |
|---|---|
| Who is it for? | Form text, Description ("Purser is for the CFO or controller…") |
| Small cross-border companies on Airwallex that let AI agents spend. | Deck slide 9; form text |
| We charge a monthly fee per company and per active agent. | Deck slide 9 (a plan, not a price list) |
| We take no cut of the payments. | Deck slide 9 |
| Why now? | `docs/claims.md`, market facts |
| In 2025, Mastercard and Google launched protocols for agents that pay. | `docs/claims.md` (Agent Pay, April 2025; AP2, 16 September 2025) |
| Agents can pay now; the pen still has to stay with a person. | Core message; `docs/roadmap.md`, "The CFO keeps the pen" |

About 610 words in all: 4:20 of speech, plus the demo.

## Lines Max never says

- the old line that code makes the decisions and Claude only advises (`test/core-line.test.ts` guards it);
- "Shortlisted", "Finalist" (no official source);
- "safe", "guaranteed", "bank-grade", "fully compliant": no absolute claims;
- that T:0 is live, that the Cardputer is live, or that the second approver was a second person;
- that the SWIFT payment settled for real: PAID is the sandbox's simulated settlement;
- any figure from another run (the 30 October recording, agent run 1, the TAP run) as if it were the main run's.
