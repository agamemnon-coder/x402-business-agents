# Model benchmark: which Claude model for which job

Run on 2026-10-31 with `npm run model-bench`: 3 run(s) per row, real Claude models, throwaway worlds (nothing reached Airwallex, Metal or a phone). Raw results: [evals/model-benchmark.json](evals/model-benchmark.json).

A case counts for a model only if it passed with every reading from the model itself. When a model fails, Purser's deterministic parsers take over so the decision stays the same; here that counts against the model. In every row the code decides: no case can approve or pay.

## The agents' eval cases

The agents' eval cases (src/evals/cases.ts); 6 cases.

| Setup | Passed by the model | Parser readings | Calls | Cost per run (list price) | Median latency per call |
|---|---|---|---|---|---|
| Purser's split: Haiku sorts, Sonnet reads, Opus reviews | 18 of 18 | 0 | 42 | USD 0.0143 | 1551 ms |
| Haiku for every role | 18 of 18 | 0 | 42 | USD 0.0011 | 815 ms |
| Sonnet for every role | 18 of 18 | 0 | 42 | USD 0.0195 | 1597 ms |
| Opus for every role | 18 of 18 | 0 | 42 | USD 0.0418 | 2198 ms |

**What this shows:** Haiku for every role passes the most (18 of 18, as many as Purser's split), at USD 0.0011 a run against USD 0.0143.

**What failed:**

Nothing: every case passed in every row.

## Harder documents

Harder documents (src/evals/hard.ts): a long invoice with a discount line and closed old bank details, an invoice in German, an IBAN one digit off, a mixed-language dispute that leaves one order out of a range, a price notice in German; 5 cases.

| Setup | Passed by the model | Parser readings | Calls | Cost per run (list price) | Median latency per call |
|---|---|---|---|---|---|
| Purser's split: Haiku sorts, Sonnet reads, Opus reviews | 15 of 15 | 0 | 30 | USD 0.0116 | 1222 ms |
| Haiku for every role | 14 of 15 | 0 | 30 | USD 0.0011 | 828 ms |
| Sonnet for every role | 15 of 15 | 0 | 30 | USD 0.0159 | 1580 ms |
| Opus for every role | 15 of 15 | 0 | 30 | USD 0.0333 | 2099 ms |

**What this shows:** Purser's split passes the most (15 of 15), at the lowest cost among the setups that do.

**What failed:**

- **Haiku for every role:**
  - hard-mixed-dispute: read orders [5,6,7,8,9,10,11,12,13,14,15,16], not #5-#16 without #9

Prices: Anthropic's list prices in src/claude/pricing.ts. Latency includes the network from the build container.
