// 16 Nov (owner): a supplier invoice's payment approved by code, without a person, only when its exact stored terms are
// within the CFO's limit to pay alone (src/policy/approvals.ts approveWithinLimit). This is the last check before the
// executor; every refusal leaves the proposal waiting for the CFO, untouched. Breaks if an amount above the limit, in
// another currency, of another kind or with changed terms is ever approved this way, or if the approval is not the
// policy's own (method "policy", no passkey).
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { approveWithinLimit, beginExecution, createProposal, WITHIN_LIMIT } from "../src/policy/approvals.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";

const NOW = new Date("2026-11-16T10:00:00Z");
const LIMIT = { currency: "EUR", amount: "500.00" };
const file = (db: DB, id: string, o: Record<string, unknown>) =>
  createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-16T11:00:00.000Z", amount: "120.00", currency: "EUR", ...o } as Terms, createdBy: "treasury" }, NOW);
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const approve = (db: DB, id: string) => approveWithinLimit(db, { proposalId: id, limit: LIMIT, rule: "within the EUR 500.00 limit", agent: "payer" }, NOW);

describe("a payment approved within the CFO's limit to pay alone", () => {
  it("approves the exact terms by the policy, at or below the limit, ready for the executor", () => {
    const db = openDb(":memory:");
    for (const [id, amount] of [["P-0001", "120.00"], ["P-0002", "500.00"]] as const) {
      file(db, id, { amount });
      expect(approve(db, id)).toEqual({ ok: true });
      expect(status(db, id)).toBe("APPROVED");
      expect(db.prepare("SELECT approver, method, decision FROM approvals WHERE proposal_id = ?").get(id)).toEqual({ approver: "Purser's code", method: "policy", decision: "APPROVED" });
      expect(() => beginExecution(db, id, () => {}, NOW)).not.toThrow();
    }
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?").get(WITHIN_LIMIT) as { n: number }).n).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'proposal.approved'").get()).toEqual({ n: 0 });
  });

  it("leaves to the CFO an amount above the limit, another currency, another kind, changed terms or one already decided", () => {
    const db = openDb(":memory:");
    file(db, "P-0001", { amount: "500.01" });
    file(db, "P-0002", { currency: "USD" });
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0003", expires_at: "2026-11-16T11:00:00.000Z", amount: "10.00", currency: "EUR" } as Terms, createdBy: "support" }, NOW);
    file(db, "P-0004", {});
    db.prepare("UPDATE proposals SET terms_json = json_set(terms_json, '$.amount', '1850.00') WHERE proposal_id = 'P-0004'").run();
    file(db, "P-0005", {});
    expect(approve(db, "P-0005")).toEqual({ ok: true });
    for (const id of ["P-0001", "P-0002", "P-0003", "P-0004", "P-0005"]) expect(approve(db, id).ok, id).toBe(false);
    for (const id of ["P-0001", "P-0002", "P-0003", "P-0004"]) expect(status(db, id), id).toBe("PENDING_APPROVAL");
    expect((db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n).toBe(1);
  });
});
