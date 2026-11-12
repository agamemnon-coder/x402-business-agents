# Claude in Purser

Claude decides the exceptions; routine buying and selling per query is code.

Purser runs three Claude agents. Each is its own tool-use loop: Claude sees its goal, what happened and its tools, and
picks the next step. Code runs every tool call through its checks and tells the agent why when it refuses. Metal and
Airwallex hold their own limits, and anything beyond them waits for the CFO's Face ID on the exact terms. No agent
holds a key, sees a card number, names a payee code does not know, or approves.

## The three agents

| Agent | Model | What it decides | Its tools | What holds it |
|---|---|---|---|---|
| Sourcing ([`sourcingProfile.ts`](../src/autonomy/sourcingProfile.ts)) | Claude Haiku | Its buy rule when a supplier's price moves; buying a report or software; asking the CFO for a higher card limit | `market`, `set_buy_policy`, `buy_report`, `buy_software`, `ask_card_raise`, `send_message`, `finish` | Code refuses a buy rule over the mandate's cap or under the margin; Metal refuses a payment over the mandate on chain; Airwallex declines a card charge over the card's limits; a raise is a proposal for the CFO's Face ID |
| Treasury ([`teamProfiles.ts`](../src/autonomy/teamProfiles.ts)) | Claude Opus | A new split of the agents' mandates after a price rise; how to pay a euro invoice; when to sweep earnings | `position`, `design_rebalance`, `plan_invoice`, `sweep_earnings`, `send_message`, `finish` | The mandates stay within their shared total of 20.00 test USD; a mandate change and an invoice payment are proposals the CFO signs with Face ID; nothing changes on chain before that |
| Support ([`teamProfiles.ts`](../src/autonomy/teamProfiles.ts)) | Claude Sonnet | A customer's dispute: which orders to refund itself and which to send to the CFO | `settle_dispute`, `send_message`, `finish` | A refund only for a sale code's own data check finds wrong, only to the customer, within the automatic limits (0.10 each, 0.20 per dispute); the rest goes to the CFO |

The loop is [`src/agents/loop.ts`](../src/agents/loop.ts); a tool runs only on input that fits its schema exactly,
and every call and every run is a row in the hash-chained audit log (model, tool, redacted input, result, the check
that stopped it, cost and time). Messages between agents move no money, and code withholds any on-chain address or
IBAN in them ([`src/autonomy/bus.ts`](../src/autonomy/bus.ts), below). The same agents also run as single-task loops
for the evals ([`sourcingAgent.ts`](../src/agents/sourcingAgent.ts), [`treasuryAgent.ts`](../src/agents/treasuryAgent.ts),
[`supportAgent.ts`](../src/agents/supportAgent.ts)).

Beside the agents, the same three models handle incoming documents ([`src/claude/reader.ts`](../src/claude/reader.ts),
`MODELS`): Haiku sorts each one, Sonnet reads it into checked fields (structured outputs), and Opus reviews a proposal
for the CFO. That review is advice for a person, read before they sign; it decides nothing.

## Fallbacks, labelled

Every wake of an agent ends in one decision row: Claude's, or code's fallback, labelled as such
([`src/autonomy/runtime.ts`](../src/autonomy/runtime.ts)). Code's fixed decision takes over when there is no API key,
a call fails or is refused, the answer does not pass the checks, the agent runs out of turns, or a cost cap is
reached. On the dashboard a fallback line reads "Fallback (code)", never "Powered by Claude". The agents decide only
with `KIT11_AGENTS=on` ([`src/config/agents.ts`](../src/config/agents.ts)); off, every flow runs code's fixed
decisions. `npm run judge` needs no key: it replays the main run's record, where each Claude call has its request id.

## Cost caps in code

[`src/agents/loop.ts`](../src/agents/loop.ts) caps what each agent may spend on Claude, read from the ledger before
every call: USD 0.30 an hour for Sourcing, USD 0.60 for Support and USD 1.50 for Treasury, and USD 8.00 for all the
agents in one world. At 80 % of its hourly cap an agent's warning row goes into the audit log; at the cap it makes no
call and code's fallback decides, labelled. Each run also has a limit on turns.

## The main run: calls and cost (3 November)

