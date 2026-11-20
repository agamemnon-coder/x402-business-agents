// The test run Stryker uses for mutation testing (npm run mutation, docs/evidence/mutation-testing.md): the main config,
// limited to the test files of the group being mutated (stryker.config.mjs sets MUTATION_TESTS), so a run takes
// minutes, not the whole suite's time.
import { statSync } from "node:fs";
import { defineConfig, mergeConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import base from "./vitest.config.js";

const tests = process.env.MUTATION_TESTS ? (JSON.parse(process.env.MUTATION_TESTS) as string[]) : [];
if (tests.length === 0) throw new Error("vitest.mutation.config.ts runs under Stryker (npm run mutation), which names the test files");

/**
 * Stryker stops a mutant's run at its first failing test, one file after another. Vitest's own order runs the slowest
 * file first, so a mutant one quick test kills waited for minutes of slow files. Here: a file that failed in the last run
 * first (the one that killed the previous mutant often kills the next), then the fastest, then the smallest. The order
 * changes how long a run takes, never which mutants are killed: a survivor still runs every test that covers it.
 */
class FastFirst extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const result = (s: TestSpecification) => this.ctx.cache.getTestSpecificationResult(s);
    const size = (s: TestSpecification) => { try { return statSync(s.moduleId).size; } catch { return 0; } };
    return [...files].sort((a, b) => {
      const ra = result(a), rb = result(b);
      if (!!ra?.failed !== !!rb?.failed) return ra?.failed ? -1 : 1;
      if (ra && rb && ra.duration !== rb.duration) return ra.duration - rb.duration;
      return size(a) - size(b);
    });
  }
}

export default mergeConfig(base, defineConfig({ test: { include: tests, sequence: { sequencer: FastFirst } } }));
