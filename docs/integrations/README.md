# Connect to Purser

Every way another AI agent or program can connect to Purser, on one page. Each has a three-line quickstart and its
safety boundary.

**The rule behind all of them.** An agent or an integration may **read** and **propose**. Only the CFO's **passkey**
approves money: a signed-in person in Purser Cloud signs the exact terms, and one changed cent breaks the signature. No
key, agent, integration, webhook or chat message can approve. The approve route refuses every API key
(`POST /v1/engine/proposals/{id}/approve` needs a signed-in person's session). If the CFO set a pay-alone limit
(`ap.alone_eur`, off unless set), a proposal within it is paid under the CFO's own policy, and the answer says so in
`alone`. Test money only until a company goes live.

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

Status: everything on this page is built and tested locally (see "Tests" at the end). None of it has been used live by
an outside agent or a no-code tool yet.

## MCP (Claude and other AI clients)

```
URL:    https://<your-purser-cloud>/mcp
Auth:   Authorization: Bearer <connector token>   (Settings, Connect Claude; "may propose" to file payments)
Try it: the demo company's public read-only token, purser-demo-read-only
```

Safety boundary: the read tools always; `propose_invoice_payment` and `payment_proposal` only with a token made to
propose. No tool approves or pays. A connector token works at `/mcp` only. Details:
[docs/mcp.md](https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/mcp.md), [connect-claude.md](../connect-claude.md) and [connect-any-ai.md](../connect-any-ai.md).

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

Purser Cloud also sends the same kind of alert per company (Settings, Alerts: Slack, Teams, e-mail, WhatsApp). There an
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
