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
  allowPasskeyApprovals(db);
}

/** Ledgers from before passkey approvals: SQLite cannot change a CHECK, so the approvals table is rebuilt once. */
function allowPasskeyApprovals(db: DB): void {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'approvals'").get() as { sql: string };
  if (sql.includes("'passkey'")) return;
  const ddl = sql
    .replace(/^CREATE TABLE "?approvals"?/, "CREATE TABLE approvals_v2")
    .replace("CHECK (method IN ('web', 'cli', 'telegram'))", "CHECK (method IN ('web', 'cli', 'telegram', 'passkey'))");
  if (!ddl.startsWith("CREATE TABLE approvals_v2") || !ddl.includes("'passkey'")) throw new Error("the approvals table has an unexpected shape; not migrating it");
  // Foreign keys must be off while the table is swapped; the check below proves nothing dangles.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(ddl);
      db.exec("INSERT INTO approvals_v2 SELECT * FROM approvals");
      db.exec("DROP TABLE approvals");
      db.exec("ALTER TABLE approvals_v2 RENAME TO approvals");
      const dangling = db.pragma("foreign_key_check") as unknown[];
      if (dangling.length > 0) throw new Error(`foreign key check failed after migrating approvals: ${JSON.stringify(dangling)}`);
    }).immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
