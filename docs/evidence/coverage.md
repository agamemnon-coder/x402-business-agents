# Test coverage: statements and branches, the whole product

Measured on 19 November 2026 for the OpenSSF Best Practices criteria `test_statement_coverage80` (silver),
`test_statement_coverage90` and `test_branch_coverage80` (gold), and the test policy in
[CONTRIBUTING.md](../../CONTRIBUTING.md#tests-come-with-the-change). The data: [coverage.json](coverage.json).

**The product now: 91.1% of statements (63,436 of 69,654) and 80.6% of branches (47,285 of 58,685), in 809 files.**

## How it was measured

- **Tool:** vitest 5.1.0 with `@vitest/coverage-v8` (V8's own coverage, mapped to statements and branches), the
  FLOSS test suite in `test/` with no network and no keys. Command: `npm run test:coverage` (CI runs it on every push
  to `main` and every pull request, job `test`).
- **Runs:** before, the record of the morning of 19 November: 7,346 tests passed, 3 failed, 4 skipped (662 files).
  After, on the evening's last commit of the branch, with the tests added that day: 8,338 tests passed, 1 failed,
  5 skipped (761 files), on a Linux machine with four cores shared with other jobs (a 90-second test timeout). The
  one failure is explained below; a test that failed still counts what it ran.
- **The product grew in between.** Main was merged into the branch during the day: 167 source files changed, and the
  measured scope went from 740 files and 61,603 statements to 809 files and 69,654 statements. "Before" is the
  morning's record as it was measured; "after" is the product as it is now, every file in it included, the new ones
  too. (An interim measurement on 19 November, docs/security/openssf-gold.md, had 88.75% of 66,498 statements and
  77.7% of branches, on 771 files.)
- **Scope, set in [vitest.config.ts](../../vitest.config.ts):** every TypeScript file under `src/` (the runner, its
  agents, the site's pages), `cloud/src/` (Purser Cloud) and `worker/src/` (the relay Worker), files no test loads
  included. Until 19 November CI measured `src/` alone.
- **Left out, and why:** `src/cli/` (165 files), the command-line entry points. They parse arguments and print
  around library functions that are measured (for example `src/cli/approve.ts` is 23 lines around
  `decide` and `execute`), or they record the dated live runs, which need sandbox keys and the partners; the npm
  scripts start them as separate processes, which coverage in the test process does not see. Also left out:
  generated files (`*.gen.ts`: fonts and logos) and type declarations. The figure with everything, `src/cli`
  included, is given beside it.
- **A floor:** `vitest.config.ts` fails the run below 88% of statements or 78% of branches over the measured
  scope (85% and 75% until this record), and `test/coverage-areas.ts` still holds each money area at 90% of lines.
- **No line is left out by hand:** no `istanbul ignore` or `c8 ignore` was added; every figure is what the tool reports.

## The figures

| Scope | Files | Statements before | Statements after | Branches before | Branches after |
|---|---|---|---|---|---|
| The product (the measured scope): src, cloud/src and worker/src, without the CLI entry points and generated files | 740 → 809 | 88.8% (54,705 of 61,603) | **91.1% (63,436 of 69,654)** | 78.0% | **80.6%** |
| Everything under src, cloud/src and worker/src, the CLI entry points included | 900 → 974 | 76.8% (55,130 of 71,738) | **79.2% (63,956 of 80,786)** | 70.0% | **72.4%** |
| src/ only (CI's scope until 19 November) | 758 → 839 | 74.7% (45,985 of 61,549) | **77.0% (54,223 of 70,370)** | 68.2% | **70.4%** |
| cloud/src (Purser Cloud) | 120 → 112 | 89.9% (6,266 of 6,967) | **93.0% (6,647 of 7,151)** | 79.4% | **83.8%** |
| worker/src (the relay Worker) | 22 → 23 | 89.3% (2,879 of 3,222) | **94.5% (3,086 of 3,265)** | 82.2% | **89.0%** |
| src/cli (left out: the entry points) | 148 → 165 | 4.0% (410 of 10,120) | **4.7% (520 of 11,132)** | 3.5% | **4.3%** |

## By area

Each area is the files whose path starts with one of its prefixes (the record names them). An area that grew is
measured as it is now: `proof` holds a seventh file since the morning, larger than the six before it together,
and its branches are covered less than the old six (73.8% after, 90.4% before).

| Area | Prefixes | Statements before | Statements after | Branches before | Branches after |
|---|---|---|---|---|---|
| money | `src/lib/money`, `src/finance/`, `src/agents/euroBill`, `src/agents/sweep`, `src/metal/pay`, `src/executors/refunds`, `src/executors/invoicePayment` | 90.9% | 93.8% | 79.3% | 84.1% |
| policy | `src/policy/` | 92.9% | 96.0% | 85.7% | 91.7% |
| passkey | `src/passkey/` | 93.8% | 94.0% | 89.2% | 89.2% |
| executors | `src/executors/` | 90.8% | 91.5% | 84.4% | 85.5% |
| relay | `src/relay/`, `worker/src/` | 89.7% | 94.6% | 82.1% | 88.7% |
| proof | `src/proof/` | 97.2% | 94.2% | 90.4% | 73.8% |
| audit and anchor | `src/audit/`, `src/anchor/` | 81.8% | 98.5% | 68.4% | 92.8% |
| payouts | `src/payouts/` | 86.8% | 90.3% | 84.6% | 90.2% |
| airwallex | `src/airwallex/` | 88.2% | 91.1% | 79.3% | 81.1% |
| alta (metal) | `src/metal/` | 86.3% | 89.4% | 78.5% | 80.2% |

## Tests added on 19 November

Each checks behaviour (what must happen and what must be refused), not lines; each was run on its own and in the
full suite. In the morning:

| Test | Code | What it holds | Statements of that code, before → after |
|---|---|---|---|
| [executors-dispatch-guards.test.ts](../../test/executors-dispatch-guards.test.ts) | src/executors/index.ts | a pause whose chain step fails still freezes the card and fails the run; kinds that need Airwallex refuse without keys before their executor runs; the check against Airwallex's ledger after a payout never fails the payment | `index.ts` 71.9% → 85.6% |
| [pause-chain.test.ts](../../test/pause-chain.test.ts) | src/metal/pauseChain.ts | pausing revokes exactly the one bound mandate; resuming binds a fresh one with the old cap and payees and only what was left of the budget, never revives an expired one, and changes nothing when one is bound already | `pauseChain.ts` 1.7% → 100.0% |
| [airwallex-lookups.test.ts](../../test/airwallex-lookups.test.ts) | src/airwallex/adapter.ts, src/airwallex/batchTransfers.ts | after a lost answer, a conversion, a beneficiary or a batch is adopted only on an exact match, and a list Airwallex did not filter is refused rather than guessed from | `adapter.ts` 62.7% → 93.2%; `batchTransfers.ts` 74.8% → 89.3% |
| [batch-line-removal-refusals.test.ts](../../test/batch-line-removal-refusals.test.ts) | src/passkey/process.ts | taking a payment out of a batch on the phone is refused, with the batch left waiting, for every wrong submission | `process.ts` 91.5% → 94.2% |

During the day, 42 more test files in 40 commits (`git log --grep "^Tests:"`), on the payables and agents' evals
with a scripted model, the dashboard's feed and rails, Purser Cloud's agents, insights and Worker entry, the
reconciliation, holds, batches, payee changes, four eyes, second keys, the audit report and the live world's
verdict. Two of them found bugs, fixed with the test first: Purser Cloud's agent cards answered a 500 when the card
gateway threw while a card was read (now: no live answer, said so; `cloud/src/agentCards.ts`), and the phone's
approval page crashed on an `owners_execute` whose deadline was no time (`src/approve/client.ts`).

In the evening, on the code with the most uncovered statements and branches in money, policy, passkey, relay and
cloud:

| Test | Code | What it holds | Statements of that code, before → after |
|---|---|---|---|
| [relay-worker-entry.test.ts](../../test/relay-worker-entry.test.ts) | worker/src/index.ts | every outside path reaches its own Durable Object instance; the Airwallex read gateway and the try-sign spend are not reachable from outside; /status says when its checks cannot be read; each desk without a key or with its switch off makes no call | 0% → 92.9% |
| [cloud-engine-host-worker.test.ts](../../test/cloud-engine-host-worker.test.ts) | cloud/src/engine/hostWorker.ts | a company's engine in its Durable Object opens only for a known company, seeds the bank once and keeps it, archives under the company only; a /try company's quote is asked of the binding | 0% → 65.0% |
| [treasury-price-rise-proposals.test.ts](../../test/treasury-price-rise-proposals.test.ts) | src/agents/treasury.ts | one proposal per option with the same steps, shrinking first under the 20.00 total; each step names the bound and the new credential; after a pause, the budget on chain and the spend before it | 4.8% → 98.4% |
| [dashboard-vs-chain-reader.test.ts](../../test/dashboard-vs-chain-reader.test.ts) | src/metal/dashboardVsChain.ts | only this ledger's credentials are read in a shared keys directory; a refused block range is halved with no gap; a node that refuses one block is said, without its URL | 66.7% → 98.8% |
| [try-sign-registration-refusals.test.ts](../../test/try-sign-registration-refusals.test.ts) | worker/src/trySign.ts | each wrong passkey registration refused with its own reason; malformed bytes are "malformed", never an exception; the CBOR reader refuses what it does not support | 90.8% → 93.8% |
| [awx-gateway-desk-edges.test.ts](../../test/awx-gateway-desk-edges.test.ts) | worker/src/awxGateway.ts | writes off and no key refused before any call; the token reused, renewed once on a 401; an unanswered POST is ambiguous and not resent | 73.7% → 98.2% |
| [awx-payout-client-edges.test.ts](../../test/awx-payout-client-edges.test.ts) | worker/src/awxPayout.ts | a refused login makes no call; a create with no answer or a 5xx is ambiguous, a 4xx refused; an answer without a plain id is no transfer | 87.9% → 96.6% |
| [mandate-plan-refusals.test.ts](../../test/mandate-plan-refusals.test.ts) | src/policy/mandates.ts | a mandate plan is refused for every shape it cannot run safely | 82.1% → 100% |
| [sweep-resume.test.ts](../../test/sweep-resume.test.ts) | src/agents/sweep.ts | a paid sweep finished after a crash: finality once, the credit locked once, the deposit booked once | 82.0% → 94.5% |
| [anchor-edges.test.ts](../../test/anchor-edges.test.ts) | src/anchor/ | the anchor's chain port on Alta; sources that are not what they say refused; each line a check fails on; the Merkle calldata's exact form | metalChain.ts 0% → 100% |
| [audit-chain-breaks.test.ts](../../test/audit-chain-breaks.test.ts) | src/audit/log.ts | the chain checks name the first row that breaks it | 91.1% → 100% |

The "before" of the evening's files is the morning's record where it lists the file (`index.ts`, `hostWorker.ts`,
`treasury.ts`, `dashboardVsChain.ts`, `trySign.ts`); else a run of the tests that import the file, made before its
evening test was added (`awxGateway.ts` after the Worker entry test, which reaches its first refusal; `awxPayout.ts`,
`mandates.ts`, `sweep.ts`, `log.ts`), a lower bound, since other tests can reach a file through another.
To run `worker/src/index.ts` and `cloud/src/engine/hostWorker.ts` in Node, `vitest.config.ts` now reads `.sql` files
as text (as the Worker's bundle does) and resolves the git-ignored, built `worker/src/pages.gen.ts` to an empty set of
pages when it is not built; Cloudflare's runtime module and pdfkit's browser-only font call are stood in for in those
two tests.

## The largest gaps left in the measured scope

| File | Uncovered statements | Of | Uncovered branches |
|---|---|---|---|
| `src/approve/client.ts` | 817 | 1329 | 643 |
| `src/film/capture.ts` | 96 | 197 | 53 |
| `src/evals/adversarialV2.ts` | 80 | 168 | 100 |
| `src/fuzz/run.ts` | 79 | 101 | 84 |
| `src/chaos/report.ts` | 78 | 80 | 39 |
| `src/e2e/airwallexSoakRecord.ts` | 78 | 78 | 80 |
| `src/airi/vic3.ts` | 77 | 583 | 164 |
| `src/fuzz/properties.ts` | 70 | 436 | 69 |
| `src/redesign/run.ts` | 66 | 635 | 317 |
| `worker/src/trySign.ts` | 65 | 1047 | 129 |
| `src/redesign/proof.ts` | 58 | 293 | 144 |
| `src/demo/runTrace.ts` | 54 | 60 | 28 |
| `src/servers/dashboard.ts` | 54 | 317 | 30 |
| `src/finance/dataQa.ts` | 48 | 315 | 112 |
| `src/airwallex/routedRail.ts` | 47 | 213 | 42 |

The largest, `src/approve/client.ts`, is the script of the CFO's phone pages: its pure functions (hashing the
terms, describing them, the runner-key checks) are unit-tested, and its page code (building the approval, enrolment
and policy screens in the browser) runs in the browser checks (`test/browser/*.check.ts`, CI job `judge`), which V8
coverage in the test process does not count; the test process has no DOM. `src/film/capture.ts` drives Chromium and
ffmpeg; the rest are recorders and harnesses of dated runs (fuzz, chaos, soak, evals) and the site's page builders.

## Limits of these figures

- Statement coverage says a line ran, not that its result was checked. The money areas have their own floors and
  the assurance case names the tests that check each invariant ([docs/assurance.md](../assurance.md)).
- The browser checks and the live runs are not in these figures.
- V8's mapping to statements can under-count a line that ran (for example a `return` inside a callback that
  better-sqlite3 runs as a transaction); the figures are what the tool reports, not corrected by hand.
- The one failure in the evening's run touches no measured code: `test/cloud-engine-bundle.test.ts` bundles the
  Worker and on the measuring machine found the dependencies through a linked `node_modules` outside the checkout,
  so a dynamic import inside a dependency counted as the repository's own (it passes in CI). Under the machine's
  load, one property test (`test/property-policy-text.test.ts`) once took longer than 90 seconds in a partial run; it
  passed in this one and on its own.
