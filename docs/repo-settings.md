# GitHub repository settings

For the owner to set by hand in the repository's settings (Code → About, the gear icon). Nothing here is set by a
script.

## About

- **Description** (350 characters at most):
  `Purser: AI agents pay a company's suppliers through Airwallex and Metal, only within limits the CFO signs with Face ID. Test money only (Airwallex sandbox, Metal testnet). Airwallex Agentic Banking Hackathon, Starter Kit 11.`
- **Website:** `https://kit11.max-31b.workers.dev`
- **Topics** (15):
  `ai-agents`, `agentic-payments`, `fintech`, `airwallex`, `visa`, `metal`, `x402`, `passkeys`, `webauthn`, `claude`,
  `anthropic`, `mcp`, `cloudflare-workers`, `durable-objects`, `typescript`
- Untick **Packages** and **Deployments** in the About box (none are published here); keep **Releases**.

## Social preview

Settings → General → Social preview: upload `docs/assets/social-preview.png`.

## Releases

The tag `v1.0-submission` exists (8 November). The next one, `v1.1-final`, is the owner's to create after the final
merge; its notes are [docs/releases/v1.1-final.md](releases/v1.1-final.md). Create the release from that tag and paste
those notes.

## Branch protection (main)

Suggested, not yet set: require the `ci` workflow's jobs (test, judge, webkit, firefox, secrets, security) to pass
before merging, and require one review from CODEOWNERS.
