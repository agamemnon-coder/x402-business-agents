# Purser's MCP server

The reference for any MCP client (Claude, other assistants, agent frameworks): how to connect, every tool with its
annotations, the resources and prompts, the error codes, and the safety model. **Read and propose only.** No tool
approves, pays, changes a limit or writes to the books, for any token. Every payment needs the CFO's passkey (Face ID)
over its exact terms in Purser Cloud. Test money only: the hosted cloud runs test companies on the Airwallex sandbox and
the Alta (formerly Metal) testnet.

Per-client steps (ChatGPT, Cursor, VS Code, Gemini CLI, Windsurf), OAuth and token security:
[connect-claude.md](connect-claude.md). The code: [`cloud/src/claude/mcp.ts`](../cloud/src/claude/mcp.ts) and
[`cloud/src/claude/resources.ts`](../cloud/src/claude/resources.ts).

## What this page describes, and what ran live

This page describes the server as the code in this repository has it. The hosted test cloud runs whichever version was
deployed last. Live checks, dated:

- 13 November 2026, 06:57 UTC: `tools/list` on the hosted cloud with the demo token answered the 7 read tools deployed
  then. The same morning the owner added Purser as a connector in the Claude iOS app.
- 14 November 2026, 14:44 UTC: `tools/list` there answered HTTP 200 with 14 read tools, each marked read-only.

The error codes and the `purser://connection` resource below were added on 19 November 2026. They are checked by the
tests listed at the end, on a cloud in the test process, not against the hosted cloud.

## Connect

| | |
|---|---|
| Server | `https://purser-try.max-31b.workers.dev/mcp` (the hosted test cloud), or `<your Purser Cloud address>/mcp` |
| Transport | Streamable HTTP, JSON answers, no session. MCP 2026-07-28, and 2025-11-25 back to 2024-11-05 after `initialize` |
| Sign-in | OAuth 2.1 with PKCE (Client ID Metadata Documents or dynamic registration), or `Authorization: Bearer <token>` |
| Token | A connector token from Purser Cloud (Connections, Connect your AI). Tick *may propose payments* only if the AI should file payments for approval |
| Demo token | `purser-demo-read-only`: the demo company, made-up data from a simulated month, read only |

### Claude Code

```
claude mcp add --transport http purser https://purser-try.max-31b.workers.dev/mcp --header "Authorization: Bearer purser-demo-read-only"
```

Or in a project's `.mcp.json`, with your own token in an environment variable:

```json
{ "mcpServers": { "purser": { "type": "http", "url": "https://purser-try.max-31b.workers.dev/mcp", "headers": { "Authorization": "Bearer ${PURSER_CONNECTOR_TOKEN}" } } } }
```

Or the plugin, which brings the server and three skills (*pay an invoice*, *show my books*, *what did my agents
decide*):

```
/plugin marketplace add agamemnon-coder/x402-business-agents
/plugin install purser@purser
```

The `.mcp.json` form is from Claude Code's documentation; the command and the plugin are the ones
[connect-claude.md](connect-claude.md#the-claude-code-plugin) describes.

### Claude Desktop, claude.ai and the Claude mobile apps

Settings (or Customize), Connectors, *Add custom connector*. Name it Purser and paste the server's address. Claude opens
Purser's sign-in page: paste your connector token, or choose *Use the demo company*. Claude Desktop's own
`claude_desktop_config.json` lists local (stdio) servers; a remote server such as Purser is added as a connector. On a
Team or Enterprise plan an owner adds custom connectors for the organisation. Of these, the iOS app was tried live (13
November, above); the others follow Claude's help centre.

### Any other client

Most clients take a JSON config of this shape. The key for the address varies by client (`url`, `httpUrl` or
`serverUrl`): [connect-claude.md](connect-claude.md) has each one.

```json
{ "mcpServers": { "purser": { "type": "http", "url": "https://purser-try.max-31b.workers.dev/mcp", "headers": { "Authorization": "Bearer ${PURSER_CONNECTOR_TOKEN}" } } } }
```

A client without a header finds Purser's sign-in on the first `401` (RFC 9728 metadata at
`/.well-known/oauth-protected-resource`). Every Purser Cloud also serves `/connect-ai`, a tab per client with the exact
config for that cloud's address. To look before connecting an AI, list the tools with the MCP Inspector:

```
npx @modelcontextprotocol/inspector --cli https://purser-try.max-31b.workers.dev/mcp --transport http --method tools/list --header "Authorization: Bearer purser-demo-read-only"
```

`npm run mcp:local` serves the same handler (demo company, read only) at `http://localhost:8787/mcp`.

## Tools

Every tool has a title, a description that says what it reads or files, an `inputSchema` (a closed object: an argument
it does not name is refused; every property has a description, and `examples` except an opaque page cursor), an
`outputSchema` its `structuredContent` conforms to, and annotations. Every answer starts with one plain sentence, then a
few short lines, with money as `EUR 1,793.00`; the full record comes along as `structuredContent`, and a result that
names an invoice, a payment or a report links its resource (`resource_link`).

