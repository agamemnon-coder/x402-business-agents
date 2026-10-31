# The Kit 11 agents: Claude decides inside the mandate, the rails enforce it

Each of Kit 11's three agents has its own Claude loop with typed tools (`src/agents/loop.ts`). Inside its mandate it
acts on its own; every tool call goes through the same code checks as before, and Metal and Airwallex enforce the
limits. When Claude is not there, fails, refuses, cannot satisfy the checks, or leaves its job unfinished (the Support
agent must refund or escalate every sale code finds wrong, and send a "refund all" request to the CFO), code's fixed
decision takes over, as in every earlier run, and the log says so.

**Switch.** The agents decide only with `KIT11_AGENTS=on`. Off (the default), every flow runs exactly as in the recorded
runs and dry-12. The switch goes on for a live run once evals, red team and a full dry run are green (Max's kill rule:
Wednesday 4 November, 23:00).

| Agent | Model | What it decides | Its tools | What code checks (the agent cannot get past it) |
|---|---|---|---|---|
| Sourcing (`src/agents/sourcingAgent.ts`) | Haiku | When Stockline's price notice arrives: check the offer against its mandate, serve the next query, see whether Metal lets the purchase through, tell Treasury what it needs | `check_offer`, `try_purchase` (once), `notify_treasury` | Metal refuses a purchase over the mandate's cap on chain; no tool changes a cap, a budget or a payee |
| Treasury (`src/agents/treasuryAgent.ts`) | Opus | The answer to the price rise: new budgets inside 20.00, the Sourcing cap, one or two sell prices, its advice | `submit_plan` | Total at most 20.00; Sourcing's cap exactly the new price; Sourcing's budget never shrinks and covers spend plus one purchase; Support unchanged; Treasury keeps room for the sweep; each price has a margin; a safe replace order. A refused plan goes back with the reasons, three tries, then code's fixed plan. Nothing changes on chain until the CFO and the controller sign with their passkeys |
| Support (`src/agents/supportAgent.ts`) | Sonnet | A customer's dispute: check each order and each delivered stock check, refund the wrong ones itself, send the rest to the CFO with its advice | `verify_order`, `check_data`, `refund`, `escalate_to_cfo` | A refund only for a sale in the dispute that code's own data check finds wrong, within the automatic limits (0.10 each, 0.20 per dispute); no tool takes a payee, so a planted line can make the agent ask, never pay |

**In the log and on the dashboard.** Every tool call and every run is an audit row (model, tool, input redacted, result,
the check that stopped it, cost and time). The dashboard's feed shows each agent's decision in its own words and every
call code refused; the Agents tab shows each agent's decisions, model, cost and time (`test/agent-feed.test.ts`).

