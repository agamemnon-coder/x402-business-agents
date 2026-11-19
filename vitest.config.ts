// Coverage (hardening plan item 1): measured on every CI run (npm run test:coverage); test/coverage-areas.ts reports it
// per area (money, policy, passkey, executors, relay, clearing and the others) and holds each area to its floor.
// Since 19 November the measured scope is the whole product, not src/ alone; the numbers, before and after, are in
// docs/evidence/coverage.md.
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agent worktrees live under .claude/worktrees inside the checkout; their copies of the tests are not this tree's.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // 0 external calls and no live key, whatever this machine holds (test/support/noNetwork.ts).
    setupFiles: ["test/support/noNetwork.ts"],
    // Windows laptops start child processes and read files slower than CI's Linux runners: 30 s per test there
    // (16 Nov, the owner's laptop: six page builds took over 5 s). Linux keeps the default 5 s.
    ...(process.platform === "win32" ? { testTimeout: 30_000, hookTimeout: 60_000 } : {}),
    coverage: {
      provider: "v8",
      // The product: the runner, its agents and pages (src/), Purser Cloud (cloud/src/) and the relay Worker
      // (worker/src/), uncovered files included.
      include: ["src/**/*.ts", "cloud/src/**/*.ts", "worker/src/**/*.ts"],
      // Left out of the figure (still type-checked and linted; the figure with them is in docs/evidence/coverage.md):
      exclude: [
        // The command-line entry points: argument parsing and printing around the library functions they call, which
        // are measured, and the recorders of the dated live runs, which need sandbox keys and the partners. The npm
        // scripts start them as processes, which coverage in this process does not see.
        "src/cli/**",
        // Generated files (fonts, logos) and type declarations.
        "**/*.gen.ts", "**/*.d.ts",
      ],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // A floor under the product's figure (19 November: 88.5% of statements, 77.7% of branches before the tests
      // added that day), a few points below it so a run on a slower machine does not fail on noise.
      thresholds: { statements: 85, branches: 75 },
    },
  },
});
