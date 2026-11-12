# Jury cheat sheet: Anthropic

For Max, Demo Day (19 November). The questions a juror from Anthropic is most likely to ask, most likely first. Each
answer is two sentences at most and in line with [docs/claims.md](../../claims.md); every figure in an answer is in
that file or in a run record, which `test/jury-cheat-sheets.test.ts` checks. If a question is not here: repeat it,
answer in two sentences, and say "not tested yet" where that is the truth.

## 1. What can Claude do with money?

Nothing on its own: Claude reads and proposes, holds no key, never sees a card number and approves nothing. Code checks every answer, the rails hold the limits, and beyond the limits a person signs the exact terms.

**Source:** [docs/claude.md](../../claude.md); `test/adversarial.test.ts`

## 2. What if Claude makes a mistake?

Code checks every reading against the document's own lines, the allowlist and the limits, and a wrong shape, a refusal or a failed call falls back to a plain parser, logged with the reason. In the main run Claude made 24 of 24 decisions with 0 fallbacks.

**Source:** [docs/claude.md](../../claude.md); [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md)

## 3. Why Claude, and why three models?

We measured it: Haiku alone passed 18 of 18 everyday cases, but on a harder dispute it misread one order, so Sonnet reads documents and Haiku only sorts them. Opus reviews proposals for a person and is the least proven part; Sonnet for that review is the measured cheaper alternative.

**Source:** [docs/claude.md](../../claude.md), "Why these models, measured honestly"; [docs/model-benchmark.md](../../model-benchmark.md)

## 4. What does Claude cost per decision?

In the main run Claude cost USD 0.3170 for 24 decisions, USD 0.0132 a decision. The cost comes per exception, not per payment, because routine payments are code.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md); [docs/claims.md](../../claims.md)

## 5. What about prompt injection?

The models read documents as data, with no field for a payee or an approval, and code screens every document for planted instructions first. In a live test an invoice that said the CFO had pre-approved it became an ordinary proposal to the allowlisted account, waiting for Face ID.

**Source:** [docs/runs/2026-10-29-injection.md](../../runs/2026-10-29-injection.md); [docs/fraud-and-injection.md](../../fraud-and-injection.md)

## 6. Are the agents on the hands-on page really live?

Yes, and labelled: Claude Sonnet reads the invoice live and Claude Opus advises on the timing, within a shared budget of USD 10 a day and 8 seconds a call. When a live call cannot answer, the page shows a recorded real answer or code's own reading, labelled with the reason.

**Source:** [docs/submission/qa.md](../qa.md), question 18; `worker/src/agentLine.ts`

## 7. What happens when the Claude API is slow or down?

The reader falls back to a plain parser, logs why, and the agent goes on, which the chaos tests check for an overloaded, unreachable and hanging API. On the hands-on page a hanging call is cut off by its time limit and code's own reading takes over, labelled.

**Source:** `test/chaos.test.ts`; `test/chaos-partners.test.ts`

## 8. Which parts of the Claude API do you use?

Structured outputs for typed readings, tool use for the Treasury agent's own checks, and prompt caching on the reader's instructions. Every call is an audit row with the model, the request id, a hash of the input and the token use.

**Source:** `src/claude/reader.ts`; `src/try/claude.ts`; [docs/compliance.md](../../compliance.md), section 2

## 9. Has an agent ever been wrong?

Yes: in an eval the Support agent took a customer's word for refunds outside the dispute, and the rails and code's checks decided what actually happened. Both cases are published as they happened.

**Source:** [docs/agent-was-wrong.md](../../agent-was-wrong.md)

## 10. How do you evaluate the agents?

Evals of the agents' readings run in CI on the plain parsers, and with the real models on demand. A red team attacks Purser and every attack must fail; the reports are in the repository.

**Source:** [docs/compliance.md](../../compliance.md), section 2; [docs/redteam/](../../redteam/)

## 11. Why not let Claude approve small payments?

Small payments inside the limits need no approval at all: code pays them under the agent's own mandate or card. Approval is for what goes beyond the limits, and that is a person's signature, never a model's.

**Source:** [docs/controls.md](../../controls.md); `src/policy/approvals.ts`

## 12. Could a model ever change the payee or the amount?

No model sets the amount, the payee, the conversion or the plan on the hands-on page: the terms come from a reading that code checked against the invoice, the allowlist and the limit. Opus only advises on the timing, and code checks every amount in its reason against code's own numbers.

**Source:** [docs/submission/qa.md](../qa.md), question 19; `worker/src/trySign.ts`

## 13. How did you build it?

With Claude Code as the build tool. Where it touched a run we say so: the second approver in the main run was a labelled test passkey, pressed by Claude Code on Max's go.

**Source:** [docs/claims.md](../../claims.md), the second approver's row

## 14. Does Claude see personal or card data?

Claude never sees a card number, and the documents it reads in the runs are test invoices and test messages. Each reading is logged with a hash of its input, not the input in the clear.

**Source:** [docs/claude.md](../../claude.md); [docs/compliance.md](../../compliance.md), sections 2 and 4

## 15. What would you do differently with more Claude budget?

Measure Sonnet in place of Opus for the review on more cases, since the benchmark did not show Opus is needed there. That is a plan, not a result.

**Source:** [docs/claude.md](../../claude.md), "Why these models, measured honestly"
