# Outside agents and the ERP export

Moved from the project README. Back to the [README](../README.md).

## Outside agents: the agent API (MCP)

Any AI agent, ours or not, can work under the same CFO policy as our own three agents. `npm run -s mcp` serves the
agent API as an MCP server on stdio. Whoever sets it up names the outside agent it serves (`KIT11_AGENT`). For
example, for Claude Code (`.mcp.json`):

```json
{ "mcpServers": { "purser": { "command": "npm", "args": ["run", "-s", "mcp"],
  "env": { "KIT11_AGENT": "acme-research", "KIT11_DB": "data/rehearsal-3.sqlite" } } } }
```

It also needs the Airwallex sandbox keys in its environment, like the runner.

The outside agent gets four tools:

| Tool | What it does |
|---|---|
| `request_company_card` | Asks for a virtual company card with the limits it needs. This is a proposal; the CFO approves it with Face ID, and only then does the runner issue the card at Airwallex. |
| `pay_with_card` | Charges its card. Airwallex approves or declines the charge against the card's limits. |
| `request_limit_raise` | Asks for a higher limit. This is a policy change, approved with Face ID. |
| `company_card` | Reads its card, limits, spend this month and recent charges. |

The agent cannot approve, set a limit, or reach another agent's card. Once its card is issued:

- its limits are part of the CFO policy, and the phone may tighten them;
- the emergency stop freezes its card with the rest;
- the dashboard shows it under its own name;
- the GL export books its spend to cost centre CC400.

On stdio the server runs on the runner's machine, under the name the person who set it up gave it. Serving agents
on other machines (over HTTP, each with its own token) is the next step.

## GL coding and export for the ERP

`npm run gl -- csv|json [file]` writes the GL journal: one line for every movement of money. Each line has:

- a GL account and a cost centre (one per agent);
- the bank account the money moved through;
- the signed amount and currency;
- its proof: a transaction hash, a clearing receipt or an Airwallex id;
- the approval behind it (the proposal id);
- the rule that chose the account.

Lines come from data sales, data purchases, refunds, card charges, invoice payments and their fees, currency
conversions, sweeps and clearing withdrawals. Only money that moved is booked; a refused purchase or a declined card
charge is not.

The chart in `src/config/gl.ts` is an example: map the numbers to your own chart there. Text cells that a spreadsheet
would read as a formula (a merchant name from outside, say) get a leading apostrophe.

