# Test coverage: statements and branches, the whole product

Measured on 19 November 2026 for the OpenSSF Best Practices criterion `test_statement_coverage80` and the test
policy in [CONTRIBUTING.md](../../CONTRIBUTING.md#tests-come-with-the-change). The data: [coverage.json](coverage.json).

## How it was measured

- **Tool:** vitest 5.1.0 with `@vitest/coverage-v8` (V8's own coverage, mapped to statements and branches), the
  FLOSS test suite in `test/` with no network and no keys. Command: `npm run test:coverage` (CI runs it on every push
  to `main` and every pull request, job `test`).
- **Runs:** before, the branch as it was in the morning: 7,295 tests passed, 3 failed, 4 skipped (658 files). After, with the four test files
  added that day: 7,346 tests passed, 3 failed, 4 skipped (662 files). Both on a Linux machine with two workers; the three failures are explained
  below, and a test that failed still counts what it ran.
- **Scope, set in [vitest.config.ts](../../vitest.config.ts):** every TypeScript file under `src/` (the runner, its
  agents, the site's pages), `cloud/src/` (Purser Cloud) and `worker/src/` (the relay Worker), files no test loads
  included. Until 19 November CI measured `src/` alone.
- **Left out, and why:** `src/cli/` (148 files), the command-line entry points. They parse arguments and print
  around library functions that are measured (for example `src/cli/approve.ts` is 23 lines around
  `decide` and `execute`), or they record the dated live runs, which need sandbox keys and the partners; the npm
  scripts start them as separate processes, which coverage in the test process does not see. Also left out:
  generated files (`*.gen.ts`: fonts and logos) and type declarations. The figure with everything, `src/cli`
  included, is given beside it.
- **A floor:** `vitest.config.ts` now fails the run below 85% of statements or 75% of branches over the measured
  scope, and `test/coverage-areas.ts` still holds each money area at 90% of lines.

## The figures

| Scope | Files | Statements before | Statements after | Branches before | Branches after |
|---|---|---|---|---|---|
| The product (the measured scope): src, cloud/src and worker/src, without the CLI entry points and generated files | 740 | 88.5% (54,541 of 61,603) | **88.8%** (54,705 of 61,603) | 77.7% | **78.0%** |
| Everything under src, cloud/src and worker/src, the CLI entry points included | 900 | 76.6% (54,966 of 71,738) | **76.8%** (55,130 of 71,738) | 69.8% | **70.0%** |
| src/ only (CI's scope until 19 November) | 758 | 74.5% (45,822 of 61,549) | **74.7%** (45,985 of 61,549) | 68.0% | **68.2%** |
| cloud/src (Purser Cloud) | 120 | 89.9% (6,265 of 6,967) | **89.9%** (6,266 of 6,967) | 79.4% | **79.4%** |
| worker/src (the relay Worker) | 22 | 89.3% (2,879 of 3,222) | **89.3%** (2,879 of 3,222) | 82.2% | **82.2%** |
| src/cli (left out: the entry points) | 148 | 4.0% (410 of 10,120) | **4.0%** (410 of 10,120) | 3.5% | **3.5%** |

The new tests do not touch `src/cli`; its figure after is the one before.

## By area

| Area | Statements before | Statements after | Branches before | Branches after |
|---|---|---|---|---|
| money | 90.9% | 90.9% | 79.3% | 79.3% |
| policy | 92.8% | 92.9% | 85.3% | 85.7% |
| passkey | 92.6% | 93.8% | 88.1% | 89.2% |
| executors | 89.0% | 90.8% | 83.0% | 84.4% |
| relay | 89.7% | 89.7% | 82.1% | 82.1% |
| proof | 97.2% | 97.2% | 90.4% | 90.4% |
| audit and anchor | 81.8% | 81.8% | 68.4% | 68.4% |
| payouts | 86.8% | 86.8% | 84.6% | 84.6% |
| airwallex | 84.2% | 88.2% | 75.2% | 79.3% |
| alta (metal) | 84.0% | 86.3% | 76.5% | 78.5% |

## Tests added on 19 November

Each checks behaviour (what must happen and what must be refused), not lines; each was run on its own and
in the full suite.

| Test | Code | What it holds | Statements of that code, before → after |
|---|---|---|---|
| [executors-dispatch-guards.test.ts](../../test/executors-dispatch-guards.test.ts) | src/executors/index.ts | a pause whose chain step fails still freezes the card and fails the run; kinds that need Airwallex refuse without keys before their executor runs; the check against Airwallex's ledger after a payout never fails the payment | `index.ts` 71.9% → 85.6% |
| [pause-chain.test.ts](../../test/pause-chain.test.ts) | src/metal/pauseChain.ts | pausing revokes exactly the one bound mandate; resuming binds a fresh one with the old cap and payees and only what was left of the budget, never revives an expired one, and changes nothing when one is bound already | `pauseChain.ts` 1.7% → 100.0% |
| [airwallex-lookups.test.ts](../../test/airwallex-lookups.test.ts) | src/airwallex/adapter.ts, src/airwallex/batchTransfers.ts | after a lost answer, a conversion, a beneficiary or a batch is adopted only on an exact match, and a list Airwallex did not filter is refused rather than guessed from | `adapter.ts` 62.7% → 93.2%; `batchTransfers.ts` 74.8% → 89.3% |
| [batch-line-removal-refusals.test.ts](../../test/batch-line-removal-refusals.test.ts) | src/passkey/process.ts | taking a payment out of a batch on the phone is refused, with the batch left waiting, for every wrong submission | `process.ts` 91.5% → 94.2% |

## The largest gaps left in the measured scope

| File | Uncovered statements | Of |
|---|---|---|
| `src/approve/client.ts` | 831 | 1327 |
| `src/evals/agentFacts.ts` | 197 | 265 |
| `src/vault/statementPdf.ts` | 164 | 275 |
| `cloud/src/engine/hostWorker.ts` | 117 | 117 |
| `worker/src/trySign.ts` | 96 | 1047 |
| `src/film/capture.ts` | 96 | 197 |
| `src/film/uth.ts` | 88 | 88 |
| `src/metal/dashboardVsChain.ts` | 80 | 240 |
| `worker/src/index.ts` | 77 | 77 |
| `src/airi/vic3.ts` | 77 | 583 |
| `src/dashboard/snapshot.ts` | 71 | 657 |
| `cloud/src/worker.ts` | 71 | 71 |
| `src/evals/agentEvals.ts` | 67 | 79 |
| `src/redesign/run.ts` | 66 | 635 |
| `src/agents/treasury.ts` | 60 | 63 |

The largest, `src/approve/client.ts`, is the script of the CFO's phone pages: its pure functions (hashing the
terms, describing them, the runner-key checks) are unit-tested, and its page code (building the approval, enrolment
and policy screens in the browser) runs in the browser checks (`test/browser/*.check.ts`, CI job `judge`), which V8
coverage in the test process does not count.

## Limits of these figures

- Statement coverage says a line ran, not that its result was checked. The money areas have their own floors and
  the assurance case names the tests that check each invariant ([docs/assurance.md](../assurance.md)).
- The browser checks and the live runs are not in these figures.
- V8's mapping to statements can under-count a line that ran (for example a `return` inside a callback that
  better-sqlite3 runs as a transaction); the figures are what the tool reports, not corrected by hand.
- The three failures in both runs touch no measured code. Two are `test/cloud-engine-bundle.test.ts`, which bundles
  the Worker and on the measuring machine found the dependencies through a linked `node_modules` outside the
  checkout, so its paths and size differ (it passes in CI). One is the link check in `test/data-consistency.test.ts`:
  the documents that link to this page and to openssf-silver.md were written before these pages existed; with them
  in place it passes.
