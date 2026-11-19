// The test run Stryker uses for mutation testing (npm run mutation, docs/evidence/mutation-testing.md): the main config,
// limited to the test files of the group being mutated (stryker.config.mjs sets MUTATION_TESTS), so a run takes
// minutes, not the whole suite's time.
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

const tests = process.env.MUTATION_TESTS ? (JSON.parse(process.env.MUTATION_TESTS) as string[]) : [];
if (tests.length === 0) throw new Error("vitest.mutation.config.ts runs under Stryker (npm run mutation), which names the test files");

export default mergeConfig(base, defineConfig({ test: { include: tests } }));
