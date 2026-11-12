# The engine's events, for the page (lane B)

Written by lane A (engine) on 12 November 2026. The source of truth is `src/engine/events.ts` (the allowlist) and its tests
`test/engine-events.test.ts`; if this note and the code differ, the code wins and this note is fixed.

## How to read them

`GET /v1/engine/events?after=<seq>&limit=<1 to 200>` (need: read) answers `{ items: EngineEvent[], next }`. Ask again
with `after=next`. An item is:

```ts
interface EngineEvent { seq: number; ts: string; actor: string; event: string; subject: string | null; fields: Record<string, string | number | boolean | null> }
```

- `actor` is who wrote the row: an agent (`checker`, `payer`), the reader, code, or the approver.
- `subject` is what the row is about, for example `ap.check.AP-0001`. An event that is not on the list comes with
  `subject: null` and `fields: {}`: show it as a neutral line ("the engine did something"), never as raw JSON.
- A field that the row did not write is absent. Never assume a field is there.
- **Polling:** at most 2 reads a second per company, counted in the company's own object. Past that the route answers
  `429 { error, code: "slow_down", retry_ms }`: wait `retry_ms` and ask again. Poll every 1,000 ms while a request is
  in flight. Reads do not wait for the engine's action queue, so the rows of an upload that is still waiting on Claude
  arrive while it waits. The test that holds this comes with task A6.
- Every text field is masked: an IBAN or a run of 8 or more digits shows only its last four (`****3000`); anything that
  looks like a key or a bearer token is removed.

## The agents' events

| Event | Fields | Written by, and when | Exists |
|---|---|---|---|
| `claude.asking` | `agent?`, `role?`, `model`, `turn?` | Just before a Claude call is sent. The reader writes `role` (`classify`, `read` or `review`); an agent's loop writes `agent` and `turn`. It says a call was sent to that model, and nothing about the answer. | A5 (reader), A6 (agents) |
| `claude.capped` | `reason` | Claude was not asked, and code reads and decides instead. `reason` is one of `switch_off`, `no_key`, `action_budget`, `company_cap`, `pool_day_cap`, `address_cap`, `all_time_cap`, `busy`. | A5 |
| `claude.read` | `source: "claude"`, `model`, `request_id`, `cost_usd_micros` | The reader used Claude's reading of a document. | yes |
| `claude.fallback` | `source: "fallback"`, `model` | The reader's call failed or was refused; the parser's reading was used. | yes |
| `agent.tool` | `agent`, `tool`, `turn`, `model`, `request_id`, `ms`, `answer` | After each tool an agent called. `answer` is the first sentence of the tool's answer, masked, at most 160 characters. The tool's input is never shown. | A6 (with ap-agents-1112) |
| `agent.said` | `agent`, `turn`, `model`, `text` | After each model answer that has text: the model's own words, masked, at most 600 characters. | A6 |
| `agent.nudged` | `agent`, `reason` | Code told the agent it had not finished (for example no decision yet). `reason` is masked, at most 160 characters. | A6 |
| `agent.run` | `agent`, `model`, `status`, `turns`, `cost_usd_micros`, `latency_ms` | When an agent's run ends. `status`: `done`, `incomplete`, `unavailable` or the loop's other outcomes. | A6 |
| `ap.checker_decided` | `source`, `model`, `action`, `outcome`, `overridden`, `overridden_by`, `code_requires`, `codes` | The Checker's decision on an invoice, as enforced. `source` is `claude` or the fallback. `codes` lists the codes of code's own findings, comma-separated, never their words. `overridden_by` says who overrode the agent, for example code. | A6 |
| `ap.payer_proposed` | `source`, `model`, `rail`, `pay_on`, `pay_currency`, `outcome`, `overridden`, `overridden_by` | The Payer's proposal on a payment, as enforced. The terms are never shown here; the proposal's own facts come from `GET /v1/engine/proposals/{id}`. | A6 |

"A5" and "A6" mean the row is written once that task of lane A lands. The allowlist already knows the row, so the page
can be built and tested now against rows made by hand with these exact fields.

## The payables chain's events (already written today)

| Event | Fields |
|---|---|
| `ap.received` | `status`, `read_by`, `amount`, `currency`, `findings` (codes, comma-separated) |
| `ap.status` | `status` (the new one), `from`, `proposal_id` |
| `ap.duplicate_document` | `invoice_id` |
| `proposal.created` | `kind` |
| `proposal.approved` | `method` |
| `proposal.executed` | `status` |
| `treasury.seeded` | `amount`, `currency` |
| `transfer.created` | `amount`, `currency`, `status`, `request_id` |
| `transfer.status` | `status` |
| `transfer.fee` | `amount`, `currency` |
| `vault.filed` | `files`, `corrections` |

The full list, with the events that carry no fields, is in `src/engine/events.ts`.

## Rules for the words on the page

- An event says who acted: Claude with the model and the request id, or code. Never word a line so that it suggests
  Claude decided when code did. `ap.checker_decided` with `overridden: true` means code's rule won.
- `claude.asking` never anticipates the answer ("asking Claude Haiku…", not "Claude is checking the bank details").
- Money moves on the engine's simulated bank: say "simulated bank · test money". Never write "real" about it.
