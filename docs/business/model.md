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

## Intended pricing (our assumption) — Max to choose

We have no price list and no customer has seen a price. Below are two options for Max to choose between. Numbers are
placeholders ("€X") unless a cited comparable supports a range; the comparables are what spend-management tools charge
for a **person** with a card, not for an agent, so they are a reference point only.

**Comparables (public pricing pages, read 6 November 2026):**

| Tool | Public price | Source |
|---|---|---|
| Airwallex (EU plans) | Explore €0 or €19 a month; Grow €49 a month. Spend users: 5 free, then €6 per additional employee card user a month (Explore) or €12 per additional active spend user a month (Grow). Prices in EUR, VAT exclusive | [P1] |
| Pleo (UK plans, small businesses) | Start £8, Build £14, Optimise £18 per user a month (Build and Optimise billed yearly, 3 users minimum) | [P2] |

We found no public spend-management price that is a percentage (basis points) of governed spend, so option (b) has no
cited comparable and stays a placeholder.

### Option (a): per agent, per month

- **Price:** €X per active agent a month (an agent with a card or a mandate under the CFO policy). If we anchor on
  the comparables above, X would sit somewhere in the band they charge for one human card user (€6 to €12 at Airwallex,
  £8 to £18 at Pleo). That anchor is our assumption, not a finding.
- **For:** simple and predictable for a CFO; it looks like what they already pay per card user; easy to bill.
- **Against:** agents are cheap to create, so a per-agent fee nudges customers to put several jobs behind one agent
  and one card. That undoes the control we sell (one agent, one card, one set of limits). The price also does not
  grow with the money at risk.

### Option (b): base fee plus basis points on governed spend

- **Price:** €X a month per company, plus Y basis points of the spend that passes through Purser's policy (card
  spend, Metal mandate payments and approved payouts). X and Y are placeholders.
- **For:** the price grows with the money Purser governs, which is what the CFO is buying protection for; it does not
  punish splitting work across many narrow agents.
- **Against:** a CFO may see it as a tax on spend; it needs metering we have not built; on x402 micropayments of a few
  cents the basis points are negligible, so the base fee carries the revenue for on-chain-heavy customers; it sits on
  top of fees the customer already pays on the same spend.

**What would decide it (our reasoning):** whether buyers think of Purser as a seat tool (like their spend software) or
as a control on money moved (like a payment fee). We do not know, because we have not asked.

**Compared with after-the-fact control (qualitative only).** Expense review after the fact finds a bad payment once
the money has gone; Purser's limits and approvals act before it leaves. We have no sourced figure for what after-the-fact
control costs a finance team, so we make no saving claim. Our only measured cost figures are for the demo's own
agents, in test money: [unit-economics.md](../unit-economics.md).

## Market (descriptive, no size)

Every company that gives an AI agent a card, a payment key or an on-chain account to spend from. We start with
Airwallex customers that do this. We give no market size: we found no source that measures this market, and we will
not put a number on it without one.

## Risks and what we do not know

- **Demand is not validated.** We have not validated demand with customers yet. We do not know whether finance teams
  let agents pay today, how much, or whether they would pay for this. Max decided against customer interviews and
  discovery during the hackathon.
- **Airwallex could build it.** Airwallex already ships agent features of its own: AgentOS, where "AgentOS components
  don't initiate transfers, FX conversions, or payouts on your behalf" by default, Spend Management agents in cards and
  accounts payable, and an agentic wallet in development that would let people authorise an agent "within spending
  limits and merchant rules set ahead of time" [P5]. Purser's per-agent limits with hash-bound approvals may become a
  feature of the platform it depends on.
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
