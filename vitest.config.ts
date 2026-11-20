// Coverage (hardening plan item 1): measured on every CI run (npm run test:coverage); test/coverage-areas.ts reports it
// per area (money, policy, passkey, executors, relay, clearing and the others) and holds each area to its floor.
// Since 19 November the measured scope is the whole product, not src/ alone; the numbers, before and after, are in
// docs/evidence/coverage.md.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// The relay Worker's pages are baked in by npm run relay:build (worker/src/pages.gen.ts, git-ignored). Without a build,
// the Worker's entry point (worker/src/index.ts) imports an empty set of pages here, which a test fills with only what it
// routes (test/relay-worker-entry.test.ts); with a build, the built file is used as it is.
const ROOT = import.meta.dirname;
const PAGES_GEN = resolve(ROOT, "worker/src/pages.gen.ts");
const NO_PAGES = "\0kit11:no-pages-gen";
const pagesGen = {
  name: "kit11-pages-gen",
  resolveId(id: string, importer?: string) {
    if (!/\/pages\.gen(\.js|\.ts)?$/.test(id) || existsSync(PAGES_GEN)) return null;
    // Relative to the importer, or (a dynamic import of a computed path) relative to the root.
    const abs = id.startsWith(".") && importer ? resolve(importer, "..", id) : id.startsWith(ROOT) ? id : resolve(ROOT, `.${id}`);
    return abs.replace(/\.js$/, ".ts") === PAGES_GEN ? NO_PAGES : null;
  },
  load(id: string) {
    return id === NO_PAGES ? "export const PAGES = { csp: {} };" : null;
  },
};

// The engine's schema files are text modules in the Worker's bundle (cloud/wrangler.jsonc rules: "Text" for **/*.sql),
// so the Durable Object's host (cloud/src/engine/hostWorker.ts) imports them as strings; here they are read the same way.
const sqlText = {
  name: "kit11-sql-text",
  transform(code: string, id: string) {
    return id.endsWith(".sql") ? { code: `export default ${JSON.stringify(code)};`, map: null } : null;
  },
};

export default defineConfig({
  plugins: [pagesGen, sqlText],
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
      // A floor under the product's figure (20 November: 92.0% of statements, 81.9% of branches, measured again that day on
      // f667d16c6 before the fourth round's tests, with 10 tests timing out on a loaded machine; 91.7% and 81.4% late on
      // 19 November, 91.1% and 80.6% earlier that evening, 88.5% and 77.7% that morning), one point below it, rounded
      // down. The fourth round's tests only add to it.
      thresholds: { statements: 91, branches: 80 },
    },
  },
});
