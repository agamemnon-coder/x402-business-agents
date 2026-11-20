// Mutation testing of the money-critical modules (docs/evidence/mutation-testing.md; run with npm run mutation).
// One group at a time (MUTATION_GROUP): the files a group mutates, and the test files that run against its mutants.
// Since 20 November every group but the two older ones (verifier, payee) runs ALL test files that import one of its
// modules (found here, by their import lines, at the start of each run), not a chosen few, plus its own mutation-kills
// file; each mutant still runs only the tests that reach its code (coverage per test). MUTATION_INCREMENTAL=1 re-tests
// only what changed since the group's last report.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".test.ts") ? [join(dir, e.name).replaceAll("\\", "/")] : []));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Every test file that imports (or mocks) one of `modules`, by a relative import of its path. */
export function importers(...modules) {
  const pats = modules.map((m) => new RegExp(`(?:from|import\\(|vi\\.mock\\()\\s*["'](?:\\.\\./)+${esc(m.replace(/\.ts$/, ""))}(?:\\.js|\\.ts)?["']`));
  return walk("test").filter((f) => pats.some((p) => p.test(readFileSync(f, "utf8")))).sort();
}

/** The mutation-kills files written for the groups below: each counts for its own group only, so a group's run before
 *  its new tests is not changed by another group's (they import each other's modules to set a payment up). */
const KILLS = new Set();

/** A group: its modules, and every test file that imports one of them (plus its own mutation-kills file). */
const group = (mutate, extra = []) => {
  for (const f of extra) KILLS.add(f);
  return {
    mutate,
    get tests() {
      const found = importers(...mutate.map((m) => m.replace(/:\d+-\d+$/, ""))).filter((f) => !KILLS.has(f));
      return [...new Set([...found, ...extra])];
    },
  };
};

