import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { beginExecution, createProposal, decide, expireDue, finishExecution } from "../src/policy/approvals.js";

const t0 = new Date("2026-10-30T14:00:00Z");
const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-10-30T14:10:00Z", total: "0.60" };
const prefix = termsHash(terms).slice(0, 8);

function setup() {
  const db = openDb(":memory:");
  createProposal(db, { terms, createdBy: "support" }, t0);
  return db;
}

describe("approvals", () => {
  it("runs once after a matching approval", () => {
    const db = setup();
    expect(decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: prefix, approver: "max", method: "cli" }, t0)).toBe("APPROVED");
    expect(beginExecution(db, "P-0001", undefined, t0)).toEqual(terms);
    expect(() => beginExecution(db, "P-0001", undefined, t0)).toThrow(/EXECUTING, not approved/);
    finishExecution(db, "P-0001", "EXECUTED", {}, t0);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("refuses a wrong prefix and records nothing", () => {
    const db = setup();
    expect(() => decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: "00000000", approver: "max", method: "cli" }, t0)).toThrow(/prefix/);
    expect(() => beginExecution(db, "P-0001", undefined, t0)).toThrow(/not approved/);
  });

  it("refuses to execute a rejected proposal", () => {
    const db = setup();
    decide(db, { proposalId: "P-0001", decision: "REJECTED", typedPrefix: prefix, approver: "max", method: "cli" }, t0);
    expect(() => beginExecution(db, "P-0001", undefined, t0)).toThrow(/REJECTED/);
  });

  it("voids an approval once the proposal expires", () => {
    const db = setup();
    decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: prefix, approver: "max", method: "cli" }, t0);
    const late = new Date("2026-10-30T14:10:01Z");
    expect(() => beginExecution(db, "P-0001", undefined, late)).toThrow(/expired/);
    expect((db.prepare("SELECT status FROM proposals").get() as { status: string }).status).toBe("EXPIRED");
  });

  it("refuses terms changed after approval", () => {
    const db = setup();
    decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: prefix, approver: "max", method: "cli" }, t0);
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = 'P-0001'").run(JSON.stringify({ ...terms, total: "6.00" }));
    expect(() => beginExecution(db, "P-0001", undefined, t0)).toThrow(/do not match/);
  });

  it("stays approved when a precondition fails", () => {
    const db = setup();
    decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: prefix, approver: "max", method: "cli" }, t0);
    expect(() => beginExecution(db, "P-0001", () => { throw new Error("quote used"); }, t0)).toThrow(/quote used/);
    const { status } = db.prepare("SELECT status FROM proposals").get() as { status: string };
    expect(status).toBe("APPROVED");
  });

  it("F1: a decision after expiry approves nothing and records who tried", () => {
    const db = setup();
    const late = new Date("2026-10-30T14:10:01Z");
    expect(decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: prefix, approver: "max", method: "cli" }, late)).toBe("EXPIRED");
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
    const rows = db.prepare("SELECT event, payload_json FROM audit_log WHERE subject = 'P-0001' ORDER BY seq").all() as { event: string; payload_json: string }[];
    expect(rows.map((r) => r.event)).toEqual(["proposal.created", "proposal.expired", "approval.too_late"]);
    expect(JSON.parse(rows[2]!.payload_json)).toMatchObject({ approver: "max", terms_sha256: termsHash(terms) });
    expect(() => beginExecution(db, "P-0001", undefined, late)).toThrow(/EXPIRED/);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("expires stale proposals in one sweep", () => {
    const db = setup();
    expect(expireDue(db, t0)).toEqual([]);
    expect(expireDue(db, new Date("2026-10-30T14:10:00Z"))).toEqual(["P-0001"]);
    expect(() => decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: prefix, approver: "max", method: "cli" }, t0)).toThrow(/EXPIRED/);
  });
});
