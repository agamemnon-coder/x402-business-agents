# Powered by Claude

Claude is how Purser's agents read the world: supplier notices, customer disputes, invoices, the CFO's policy in
plain words. Code checks what Claude read and what the agents decide, and only the CFO's Face ID moves money that needs a
person. The dashboard's "Powered by Claude" panel shows each model's calls, average time and cost.

## Three models, each for one job

| Model | Job | Why this model |
|---|---|---|
| Claude Haiku 5.5 | Sorts each incoming document: price notice, dispute, data correction or invoice | A short label on every document, so it must be fast and cheap; a wrong label is caught because the next step reads the document with its own schema |
| Claude Sonnet 5.5 | Reads a document into typed fields (structured outputs) and drafts the reply to the customer | The work that needs care with numbers and names, many times a day |
| Claude Opus 5.5 | Reviews a proposal's risk for the CFO, explains a blocked invoice, drafts rules from the CFO's plain words | Rare and important: one review per proposal, read by a person before they approve |

What none of them can do: hold a key, see a card number, pay anyone a mandate or the allowlist does not name, or
approve. The Treasury agent (on Opus) does propose amounts, such as a new split of the agents' budgets within the
20.00 total; code checks each proposal against the limits, and the CFO signs it with Face ID. Every answer is
checked by code (`src/claude/reader.ts`): a wrong shape, a refusal or a failed call falls back to a plain parser,
and an invoice reading that disagrees with the invoice's own lines is not used. The demo makes the same decisions
with or without an API key.

## Why Opus, and where it is not needed

Our own benchmark ([model-benchmark.md](model-benchmark.md)) does not show that the bulk work needs Opus. On the
agents' six eval cases, Haiku for every role scored 18 of 18, as did Sonnet, Opus and our split, at USD 0.0011 a run
against USD 0.0143 for the split: 13 times cheaper. On the harder documents the split, Sonnet and Opus scored 15 of 15
and Haiku 14 of 15 (it folded order #9 into a range). On three adversarial invoices added on 4 November (a hidden
prompt injection aimed at the reader and the reviewer, bank details that change subtly, and a duplicate with another
number), Haiku, Sonnet and Opus each scored 15 of 15 in five runs, at USD 0.0023, 0.0301 and 0.0733 a run. So Haiku
and Sonnet do the bulk: they sort and read every document. Opus does the rare steps on money a person is about to
sign: the Treasury agent's plans (a budget split, the licence timing) and the final advisory review of each proposal,
where a missed risk costs more than the review. That advice never decides: the rules in code hold every limit, the
CFO signs, and a review that says "approve" approves nothing. If the measurements keep showing no difference, the
review moves to a cheaper model by changing one line (`MODELS.review` in `src/claude/reader.ts`).

Two limits of these numbers, said plainly. The duplicate case gives the review the earlier invoice as context; the
runner's own invoice review does not pass earlier invoices yet, so in a live run a duplicate with a new number is
proposed like any invoice and stops at the CFO's Face ID (code's duplicate check compares invoice numbers, also
cosmetically different ones). And until 4 November the benchmark credited a reading to the model even when code had
rejected it and the parser stood in; it now counts those as parser readings. The 31 October rows were not re-run.

## What it costs

From the recorded run (Friday run 1, 30 October 2026, Northwind Outdoor; 23 Claude calls, priced at Anthropic's list
prices of 30 October 2026; `docs/demo/snapshot.json`, `snapshot.claude`):

| Model | Job | Calls | Cost |
|---|---|---|---|
| Haiku 5.5 | sorts each incoming document | 7 | $0.0004 |
| Sonnet 5.5 | reads documents into checked fields | 9 | $0.02 |
| Opus 5.5 | reviews a proposal's risk for the CFO | 7 | $0.16 |
| **All** | | **23** | **$0.18**, or $0.0078 per call |

Against the €1,914.99 the agents paid in euros in that run (card spend and the SWIFT transfer), that is **$0.093 of
AI per €1,000 paid**. Opus's reviews took about 7 seconds each on average; the readings were not timed in that run.
The dashboard's Agents tab shows the same split.

How it stays cheap:

- **The right model per job.** Opus does 7 of 23 calls but most of the cost, which is where its judgment is worth
  it; Haiku sorts all seven documents for less than a tenth of a cent.
- **Low effort by default.** Readings run at effort `low`; only Opus's reviews and drafts run at `medium`.
- **A cached system prompt.** The same instructions open every call and are marked for the prompt cache; its cache hits are logged per call in the audit log (`claude.read`).
- **Structured outputs.** A schema shapes each answer, so there is no retry for a reply that does not parse.
- **No model where code is enough.** Prices, limits, budgets, the FX check and every payment are code.

Prices: `src/claude/pricing.ts` (source and date in the file); cost per call: `test/claude-cost.test.ts`.

## The MCP moment

Outside agents use Purser through an MCP server (`npm run -s mcp`, [agent-api.md](agent-api.md)): any agent that
speaks MCP, Claude Code included, can ask for a company card, pay within its limits and ask the CFO for more. It
gets four tools and no keys; the CFO policy and Face ID apply to it exactly as to Purser's own agents.

## Built with Claude Code

Purser was built with Claude Code, with Max reviewing and approving: the code, the tests (over 900, including
property-based tests that found five bugs, all fixed), the red team, the security reviews and these docs.
