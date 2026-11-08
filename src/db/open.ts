import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const SCHEMA = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
/** Purser's own books: the stored general ledger (src/ledger/core.ts). */
const LEDGER = readFileSync(new URL("./ledger.sql", import.meta.url), "utf8");

/** Opens (and creates) the ledger. Use ":memory:" in tests. */
export function openDb(path = process.env.KIT11_DB ?? "data/kit11.sqlite"): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // The runner, the agent API and the CLIs share one ledger: a writer waits for another instead of failing at once.
  // Set first, so that switching a new ledger to WAL, which needs a lock too, also waits for another opener.
  db.pragma("busy_timeout = 5000");
  walWithRetry(db);
  db.pragma("foreign_keys = ON");
  prepare(db);
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

/**
 * The schema and the migrations, safe for several processes opening one ledger at once (the runner and the world start
 * together; review of 5e27de0: two openers both added a missing column, "duplicate column name"). Every check-then-
 * change runs inside one IMMEDIATE transaction, so a second opener waits for the first and then finds nothing to do; a
 * crash rolls it back. (Better-sqlite3 transactions are synchronous, so no writer holds the lock for long.) The two
 * table swaps that need foreign keys off, which SQLite ignores inside a transaction, re-check inside their own
 * IMMEDIATE transactions. Every step is idempotent.
 */
function prepare(db: DB): void {
  db.transaction(() => {
    db.exec(SCHEMA);
    db.exec(LEDGER);
    migrate(db);
  }).immediate();
  allowPasskeyApprovals(db);
  allowPasskeyRejections(db);
}

/** Columns added after a ledger was first created. Each runs once; CREATE TABLE covers new ledgers. */
function migrate(db: DB): void {
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  // Backend review B4: the policy version a proposal, an approval and a hold were made under.
  for (const t of ["proposals", "approvals", "holds"]) if (!has(t, "policy_version")) db.exec(`ALTER TABLE ${t} ADD COLUMN policy_version INTEGER`);
  // Bookkeeping core: a sale's key on its stock move (review of PR #108, finding 4), once per sale.
  if (!has("stock_moves", "ref")) db.exec("ALTER TABLE stock_moves ADD COLUMN ref TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS stock_moves_ref ON stock_moves (sku, ref) WHERE ref IS NOT NULL");
  if (!has("sales", "requirements_json")) db.exec("ALTER TABLE sales ADD COLUMN requirements_json TEXT");
  if (!has("upstream_purchases", "supplier")) db.exec("ALTER TABLE upstream_purchases ADD COLUMN supplier TEXT");
  if (!has("transfers", "fee_actual")) db.exec("ALTER TABLE transfers ADD COLUMN fee_actual TEXT");
  if (!has("beneficiaries", "status")) db.exec("ALTER TABLE beneficiaries ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'");
  // D24: who decided each money action, recorded when it starts (src/provenance/origin.ts); readers look events up by name.
  db.exec("CREATE INDEX IF NOT EXISTS audit_event ON audit_log (event, seq)");
  for (const t of ["holds", "refunds", "sweeps", "upstream_purchases", "transfers", "money_steps"]) if (!has(t, "origin_json")) db.exec(`ALTER TABLE ${t} ADD COLUMN origin_json TEXT`);
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
  // Dispute decisions (decided once): columns added while the table was being built, for a ledger made in between.
  for (const [column, ddl] of [["audited", "INTEGER NOT NULL DEFAULT 0"], ["attempts", "INTEGER NOT NULL DEFAULT 0"], ["attempted_at", "TEXT"], ["handover_json", "TEXT NOT NULL DEFAULT '[]'"], ["handover_proposal", "TEXT"], ["carrier", "TEXT"], ["held_json", "TEXT NOT NULL DEFAULT '{}'"], ["sent_json", "TEXT NOT NULL DEFAULT '[]'"]] as const) {
    if (!has("dispute_decisions", column)) db.exec(`ALTER TABLE dispute_decisions ADD COLUMN ${column} ${ddl}`);
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
  settlementsTable(db);
}

const SETTLEMENT_COLUMNS = "key, payer, nonce, price_cents, status, sale_id, tx_hash, detail, started_at, updated_at";

/**
 * Ledgers from the first sale_settlements (2 November): the CHARGED state came with the reconciliation of rows left
 * SETTLING, and valid_before with its check on chain. Nothing references this table, so it is rebuilt with its rows, in
 * one IMMEDIATE transaction (SQLite rolls DDL back): a crash leaves the old table whole, and a second process opening
 * the ledger at the same moment waits, then finds it done. Rows stranded by a rebuild without that transaction (in
 * sale_settlements_old, beside an empty new table) are brought back.
 */
export function settlementsTable(db: DB): void {
  const sqlOf = (name: string) => (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string } | undefined)?.sql;
  const due = () => {
    const sql = sqlOf("sale_settlements");
    return !!sqlOf("sale_settlements_old") || (!!sql && (!sql.includes("'CHARGED'") || !sql.includes("valid_before")));
  };
  if (!due()) return;
  db.transaction(() => {
    if (!due()) return; // another process did it while this one waited for the lock
    const cols = (name: string) => (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
    const copy = (from: string) => {
      const have = new Set(cols(from));
      const list = [...SETTLEMENT_COLUMNS.split(", "), "valid_before"].filter((c) => have.has(c)).join(", ");
      // The newest copy of a row wins: the current table is copied first, the stranded one only fills in. Plain INSERT
      // (not OR IGNORE, which would also drop a row the new table refuses): any refusal rolls the whole rebuild back.
      db.exec(`INSERT INTO sale_settlements_v2 (${list}) SELECT ${list} FROM ${from} WHERE key NOT IN (SELECT key FROM sale_settlements_v2)`);
    };
    db.exec(`DROP TABLE IF EXISTS sale_settlements_v2;
      CREATE TABLE sale_settlements_v2 (key TEXT PRIMARY KEY, payer TEXT NOT NULL, nonce TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        status TEXT NOT NULL CHECK (status IN ('SETTLING', 'DONE', 'FAILED', 'CHARGED')), sale_id INTEGER REFERENCES sales(sale_id), tx_hash TEXT, detail TEXT,
        valid_before INTEGER, started_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    for (const t of ["sale_settlements", "sale_settlements_old"]) {
      if (!sqlOf(t)) continue;
      copy(t);
      db.exec(`DROP TABLE ${t}`);
    }
    db.exec(`ALTER TABLE sale_settlements_v2 RENAME TO sale_settlements;
      DROP INDEX IF EXISTS sale_settlements_open;
      CREATE INDEX sale_settlements_open ON sale_settlements (status);`);
  }).immediate();
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
      // Another process may have done it while this one waited for the lock.
      if (((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'approvals'").get() as { sql: string }).sql).includes("'passkey'")) return;
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
      if (((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'passkey_assertions'").get() as { sql: string }).sql).includes("'REJECTED'")) return;
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

