# The docs, by reader

Back to the [README](../README.md). Test money only throughout: the Airwallex sandbox and Metal testnet.

## Juror

- [submission/README.md](submission/README.md): the submission text, with the short Description and the jury's instructions.
- [submission/long-description.md](submission/long-description.md): the long form text, with the separate live tests.
- [claims.md](claims.md): every number and factual claim, with where it comes from.
- [runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md): the main run of 3 November, the one the site replays.
- [runs/](runs/): every run log, dated, including awx-1 and the Airi run of 7 November.
- [airwallex.md](airwallex.md): every Airwallex API Purser calls, and why.
- [metal-award.md](metal-award.md): what Purser uses from Metal, and the proof on Metal testnet.
- [/claude](https://kit11.max-31b.workers.dev/claude), measured, not asserted: the 40 simulated worlds ([night batch](runs/2026-11-02-night-batch.md)), the [blind holdouts](runs/holdouts/2026-11-03-blind/results.md), each model on each agent ([evals/agents.json](evals/agents.json)) and the agent interface over MCP ([one session](runs/2026-11-12-mcp-transcript.json)).
- [t0.md](t0.md) and [/t0](https://kit11.max-31b.workers.dev/t0): Purser's books in T:0's ledger; the posting of 10 November is [runs/2026-11-10-t0-journal-sandbox.md](runs/2026-11-10-t0-journal-sandbox.md).
- [submission/long-description.md#visa](submission/long-description.md#visa): the Visa TAP note; the Airi run (Visa Intelligent Commerce) is in [runs/2026-11-07-vic-1.md](runs/2026-11-07-vic-1.md).
- [business/README.md](business/README.md): the business case, a hypothesis not yet validated with customers.
- [after-the-kit.md](after-the-kit.md): what was built after the kit (the payables inbox, connected accounts) and where its code is in this repository; tested against stand-ins, with sandbox runs on 10 November; the hosted preview is private, no customer uses it; not part of the Kit 11 runs.

## Builder

- [architecture.md](architecture.md): architecture, tooling and credits.
- [run-it.md](run-it.md): running it live, with sandbox keys and a Metal RPC.
- [security.md](security.md): the threat model, the attacks and what stops each one.
- [controls.md](controls.md): every control, how it works, and its evidence.
- [runbook.md](runbook.md): incidents, the emergency stop, key rotation, recovery.
- [decisions.md](decisions.md): decisions taken during the build, each with its reason and its cost if wrong.

## Video

- [video/README.md](video/README.md): the film's edit guide, its scenes and where each figure comes from.

Not part of the submission: [internal/](internal/README.md), working notes for the owner.