| Tool | What it does | Annotations | Token |
|---|---|---|---|
| `company_overview` | Money in and out, net cash by day, spend by who started it, invoices by state, the newest decisions | read-only, idempotent | any |
| `list_invoices` | Supplier invoices by id, filtered by status and due days, 10 a page | read-only, idempotent | any |
| `get_invoice` | One invoice: what Purser read, its checks and their findings, its earlier versions | read-only, idempotent | any |
| `list_transactions` | Every money movement on every rail, newest first, with its approval, booking and proof | read-only, idempotent | any |
| `books_report` | P&L, balance sheet, trial balance, a quarter's VAT, open payables or receivables | read-only, idempotent | any |
| `agent_decisions` | The audit trail in words: who decided what (an agent, the CFO, or Purser's code) | read-only, idempotent | any |
| `what_needs_attention` | Open, due within 7 and 30 days, overdue, waiting, blocked | read-only, idempotent | any |
| `cash_position` | Net cash from what moved (not a bank balance) and a week-by-week projection from due days | read-only, idempotent | any |
| `pending_approvals` | What waits for the CFO's Face ID, each with where to approve it in Purser Cloud | read-only, idempotent | any |
| `cfo_policy` | The rules every payment is held to, the policy version, agents' card limits, treasury settings | read-only, idempotent | any |
| `spend_breakdown` | Money out by agent or by supplier, per currency, fees included, declines counted | read-only, idempotent | any |
| `vat_summary` | A quarter's VAT as the Dutch return's rubrics. An overview, not a filing | read-only, idempotent | any |
| `payment_audit_trail` | Every recorded step of one payment, by payment, invoice (`AP-…`) or proposal (`P-…`) id | read-only, idempotent | any |
| `explain_payment` | One payment in plain words: who, how much, why, who allowed it and how, where it is booked | read-only, idempotent | any |
| `route_money_out` | Before a transfer, payout or FX conversion: the checked invoice it would pay, where that stands, and the next tool. Files nothing ([agentos.md](agentos.md)) | read-only, idempotent | any |
| `propose_invoice_payment` | Files an invoice's payment for the CFO's approval. **Nothing is paid** | not read-only, not destructive, not idempotent | a token made to propose; never the demo |
| `payment_proposal` | Where a proposal stands: waiting, approved and paid, refused or expired, with its terms' SHA-256 | read-only, idempotent | a token made to propose |

Every tool has `destructiveHint: false` and `openWorldHint: false`: none destroys anything, none reaches outside
Purser. `tools/list` sends each tool's schema and annotations exactly as the code declares them; the descriptions
are the code's own, so read them there or in `tools/list` rather than here.

## Resources and prompts

**Resources** (`resources/list`, `resources/read`), each a `purser://` URI:

- `purser://connection`: what this connection can do, for this token. Its scope (reads, or reads and proposes), what no
  AI can do here, and how a proposal reaches the CFO. Listed first; a client that attaches one resource should attach
  this one.
- `purser://company/overview`, `purser://cash`, `purser://approvals/pending`, `purser://policy` (Markdown),
  `purser://books/{pnl,balance,trial,payables,receivables}`, `purser://books/vat/{quarter}`, and one per invoice.
- Templates: `purser://invoices/{id}`, `purser://payments/{id}`, `purser://books/vat/{quarter}`,
  `purser://books/{report}`.

**Prompts** (`prompts/list`, `prompts/get`): *CFO weekly brief*, *What needs my Face ID?*, *Explain this invoice*
(`invoice_id`), *Explain this payment* (`payment_id`) and *Cash outlook*. Each names the tools that answer it.

## Errors

Every error carries one stable code, so a client can branch on the code and show the sentence to a person.

- **A tool's own refusal** is a result with `isError: true` and two text items: the sentence, then the same error as JSON,
  `{"error":{"code":"not_found","message":"…","next_tool":"list_invoices"}}`. `next` says what to do; `next_tool` names
  the tool to call. There is no `structuredContent` on an error, so a client that checks it against the
  `outputSchema` never trips on one.
- **A request the server cannot take** is a JSON-RPC error whose `data.code` is the code, with what else the client
  can act on (`data.tool`, `data.uri`, `data.supported`).

| Code | Where | Meaning |
|---|---|---|
| `invalid_arguments` | tool result | The arguments do not fit the `inputSchema`: fix them and call again |
| `not_found` | tool result | No invoice, payment or proposal in this company's books has that id |
| `could_not_answer` | tool result | The books could not answer the question as asked |
| `refused` | tool result | Purser refused to file the proposal (held, already waiting or paid); nothing was proposed |
| `demo_read_only` | tool result | The demo company proposes nothing |
| `runner_only` | tool result | This company files payments on its own runner, not in the cloud |
| `not_available_over_mcp` | `-32602` | The call would approve, pay, change a limit or write. Never possible over MCP, for any token |
| `needs_propose_token` | `-32602` | The tool files a proposal; this token reads only |
| `unknown_tool`, `unknown_prompt` | `-32602` | No such tool or prompt; `tools/list` or `prompts/list` shows them |
| `missing_argument` | `-32602` | A required parameter or prompt argument is missing or malformed |
| `invalid_cursor` | `-32602` | The cursor is not one this server gave |
| `resource_not_found` | `-32602` (`-32002` before 2026-07-28) | No resource at that URI |
| `unknown_method` | `-32601` (HTTP 404 in 2026-07-28) | The server does not answer that method |
| `header_mismatch` | `-32020` (HTTP 400) | `MCP-Protocol-Version`, `Mcp-Method` or `Mcp-Name` is missing or disagrees with the body |
| `unsupported_protocol_version` | `-32022` (HTTP 400) | `data.supported` lists the versions Purser speaks |
| `invalid_request`, `parse_error` | `-32600`, `-32700` (HTTP 400) | The body is not a JSON-RPC request this server takes |

The list is `ERROR_CODES` in [`cloud/src/claude/mcp.ts`](../cloud/src/claude/mcp.ts).

## The safety model

1. **Read and propose only.** A reading token gets the fifteen reading tools. A token made to propose also gets
   `propose_invoice_payment` and `payment_proposal`. No token gets a tool that approves, pays, changes a limit, adds a
   supplier or writes to the books: such a tool does not exist. A call to one by name (`approve_payment`,
   `pay_invoice`, `set_card_limit` …) is refused with `not_available_over_mcp`, and the refusal says why. A name about
  moving money or currency (`create_transfer`, `convert_currency`, `propose_fx` …) also carries
  `data.next_tool: "route_money_out"`.
2. **The CFO's passkey is the only approval.** Approving a payment is a WebAuthn signature, by the CFO's passkey, over
   the payment's exact terms. No token can make one, and an AI never sees the challenge the passkey signs.
3. **The demo company proposes nothing.** Its public token reads made-up data.
4. **Narrow tokens.** A connector token works at `/mcp` only and `/mcp` takes nothing else; tokens are kept as a hash,
   expire, and end at once when revoked ([connect-claude.md, Security](connect-claude.md#security)).
5. **One company per token.** A token reads its own company's books and resources only.

What stops a payment beyond this server (Purser's checks in code, the CFO's passkey, the rail's own controls) is in
[security.md](security.md) and [controls-matrix.md](controls-matrix.md); the security artefacts are in
[security/README.md](security/README.md).

## How a proposal reaches the CFO

1. The AI calls `propose_invoice_payment` with an invoice's id (a token made to propose; not on the demo company).
   Purser checks the invoice as the *Pay* button in Purser Cloud does and refuses one that is held, already waiting or
   paid (`refused`, with Purser's reason).
2. Filed, the proposal waits in Purser Cloud beside the ones filed there. The answer gives its id, its terms, their
   SHA-256 (`terms_sha256`) and `"paid": false`; `pending_approvals` lists it with where to approve it.
3. The CFO reads the terms in Purser Cloud and approves them with the passkey, rejects them, or lets them expire.
   `payment_proposal` shows where it stands.
4. Only an approved proposal is paid. The signature covers the exact terms: one changed cent and the approval no longer matches the terms.

The AI's part ends at step 1. It should tell its user that the CFO approves; the server's instructions say so too.

## Not this server: the agent API on the runner

Purser has a second MCP server, for a different job: the agent API (`npm run -s mcp`, stdio, on the company's own
runner) serves one outside agent its own company card. That agent can pay merchants on its card within the limits
Airwallex enforces, and ask the CFO for a card or a higher limit; it cannot approve anything. It is not in the MCP
Registry and is described in [agent-api.md](agent-api.md).

## The MCP Registry

[`server.json`](../server.json) describes this server for the official MCP Registry (schema 2025-12-11):
`io.github.agamemnon-coder/purser`, a remote-only server at the hosted cloud's `/mcp`, its `Authorization` header
optional and secret, filled from one secret variable (`Bearer {connector_token}`). It is not published; publishing is
a step for the owner ([connect-claude.md](connect-claude.md#the-mcp-registry)). Its `version` and
the server's `SERVER_VERSION` are held equal by a test.

## The tests that hold this page

| Test | What it holds |
|---|---|
| [`test/mcp-contract.test.ts`](../test/mcp-contract.test.ts) | Every tool's description, schema, examples (accepted by the schema and by the server) and annotations; the error shape and codes; a write or pay attempt refused for every token; a proposal pays nothing |
| [`test/mcp-upgrade.test.ts`](../test/mcp-upgrade.test.ts) | Both protocol eras, headers, output schemas, resources, pagination, OAuth metadata, `/connect-ai` |
| [`test/mcp-route-money-out.test.ts`](../test/mcp-route-money-out.test.ts) | `route_money_out`: every route, each kind of token, the demo company, nothing filed, the pointer on guessed money tool names |
| [`test/cloud-claude.test.ts`](../test/cloud-claude.test.ts) | Connector tokens, reading, proposing, the demo company, the OAuth sign-in |
| [`test/mcp-registry.test.ts`](../test/mcp-registry.test.ts) | `server.json` against the registry's schema, and complete |
