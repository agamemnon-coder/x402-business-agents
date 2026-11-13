# Connect any AI to Purser

Use your own AI assistant with your company's Purser: Claude (claude.ai, the Claude apps, Claude Code), Cursor, VS
Code's agent mode, Gemini CLI, or any client that speaks the Model Context Protocol (MCP) to a remote server. It reads
your books, and you can let it propose an invoice's payment. **It can never approve or pay.** Every payment still needs
the CFO's Face ID in Purser Cloud: the approval is a passkey signature over the payment's exact terms, and no token can
make one.

Purser is a remote MCP server (Streamable HTTP) at **`<your Purser Cloud address>/mcp`**. For the hosted test cloud
that is `https://purser-try.max-31b.workers.dev/mcp`.

**What ran live, and where.** On 13 November 2026, 06:57 UTC, `tools/list` there with the demo company's token answered
the 7 read tools. The same morning the owner added Purser as a connector in the **Claude iOS app**: its 7 tools showed,
and `agent_decisions` answered through that connector. No
other client below has been tried live against a deployed cloud. Each is listed because its own documentation describes
remote MCP servers this way (read 13 Nov). The whole sign-in and protocol run in this repository's checks on a cloud in
the test process (`test/cloud-claude.test.ts`, `test/browser/connector.check.ts`, which also connects with the official
MCP SDK's own client).

## Three steps

1. **Make a connector token.** In Purser Cloud go to Settings, Connect your AI. Name the token. Tick *may propose
   payments* only if your AI should file payments for approval. Click *Make a token* and copy it: it is shown once.
   Only an owner, signed in with a passkey, can make or revoke a token.
   To try first, use the demo company's public token instead: **`purser-demo-read-only`** (read only, made-up data).
2. **Add Purser to your AI**, as its section below shows: the `/mcp` address, and either the token as an
   `Authorization: Bearer` header or the client's own sign-in.
3. **Sign in** where the client asks: Purser's consent page takes your token, or *Use the demo company*.

Then ask: "what needs my Face ID?", "show me this quarter's VAT" or "what did my agents decide this week?". Purser also
offers three ready-made prompts: *CFO weekly brief*, *What needs my Face ID?* and *Explain this invoice*.

## Claude

- **claude.ai, the Claude desktop and mobile apps** (tested live in the iOS app on 13 Nov): Settings,
  Connectors, *Add custom connector*, paste the `/mcp` address. Claude opens Purser's consent page: paste your token, or
  choose *Use the demo company*.
- **Claude Code:**
  `claude mcp add --transport http purser <address>/mcp --header "Authorization: Bearer <your token>"`,
  or the plugin below.

## Cursor

`.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for every project (Cursor's documentation shows this shape,
with the token from an environment variable):

```json
{ "mcpServers": { "purser": { "url": "https://purser-try.max-31b.workers.dev/mcp", "headers": { "Authorization": "Bearer ${env:PURSER_CONNECTOR_TOKEN}" } } } }
```

## VS Code (GitHub Copilot agent mode)

Command Palette, *MCP: Add Server*, *HTTP*, then paste the `/mcp` address. Or in a workspace's `.mcp.json`:

```json
{ "mcpServers": { "purser": { "type": "http", "url": "https://purser-try.max-31b.workers.dev/mcp" } } }
```

VS Code's documentation lists `headers` for a server's request headers; its own example has none, so pass the token
there (`"headers": { "Authorization": "Bearer …" }`), or let VS Code sign in through Purser's consent page.

## Gemini CLI

In `settings.json` (`~/.gemini/settings.json`, or `.gemini/settings.json` in a project), with `httpUrl` for Streamable
HTTP, as Gemini CLI's documentation shows:

```json
{ "mcpServers": { "purser": { "httpUrl": "https://purser-try.max-31b.workers.dev/mcp", "headers": { "Authorization": "Bearer purser-demo-read-only" } } } }
```

## Windsurf (now Devin Desktop)

Windsurf's MCP documentation now leads to Devin Desktop, which takes remote servers with `url`, `transport: "http"`
and `headers` in `.devin/mcp_config.json` (or `~/.config/devin/mcp_config.json`):

```json
{ "mcpServers": { "purser": { "url": "https://purser-try.max-31b.workers.dev/mcp", "transport": "http", "headers": { "Authorization": "Bearer purser-demo-read-only" } } } }
```

## ChatGPT

Not listed with steps: OpenAI's pages on developer mode and MCP connectors could not be read from here on 13 Nov (one
moved to a page that answers 404, the other refused the request). Any client that takes a remote MCP server's address
and signs in by OAuth with dynamic client registration, or sends a bearer header, can use Purser.

## What your AI can do

| Tool | What it does | Needs |
|---|---|---|
| `company_overview` | Money in and out, net cash, invoices by state, spend by agent, the newest decisions | any token |
| `list_invoices`, `get_invoice` | Supplier invoices, their checks and earlier versions | any token |
| `list_transactions` | Every money movement on every rail, with its approval, booking and proof | any token |
| `books_report` | P&L, balance sheet, trial balance, VAT per quarter, payables, receivables | any token |
| `agent_decisions` | The audit trail in words: who decided what (an agent, the CFO, or Purser's code) | any token |
| `what_needs_attention` | Open, due, overdue, waiting, blocked | any token |
| `propose_invoice_payment` | Files an invoice's payment for the CFO's approval. Nothing is paid. | a token that may propose, on a cloud that runs the engine |
| `payment_proposal` | Where a proposal stands: waiting, approved and paid, refused, expired | a token that may propose |

Every answer starts with one plain sentence, then a few short lines, with money written as `EUR 1,793.00`, so it reads
well in a phone chat; the full record comes along as structured data. There is no tool that approves, pays, changes a
limit, adds a supplier or writes to the books. A proposal goes into the same queue as one filed in Purser Cloud. Your AI
never sees the challenge a passkey signs. The demo company is read as of its own last day (12 Nov 2026).

## The Claude Code plugin

This repository is a plugin marketplace (`.claude-plugin/marketplace.json`). Its plugin, `plugins/purser`, brings the
MCP server and three skills: *pay an invoice*, *show my books* and *what did my agents decide*.

```
/plugin marketplace add agamemnon-coder/x402-business-agents
/plugin install purser@purser
```

The plugin reads your token from the `PURSER_CONNECTOR_TOKEN` environment variable. Without it, the plugin uses the
demo company's public token. `PURSER_MCP_URL` points it at another Purser Cloud.

## Security

- **Hashed at rest, shown once.** A connector token is an API key with the read scope and a connector purpose. Purser
  keeps only the SHA-256 of its secret. It expires after 90 days unless made with fewer, at most a year.
- **Revocable.** Revoke a token in Settings, Connect your AI, and the connection with it ends at once. That includes
  every OAuth access token issued for it, because an access token names the token it was issued for and is checked
  against it on every request.
- **Narrow.** A connector token works at `/mcp` only, and `/mcp` takes nothing else. An admin key, a sync key or a
  session cannot be used as a connector, and a connector token cannot call the rest of the API.
- **No secret in a URL or log.** Tokens travel in the `Authorization` header. The request log records the route's
  pattern, never a token or a body. OAuth codes are kept as their hash for five minutes and are good once. A wrong
  verifier spends a code. The OAuth client's id is signed, not stored.
- **Rate limits.** Each token has its own per-minute limit, and so does each network for the demo token. Wrong tokens
  are counted per address, but a client's first call without a token is not: that call is how it finds the sign-in.
  The consent page is held to the sign-in limit per address.
- **Proposals only.** With a token that may propose, your AI files the payment exactly as the Pay button in Purser
  Cloud does. The CFO reads the terms on their phone and approves with Face ID, or the proposal expires.

## OAuth details

`/mcp` answers 401 with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`
(RFC 9728). The authorization server's metadata is at `/.well-known/oauth-authorization-server` (RFC 8414, with
Purser's `logo_uri`). Clients register at `/oauth/register` (RFC 7591, public clients) and use the authorization code
flow with PKCE S256. The consent page `/oauth/authorize` takes a connector token or the demo. Its forms carry their own
token, signed by Purser, bound to that authorization request, good for ten minutes and spent on first use. The Origin
check cannot hold this page: it is reached through the client's redirects, and an app's own browser (Claude on iOS)
posts it with `Origin: null`. `/oauth/token` gives an access token for at most 30 days, never longer than the connector
token lives. When it ends, the client asks you to sign in again. The server's `initialize` names Purser's icons
(`/icon.png`, `/favicon.svg`). The endpoints and their tests are in `cloud/src/claude/`, `test/cloud-claude.test.ts`
and `test/browser/connector.check.ts`. The API table is in [cloud.md](cloud.md).
