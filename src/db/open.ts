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
  // The runner, the agent API and the CLIs share one ledger: a writer waits for another instead of failing at once.
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after a ledger was first created. Each runs once; CREATE TABLE covers new ledgers. */
function migrate(db: DB): void {
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  // Backend review B4: the policy version a proposal, an approval and a hold were made under.
  for (const t of ["proposals", "approvals", "holds"]) if (!has(t, "policy_version")) db.exec(`ALTER TABLE ${t} ADD COLUMN policy_version INTEGER`);
  if (!has("sales", "requirements_json")) db.exec("ALTER TABLE sales ADD COLUMN requirements_json TEXT");
  if (!has("transfers", "fee_actual")) db.exec("ALTER TABLE transfers ADD COLUMN fee_actual TEXT");
  if (!has("beneficiaries", "status")) db.exec("ALTER TABLE beneficiaries ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'");
  if (!has("sales", "scheme")) db.exec("ALTER TABLE sales ADD COLUMN scheme TEXT NOT NULL DEFAULT 'exact'");
  if (!has("sales", "clearing_json")) db.exec("ALTER TABLE sales ADD COLUMN clearing_json TEXT");
  // E1: more than one person may hold an active passkey (one each), and an enrolment window may add a named person.
  db.exec("DROP INDEX IF EXISTS one_active_passkey");
  if (!has("passkey_enrolments", "label")) db.exec("ALTER TABLE passkey_enrolments ADD COLUMN label TEXT");
  if (!has("passkey_enrolments", "adds")) db.exec("ALTER TABLE passkey_enrolments ADD COLUMN adds INTEGER NOT NULL DEFAULT 0");
  // Card controls (governance: what, in which currency, until when).
  if (!has("cards", "allowed_mccs")) {
    db.exec("ALTER TABLE cards ADD COLUMN allowed_mccs TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE cards ADD COLUMN allowed_currencies TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE cards ADD COLUMN active_to TEXT");
  }
  // Task cards are reserved (PENDING) before Airwallex is asked: widen the status check of an older table.
  const tc = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_cards'").get() as { sql: string } | undefined;
  if (tc && !tc.sql.includes("'PENDING'")) {
    db.exec(`ALTER TABLE task_cards RENAME TO task_cards_old;
      CREATE TABLE task_cards (task_id TEXT PRIMARY KEY CHECK (task_id LIKE 'task:%'), proposal_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, purpose TEXT NOT NULL,
        mccs TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), valid_until TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'USED', 'FAILED')), created_at TEXT NOT NULL);
      INSERT INTO task_cards SELECT * FROM task_cards_old; DROP TABLE task_cards_old;`);
  }
  // Velocity limits: a Metal payment's id, so a retry under it is counted once.
  if (!has("velocity_events", "payment_id")) {
    db.exec("ALTER TABLE velocity_events ADD COLUMN payment_id TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS velocity_payment_id ON velocity_events (payment_id)");
  }
  // Finality evidence (enterprise item 3): CERTIFIED became REPORTED (the BLS signature is not verified), and NOT_FOUND.
  const fe = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'finality_evidence'").get() as { sql: string } | undefined;
  if (fe && !fe.sql.includes("'REPORTED'")) {
    db.exec(`ALTER TABLE finality_evidence RENAME TO finality_evidence_old;
      CREATE TABLE finality_evidence (tx TEXT PRIMARY KEY, block_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('REPORTED', 'FAILED', 'NOT_KEPT', 'NOT_FOUND')), recorded_at TEXT NOT NULL);
      INSERT INTO finality_evidence SELECT tx, block_hash, CASE status WHEN 'CERTIFIED' THEN 'REPORTED' ELSE status END, recorded_at FROM finality_evidence_old;
      DROP TABLE finality_evidence_old;`);
  }
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
