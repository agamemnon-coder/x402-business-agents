# Business model: a hypothesis

**Everything on this page is a hypothesis.**
Not validated with customers yet: 2 finance conversations (a CFO and a bank finance professional, quoted, anonymous); more in progress; no pilots, no revenue.
No letters of intent. The buyer, the channel and the price below are what we would test first, not what we have found. Outside facts carry a source we opened on the date given.

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

## Pilot pricing (hypothesis)

**Pilot pricing: Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout.**
These are pilot prices, set on 12 November 2026. Nothing is on sale yet and no customer has seen a
price. Business adds several companies, four-eyes approval and bookkeeping connectors.

It is one model, said in the same sentence in the [README](../../README.md#the-business-hypothesis) and in
[after-the-kit.md](../after-the-kit.md); [/pricing](https://kit11.max-31b.workers.dev/pricing) shows the same figures.
Every figure comes from `src/config/pricing.ts`, and `test/saas-additions.test.ts` keeps the four places in step.

Why this shape (our reasoning): the unit a finance team counts is the supplier invoice, and Claude's cost is per
invoice read, so the monthly plan includes a number of invoices and charges for more
([unit economics](#unit-economics-hypothesis) below). The monthly price does not grow with the money paid out; the fee
per payout does, and it is collected with the payout itself, so there is no second bill.

**The fee per payout.** The fee is a percentage of each payout: the CFO signs the rate in the policy, and code keeps it at or under 1.00%, rounds it to the cent and sends it to Airwallex as a fixed amount. The two sandbox runs used test values, not prices: EUR 0.05 on EUR 5.00 (1.00%, a fixed test fee set for that run) and EUR 0.02 on EUR 4.84 (the test policy's 0.50%, rounded to the cent).
No rate is set as a price: it is what a pilot would test. The two runs:
[connected accounts](../runs/2026-11-10-connected-accounts-sandbox.md) and
[end to end](../runs/2026-11-10-platform-e2e.md). The ceiling is `FEE_BPS_CAP` in `src/airwallex/platform.ts`; the
rate is the policy rule `platform.fee_bps` in `src/policy/rules.ts`.

This replaces the price of 6 November 2026, which was per agent with Claude decisions included. Two prices stood side
by side (a monthly price per agent and an unsettled fee per payment), so there is one model now. What the earlier
price's own table gave is said under the [unit economics](#unit-economics-hypothesis) below.

The comparables below are what spend-management tools charge for a **person** with a card, not for an invoice, so
they are a reference point only.

**Comparables (public pricing pages, read 6 November 2026):**

| Tool | Public price | Source |
|---|---|---|
| Airwallex (EU plans) | Explore €0 or €19 a month; Grow €49 a month. Spend users: 5 free, then €6 per additional employee card user a month (Explore) or €12 per additional active spend user a month (Grow). Prices in EUR, VAT exclusive | [P1] |
| Pleo (UK plans, small businesses) | Start £8, Build £14, Optimise £18 per user a month (Build and Optimise billed yearly, 3 users minimum) | [P2] |

Starter's monthly price is what Airwallex charges for its own Grow plan [P1]. That anchor is our assumption, not a
finding.

What could make us change it: we do not know how many invoices a small company would send through Purser, or whether
a finance team accepts a fee per payout next to a monthly plan. Both are what a pilot would test. We found no public
spend-management price that is a fee on the money paid out.

**Compared with after-the-fact control (qualitative only).** Expense review after the fact finds a bad payment once
the money has gone; Purser's limits and approvals act before it leaves. We have no sourced figure for what after-the-fact
control costs a finance team, so we make no saving claim. Our only measured cost figures are for the demo's own
agents, in test money: [unit-economics.md](../unit-economics.md).

<!-- unit-economics -->
## Unit economics (hypothesis)

**A hypothesis, not a result.** What a company's supplier invoices would cost Purser a month, against the pilot pricing above. The measured part comes from the main run of 3 November 2026 and the end-to-end sandbox run of 10 November 2026; everything else is a price we read, with its page and date, or an assumption stated below. Hosting, the currency and the Opus line are as Max approved them on 6 November 2026; the usage in invoices and the Claude cost per invoice were restated for the pilot pricing. This section is written by `src/business/unitEconomics.ts` (`sectionMarkdown`); `test/unit-economics-hypothesis.test.ts` checks that this page holds exactly what it computes from the records and the assumptions, and that no number is unsourced.

### Measured in the main run

| Main run, 3 November 2026 [R1] | Sourcing (Haiku) | Support (Sonnet) | Treasury (Opus) | All agents |
| --- | ---: | ---: | ---: | ---: |
| Decisions | 11 | 4 | 9 | 24 |
| Claude, the agent's own calls (USD, list prices [U1]) | 0.0088 | 0.0500 | 0.2582 | 0.3170 |
| Per decision (USD) | 0.0008 | 0.0125 | 0.0287 | 0.0132 |
| Every Claude call of the run, documents and reviews included (USD) |  |  |  | 0.3761 |
| Per decision, everything included (USD) |  |  |  | 0.0157 |
| Claude calls in the run |  |  |  | 58 |
| Per Claude call, everything included (USD) |  |  |  | 0.0065 |

**Claude per decision: USD 0.0132 for the agents' own calls, USD 0.0157 for every Claude call of the run.** The agents' own calls (`agent_stats`) come to USD 0.3170 for 24 decisions, the figure in [claims.md](../claims.md). The run's whole Claude bill (`snapshot.claude`) is USD 0.3761 for 58 calls: it also sorted and read the documents and ran the Opus reviews for the CFO, USD 0.0592 or 16% of the bill. This model uses the whole bill: USD 0.0065 a call.

**In the main run, Claude made 24 decisions; of the 88 payments, 82 were routine sales and purchases that code handled inside the limits.** The 24 decisions are not one per payment: they are the agents' checks, plans, proposals, a dispute ruling and timing advice, several of which moved no money. The 88 payments are 86 on Metal (41 sales, 41 supplier purchases, 3 refunds, 1 sweep), 1 card charge and 1 SWIFT transfer [R1].

**Claude per invoice, an estimate: USD 0.0276. The end-to-end sandbox run made 17 Claude calls for 4 invoices, and a Claude call in the main run cost USD 0.0065 on average at list prices.** That is 4.25 calls an invoice [R3] at the main run's cost per call [R1]. No record holds a measured Claude cost per invoice, so this is an assumption (A3), not a measurement.

### Assumptions (hypothesis)

| # | Assumption (hypothesis) | Value | Why |
| --- | --- | --- | --- |
| A1 | Price | Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout. VAT excluded; the table prices one company on Starter; no revenue from Business or from the fee per payout is counted | The pilot pricing above (hypothesis); no customer has seen it. The unit a finance team counts is the supplier invoice, and Claude's cost is per invoice read, so the plan includes invoices and charges for more. |
| A2 | Usage | 50 (low), 100 (mid), 500 (high) supplier invoices per company a month | Not measured: no company has used Purser for a month. Mid is exactly what Starter includes, low is half of it and high is five times it. Our own range, set with the pilot pricing; not a finding. |
| A3 | Claude per invoice | the end-to-end sandbox run's Claude calls per invoice [R3] times the main run's cost per Claude call [R1], at list prices [U1] | An estimate, not a measurement: the end-to-end run counted its Claude calls (classify, read and review per invoice), not their cost, and the main run measured what a call cost on its own mix of models, in an agents' scenario. A real month may cost more or less per invoice. No batch or cache discount beyond what the main run used. |
| A4 | Opus for every agent (one line, not in the table) | the run's Claude calls repriced at Opus list prices [R1, U1]: the agents' own calls from their recorded tokens; the other calls by the price ratio, Sonnet to Opus 2×, Haiku to Opus at most 40× (an upper bound) | Shows what routing each task to a smaller model is worth. It assumes Opus would use the same tokens for the same work, which a real run would not exactly do. |
| A5 | Hosting | one Cloudflare Workers Paid account per company, USD 5 a month [U2]; usage inside the plan's included amounts; a month of 30 days | An upper bound for a company's own Worker and Durable Object: one account could serve many companies. The check below shows one Durable Object awake all month, and the high scenario's requests, fit inside what the plan includes. |
| A6 | The runner | runs on Cloudflare too | Today the runner (agents, ledger, keys) is a separate process and the relay is on Cloudflare ([architecture](../architecture.md#the-shape-today)). We assume production moves the runner onto Workers and a Durable Object per company; compute elsewhere is not priced. |
| A7 | Currency | everything in EUR at EUR 1 = USD 1.1165 [U3] | Claude and Cloudflare charge in USD and the price is in EUR. One rate, the ECB's reference rate of the day we first wrote this. |
| A8 | Not in the model | the platform costs: Airwallex platform or partner fees, Metal fees on mainnet, the cost of collecting our own invoices, support and people. On the revenue side: the fee per payout, which has no rate set | Airwallex prices platform use on request [P1], so the cost is unknown; Purser has run on Metal testnet only. |

**Hosting check (A5), at Cloudflare's prices [U2].** The Workers Paid plan costs USD 5 a month per account and includes 10,000,000 Worker requests, 1,000,000 Durable Object requests and 400,000 GB-s of Durable Object duration a month. A Durable Object is billed for 128 MB; awake all 30 days, one uses 324,000 GB-s, inside what is included. At high usage (500 invoices a month), the included requests allow 20,000 Worker requests and 2,000 Durable Object requests per invoice. Hosting is USD 5.00, or €4.48, per company a month.

### No margin computed (pilot)

No gross margin is computed here. No company has used Purser for a month, so there is no measured usage to set against the pilot prices, and the platform costs (A8) are not known. The measured parts above are what the runs recorded.

If every agent ran on Opus, Claude costs would be about 2.1× higher; Purser gives each agent the smallest model that passed its evals.

**Where the Opus factor comes from (A4).** It is the run's own Claude calls repriced at Opus list prices: USD 0.7771 instead of USD 0.3761, 2.07 times. The agents' own calls, from their recorded tokens, would cost USD 0.6970; the other calls are scaled by 2 (Sonnet) and at most 40 (Haiku); the Opus calls stay as they were. At that factor, an extra invoice would cost €0.05 in Claude against the €0.25 it earns. On the benchmark's eval cases the factor is higher [R2], because Purser's split there runs only the reviews on Opus; in the main run the Treasury agent already ran on Opus.

For a different measure, per customer query in the demo's own business, see [unit-economics.md](../unit-economics.md).

**Sources for this section:**

- [R1] The main run's record: `snapshot.agent_stats` and `snapshot.traces` (each agent's decisions, the tokens and the cost of its own Claude calls), `snapshot.claude` (every Claude call of the run, by model) and `snapshot.flows` (the payments): `docs/demo/main-run.json`, recorded 3 November 2026.
- [R2] Model benchmark, the agents' eval cases: the same cases with Purser's split and with Opus for every role ([report](../model-benchmark.md)): `docs/evals/model-benchmark.json`, run 31 October 2026.
- [R3] The end-to-end sandbox run's record ([record](../runs/2026-11-10-platform-e2e.md)): the Claude calls of the run (classify, read and review per invoice) and the invoices it read; test companies, test money: `docs/runs/2026-11-10-platform-e2e.md`, run 10 November 2026.
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
