# Mutation testing

Do the tests catch bugs in the code that moves money, or do they only run it? A mutation run answers that. It plants one
small bug at a time (a condition dropped, `<` made `<=`, a check forced to pass, a string emptied) and runs the
related tests. A mutant is **killed** when a test fails, and it **survived** when every test still passes. Offline: no
network and no key.

**Status: partial.** Four of the five Stryker groups were measured. The fifth, `approval` (src/lib/terms.ts and
src/policy/approvals.ts), was stopped at 129 of 639 mutants on a shared, overloaded machine and is not reported. The
Stryker scores below are from **before** the new tests, because the after-run was not made. The proof-bundle verifier
was measured before and after. Full numbers and every surviving mutant: [mutation-testing.json](mutation-testing.json).

## Tools

- **Stryker** `@stryker-mutator/core` 10.1.1 with `@stryker-mutator/vitest-runner` 10.1.1, on the repository's vitest
  5.1.0. Default mutators, coverage per test, 2 test runners. Static mutants (module-level constants such as the
  confusable-letter table and the bank-change regex) were left out (`ignoreStatic`) and are counted as ignored.
- **A small harness** for the proof-bundle verifier (`scripts/mutation-proof-verifier.ts`). The checks that /verify
  and `npm run verify-bundle` run are plain JavaScript inside a string (`PROOF_VERIFY_JS` in src/proof/bundle.ts), and
  Stryker cannot mutate inside a string. The harness applies 51 fixed mutations to that text, one at a time, runs the
  verifier's tests, and puts the file back.

## Results

Score = (killed + timed out) / (killed + timed out + survived + no coverage). "Covered" leaves out the mutants that no
selected test reaches.

