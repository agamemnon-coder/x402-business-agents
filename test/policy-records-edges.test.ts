// What the policy records say, on the paths the other files leave (src/policy/velocity.ts stopReason,
// src/policy/versions.ts, src/policy/blocked.ts, src/policy/rules.ts): an agent stopped with no record of why was
// stopped by the CFO, one stopped by an incident says so; verify skips an approval from before policy versions and
// fails one naming a version recorded only after it; an approval blocked with no reason or check recorded reads as
// "other", and terms that cannot be read leave the column's expiry; a ledger without an audit log has nothing blocked;
// the fee reserve of a payable currency with no listed default, and a change from a setting that is not set.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { BLOCKED_EVENT, blockedApprovals } from "../src/policy/blocked.js";
import { feeReserveDefaultCents, payoutRule, rules, validateChange } from "../src/policy/rules.js";
import { stopReason } from "../src/policy/velocity.js";
import { policyAt, policyVersionChecks } from "../src/policy/versions.js";

const now = new Date("2026-11-20T10:00:00Z");
const setting = (db: DB, key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, now.toISOString());

describe("why an agent is stopped", () => {
  it("not stopped: nothing; stopped with no record: by the CFO; by an incident: says which; a record without words: empty", () => {
    const db = openDb(":memory:");
    expect(stopReason(db, "sourcing")).toBeNull();
    setting(db, "stop.sourcing", "on");
    expect(stopReason(db, "sourcing")).toEqual({ since: "", reason: "stopped by the CFO" });
    audit(db, "system", "upstream.let_through_incident", "x", { stopped: "sourcing", what: "Metal accepted a payment over the cap" }, now);
    expect(stopReason(db, "sourcing")).toEqual({ since: now.toISOString(), reason: "incident: Metal accepted a payment over the cap" });
    audit(db, "system", "velocity.tripped", "sourcing", {}, now);
    expect(stopReason(db, "sourcing")).toMatchObject({ reason: "" });
  });
});

describe("policy versions in verify", () => {
  function approved(db: DB, id: string) {
    const p = createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: "2026-11-20T11:00:00Z", total: "0.10" } as Terms, createdBy: "support" }, now);
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
  }

  it("skips an approval from before versions; fails one naming a version recorded after it, or none", () => {
    const db = openDb(":memory:");
    approved(db, "P-0001");
    approved(db, "P-0002");
    approved(db, "P-0003");
    db.prepare("UPDATE approvals SET policy_version = NULL WHERE proposal_id = 'P-0001'").run();
    db.prepare("UPDATE approvals SET policy_version = 99 WHERE proposal_id = 'P-0002'").run();
    db.prepare("UPDATE approvals SET created_at = '2026-01-01T00:00:00.000Z' WHERE proposal_id = 'P-0003'").run();
    const checks = policyVersionChecks(db).filter((c) => c.what.startsWith("P-"));
    expect(checks).toEqual([
      { ok: false, what: "P-0002 approved", detail: "names policy v99, which was not recorded before it" },
      { ok: false, what: "P-0003 approved", detail: expect.stringMatching(/^names policy v\d+, which was not recorded before it$/) },
    ]);
    expect(policyAt(db, 99)).toBeNull();
  });
});

describe("approved proposals blocked at execution", () => {
  it("a block recorded without a reason or a check reads as other; terms that cannot be read leave the column's expiry", () => {
    const db = openDb(":memory:");
    const p = createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-20T11:00:00Z", total: "0.10" } as Terms, createdBy: "support" }, now);
    decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
    audit(db, "system", BLOCKED_EVENT, "P-0001", {}, now);
    db.prepare("UPDATE proposals SET terms_json = '{not json' WHERE proposal_id = 'P-0001'").run();
    expect(blockedApprovals(db, now)).toEqual([{ proposal_id: "P-0001", kind: "refund_batch", reason: "", check: "other", severity: "warning", since: now.toISOString(), last: now.toISOString(), expires_at: "2026-11-20T11:00:00Z" }]);
  });

  it("a ledger without an audit log has nothing blocked", () => {
    const db = openDb(":memory:");
    db.exec("DROP TABLE audit_log");
    expect(blockedApprovals(db, now)).toEqual([]);
  });
});

describe("payout rules", () => {
  it("a payable currency with no listed default reserves the general one, and at most ten times it", () => {
    expect(feeReserveDefaultCents("SWIFT", "SEK")).toBe(2500);
    expect(feeReserveDefaultCents("LOCAL", "SEK")).toBe(0);
    expect(payoutRule("fee_reserve.SWIFT.SEK")).toMatchObject({ fallback: "25.00", max: 25_000, unit: "SEK" });
  });

  it("a beneficiary paid by another method adds no fee reserve; a change from a setting that is not set says so", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status, details_json) VALUES ('b1', 'x', '0000', ?, '', 'SEK', 'CARD', 'ACTIVE', '{}')").run("d".repeat(64));
    const keys = rules(db).map((r) => r.key);
    expect(keys).toContain("floor.SEK");
    expect(keys.filter((k) => k.startsWith("fee_reserve."))).toEqual([]);
    expect(validateChange(db, { key: "cap.sourcing", from: "1.00", to: "2.00" })).toBe("Sourcing agent: most per payment is now not set, not 1.00");
  });
});
