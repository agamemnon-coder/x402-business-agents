# Business model: a hypothesis

**Everything on this page is a hypothesis.** **We have not validated demand with customers yet:** no customer
interviews, no discovery, no pilots, no letters of intent, no revenue. The buyer, the channel and the price below are
what we would test first, not what we have found. Outside facts carry a source we opened on the date given.

Back to the [business case index](README.md). The problem it answers: [problem.md](problem.md).

## Who buys and who uses it (hypothesis)

| Role | Who (hypothesis) | What they would need from Purser (hypothesis) |
|---|---|---|
| **Buyer** | The finance team of an SMB or scale-up that already banks with Airwallex and lets AI agents pay for things: procurement, SaaS seats, data and APIs, travel | Agents that can pay without a shared card, and limits the agents cannot talk their way past |
| **User** | The CFO or financial controller | Sets each agent's limits once; approves only what is over them, on a phone, against the exact terms; reads one audit trail |
| **Decider** | The CFO | Signs off on the policy and on the tool itself |

Why "already on Airwallex" (our reasoning): Purser's card controls are Airwallex Issuing's own limits, so a company
that already has Airwallex accounts and cards has the least to set up. This is a narrowing choice for a first test,
not a finding about where demand is.

## Go-to-market (hypothesis)

- **A layer on top of Airwallex.** Purser would be offered to Airwallex customers as an integration, for example as an
  Airwallex app or an embedded partner, if Airwallex agrees. We have no agreement with Airwallex and have not asked
  for one. Airwallex's public pricing page sends "Platform API, Embedded Finance and High Volume use cases" to custom
  pricing [P1], so the cost of that route to us is unknown.
- **Plus Metal for on-chain agent payments.** For agents that pay per request over x402, the same CFO policy sets a
  Metal mandate per agent. Metal states that agents can pay "from an account whose owner set spending limits on
  chain" [P4]. Purser has run on Metal testnet only.
- **Why this channel (our reasoning):** Airwallex itself says agent money movement needs "approvals, permissions, and
  audit trails" enforced "through underlying infrastructure rather than prompts" [P3]. A product that does exactly that
  on Airwallex's own rails is easiest to explain to Airwallex's customers. It also makes us dependent on Airwallex
  (see the risks below).

## Intended pricing (hypothesis)

**€49 per company a month, including 5 agents and 1,500 Claude decisions; €10 per extra agent; €3 per extra 100 decisions.** This is our assumption; no customer has seen a price.

