// A ledger made by an older Purser is brought up to date when it is opened (src/db/migrate.ts prepareDb): the columns
// added since come back, the tables whose CHECK widened are rebuilt with their rows (a task card may be PENDING, finality
// evidence once CERTIFIED reads REPORTED, an approval may be by passkey or by policy, a passkey may sign a rejection), and
// running it again changes nothing. The old ledger is made here from today's by taking those changes out again.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { prepareDb } from "../src/db/migrate.js";

const SCHEMA = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
const LEDGER = readFileSync(new URL("../src/db/ledger.sql", import.meta.url), "utf8");
const sqlOf = (db: DB, t: string) => (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) as { sql: string } | undefined)?.sql ?? "";
const columns = (db: DB, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

/** Rebuilds a table as an older ledger had it: its CREATE text with `from` replaced by `to`, its rows kept. */
function older(db: DB, table: string, from: string, to: string): void {
  const sql = sqlOf(db, table);
  expect(sql, `${table}'s CREATE text`).toContain(from);
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  db.exec(`ALTER TABLE ${table} RENAME TO ${table}_today`);
  db.exec(sql.replace(from, to));
  db.exec(`INSERT INTO ${table} SELECT * FROM ${table}_today; DROP TABLE ${table}_today`);
  db.pragma("legacy_alter_table = OFF");
  db.pragma("foreign_keys = ON");
}
/** Takes a column out as a ledger from before it had it, with the indexes on it. */
function dropColumn(db: DB, table: string, column: string): void {
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table) as { name: string; sql: string }[];
  for (const i of idx) if (new RegExp(`\\b${column}\\b`).test(i.sql.replace(/^CREATE (UNIQUE )?INDEX \S+/, ""))) db.exec(`DROP INDEX ${i.name}`);
  db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

describe("opening an older ledger", () => {
  it("adds back every column added since, and a second opening finds nothing to do", () => {
    const db = openDb(":memory:");
    const gone: [string, string][] = [
      ["proposals", "policy_version"], ["stock_moves", "ref"], ["ledger_entries", "rail_ref"], ["sales", "requirements_json"], ["transfers", "fee_actual"],
      ["beneficiaries", "status"], ["ap_invoices", "period"], ["ap_invoices", "lines"], ["ap_invoices", "credit_accepted_by"], ["sales", "clearing_json"],
      ["passkey_enrolments", "label"], ["passkey_enrolments", "adds"], ["cards", "active_to"], ["cards", "allowed_currencies"], ["cards", "allowed_mccs"],
      ["dispute_decisions", "carrier"], ["dispute_decisions", "sent_json"],
    ];
    for (const [t, c] of gone) {
      try { dropColumn(db, t, c); } catch (e) { throw new Error(`${t}.${c}: ${(e as Error).message}`, { cause: e }); }
      expect(columns(db, t)).not.toContain(c);
    }
    // payment_id is UNIQUE, which SQLite cannot drop: the (empty) table is made as it was before it.
    db.exec("DROP TABLE velocity_events; CREATE TABLE velocity_events (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, rail TEXT NOT NULL, cents INTEGER NOT NULL, approved INTEGER NOT NULL, at TEXT NOT NULL)");

    prepareDb(db, SCHEMA, LEDGER);
    for (const [t, c] of gone) expect(columns(db, t), t).toContain(c);
    expect(columns(db, "velocity_events")).toContain("payment_id");
    for (const i of ["velocity_payment_id", "stock_moves_ref"]) expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(i), i).toBeTruthy();
    const before = db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
    prepareDb(db, SCHEMA, LEDGER);
    expect(db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all()).toEqual(before);
  });

  it("rebuilds the tables whose status check widened, keeping their rows", () => {
    const db = openDb(":memory:");
    older(db, "task_cards", "'PENDING', ", "");
    older(db, "finality_evidence", "'REPORTED', ", "'CERTIFIED', ");
    db.prepare("INSERT INTO finality_evidence (tx, block_hash, status, recorded_at) VALUES ('0xabc', '0xdef', 'CERTIFIED', '2026-11-01T00:00:00Z')").run();
    older(db, "airwallex_events", "'payment_intent', ", "");
    older(db, "ap_sink_events", ", 'return'", "");
    older(db, "payee_adds", ", 'CLOSED'", "");
    db.prepare("INSERT INTO payee_adds (add_id, vendor, iban, bic, requested_by, status, created_at) VALUES ('A-1', 'Bergtex', 'DE89370400440532013000', 'COBADEFFXXX', 'cfo', 'PROPOSED', '2026-11-01T00:00:00Z')").run();
    expect(() => db.prepare("UPDATE payee_adds SET status = 'CLOSED'").run()).toThrow(/CHECK/);

    prepareDb(db, SCHEMA, LEDGER);
    expect(sqlOf(db, "task_cards")).toContain("'PENDING'");
    expect(db.prepare("SELECT status FROM finality_evidence WHERE tx = '0xabc'").get()).toEqual({ status: "REPORTED" });
    expect(sqlOf(db, "airwallex_events")).toContain("'payment_intent'");
    expect(sqlOf(db, "ap_sink_events")).toContain("'return'");
    db.prepare("UPDATE payee_adds SET status = 'CLOSED' WHERE add_id = 'A-1'").run();
    expect(db.prepare("SELECT vendor, status FROM payee_adds").all()).toEqual([{ vendor: "Bergtex", status: "CLOSED" }]);
    for (const t of ["task_cards_old", "finality_evidence_old", "airwallex_events_old", "ap_sink_events_old", "payee_adds_old"]) expect(sqlOf(db, t)).toBe("");
  });

  it("lets an approval be by passkey and by policy, and a passkey sign a rejection, on a ledger from before them", () => {
    const db = openDb(":memory:");
    older(db, "approvals", "'telegram', 'passkey', 'policy'", "'telegram'");
    older(db, "passkey_assertions", ", 'REJECTED'", "");
    prepareDb(db, SCHEMA, LEDGER);
    expect(sqlOf(db, "approvals")).toContain("'passkey', 'policy'");
    expect(sqlOf(db, "passkey_assertions")).toContain("'REJECTED'");
    expect(sqlOf(db, "approvals_v2") + sqlOf(db, "approvals_v3") + sqlOf(db, "passkey_assertions_v2")).toBe("");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("refuses to rebuild an approvals table of a shape it does not know", () => {
    const db = openDb(":memory:");
    older(db, "approvals", "'telegram', 'passkey', 'policy'", "'telegram', 'email'");
    expect(() => prepareDb(db, SCHEMA, LEDGER)).toThrow("the approvals table has an unexpected shape; not migrating it");
    const db2 = openDb(":memory:");
    older(db2, "passkey_assertions", "('APPROVED', 'TOO_LATE', 'REJECTED')", "('APPROVED', 'LATE')");
    expect(() => prepareDb(db2, SCHEMA, LEDGER)).toThrow("the passkey_assertions table has an unexpected shape; not migrating it");
  });
});
