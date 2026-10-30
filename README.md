# Purser

**Give every AI agent its own company card, with limits the CFO sets.**

Each agent gets an Airwallex company card and a Metal on-chain mandate. One CFO policy sets the limits for both. When
an agent needs more, it stops and asks, and the CFO approves on a phone with Face ID.

**Who it is for:** the CFO (or controller) of a small company that runs AI agents and wants them to spend company
money only within limits the CFO sets.

**Built for the rules, not certified:** Airwallex does KYC, card issuing and sanctions screening, Metal enforces the
limits on chain, and Purser holds no money, logs every AI step and keeps a person in charge
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

No keys, and no network after `npm ci`; the judge step itself starts in about two seconds. It serves the recorded
live run, the CFO dashboard as it stood at the end, a simulated month, and the Scenario Lab (`/lab`: twelve stories,
from a normal purchase to the emergency stop, each with what should happen and what did), and opens your browser.

## Run it live

Needs a Metal testnet RPC endpoint, Airwallex sandbox keys and, optionally, an Anthropic key. Setup, commands and
the step-by-step run are in [docs/run-it.md](docs/run-it.md).

## Read more

Start here:

- [docs/metal-award.md](docs/metal-award.md): what the build uses from Metal, with proof on testnet
- [docs/airwallex.md](docs/airwallex.md): every Airwallex API Purser calls, and why
- [docs/security.md](docs/security.md): threat model, attacks and what stops each one
- [docs/ask-purser.md](docs/ask-purser.md): Ask Purser: a single-use card for one task (a flight, a hotel, a train) from one sentence, after Face ID
- [docs/claude.md](docs/claude.md): Powered by Claude: which model does what, why, and what it costs per decision
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

All money here is test money: the Airwallex sandbox and Metal testnet. Card merchant charges are simulated in the
sandbox, and *USDZ is shown as "test USD".

Built with Claude (Anthropic) as the developer, directed and reviewed by Max Geurtsen. Licence: MIT.
