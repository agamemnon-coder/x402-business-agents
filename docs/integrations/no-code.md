# Purser in Zapier, Make and other no-code tools

A recipe for no-code tools: they read Purser, propose a payment for the CFO's approval, follow the proposal's status,
and hear Purser's events. They can never approve. The CFO signs the exact terms with their passkey in Purser Cloud, and
the API refuses every key at the approve route. Test money only until a company goes live.

These setups use the plain HTTP modules every tool has. They are written from the API's OpenAPI document
([`openapi/purser.yaml`](../../openapi/purser.yaml)) and have not been run in Zapier or Make from here. The requests
themselves are tested against Purser Cloud in-process (`test/sdk-typescript.test.ts`). For n8n there is a node:
[integrations/n8n](../../integrations/n8n/README.md).

## What you need

- **Your Purser Cloud's address**, for example `https://purser.example.com` (below: `https://<host>`).
- **A key with the scopes read and propose.** An owner makes it in Purser Cloud (Settings, API keys, "read and
  propose"). It is shown once. Store it in the tool's secret or connection store, never in a step's visible text. Use
  a `read`-only key for a scenario that only reads. Never give a no-code tool an `admin` key.
- Every request sends the header `Authorization: Bearer <key>`. Answers are JSON. An error is
  `{ "error": "<a sentence>", "code": "<stable code>" }`, with 403 for a scope the key lacks and 409 when Purser will
  not file a payment (held, waiting or paid; the sentence says why).

## The requests

| Step | Method and URL | Answer |
|---|---|---|
| List supplier invoices | `GET https://<host>/v1/invoices?status=ready&limit=50` | `{ items: [...], next_cursor }`. Send `cursor=<next_cursor>` for the next page. |
| One invoice | `GET https://<host>/v1/invoices/AP-0004` | the invoice, with its earlier versions |
| What can be proposed | `GET https://<host>/v1/engine/invoices` | `{ items: [{ id, vendor, total, currency, payable, proposal }] }` |
| Propose a payment | `POST https://<host>/v1/engine/invoices/AP-0004/pay` (no body) | `{ proposal: { id, status: "PENDING_APPROVAL", terms_sha256, facts } }` |
| A proposal's status | `GET https://<host>/v1/engine/proposals/P-0009` | `{ proposal: { status } }`: PENDING_APPROVAL, then APPROVED and EXECUTED, or REJECTED or EXPIRED |

## Zapier

**Propose payments for invoices that are ready** (a Zap on a schedule):

1. Trigger: **Schedule by Zapier**, every day at 9:00.
2. Action: **Webhooks by Zapier, GET**. URL `https://<host>/v1/engine/invoices`. Headers:
   `Authorization` = `Bearer <key>` (from a Zapier "Storage" or connection field, not typed into the step).
3. Action: **Looping by Zapier**, over `items`. Then **Filter by Zapier**: only continue if `payable` is true and
   `proposal` does not exist.
4. Action: **Webhooks by Zapier, Custom Request**. Method `POST`, URL
   `https://<host>/v1/engine/invoices/{{id}}/pay`, the same header, no data.
5. Optional: post `{{proposal__id}}` and "waits for the CFO's passkey in Purser Cloud" to a channel. Do not put an
   "approve" button or reply option in that message: there is nothing a chat could approve with.

**Follow a proposal** (a Zap per proposal, or a schedule):

1. Action: **Webhooks by Zapier, GET**. URL `https://<host>/v1/engine/proposals/{{proposal_id}}`, the same header.
2. **Paths by Zapier** on `proposal__status`: `EXECUTED` (paid), `REJECTED` or `EXPIRED` (not paid), or still
   `PENDING_APPROVAL`.

## Make

**Propose payments for invoices that are ready** (a scenario on a schedule):

1. **HTTP, Make a request**. URL `https://<host>/v1/engine/invoices`, method GET, header
   `Authorization: Bearer <key>` (keep the key in a Make **Keychain** or a scenario variable marked secret). Parse
   response: yes.
2. **Iterator** over `data.items`, then a **filter**: `payable` equals true and `proposal` does not exist.
3. **HTTP, Make a request**. URL `https://<host>/v1/engine/invoices/{{id}}/pay`, method POST, the same header,
   no body. A 409 is Purser saying why not: set the module's error handler to **Ignore**, or route it to a note.
4. **HTTP, Make a request**: `GET https://<host>/v1/engine/proposals/{{proposal.id}}` whenever you need the status.

## Hearing Purser's events (webhook in)

Purser Cloud posts its business events to one HTTPS address per company: `approval.needed`, `payment.paid`,
`books.closed` and the runner's alerts. An owner sets the address with `POST /v1/webhook { "url": "…" }`
from their signed-in session, and the signing secret is shown once.

- **Zapier**: trigger **Webhooks by Zapier, Catch Hook**. Give Purser the hook's URL.
- **Make**: trigger **Webhooks, Custom webhook**. Give Purser the webhook's URL.

Each event carries `x-purser-signature: t=<seconds>,v1=<hex>`, where `v1` is HMAC-SHA256, under the secret, of
`<t>.<the raw body>`. Where the tool can run code (a Zapier Code step, a Make custom function), check the signature and
that `t` is recent. Either way, treat an event as a nudge, never as the truth: read the proposal or invoice again with
your key (the requests above) before acting on it. An event can approve nothing, and it carries no secret.

## Safety boundary

- A no-code tool reads (`read`) and files payments for the CFO (`propose`). It cannot approve, change a limit, make a
  key or add a person: those routes refuse a read+propose key.
- If the CFO set a pay-alone limit (`ap.alone_eur`, off unless set), a proposal within it is paid under the CFO's own
  policy, and the answer says so in `alone`. Above it, only the CFO's passkey pays.
- Revoke the key in Purser Cloud (Settings, API keys) to cut a scenario off at once.

See also: [all the ways to connect](README.md).