Why this shape (our reasoning): a CFO already pays per card user for spend software, so a base fee with a number of
agents included reads the same way. Claude's cost is per decision, so the price includes a number of decisions and
charges for more; without that, a busy agent would cost more than it pays ([unit economics](#unit-economics-hypothesis)
below). The comparables below are what spend-management tools charge for a **person**
with a card, not for an agent, so they are a reference point only.

**Comparables (public pricing pages, read 6 November 2026):**

| Tool | Public price | Source |
|---|---|---|
| Airwallex (EU plans) | Explore €0 or €19 a month; Grow €49 a month. Spend users: 5 free, then €6 per additional employee card user a month (Explore) or €12 per additional active spend user a month (Grow). Prices in EUR, VAT exclusive | [P1] |
| Pleo (UK plans, small businesses) | Start £8, Build £14, Optimise £18 per user a month (Build and Optimise billed yearly, 3 users minimum) | [P2] |

Our base price, with 5 agents included, sits inside the band these tools charge for one human card user. That anchor is our assumption, not a finding.

What could make us change it: a per-agent fee nudges customers to put several jobs behind one agent and one card,
which undoes the control we sell (one agent, one card, one set of limits); and the price does not grow with the money
at risk. A fee on governed spend would answer both, but we found no public spend-management price of that kind.

**Compared with after-the-fact control (qualitative only).** Expense review after the fact finds a bad payment once
the money has gone; Purser's limits and approvals act before it leaves. We have no sourced figure for what after-the-fact
control costs a finance team, so we make no saving claim. Our only measured cost figures are for the demo's own
agents, in test money: [unit-economics.md](../unit-economics.md).

<!-- unit-economics -->
## Unit economics (hypothesis)

**A hypothesis, not a result.** What a company's agents would cost Purser a month, against the intended price above.
The measured part comes from the main run of 3 November 2026; everything else is a price we read, with its page and
date, or an assumption stated below (approved by Max on 6 November 2026, with the price changed to include
decisions). The numbers are computed by `src/business/unitEconomics.ts`; `test/unit-economics-hypothesis.test.ts`
checks that every number in this section is what it computes from the record and the assumptions, and that none is
unsourced.

### Measured in the main run

| Main run, 3 November 2026 [R1] | Sourcing (Haiku) | Support (Sonnet) | Treasury (Opus) | All agents |
| --- | ---: | ---: | ---: | ---: |
| Decisions | 11 | 4 | 9 | 24 |
| Claude, the agent's own calls (USD, list prices [U1]) | 0.0088 | 0.0500 | 0.2582 | 0.3170 |
| Per decision (USD) | 0.0008 | 0.0125 | 0.0287 | 0.0132 |
| Every Claude call of the run, documents and reviews included (USD) |  |  |  | 0.3761 |
| Per decision, everything included (USD) |  |  |  | 0.0157 |

**Claude per decision: USD 0.0132 for the agents' own calls, USD 0.0157 for every Claude call of the run.** The
agents' own calls (`agent_stats`) come to USD 0.3170 for 24 decisions, the figure in [claims.md](../claims.md). The
run's whole Claude bill (`snapshot.claude`) is USD 0.3761: it also sorted and read the documents and ran the Opus
reviews for the CFO, USD 0.0592 or 16% of the bill, which 0.0132 leaves out. This model uses the whole bill.

**In the main run, Claude made 24 decisions; of the 88 payments, 82 were routine sales and purchases that code handled inside the limits.** The 24 decisions are not one per payment: they are the agents' checks, plans, proposals, a dispute
ruling and timing advice, several of which moved no money. The 88 payments are 86 on Metal (41 sales, 41 supplier
purchases, 3 refunds, 1 sweep), 1 card charge and 1 SWIFT transfer [R1].

### Assumptions (hypothesis)

| # | Assumption (hypothesis) | Value | Why |
| --- | --- | --- | --- |
| A1 | Price | €49 per company a month, including 5 agents and 1,500 Claude decisions; €10 per extra agent; €3 per extra 100 decisions. VAT excluded; a company of 5 agents (no extra agents); extra decisions billed per started block of 100 | The intended pricing above (hypothesis); no customer has seen it. Claude's cost is per decision, so the price includes decisions and charges for more. |
| A2 | Usage | 100 (low), 300 (mid), 1,000 (high) decisions per agent a month | Not measured: no company has used Purser for a month. An agent calls Claude for an exception (a price change, a dispute, a payment beyond its limits), not for each routine payment, which code handles alone inside the limits. Low is a quiet agent, high a busy one; the range is the one Max proposed. |
| A3 | Claude per decision | the main run's whole Claude bill divided by its decisions [R1], at list prices [U1], on the run's model mix | The only measured figure. It counts every Claude call of the run, including sorting and reading documents and the Opus reviews for the CFO, so it is above the agents' own cost per decision. The run was a scenario full of exceptions; a real month may cost more or less per decision. No batch or cache discount beyond what the run used. |
| A4 | Opus for every agent (one line, not in the table) | the run's Claude calls repriced at Opus list prices [R1, U1]: the agents' own calls from their recorded tokens; the other calls by the price ratio, Sonnet to Opus 2×, Haiku to Opus at most 40× (an upper bound) | Shows what routing each task to a smaller model is worth. It assumes Opus would use the same tokens for the same work, which a real run would not exactly do. |
| A5 | Hosting | one Cloudflare Workers Paid account per company, USD 5 a month [U2]; usage inside the plan's included amounts; a month of 30 days | An upper bound for a company's own Worker and Durable Object: one account could serve many companies. The check below shows one Durable Object awake all month, and the high scenario's requests, fit inside what the plan includes. |
| A6 | The runner | runs on Cloudflare too | Today the runner (agents, ledger, keys) is a separate process and the relay is on Cloudflare ([architecture](../architecture.md#the-shape-today)). We assume production moves the runner onto Workers and a Durable Object per company; compute elsewhere is not priced. |
| A7 | Currency | everything in EUR at EUR 1 = USD 1.1165 [U3] | Claude and Cloudflare charge in USD and the price is in EUR. One rate, the ECB's reference rate of the day we wrote this. |
| A8 | Not in the model | Airwallex platform or partner fees, Metal fees on mainnet, the cost of collecting our own invoices, people | Airwallex prices platform use on request [P1], so the cost is unknown; Purser has run on Metal testnet only. Gross margin here is the price minus Claude and hosting, so the real margin is lower. |

**Hosting check (A5), at Cloudflare's prices [U2].** The Workers Paid plan costs USD 5 a month per account and includes
10,000,000 Worker requests, 1,000,000 Durable Object requests and 400,000 GB-s of Durable Object duration a month. A
Durable Object is billed for 128 MB; awake all 30 days, one uses 324,000 GB-s, inside what is included. At high usage
(5 agents × 1,000 decisions), the included requests allow 2,000 Worker requests and 200 Durable Object requests per
decision. Hosting is USD 5.00, or €4.48, per company a month.

### Outcome: a company of 5 agents a month (hypothesis)

In EUR only, at EUR 1 = USD 1.1165, the ECB's reference rate of 6 November 2026 [U3]. Gross margin = (price − Claude −
hosting) ÷ price. Price per company = €49, plus €3 for each started 100 decisions above 1,500 (at high usage, 35 of
them).

| Usage (A2) | Decisions per agent a month | Decisions per company a month | Price per company | Claude | Hosting | Cost per company | Gross margin | Per agent: price · cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 100 | 500 | €49.00 | €7.02 | €4.48 | **€11.50** | **77%** | €9.80 · €2.30 |
| Mid | 300 | 1,500 | €49.00 | €21.06 | €4.48 | **€25.53** | **48%** | €9.80 · €5.11 |
| High | 1,000 | 5,000 | €154.00 | €70.18 | €4.48 | **€74.66** | **52%** | €30.80 · €14.93 |

If every agent ran on Opus, Claude costs would be about 2.1× higher; Purser routes each task to the smallest model that does it.

**Gross margin per company (hypothesis): 48% to 77%** across low, mid and high usage. It is lowest at exactly 1,500
decisions a company, the most the base price includes; above that, each 100 extra decisions earn €3.00 and cost €1.40
in Claude on the run's mix.

**Where the Opus factor comes from (A4).** It is the run's own Claude calls repriced at Opus list prices: USD 0.7771 instead of USD
0.3761, 2.07 times. The agents' own calls, from their recorded tokens, would cost USD 0.6970; the other calls are
scaled by 2 (Sonnet) and at most 40 (Haiku); the Opus calls stay as they were. At that factor, 100 extra decisions
would cost €2.90 in Claude against the €3.00 they earn. On the benchmark's eval cases the factor is higher [R2],
because Purser's split there runs only the reviews on Opus; in the main run the Treasury agent already ran on Opus.

The costs left out (A8) lower every margin in this table. For a different measure, per customer query in the demo's own
business, see [unit-economics.md](../unit-economics.md).

**Sources for this section:**

- [R1] The main run's record: `snapshot.agent_stats` and `snapshot.traces` (each agent's decisions, the tokens and the cost of its own Claude calls), `snapshot.claude` (every Claude call of the run, by model) and `snapshot.flows` (the payments): `docs/demo/main-run.json`, recorded 3 November 2026.
- [R2] Model benchmark, the agents' eval cases: the same cases with Purser's split and with Opus for every role ([report](../model-benchmark.md)): `docs/evals/model-benchmark.json`, run 31 October 2026.
- [U1] Anthropic, Claude API pricing (list prices, standard routing, no batch), as `src/claude/pricing.ts` applies them to the record: https://platform.claude.com/docs/en/about-claude/pricing, read 30 October 2026.
- [U2] Cloudflare, Workers pricing (Workers Paid plan; Durable Objects, SQLite storage backend): https://developers.cloudflare.com/workers/platform/pricing/, read 6 November 2026.
- [U3] European Central Bank, euro foreign exchange reference rates (USD): https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml, read 6 November 2026.
<!-- /unit-economics -->

## Market (descriptive, no size)

Every company that gives an AI agent a card, a payment key or an on-chain account to spend from. We start with
Airwallex customers that do this. We give no market size: we found no source that measures this market, and we will
not put a number on it without one.

## Risks and what we do not know

- **Demand.** We do not know whether finance teams let agents pay today, how much, or whether they would pay for
  this.
- **Airwallex could build it, and that is why we build on Airwallex.** Airwallex already ships agent features of its
  own: AgentOS, where "AgentOS components don't initiate transfers, FX conversions, or payouts on your behalf" by
  default, Spend Management agents in cards and accounts payable, and an agentic wallet in development that would let
  people authorise an agent "within spending limits and merchant rules set ahead of time" [P5]. Purser does not compete
  with that: it uses Airwallex's own card controls as one of its three locks and adds what sits on top (one CFO policy
  for card and chain, approvals signed over the exact terms, a hash-chained audit log). The more agent features
  Airwallex ships, the more there is for Purser to govern, as an app or partner on the platform. The risk that remains:
  Airwallex could choose to build the approval layer itself.
