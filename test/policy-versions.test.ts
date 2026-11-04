import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { proposePolicyChange, executePolicyChange } from "../src/executors/policyChange.js";
import { audit } from "../src/audit/log.js";
import { reserveSpend } from "../src/policy/holds.js";
import { policyAt, policyVersion, policyVersionChecks } from "../src/policy/versions.js";

const now = new Date("2026-11-03T10:00:00Z");
const later = (min: number) => new Date(now.getTime() + min * 60_000);
const approve = (db: DB, id: string, at: Date) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, at);
};
const devTest = (db: DB, id: string, at: Date) =>
  createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "dev_test", proposal_id: id, expires_at: "2099-01-01T00:00:00Z" } as never, createdBy: "treasury" }, at);

describe("policy versions (B4)", () => {
  it("records the version a proposal and its approval were made under, and a new version when a rule changes", () => {
    const db = openDb(":memory:");
    devTest(db, "P-0001", now);
    approve(db, "P-0001", later(1));
    const raise = proposePolicyChange(db, { changes: [{ key: "cap.support", to: "0.05" }], reason: "tighter refunds" }, "treasury", later(2));
    approve(db, raise.proposal_id, later(3));
    executePolicyChange(db, raise.proposal_id, later(4));
    devTest(db, "P-0003", later(5));
    approve(db, "P-0003", later(6));

    const rows = db.prepare("SELECT p.proposal_id, p.policy_version AS made, a.policy_version AS signed FROM proposals p JOIN approvals a USING (proposal_id) ORDER BY p.proposal_id").all();
    expect(rows).toEqual([
      { proposal_id: "P-0001", made: 1, signed: 1 },
      { proposal_id: "P-0002", made: 1, signed: 1 },
      { proposal_id: "P-0003", made: 2, signed: 2 },
    ]);
    expect(policyAt(db, 1)!.values["cap.support"]).toBe("");
    expect(policyAt(db, 2)!.values["cap.support"]).toBe("0.05");
    const v2 = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'policy.version' AND subject = 'v2'").get() as { payload_json: string };
    expect(JSON.parse(v2.payload_json).changed).toEqual([{ key: "cap.support", from: "", to: "0.05" }]);
    const approved = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.approved' AND subject = 'P-0003'").get() as { payload_json: string };
    expect(JSON.parse(approved.payload_json).policy_version).toBe(2);
    expect(policyVersionChecks(db).every((c) => c.ok)).toBe(true);
    expect(policyVersionChecks(db).find((c) => c.what === "P-0003 approved")?.detail).toMatch(/^under policy v2 /);
  });

  it("does not make a new version when nothing changed", () => {
    const db = openDb(":memory:");
    expect(policyVersion(db, now)).toEqual(policyVersion(db, later(1)));
    expect(db.prepare("SELECT COUNT(*) AS n FROM policy_versions").get()).toEqual({ n: 1 });
  });

  it("records the version on every hold", () => {
    const db = openDb(":memory:");
    audit(db, "treasury", "mandate.bound", "support", { cap: "0.10", budget: "1.00", payee: "0x0000000000000000000000000000000000000001" }, now);
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 5, ref: "r1", now })).toBeNull();
    expect(db.prepare("SELECT policy_version FROM holds").get()).toEqual({ policy_version: 1 });
  });

  it("fails verify when a stored version's rules were altered afterwards", () => {
    const db = openDb(":memory:");
    devTest(db, "P-0001", now);
    approve(db, "P-0001", later(1));
    db.prepare(`UPDATE policy_versions SET values_json = replace(values_json, '"cap.support":""', '"cap.support":"9.99"') WHERE version = 1`).run();
    expect(policyVersionChecks(db).find((c) => c.what === "policy v1")).toMatchObject({ ok: false });
  });
});
