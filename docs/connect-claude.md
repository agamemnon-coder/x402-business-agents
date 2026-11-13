# Connect any AI to Purser

Use your own AI assistant with your company's Purser: Claude (claude.ai, the Claude apps, Claude Code), ChatGPT, Cursor,
VS Code's agent mode, Gemini CLI, Windsurf, or any client that speaks the Model Context Protocol (MCP) to a remote server. It reads
your books, and you can let it propose an invoice's payment. **It can never approve or pay.** Every payment still needs
the CFO's Face ID in Purser Cloud: the approval is a passkey signature over the payment's exact terms, and no token can
make one.

Purser is a remote MCP server (Streamable HTTP) at **`<your Purser Cloud address>/mcp`**. For the hosted test cloud
that is `https://purser-try.max-31b.workers.dev/mcp`.

**What ran live, and where.** On 13 November 2026, 06:57 UTC, `tools/list` there with the demo company's token answered
the 7 read tools of the version deployed then (this version has 14; see *Which clients were verified*). The same morning the owner added Purser as a connector in the **Claude iOS app**: its 7 tools showed,
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

Then ask: "what needs my Face ID?", "show me this quarter's VAT", "explain the Lagerhaus payment" or "what did my agents
decide this week?". Purser also offers five ready-made prompts (below).

## Claude

- **claude.ai, the Claude desktop and mobile apps** (tested live in the iOS app on 13 Nov): Settings,
  Connectors, *Add custom connector*, paste the `/mcp` address. Claude opens Purser's consent page: paste your token, or
  choose *Use the demo company*.
- **Claude Code:**
  `claude mcp add --transport http purser <address>/mcp --header "Authorization: Bearer <your token>"`,
  or the plugin below.

## The connect page

Every Purser Cloud serves **`/connect-ai`** (on the test cloud:
[purser-try.max-31b.workers.dev/connect-ai](https://purser-try.max-31b.workers.dev/connect-ai), once this version is
deployed): a tab per client with the exact config for that cloud's address, and a one-click **Add to Cursor** and
**Add to VS Code** link. The tabs below say the same.

## ChatGPT

In ChatGPT on the web: Apps (or Plugins), **+**, *Add custom MCP server*; name *Purser*, URL `<address>/mcp`,
authentication **OAuth**. ChatGPT finds Purser's sign-in itself and registers by Client ID Metadata Document (or
dynamic registration); on Purser's page paste your connector token or choose *Use the demo company*. ChatGPT cannot send
a fixed token, so the demo token does not apply there. OpenAI's pages (read 13 Nov) list custom MCP servers for
Business, Enterprise and Edu workspaces, and read/fetch connectors for Pro. Purser's tools are all read-only, and
`search`/`fetch` tools are no longer required.

## Cursor

`~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project), or the **Add to Cursor** link on `/connect-ai`
(`cursor://anysphere.cursor-deeplink/mcp/install?name=purser&config=<base64 of {"url": "<address>/mcp"}>`). Without a
header Cursor signs in through Purser's page.

```json
{ "mcpServers": { "purser": { "url": "https://purser-try.max-31b.workers.dev/mcp", "headers": { "Authorization": "Bearer ${env:PURSER_CONNECTOR_TOKEN}" } } } }
```

## VS Code (GitHub Copilot agent mode)

The **Add to VS Code** link on `/connect-ai` (`vscode:mcp/install?<url-encoded {"name","type":"http","url"}>`, opened
through `https://vscode.dev/redirect`), or Command Palette, *MCP: Add Server*, *HTTP*. VS Code's documentation now
puts new servers in `.mcp.json` at the workspace root (or `~/.copilot/mcp-config.json`):

```json
{ "mcpServers": { "purser": { "type": "http", "url": "https://purser-try.max-31b.workers.dev/mcp", "headers": { "Authorization": "Bearer ${PURSER_CONNECTOR_TOKEN}" } } } }
```

The older `.vscode/mcp.json` (`"servers"`, with an `inputs` prompt for the token) still works; `/connect-ai` shows both.

## Gemini CLI

`httpUrl` (not `url`, which means SSE) in `~/.gemini/settings.json`, or the command:

```
gemini mcp add --transport http --scope user --header "Authorization: Bearer purser-demo-read-only" purser https://purser-try.max-31b.workers.dev/mcp
```

