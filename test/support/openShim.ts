// src/db/open.ts as the engine and its tests import it (openDb, type DB, settlementsTable), but the handle it hands out
// is the Durable Object handle (src/db/doSql.ts) over a stand-in for a Durable Object's storage (./doStorage.ts), which
// sits on a better-sqlite3 database opened the same way as the real opener does. vitest.shim.config.ts swaps this file
// in for every import of the opener (npm run test:shim), so the engine's own tests cross the handle's parameter layout,
// change counting and transactions. Never imported by the plain run or by the product.
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { doDb } from "../../src/db/doSql.js";
import { prepareDb } from "../../src/db/migrate.js";
import { sqliteDoStorage } from "./doStorage.js";

export { settlementsTable } from "../../src/db/migrate.js";

export type DB = Database.Database;

const SCHEMA = readFileSync(new URL("../../src/db/schema.sql", import.meta.url), "utf8");
const LEDGER = readFileSync(new URL("../../src/db/ledger.sql", import.meta.url), "utf8");

/** Opens (and creates) the ledger, as src/db/open.ts does, and hands it out behind the Durable Object handle. */
export function openDb(path = process.env.KIT11_DB ?? "data/kit11.sqlite"): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path);
  raw.pragma("busy_timeout = 5000");
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  const db = doDb(sqliteDoStorage(raw), path);
  prepareDb(db, SCHEMA, LEDGER);
  return db;
}
