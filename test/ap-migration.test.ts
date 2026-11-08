// Opening a ledger made by an earlier build keeps every new-supplier request with all its columns, whichever of the two
// payables migrations (the CLOSED status, 8 Nov review; the route details, FX payouts) that ledger already had.
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
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
