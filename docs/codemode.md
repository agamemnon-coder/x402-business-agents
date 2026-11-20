# Airwallex in "Code Mode": a read-only MCP server (`/mcp/airwallex`)

Purser Cloud (the `purser-try` Worker) answers a second MCP server at `POST /mcp/airwallex`. It reads the Airwallex
**sandbox** (test money) and nothing else. Instead of one MCP tool per Airwallex endpoint it has two tools, the pattern
Cloudflare calls Code Mode ([blog](https://blog.cloudflare.com/code-mode-mcp),
[guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/)):

- `search`: looks through a small OpenAPI document of the allowed reads ([`openapi/airwallex-read.json`](../openapi/airwallex-read.json))
  and returns only the matching operations (method, path, parameters, response). It calls nothing.
- `execute`: runs a plan of up to 10 `GET` calls and returns only what the plan selects.

## The declarative variant, not sandboxed JavaScript

Cloudflare's Code Mode runs code the model writes in a Worker Loader isolate (`worker_loaders` binding,
`@cloudflare/codemode`). That is marked experimental, and it needs new packages and a new binding in the account. This
server does **not** run model-written code. `execute` takes a JSON plan:

```json
{ "calls": [
  { "as": "bal", "method": "GET", "path": "/balances/current", "select": ["currency", "available_amount"] },
  { "as": "paid", "method": "GET", "path": "/transfers", "query": { "page_size": 100 },
    "where": [{ "field": "status", "equals": "PAID" }],
    "aggregate": { "sum": "transfer_amount", "group_by": "transfer_currency" } }
] }
```

Each call can keep only some fields (`select`, dot paths), filter by equality (`where`), count and sum a field, optionally
per group (`aggregate`), and cap the items (`limit`, default 50, at most 200). There are no loops, no branches and no
call that depends on another call's answer.

## Read only, enforced on the host

The check runs in Purser Cloud before anything is sent (`checkRead` in `cloud/src/claude/awxCodemode.ts`):

- `GET` only. `POST`, `PUT`, `DELETE`, anything else: refused.
- Only the paths in `AWX_CODEMODE_READS` (anchored patterns; an `{id}` must be a UUID), and only each operation's own
  query keys with plain values.
- A path must be a plain path under the API: no `..`, `%`, `\`, `?`, `#`, `@`, `//`, whitespace, absolute URL or other
  origin. The resolved URL must stay on `https://api.sandbox.airwallex.com/api/v1`; any other base URL is refused.
- One refused call in a plan and no call in it is made.

| operationId | path | query keys |
| --- | --- | --- |
| getCurrentBalances | `/balances/current` | none |
| listGlobalAccounts | `/global_accounts` | page_num, page_size |
| listFinancialTransactions | `/financial_transactions` | from_created_at, to_created_at, currency, status, source_id, page_num, page_size |
| getCurrentFxRate | `/fx/rates/current` | buy_currency, sell_currency |
| listConversions | `/fx/conversions` | request_id, status, from_created_at, to_created_at, page_num, page_size |
| listTransfers | `/transfers` | request_id, status, from_created_at, to_created_at, page_num, page_size |
| getTransfer | `/transfers/{id}` | none |
| listBeneficiaries | `/beneficiaries` | page_num, page_size |
| listCards | `/issuing/cards` | card_status, page_num, page_size |
| getCard | `/issuing/cards/{id}` | none (never `/details`, the card number) |

`test/airwallex-codemode-mcp.test.ts` holds the spec equal to this list.

**No credential in Purser Cloud.** The allowed calls go over the existing service binding `AWX_GATEWAY` to kit11's
`AwxGateway` entrypoint (`worker/src/awxGateway.ts`), which holds the sandbox key, logs in, and checks its own allow-list
(`src/airwallex/gatewayRules.ts`) a second time. Reads pass there with the key; writes also need `AWX_GATEWAY_WRITE=on`,
and this server never asks for one. Answers carry Airwallex's JSON, or only its error code and trace id. Every tool
output and error is also passed through `redact()` (bearer tokens, JWTs, key headers).

Money moves only through Purser: its limits, and the CFO's passkey (Face ID) for anything over them.

## What it cannot do

- Write anything: no transfer, conversion, beneficiary, card change or simulation.
- Read anything off the list (deposits, batch transfers, card numbers, cardholders, card transactions, other APIs).
- Run code: plans are data. A call cannot use the result of another call; to read one transfer after listing them, the
  client runs a second `execute`.
- Page through results by itself: a plan names `page_num` and `page_size` per call.
- Read a live (non-sandbox) Airwallex account.

## Token cost of the tool list (measured 20 Nov 2026)

`npx tsx scripts/codemode-tokens.ts` builds both tool lists from the same spec and writes
[`docs/evidence/codemode-tokens.json`](evidence/codemode-tokens.json).

Method: **an approximation, characters / 4**. `ANTHROPIC_API_KEY` was not set, so Anthropic's free `count_tokens`
endpoint was not called. With the key set, the script uses `count_tokens` (model `claude-sonnet-5-5`) instead.

| tool list | tools | approx. tokens |
| --- | --- | --- |
| one tool per endpoint | 10 | 1,255 |
| Code Mode (search, execute) | 2 | 564 |
| saving | | 691 (55.1%) |

This counts only the tool definitions, which sit in the context on every turn. Code Mode then spends tokens per task
(the search answer, the plan and its result). The two-tool list stays the same size while the per-endpoint list grows
by about 126 tokens per endpoint here, so the saving grows with the number of endpoints. With 10 endpoints it is small.
Cloudflare's figure (about 1,000 tokens instead of 1.17 million) is about their own API with over 2,500 endpoints, not
this one.

## How to connect

Make a Claude connector token in Purser Cloud (Connections, Connect your AI: a signed-in owner), then add a remote MCP
server at `https://<purser-cloud>/mcp/airwallex` with `Authorization: Bearer <token>`, or sign in by OAuth as for
`/mcp`. The same tokens work at `/mcp` and `/mcp/airwallex`, nowhere else. The demo company's public token is refused
here (the sandbox is not the demo company's data). Each token may make 20 requests a minute.

Claude Code: `claude mcp add --transport http purser-airwallex https://<purser-cloud>/mcp/airwallex --header "Authorization: Bearer <token>"`.

Requirements on the deployment: the `AWX_GATEWAY` service binding (already in `cloud/wrangler.try.jsonc`), and kit11
deployed with the three new read rules in `src/airwallex/gatewayRules.ts` (`/financial_transactions`, `/issuing/cards`,
`/issuing/cards/{id}`); until then those three answer `gateway_refused`. The gateway's key (`AWX_ACT_*`, else the
Worker's sandbox key) must have the read scopes (Issuing for cards).
