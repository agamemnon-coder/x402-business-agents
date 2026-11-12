// Which ledger handle the engine's opener hands out. Under the plain run it is better-sqlite3's own; under
// vitest.shim.config.ts (npm run test:shim) every import of src/db/open.ts is swapped for test/support/openShim.ts,
// so the same tests cross the Durable Object handle (src/db/doSql.ts). If the swap stopped working, the shim run would
// quietly test better-sqlite3 again: this file is what fails then.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openDb, settlementsTable } from "../src/db/open.js";
import { OPENER_IMPORT } from "./support/shimAlias.js";

const shimRun = process.env.PURSER_LEDGER_HANDLE === "shim";
const handleName = (db: unknown): string => (db as { constructor: { name: string } }).constructor.name;

it(`the opener hands out ${shimRun ? "the Durable Object handle (shim run)" : "better-sqlite3's handle (plain run)"}`, () => {
  const db = openDb(":memory:");
  expect(handleName(db)).toBe(shimRun ? "DoDatabase" : "Database");
});

it("a module that loads the opener while it runs gets the same handle", async () => {
  const { openDb: later } = await import("../src/db/open.js");
  expect(handleName(later(":memory:"))).toBe(shimRun ? "DoDatabase" : "Database");
});

it("the handle is a prepared ledger either way: schema, migrations, foreign keys on", () => {
  const db = openDb(":memory:");
  expect(() => settlementsTable(db)).not.toThrow();
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toEqual(expect.arrayContaining(["audit_log", "proposals", "approvals", "ap_invoices", "ledger_entries"]));
});

// The swap goes by how an import is written (test/support/shimAlias.ts). Every import of the opener that runs, in the
// engine, the cloud and the tests, must be written a way the swap catches; and nothing else may be caught by it.
it("every import of the opener in the tree is one the shim run swaps, and only those", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const opener = resolve(root, "src/db/open.ts");
  const files = ["src", "cloud/src", "test", "examples"].flatMap((dir) =>
    (readdirSync(resolve(root, dir), { recursive: true }) as string[]).filter((f) => f.endsWith(".ts")).map((f) => resolve(root, dir, f)));
  expect(files.length).toBeGreaterThan(500);
  // import ... from "x", export ... from "x" and import("x"); an import of types only is gone before anything runs.
  const imports = /(?:^|\n)\s*(import|export)\s+(type\s+)?[^"';]*?from\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/g;
  const missed: string[] = [], wrong: string[] = [];
  let swapped = 0;
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(imports)) {
      const spec = m[3] ?? m[4]!;
      if (m[2] || !spec.startsWith(".")) continue;
      const isOpener = resolve(dirname(file), spec.replace(/\.js$/, ".ts")) === opener;
      const caught = OPENER_IMPORT.test(spec);
      if (isOpener && caught) swapped++;
      if (isOpener && !caught) missed.push(`${relative(root, file)}: "${spec}"`);
      if (!isOpener && caught) wrong.push(`${relative(root, file)}: "${spec}"`);
    }
  }
  expect(missed, "imports of src/db/open.ts the shim run would not swap").toEqual([]);
  expect(wrong, "imports of another file the shim run would swap for the opener").toEqual([]);
  expect(swapped).toBeGreaterThan(200);
});
