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
  if (!has("beneficiaries", "status")) db.exec("ALTER TABLE beneficiaries ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'");
  if (!has("sales", "scheme")) db.exec("ALTER TABLE sales ADD COLUMN scheme TEXT NOT NULL DEFAULT 'exact'");
  if (!has("sales", "clearing_json")) db.exec("ALTER TABLE sales ADD COLUMN clearing_json TEXT");
  allowPasskeyApprovals(db);
  allowPasskeyRejections(db);
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
      const dangling = db.pragma("foreign_key_check(approvals)") as unknown[];
      if (dangling.length > 0) throw new Error(`foreign key check failed after migrating approvals: ${JSON.stringify(dangling)}`);
    }).immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/** Ledgers from before passkey rejections: the stored-signature table's outcome CHECK gains 'REJECTED' (rebuilt once). */
function allowPasskeyRejections(db: DB): void {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'passkey_assertions'").get() as { sql: string };
  if (sql.includes("'REJECTED'")) return;
  const ddl = sql
    .replace(/^CREATE TABLE "?passkey_assertions"?/, "CREATE TABLE passkey_assertions_v2")
    .replace("CHECK (outcome IN ('APPROVED', 'TOO_LATE'))", "CHECK (outcome IN ('APPROVED', 'TOO_LATE', 'REJECTED'))");
  if (!ddl.startsWith("CREATE TABLE passkey_assertions_v2") || !ddl.includes("'REJECTED'")) throw new Error("the passkey_assertions table has an unexpected shape; not migrating it");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(ddl);
      db.exec("INSERT INTO passkey_assertions_v2 SELECT * FROM passkey_assertions");
      db.exec("DROP TABLE passkey_assertions");
      db.exec("ALTER TABLE passkey_assertions_v2 RENAME TO passkey_assertions");
      const dangling = db.pragma("foreign_key_check(passkey_assertions)") as unknown[];
      if (dangling.length > 0) throw new Error(`foreign key check failed after migrating passkey_assertions: ${JSON.stringify(dangling)}`);
    }).immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
