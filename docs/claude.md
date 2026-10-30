# Powered by Claude

Claude is how Purser's agents read the world: supplier notices, customer disputes, invoices, the CFO's policy in
plain words. Code decides what happens with what Claude read, and only the CFO's Face ID moves money that needs a
person. The dashboard's "Powered by Claude" panel shows each model's calls, average time and cost.

## Three models, each for one job

| Model | Job | Why this model |
|---|---|---|
| Claude Haiku 5.5 | Sorts each incoming document: price notice, dispute, data correction or invoice | A short label on every document, so it must be fast and cheap; a wrong label is caught because the next step reads the document with its own schema |
| Claude Sonnet 5.5 | Reads a document into typed fields (structured outputs) and drafts the reply to the customer | The work that needs care with numbers and names, many times a day |
| Claude Opus 5.5 | Reviews a proposal's risk for the CFO, explains a blocked invoice, drafts rules from the CFO's plain words | Rare and important: one review per proposal, read by a person before they approve |

What none of them can do: hold a key, see a card number, pick a payee, choose an amount or approve. Every answer is
checked by code (`src/claude/reader.ts`): a wrong shape, a refusal or a failed call falls back to a plain parser,
and an invoice reading that disagrees with the invoice's own lines is not used. The demo makes the same decisions
with or without an API key.

## What it costs

From rehearsal 3 (29 October 2026, with the earlier example company; 32 Claude calls, priced at Anthropic's list prices of 30 October 2026):

| Model | Calls | Cost |
|---|---|---|
| Haiku 5.5 | 10 | $0.0010 |
| Sonnet 5.5 | 14 | $0.03 |
| Opus 5.5 | 8 | $0.20 |
| **All** | **32** | **$0.23**, or $0.0072 per decision |

Against the €1,893.99 the agents paid in euros in that run (card spend and the SWIFT transfer), that is **$0.12 of
AI per €1,000 paid**. The run was recorded before latency was logged; every Claude call now records its latency and
cost in the audit log (`claude.read`), and the panel shows both.

How it stays cheap:

- **The right model per job.** Opus does 8 of 32 calls but most of the cost, which is where its judgment is worth
  it; Haiku sorts at a tenth of a cent for all ten documents.
- **Low effort by default.** Readings run at effort `low`; only Opus's reviews and drafts run at `medium`.
- **A cached system prompt.** The same instructions open every call and are marked for the prompt cache; in rehearsal 3, 6,363 input tokens came from the cache and 23,584 did not.
- **Structured outputs.** A schema shapes each answer, so there is no retry for a reply that does not parse.
- **No model where code is enough.** Prices, limits, budgets, the FX check and every payment are code.

Prices: `src/claude/pricing.ts` (source and date in the file); cost per call: `test/claude-cost.test.ts`.

## The MCP moment

Outside agents use Purser through an MCP server (`npm run -s mcp`, [agent-api.md](agent-api.md)): any agent that
speaks MCP, Claude Code included, can ask for a company card, pay within its limits and ask the CFO for more. It
gets four tools and no keys; the CFO policy and Face ID apply to it exactly as to Purser's own agents.

## Built with Claude Code

Purser was built with Claude Code, with Max reviewing and approving: the code, the tests (over 550, including
property-based tests that found five bugs, all fixed), the red team, the security reviews and these docs.
