# n8n-nodes-purser

An n8n community node for Purser. It reads supplier invoices, proposes an invoice's payment for the CFO's approval and
reads a proposal's status. **It cannot approve.** Approving is the CFO's passkey over the exact terms, in Purser Cloud,
and the API refuses every key there. Test money only until a company goes live.

Status: written and tested locally (`test/n8n-node.test.ts` checks the operations, each request against
`openapi/purser.yaml`, and the credential). **It has not been built, installed in n8n or published.** Building and
publishing is the owner's step (below).

## Operations

| Resource | Operation | Request |
|---|---|---|
| Invoice | Get Many | `GET /v1/invoices` (status, limit) |
| Invoice | Get | `GET /v1/invoices/{id}` |
| Invoice | Get Payable | `GET /v1/engine/invoices` |
| Proposal | Propose Payment | `POST /v1/engine/invoices/{id}/pay` |
| Proposal | Get Status | `GET /v1/engine/proposals/{id}` |

## Credential

**Purser API**: your Purser Cloud URL and an API key. An owner makes the key in Purser Cloud (Settings, API keys,
"read and propose"; "read" for a workflow that only reads). n8n keeps it in its credential store as a password and
sends it as `Authorization: Bearer`. The credential's test calls `GET /v1/me`. Never use an `admin` key here.

## Build, try and publish (the owner's step)

```sh
cd integrations/n8n
npm install            # n8n-workflow and typescript, for the build only
npm run build          # writes dist/
npm link               # then, in ~/.n8n/custom: npm link n8n-nodes-purser, and restart n8n
```

To publish it as a community node: set `"private": false` in `package.json`, check the name `n8n-nodes-purser` is free
on npm, run `npm publish` from this folder with your npm account, and optionally submit it for n8n's verification. Then
anyone can install it in n8n (Settings, Community Nodes, Install, `n8n-nodes-purser`).

See also: [all the ways to connect](../../docs/integrations/README.md).