export const GROUPS = {
  // The canonical terms (RFC 8785) and their SHA-256, the rejection hash and the typed prefix.
  terms: group(["src/lib/terms.ts"], ["test/mutation-kills-terms.test.ts"]),
  // The proposal's lifecycle (src/policy/approvals.ts), in three parts, each against every test file that imports it
  // (about 100; one run of the whole file takes hours on a shared machine): the proposal and the person's decision;
  // the payment approved by code within the limit to pay alone, and a batch's lines; the execution guard
  // (beginExecution), the close, the signed terms and expiry.
  "approval-decide": group(["src/policy/approvals.ts:1-234"], ["test/mutation-kills-approval.test.ts"]),
  "approval-alone": group(["src/policy/approvals.ts:235-322"], ["test/mutation-kills-approval.test.ts"]),
  "approval-guard": group(["src/policy/approvals.ts:323-476"], ["test/mutation-kills-approval.test.ts"]),
  // Passkey verification: the stored signatures re-checked at execution, and the runner's own WebAuthn checks.
  passkey: group(["src/policy/signedApproval.ts", "src/passkey/storedSignature.ts", "src/passkey/webauthn.ts"], ["test/mutation-kills-passkey.test.ts"]),
  // Hash first: a proposal whose terms no longer hash to what was signed reaches nothing outside Purser.
  hashfirst: group(["src/policy/hashFirst.ts"], ["test/mutation-kills-hashfirst.test.ts"]),
  // The invoice payment executor, the whole file: its checks before money moves, the payout's create, adoption and
  // recovery by request_id, the fee retry and the fee ceiling.
  // The file holds 657 mutants, so it runs in three parts: the checks before any money moves and the run's steps (up to
  // holdReason, payeeReason and the floor); the payout's create and its recovery by request_id (look-up, adoption,
  // recordTransfer, sameTransfer, the refusals that close a row); the fee retry, the fee ceiling and the sandbox settle.
  "executor-checks": group(["src/executors/invoicePayment.ts:1-218"], ["test/mutation-kills-executor.test.ts"]),
  "executor-payout": group(["src/executors/invoicePayment.ts:219-406"], ["test/mutation-kills-executor.test.ts"]),
  "executor-fee": group(["src/executors/invoicePayment.ts:407-509"], ["test/mutation-kills-executor.test.ts"]),
  // The money-action state machine: the step log and the resume after a crash.
  saga: group(["src/policy/saga.ts"], ["test/mutation-kills-saga.test.ts"]),
  // What a payment may use: limit or balance minus held minus pending.
  available: group(["src/policy/available.ts"], ["test/mutation-kills-available.test.ts"]),
  // Spend holds: the reservation made before an agent signs or buys.
  holds: group(["src/policy/holds.ts"], ["test/mutation-kills-holds.test.ts"]),
  // The floor policy: the payout lock's held money, and the treasury's free euros over its floor.
  floor: group(["src/policy/payoutLock.ts", "src/policy/treasury.ts"], ["test/mutation-kills-floor.test.ts"]),
  // Payout recovery: closing a payout row nothing stands behind, and following payouts that came back.
  recovery: group(["src/finance/closeUnsent.ts", "src/payouts/follow.ts"], ["test/mutation-kills-recovery.test.ts"]),
  // The offline receipt verifier (npm run verify-receipt); every test file that imports it (13 November's list).
  verifier: {
    mutate: ["src/try/receipt.ts"],
    tests: ["test/try-receipt.test.ts", "test/try-verify.test.ts", "test/try-chain.test.ts", "test/try-fx.test.ts", "test/tamper-matrix.test.ts",
      "test/agent-data.test.ts", "test/e2e-platform.test.ts", "test/hero-demo.test.ts", "test/mutation-kills-verifier.test.ts"],
  },
  // Changed bank details, lookalike payees, duplicate invoices; every test file that imports them (13 November's list).
  payee: {
    mutate: ["src/policy/fraudCore.ts", "src/lib/invoiceKey.ts"],
    tests: ["test/fraud.test.ts", "test/fraud-bank-change-language.test.ts", "test/try-trick.test.ts", "test/invoice-duplicate-key.test.ts",
      "test/ap-redteam2.test.ts", "test/ap-checker-core.test.ts", "test/platform-final.test.ts", "test/platform-in-main.test.ts", "test/rt4-money.test.ts",
      "test/try-agents.test.ts", "test/try-why.test.ts", "test/mutation-kills-payee.test.ts"],
  },
};

const name = process.env.MUTATION_GROUP ?? "terms";
const chosen = GROUPS[name];
if (!chosen) throw new Error(`MUTATION_GROUP must be one of ${Object.keys(GROUPS).join(", ")}`);
// A group's mutation-kills file may not be written yet; only files that exist run.
const tests = chosen.tests.filter((f) => { try { readFileSync(f); return true; } catch { return false; } });
// Read by vitest.mutation.config.ts in Stryker's test runner processes, which inherit this environment.
process.env.MUTATION_TESTS = JSON.stringify(tests);

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
  // Added to each mutant's own measured test time (times 1.5); MUTATION_TIMEOUT_MS changes it (20 November's runs: 20 s).
  timeoutMS: Number(process.env.MUTATION_TIMEOUT_MS ?? 20000),
  // The first, unmutated run of every test file a group names (about 100 for the approval parts) with coverage takes far
  // longer than Stryker's default 5 minutes on a shared machine.
  dryRunTimeoutMinutes: 90,
  checkers: [],
  // A static mutant (a module-level constant) re-runs every test file of the group; they are counted as Ignored.
  ignoreStatic: true,
  mutate: chosen.mutate,
  reporters: ["clear-text", "progress-append-only", "json"],
  // Not the incremental file: both written at the end to one path can leave a file that does not parse.
  jsonReporter: { fileName: `reports/mutation/${name}.report.json` },
  incremental: process.env.MUTATION_INCREMENTAL === "1",
  incrementalFile: `reports/mutation/${name}.json`,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
};
