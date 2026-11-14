# The docs, by reader

Read these five first, in this order:

1. [runs/README.md](runs/README.md): every live run, newest first, with its ids and what was simulated; generated from the records.
2. [runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md): the main run of 3 November, the one the site replays; the headline numbers come from it.
3. [claims.md](claims.md): every number and factual claim, with where it comes from.
4. [controls-matrix.md](controls-matrix.md): each risk, its control, its test and its evidence.
5. [business/README.md](business/README.md): the business case, a hypothesis: not validated with customers yet.

Back to the [README](../README.md). Test money only throughout: the Airwallex sandbox and Alta (formerly Metal) testnet;
the chain partner renamed itself on 14 November, and records and file names from before keep "Metal".

Moved out of the README on 14 November (the README upgrade): the run-by-run table of what is live and what is
simulated ([in-depth.md](in-depth.md#whats-live-whats-simulated-run-by-run)) and the diagram of where it runs
([architecture.md](architecture.md#where-it-runs)). The release notes: [releases/v1.1-submission.md](releases/v1.1-submission.md);
every pull request: [CHANGELOG.md](../CHANGELOG.md).

## Juror

- [submission/README.md](submission/README.md): the submission text, with the short Description and the jury's instructions.
- [submission/long-description.md](submission/long-description.md): the long form text, with the separate live tests.
- [in-depth.md](in-depth.md): the README's sections in full: what ran live with one id per rail, where each judging criterion is proven, the Kit 11 runs with every id, Try step by step, what is real and what is mock.
- [runs/](runs/): every run log, dated, newest first in [runs/README.md](runs/README.md).
- [requirements-matrix.md](requirements-matrix.md): what the hackathon asks for, where Purser does it, and the proof.
- [idea-vs-build.md](idea-vs-build.md): the idea as submitted on 24 October, promise by promise, against what is built.
- [airwallex.md](airwallex.md): Airwallex in Purser: the APIs it calls, and why.
- [airwallex-approvals.md](airwallex-approvals.md): Airwallex's own approval workflow as a second lock, and money in by card.
- [metal-award.md](metal-award.md): what Purser uses from Alta, and the proof on Alta testnet (for the Metal Award).
- [/claude](https://kit11.max-31b.workers.dev/claude), measured, not asserted: the 40 simulated worlds ([night batch](runs/2026-11-02-night-batch.md)), the [blind holdouts](runs/holdouts/2026-11-03-blind/results.md), each model on each agent ([evals/agents.json](evals/agents.json)) and the agent interface over MCP ([one session](runs/2026-11-12-mcp-transcript.json)).
- [t0.md](t0.md) and [/t0](https://kit11.max-31b.workers.dev/t0): Purser's books in T:0's ledger; the posting of 10 November is [runs/2026-11-10-t0-journal-sandbox.md](runs/2026-11-10-t0-journal-sandbox.md).
- [metal-review.md](metal-review.md): a review: does Purser use metal-agent and metal-pay the way Alta intends?
- [submission/long-description.md#visa](submission/long-description.md#visa): the Visa TAP note; the latest Airi run (Visa Intelligent Commerce, 14 November) is [runs/2026-11-14-vic-5.md](runs/2026-11-14-vic-5.md), the first [runs/2026-11-07-vic-1.md](runs/2026-11-07-vic-1.md).
- [claude.md](claude.md): how Purser uses Claude.
- [feedback-for-metal-and-airwallex.md](feedback-for-metal-and-airwallex.md): feedback for Alta and Airwallex.
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
- [diagrams.md](diagrams.md): Purser in five diagrams (in one line, who holds which limit, one payment end to end, the mandate on Alta, where it runs), drawn by GitHub from Mermaid.
- [run-it.md](run-it.md): running it live, with sandbox keys and an Alta RPC.
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
- [connect-claude.md](connect-claude.md): connect your own AI (Claude, or any MCP client) to a Purser company: read and propose only; every client's steps and every tool.
- [audit/README.md](audit/README.md): the audit log of the recorded run of 30 October.
- [security/README.md](security/README.md): the security artefacts (the software bill of materials).
- [repo-settings.md](repo-settings.md): the repository's settings on GitHub (About, social preview, releases, branch protection on main), for the owner to set by hand.
- Built after the kit (test environment, not live): [payables.md](payables.md) (the invoice inbox), [ledger.md](ledger.md) (Purser's own books), [vault.md](vault.md), [erp.md](erp.md) and [moneybird.md](moneybird.md) (ERP connectors), [airwallex-platform.md](airwallex-platform.md) (connected accounts), [cloud.md](cloud.md), [go-live.md](go-live.md) (what is open before real money) and [e2e-live.md](e2e-live.md) (three test companies, invoice to T:0).
- More built after the kit, each saying its own status: [tokenize.md](tokenize.md) (invoice tokens on Alta, a
  prototype; its run of 12 November is [runs/2026-11-12-tokenize.md](runs/2026-11-12-tokenize.md), its record template
  [tokenize-run-template.md](tokenize-run-template.md)), [real-customers.md](real-customers.md) (each company's own
  money account and books; behind flags that are off by default), [autopilot.md](autopilot.md) (pending invoices one
  step forward, until a person is needed), [reconcile-books.md](reconcile-books.md) (Purser's books next to the outside
  books), [zero-trust.md](zero-trust.md) (the limits proven layer by layer, generated),
  [agent-evals-ledger.md](agent-evals-ledger.md) (evals of the ledger agents, generated),
  [engine-events.md](engine-events.md) (the engine's events for the hands-on page; the code wins) and
  [visa-icc.md](visa-icc.md) (Visa Intelligent Commerce Connect from public docs; access not granted, not used).
- [plans/](plans/): design notes and research (Visa TAP, Airi, one source for the books).
- Dated records, kept where other documents cite them: [data-qa.md](data-qa.md) (the data check of the recorded run of 30 October; the main run's is [runs/2026-11-03-main-run-data-qa.md](runs/2026-11-03-main-run-data-qa.md)) and [metal-qa-2026-11-01-week.md](metal-qa-2026-11-01-week.md) (the Metal QA of 1 November).

## Video

- [video/README.md](video/README.md): the film's edit guide, its scenes and where each figure comes from.
- [video-script.md](video-script.md): which script, voice-over text and subtitles belong to the film.

## History

- [archive/](archive/): kept for history; each file says what replaced it. Working files moved out of the docs root on
  13 November, kept as evidence because a test, a script or a run log still cites them:
  - [archive/internal/](archive/internal/): the working notes, in Dutch (two runbooks, a restart plan, a requirements
    audit, a cheat sheet), the Demo Day card and the after-submission list. Not part of the submission.
  - [archive/superpowers/specs/](archive/superpowers/specs/): the design specs of 8 November for what was built after the kit.
  - [archive/readme-v2-draft.md](archive/readme-v2-draft.md): a generated draft of the README's structure (`npm run readme-draft`), not the README.
  - [archive/runs/](archive/runs/): two notes of the dry runs: the acceptance list (in Dutch) and the recycling of test money.
