// Coverage (hardening plan item 1): measured over src/ on every CI run; test/coverage-areas.ts reports it per area
// (money, policy, passkey, executors, relay, clearing) and holds each area to its floor.
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
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
