<a href="../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/brand/purser-mark-dark.svg"><img src="assets/brand/purser-mark.svg" alt="Purser" width="36" height="36"></picture></a>

# Purser documentation

Every Purser document, grouped by what you need it for; test money only throughout.

| At a glance | Record |
|---|---|
| **7,671 tests passing**, 0 failed, in the last full run | [assets/test-summary.json](assets/test-summary.json) |
| **33 live runs**, the last on 19 Nov 2026 | [runs/README.md](runs/README.md) |
| **189 checks passed**, 3 could not run here, 0 failed | [evidence/verification-2026-11-15.md](evidence/verification-2026-11-15.md) |
| **37 of 39** red-team attacks stopped, 2 caught afterwards (a test world) | [redteam/report.json](redteam/report.json) |

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/architecture-wide-dark.svg"><img src="assets/architecture-wide-light.svg" alt="AI agents propose; three layers that do not trust each other can each stop a payment: Purser's checks in code, the CFO's Face ID over the exact terms above a limit, the rail's own controls; then the ledger. Sandbox and testnet runs, test money." width="100%"></picture>

## Start here

Read these five first, in this order:

1. [runs/README.md](runs/README.md): every live run, newest first, with its ids and what was simulated; generated from the records.
2. [runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md): the main run of 3 November, the one the site replays; the headline numbers come from it.
3. [claims.md](claims.md): every number and factual claim, with where it comes from.
4. [controls-matrix.md](controls-matrix.md): each risk, its control, its test and its evidence.
5. [business/README.md](business/README.md): the business case, a hypothesis: not validated with customers yet.

