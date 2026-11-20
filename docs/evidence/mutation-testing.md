# Mutation testing

Do the tests catch bugs in the code that moves money, or do they only run it? A mutation run answers that. It plants one
small bug at a time (a condition dropped, `<` made `<=`, a check forced to pass, a string emptied) and runs the
related tests. A mutant is **killed** when a test fails, and it **survived** when every test still passes. Offline: no
network and no key. Test money only.

**Status: partial (20 November 2026).** On 20 November the Stryker groups were redefined so that each runs **every
test file that imports one of its modules** (found by `importers()` in `stryker.config.mjs`), not a hand-picked list.
Of the fourteen groups defined (the executor and src/policy/approvals.ts each in three parts), **one (hash first) was measured before and after its new tests**. The others were not
finished: on a shared 4-core machine (load average 20 to 37) a group that about 30 or 100 test files import takes hours
(the executor's checks: about 1.2 mutants a minute, 219 mutants), and the run was stopped at the time box. Nothing below
is reported from a run that did not finish. Machine-readable record: [mutation-testing.json](mutation-testing.json),
written by `npm run mutation -- --record` from the completed runs' reports.

## Settings

- **Stryker** `@stryker-mutator/core` 10.1.1 with `@stryker-mutator/vitest-runner` 10.1.1, on the repository's vitest
  5.1.0. Default mutators, coverage per test, concurrency 2, incremental mode, `ignoreStatic`, 20 s added to each
  mutant's measured test time (times 1.5) before it counts as timed out, 90 minutes allowed for the first, unmutated run.
- **Tests per group**: every test file that imports a module of the group, plus the group's own mutation-kills file.
  A mutation-kills file written for one group does not count for another group's run (they import each other's modules
  to set a payment up).
- **Order** (`vitest.mutation.config.ts`): a file that failed in the last run first, then the fastest. Vitest's own order
  runs the slowest file first, so a mutant one quick test kills waited for minutes. The order changes run time, never which
  mutants are killed: a survivor still runs every test that covers it.
- **Timed out** counts as detected, as Stryker counts it. On this loaded machine a timeout is weaker evidence than a
  kill, so timeouts are listed on their own below.

Score = (killed + timed out) / (killed + timed out + survived + no coverage).

## Results, 20 November

### hashfirst: `src/policy/hashFirst.ts` (complete)

Command: `MUTATION_INCREMENTAL=1 npm run mutation -- --group hashfirst --no-proof`

Test files (every importer): `test/execution-signature.test.ts`, `test/zero-trust.test.ts`; after: plus
`test/mutation-kills-hashfirst.test.ts`.

| Run | Mutants | Killed | Timed out | Survived | No coverage | Score |
|---|---|---|---|---|---|---|
| Before (09:45 to 10:15) | 68 | 32 | 25 | 8 | 3 | 83.8% |
| After (11:35 to 11:37, incremental) | 68 | 65 | 0 | 3 | 0 | **95.6%** |

