# Purser alongside Airwallex AgentOS

Airwallex AgentOS lets an agent in Claude, Cursor or Codex read an Airwallex account and prepare work in it. It leaves
transfers, payouts and FX conversions to people. Purser handles exactly that step: the agent proposes, Purser checks
the proposal against the CFO's policy, the CFO approves the exact terms with a passkey (Face ID), and Purser pays and
returns the proof. This page explains how the two run side by side in one client.

**What this is not.** This is not an official integration, and there is no partnership with Airwallex. Purser has not
been run against AgentOS live. AgentOS's MCP server is production only, and Purser's hosted cloud uses test money on the
Airwallex sandbox. Everything here comes from Airwallex's public docs and its open-source plugin, read on 26 November
2026, and from Purser's own code and tests.

## What AgentOS is

These facts come from Airwallex's AgentOS guide (<https://www.airwallex.com/docs/developer-tools/ai/agentos.md>, linked
from <https://www.airwallex.com/agentos>) and from the plugin repository
<https://github.com/airwallex/airwallex-marketplace> (Apache-2.0; read at commit `6d27198d9587`, 24 Nov 2026; plugin
`airwallex-agentos` 0.2.8).

- **Two connectors.**
  - **The Airwallex CLI** (`airwallex`, also `npm install -g @airwallex/cli`) works against sandbox and production. It
    defaults to sandbox, and `--prod` switches to production. A write needs `--confirm`, and `--dry-run` shows the
    request first ([CLI docs](https://www.airwallex.com/docs/developer-tools/cli.md)).
  - **The Airwallex AgentOS MCP server** runs at `https://mcp.airwallex.com/mcp`. It is remote (HTTP), **production
    only**, and reads and writes production resources. It also searches Airwallex's docs.
- **Skills (beta).**
  - `contract-to-billing`: invoices and subscriptions from POs and contracts.
  - `beneficiary-creation`: beneficiaries from supplier documents.
  - `card-provisioning`: cardholders, and cards with spend limits.
  - `manage-cashflow`: balances, receivables, obligations, FX exposure and indicative rates.
  - `awx-best-practices`: a fallback guardrail.
- **Plugins.** The connectors and skills install in one step:
  - Claude Code: `claude plugin install airwallex-agentos@claude-plugins-official`
  - Claude Cowork and claude.ai: the `airwallex-agentos` connector
  - Cursor: its plugin marketplace
  - Codex: `codex plugin marketplace add https://github.com/airwallex/airwallex-marketplace`
- **Sign-in.** Both connectors use OAuth against the Airwallex account, and the scopes are chosen at authorisation
  ([OAuth scopes](https://www.airwallex.com/docs/developer-tools/partner-connections/oauth-scopes.md); for example
  `transfer:write` and `fx.conversion:write`). Only an Owner, Admin or Finance Admin can authorise
  ([Build with AI](https://www.airwallex.com/docs/developer-tools/ai/build-with-ai.md)).
- **Sandbox.** The CLI has sandbox mode, but the AgentOS MCP server does not. For sandbox work Airwallex points to the
  separate Developer MCP at `https://mcp.sandbox.airwallex.com/developer` and the Docs MCP. Neither runs AgentOS skills
  ([Developer connectors](https://www.airwallex.com/docs/developer-tools/ai/developer-connector.md)).
- **Tool names.** The guide lists no AgentOS MCP tools. The plugin tells agents to read them from the client's tool list
  and "not assume names" (`skills/awx-best-practices/references/surface-quickstart.md`).

### How AgentOS handles transfers and FX

The guide's Safety section says: "AgentOS components do **not** initiate money-out actions (transfers, FX
conversions, or payouts) on your behalf. Where the underlying API supports them, the components are explicitly
instructed not to execute them." Write tools carry annotations so the client asks before running them, and Airwallex
advises keeping auto-approve modes off.

The skills go further:

- `manage-cashflow` has a hard gate. On any request to convert, wire, transfer or pay, the agent must refuse in its
  first sentence ("I can't execute … that needs to be done in the Airwallex Dashboard"), and must call no tool first.
- `awx-best-practices` lists FX conversion as "Airwallex Dashboard only".

Airwallex's blog describes this as keeping high-risk actions like transfers and FX "subject to human approval". In
practice, a person makes the transfer or conversion in Airwallex's own app.

## Who does what

| | AgentOS (Airwallex's connectors and skills) | Purser (its MCP server at `/mcp`) |
|---|---|---|
| Read balances, cash flow, FX exposure, indicative rates | yes (`manage-cashflow`) | its own books: `cash_position`, `company_overview`, `list_transactions` |
| Draft invoices, create beneficiaries, provision cards | yes (write tools, confirmed in the client) | no |
| A supplier payment (transfer or payout) | no, by design: a person makes it in Airwallex's app | **yes, governed**: `route_money_out`, then `propose_invoice_payment`; the CFO's Face ID over the exact terms; Purser pays and books |
| FX | indicative rates only; conversions in Airwallex's app | only inside a supplier payment: a quote for the shortfall, within the FX markup limit, part of the terms the CFO signs. No conversion on its own |
| Approving anything | no | no MCP tool approves, for any token. Only the CFO's passkey does |

Purser governs money out with checks in its own code. A payment is planned under the CFO's policy:

- the payee and account on file;
- the reserve floors;
- a quote only for the currency it is short of, within the markup limit;
- no second payment of one invoice.

(An agent's own purchases go on its own company card, within limits Airwallex enforces.)

Each payment is then approved by a WebAuthn signature over its exact terms (payee, account, amount, currency). Only a
limit to pay alone that the CFO signed into the policy lets code approve instead. After payment, `explain_payment` and
`payment_audit_trail` show who approved it and the proof. See [mcp.md](mcp.md#the-safety-model) and
[cfo-policy.md](cfo-policy.md).

## The tool built for this: `route_money_out`

An agent coming from AgentOS knows a payee, an amount and a currency. Purser pays only against an invoice it has read
and checked. `route_money_out` connects the two. It is a read-only tool that every token has. It takes any of `kind`
(`transfer`, `payout` or `fx_conversion`), `invoice_id`, `payee`, `amount` and `currency`, and answers with:

- **The route**:
  - `propose`: an invoice is ready, so call `propose_invoice_payment`;
  - `waiting_cfo`: already filed, so do not file it again;
  - `new_supplier`: the CFO approves the supplier first;
  - `held`: a person looks at it first;
  - `paid`: it is paid already, so do not pay it again;
  - `choose`: several invoices fit, so ask the user which;
  - `needs_invoice`: there is no invoice, so nothing can be filed;
  - `not_in_purser`: a conversion on its own, which a person makes in Airwallex's app.
- **The invoices that fit**, with each one's next tool.
- **How Purser would approve and pay it**, in one sentence.

It never files, approves or moves anything. The code is in [`cloud/src/claude/mcp.ts`](../cloud/src/claude/mcp.ts).

Two more changes make the hand-off reliable:

- The server's instructions tell a connected AI to call `route_money_out` first when asked to transfer, pay or convert,
  "also after another Airwallex tool said it does not move money".
- A guessed tool name that moves money or currency is refused with `data.next_tool: "route_money_out"`. A write name is
  refused with `not_available_over_mcp` (`create_transfer`, `convert_currency`, `execute_fx`), and any other name with
  `unknown_tool` (`propose_transfer`, `propose_fx`).

Purser does not copy AgentOS's tool names. Airwallex does not publish them and says they change between releases, so
`route_money_out` takes plain fields instead.

## Running both in one client

AgentOS's own guidance applies: "Only install MCP servers you trust alongside AgentOS MCP in the same client." Purser's
server has no tool that approves, pays, writes or reaches outside Purser. Every tool is annotated `destructiveHint:
false` and `openWorldHint: false`, and a token made only to read cannot even propose. Give Purser a reading token unless
the agent should file payments. Keep manual approval of tool calls on in the client, as Airwallex advises.

**Claude Code** (the AgentOS commands are Airwallex's; the Purser command is from [mcp.md](mcp.md#claude-code)):

```
claude plugin install airwallex-agentos@claude-plugins-official
claude mcp add --transport http purser https://<your Purser Cloud>/mcp --header "Authorization: Bearer ${PURSER_CONNECTOR_TOKEN}"
```

Or both servers in a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "airwallex": { "type": "http", "url": "https://mcp.airwallex.com/mcp" },
    "purser": { "type": "http", "url": "https://<your Purser Cloud>/mcp", "headers": { "Authorization": "Bearer ${PURSER_CONNECTOR_TOKEN}" } }
  }
}
```

**Cursor**: the same two entries in Cursor's MCP settings (Airwallex's entry is its own documented one; Purser's is in
[connect-claude.md](connect-claude.md)). **Claude.ai and Claude Cowork**: the `airwallex-agentos` connector, plus Purser
as a custom connector (Settings, Connectors). **Codex**: AgentOS through its plugin; Purser as a remote MCP server in
Codex's MCP settings. None of these side-by-side setups has been tried.

To try the flow with no real money, use Purser's demo token, `purser-demo-read-only`, which reads made-up data. AgentOS
itself always reads a production account.

## A worked flow

1. "Using Airwallex, are we short of EUR for what we owe this week?" AgentOS's `manage-cashflow` reads balances and
   obligations and shows indicative rates.
2. "Pay Bergtex's invoice." With `manage-cashflow` loaded, AgentOS refuses first, as its hard gate requires. The two sets
   of instructions do not override each other, so **name Purser** in the next request:
3. "Using Purser, route the EUR 2,380.00 payment to Bergtex GmbH." The agent calls `route_money_out`, which finds
   `AP-…` with route `propose`. With a token made to propose, the agent calls `propose_invoice_payment` and tells the
   user that nothing is paid until the CFO approves.
4. The CFO opens the proposal in Purser Cloud, reads the exact terms and approves them with Face ID, or lets them
   expire. Purser plans the payment (buying only the EUR it is short of, inside those terms), pays it on the rail,
   books it, and keeps the audit trail. "Using Purser, explain the payment to Bergtex" then shows the proof.
5. "Convert USD 10,000 to EUR." `route_money_out` answers `not_in_purser`: Purser buys currency only inside a supplier
   payment it files. A conversion on its own stays with a person in Airwallex's app, as AgentOS says.

## Airwallex's own approval as a second lock

Airwallex has its own approval workflow for API-created transfers
(<https://www.airwallex.com/docs/payouts/transfers/manage-transfers/manage-approvals-for-transfers>). With "Require
API-initiated transfers to go through the same approval workflow?" set to Yes:

- a transfer Purser creates waits `IN_APPROVAL`;
- it becomes `SCHEDULED` once a person approves it in the web app;
- otherwise it becomes `APPROVAL_REJECTED`, `APPROVAL_RECALLED` or `APPROVAL_BLOCKED` (`payout.transfer.*` webhooks).

Purser already handles this. It records "waiting for Airwallex approval", follows the transfer by reading it back, and
never approves or resends it ([airwallex-approvals.md](airwallex-approvals.md), with a sandbox run). The CFO's Face ID
over the exact terms in Purser and a person's approval at Airwallex are then two independent locks.

## What is checked, and what needs live access or Airwallex

Checked in this repository's tests, on a cloud database in the test process (no Airwallex call):

- [`test/mcp-route-money-out.test.ts`](../test/mcp-route-money-out.test.ts): every route, matching by payee and amount,
  each kind of token, the demo company, the output schema, refused arguments, the pointers on guessed money tool names,
  and that the tool never touches the engine.
- [`test/mcp-contract.test.ts`](../test/mcp-contract.test.ts): the tool's description, schema, examples and annotations,
  like every other tool's.

Needs live access, or Airwallex's help:

- **A run with AgentOS itself.** The AgentOS MCP server is production only, and Purser's cloud runs on the sandbox. A
  side-by-side run needs a production Airwallex account and its OAuth consent, or a sandbox AgentOS endpoint, which
  Airwallex does not offer today.
- **AgentOS's tool list.** It is not published. A recorded `tools/list` from a connected client would show whether any
  AgentOS tool overlaps Purser's.
- **A sanctioned hand-off.** `manage-cashflow`'s hard gate sends every money-movement request to the Airwallex
  Dashboard. An AgentOS setting that sends it to a governed lane the customer configured (such as Purser) instead would
  remove step 2's detour. That is Airwallex's to decide.
