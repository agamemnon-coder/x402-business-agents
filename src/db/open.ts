import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { prepareDb } from "./migrate.js";

// The schema and its migrations live in ./migrate.ts, which imports nothing from Node: a Durable Object runs the same
// steps over its own SQLite (src/db/doSql.ts).
export { settlementsTable } from "./migrate.js";

export type DB = Database.Database;

const SCHEMA = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
/** Purser's own books: the stored general ledger (src/ledger/core.ts). */
const LEDGER = readFileSync(new URL("./ledger.sql", import.meta.url), "utf8");

/** Where the ledger is when KIT11_DB names no other file. */
export const DEFAULT_LEDGER = "data/kit11.sqlite";

/** Opens (and creates) the ledger. Use ":memory:" in tests. */
export function openDb(path = process.env.KIT11_DB ?? DEFAULT_LEDGER): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // The runner, the agent API and the CLIs share one ledger: a writer waits for another instead of failing at once.
  // Set first, so that switching a new ledger to WAL, which needs a lock too, also waits for another opener.
  db.pragma("busy_timeout = 5000");
  walWithRetry(db);
  db.pragma("foreign_keys = ON");
  prepareDb(db, SCHEMA, LEDGER);
  return db;
}

/**
 * Switching a new ledger to WAL can return SQLITE_BUSY at once, without the busy handler, while another process is
 * switching the same file (CI run 41586612679: 1 of 4 concurrent openers failed). Retry for up to 5 s; any other error,
 * or still busy after that, is thrown.
 */
function walWithRetry(db: DB): void {
  const until = Date.now() + 5000;
  for (;;) {
    try { db.pragma("journal_mode = WAL"); return; } catch (e) {
      if ((e as { code?: string }).code !== "SQLITE_BUSY" || Date.now() >= until) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 + Math.floor(Math.random() * 50));
    }
  }
}