What the survivors showed: no test asked `signedHashRefusal` about a proposal that does not exist or has no approval,
or one whose approval row is a rejection beside a forged APPROVED status (the mutant then threw a TypeError instead of
answering); and no test read the refusal `hashFirst` records before any outside call (its actor, its reason cut at 400
characters, `at: before any outside call`). `test/mutation-kills-hashfirst.test.ts` pins those, every status that may
or may not run (APPROVED, FAILED, EXECUTING only for a restart's resume), each one-sided change of terms, stored hash or
approved hash, and that a resume is not held to the signature check again.

Left after the new tests, classified (no real defect found):

- line 26, the `catch` block emptied: **equivalent**. `recomputed` stays undefined, which matches no hash, so unreadable
  terms are refused either way.
- line 29, `recomputed !== null` made `true`: **equivalent**. It is null only after that catch, and null never equals a
  stored hash.
- line 41, `p.status === "EXECUTING"` made `true` (so a proposal in the `resuming` set would run in any status):
  **unreachable**. `resumeInterrupted` (src/policy/saga.ts) only ever adds EXECUTING actions to that set, and
  `beginExecution` checks the status again inside its lock.

The 25 timeouts before were mutants that let a refused proposal through `hashFirst` into the zero-trust depth test, whose
run then went past its limit; the after-run re-ran those the new tests cover.

### Not finished

| Group | Modules | Importers | State |
|---|---|---|---|
| executor-checks | `src/executors/invoicePayment.ts` lines 1 to 218 (checks before money moves, the run's steps, holdReason, payeeReason, the floor) | 30 | before-run stopped at the time box (about 40 of 219 mutants tested); not reported |
| executor-payout | the same file, lines 219 to 406 (the payout's create and its recovery by request_id) | 30 | not run |
| executor-fee | the same file, lines 407 to 509 (fee retry, fee ceiling, sandbox settle) | 30 | not run |
| approval-decide, approval-alone, approval-guard | `src/policy/approvals.ts` in three parts | 104 | not run |
| terms | `src/lib/terms.ts` | 72 | not run |
| passkey | `src/policy/signedApproval.ts`, `src/passkey/storedSignature.ts`, `src/passkey/webauthn.ts` | 27 | not run |
| saga | `src/policy/saga.ts` (the money-action state machine) | 9 | not run |
| available | `src/policy/available.ts` | 9 | not run |
| holds | `src/policy/holds.ts` | 13 | not run |
| floor | `src/policy/payoutLock.ts` (no test imported it), `src/policy/treasury.ts` | 5 | not run |
| recovery | `src/finance/closeUnsent.ts`, `src/payouts/follow.ts` | 2 | not run |

Tests written for these groups ahead of their runs, from reading the code and the survivors of the 19 November narrow
runs (they pass, but their effect on the scores is **not measured**): `test/mutation-kills-executor.test.ts` (the USD
and EUR floors at execution to the cent, the USD and euros other payments hold, the quote's 30-second margin on its own,
an unknown or reused quote, each hold and the treasury agent's identity), `test/mutation-kills-approval.test.ts` (the
execution guard's expiry, tampered audit log, preconditions, resume; closeAsStale, signedTerms, expireDue),
`test/mutation-kills-available.test.ts`, `test/mutation-kills-floor.test.ts`, `test/mutation-kills-saga.test.ts` and
`test/mutation-kills-terms.test.ts`. No code defect was found or fixed.

## Earlier runs (19 November, narrow test lists, before their new tests; not re-run)

The receipt verifier (`src/try/receipt.ts`) 82.9%, the bank-detail and lookalike check (`src/policy/fraudCore.ts`)
74.1%, the duplicate-invoice check (`src/lib/invoiceKey.ts`) 63.6%, the executor's checks (lines 61 to 105 and 183 to
191, six test files) 42.1%, available balance (two test files) 15.3%. The proof-bundle verifier's harness
(`scripts/mutation-proof-verifier.ts`, 51 fixed mutations of `PROOF_VERIFY_JS`): 15 of 51 killed before, **50 of 51**
after `test/mutation-kills-verifier.test.ts`; the one left is equivalent (`checks.length > 0` made `>= 0`: the format
check always runs first). Those figures are kept in the record under `earlier` and `proof_verifier`.

## Reproduce

```
npm run mutation -- --group hashfirst --no-proof     # one group; MUTATION_INCREMENTAL=1 re-tests only what changed
npm run mutation -- --no-stryker                     # the proof-verifier harness only
npm run mutation -- --record                         # the record, from reports/mutation/<group>.before.json and .after.json
```

Stryker is not a dependency of the repository: `scripts/mutation.ts` installs it once into its own folder
(`STRYKER_PREFIX`), never into node_modules, and points it at the repository's vitest. It runs in place and restores
every file it changes; stopping it with Ctrl-C restores them too. Do not run two groups at once in one checkout.
