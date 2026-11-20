# Connect any AI

Moved from the [README](../README.md) on 15 November, to keep it short.

Use your own AI assistant with a Purser company: Claude (claude.ai, the Claude apps, Claude Code), ChatGPT, Cursor, VS Code's agent mode, Gemini CLI, Windsurf, or any client that speaks MCP to a remote server. It reads the books and can propose an invoice's payment; **it can never approve or pay**: every payment still needs the CFO's passkey over the exact terms.

1. In Purser Cloud, Settings, Connect your AI: make a connector token (only an owner signed in with a passkey can).
2. In your AI, add the remote MCP server `https://purser-try.max-31b.workers.dev/mcp` (in Claude Code: `/plugin marketplace add agamemnon-coder/x402-business-agents` and `/plugin install purser@purser`).
3. Sign in with your token, or choose the demo company: its public, read-only token is `purser-demo-read-only` (made-up data from a simulated month, test money; it can propose nothing).

Purser shows with its own icon and offers three ready-made prompts: *CFO weekly brief*, *What needs my Face ID?* and *Explain this invoice*. Checked on 14 November 2026, 14:44 UTC: `tools/list` on that address with the demo token answers HTTP 200 with 14 read tools, each marked read-only (on 13 November, 06:57 UTC, the version deployed then answered 7); on 13 November the owner added it in the Claude iOS app (as the owner states it). The other clients are listed from their own documentation and have not been tried live against a deployed cloud. Every client's steps and every tool: [docs/connect-claude.md](connect-claude.md); every tool's annotations, the error codes and the safety model: [docs/mcp.md](mcp.md).

Since 13 November, and live on that address: the server speaks MCP 2026-07-28 as well as the older revisions, with 14 read tools (cash and its projection, what waits for approval, the CFO's policy in plain words, spend by agent or supplier, VAT, a payment's audit trail, one payment explained), the books as resources, sign-in by Client ID Metadata Document for ChatGPT and Claude, and a page per client at `/connect-ai` with one-click links for Cursor and VS Code. Checked with the MCP Inspector against a local cloud; ChatGPT, Cursor, VS Code, Gemini CLI and Windsurf are described from their own documentation. Connections to other systems, read or export only (signed webhooks, Slack and Teams message formats, Xero, QuickBooks and Exact CSV, the read API's OpenAPI), each labelled live or format export: [docs/connections.md](connections.md).

Every other way in or out of Purser (the payment rails, the API and its webhooks, no-code tools, accounting, Peppol, chat), each with its label and a quickstart: [Connect Purser to anything](integrations/README.md).
