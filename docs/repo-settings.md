# GitHub repository settings

For the owner to set by hand in the repository's settings (Code → About, the gear icon). Nothing here is set by a
script.

## About

Paste these into Code → About (the gear icon). Checked against the README on 13 November 2026.

- **Description** (273 characters; GitHub allows 350):
  `Purser: the control layer between a company's AI agents and its money. Within limits the CFO signs, agents pay through Airwallex, Metal and Visa via Airi; above them, a passkey (Face ID on iPhone) signs the exact terms. MCP server in the official registry. Test money only.`
- **Website:** `https://kit11.max-31b.workers.dev`
- **Topics** (20, GitHub's maximum):
  `ai-agents`, `agentic-payments`, `fintech`, `airwallex`, `visa`, `metal`, `x402`, `passkeys`, `webauthn`, `claude`,
  `anthropic`, `mcp`, `mcp-server`, `model-context-protocol`, `cloudflare-workers`, `durable-objects`, `typescript`,
  `audit-log`, `accounting`, `hackathon`
- Untick **Packages** and **Deployments** in the About box (none are published here); keep **Releases**.
- The MCP server is listed in the official MCP Registry as `io.github.agamemnon-coder/purser` (version 1.1.0, status
  active, published 13 November 2026), its remote `https://purser-try.max-31b.workers.dev/mcp`; the README's badge links
  the registry entry.

## Social preview

Settings → General → Social preview: upload `docs/assets/social-preview.png`.

## Releases

The tag `v1.0-submission` exists (8 November). The next one, `v1.1-submission` (Max, 14 Nov), is the owner's to create after the final
merge; its notes are [docs/releases/v1.1-submission.md](releases/v1.1-submission.md). Create the release from that tag and paste
those notes.

## Branch protection (main)

Suggested, not yet set: require the `ci` workflow's jobs (test, judge, webkit, firefox, secrets, security) to pass
before merging, and require one review from CODEOWNERS.
