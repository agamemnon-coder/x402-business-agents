# The Kit 11 agents: Claude decides inside the mandate, the rails enforce it

Each of Kit 11's three agents has its own Claude loop with typed tools (`src/agents/loop.ts`). Inside its mandate it
acts on its own; every tool call goes through the same code checks as before, and Metal and Airwallex enforce the
limits. When Claude is not there, fails, refuses, or cannot satisfy the checks, code's fixed decision takes over, as in
every earlier run, and the log says so.

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
with stand-in tools, 3 runs each. Results: [agent-evals.md](agent-evals.md). With the models Purser uses (Sourcing on
Haiku, Treasury on Opus, Support on Sonnet) every case passed 3 of 3, the five attacks included. Two misses on other
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

**Not (yet) an agent decision.** The sweep's moment and amount and the licence payment stay code's (finality, receive
policy and FX/SWIFT with Face ID as before). Routine purchases per query stay code's inside the mandate; the agent
decides at the price rise.