- **Dependency on Airwallex and Metal.** Purser's card controls are Airwallex's; its on-chain controls are Metal's.
  Purser has run only in the Airwallex sandbox and on Metal testnet. A change in either API, in their terms, or in
  their willingness to have a partner on top, changes the product.
- **Regulatory.** Purser holds no funds of its own (see [claims.md](../claims.md)), but agents moving company money
  touch payment, AI and data rules. [compliance.md](../compliance.md) sets out how Purser supports them; we have had
  no legal advice, and an outside audit of the controls is still to do
  ([compliance.md](../compliance.md#what-a-real-launch-would-add)).
- **Network rules are moving.** The card networks' agent programmes are new; Visa's page says its product "is
  currently in the process of deployment" [P6]. What a network will require from agents, issuers and tools like Purser
  may change.
- **Production gaps.** What is not in place yet (a real second approver, MFA on the hosted relay, key management,
  backups, live drills) is listed in [controls.md](../controls.md#not-in-place-summary).

## Sources

All accessed on 6 November 2026.

- [P1] Airwallex, "Pricing" (EU): https://www.airwallex.com/en-eu/pricing
- [P2] Pleo, "Pricing" (UK, small businesses): https://www.pleo.io/en/pricing
- [P3] Airwallex, Dan Kim, "Agentic banking starts with governance", published 5 October 2026:
  https://www.airwallex.com/en-us/blog/agentic-banking-governance
- [P4] Metal Developer Docs, "What is Metal": https://docs.metalntwx.com/start/introduction
- [P5] Airwallex, Nicolas Straut, "The Airwallex agentic finance guide", published 13 July 2026:
  https://www.airwallex.com/en-us/blog/airwallex-agentic-finance-guide
- [P6] Visa, "Visa Intelligent Commerce" product page: https://www.visa.com/en-us/solutions/intelligent-commerce