```json
{ "mcpServers": { "purser": { "httpUrl": "https://purser-try.max-31b.workers.dev/mcp", "headers": { "Authorization": "Bearer purser-demo-read-only" } } } }
```

## Windsurf (now Devin Desktop)

Windsurf's MCP documentation now lives in Devin's docs. In `~/.config/devin/mcp_config.json` (older Windsurf:
`~/.codeium/windsurf/mcp_config.json`), `serverUrl` (or `url`) and `headers`:

```json
{ "mcpServers": { "purser": { "serverUrl": "https://purser-try.max-31b.workers.dev/mcp", "headers": { "Authorization": "Bearer ${env:PURSER_CONNECTOR_TOKEN}" } } } }
```

## Which clients were verified, and how

| Client | How it was checked (13 Nov 2026) |
|---|---|
| MCP Inspector 2.15.0 (CLI) | **Run** against this version on a local cloud (`npm run mcp:local`): `tools/list` (14 tools, `--strict`: no schema-portability warnings), `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list` |
| The official MCP TypeScript SDK client (1.32) | **Run** in `test/browser/connector.check.ts`: OAuth sign-in in a real browser, then every read tool and a prompt |
| Claude iOS app | **Run** by the owner on 13 Nov against the deployed cloud before this version (7 tools then) |
| claude.ai, Claude Desktop, Claude Code | From Claude's help centre and Claude Code's docs (custom connectors, `claude mcp add --transport http`, DCR and CIMD) |
| ChatGPT | From OpenAI's developer docs (custom MCP server, OAuth with PKCE, CIMD/DCR, no static tokens) |
| Cursor | From cursor.com/docs/mcp and its install-link page |
| VS Code / Copilot | From VS Code's MCP configuration reference and its install-link guide |
| Gemini CLI | From the Gemini CLI MCP docs (`httpUrl`, `gemini mcp add`) |
| Windsurf / Devin | From Devin's docs (Cascade MCP, `serverUrl`) |

The protocol itself, both eras, is checked in `test/mcp-upgrade.test.ts` against the 2026-07-28 specification.

## What your AI can do

