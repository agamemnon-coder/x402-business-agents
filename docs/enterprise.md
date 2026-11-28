<div align="center">

<a href="../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/brand/purser-mark-dark.svg"><img src="assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Enterprise

**What a finance team gets beyond the demo, each with where to check it; test money today.**

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain)&nbsp;[![Tests: from assets/test-summary.json](https://img.shields.io/badge/tests%2C_last_full_run-10239_passing-16a34a?style=flat-square&labelColor=1f2937)](assets/test-summary.json)&nbsp;[![Approval alerts: built and tested with stand-ins, not sent live yet](https://img.shields.io/badge/approval_alerts-built_%C2%B7_not_sent_live_yet-f59e0b?style=flat-square&labelColor=1f2937)](cloud.md#approval-alerts)&nbsp;[![An alert never carries anything that approves](https://img.shields.io/badge/an_alert-never_approves-5996f9?style=flat-square&labelColor=1f2937)](cloud.md#approval-alerts)&nbsp;[![Purser Cloud: a public test preview](https://img.shields.io/badge/Purser_Cloud-test_preview_%C2%B7_Try_as_guest-0ea5e9?style=flat-square&labelColor=1f2937)](https://purser-try.max-31b.workers.dev/)&nbsp;[![Test money only](https://img.shields.io/badge/money-test_only-f59e0b?style=flat-square&labelColor=1f2937)](../README.md#built-with)

[Purser Cloud](cloud.md) · [Approval alerts](cloud.md#approval-alerts) · [Zero trust](security.md#zero-trust-layer-by-layer) · [Connect any AI](connect-any-ai.md) · [Before real money](go-live.md)

</div>

Moved from the [README](../README.md) on 15 November, to keep it short.

What a finance team gets beyond the demo; test money today, each with where to check it.

```mermaid
flowchart LR
  subgraph CO["A company in Purser Cloud"]
    CON["The console<br/>Overview, Agents, Invoices & books,<br/>Transactions, Tokenisation, Settings"]
    AG["Agents<br/>a fixed set of tools, checked by code"]
  end
  AI["Your AI<br/>MCP: read, and propose"] --> CO
  AG --> CFO["The CFO's passkey<br/>step-up on sensitive settings"]
  CO -. "e-mail, Slack, Teams<br/>never approve" .-> CFO
  classDef sourcing fill:#6099f4,stroke:#356fcd,color:#ffffff
  classDef purser fill:#5996f9,stroke:#246bdd,color:#ffffff
  classDef ok fill:#10b981,stroke:#047857,color:#111827
  class AI sourcing
  class AG,CFO purser
  class CON ok
```

- **Purser Cloud:** a console per company with Overview, Agents, Invoices & books, Transactions, Tokenisation and Settings; a public test preview where *Try as guest* opens a demo company read-only ([purser-try.max-31b.workers.dev](https://purser-try.max-31b.workers.dev/), [docs/cloud.md](cloud.md)).
- **Approval alerts:** e-mail, Slack and Teams tell the CFO a payment waits; an alert never carries anything that approves. Built and tested with stand-ins, not sent live yet: e-mail needs an e-mail provider's key, Slack and Teams the company's own incoming webhook ([docs/cloud.md](cloud.md#approval-alerts)).
- **Zero trust and step-up:** agents act only through a fixed set of tools that code checks; sensitive console settings ask for a fresh passkey check ([docs/security.md](security.md#zero-trust-layer-by-layer), [cloud/src/stepUp.ts](../cloud/src/stepUp.ts)).
- **Security contact:** [security.txt](https://kit11.max-31b.workers.dev/.well-known/security.txt) and [SECURITY.md](../SECURITY.md); the layers a payment must pass on [/security](https://kit11.max-31b.workers.dev/security).
- **MCP connector:** 14 read tools, and proposing an invoice's payment, never approving it; described for the MCP Registry as `io.github.agamemnon-coder/purser` in [`server.json`](../server.json), not published there yet ([MCP](mcp.md#the-mcp-registry), [Connect any AI](connect-any-ai.md)).
- **Tests:** the suite's count is written from its last full run by `npm run test-count` ([summary](assets/test-summary.json), [the line below](../README.md#verify-it-yourself-in-3-commands)); CI runs it on every push.
