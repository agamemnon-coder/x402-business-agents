// SPIKE: under vitest.shim.config.ts the engine's opener hands out the Durable Object shim; under the plain config, better-sqlite3.
import { expect, it } from "vitest";
import { openDb } from "../../../src/db/open.js";

it("says which ledger handle the tests get", () => {
  const db = openDb(":memory:");
  const name = (db as unknown as { constructor: { name: string } }).constructor.name;
  console.log(`ledger handle: ${name}`);
  expect(["DoDatabase", "Database"]).toContain(name);
  if (process.env.EXPECT_HANDLE) expect(name).toBe(process.env.EXPECT_HANDLE);
});
