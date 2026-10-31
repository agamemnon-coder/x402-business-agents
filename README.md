# Purser

**Your AI agents spend through Airwallex and Metal. The CFO stays in control.**

Kit 11 · x402 Business Agents: three agents (Sourcing, Support, Treasury) on one Metal account, rebalancing when
supplier costs rise — plus Airwallex for cards, FX and the euro licence fee.

**Judge tour (3 minutes)**, on the hosted site ([kit11.max-31b.workers.dev](https://kit11.max-31b.workers.dev/#tour))
or offline with `npm ci && npm run judge` (no keys, no network):

1. **The problem:** AI agents are starting to spend company money; one shared card or wallet gives no limit per agent
   and no one place for the exceptions. ([Watch](https://kit11.max-31b.workers.dev/film))
2. **Airwallex declines the card** above its limit; after the CFO's Face ID the limit follows and the same purchase
   is paid. ([the Airwallex ids](https://kit11.max-31b.workers.dev/demo?step=1))
3. **Metal refuses the higher price** against the on-chain mandate, and the CFO moves budget between the mandates within the same 20.00 with
   Face ID. ([the transactions](https://kit11.max-31b.workers.dev/demo?step=3))
4. **The Dispute desk checks every order:** a simulated customer (we filed for it) disputes 12 orders; each is
   checked against its signed order and the mandate on chain. All 12 hold, so nothing new is refunded. ([the evidence](https://kit11.max-31b.workers.dev/metal#dispute))
5. **Try it yourself:** type a task for an agent. ([Try it](https://kit11.max-31b.workers.dev/try))

<p>
  <img src="docs/media/purser-card.gif" width="49%" alt="Airwallex declines the agent's card over its limit">
  <img src="docs/media/purser-metal.gif" width="49%" alt="Metal refuses a payment over the agent's on-chain mandate">
</p>

*Left: Airwallex itself declines the agent's card over its limit. Right: Metal refuses a payment over the agent's
on-chain mandate. Both from the recorded live run (test money).*

**Kit 11 (x402 Business Agents), as built.** Northwind Outdoor, an outdoor wholesaler that sells live stock data to
retailers per query: the kit's data business. Three agents draw on one Metal account, each under its own mandate:

| Kit 11 agent | Its job in the brief | Budget when bound → after the CFO's Face ID |
|---|---|---|
| Sourcing agent | buys the upstream data per query; its card pays warehouse and data software | 10.00 → 12.00, cap 0.03 → 0.04 a purchase |
| Support agent | refunds customers when a dispute holds; its card pays helpdesk software | 4.00 |
| Treasury agent | designs the rebalance after the price rise (with the agents on, its own split, e.g. 14 / 2 / 4); the sweep to Airwallex and the EUR licence fee (FX and SWIFT, after Face ID) run on its mandate but are code's decisions | 6.00 → 4.00 in the brief |

20.00 test USD between them, before and after, held in code (`TOTAL_BUDGET_CENTS`). Every Kit 11 sentence and where
it is done: [docs/requirements-matrix.md](docs/requirements-matrix.md) section 4.

Each agent gets an Airwallex company card and a Metal on-chain mandate. The CFO sets the limits for both: card limits come from the CFO policy, and an agent's mandate changes only when
the CFO signs the new terms with Face ID. When an agent needs more, it stops and asks, and the CFO approves on a phone with Face ID.

**Who it is for:** the CFO (or controller) of a small company that runs AI agents and wants them to spend company
money only within limits the CFO sets.

**Built for the rules, not certified:** Airwallex is the regulated provider (accounts, card issuing, payouts; its KYB,
KYC and screening are its own, not shown in this repo), Metal enforces the limits on chain, and Purser holds no funds of
its own (they stay in the business's Airwallex and Metal accounts), logs every model call its agents make and keeps a
person in charge
([docs/compliance.md](docs/compliance.md)).

```mermaid
flowchart LR
  A["AI agents"] --> P["CFO policy<br/>limits, floors, payees"]
  P --> AW["Airwallex<br/>cards, FX, SWIFT"]
  P --> M["Metal<br/>mandates, x402, clearing"]
  AW -->|"over a limit"| C["CFO phone<br/>Face ID"]
  M -->|"over a limit"| C
  C -->|"approved terms only"| AW
  C -->|"approved terms only"| M
  AW --> L["Audit log<br/>append-only, hash-chained"]
  M --> L
  C --> L
```

## For a juror

```sh
npm ci && npm run judge
```

No keys, and no network after `npm ci`; the judge step itself starts in seconds. It serves the recorded
live run, the CFO dashboard as it stood at the end, a simulated month, and the Scenario Lab (`/lab`: 18 stories run against stand-ins for Airwallex and Metal,
from a normal purchase to the emergency stop, each with what should happen and what did), "How Purser uses Metal"
(`/metal`: every Metal feature Purser uses, with its testnet proof and docs link (clearing, the receive policy, four eyes and compliance from separate live runs), a mandate inspector per agent, and the Dispute
desk case order by order), and opens your browser.

## Run it live

Needs a Metal testnet RPC endpoint, Airwallex sandbox keys and, optionally, an Anthropic key. Setup, commands and
the step-by-step run are in [docs/run-it.md](docs/run-it.md).

## Read more

Start here:

- [docs/metal-award.md](docs/metal-award.md): what the build uses from Metal, with proof on testnet
- [docs/airwallex.md](docs/airwallex.md): every Airwallex API Purser calls, and why
- [docs/security.md](docs/security.md): threat model, attacks and what stops each one
- [docs/controls-matrix.md](docs/controls-matrix.md): every risk, the control against it, its test and the live evidence
- [docs/runbook.md](docs/runbook.md): incidents, the emergency stop, key rotation and recovery
- [docs/ask-purser.md](docs/ask-purser.md): Ask Purser: a single-use card for one task (a flight, a hotel, a train) from one sentence: at once within the CFO's policy (up to €300, 3 a day, asked at the runner), otherwise after Face ID
- [docs/claude.md](docs/claude.md): Powered by Claude: which model does what, why, and what it costs per call and per €1,000 paid
- [docs/compliance.md](docs/compliance.md): who does what (Airwallex, Metal, Purser) for the EU AI Act, PSD2, GDPR, AML and audit
- [docs/requirements-matrix.md](docs/requirements-matrix.md): what the hackathon asks for, where Purser does it, and the proof
- [docs/decisions.md](docs/decisions.md): decisions taken during the build, and what each costs if wrong
- [docs/roadmap.md](docs/roadmap.md): from company cards for agents to the agent finance department (not built yet)
- [docs/runs/](docs/runs/): logs of live runs

The old README sections, now in docs:

- [Overview, the story, controls, where Claude is used](docs/overview.md)
- [Company cards (Airwallex Issuing)](docs/cards-and-clearing.md#company-cards-airwallex-issuing)
- [Selling by Metal clearing (prepaid, new on testnet)](docs/cards-and-clearing.md#selling-by-metal-clearing-prepaid-new-on-testnet)
- [A month in 90 seconds (simulated)](docs/cards-and-clearing.md#a-month-in-90-seconds-simulated)
- [The CFO policy](docs/cfo-policy.md), [in plain words](docs/cfo-policy.md#the-cfo-policy-in-plain-words) and
  [four eyes](docs/cfo-policy.md#four-eyes-two-people-above-a-threshold)
- [Outside agents: the agent API (MCP)](docs/agent-api.md#outside-agents-the-agent-api-mcp) and the
  [GL export for the ERP](docs/agent-api.md)
- [Invoice fraud and prompt injection](docs/fraud-and-injection.md)
- [Dashboard and phone approval with a passkey](docs/phone-approval.md)
- [Run it](docs/run-it.md)
- [Code map, tooling, credits](docs/architecture.md)

## Test money

All money here is test money: the Airwallex sandbox and Metal testnet. Simulated by the sandbox:
merchants' card charges, a SWIFT transfer's last steps (SENT, PAID), the deposit that stands in for Metal earnings at
Airwallex, and retailers' payments into the Global Accounts. *USDZ is shown as "test USD". Run by us: Summit and its
agent, and Stockline. Northwind Outdoor is the example company.

Built with Claude (Anthropic) as the developer, directed and reviewed by Max Geurtsen. Licence: MIT.
