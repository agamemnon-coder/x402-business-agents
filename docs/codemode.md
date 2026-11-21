# Code Mode in Purser Cloud

Purser Cloud has two MCP servers in "Code Mode", the pattern Cloudflare describes in
[Code Mode](https://blog.cloudflare.com/code-mode/) and [Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp): instead
of one MCP tool per operation, an AI gets a small `search` and `execute` pair.

| server | what the AI writes | where it runs | status |
| --- | --- | --- | --- |
| `POST /mcp/codemode`: Purser's books | TypeScript/JavaScript against a typed API generated from Purser's read tools | a fresh Cloudflare Dynamic Worker (Worker Loader) per run | built; tested in local workerd with a real Worker Loader; not yet run on Cloudflare (needs the `LOADER` binding) |
| `POST /mcp/airwallex`: the Airwallex sandbox | a declarative JSON plan of `GET` calls (no code) | Purser Cloud's own Worker; no code is run | built, not tested live |

## What Cloudflare supports (checked 21 Nov 2026)

- **Dynamic Workers / Worker Loader** ([docs](https://developers.cloudflare.com/dynamic-workers/),
  [API reference](https://developers.cloudflare.com/dynamic-workers/api-reference/)): a Worker with a
  `"worker_loaders": [{ "binding": "LOADER" }]` binding starts isolates from code given at run time with
  `env.LOADER.load(code)` or `env.LOADER.get(id, callback)`. The `WorkerCode` names `compatibilityDate`, `mainModule`,
  `modules`, `env` (plain values and service or RPC stubs) and `globalOutbound`.
- **Egress** ([egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/)):
  `globalOutbound: null` makes every `fetch()` and `connect()` in the isolate throw; leaving it out inherits the loader's
  network. Cloudflare recommends blocking the network and giving capabilities as bindings
  ([bindings](https://developers.cloudflare.com/dynamic-workers/usage/bindings/): "Stubs have no global identifier and
  cannot be forged"; only the loader sees an entrypoint's `ctx.props`).
- **Limits** ([limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/)): `limits: { cpuMs, subRequests }`
  on the WorkerCode or on `getEntrypoint()`; past either, the isolate throws. Without them, the plan's limits apply.
- **Plan and price** ([pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)): Workers Paid only; 1,000
  unique Dynamic Workers a month included, then USD 0.002 per Worker per day, plus requests and CPU time at Workers
  Standard rates.
- **`@cloudflare/codemode`** ([API reference](https://developers.cloudflare.com/agents/api-reference/codemode/), npm
  0.5.6 on 29 Oct 2026): `createCodeTool()`, `DynamicWorkerExecutor` (Worker Loader, `globalOutbound` null by default,
  tools dispatched over Workers RPC), `codeMcpServer()`/`openApiMcpServer()`, `generateTypesFromJsonSchema()`. Its README
  says **"Experimental: may have breaking changes"**.

## How `/mcp/codemode` compares

It is Code Mode in the full sense (the model writes code against a typed API; the code runs in an isolate), built on the
same primitive as `@cloudflare/codemode`'s `DynamicWorkerExecutor`: a Worker Loader isolate with `globalOutbound: null`
and the tools reached over Workers RPC. It does not use the package: the package is experimental, pulls in a parser
(acorn) and the `ai`/MCP SDK integrations Purser does not need, and its executor sets no `limits`. Purser's host code is
about 490 lines in [`cloud/src/claude/codemode.ts`](../cloud/src/claude/codemode.ts) and
[`codemodeMcp.ts`](../cloud/src/claude/codemodeMcp.ts), with no new dependency, and adds
CPU and subrequest limits, a strict allow-list, per-run budgets, an answer check and a log line.

The Airwallex server below stays declarative on purpose: it reads a payment provider's live sandbox through kit11's
gateway, and a JSON plan is easier to check call by call than code.

## Purser in Code Mode (`/mcp/codemode`)

Two tools:

- `search` `{ query? }`: the TypeScript declarations of Purser's read API, all of it or the methods every word of the
  query matches. It reads no data. For example:

  ```ts
  declare class PurserError extends Error { readonly code: string }
  declare const purser: {
    /** One invoice. One supplier invoice by its id (like AP-0004): ... Read only. */
    get_invoice(args: {
      /** The invoice's id as Purser shows it, like AP-0004 (list_invoices shows them) */
      id: string;
    }): Promise<{
      invoice: { id: string; vendor: string; invoice_no: string; currency: string; total: string; due_date: string; status: string; [field: string]: unknown };
      [field: string]: unknown;
    }>;
    // ... one method per read tool of /mcp
  };
  ```

- `execute` `{ code }`: the body of an async function (or one `async () => { ... }`) that awaits `purser.<method>(args)`
  and returns plain JSON data:

  ```js
  const p = await purser.list_invoices({ status: "waiting_cfo", limit: 100 });
  return p.items.filter((i) => Number(i.total) > 1000).map((i) => ({ id: i.id, vendor: i.vendor, total: i.total }));
  ```

  The answer is `{ ok, result | error: { code, message }, logs, calls: [{ tool, outcome, ms }], duration_ms, sandbox }`.

The API is generated at request time from the same tool list `/mcp` serves (`codeModeTools()` in
[`cloud/src/claude/mcp.ts`](../cloud/src/claude/mcp.ts)): the 14 read tools, their `inputSchema` as the argument types and
their `outputSchema` as the answer types. A tool added to `/mcp` appears here without more code.

### Security design

What runs where:

```
AI client ──MCP──▶ Purser Cloud Worker (/mcp/codemode)               ┌── Dynamic Worker (one per run) ──────────┐
                   auth: connector token, rate limit                   │ main.js (ours) + task.js (the AI's code) │
                   hostCall(): allow-list, schema, budget  ◀──RPC──────│ purser.<tool>(args) → call(name, json)   │
                   tenant-scoped database (the token's company)        │ env: {}   globalOutbound: null           │
                   payments, approvals, policy: never reachable        │ limits: cpuMs 1000, subRequests 30       │
                                                                       └──────────────────────────────────────────┘
```

- **Isolation.** Each run gets a new isolate (`LOADER.load`, never `get`): nothing is cached or shared between runs,
  companies or tokens. Its `env` is empty, it has no compatibility flag (no `nodejs_compat`), and `globalOutbound: null`
  blocks `fetch()` and `connect()`. The prelude also removes `fetch`, `caches`, `WebSocket` and similar globals. The
  runtime refuses `eval` and `new Function` ("Code generation from strings disallowed").
- **One way out.** The isolate's only capability is the `call(name, argsJson)` function the host passes to its
  `evaluate()` over Workers RPC. The host checks every call itself, whatever the isolate sends (a compromised isolate
  that skips the `purser` object gets the same checks):
  - the name must be one of the allowed tools (a `Map`, so `constructor`, `__proto__` and the like are just unknown);
  - a name that asks to propose, approve, pay, sign, set a limit or write is refused as `not_available_in_code_mode`;
  - the arguments must be one JSON object of at most 10,000 characters that fits the tool's strict zod schema (an extra
    key such as `tenant` or `__proto__` is refused);
  - at most 25 calls, 300 KB per answer and 2 MB in all per run; a call that arrives after the run ended is refused.
- **Read only, by construction.** Only tools marked `readOnly` reach the allow-list (`allowedTools`); proposing is not
  offered even to a token made to propose. Payment execution, approval verification and policy enforcement stay in
  Purser's deterministic control plane and are not reachable from the isolate; the isolate never holds a payment
  credential, a key or the CFO's approval rules' secrets. Every payment still needs the CFO's passkey (Face ID).
- **One company.** The tools run with the database scoped to the token's own company. No argument names a company.
- **Limits.** Code: 20,000 characters. Wall time: 15 s (the host stops waiting and the isolate is disposed). CPU:
  1,000 ms and 30 subrequests (`limits`, enforced by Cloudflare). Memory: the isolate's own limit. Result: 24,000 bytes
  of JSON; logs: 40 lines of 300 characters, redacted.
- **The isolate's answer is untrusted.** The host checks each field: the result must be a JSON string within the limit,
  the error code must be a known one, logs are strings, capped and passed through the log redaction (`redact()`).
- **Observability.** Each run writes one log line (`codemode.run`, Workers Logs): company id, token id, sandbox kind,
  the SHA-256 of the code (16 hex characters) and its length, the number of calls, the tools called, how many were
  refused, the outcome, the duration and the result's size. Never the code, the arguments, the answers or a secret.
- **Access.** The same connector tokens as `/mcp` (or an OAuth access token for one), 20 requests a minute per token.
  Not the demo company's public token (each run starts a billed isolate), not a session or an API key.

Error codes: `invalid_code`, `sandbox_unavailable`, `sandbox_failed`, `timeout`, `code_threw`, `result_not_json`,
`output_too_large`, `too_many_calls`, `unknown_tool`, `not_available_in_code_mode`, `invalid_arguments`,
`answer_too_large`, `late_call`, `not_found`, `could_not_answer`, `tool_failed` (`CODEMODE_ERRORS`).

### What is tested, and what is not

- `test/cloud-codemode.test.ts` (plain run): the generated API (read tools only, valid TypeScript), search, the
  Worker Loader call (`globalOutbound: null`, empty `env`, no flags, the limits, a fresh isolate per run, disposed), the
  host's call function against a compromised isolate (off-list and state-changing names, prototype and company
  smuggling, budgets, late calls, a failing tool without its details), the answer check, timeouts, the log line, and
  the route (two tools, this company's books only, the demo token and sessions refused, no `LOADER`: `sandbox_unavailable`).
  The code there runs in plain JavaScript in the test process, which is not a sandbox; it only drives the host's checks.
- `test/cloud-codemode-workerd.test.ts` (`CODEMODE_WORKERD=on` or `npm run test:d1`): the same host code in **local
  workerd with a real Worker Loader** and two made-up companies. Adversarial code: `fetch()` and sockets, `eval` and
  `new Function`, reading `env`, `process.env` and `globalThis` for the loader's (made-up) secret, prototype pollution
  (gone in the next run), another company's invoice, an argument naming a company, a tool off the list and a
  state-changing one, too many calls, a huge answer and a huge result, console spam, a promise that never settles, a
  slow run past its wall time, a syntax error, and code that closes its own function. 11 tests passed on 21 Nov 2026.
- **Not tested locally:** a synchronous infinite loop and a memory bomb. Local workerd does not enforce the Worker
  Loader's `cpuMs` (a `while (true) {}` blocked the test's workerd until it was killed), so those rely on Cloudflare
  enforcing `limits.cpuMs` and the isolate's memory limit in production. That has not been run on Cloudflare yet.
- **Not run live.** No deployment has the `LOADER` binding yet, so `/mcp/codemode` on Cloudflare answers `search` and,
  for `execute`, `sandbox_unavailable`.

### Switching it on (the owner)

1. The account on the Workers Paid plan (Dynamic Workers are not on the free plan).
2. In `cloud/wrangler.try.jsonc` (and `cloud/wrangler.jsonc` for purser-cloud), add the key the file's last comment
   shows: `"worker_loaders": [{ "binding": "LOADER" }]`, then deploy.
3. Make a connector token (Connections, Connect your AI), add `https://<purser-cloud>/mcp/codemode` as a remote MCP
   server with `Authorization: Bearer <token>`, and run one `execute`; Workers Logs then shows its `codemode.run` line.
   Until that is done, the label stays "built, not tested live".

Claude Code: `claude mcp add --transport http purser-code https://<purser-cloud>/mcp/codemode --header "Authorization: Bearer <token>"`.

### Size of the tool list (approximation, characters / 4, 21 Nov 2026)

| tool list | tools | approx. tokens |
| --- | --- | --- |
| `/mcp`'s read tools, one per operation (name, title, description, input and output schema) | 14 | 4,382 |
| `/mcp/codemode` (search, execute) | 2 | 489 |
| the whole typed API, as `search` with no query returns it | | 3,080 |

The two-tool list sits in the context on every turn; the API is fetched when needed, and a narrow query returns less.
Characters / 4 is an approximation, not Anthropic's `count_tokens`.

## Airwallex in "Code Mode": a read-only MCP server (`/mcp/airwallex`)

Purser Cloud (the `purser-try` Worker) answers a second MCP server at `POST /mcp/airwallex`. It reads the Airwallex
**sandbox** (test money) and nothing else. Instead of one MCP tool per Airwallex endpoint it has two tools, the pattern
Cloudflare calls Code Mode ([blog](https://blog.cloudflare.com/code-mode-mcp),
[guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/)):

- `search`: looks through a small OpenAPI document of the allowed reads ([`openapi/airwallex-read.json`](../openapi/airwallex-read.json))
  and returns only the matching operations (method, path, parameters, response). It calls nothing.
- `execute`: runs a plan of up to 10 `GET` calls and returns only what the plan selects.

### The declarative variant, not sandboxed JavaScript

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

### Read only, enforced on the host

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

### What it cannot do

- Write anything: no transfer, conversion, beneficiary, card change or simulation.
- Read anything off the list (deposits, batch transfers, card numbers, cardholders, card transactions, other APIs).
- Run code: plans are data. A call cannot use the result of another call; to read one transfer after listing them, the
  client runs a second `execute`.
- Page through results by itself: a plan names `page_num` and `page_size` per call.
- Read a live (non-sandbox) Airwallex account.

### Token cost of the tool list (measured 20 Nov 2026)

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

### How to connect

Make a Claude connector token in Purser Cloud (Connections, Connect your AI: a signed-in owner), then add a remote MCP
server at `https://<purser-cloud>/mcp/airwallex` with `Authorization: Bearer <token>`, or sign in by OAuth as for
`/mcp`. The same tokens work at `/mcp` and `/mcp/airwallex`, nowhere else. The demo company's public token is refused
here (the sandbox is not the demo company's data). Each token may make 20 requests a minute.

Claude Code: `claude mcp add --transport http purser-airwallex https://<purser-cloud>/mcp/airwallex --header "Authorization: Bearer <token>"`.

Requirements on the deployment: the `AWX_GATEWAY` service binding (already in `cloud/wrangler.try.jsonc`), and kit11
deployed with the three new read rules in `src/airwallex/gatewayRules.ts` (`/financial_transactions`, `/issuing/cards`,
`/issuing/cards/{id}`); until then those three answer `gateway_refused`. The gateway's key (`AWX_ACT_*`, else the
Worker's sandbox key) must have the read scopes (Issuing for cards).
