<div align="center">

<a href="../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/brand/purser-mark-dark.svg"><img src="assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Install, quick start and uninstall

**Install Purser, do something with it in five minutes, set up a development environment, and remove it again.**

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain)&nbsp;[![Node.js 22.13 or newer, or 24](https://img.shields.io/badge/Node.js-22.13%2B_or_24-339933?style=flat-square&labelColor=1f2937)](#quick-start-no-keys-offline)&nbsp;[![Quick start: no keys, no network beyond npm](https://img.shields.io/badge/quick_start-no_keys_%C2%B7_offline-10b981?style=flat-square&labelColor=1f2937)](#quick-start-no-keys-offline)&nbsp;[![Three forms: the code, the MCP connector, the Claude Code plugin](https://img.shields.io/badge/forms-code_%C2%B7_MCP_connector_%C2%B7_Claude_Code_plugin-8b5cf6?style=flat-square&labelColor=1f2937)](#install-quick-start-and-uninstall)&nbsp;[![Nothing installed system-wide](https://img.shields.io/badge/system--wide_installs-none-0ea5e9?style=flat-square&labelColor=1f2937)](#where-purser-writes)&nbsp;[![Test money only](https://img.shields.io/badge/money-test_only-f59e0b?style=flat-square&labelColor=1f2937)](../README.md#built-with)

[Quick start](#quick-start-no-keys-offline) · [Development](#the-development-environment) · [Running it live](#running-it-live-sandbox-and-testnet-keys) · [Where Purser writes](#where-purser-writes) · [Uninstall](#uninstall) · [MCP connector](#the-mcp-connector) · [Claude Code plugin](#the-claude-code-plugin)

</div>

How to install Purser, do something with it in five minutes, set up a development environment, and remove it again.
Written on 19 November 2026. Test money only: nothing here touches real money, and the quick start needs no key and no
network beyond npm.

Purser comes in three forms; each installs and uninstalls with its platform's usual commands.

| Form | Install | Uninstall |
|---|---|---|
| **The code** (the runner, the agents, the CLIs, the pages) | `git clone` and `npm ci` | delete the folder, and the ledger and keys folders if you set them elsewhere |
| **The MCP connector** (your AI reads a Purser company's books) | add a remote MCP server in your AI client | remove that server in your AI client |
| **The Claude Code plugin** | `/plugin marketplace add` and `/plugin install` | `/plugin uninstall` and `/plugin marketplace remove` |

## Quick start (no keys, offline)

Requirements: Node.js 22.13 or newer (or 24), npm and git.

```sh
git clone https://github.com/agamemnon-coder/x402-business-agents.git
cd x402-business-agents
npm ci                       # installs exactly the lockfile's versions
npm run judge                # serves the recorded demo, the simulated month and the hands-on /try at http://127.0.0.1:4311
```

```mermaid
flowchart LR
  C["git clone"] --> CI["npm ci<br/>the lockfile's versions"] --> J["npm run judge<br/>http://127.0.0.1:4311"]
  J --> T["/try<br/>pick an invoice"]
  T -- "within the limit" --> P["The agent pays"]
  T -- "above the limit" --> K["You approve<br/>with your own passkey"]
  K --> CENT["One changed cent<br/>refused"]
  K --> PR["The proof downloads"]
  classDef rails fill:#0ea5e9,stroke:#0369a1,color:#111827
  classDef purser fill:#8b5cf6,stroke:#6d28d9,color:#ffffff
  classDef ok fill:#10b981,stroke:#047857,color:#111827
  classDef stop fill:#f43f5e,stroke:#be123c,color:#111827
  class C,CI,J rails
  class T,K purser
  class P,PR ok
  class CENT stop
```

Open `/try`: pick an invoice, the agent pays it within its limit; above the limit you approve with your own passkey,
one changed cent is refused, and the proof downloads. `npm run judge -- --check` builds every page once and exits
(what CI runs). To check a recorded approval offline: `npm run verify-approval`.

## The development environment

The same clone is the development environment; the tests need no key and make no network call.

```sh
npm ci
npm run typecheck            # TypeScript, strict
npm run lint                 # ESLint
npm test                     # the whole suite (vitest); npm run test:coverage adds coverage per area
npx playwright install chromium   # only for the browser checks in test/browser/*.check.ts
```

The relay Worker has its own lockfile: `cd worker && npm ci`. What a pull request must pass:
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Running it live (sandbox and testnet keys)

[run-it.md](run-it.md): copy `.env.example` to `.env` (never committed), fill in the Airwallex sandbox and Alta testnet
credentials, set `KIT11_KEYS_DIR` to a folder outside the repository, and `npm run health`, then `npm run demo:all`.
Purser Cloud's deployment on Cloudflare: [cloud.md](cloud.md).

## Where Purser writes

Nothing outside the folders you name:

| What | Where | Set by |
|---|---|---|
| Dependencies | `node_modules/` in the clone (and `worker/node_modules/`) | npm |
| The ledger (SQLite) | `data/kit11.sqlite` in the clone | `KIT11_DB` names another file |
| Owner key, mandate keys, agent credentials | the keys folder, which must lie outside the repository | `KIT11_KEYS_DIR` |
| Pages, screenshots, run records written by CLIs | under `docs/`, `test-results/` and `coverage/` in the clone, only when you run those commands | the command's arguments |

Nothing is installed system-wide, and nothing runs at install time beyond the dependencies' own install scripts from
the lockfile.

## Uninstall

1. Stop any running `npm run …` process (Ctrl+C).
2. If you ran it live, keep or delete what you set up outside the clone: the keys folder (`KIT11_KEYS_DIR`) and a ledger
   you put elsewhere (`KIT11_DB`). Revoke the sandbox API keys at Airwallex and the Alta console if you no longer need
   them.
3. Delete the clone: `rm -rf x402-business-agents` (on Windows, delete the folder). That removes the code, its
   `node_modules/`, the default ledger in `data/` and everything the commands wrote.
4. The browsers Playwright downloaded for the browser checks are in its own cache (`~/.cache/ms-playwright` on Linux);
   `npx playwright uninstall --all` removes them.

## The MCP connector

Install: add `https://purser-try.max-31b.workers.dev/mcp` (or your own Purser Cloud's `/mcp`) as a remote MCP server in
your AI client, each client's steps in [connect-claude.md](connect-claude.md); for example in Claude Code,
`claude mcp add --transport http purser <address>/mcp`.

Uninstall: remove the server in the same place (in Claude Code, `claude mcp remove purser`; in claude.ai and the Claude
apps, under Settings → Connectors), and revoke its token in Purser Cloud (Settings → Connect your AI).

## The Claude Code plugin

Install:

```text
/plugin marketplace add agamemnon-coder/x402-business-agents
/plugin install purser@purser
```

Uninstall:

```text
/plugin uninstall purser@purser
/plugin marketplace remove purser
```