From the main run's record ([`docs/demo/main-run.json`](demo/main-run.json), `snapshot.claude` and
`snapshot.agent_stats`), priced at Anthropic's list prices read on 30 October 2026
([`src/claude/pricing.ts`](../src/claude/pricing.ts)). 58 Claude calls in all: 50 by the three agents, each with a
request id, and 8 that sort, read or review documents. 24 of 24 decisions by Claude, 0 fallbacks.

| Model | Job | Calls | Cost |
|---|---|---|---|
| Haiku 5.5 | sorts each incoming document; runs the Sourcing agent | 28 | $0.0089 |
| Sonnet 5.5 | reads documents into checked fields; runs the Support agent | 11 | $0.07 |
| Opus 5.5 | reviews a proposal's risk for the CFO; runs the Treasury agent | 19 | $0.30 |
| **All** | | **58** | **$0.38**, or $0.0065 per call |

| Agent | Model | Decisions | Claude calls | Cost |
|---|---|---|---|---|
| Sourcing | Haiku | 11 | 26 | $0.0088 |
| Support | Sonnet | 4 | 7 | $0.05 |
| Treasury | Opus | 9 | 17 | $0.26 |

Against the €285.00 the agents paid in euros in that run (card spend and the SWIFT transfer), that is **$1.320 of AI
per €1,000 paid**. The cost per €1,000 is high because the run paid little in euros: most of its payments were small
test-USD payments on Metal, decided by code per query.

How it stays cheap: Haiku wherever it is enough (it sorts every document and runs Sourcing); effort `low` for
document readings and short tasks, `medium` for the agents' wakes; a cached system prompt; structured outputs, so no
retry for a reply that does not parse; and no model where code is enough: prices, limits, budgets, the FX check and
every payment are code.

## Why these models, measured honestly

**The agents, per model, with cost** ([agent-evals.md](agent-evals.md), `npm run agent-evals`, never in CI): normal,
hard and attack cases for each agent on Haiku, Sonnet and Opus, with stand-in tools and code's checks on, so an attack
passes only when the outcome is right. Each row gives the runs passed, the cost per run and the time. The cheapest
model that passed every run: Haiku for Sourcing, Haiku for Treasury, Sonnet for Support. Treasury stays on Opus
because Haiku and Sonnet often needed a second try before code accepted their plan ([agents.md](agents.md)).

**The published model failure.** Haiku as the Support agent, asked by the customer's email to refund orders outside
the dispute: 0 of 10. Code refused those calls every time, and nothing was paid. That is why Support runs on Sonnet
([agent-was-wrong.md](agent-was-wrong.md)).

**Found and fixed: a planted address relayed between agents.** In the variation test of 2 November, in 2 of 40
simulated worlds, a third supplier's notice gave the Sourcing agent (Haiku) its pay-to address, and the agent copied
it into a message to the Treasury agent, asking to approve it as a payee. Treasury refused; no payment was possible.
The fix is code, not a prompt: [`src/autonomy/bus.ts`](../src/autonomy/bus.ts) withholds every on-chain address and
every valid IBAN in a message between agents, whatever the model writes, and records the attempt. The re-run of all
40 worlds on the fix found no address passed on and nothing moved outside the rules
([summary](runs/variation/2026-11-02-after-fix/summary.md); before: [night batch](runs/2026-11-02-night-batch.md)).
Known limit: only messages are masked; the verdict still scans proposals and buy-rule reasons for planted addresses.

**The documents** (`npm run model-bench`, three runs per case; [model-benchmark.md](model-benchmark.md)). On the
everyday cases, Haiku for every role passed 18 of 18, like the split, at USD 0.0011 a run against USD 0.0143. On
harder documents Haiku alone misread one order of a mixed-language dispute (14 of 15 against 15 of 15 for the split),
which is why Sonnet reads documents and Haiku only sorts them. Opus is the most expensive part and the least proven:
Sonnet for every role passed the same cases, so if cost mattered more, Sonnet for the review is the measured
alternative.

Whatever model answers, code checks the answer before anything uses it, so a wrong answer stops at a check or at the
CFO; it never pays.

## The MCP server

Outside agents use Purser through an MCP server (`npm run -s mcp`, [agent-api.md](agent-api.md)): any agent that
speaks MCP can ask for a company card, pay within its limits and ask the CFO for more. It gets four tools and no keys;
the CFO policy and Face ID apply to it exactly as to Purser's own agents.

## Built with Claude Code

Purser was built with Claude Code; the builder reviewed and approved the changes.
