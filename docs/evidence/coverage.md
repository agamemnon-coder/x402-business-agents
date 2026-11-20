# Test coverage: statements and branches, the whole product

Measured on 20 November 2026 (the previous records: 19 November) for the OpenSSF Best Practices criteria `test_statement_coverage80` (silver),
`test_statement_coverage90` and `test_branch_coverage80` (gold), and the test policy in
[CONTRIBUTING.md](../../CONTRIBUTING.md#tests-come-with-the-change). The data: [coverage.json](coverage.json).

**The product now: 92.0% of statements (65,458 of 71,122) and 81.9% of branches (49,091 of 59,929), in 830 files.**

**Which run these figures are from.** One coverage run on commit `8d50fc19c` (the third round's tests; this record was
committed on top of it in `53183c8e5`, which changes no code or test): `npx vitest run --coverage
--coverage.reportOnFailure` with a 90-second test timeout, on a Linux machine with four cores shared with other jobs
and `node_modules` linked from outside the checkout, not CI. Its result: 8,659 tests passed, 1 failed (the local-only
failure under [Limits](#limits-of-these-figures)) and 5 skipped, in 791 files. It is **not** the run behind the
suite's count: that is a separate, later full run without coverage, on commit `1ef28d9fa` (8,845 passed, 0 failed, 5
skipped, in 814 files; [test-summary.json](../assets/test-summary.json)). No script in the repository writes this
record from a coverage report, so it was not rebuilt after that count; it stays the record of this earlier run, and
the coverage badge names its commit. The same facts, as data: `run` in [coverage.json](coverage.json).

## How it was measured

- **Tool:** vitest 5.1.0 with `@vitest/coverage-v8` (V8's own coverage, mapped to statements and branches), the
  FLOSS test suite in `test/` with no network and no keys. Command: `npm run test:coverage` (CI runs it on every push
  to `main` and every pull request, job `test`).
- **Runs:** before, the record of the late evening of 19 November (commit 98ea941ab): 8,534 tests passed, 2 failed,
  5 skipped (781 files). After, on 20 November on the commit of the third round, with its tests: 8,659 tests passed,
  1 failed, 5 skipped (791 files), on a Linux machine with four cores shared with other jobs (a 90-second test
  timeout), one run over every file under the three folders, `src/cli` included; the product's figure is that run
  without `src/cli` and generated files, as `vitest.config.ts` measures it. The failure is explained below; a test
  that failed still counts what it ran.
- **The product grew in between.** 26 commits reached the branch the third round started from (`main` at c5b893ecf):
  21 product files changed, 2 of them new, and the measured scope went from 828 files and 70,834 statements to 830
  files and 71,122. "Before" is the previous record as it was measured; "after" is the product as it is now, every
  file in it included. The earlier history: 88.8% of 61,603 statements and 78.0% of branches on the morning of
  19 November (740 files); an interim 88.75% of 66,498 and 77.7% (771 files, docs/security/openssf-gold.md); 91.1% of
  69,654 and 80.6% that evening (809 files); 91.7% of 70,834 and 81.4% late that evening (828 files).
- **Scope, set in [vitest.config.ts](../../vitest.config.ts):** every TypeScript file under `src/` (the runner, its
  agents, the site's pages), `cloud/src/` (Purser Cloud) and `worker/src/` (the relay Worker), files no test loads
  included. Until 19 November CI measured `src/` alone.
- **Left out, and why:** `src/cli/` (168 files), the command-line entry points. They parse arguments and print
  around library functions that are measured (for example `src/cli/approve.ts` is 23 lines around
  `decide` and `execute`), or they record the dated live runs, which need sandbox keys and the partners; the npm
  scripts start them as separate processes, which coverage in the test process does not see. Also left out:
  generated files (`*.gen.ts`: fonts and logos) and type declarations. The figure with everything, `src/cli`
  included, is given beside it.
- **A floor:** `vitest.config.ts` fails the run below 90% of statements or 79% of branches over the measured
  scope, two points under this record, rounded down (89% and 79% after the late evening's record of 19 November, 88%
  and 78% after the evening's, 85% and 75% before it), and
  `test/coverage-areas.ts` still holds each money area at 90% of lines.
- **No line is left out by hand:** no `istanbul ignore` or `c8 ignore` was added; every figure is what the tool reports.

## The figures

| Scope | Files | Statements before | Statements after | Branches before | Branches after |
|---|---|---|---|---|---|
| The product (the measured scope): src, cloud/src and worker/src, without the CLI entry points and generated files | 828 → 830 | 91.7% (64,948 of 70,834) | **92.0% (65,458 of 71,122)** | 81.4% | **81.9%** |
| Everything under src, cloud/src and worker/src, the CLI entry points included | 995 → 998 | 79.8% (65,468 of 82,054) | **80.1% (65,978 of 82,369)** | 73.2% | **73.7%** |
| src/ only (CI's scope until 19 November) | 854 → 857 | 77.7% (55,276 of 71,143) | **78.1% (55,786 of 71,458)** | 71.3% | **71.8%** |
| cloud/src (Purser Cloud) | 116 | 93.0% (6,880 of 7,400) | **93.0% (6,880 of 7,400)** | 83.9% | **83.9%** |
| worker/src (the relay Worker) | 25 | 94.3% (3,312 of 3,511) | **94.3% (3,312 of 3,511)** | 88.8% | **88.8%** |
| src/cli (left out: the entry points) | 167 → 168 | 4.6% (520 of 11,220) | **4.6% (520 of 11,247)** | 4.2% | **4.2%** |

## By area

Each area is the files whose path starts with one of its prefixes (the record names them). "Before" is the previous
record (the late evening of 19 November). The `money` area's branches, 84.1% in it, are 90.2% now: its largest gap,
Data QA (`src/finance/dataQa.ts`), had its Airwallex payments and its report's sections untested.

| Area | Prefixes | Statements before | Statements after | Branches before | Branches after |
|---|---|---|---|---|---|
| money | `src/lib/money`, `src/finance/`, `src/agents/euroBill`, `src/agents/sweep`, `src/metal/pay`, `src/executors/refunds`, `src/executors/invoicePayment` | 93.8% | 96.8% | 84.1% | 90.2% |
| policy | `src/policy/` | 96.2% | 96.0% | 92.0% | 91.9% |
| passkey | `src/passkey/` | 94.0% | 94.0% | 89.2% | 89.2% |
| executors | `src/executors/` | 91.5% | 91.5% | 85.5% | 85.5% |
| relay | `src/relay/`, `worker/src/` | 94.4% | 94.4% | 88.4% | 88.4% |
| proof | `src/proof/` | 96.0% | 96.0% | 81.9% | 81.9% |
| audit and anchor | `src/audit/`, `src/anchor/` | 98.5% | 98.3% | 93.1% | 92.6% |
| payouts | `src/payouts/` | 90.3% | 90.3% | 90.2% | 90.2% |
| airwallex | `src/airwallex/` | 91.0% | 91.0% | 80.9% | 80.9% |
| alta (metal) | `src/metal/` | 89.5% | 89.5% | 80.3% | 80.3% |

The areas that moved by a few tenths without a test of this round (policy, audit and anchor, airwallex) moved with the
code merged in between.

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

## Tests added on 20 November

A third round, on the files with the most uncovered statements and branches that a test in Node can reach:

| Test | Code | What it holds | Statements (branches) of that code, before → after |
|---|---|---|---|
| [run-trace-build.test.ts](../../test/run-trace-build.test.ts) | src/demo/runTrace.ts | the main run's companion record, built from a small ledger made in the test: every payment kind on its rail with its audit row, the mandate in force when an Alta payment was paid, the origin scrubbed of a passkey id, the SWIFT transfer's approval hash and proposal; refused for a date that is not YYYY-MM-DD, a ledger that is not the record's, a broken chain, a payment with two audit rows and anything private | 10.0% → 100.0% (0.0% → 92.9%) |
| [data-qa-sides.test.ts](../../test/data-qa-sides.test.ts) | src/finance/dataQa.ts | Data QA's Airwallex payments (the SWIFT transfer and its fee, conversions with and without a sell side, the deposit that books a sweep, a card charge an audit row names under another id, a later run's rows left out), each side's verdict when a source fails (its error's first line) or disagrees, a list read page by page, the Books' unbalanced, extra or wrongly proved postings, the report's sections | 84.8% → 99.0% (63.3% → 90.5%) |
| [redesign-run-shapes.test.ts](../../test/redesign-run-shapes.test.ts) | src/redesign/run.ts | the played run's figures for records shaped unlike the main run's: no ledger, an empty run, a follow-up after a pause, each party's stops in one sentence, a let-through purchase, an FX, a TAP-signed card buy, the timings, a card raise, a dispute told only when every part is there, the replay's figures and reworded lines | 89.6% → 93.1% (65.1% → 75.4%) |
| [proof-page-lines.test.ts](../../test/proof-page-lines.test.ts) | src/redesign/proof.ts | /proof's plain words for codes (the code kept in a tooltip), the let-through line with and without its cap and tx, the licence's first attempt with and without its retry, planted instructions, the facts' links, a card dropped when its record is missing | 80.2% → 90.8% (56.9% → 71.6%) |
| [dashboard-local-routes.test.ts](../../test/dashboard-local-routes.test.ts) | src/servers/dashboard.ts | the local dashboard serves each page with its own content security policy, the fonts, logos and T:0 download; redirects old addresses; refuses another Host (DNS rebinding) and a malformed proposal id | 83.0% → 94.3% (57.7% → 66.2%) |
| [film-capture-fake-browser.test.ts](../../test/film-capture-fake-browser.test.ts) | src/film/capture.ts | the film capture with a stand-in browser and the real ffmpeg: a shot with no address refused; each failing address's reason and the next one tried, every page closed; a hold costs one screenshot, a scroll one per frame; a click, a file pick, a highlight and a tab each filmed; a defect after the actions refuses the shot and leaves no partial clip | 51.3% → 71.6% (44.8% → 62.5%) |
| [approve-client-helpers-edges.test.ts](../../test/approve-client-helpers-edges.test.ts) | src/approve/client.ts | the phone page's countdown in both languages (an expired approval never reads as open), a passkey's fingerprint, Dutch amounts, and which policy changes loosen, for each kind of key | 43.3% → 43.5% (57.1% → 57.9%) |

The "before" of the third round is the previous record, which lists each of these files among its largest gaps. No
product code was changed and no function was newly exported. No bug was found in this round. Left for later:
`src/airi/vic3.ts` (the Visa run's orchestrator, its failure paths), `src/fuzz/properties.ts` (its uncovered lines are
the throws a property makes when the code under test is wrong, reached only by breaking that code) and
`worker/src/trySign.ts` (the agents' fallbacks inside the Durable Object).

## The largest gaps left in the measured scope

| File | Uncovered statements | Of | Uncovered branches |
|---|---|---|---|
| `src/approve/client.ts` | 752 | 1332 | 555 |
| `src/airi/vic3.ts` | 77 | 583 | 164 |
| `src/fuzz/properties.ts` | 70 | 436 | 69 |
| `worker/src/trySign.ts` | 65 | 1047 | 129 |
| `src/film/capture.ts` | 56 | 197 | 36 |
| `src/airwallex/routedRail.ts` | 47 | 213 | 42 |
| `src/film/captions.ts` | 44 | 102 | 27 |
| `src/redesign/run.ts` | 44 | 635 | 224 |
| `src/world/runtime.ts` | 44 | 55 | 18 |
| `src/servers/payables.ts` | 43 | 337 | 38 |
| `src/servers/seller.ts` | 43 | 128 | 47 |
| `src/metal/hold.ts` | 42 | 71 | 17 |
| `cloud/src/engine/hostWorker.ts` | 41 | 117 | 24 |
| `src/awx/live.ts` | 41 | 60 | 32 |
| `src/ops/runnerLock.ts` | 41 | 127 | 32 |

The largest, `src/approve/client.ts`, is the script of the CFO's phone pages: its pure functions (hashing the
terms, describing them, the runner-key checks, the relay calls and the passkey sign-in) are unit-tested, and its page code (building the approval, enrolment
and policy screens in the browser) runs in the browser checks (`test/browser/*.check.ts`, CI job `judge`), which V8
coverage in the test process does not count; the test process has no DOM, and no DOM library (happy-dom, jsdom) is among the project's dependencies.
`src/film/capture.ts`'s rest is the code it runs inside Chromium's page (finding, scrolling to and outlining text),
which the stand-in browser cannot run; the rest are the Visa run's orchestrator, the fuzz properties' failure paths,
the try-sign agents' fallbacks, the site's page builders, servers and recorders of dated runs.

## Limits of these figures

- Statement coverage says a line ran, not that its result was checked. The money areas have their own floors and
  the assurance case names the tests that check each invariant ([docs/assurance.md](../assurance.md)).
- The browser checks and the live runs are not in these figures.
- V8's mapping to statements can under-count a line that ran (for example a `return` inside a callback that
  better-sqlite3 runs as a transaction); the figures are what the tool reports, not corrected by hand.
- The failures in the runs touch no measured code: `test/cloud-engine-bundle.test.ts` bundles the Worker and on the
  measuring machine finds the dependencies through a linked `node_modules` outside the checkout, so a dynamic import
  inside a dependency counted as the repository's own (1 test in the evening's run, 2 in the second round's, 1 in this
  one: "loads the engine in one place only", which finds viem's own dynamic imports beside the engine's; it passes in
  CI). Vitest writes no coverage report after a failed test unless asked, so this round's run used
  `--coverage.reportOnFailure`.