| Tool | What it does | Needs |
|---|---|---|
| `company_overview` | Money in and out, net cash, invoices by state, spend by agent, the newest decisions | any token |
| `list_invoices`, `get_invoice` | Supplier invoices, their checks and earlier versions | any token |
| `list_transactions` | Every money movement on every rail, with its approval, booking and proof | any token |
| `books_report` | P&L, balance sheet, trial balance, VAT per quarter, payables, receivables | any token |
| `agent_decisions` | The audit trail in words: who decided what (an agent, the CFO, or Purser's code) | any token |
| `what_needs_attention` | Open, due, overdue, waiting, blocked | any token |
| `cash_position` | Net cash (money in minus out since the first movement, not a bank balance) and a week-by-week projection from the books' due days | any token |
| `pending_approvals` | Invoices and proposals waiting for the CFO's Face ID, each with a link to approve it in Purser Cloud (read only) | any token |
| `cfo_policy` | The rules every payment is held to, in plain words; the policy version in force; each agent's card limits; treasury settings | any token |
| `spend_breakdown` | Money out by agent or by supplier, per currency, fees included, declines counted | any token |
| `vat_summary` | A quarter's VAT as the Dutch return's rubrics (current quarter by default). An overview, not a filing | any token |
| `payment_audit_trail` | Every recorded step of one payment, from invoice to approval to transfer to booking (by payment, invoice or proposal id) | any token |
| `explain_payment` | One payment in plain words: who, how much, why, who allowed it and how, where it is booked | any token |
| `propose_invoice_payment` | Files an invoice's payment for the CFO's approval. Nothing is paid. | a token that may propose, on a cloud that runs the engine |
| `payment_proposal` | Where a proposal stands: waiting, approved and paid, refused, expired | a token that may propose |

**Resources.** The books, the approvals, the policy and every invoice are also readable resources with `purser://`
URIs (`resources/list`, `resources/read`), with templates for one invoice (`purser://invoices/{id}`), one payment and
its trail (`purser://payments/{id}`), a quarter's VAT (`purser://books/vat/{quarter}`) and a ledger report
(`purser://books/{report}`). Tool results link the resources they name (`resource_link`).

**Prompts.** *CFO weekly brief*, *What needs my Face ID?*, *Explain this invoice*, *Explain this payment* and *Cash
outlook*.

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
- **Where you go back to.** The consent page names the host the browser returns to after you allow ("After you allow,
  you go back to claude.ai"). claude.ai, claude.com, chatgpt.com and this computer (localhost) are known; any other host
  gets a warning, since a client can call itself anything.
- **Proposals only.** With a token that may propose, your AI files the payment exactly as the Pay button in Purser
  Cloud does. The CFO reads the terms on their phone and approves with Face ID, or the proposal expires.

## Protocol

Purser speaks MCP **2026-07-28** (the current revision: every request carries its version and capabilities in
`_meta`, mirrored into the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, which Purser checks against the
body; `server/discover`; `resultType` and `serverInfo` on every result; `ttlMs`/`cacheScope` on lists and reads), and,
for clients that open with `initialize`, **2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05**. No session is kept in
either. Every tool has a title, Purser's icons, annotations (`readOnlyHint: true`, `openWorldHint: false`) and an
`outputSchema` its `structuredContent` conforms to. Lists page with an opaque cursor. Errors say what to do next:
a wrong argument is a tool result with `isError` naming the argument; an unknown tool, prompt, resource or cursor is
`-32602` with the list to look in; a header that disagrees with the body is `-32020` (HTTP 400); an unsupported
version is `-32022` (HTTP 400) with the versions Purser speaks; an unknown method is `-32601` (HTTP 404). The Origin
check holds: a browser page on another site gets 403; Claude's own web origins may call `/mcp`.

## OAuth details

`/mcp` answers 401 with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource",
scope="purser"` (RFC 9728; also served at `/.well-known/oauth-protected-resource/mcp`). The authorization server's
metadata is at `/.well-known/oauth-authorization-server` (RFC 8414: PKCE S256, public clients,
`authorization_response_iss_parameter_supported` (RFC 9207: every answer carries `iss`),
`client_id_metadata_document_supported`, Purser's `logo_uri`). A client registers in one of two ways: by **Client ID
Metadata Document** (its `client_id` is the https address of its own metadata document; Purser fetches it without
following redirects, at most 10 kB, keeps it five minutes, and takes it only when it names that exact address and lists
the redirect address; the consent page then shows the host it came from), or at `/oauth/register` (RFC 7591, public
clients; the client's id is signed, not stored). Then the authorization code flow with PKCE S256. The consent page `/oauth/authorize` takes a connector token or the demo. Its forms carry their own
token, signed by Purser, bound to that authorization request, good for ten minutes and spent on first use. The Origin
check cannot hold this page: it is reached through the client's redirects, and an app's own browser (Claude on iOS)
posts it with `Origin: null`. `/oauth/token` gives an access token for at most 30 days, never longer than the connector
token lives. When it ends, the client asks you to sign in again. The server's `initialize` names Purser's icons
(`/icon.png`, `/favicon.svg`). The endpoints and their tests are in `cloud/src/claude/`, `test/cloud-claude.test.ts`
and `test/browser/connector.check.ts`. The API table is in [cloud.md](cloud.md).

## The MCP Registry (a step for the owner)

`server.json` at the repository's root describes Purser for the official MCP Registry (schema 2025-12-11; it validates
in `test/mcp-registry.test.ts`): `io.github.agamemnon-coder/purser`, a remote-only server at the test cloud's `/mcp`
with an optional, secret `Authorization` header. **It is not published.** To publish, the owner runs, once this version
is deployed:

1. Install `mcp-publisher` as the registry's quickstart says (github.com/modelcontextprotocol/registry).
2. `mcp-publisher login github` (as `agamemnon-coder`; the `io.github.agamemnon-coder/*` namespace follows the login).
3. `mcp-publisher publish` in the repository's root.

The registry checks the namespace, not the remote address; a later version needs `version` raised in both
`server.json` and `cloud/src/claude/mcp.ts` (`SERVER_VERSION`; the test holds them equal).

## Run it locally, and the Inspector

`npm run mcp:local` serves the cloud's handler (demo company, read only) at `http://localhost:8787/mcp`. Then:

```
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --transport http --method tools/list --header "Authorization: Bearer purser-demo-read-only"
```

Connections to other systems (webhooks, chat messages, accounting exports, the read API's OpenAPI) are in
[connections.md](connections.md).