| Module | Tests run against it | Mutants | Killed | Timeout | Survived | No coverage | Ignored (static) | Score | Covered |
|---|---|---|---|---|---|---|---|---|---|
| src/try/receipt.ts (receipt verifier) | try-receipt, try-verify, try-chain, try-fx, tamper-matrix | 438 | 339 | 0 | 56 | 14 | 29 | 82.9% | 85.8% |
| src/policy/fraudCore.ts (bank details, lookalikes) | fraud, fraud-bank-change-language, try-trick, invoice-duplicate-key, ap-redteam2 | 307 | 179 | 1 | 56 | 7 | 64 | 74.1% | 76.3% |
| src/lib/invoiceKey.ts (duplicate invoices) | same as above | 119 | 75 | 0 | 22 | 21 | 1 | 63.6% | 77.3% |
| src/executors/invoicePayment.ts, lines 61-105 and 183-191 (the executor's checks before money moves) | euroBill, one-cent-three-locks, swift-fee-reserve, ap-review-fixes, close-unsent, zero-trust | 107 | 44 | 1 | 50 | 12 | 0 | 42.1% | 47.4% |
| src/policy/available.ts (what a payment may use) | available, property-available | 200 | 30 | 0 | 9 | 157 | 4 | 15.3% | 76.9% |
| src/lib/terms.ts, src/policy/approvals.ts | not reported (stopped) | | | | | | | | |
| **Proof-bundle verifier**, before | proof-bundle, tamper-matrix | 51 | 15 | 0 | 36 | | | **29.4%** | |
| **Proof-bundle verifier**, after | the same, plus test/mutation-kills-verifier.test.ts | 51 | 50 | 0 | 1 | | | **98.0%** | |

These test lists are narrow on purpose, so that a run takes minutes. The low executor and available scores mostly
show that: those modules are also run by other test files that were not selected (26 test files run the executor, 8
import available.ts). Most of available.ts's no-coverage mutants are in `mandatePayments` and `cardAvailability`,
which the two selected files never call. Survivors there are **not yet judged** as gaps. The committed
`stryker.config.mjs` now runs every test file that imports each module, except for the approval group. That wider run
has not been made.

## What the survivors showed, and the tests added

**Proof-bundle verifier** (36 survivors before, 1 after). Real gaps, now each killed by a test in
`test/mutation-kills-verifier.test.ts`:

- the format name, a 64-hex hash, a non-empty rpId and base64url fields were not tested on their own;
- a bundle whose terms carry a number was not tested, and neither were a changed `terms_sha256` or `canonical` text
  with the terms kept;
- the client data's `type` and `crossOrigin`, user presence without verification, and authenticator data of 36 bytes;
- strict DER for ES256 (a trailing byte, a wrong SEQUENCE length, an r of 33 bytes, raw r‖s), and keys that are not
  ES256 on P-256 (curve P-384, alg ES384, key type OKP);
- **none of the engine-decision checks**: another signed hash, other terms sent, an unverified signature, an executor
  that did not accept, `paid_once`, or a refusal whose sent hash equals the signed one;
- a refusal's asked terms: a wrong hash, terms equal to the signed ones, or none at all;
- the ledger: a one-line entry, a payment with no entries, a refusal's ledger head, an entry that does not cover the one
  before even though its own hash is right, a fractional number, and an exception while checking (it now counts as a
  failure in a test, not a pass).

The one survivor left is equivalent: `checks.length > 0` becoming `>= 0`. The format check always runs first, so
`checks` is never empty when the verdict is taken.

**Receipt verifier, src/try/receipt.ts** (56 survived, 14 no coverage). Tests were added for the real gaps: array
separators in canonical JSON; every format field on its own (and that a malformed receipt never throws); client data
that is not JSON; `webauthn.create`; `crossOrigin`; short authenticator data; UP without UV; an FX block missing its
quote id, expiry or rate; the hash chain (no rows, non-string fields under a hash that covers them, a row that does
not follow the one before, a wrong length, a signature row that has the wrong kind or data); a malformed e2e block; and
`receiptOrigin`. Equivalent: `checks.length > 0` (as above), the `catch { want = null }` body (`want` is already null),
and `typeof r.terms === "object"` (for JSON input, a truthy value that is not an object has no `test_world`). Not
re-measured: the after-run was not made.

**Payee checks, src/policy/fraudCore.ts and src/lib/invoiceKey.ts.** The main finding: **no test changed only the
IBAN or only the BIC**. A mutant that needs both changed before it raises `bank_details_changed` survived. Tests were
added in `test/mutation-kills-payee.test.ts` for that, and also for:

- the `asked`/`on_file` evidence;
- a spaced IBAN with a two-character tail;
- `accountWords` trimming;
- edit-distance boundaries (empty strings, swaps);
- the lookalike thresholds at exactly 8 letters, at 7, at 4 and at 3;
- a supplier on file under a non-Latin name;
- the account-holder line's spacing and its position at the start of a line;
- the quoted bank-change and pressure lines;
- zero-width characters, leading zeros, `I` for 1, accents, and a zero inside a number (`INV-2050` is not `INV-250`);
- `ledgerParts`, and `sameLedgerInvoice` by name, by account, and with an unknown supplier.

Equivalent: the `/\s+/g` → `/\s/g` mutants in a global replace, and the `^`/`$` anchors of `/^\p{Nd}$/u`, which is only
ever given a single code point. The same goes for `/[\p{L}]+/` → `/[\p{L}]/`, and for the anchors on the digit-group
test, because groups are only ever all letters or all digits. Not re-measured.

**Executor and available.** Not triaged and no tests added: their survivors first need the wider test run (above).
Among the executor's survivors, the ones to check first are the checks made at execution time: the EUR and USD floors,
the quote's 30-second margin, an unknown or reused quote, and `holdReason` (stopped, paused, authorised).

## Reproduce

```
npm run mutation                       # every group, then the proof-verifier harness; summary in reports/mutation/summary.json
npm run mutation -- --group payee      # one group
npm run mutation -- --no-stryker       # the proof-verifier harness only
```

Stryker is not a dependency of the repository. `scripts/mutation.ts` installs `@stryker-mutator/core@10.1.1` and
`@stryker-mutator/vitest-runner@10.1.1` once into their own folder (`STRYKER_PREFIX`, by default under the system's
temp folder), never into node_modules. It then points their vitest at the repository's own, so the tests run on the
same vitest as `npm test`. Stryker runs in place (`stryker.config.mjs`, `vitest.mutation.config.ts`) and restores
every file it changes. Do not run the harness and Stryker at the same time in one checkout. A group takes between 13
and 20 minutes on a shared 4-core machine; the approval group needs more than an hour.
