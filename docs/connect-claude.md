# Connect Claude to Purser

Use your own Claude account (claude.ai, Claude Desktop or Claude Code) with your company's Purser. Claude reads your
books, and you can let it propose an invoice's payment. **Claude can never approve or pay.** Every payment still needs
the CFO's Face ID in Purser Cloud: the approval is a passkey signature over the payment's exact terms, and no token
can make one.

Purser is a remote MCP server at **`<your Purser Cloud address>/mcp`**. For the hosted test cloud that is
`https://purser-try.max-31b.workers.dev/mcp`. Checked on 13 November 2026, 06:57 UTC: `tools/list` there with the demo company's token answers the 7 read tools (the two proposal tools need a token that may propose).

## Three steps

1. **Make a connector token.** In Purser Cloud go to Settings, Connect Claude. Name the token. Tick *may propose
   payments* only if Claude should file payments for approval. Click *Make a token* and copy it: it is shown once.
   Only an owner, signed in with a passkey, can make or revoke a token.
2. **Add Purser to Claude.**
   - *claude.ai or Claude Desktop:* Settings, Connectors, *Add custom connector*. Paste the `/mcp` address.
   - *Claude Code:* run
     `claude mcp add --transport http purser <address>/mcp --header "Authorization: Bearer <your token>"`,
     or install the plugin below.
3. **Sign in.** claude.ai opens Purser's sign-in page. Paste your token there, or choose the demo company. Claude Code
   needs no sign-in: the token is in the header.

That's all. Ask Claude "what's waiting for the CFO?", "show me this quarter's VAT" or "what did my agents decide this
week?".

## Try it with the demo company

The demo company (*Northwind Outdoor (demo company)*, the same one as *Try as guest* in Purser Cloud) has a public
token: **`purser-demo-read-only`**. It reads made-up data from a simulated month, with no real money, and can propose
nothing. On Purser's sign-in page in claude.ai, choose *Use the demo company* instead of pasting a token.

## What Claude can do

| Tool | What it does | Needs |
|---|---|---|
| `company_overview` | Net cash day by day, spend by agent, payments per week, invoices by state, newest decisions | any token |
| `list_invoices`, `get_invoice` | Supplier invoices, their checks and earlier versions | any token |
| `list_transactions` | Every money movement on every rail, with its approval, booking and proof | any token |
| `books_report` | P&L, balance sheet, trial balance, VAT per quarter, payables, receivables | any token |
| `agent_decisions` | The audit trail in words: who decided what (an agent, the CFO, or Purser's code) | any token |
| `what_needs_attention` | Open, due, overdue, waiting, blocked; spend per supplier | any token |
| `propose_invoice_payment` | Files an invoice's payment for the CFO's approval. Nothing is paid. | a token that may propose, on a cloud that runs the engine |
| `payment_proposal` | Where a proposal stands: waiting, approved and paid, refused, expired | a token that may propose |

There is no tool that approves, pays, changes a limit, adds a supplier or writes to the books. A proposal goes into the
same queue as one filed in Purser Cloud. Claude never sees the challenge a passkey signs.

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

- **Hashed at rest, shown once.** A connector token is an API key with the read scope and a Claude purpose. Purser keeps
  only the SHA-256 of its secret. It expires after 90 days unless made with fewer, at most a year.
- **Revocable.** Revoke a token in Settings, Connect Claude, and Claude's connection with it ends at once. That includes
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
- **Proposals only.** With a token that may propose, Claude files the payment exactly as the Pay button in Purser Cloud
  does. The CFO reads the terms on their phone and approves with Face ID, or the proposal expires.

## OAuth details (for claude.ai)

**What ran, and what did not:** the test suite runs the MCP protocol and this whole sign-in on a cloud in the test
process (`test/cloud-claude.test.ts`). It has not yet been tried live from claude.ai, Claude Desktop or Claude Code
against a deployed cloud: this branch makes no live calls and deploys nothing.


`/mcp` answers 401 with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`
(RFC 9728). The authorization server's metadata is at `/.well-known/oauth-authorization-server` (RFC 8414). Clients
register at `/oauth/register` (RFC 7591, public clients) and use the authorization code flow with PKCE S256. The
consent page `/oauth/authorize` takes a connector token or the demo. Its forms carry their own token, signed by Purser, bound to that authorization request, good for ten minutes and spent on first use. The Origin check cannot hold this page: it is reached through the client's redirects, and an app's own browser (Claude on iOS) posts it with `Origin: null`. `/oauth/token` gives an access token for at most
30 days, never longer than the connector token lives. When it ends, Claude asks you to sign in again. The endpoints and
their tests are in `cloud/src/claude/` and `test/cloud-claude.test.ts`. The API table is in [cloud.md](cloud.md).
