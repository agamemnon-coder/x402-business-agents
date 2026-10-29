import { describe, expect, it } from "vitest";
import { audit, GENESIS, verifyAuditChain } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";

describe("audit log", () => {
  it("chains rows and verifies", () => {
    const db = openDb(":memory:");
    const a = audit(db, "system", "boot", null, { v: "1" });
    const b = audit(db, "treasury", "proposal.created", "P-0001", { terms_sha256: "ab" });
    expect(a.prev_hash).toBe(GENESIS);
    expect(b.prev_hash).toBe(a.row_hash);
    expect(verifyAuditChain(db)).toEqual({ ok: true, rows: 2, head: b.row_hash });
  });

  it("refuses updates and deletes", () => {
    const db = openDb(":memory:");
    audit(db, "system", "boot", null, {});
    expect(() => db.prepare("UPDATE audit_log SET event = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  });

  it("detects a tampered row", () => {
    const db = openDb(":memory:");
    audit(db, "system", "boot", null, { amount: "1.00" });
    audit(db, "system", "next", null, {});
    db.exec("DROP TRIGGER audit_log_no_update");
    db.prepare(`UPDATE audit_log SET payload_json = '{"amount":"9.00"}' WHERE seq = 1`).run();
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, seq: 1 });
  });
});
