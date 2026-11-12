# The docs, by reader

Read these five first, in this order:

1. [runs/README.md](runs/README.md): every live run, newest first, with its ids and what was simulated; generated from the records.
2. [runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md): the main run of 3 November, the one the site replays; the headline numbers come from it.
3. [claims.md](claims.md): every number and factual claim, with where it comes from.
4. [controls-matrix.md](controls-matrix.md): each risk, its control, its test and its evidence.
5. [business/README.md](business/README.md): the business case, a hypothesis: not validated with customers yet.

Back to the [README](../README.md). Test money only throughout: the Airwallex sandbox and Metal testnet.

## Juror

- [submission/README.md](submission/README.md): the submission text, with the short Description and the jury's instructions.
- [submission/long-description.md](submission/long-description.md): the long form text, with the separate live tests.
- [runs/](runs/): every run log, dated, including awx-1 and the Airi run of 7 November.
- [requirements-matrix.md](requirements-matrix.md): what the hackathon asks for, where Purser does it, and the proof.
- [idea-vs-build.md](idea-vs-build.md): the idea as submitted on 24 October, promise by promise, against what is built.
- [airwallex.md](airwallex.md): Airwallex in Purser: the APIs it calls, and why.
- [airwallex-approvals.md](airwallex-approvals.md): Airwallex's own approval workflow as a second lock, and money in by card.
- [metal-award.md](metal-award.md): what Purser uses from Metal, and the proof on Metal testnet.
- [/claude](https://kit11.max-31b.workers.dev/claude), measured, not asserted: the 40 simulated worlds ([night batch](runs/2026-11-02-night-batch.md)), the [blind holdouts](runs/holdouts/2026-11-03-blind/results.md), each model on each agent ([evals/agents.json](evals/agents.json)) and the agent interface over MCP ([one session](runs/2026-11-12-mcp-transcript.json)).
- [t0.md](t0.md) and [/t0](https://kit11.max-31b.workers.dev/t0): Purser's books in T:0's ledger; the posting of 10 November is [runs/2026-11-10-t0-journal-sandbox.md](runs/2026-11-10-t0-journal-sandbox.md).
- [metal-review.md](metal-review.md): a review: does Purser use metal-agent and metal-pay the way Metal intends?
- [submission/long-description.md#visa](submission/long-description.md#visa): the Visa TAP note; the Airi run (Visa Intelligent Commerce) is in [runs/2026-11-07-vic-1.md](runs/2026-11-07-vic-1.md).
- [claude.md](claude.md): how Purser uses Claude.
- [t0.md](t0.md): Purser's books in a real general ledger (T:0).
- [feedback-for-metal-and-airwallex.md](feedback-for-metal-and-airwallex.md): feedback for Metal and Airwallex.
- [agents.md](agents.md): the Kit 11 agents: Claude decides inside the mandate, the rails enforce it.
- [agent-evals.md](agent-evals.md) and [model-benchmark.md](model-benchmark.md): the three agents with real models, and which Claude model for which job.
- [agents-autonomy.md](agents-autonomy.md), [agents-autonomy-redteam.md](agents-autonomy-redteam.md) and [variation.md](variation.md): the autonomous agents: variation and safety, the red team, the holdouts.
- [agent-was-wrong.md](agent-was-wrong.md): when the agent was wrong: what it wanted, what stopped it, what the CFO saw.
- [fraud-and-injection.md](fraud-and-injection.md): invoice fraud and prompt injection.
- [unit-economics.md](unit-economics.md): does each agent pay for itself? Measured numbers only.
- [compliance.md](compliance.md): who does what, and how Purser supports it.
- [evidence/README.md](evidence/README.md): what the organisers answered, in our own words.
- [rules.md](rules.md): the prize and judging rules, as checked on 29 October.
- [after-the-kit.md](after-the-kit.md): what was built after the kit (the payables inbox, connected accounts) and where its code is in this repository; tested against stand-ins, with sandbox runs on 10 November; the hosted preview is private, no customer uses it; not part of the Kit 11 runs.

## Builder

- [architecture.md](architecture.md): architecture, tooling and credits.
- [run-it.md](run-it.md): running it live, with sandbox keys and a Metal RPC.
- [security.md](security.md): the threat model, the attacks and what stops each one.
- [controls.md](controls.md): every control, how it works, and its evidence.
- [runbook.md](runbook.md): incidents, the emergency stop, key rotation, recovery.
- [decisions.md](decisions.md): decisions taken during the build, each with its reason and its cost if wrong.
- [hardening.md](hardening.md): the hardening log, 30 October to the freeze on 4 November.
- [cfo-policy.md](cfo-policy.md): the CFO policy.
- [cards-and-clearing.md](cards-and-clearing.md): company cards, clearing and the simulated month.
- [phone-approval.md](phone-approval.md): the dashboard and approval on a phone.
- [ask-purser.md](ask-purser.md): a card for one task, from one sentence.
- [agent-api.md](agent-api.md): outside agents (the agent API, MCP) and the ERP export.
- [audit/README.md](audit/README.md): the audit log of the recorded run of 30 October.
- [security/README.md](security/README.md): the security artefacts (the software bill of materials).
- Built after the kit (test environment, not live): [payables.md](payables.md) (the invoice inbox), [ledger.md](ledger.md) (Purser's own books), [vault.md](vault.md), [erp.md](erp.md) and [moneybird.md](moneybird.md) (ERP connectors), [airwallex-platform.md](airwallex-platform.md) (connected accounts), [cloud.md](cloud.md), [go-live.md](go-live.md) (what is open before real money) and [e2e-live.md](e2e-live.md) (three test companies, invoice to T:0).
- [superpowers/specs/](superpowers/specs/): the design specs of 8 November for what was built after the kit. [plans/](plans/): design notes and research (Visa TAP, Airi, one source for the books).
- Dated records, kept where other documents cite them: [data-qa.md](data-qa.md) (the data check of the recorded run of 30 October; the main run's is [runs/2026-11-03-main-run-data-qa.md](runs/2026-11-03-main-run-data-qa.md)) and [metal-qa-2026-11-01-week.md](metal-qa-2026-11-01-week.md) (the Metal QA of 1 November).

## Video

- [video/README.md](video/README.md): the film's edit guide, its scenes and where each figure comes from.
- [video-script.md](video-script.md): which script, voice-over text and subtitles belong to the film.

## History

- [archive/](archive/): kept for history; each file says what replaced it.

Not part of the submission: `internal/` holds only the working notes a test, a script or another document still cites
(two runbooks, a restart plan, a requirements audit and a cheat sheet, in Dutch; the Demo Day card; the
after-submission list).
