import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const SCHEMA = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/** Opens (and creates) the ledger. Use ":memory:" in tests. */
export function openDb(path = process.env.KIT11_DB ?? "data/kit11.sqlite"): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after a ledger was first created. Each runs once; CREATE TABLE covers new ledgers. */
function migrate(db: DB): void {
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!has("sales", "requirements_json")) db.exec("ALTER TABLE sales ADD COLUMN requirements_json TEXT");
  if (!has("transfers", "fee_actual")) db.exec("ALTER TABLE transfers ADD COLUMN fee_actual TEXT");
}
