// npm run test:shim: the engine's own Node tests with every ledger handle replaced by the Durable Object handle
// (src/db/doSql.ts) over a stand-in for a Durable Object's storage (test/support/openShim.ts, test/support/doStorage.ts).
// Every flow these tests cover then crosses the handle's parameter layout, change counting and transactions. A failure
// here is a defect of the handle or of the stand-in, to be fixed there, not in engine code. The same handle inside a
// real Durable Object is checked in test/db-do-sql-workerd.test.ts (npm run test:d1).
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import { OPENER_IMPORT } from "./test/support/shimAlias.js";
import base from "./vitest.config.js";

export default mergeConfig(base, defineConfig({
  resolve: { alias: [{ find: OPENER_IMPORT, replacement: fileURLToPath(new URL("./test/support/openShim.ts", import.meta.url)) }] },
  test: {
    include: [
      "test/shim-handle.test.ts",
      "test/ap-*.test.ts", "test/approvals*.test.ts", "test/books.test.ts", "test/close-unsent.test.ts",
      "test/executors-*.test.ts", "test/gl-export.test.ts", "test/ledger-*.test.ts", "test/month*.test.ts",
      "test/passkey*.test.ts", "test/payment-batch.test.ts", "test/payouts-*.test.ts", "test/stock.test.ts",
      "test/supplier-facts.test.ts", "test/vault-*.test.ts", "test/cloud-sync.test.ts",
    ],
    // A test that needs better-sqlite3 itself (a second connection to one file that must wait for a lock, backup) is
    // left out here by name, with the reason. None is today: every file above passes through the handle.
    exclude: [],
    // test/shim-handle.test.ts expects the Durable Object handle when this is set, better-sqlite3's otherwise.
    env: { PURSER_LEDGER_HANDLE: "shim" },
  },
}));
