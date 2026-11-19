// Mutation testing of the money-critical modules (docs/evidence/mutation-testing.md; run with npm run mutation).
// One group at a time (MUTATION_GROUP): the files a group mutates, and the test files that run against its mutants:
// the module's own tests and every test file that imports it, except for the approval group, whose two modules about
// 45 test files import (there, the tests written for them). Each mutant runs only the tests that reach its code
// (coverage per test). MUTATION_INCREMENTAL=1 re-tests only what changed since the group's last report.
export const GROUPS = {
  // The canonical terms and their SHA-256; the approval, the limit to pay alone, and the execution guard.
  approval: {
    mutate: ["src/lib/terms.ts", "src/policy/approvals.ts"],
    tests: ["test/terms.test.ts", "test/property-terms.test.ts", "test/approvals.test.ts", "test/approve-within-limit.test.ts",
      "test/zero-trust.test.ts", "test/four-eyes.test.ts", "test/second-key.test.ts", "test/resume-approved.test.ts",
      "test/payment-batch.test.ts", "test/mutation-kills-approval.test.ts"],
  },
  // What a payment may use: limit or balance minus held minus pending; every test file that imports it.
  available: {
    mutate: ["src/policy/available.ts"],
    tests: ["test/available.test.ts", "test/property-available.test.ts", "test/sourcing-paid-after-lookup.test.ts", "test/settlement-resolution.test.ts",
      "test/sale-settling.test.ts", "test/dashboard-vs-chain.test.ts", "test/contract/airwallex.test.ts", "test/close-unsent.test.ts",
      "test/mutation-kills-available.test.ts"],
  },
  // The invoice payment executor's checks before any money moves (its preconditions and holdReason): every test file
  // that runs the executor.
  executor: {
    mutate: ["src/executors/invoicePayment.ts:61-105", "src/executors/invoicePayment.ts:183-191"],
    tests: ["test/airwallex-approvals.test.ts", "test/airwallex-batch-transfer.test.ts", "test/airwallex-verify.test.ts", "test/ap-autopilot.test.ts",
      "test/ap-books.test.ts", "test/ap-coder-agent.test.ts", "test/ap-pay-lookup.test.ts", "test/ap-pay.test.ts", "test/ap-payer-agent.test.ts",
      "test/ap-review-fixes.test.ts", "test/close-unsent.test.ts", "test/euroBill.test.ts", "test/executors-dispatch.test.ts", "test/ledger-pack.test.ts",
      "test/licence-fee.test.ts", "test/licence-repropose.test.ts", "test/main-run-world.test.ts", "test/one-cent-three-locks.test.ts",
      "test/payment-batch.test.ts", "test/payout-returned.test.ts", "test/platform-final.test.ts", "test/reconcile-books.test.ts",
      "test/rt6-platform.test.ts", "test/treasury-paid-invoices.test.ts", "test/treasury-paid-review.test.ts", "test/zero-trust.test.ts",
      "test/swift-fee-reserve.test.ts", "test/mutation-kills-executor.test.ts"],
  },
  // The offline receipt verifier (npm run verify-receipt); every test file that imports it.
  verifier: {
    mutate: ["src/try/receipt.ts"],
    tests: ["test/try-receipt.test.ts", "test/try-verify.test.ts", "test/try-chain.test.ts", "test/try-fx.test.ts", "test/tamper-matrix.test.ts",
      "test/agent-data.test.ts", "test/e2e-platform.test.ts", "test/hero-demo.test.ts", "test/mutation-kills-verifier.test.ts"],
  },
  // Changed bank details, lookalike payees, duplicate invoices; every test file that imports them.
  payee: {
    mutate: ["src/policy/fraudCore.ts", "src/lib/invoiceKey.ts"],
    tests: ["test/fraud.test.ts", "test/fraud-bank-change-language.test.ts", "test/try-trick.test.ts", "test/invoice-duplicate-key.test.ts",
      "test/ap-redteam2.test.ts", "test/ap-checker-core.test.ts", "test/platform-final.test.ts", "test/platform-in-main.test.ts", "test/rt4-money.test.ts",
      "test/try-agents.test.ts", "test/try-why.test.ts", "test/mutation-kills-payee.test.ts"],
  },
};

const name = process.env.MUTATION_GROUP ?? "approval";
const group = GROUPS[name];
if (!group) throw new Error(`MUTATION_GROUP must be one of ${Object.keys(GROUPS).join(", ")}`);
// Read by vitest.mutation.config.ts in Stryker's test runner processes, which inherit this environment.
process.env.MUTATION_TESTS = JSON.stringify(group.tests);

export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.config.ts", related: false },
  coverageAnalysis: "perTest",
  // In place: the checkout is large (docs/), and some tests read files from it. Stryker restores every file it changed.
  inPlace: true,
  // Vitest does not type-check, so Stryker need not add // @ts-nocheck to the files (in place, it would touch them all).
  disableTypeChecks: false,
  // The machine running it is shared: two test runners.
  concurrency: 2,
  timeoutMS: 20000,
  checkers: [],
  // A static mutant (a module-level constant) re-runs every test file of the group; they are counted as Ignored.
  ignoreStatic: true,
  mutate: group.mutate,
  reporters: ["clear-text", "progress-append-only", "json"],
  jsonReporter: { fileName: `reports/mutation/${name}.json` },
  incremental: process.env.MUTATION_INCREMENTAL === "1",
  incrementalFile: `reports/mutation/${name}.json`,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
};
