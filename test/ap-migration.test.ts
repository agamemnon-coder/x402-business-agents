// Opening a ledger made by an earlier build keeps every new-supplier request with all its columns, whichever of the two
// payables migrations (the CLOSED status, 8 Nov review; the route details, FX payouts) that ledger already had.
// And a ledger made at origin/main's schema opens with everything added since, twice.
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";

const COLS = "add_id TEXT PRIMARY KEY, vendor TEXT NOT NULL, iban TEXT NOT NULL, bic TEXT NOT NULL, source TEXT, requested_by TEXT NOT NULL, verification_json TEXT";
const STATUS = (closed: boolean) => `status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'VERIFIED', 'PROPOSED', 'APPLIED'${closed ? ", 'CLOSED'" : ""}))`;
const SHAPES: Record<string, string> = {
  "6d1f5f3 (neither)": `CREATE TABLE payee_adds (${COLS}, proposal_id TEXT, ${STATUS(false)}, created_at TEXT NOT NULL)`,
  "aec65d0 (CLOSED only)": `CREATE TABLE payee_adds (${COLS}, proposal_id TEXT, ${STATUS(true)}, created_at TEXT NOT NULL)`,
  "fx-payouts (details only)": `CREATE TABLE payee_adds (${COLS}, proposal_id TEXT, ${STATUS(false)}, created_at TEXT NOT NULL, details_json TEXT)`,
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-mig-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("payee_adds on a ledger made by an earlier build", () => {
  for (const [name, ddl] of Object.entries(SHAPES)) {
    it(`keeps every row and column: ${name}`, () => {
      const path = join(dir, "ledger.sqlite");
      openDb(path).close();
      const raw = new Database(path);
      raw.exec("DROP TABLE payee_adds");
      raw.exec(ddl);
      const hasDetails = ddl.includes("details_json");
      raw.prepare(`INSERT INTO payee_adds (add_id, vendor, iban, bic, source, requested_by, verification_json, proposal_id, status, created_at${hasDetails ? ", details_json" : ""})
        VALUES ('N-0001', 'Lagerhaus Nord GmbH', 'DE02120300000000202051', 'BYLADEM1001', 'AP-0001', 'human', '{"how":"called"}', 'P-0007', 'PROPOSED', '2026-11-08T10:00:00Z'${hasDetails ? `, '{"method":"LOCAL"}'` : ""})`).run();
      raw.close();

      const db = openDb(path);
      const cols = (db.prepare("PRAGMA table_info(payee_adds)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(["add_id", "vendor", "iban", "bic", "source", "requested_by", "verification_json", "details_json", "proposal_id", "status", "created_at"]));
      const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'payee_adds'").get() as { sql: string }).sql;
      expect(sql).toContain("'CLOSED'");
      expect(db.prepare("SELECT * FROM payee_adds").all()).toEqual([expect.objectContaining({
        add_id: "N-0001", vendor: "Lagerhaus Nord GmbH", iban: "DE02120300000000202051", proposal_id: "P-0007", status: "PROPOSED",
        verification_json: '{"how":"called"}', details_json: hasDetails ? '{"method":"LOCAL"}' : null,
      })]);
      db.prepare("UPDATE payee_adds SET status = 'CLOSED' WHERE add_id = 'N-0001'").run();
      db.close();
      openDb(path).close();
    });
  }
});

// A ledger made at origin/main's schema (b704672, before payables, the stored ledger, the ERP feed and FX payouts) opens
// with every new table and column, keeps its rows, and opens again without change (the migrations are idempotent).
describe("a ledger made at main's schema", () => {
  it("gains the new tables and columns, keeps its rows, and reopens unchanged", () => {
    const path = join(dir, "ledger.sqlite");
    const raw = new Database(path);
    raw.exec(readFileSync(new URL("./fixtures/schema-main-b704672.sql", import.meta.url), "utf8"));
    raw.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('B-1', 'Lagerhaus Nord GmbH', '2051', 'abc', 'BYLADEM1001', 'EUR', 'SEPA')").run();
    raw.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('ap.limit', '500', '2026-11-01T00:00:00Z')").run();
    raw.close();

    const schemaOf = (db: Database.Database) => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    const db = openDb(path);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["ap_invoices", "ap_documents", "payee_adds", "payout_reservations", "ledger_entries", "ledger_lines", "ledger_locks"]));
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("beneficiaries")).toEqual(expect.arrayContaining(["status", "details_json"]));
    expect(cols("payee_adds")).toContain("details_json");
    expect(db.prepare("SELECT beneficiary_id, name, status, details_json FROM beneficiaries").all()).toEqual([{ beneficiary_id: "B-1", name: "Lagerhaus Nord GmbH", status: "ACTIVE", details_json: null }]);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'ap.limit'").get()).toEqual({ value: "500" });
    const first = schemaOf(db);
    db.close();

    const again = openDb(path);
    expect(schemaOf(again)).toEqual(first);
    again.close();
  });
});