**Evals with real models** (`npm run agent-evals`, never in CI): normal, hard and attack cases per agent and model,
with stand-in tools. Results: [agent-evals.md](agent-evals.md). **Re-run on 31 October evening, on the current code,
5 runs per case with the models Purser uses:** Sourcing (Haiku) 10 of 10, Treasury (Opus) 20 of 20, Support (Sonnet)
30 of 30, the attacks included. The Treasury eval now also asserts the rebalance itself (Sourcing's budget grows) and
the option order; before code required both, Opus once kept 10 / 6 / 4 (in 3 runs). With that assertion Haiku and
Sonnet do not pass Treasury reliably (1 of 3 to 3 of 3 per case), so Treasury stays on Opus. **Evals are not the live
result:** across the agents-on dry runs (dry-17 to dry-21) Sourcing decided as expected in 4 of 5 (dry-18 skipped the
purchase; fixed in code), Treasury and Support in 5 of 5. Two misses on other
models, kept as they ran: Haiku as the Support agent, asked to refund orders outside the dispute, refunded the right
three but never sent the rest to the CFO (0 of 3; code refused all nine stray calls); Sonnet as the Sourcing agent once
chose not to try a purchase it knew Metal would refuse (2 of 3), and code then served the query as before. Opus and
Sonnet rebalance (12 / 4 / 4 or 14 / 2 / 4); Haiku as Treasury often leaves the budgets as they are, which is why
Treasury runs on Opus. Found by the
evals and fixed: two Treasury rules that contradicted each other once Treasury had swept (Opus and Sonnet said so
themselves); a plan that cut Sourcing to 1.00; a cap with headroom.

**Dry runs with the agents on** (`KIT11_AGENTS=on` with `test/browser/dryrun.check.ts`): in dry-14 the Sourcing agent
told Treasury "I need the CFO to approve a new per-purchase cap of at least 0.04", Opus's plan was accepted on the
first try, and the Support agent refunded exactly #7, #10 and #13 and sent the other 9 to the CFO. Dry-15 ran the whole
draaiboek with the agents on, two passkeys, the expiry, the mis-tap, network loss, a failed Face ID and a runner restart:
0 failures, `npm run verify` passed every check, nothing paid twice (25 minutes, the 11-minute expiry wait included).

**A fresh review of this code (31 October) found, and we fixed, each with a test:** a retry in the dispute script that
could pay a refund nobody approved (now a retry only repeats a refund that was started); a Support run that ended
without acting counted as settled (now it must be complete, else code settles); the per-dispute limit and "escalate
once" held per run only (now counted from the ledger across runs); the agent's advice inside the terms the CFO signs
(now the reason is code's, the advice goes to the review); Support's budget could grow (now it stays exactly as it is);
failed runs counted as decisions on the dashboard; the prompt itself was not redacted.

**Not (yet) an agent decision.** The sweep's moment and amount and the licence payment stay code's (finality, receive
policy and FX/SWIFT with Face ID as before). Routine purchases per query stay code's inside the mandate; the agent
decides at the price rise.

**Dry-17 and dry-18 (31 October, agents on, fresh worlds).** Dry-17: the whole draaiboek, 43 checks, 0 failures, verify
green, the three agents decided as the evals expect. Dry-18 found a miss: the Sourcing agent (Haiku) checked the offer
and wrote to Treasury without trying the purchase, so code took over that step (safely: nothing extra was paid). Fixed:
`notify_treasury` is refused until `try_purchase` ran, so the agent tries first and then tells; the evals afterwards:
10/10 on Haiku. Dry-18 does not count toward three green in a row; the count starts again with the fix.

## The trace: one decision as a timeline (4.1)

Each agent decision on the dashboard has a **Trace** button on its feed line (and on a refused call's line). It opens
the decision as a timeline, the way LangSmith or Datadog show a request: the model, every tool call with its input,
result and time, what each call caused (a refusal on chain with its tx, a refund, an Airwallex id), the check that
let it through or stopped it, tokens, cost and latency, and every step's hash in the audit chain. It is built from
audit rows only (`src/dashboard/trace.ts`), so the trace is as trustworthy as the chain it reads. Test:
`test/agent-trace.test.ts`; browser check at phone and laptop width, light and dark: `test/browser/trace.check.ts`.

## Pause one agent with Face ID (4.2)

With the agents on, the CFO can pause one agent instead of all (the emergency stop stays for all). The Agents page has
"Pause this agent"; the phone shows the change and Face ID signs it. An approved pause does three things, in this
order, so that a failure always leaves the agent stopped: Purser's switch goes on (its payments are refused before
signing), its Airwallex card goes inactive, and its **Metal mandate is revoked on chain** (`mandate revoke`), so even
a signed payment would be refused there (testnet, 31 October: a payment under the revoked mandate was refused with
`mandate_revoked`). Resuming binds its mandate again: that re-grants spending power, so it is a mandate change and
takes **both passkeys** when four eyes is on; the mandate is restored on chain first, and only then does the switch go
off. Code: `src/policy/pause.ts`, `src/metal/pauseChain.ts`; tests: `test/agent-pause.test.ts`.

**What Metal allows, found on testnet.** A revoked mandate cannot be replaced ("already revoked; bind the new
credential"), and a replacement must leave room above what was spent, so a "zero-room" pause is not possible either.
So resuming binds a fresh mandate with the same cap and **what was left of the budget**: the agent's lifetime limit on
chain stays what the CFO approved. Because that fresh mandate's spend starts at nothing, a later rebalance would not
count what was spent before the pause; code therefore **refuses a mandate change for an agent resumed after a pause**
(`refuseAfterResume`), before anything is issued or signed. In Thursday's run the pause comes after the rebalance.

**Fresh review of 4.1 and 4.2 (31 October, evening).** No way was found for a paused agent, or a document it reads, to
get money moved: every payment path (Metal purchases, refunds, sweeps, card purchases and holds, invoice payments)
checks the pause before signing. Fixed, each with a test: a retried revoke could record an older revoked mandate (now
the one bound last); a rebalance that left the resumed agent out could push the chain's budgets past 20.00 (now any
rebalance after any resume is refused); a revoke cut off by a crash left no alarm (now a health alarm, and the runner
finishes it at start); a resume gave the fresh mandate a new 30-day life (now it keeps the old expiry and never revives
an expired one); a resume after a revoke that never happened blocked rebalances for nothing (now recorded as "not
needed"); Sourcing kept the revoked mandate until a restart (now it looks up the bound one); a trace could show another
task's tool calls (now only its own); a paused agent could not be resumed with the switch off (its rule stays while it
is paused). **Known limit:** pausing counts as tightening, so one Face ID on the phone does it; a compromised relay page
could get a pause signed. That stops an agent, never pays anyone, and is undone with both passkeys.
