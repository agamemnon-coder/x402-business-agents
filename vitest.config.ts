// Coverage (hardening plan item 1): measured over src/ on every CI run; test/coverage-areas.ts reports it per area
// (money, policy, passkey, executors, relay, clearing) and holds each area to its floor.
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agent worktrees live under .claude/worktrees inside the checkout; their copies of the tests are not this tree's.
    exclude: [...configDefaults.exclude, ".claude/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
