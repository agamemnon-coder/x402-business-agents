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

## Why these models, measured honestly

We tested the split against one model for every role (`npm run model-bench`, real models, three runs per case;
[docs/model-benchmark.md](model-benchmark.md)). What it shows, and what it does not:

- **On the agents' everyday cases, Haiku alone is as good.** Haiku for every role passed 18 of 18, like the split,
  at USD 0.0011 a run against USD 0.0143. We do not claim the bigger models are needed there.
- **On harder documents, Haiku alone made one mistake that would cost money.** In a mixed-language dispute that
  leaves one order out of a range, it read the range as if that order were in it. The split, Sonnet alone and Opus
  alone read all 15 of 15. That is why Sonnet reads documents and Haiku only sorts them.
- **Opus is the most expensive part and the least proven.** Its review is advice for a person, read before they sign;
  it decides nothing. In the recorded run it cost $0.16 of $0.18. The benchmark does not show that Opus is needed for
  that review: Sonnet for every role passed the same cases. We keep Opus there because a review happens once per
  proposal, a person reads it, and on money they are about to sign the best explanation is worth a few cents. If cost
  mattered more, Sonnet for the review is the measured alternative.

Whatever model answers, code checks the answer before anything uses it, so a wrong reading falls back to a parser
or stops for a person; it never pays.

**Three adversarial invoices (4 November).** A hidden prompt injection aimed at the reader and the reviewer, bank
details that change subtly, and a duplicate with another invoice number: Haiku, Sonnet and Opus each scored 15 of 15
in five runs, at USD 0.0023, 0.0301 and 0.0733 a run ([model-benchmark.md](model-benchmark.md)). So on these cases
too, the bigger models did not do better; if that keeps holding, the review moves to a cheaper model by changing one
line (`MODELS.review` in `src/claude/reader.ts`). Two limits, said plainly: the duplicate case gives the review the
earlier invoice as context, which the runner's own invoice review does not do yet (code's duplicate check compares
invoice numbers, and a duplicate with a new number stops at the CFO's Face ID like any invoice); and until
4 November the benchmark credited a reading to the model even when code had rejected it and the parser stood in. It
now counts those as parser readings; the 31 October rows were not re-run.

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
gets five tools and no keys; the CFO policy and Face ID apply to it exactly as to Purser's own agents.

## Built with Claude Code

Purser was built with Claude Code, with Max reviewing and approving: the code, the tests (over 900, including
property-based tests that found five bugs, all fixed), the red team, the security reviews and these docs.
