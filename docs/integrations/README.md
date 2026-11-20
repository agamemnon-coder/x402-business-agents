# Connect Purser to anything

Every way into Purser and out of it, on one page: the payment rails, AI agents over MCP, the API and its webhooks,
no-code tools, accounting packages, Peppol, ISO 20022, chat and the full export. Each has its honest label, a quickstart
of a line or two and a link to its guide. Purser Cloud shows the same list (its Connections page), read from
`GET /v1/connections` (`cloud/src/connections.ts`), and `test/connections-hub.test.ts` holds this page to it.

**The rule behind all of them.** An agent or an integration may **read** and **propose**. Only the CFO's **passkey**
approves money: a signed-in person in Purser Cloud signs the exact terms, and one changed cent breaks the signature. No
key, agent, integration, webhook or chat message can approve. The approve route refuses every API key
(`POST /v1/engine/proposals/{id}/approve` needs a signed-in person's session). If the CFO set a pay-alone limit
(`ap.alone_eur`, off unless set), a proposal within it is paid under the CFO's own policy, and the answer says so in
`alone`. Test money only until a company goes live.

**The labels.** **live**: built, and running in Purser Cloud. **sandbox** or **testnet**: live calls to the service's
test environment, with test money. **format export**: Purser writes a file or message in the other product's documented
format, and a person or the team's own tooling takes it from there; there is no live connection to that product.
**built, not tested live**: the code (or the recipe) exists and is tested against stand-ins, not against the real
service. **built, run once in a sandbox**: as it says. **planned**: not built yet; the guide says what it needs. No
label here is stronger than its record.

**Setting it up.** Each company connects its own systems in Purser Cloud, Connections (each card shows what is
connected, not connected, or not available yet). What the platform registers once (OAuth apps, redirect URIs, secrets,
costs, reviews): [owner-setup.md](owner-setup.md). Invoices by e-mail from Gmail or Outlook:
[email-forwarding.md](email-forwarding.md). QuickBooks bills, planned: [quickbooks-plan.md](quickbooks-plan.md).

## Payment rails

Money moves only on these, and only within the limits the CFO signed or after the CFO's Face ID on the exact terms. T:0
is an outside ledger in the same group: it receives the books and moves no money. The services are named as the ones
Purser calls; no endorsement implied.

| Connection | Label | Quickstart | Guide |
|---|---|---|---|
| Airwallex | sandbox | Sandbox keys in the runner's environment (`AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`); `npm run health` checks them, and [run-it.md](../run-it.md) runs the whole story. | [airwallex.md](../airwallex.md) |
| Alta (formerly Metal) | testnet | An Alta testnet RPC from the Alta console in `METAL_RPC_URL`; `npm run health` checks it. A mandate per agent on chain, x402 payments. | [metal-award.md](../metal-award.md) |
| Visa via Airwallex Airi | sandbox | `npm run airi:vic-5 -- --dry` runs the flow on labelled stand-ins with no network; `preflight` and `live` need `KIT11_AIRI_RAIL=on`, the Airwallex sandbox keys and Airi. | [visa-award.md](../visa-award.md) |
| T:0 (outside ledger) | sandbox | `T0_API_KEY` in the environment, then `npm run t0 -- push --rate USD=0.92 --dry-run`, then without `--dry-run`. | [t0.md](../t0.md) |

## AI agents over MCP

One remote MCP server per Purser Cloud, at `/mcp`: 14 read tools, resources and prompts; with a token made to propose,
it can file a payment for the CFO. No tool approves or pays. Each client's exact config for your cloud's address is on
its `/connect-ai` page.

| Connection | Label | Quickstart | Guide |
|---|---|---|---|
| MCP server (Connect any AI) | live | Add `https://<your-purser-cloud>/mcp` to any client that speaks MCP over HTTP; sign in with a connector token (Connections, Connect your AI) or the demo company's `purser-demo-read-only`. | [connect-any-ai.md](../connect-any-ai.md) |
| Claude | live | claude.ai or the Claude apps: Settings, Connectors, *Add custom connector*, paste the `/mcp` address. Claude Code: `claude mcp add --transport http purser <address>/mcp`. | [connect-claude.md](../connect-claude.md#claude) |
| ChatGPT | built, not tested live | Apps, **+**, *Add custom MCP server*, URL `<address>/mcp`, authentication OAuth. | [connect-claude.md](../connect-claude.md#chatgpt) |
| Cursor | built, not tested live | The *Add to Cursor* link on `/connect-ai`, or `.cursor/mcp.json`. | [connect-claude.md](../connect-claude.md#cursor) |
| VS Code | built, not tested live | The *Add to VS Code* link on `/connect-ai`, or *MCP: Add Server*, *HTTP*. | [connect-claude.md](../connect-claude.md#vs-code-github-copilot-agent-mode) |
| Gemini CLI | built, not tested live | `gemini mcp add --transport http purser <address>/mcp` | [connect-claude.md](../connect-claude.md#gemini-cli) |
| Windsurf | built, not tested live | `serverUrl` and `headers` in its `mcp_config.json`. | [connect-claude.md](../connect-claude.md#windsurf-now-devin-desktop) |
| Airwallex sandbox, read only (Code Mode MCP) | built, not tested live | The same connector token at `https://<your-purser-cloud>/mcp/airwallex`: two tools, `search` and `execute`, GET reads of the Airwallex sandbox only. Tested against a stand-in gateway; no live read on record yet. | [codemode.md](../codemode.md) |
| Agent API on the runner (local MCP) | sandbox | `npm run -s mcp` on stdio, with `KIT11_AGENT` naming the outside agent; it asks for a company card, and each card and each raise waits for the CFO's Face ID. | [agent-api.md](../agent-api.md) |

## The API and webhooks

| Connection | Label | Quickstart | Guide |
|---|---|---|---|
| Read API (REST) and its OpenAPI | live | `curl -H "Authorization: Bearer $PURSER_API_KEY" https://<host>/v1/invoices`; the document at `/v1/openapi.json` (the read part at `/v1/openapi.read.json`). | [REST and OpenAPI](#rest-and-openapi), [connections.md](../connections.md#the-read-apis-openapi) |
| Webhooks | live | `POST /v1/webhook { "url": "https://…" }` as an owner; check `x-purser-signature` (HMAC-SHA256 of `t.body`) on every event. | [connections.md](../connections.md#webhooks) |
| TypeScript and Python SDKs | built, not tested live | `Purser.fromEnv()` (`PURSER_URL`, `PURSER_API_KEY`), then `proposePayment("AP-0004")`; no approve method. | [TypeScript](../../sdk/typescript/README.md), [Python](../../sdk/python/README.md) |
| A2A Agent Card | built, not tested live | `curl https://<host>/.well-known/agent.json`: skills that read or propose, for discovery. | [A2A Agent Card](#a2a-agent-card) |

## No-code tools

Through the API and the signed webhook, with the plain HTTP modules every tool has. Nothing here is a published Zapier
or Make app.

| Connection | Label | Quickstart | Guide |
|---|---|---|---|
| Zapier and Make (HTTP modules) | built, not tested live | GET `https://<host>/v1/engine/invoices`, then POST `/v1/engine/invoices/{id}/pay` with a read+propose key; trigger on Purser's webhook (*Catch Hook*, *Custom webhook*). Written from the OpenAPI document; not run in Zapier or Make. | [no-code.md](no-code.md) |
| n8n node | built, not tested live | `cd integrations/n8n && npm install && npm run build`, link the folder into n8n, credential: your cloud's URL and a read+propose key. Not yet built or published from here. | [n8n](../../integrations/n8n/README.md) |

## Accounting

| Connection | Label | Quickstart | Guide |
|---|---|---|---|
| Xero | format export | `GET /v1/export/csv/xero/bills` or `/journals` with a read key; import the file in Xero. | [connections.md](../connections.md#accounting-exports-format-exports) |
| Xero (API) | built, not tested live | With the owner's Xero OAuth app: `npx tsx src/cli/workplace.ts xero-tenants`, then `books xero --dry-run`. | [workplace.md](workplace.md) |
| QuickBooks Online | format export | `GET /v1/export/csv/quickbooks/bills`; QuickBooks maps the columns at import. No journals yet. | [connections.md](../connections.md#accounting-exports-format-exports) |
| Exact Online (CSV) | format export | `GET /v1/export/csv/exact/bills` or `/journals`: Exact's own import templates. | [connections.md](../connections.md#accounting-exports-format-exports) |
| Xero bills (connected in Purser Cloud) | built, not tested live | Each company: Connections, **Connect Xero**, pick its organisation; then **Send bills to Xero (drafts)**. Drafts only, never authorised or paid in Xero. | [owner-setup.md](owner-setup.md#16-xero) |
| QuickBooks Online (API) | built, not tested live | Each company: Connections, **Connect QuickBooks**. Connect flow only; sending bills is planned. | [quickbooks-plan.md](quickbooks-plan.md) |
| Exact Online (API) | built, not tested live | Each company: Connections, **Connect Exact Online**; its runner sets `ERP_EXACT_OAUTH=on`. `npm run erp -- sync --connector exact --dry-run` shows the requests and sends nothing. | [erp.md](../erp.md#exact-online), [owner-setup.md](owner-setup.md#18-exact-online) |
| Moneybird (API) | built, run once in a sandbox | `npm run erp -- sync --connector moneybird --dry-run`, then `--live` with the runner's Moneybird token. | [moneybird.md](../moneybird.md) |
| Business Central and Odoo (API) | built, not tested live | `npm run erp -- sync --connector bc --dry-run` (or `--connector odoo`). | [erp.md](../erp.md) |

## Peppol, ISO 20022, chat, workplace and the full export

| Connection | Label | Quickstart | Guide |
|---|---|---|---|
| Peppol invoices (UBL, BIS Billing 3.0) | built, not tested live | `npm run peppol:check -- <file.xml>` reads a file and names each rule broken; `npm run payables -- add <file.xml>` files it in the payables inbox, checked like a PDF. | [peppol.md](peppol.md) |
| Peppol network (an Access Point) | planned | Receiving over the network needs a certified Access Point, the owner's choice and registration; nothing is wired yet. | [peppol.md](peppol.md#receiving-over-peppol-the-owners-step) |
| ISO 20022 pacs.008 | format export | `npm run iso20022` writes a pacs.008.001.08 message for one paid invoice, validated against the official schema. | [connections.md](../connections.md#accounting-exports-format-exports) |
| Slack and Microsoft Teams messages | built, not tested live | Each company: Connections, **Slack and Teams**, paste its own Slack incoming webhook or Teams Workflow URL, **Send a test**. `approval.needed`, `payment.paid` and `books.closed` then post there; no real channel has received one yet. | [connections.md](../connections.md#slack-and-microsoft-teams) |
| Invoices by e-mail (forwarded from Gmail or Outlook) | built, not tested live | Forward supplier invoices to the company's Purser address (Settings, Company, Inbox); Gmail's confirmation code shows in Settings. No mail domain is routed yet. | [email-forwarding.md](email-forwarding.md) |
| Sign in with Google, Microsoft and Apple | built, not tested live | Each person: Settings, **Sign-in accounts**, **Link (Face ID)**; then "Sign in with …" on the sign-in page, read only. | [owner-setup.md](owner-setup.md#12-sign-in-with-google) |
| Approval alerts (e-mail, WhatsApp, Slack, Teams) | built, not tested live | Purser Cloud: Connections, Alerts. A single runner: `PURSER_SLACK_WEBHOOK_URL` or `PURSER_TEAMS_WEBHOOK_URL`, then `npm run notify:approvals`. | [cloud.md](../cloud.md#approval-alerts), [below](#slack-and-microsoft-teams-approval-notifications) |
| Google Workspace and Microsoft 365 | built, not tested live | With the owner's OAuth apps: `npx tsx src/cli/workplace.ts poll gmail` (or `drive`, `outlook`, `onedrive`) files invoices through the inbox. | [workplace.md](workplace.md) |
| Full export | live | `GET /v1/export` as an owner: every record as staged JSON parts with signed links. | [connections.md](../connections.md) |

## Build your own connector

Four things are enough for anything not listed above.

1. **A key with the scopes read and propose.** An owner makes it in Purser Cloud (Settings, API keys, "read and
   propose"); it is shown once. Send it as `Authorization: Bearer <key>`. Use `read` alone if the connector only reads;
   never give it `admin`.
2. **The OpenAPI document.** `https://<host>/v1/openapi.json` (everything) or `/v1/openapi.read.json` (the read API
   alone); in the repository, [`openapi/purser.yaml`](../../openapi/purser.yaml). Each operation names the scope it
   needs (`x-purser-needs`). Proposing is `POST /v1/engine/invoices/{id}/pay`; no scope approves.
3. **The webhook signature.** Every event carries `x-purser-signature: t=<unix seconds>,v1=<hex>`. Compute
   HMAC-SHA256 under your webhook's secret over `` `${t}.${raw body}` ``, compare it with `v1` in constant time, and
   refuse a `t` older than a few minutes. Then read the invoice or proposal again with your key before acting: an
   event is a nudge, never the truth.
4. **The MCP endpoint.** `https://<host>/mcp` for an AI client, with a connector token (Connections, Connect your AI) or
   OAuth 2.1. A connector token works at `/mcp` only.

## Keys and scopes

**Keys.** An owner makes a key in Purser Cloud (Settings, API keys, "read and propose"), or with
`POST /v1/keys { "name": "…", "scopes": ["read", "propose"] }` from their signed-in session. The key is shown once,
expires (90 days by default) and can be revoked. Keep it in the environment (`PURSER_API_KEY`), never in code. Scopes:

| Scope | What it may do |
|---|---|
| `read` | Read invoices, documents, suppliers, payments, the transactions register, the ledger and its reports. |
| `propose` | File an invoice's payment for the CFO's approval (`POST /v1/engine/invoices/{id}/pay`). Nothing more. |
| `admin` | Manage the company (keys, people, settings). It covers `propose`. An integration should not hold it. |
| `sync` | The company's own runner pushing its records. Not for integrations. |
| `approve` | Never a key's. A signed-in CFO's (or, in a company with no CFO, an owner's): approve or reject with their own passkey. `admin` does not cover it. Roles: [security/roles.md](../security/roles.md). |

Status of the sections below: the SDKs, the A2A card, the n8n node, the no-code recipes and the approval notifications are
built and tested locally (see "Tests" at the end). None of them has been used live by an outside agent or a no-code tool
yet.

## MCP (Claude and other AI clients)

```
URL:    https://<your-purser-cloud>/mcp
Auth:   Authorization: Bearer <connector token>   (Connections, Connect your AI; "may propose" to file payments)
Try it: the demo company's public read-only token, purser-demo-read-only
```

Safety boundary: the read tools always; `propose_invoice_payment` and `payment_proposal` only with a token made to
propose. No tool approves or pays. A connector token works at `/mcp` only. Details:
[mcp.md](../mcp.md), [connect-claude.md](../connect-claude.md) and [connect-any-ai.md](../connect-any-ai.md).

## REST and OpenAPI

```
curl -H "Authorization: Bearer $PURSER_API_KEY" https://<host>/v1/invoices
curl -X POST -H "Authorization: Bearer $PURSER_API_KEY" https://<host>/v1/engine/invoices/AP-0004/pay
curl -H "Authorization: Bearer $PURSER_API_KEY" https://<host>/v1/engine/proposals/P-0009
```

The API as OpenAPI 3.1: [`openapi/purser.yaml`](../../openapi/purser.yaml), and served at `/openapi.json` (also
`/v1/openapi.json`; the read-only part at `/v1/openapi.read.json`). The reference page is `/api`: the same document as
one HTML page, with no script and no third-party asset. `npm run openapi` writes the YAML from the route table
(`cloud/src/app.ts`) and the zod schemas its routes parse bodies with, and `test/openapi-spec.test.ts` fails when a
route is in the code but not in the document, or the other way round, or when the file is out of date.

Safety boundary: each operation names the scope it needs (`x-purser-needs`). Proposing needs `propose`. Approving needs
`approve`, which no key can hold: a signed-in CFO's own passkey over the exact terms.

## TypeScript SDK

```ts
import { Purser } from "./sdk/typescript/src/index.js";   // no dependencies; the platform's fetch
const purser = Purser.fromEnv();                          // PURSER_URL, PURSER_API_KEY
const { proposal } = await purser.proposePayment("AP-0004"); console.log(proposal.status); // PENDING_APPROVAL
```

See [sdk/typescript/README.md](../../sdk/typescript/README.md). Safety boundary: the client has no approve method. Its
operations are checked against the OpenAPI document by `test/sdk-typescript.test.ts`.

## Python SDK

```python
from purser import Purser                       # sdk/python, standard library only (urllib)
purser = Purser.from_env()                      # PURSER_URL, PURSER_API_KEY
print(purser.propose_payment("AP-0004")["proposal"]["status"])   # PENDING_APPROVAL
```

See [sdk/python/README.md](../../sdk/python/README.md). Safety boundary: the same as the TypeScript client, with no
approve method. Checked against the document by `test/sdk-python.test.ts`.

## A2A Agent Card

```
curl https://<host>/.well-known/agent.json        # also /.well-known/agent-card.json
skills: read-books, pending-approvals, propose-payment, proposal-status
auth:   securitySchemes.bearer (an API key, or a connector token at /mcp)
```

An Agent Card in Google's Agent2Agent (A2A) protocol format (0.3 fields): Purser's name, description, skills, auth
scheme and URL. Purser does not run A2A task messaging (`message/send`). The card is for discovery, and points an
agent to the MCP server (`url`) and the REST API (`capabilities.extensions[0].params`). Purser Cloud's Worker serves
it. The site's own Worker (`worker/src`) does not: it passes only the hands-on demo's paths to Purser Cloud, and a card
there would name an MCP address the site does not serve.

Safety boundary: each skill reads or proposes (`x-purser.effect`). The card says `approves_payments: false`, and
`test/a2a-agent-card.test.ts` checks the required fields and that no skill approves.

## n8n

```
cd integrations/n8n && npm install && npm run build     # the owner's step; not done in this repository
n8n: Settings, Community Nodes, install n8n-nodes-purser (once published), or link the built folder
Credential "Purser API": your Purser Cloud URL and a read+propose key
```

Operations: Invoice (Get Many, Get, Get Payable) and Proposal (Propose Payment, Get Status). See
[integrations/n8n/README.md](../../integrations/n8n/README.md). Building and publishing the package to npm is the
owner's step. It has not been built or published from here.

Safety boundary: there is no approve operation. The key is stored in n8n's credential store as a password and sent as
a bearer header. `test/n8n-node.test.ts` checks every request against the OpenAPI document.

## Zapier, Make and other no-code tools

```
HTTP module: GET  https://<host>/v1/engine/invoices          header Authorization: Bearer <read+propose key>
HTTP module: POST https://<host>/v1/engine/invoices/{{id}}/pay
Trigger:     Purser's signed webhook (POST /v1/webhook), or a schedule that polls the list
```

Step-by-step setups: [no-code.md](no-code.md). Safety boundary: the same key scopes. A scenario can file a proposal and
read its status, and the CFO still signs in Purser Cloud.

## Slack and Microsoft Teams approval notifications

```
export PURSER_SLACK_WEBHOOK_URL=…   # and/or PURSER_TEAMS_WEBHOOK_URL; from the environment only
export PURSER_URL=https://<host> PURSER_API_KEY=<read key>
npm run notify:approvals            # once per waiting proposal; run it from cron
```

The message reads "Payment P-0009 needs your signature: EUR 1,309.00, payee Bergtex Textil GmbH". It carries one
link, to the invoice's page in Purser Cloud, where the CFO signs in with their passkey and signs
(`src/integrations/approvalChat.ts`, `scripts/approval-chat.ts`).

Purser Cloud also sends the same kind of alert per company (Connections, Alerts: Slack, Teams, e-mail, WhatsApp), and posts
every business event to a company's own Slack or Teams channel (Connections, Slack and Teams; built, not tested live). There an
owner adds each target, and the API never shows a target back. Use that one on a multi-company cloud. The environment-configured notifier is for a
single company's runner or deployment.

Safety boundary: a notification only tells. It has no button that acts, no reply word, no code and no token. Its only
link opens the passkey page (Slack: a plain link; Teams: `Action.OpenUrl` only). `test/approval-chat.test.ts` checks the
words, that no secret is in the payload (no webhook URL, key, terms hash or challenge), and that there is no approve
action. The webhook URL never appears in a log line, a result or an error.

To set up Slack: create a Slack app with an incoming webhook for the channel (api.slack.com, Incoming Webhooks), and put
its URL in `PURSER_SLACK_WEBHOOK_URL`. To set up Teams: in the channel, add the "Post to a channel when a webhook
request is received" workflow, and put its URL in `PURSER_TEAMS_WEBHOOK_URL`.

## Webhooks out

```
POST /v1/webhook { "url": "https://your.host/purser" }   # an owner; the signing secret is returned once
Each event: x-purser-signature: t=<seconds>,v1=<HMAC-SHA256 hex of "t.body">
Events: approval.needed, payment.paid, books.closed, and the runner's alerts
```

Purser posts its business events to one HTTPS URL per company, signed with HMAC-SHA256 (`cloud/src/monitor.ts`). Check
the signature and the time before you act on an event. See [connections.md](../connections.md) and
[cloud.md](../cloud.md).

Safety boundary: events go out only, and an event carries no secret and no way to approve. `approval.needed` names the
approval page, and the CFO signs there.

## Tests

Built and tested locally, with no network. Each test runs in `npx vitest run`:

| What | Test |
|---|---|
| OpenAPI document and route table agree, both ways; the file is up to date; the reference page has no script | `test/openapi-spec.test.ts` |
| TypeScript client against Purser Cloud in-process (list, propose, status; a read key cannot propose; a propose key cannot approve) | `test/sdk-typescript.test.ts` |
| Python client: its own tests on a local mock, and the quickstart against Purser Cloud on 127.0.0.1 | `test/sdk-python.test.ts`, `sdk/python/tests/test_client.py` |
| A2A Agent Card: required fields, skills read or propose, no secret | `test/a2a-agent-card.test.ts` |
| n8n node: operations, requests in the OpenAPI document, credential | `test/n8n-node.test.ts` |
| Slack and Teams notifications: words, no secrets, no approve action | `test/approval-chat.test.ts` |
