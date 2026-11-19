# Test coverage: statements and branches, the whole product

Measured on 19 November 2026 for the OpenSSF Best Practices criteria `test_statement_coverage80` (silver),
`test_statement_coverage90` and `test_branch_coverage80` (gold), and the test policy in
[CONTRIBUTING.md](../../CONTRIBUTING.md#tests-come-with-the-change). The data: [coverage.json](coverage.json).

**The product now: 91.7% of statements (64,948 of 70,834) and 81.4% of branches (48,611 of 59,703), in 828 files.**

## How it was measured

- **Tool:** vitest 5.1.0 with `@vitest/coverage-v8` (V8's own coverage, mapped to statements and branches), the
  FLOSS test suite in `test/` with no network and no keys. Command: `npm run test:coverage` (CI runs it on every push
  to `main` and every pull request, job `test`).
- **Runs:** before, the record of the evening of 19 November (commit 5488248a5): 8,338 tests passed, 1 failed,
  5 skipped (761 files). After, late that evening on the last commit of the second round, with its tests: 8,534 tests
  passed, 2 failed, 5 skipped (781 files), on a Linux machine with four cores shared with other jobs (a 90-second test
  timeout), one run over every file under the three folders, `src/cli` included; the product's figure is that run
  without `src/cli` and generated files, as `vitest.config.ts` measures it. The failures are explained below; a test
  that failed still counts what it ran.
- **The product grew in between.** 49 commits reached the branch the second round started from: 49 product files
  changed, 20 of them new, and the measured scope went from 809 files and 69,654 statements to 828 files and 70,834.
  "Before" is the previous record as it was measured; "after" is the product as it is now, every file in it included.
  The earlier history: 88.8% of 61,603 statements and 78.0% of branches on the morning of 19 November (740 files);
  an interim 88.75% of 66,498 and 77.7% (771 files, docs/security/openssf-gold.md); 91.1% of 69,654 and 80.6% that
  evening (809 files).
- **Scope, set in [vitest.config.ts](../../vitest.config.ts):** every TypeScript file under `src/` (the runner, its
  agents, the site's pages), `cloud/src/` (Purser Cloud) and `worker/src/` (the relay Worker), files no test loads
  included. Until 19 November CI measured `src/` alone.
- **Left out, and why:** `src/cli/` (167 files), the command-line entry points. They parse arguments and print
  around library functions that are measured (for example `src/cli/approve.ts` is 23 lines around
  `decide` and `execute`), or they record the dated live runs, which need sandbox keys and the partners; the npm
  scripts start them as separate processes, which coverage in the test process does not see. Also left out:
  generated files (`*.gen.ts`: fonts and logos) and type declarations. The figure with everything, `src/cli`
  included, is given beside it.
- **A floor:** `vitest.config.ts` fails the run below 89% of statements or 79% of branches over the measured
  scope, two points under this record (88% and 78% after the evening's record, 85% and 75% before it), and
  `test/coverage-areas.ts` still holds each money area at 90% of lines.
- **No line is left out by hand:** no `istanbul ignore` or `c8 ignore` was added; every figure is what the tool reports.

## The figures

| Scope | Files | Statements before | Statements after | Branches before | Branches after |
|---|---|---|---|---|---|
| The product (the measured scope): src, cloud/src and worker/src, without the CLI entry points and generated files | 809 → 828 | 91.1% (63,436 of 69,654) | **91.7% (64,948 of 70,834)** | 80.6% | **81.4%** |
| Everything under src, cloud/src and worker/src, the CLI entry points included | 974 → 995 | 79.2% (63,956 of 80,786) | **79.8% (65,468 of 82,054)** | 72.4% | **73.2%** |
| src/ only (CI's scope until 19 November) | 839 → 854 | 77.0% (54,223 of 70,370) | **77.7% (55,276 of 71,143)** | 70.4% | **71.3%** |
| cloud/src (Purser Cloud) | 112 → 116 | 93.0% (6,647 of 7,151) | **93.0% (6,880 of 7,400)** | 83.8% | **83.9%** |
| worker/src (the relay Worker) | 23 → 25 | 94.5% (3,086 of 3,265) | **94.3% (3,312 of 3,511)** | 89.0% | **88.8%** |
| src/cli (left out: the entry points) | 165 → 167 | 4.7% (520 of 11,132) | **4.6% (520 of 11,220)** | 4.3% | **4.2%** |

## By area

Each area is the files whose path starts with one of its prefixes (the record names them). "Before" is the previous
record (the evening of 19 November). The `proof` area's branches, 73.8% in it (a seventh file, `awxDeepLive.ts`, larger
than the six before it together, with its refusal paths untested), are 81.9% now.

| Area | Prefixes | Statements before | Statements after | Branches before | Branches after |
|---|---|---|---|---|---|
| money | `src/lib/money`, `src/finance/`, `src/agents/euroBill`, `src/agents/sweep`, `src/metal/pay`, `src/executors/refunds`, `src/executors/invoicePayment` | 93.8% | 93.8% | 84.1% | 84.1% |
| policy | `src/policy/` | 96.0% | 96.2% | 91.7% | 92.0% |
| passkey | `src/passkey/` | 94.0% | 94.0% | 89.2% | 89.2% |
| executors | `src/executors/` | 91.5% | 91.5% | 85.5% | 85.5% |
| relay | `src/relay/`, `worker/src/` | 94.6% | 94.4% | 88.7% | 88.4% |
| proof | `src/proof/` | 94.2% | 96.0% | 73.8% | 81.9% |
| audit and anchor | `src/audit/`, `src/anchor/` | 98.5% | 98.5% | 92.8% | 93.1% |
| payouts | `src/payouts/` | 90.3% | 90.3% | 90.2% | 90.2% |
| airwallex | `src/airwallex/` | 91.1% | 91.0% | 81.1% | 80.9% |
| alta (metal) | `src/metal/` | 89.4% | 89.5% | 80.2% | 80.3% |

The areas that moved by a tenth without a test of this round (relay, airwallex) moved with the code merged in between.

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

Late in the evening, a second round, on the files with the most uncovered statements and on the `proof` area's
branches:

| Test | Code | What it holds | Statements (branches) of that code, before → after |
|---|---|---|---|
| [approve-client-session.test.ts](../../test/approve-client-session.test.ts) | src/approve/client.ts | the phone page keeps the viewer and runner keys a link brings and takes them out of the address bar; `api()` sends the viewer key, signs in with the passkey once before a CFO action when the relay said there is no session, or once after a 401 asking for one, and never prompts twice for one action; the passkey's wire form and error words | 38.5% → 43.3% (51.0% → 57.1%) |
| [chaos-report.test.ts](../../test/chaos-report.test.ts) | src/chaos/report.ts | the money chaos report's totals, end states, invariants held and broken, canaries caught and by which invariant, findings with their repro, and why approvals sat silent | 2.5% → 100% (0% → 89.7%) |
| [airwallex-soak-record.test.ts](../../test/airwallex-soak-record.test.ts) | src/e2e/airwallexSoakRecord.ts | the soak's record: its counts, the band figures it says it would move, the refusal rows the band's walk finds, and its Markdown for matches, mismatches, errors, conversions, negative controls and an early stop | 0% → 100% (0% → 100%) |
| [fuzz-run-report.test.ts](../../test/fuzz-run-report.test.ts) | src/fuzz/run.ts | a failing property is kept shrunk with the seed and path that replay it; the field-by-field sweep of a committed bundle and receipt finds no forgery; the report's totals and findings | 21.8% → 91.1% (13.4% → 86.6%) |
| [adversarial-report.test.ts](../../test/adversarial-report.test.ts) | src/evals/adversarialV2.ts | the adversarial eval's report on a real run of one case per category and with misses planted: every miss with its kind, the wrong payments in short, the before and after columns | 52.4% → 99.4% (37.1% → 92.5%) |
| [airwallex-deep-paths.test.ts](../../test/airwallex-deep-paths.test.ts) | src/proof/awxDeepLive.ts | Airwallex-deeper's paths besides the clean one: a revoke-only second pass, terms not accepted, no payment link, no EUR Global Account, a deposit never seen, no card with Purser's limits, a card list that cannot be had, no statement, a refused clean-up; each a row, never a throw, and said in the record | 90.9% → 97.1% (57.6% → 81.4%) |

The "before" of the second round is the previous record where it lists the file; for `awxDeepLive.ts`, a run of the
tests that import it, made before its test was added. To test `api()` and the sign-in, seven functions of
`src/approve/client.ts` are now exported (`api`, `passkeySignIn`, the two passkey serializers, `passkeyError`,
`parsedOrEmpty`, `lineAccount`), unchanged; the test stands in for `fetch`, `location`, `history`, storage and the
passkey prompt, not for a page. No bug was found in this round.

## The largest gaps left in the measured scope

| File | Uncovered statements | Of | Uncovered branches |
|---|---|---|---|
| `src/approve/client.ts` | 755 | 1332 | 565 |
| `src/film/capture.ts` | 96 | 197 | 53 |
| `src/airi/vic3.ts` | 77 | 583 | 164 |
| `src/fuzz/properties.ts` | 70 | 436 | 69 |
| `src/redesign/run.ts` | 66 | 635 | 317 |
| `worker/src/trySign.ts` | 65 | 1047 | 129 |
| `src/redesign/proof.ts` | 58 | 293 | 144 |
| `src/demo/runTrace.ts` | 54 | 60 | 28 |
| `src/servers/dashboard.ts` | 54 | 317 | 30 |
| `src/finance/dataQa.ts` | 48 | 315 | 112 |
| `src/airwallex/routedRail.ts` | 47 | 213 | 42 |
| `src/film/captions.ts` | 44 | 102 | 27 |
| `src/world/runtime.ts` | 44 | 55 | 18 |
| `src/servers/payables.ts` | 43 | 337 | 38 |
| `src/servers/seller.ts` | 43 | 128 | 47 |

The largest, `src/approve/client.ts`, is the script of the CFO's phone pages: its pure functions (hashing the
terms, describing them, the runner-key checks, the relay calls and the passkey sign-in) are unit-tested, and its page code (building the approval, enrolment
and policy screens in the browser) runs in the browser checks (`test/browser/*.check.ts`, CI job `judge`), which V8
coverage in the test process does not count; the test process has no DOM, and no DOM library (happy-dom, jsdom) is among the project's dependencies.
`src/film/capture.ts` drives Chromium and ffmpeg; the rest are the site's page builders, the demo's companion record
(`runTrace.ts`, which needs the main run's own ledger), servers and recorders of dated runs.

## Limits of these figures

- Statement coverage says a line ran, not that its result was checked. The money areas have their own floors and
  the assurance case names the tests that check each invariant ([docs/assurance.md](../assurance.md)).
- The browser checks and the live runs are not in these figures.
- V8's mapping to statements can under-count a line that ran (for example a `return` inside a callback that
  better-sqlite3 runs as a transaction); the figures are what the tool reports, not corrected by hand.
- The failures in the runs touch no measured code: `test/cloud-engine-bundle.test.ts` bundles the Worker and on the
  measuring machine finds the dependencies through a linked `node_modules` outside the checkout, so a dynamic import
  inside a dependency counted as the repository's own and the bundle came out 33 KB over its 12 MB bound (1 test in the
  evening's run, 2 in this one; it passes in CI). Vitest writes no coverage report after a failed test unless asked
  (`--coverage.reportOnFailure`); the second round's first full run was therefore repeated with it, on the same commit.
