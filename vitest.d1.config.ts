// npm run test:d1: the cloud's tests on local D1 (test/support/d1.ts) instead of better-sqlite3.
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

export default mergeConfig(base, defineConfig({
  test: {
    // test/db-do-sql-workerd.test.ts: not D1, but the same toolchain (a Durable Object's SQLite in local workerd).
    include: ["test/cloud-*.test.ts", "test/rt4-cloud-*.test.ts", "test/ap-credit-netting.test.ts", "test/db-do-sql-workerd.test.ts"],
    setupFiles: ["test/support/d1.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
}));