**Where the numbers come from.** The figures above are read from their records by a test, so they cannot drift: the
test count from [assets/test-summary.json](assets/test-summary.json) (written by `npm run test-count`), the live runs
from [runs/README.md](runs/README.md), the checks from [evidence/verification-2026-11-15.md](evidence/verification-2026-11-15.md)
and the red team from [redteam/report.json](redteam/report.json). Every other headline figure is on the evidence wall,
[evidence/evidence-wall.json](evidence/evidence-wall.json) (written by `npm run evidence:wall`, shown on
[/proof](https://kit11.max-31b.workers.dev/proof#evidence)), and every claim with its source is in [claims.md](claims.md).
A document that needs a figure points to one of these instead of typing it again.

The rails are the Airwallex sandbox and the Alta (formerly Metal) testnet. Alta renamed itself on 14 November; records
and file names from before keep "Metal". Back to the [README](../README.md); every pull request is in
[CHANGELOG.md](../CHANGELOG.md).

## Contents

- [Product](#product): what Purser does, how it is built, and how to connect to it.
- [Security & compliance](#security--compliance): the threat model, the controls, the assurance case, compliance.
- [Evidence & runs](#evidence--runs): every live run, the evaluations, the hackathon submission.
- [Operations](#operations): install, run, release, recover.
- [Contributing](#contributing): how changes are made, decided and recorded.
- [History](#history): superseded documents, kept as they were.

## Product

### What it is and how it works

- [how-it-works.md](how-it-works.md): the code in five files, one payment end to end, and the worst case the policy allows.
- [in-depth.md](in-depth.md): the README's sections in full: what ran live with one id per rail, where each judging criterion is proven, Try step by step, what is real and what is mock; what is live and what is simulated, run by run: [in-depth.md](in-depth.md#whats-live-whats-simulated-run-by-run).
- [architecture.md](architecture.md): architecture, tooling and credits; where it runs: [architecture.md](architecture.md#where-it-runs).
- [diagrams.md](diagrams.md): Purser in five diagrams (who holds which limit, one payment end to end, the mandate on Alta, where it runs), drawn by GitHub from Mermaid.
- [finance-value.md](finance-value.md): for a CFO or finance reader: the invoice job step by step, measured cost and time per invoice, the controls mapped, the books, and what is not proven yet.
- [enterprise.md](enterprise.md): what a finance team gets beyond the demo, each with where to check it.
- [who-does-what.md](who-does-what.md): who does what: Purser, the rails and Claude, each with its part.
- [cfo-policy.md](cfo-policy.md): the CFO policy.
- [phone-approval.md](phone-approval.md): the dashboard and approval on a phone.
- [see-it.md](see-it.md), [gallery.md](gallery.md) and [charts.md](charts.md): the product in pictures, and the proof in charts drawn from the records.

### The agents

- [agents.md](agents.md): the Kit 11 agents: Claude decides inside the mandate, the rails enforce it.
- [claude.md](claude.md): how Purser uses Claude.
- [learning.md](learning.md): how the agents learn from the CFO's past decisions (in-context precedent; no model is trained).
- [ask-purser.md](ask-purser.md): a card for one task, from one sentence.
- [autopilot.md](autopilot.md): pending invoices one step forward, until a person is needed.
- [cards-and-clearing.md](cards-and-clearing.md): company cards, clearing and the simulated month.
- [kit11.md](kit11.md): the Starter Kit 11 flow, step by step, as run live once on 3 November.

### Connect your AI and other systems

- [mcp.md](mcp.md): **the MCP server reference**: connect Claude Code, Claude Desktop or any MCP client; every tool with its annotations; the resources, prompts and error codes; the safety model (read and propose only); how a proposal reaches the CFO.
- [connect-claude.md](connect-claude.md): every client's steps (Claude, ChatGPT, Cursor, VS Code, Gemini CLI, Windsurf), OAuth and token security; the short version is [connect-any-ai.md](connect-any-ai.md).
- [agent-api.md](agent-api.md): outside agents on the runner (the agent API, a separate MCP server for an agent's own company card) and the ERP export.
- [connections.md](connections.md): every connection to another system, each labelled live or format export.

### Purser Cloud, payables and the books (built after the kit)

Built after the hackathon kit, in a test environment with test money; each document says its own status.
[after-the-kit.md](after-the-kit.md) is the overview and where the code is; [built-after-the-kit.md](built-after-the-kit.md)
the longer list.

- [cloud.md](cloud.md): Purser Cloud, its API and what the hosted test cloud is.
- [payables.md](payables.md): the invoice inbox. [ledger.md](ledger.md): Purser's own books. [reconcile-books.md](reconcile-books.md): Purser's books next to the outside books.
- [vault.md](vault.md), [erp.md](erp.md) and [moneybird.md](moneybird.md): the document vault and the ERP connectors.
- [real-customers.md](real-customers.md): each company's own money account and books; behind flags that are off by default.
- [tokenize.md](tokenize.md): invoice tokens on Alta, a prototype; its run of 12 November is [runs/2026-11-12-tokenize.md](runs/2026-11-12-tokenize.md), its record template [tokenize-run-template.md](tokenize-run-template.md).
- [engine-events.md](engine-events.md): the engine's events for the hands-on page (the code wins).
- [e2e-live.md](e2e-live.md): three test companies, invoice to T:0.
- [go-live.md](go-live.md): what is open before real money.

### The rails and partners

- [airwallex.md](airwallex.md): the Airwallex APIs Purser calls, and why. [airwallex-centre.md](airwallex-centre.md): what was new on Airwallex on 14 November.
- [airwallex-approvals.md](airwallex-approvals.md): Airwallex's own approval workflow as a second lock, and money in by card.
- [airwallex-platform.md](airwallex-platform.md): connected accounts.
- [metal-award.md](metal-award.md): what Purser uses from Alta, and the proof on Alta testnet. [metal-review.md](metal-review.md): does Purser use metal-agent and metal-pay the way Alta intends?
- [t0.md](t0.md): Purser's books in T:0's ledger; the posting of 10 November is [runs/2026-11-10-t0-journal-sandbox.md](runs/2026-11-10-t0-journal-sandbox.md).
- [visa-award.md](visa-award.md): Visa Intelligent Commerce through Airwallex's Airi, in the sandbox; [visa-icc.md](visa-icc.md): Visa Intelligent Commerce Connect from public docs (access not granted, not used); [visa/](visa/) (the VIC work reviewed against Visa's published best practices) and [plans/](plans/) (design notes and research).
- [feedback-for-metal-and-airwallex.md](feedback-for-metal-and-airwallex.md): feedback for Alta and Airwallex.

### Business

- [business/README.md](business/README.md): the business case, a hypothesis: not validated with customers yet.
- [unit-economics.md](unit-economics.md): does each agent pay for itself? Measured numbers only.
- [roadmap-v2.md](roadmap-v2.md): the roadmap after the hackathon; what the project intends to do and not do in the next year is [ROADMAP.md](../ROADMAP.md).

## Security & compliance

- [security/README.md](security/README.md): **the security artefacts**: the software bill of materials and the supply-chain and static-analysis checks.
- [security.md](security.md): the threat model, the attacks and what stops each one.
- [security/requirements.md](security/requirements.md): what you can and cannot expect in terms of security: assumptions, secure design principles, the common weaknesses countered, hardening, input validation and cryptography.
- [security/openssf-silver.md](security/openssf-silver.md): the OpenSSF Best Practices silver criteria, one by one, with the evidence and what is still open.
- [zero-trust.md](zero-trust.md): the limits proven layer by layer, generated ([zero-trust/](zero-trust/)).
- [controls.md](controls.md): every control, how it works, and its evidence; [controls-matrix.md](controls-matrix.md): each risk, its control, its test and its evidence.
- [assurance.md](assurance.md): the assurance case: each invariant about money, the function that enforces it, its tests, the CI job and the record.
- [fraud-and-injection.md](fraud-and-injection.md): invoice fraud and prompt injection.
- [worst-case-ai.md](worst-case-ai.md): the worst-case AI test: Purser's AI replaced by a script that always says pay.
- [agent-was-wrong.md](agent-was-wrong.md): when the agent was wrong: what it wanted, what stopped it, what the CFO saw.
- [compliance.md](compliance.md): who does what, and how Purser supports it.
- [hardening.md](hardening.md): the hardening log, 30 October to the freeze on 4 November.
- [audit/README.md](audit/README.md): the audit log of the recorded run of 30 October.
- [accessibility.md](accessibility.md): accessibility (what the pages do and what CI checks) and internationalisation (English only).

## Evidence & runs

### Runs

- [runs/README.md](runs/README.md): every live run, newest first, with its ids and what was simulated; generated from the records.
- [runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md): the main run of 3 November, the one the site replays.
- [runs/](runs/): every run log, dated. Dated records are history: they keep the figures of their day.
- [proof/README.md](proof/README.md): the proof bundles /try hands over, so anyone can check a payment without trusting the server; [demo/](demo/): the run records the site's pages read.

### Evidence and evaluations

- [evidence/README.md](evidence/README.md): what the organisers answered, in our own words, and the verification reports; the evidence wall's source is [evidence/evidence-wall.json](evidence/evidence-wall.json).
- [evidence/coverage.md](evidence/coverage.md): test coverage of the whole product (statements and branches), its scope and how it was measured.
- [claims.md](claims.md): every number and factual claim, with where it comes from.
- [agent-evals.md](agent-evals.md) and [model-benchmark.md](model-benchmark.md): the three agents with real models, and which Claude model for which job; [agent-evals-ledger.md](agent-evals-ledger.md): evals of the ledger agents, generated.
- [agents-autonomy.md](agents-autonomy.md), [agents-autonomy-redteam.md](agents-autonomy-redteam.md) and [variation.md](variation.md): the autonomous agents: variation and safety, the red team, the holdouts.
- [/claude](https://kit11.max-31b.workers.dev/claude), measured, not asserted: the simulated worlds of the [night batch](runs/2026-11-02-night-batch.md), the [blind holdouts](runs/holdouts/2026-11-03-blind/results.md), each model on each agent ([evals/agents.json](evals/agents.json)) and the agent interface over MCP ([one session](runs/2026-11-12-mcp-transcript.json)).
- [redteam/report.json](redteam/report.json): the red team's report; [evals/](evals/): every evaluation's record.

### The hackathon submission

- [submission/README.md](submission/README.md): the submission text, with the short Description and the jury's instructions; the long form is [submission/long-description.md](submission/long-description.md), the Visa note [submission/long-description.md#visa](submission/long-description.md#visa).
- [requirements-matrix.md](requirements-matrix.md): what the hackathon asks for, where Purser does it, and the proof.
- [idea-vs-build.md](idea-vs-build.md): the idea as submitted on 24 October, promise by promise, against what is built.
- [rules.md](rules.md): the prize and judging rules, as checked on 29 October.
- The latest Airi run (Visa Intelligent Commerce, 14 November) is [runs/2026-11-14-vic-5.md](runs/2026-11-14-vic-5.md), the first [runs/2026-11-07-vic-1.md](runs/2026-11-07-vic-1.md).
- [video/README.md](video/README.md): the film's edit guide, its scenes and where each figure comes from; [video-script.md](video-script.md): which script, voice-over text and subtitles belong to the film.

## Operations

- [install.md](install.md): install, the five-minute quick start (no keys, offline), the development environment, and uninstall.
- [run-it.md](run-it.md): running it live, with sandbox keys and an Alta RPC.
- [runbook.md](runbook.md): incidents, the emergency stop, key rotation, recovery.
- [releasing.md](releasing.md): version numbers (SemVer from v1.2.0), signed tags, the attested release artefacts, how to verify them and how to upgrade; the release notes are [releases/v1.2.0.md](releases/v1.2.0.md) and [releases/v1.1-submission.md](releases/v1.1-submission.md).
- [repo-settings.md](repo-settings.md): the repository's settings on GitHub (About, social preview, releases, branch protection on main), for the owner to set by hand.

## Contributing

- [CONTRIBUTING.md](../CONTRIBUTING.md): before you open a pull request, the rules this repository keeps, coding style, tests with every change, and the sign-off (DCO).
- [GOVERNANCE.md](../GOVERNANCE.md): who decides, the roles, how changes and releases are made, how a second maintainer joins, continuity.
- [decisions.md](decisions.md): decisions taken during the build, each with its reason and its cost if wrong; [adr/README.md](adr/README.md): the same decisions as an index of architecture decision records (date, status, superseded by which), and the template for new ones.
- [SECURITY.md](../SECURITY.md): how to report a vulnerability, and how a report is handled.
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md): the code of conduct.

## History

- Dated records, kept where other documents cite them: [data-qa.md](data-qa.md) (the data check of the recorded run of 30 October; the main run's is [runs/2026-11-03-main-run-data-qa.md](runs/2026-11-03-main-run-data-qa.md)) and [metal-qa-2026-11-01-week.md](metal-qa-2026-11-01-week.md) (the Metal QA of 1 November).
- [archive/](archive/): kept for history; each file says what replaced it. Working files moved out of the docs root on
  13 November, kept as evidence because a test, a script or a run log still cites them:
  - [archive/superpowers/specs/](archive/superpowers/specs/): the design specs of 8 November for what was built after the kit.
  - [archive/readme-v2-draft.md](archive/readme-v2-draft.md): a generated draft of the README's structure (`npm run readme-draft`), not the README.
  - [archive/runs/](archive/runs/): two notes of the dry runs: the acceptance list (in Dutch) and the recycling of test money.
