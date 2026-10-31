# Model benchmark: which Claude model for which job

Run on 2026-10-31 with `npm run model-bench`: the agents' 6 eval cases (src/evals/cases.ts), 3 run(s) per row, real Claude models, throwaway worlds (nothing reached Airwallex, Metal or a phone). Raw results: [evals/model-benchmark.json](evals/model-benchmark.json).

A case counts for a model only if it passed with every reading from the model itself. When a model fails, Purser's deterministic parsers take over so the decision stays the same; here that counts against the model. In every row the code decides: no case can approve or pay.

| Setup | Passed by the model | Parser readings | Calls | Cost per run (list price) | Median latency per call |
|---|---|---|---|---|---|
| Purser's split: Haiku sorts, Sonnet reads, Opus reviews | 18 of 18 | 0 | 42 | USD 0.0143 | 1573 ms |
| Haiku for every role | 18 of 18 | 0 | 42 | USD 0.0011 | 872 ms |
| Sonnet for every role | 18 of 18 | 0 | 42 | USD 0.0195 | 1710 ms |
| Opus for every role | 18 of 18 | 0 | 42 | USD 0.0411 | 2442 ms |

## What this shows

Haiku for every role passes as many cases as Purser's split (18 of 18), at USD 0.0011 a run against USD 0.0143.
So these cases do not show that Sonnet or Opus are needed: they are easy for every model. Purser keeps Sonnet for reading and Opus for the CFO's risk review as a margin for harder documents, not because these cases prove it. A harder eval set (messier invoices, longer disputes) is the next step before choosing.

## What failed

Nothing: every case passed in every row.

Prices: Anthropic's list prices in src/claude/pricing.ts. Latency includes the network from the build container.
