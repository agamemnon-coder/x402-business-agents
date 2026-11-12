# Ledger agents: the Controller and Ask the books (12 November)

Two new Claude agents with tool use over Purser's stored ledger, each behind its own flag and off by default. Written from the eval record (`docs/evals/ledger-agents.json`), its audit rows and the API budget file only.

## What each agent can and cannot do

| | Controller agent | Ask the books |
|---|---|---|
| Flag (off by default) | `KIT11_CONTROLLER_AGENT=on` | `KIT11_BOOKS_AGENT=on` |
| Model | `MODELS.act` (claude-sonnet-5-5) | `MODELS.act` (claude-sonnet-5-5) |
| Job | Month-end review of the supplier invoices in the ledger: duplicates, input VAT that does not match its code, amounts unusual against the supplier's history | Answers a CFO's question about the books |
| Tools | `list_invoices`, `supplier_history`, `check_vat`, `find_duplicates` (read-only); `propose` (stores a pending proposal); `finish` | `chart`, `find_lines` (read-only); `answer` |
| What code enforces | Every proposal needs evidence code finds in the ledger; code computes the correction (a reversal, a VAT move, or a hold to ask the supplier); at most 10 a month; nothing is posted until a named person approves (`npm run controller -- approve CP-0001 --by <name>`) | Every figure must equal a search's debit, credit or net (or a line's amount) the agent was shown; every amount in the text must be a figure; "cannot answer" carries no amounts; three tries |
| Hard caps per run | USD 0.40, 180 s, 12 turns, 6,000 output tokens per turn | USD 0.25, 120 s, 10 turns, 4,000 output tokens per turn |
| Code fallback, labelled | Code's strict rules propose (`proposed_by: code`) | Code answers only a question naming one party, else "cannot answer" |
| Decision row | `controller.reviewed` (model, request ids, cost, turns), `controller.proposed`, `controller.approved` / `controller.rejected` | `books.answered` (figures, the lines behind each source, model, request ids, cost) |

The run cap is new in the shared loop (`src/agents/loop.ts`, `runCapMicros`, `timeoutMs`, `maxTokens`; opt-in, so the existing agents are unchanged): before every turn the loop adds what the run has spent to the most the next turn can cost (its prompt so far and half again, plus a full answer at list price) and does not ask a turn that could cross the cap. A test (`test/ledger-agents.test.ts`) shows a run stopped after one turn.

The Controller does not pay or book on its own, and Ask the books proposes nothing: neither has a tool that moves money or posts an entry.

## The live eval (`npm run ledger-evals -- --models sonnet --max-usd 3`)

Run 2026-11-12 14:47 UTC on commit 209a5f8c4a8a. One run per case.

| Agent | Model | Passed | Decided by Claude | Cost (USD) |
|---|---|---|---|---|
| Controller | claude-sonnet-5-5 | 18/18 | 18/18 | 0.2840 |
| Ask the books | claude-sonnet-5-5 | 16/17 | 17/17 | 0.1796 |
| Controller | code (fallback) | 15/18 | 0/18 | 0 |
| Ask the books | code (fallback) | 3/17 | 0/17 | 0 |

The mistake: asked "What was Packwise's revenue last quarter, and how do our margins compare?", the books agent answered with our own third-quarter revenue, costs and result (2,450.00, 1,052.50 and 1,397.50 EUR, each checked by code against the ledger) instead of saying the ledger holds no figures of another company. The figures were true; the answer to the question asked was not. Code's check does not catch this: it checks that numbers are real, not that they answer the question.

What the fallback gets wrong and Claude did not: code's rule calls a weekly courier billed for the same amount a duplicate (2 cases) and a yearly plan the invoice explains an unusual amount (1 case).

Every case, every answer and the request id of every Claude call: `docs/agent-evals-ledger.md` and `docs/evals/ledger-agents.json`.

## Spend and live calls

- Claude: 0.4636 USD at list prices for 106 Claude calls (35 cases, each call with its request id in the record), in the `ledger-agents` block of `docs/runs/api-budget.jsonl` (35 lines, one per case). This stream's limit was USD 10.
- Airwallex sandbox: 0 requests. Metal testnet: 0 requests.

## Cut, by the orchestrator's wrap-up order (12 November)

- The agent-driven live run (the Sourcing agent choosing purchases and rails in a fresh testnet and sandbox world, the rail refusing the over-limit attempt): not run. No claim is made about it.
- A Treasury agent that proposes a payment schedule within the CFO's limits: not built. The existing Treasury timing agent (`src/agents/timingAgent.ts`, advice on one invoice) is unchanged.

## Wording to apply (for the pages other sessions own; not applied here)

- Agents page or /claude, one row each: "Controller agent (Claude Sonnet, behind a flag, off by default): reviews the month's supplier invoices and proposes corrections; code checks the evidence and computes every correction; a person approves before anything is posted. Eval: 18 of 18 cases, one run each, 12 November." and "Ask the books (Claude Sonnet, behind a flag, off by default): answers the CFO's questions with figures code checks against the ledger lines it cites, or says it cannot answer. Eval: 16 of 17 cases, one run each, 12 November; the miss is published."
- Do not say these agents run in the product by default, ran in a live run with rails, or approve anything themselves.
