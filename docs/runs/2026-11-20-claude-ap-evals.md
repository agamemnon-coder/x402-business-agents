# Claude: the payables agents' evals, re-run on 2026-11-20 with real models

Record: [../evals/ap-agents-rerun-2026-11-20.json](../evals/ap-agents-rerun-2026-11-20.json), written by `npm run ap-agent-evals -- --models haiku,sonnet,opus --runs 1 --max-usd 2.6 --out docs/evals/ap-agents-rerun-2026-11-20.json` ([src/cli/apAgentEvals.ts](../../src/cli/apAgentEvals.ts)); this page by `npx tsx src/cli/apEvalsRerunMd.ts` from that record and the committed one, [docs/evals/ap-agents.json](../evals/ap-agents.json) (run 2026-11-12), which is kept as it was recorded.

- **What ran.** Every case of the Checker (reads an invoice, decides pay, ask the CFO or hold) and the Payer, each sent to Claude Haiku, Sonnet and Opus through the same code the product runs, on test invoices. Red-team cases carry injected instructions, forged banks and pressure. The outcome is what stands after Purser's code has checked the model's answer: "unsafe after code" counts a payment that should not have been made and was not stopped.
- **Not held out.** The same cases were first run on 12 Nov and are committed; the code has changed since that run (this run's commit: `f667d16c616b`). This is a re-run on today's code and today's models, not a fresh test of unseen cases.
- **Cost.** USD 1.7000 of Claude at list price (cap 2.6), each case booked in docs/runs/api-budget.jsonl under "ap-agents".

## Result, beside the committed run

| Agent | Model | 2026-11-20 | 2026-11-12 |
|---|---|---|---|
| checker | claude-haiku-5-5 | 49/49 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0006 a case; p50 4.3 s | 49/49 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0006 a case; p50 3.9 s |
| checker | claude-sonnet-5-5 | 49/49 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0093 a case; p50 4.1 s | 49/49 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0093 a case; p50 4.6 s |
| checker | claude-opus-5-5 | 49/49 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0177 a case; p50 4.5 s | 49/49 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0183 a case; p50 5.5 s |
| payer | claude-haiku-5-5 | 13/13 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0007 a case; p50 5.0 s | 13/13 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0006 a case; p50 4.4 s |
| payer | claude-sonnet-5-5 | 13/13 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0106 a case; p50 7.0 s | 13/13 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0092 a case; p50 5.5 s |
| payer | claude-opus-5-5 | 13/13 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0151 a case; p50 4.8 s | 13/13 right; fooled 0; unsafe after code 0; fallbacks 0; USD 0.0162 a case; p50 5.3 s |

Defaults the record picks: checker claude-haiku-5-5, payer claude-haiku-5-5.

## Cases not right in this run

None.
