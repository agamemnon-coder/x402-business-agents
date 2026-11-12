// SPIKE: src/db/open.ts as the engine's tests import it, but the handle is the Durable Object shim over a stand-in
// SqlStorage (doStorage.ts). vitest.shim.config.ts swaps it in for every import of ".../db/open.js".
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DoDatabase } from "../../../src/db/doSql.js";
import { prepareDb } from "../../../src/db/migrate.js";
import { sqliteDoStorage } from "./doStorage.js";

export { settlementsTable } from "../../../src/db/migrate.js";
export type DB = Database.Database;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCHEMA = readFileSync(resolve(root, "src/db/schema.sql"), "utf8");
const LEDGER = readFileSync(resolve(root, "src/db/ledger.sql"), "utf8");

export function openDb(path = process.env.KIT11_DB ?? "data/kit11.sqlite"): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path);
  raw.pragma("busy_timeout = 5000");
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  const db = new DoDatabase(sqliteDoStorage(raw), path) as unknown as DB;
  prepareDb(db, SCHEMA, LEDGER);
  return db;
}
