// A dev test proposal: approvable like any other, and its "execution" only records that nothing moved.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { executeDevTest, proposeDevTest } from "../src/executors/devTest.js";
import { decide } from "../src/policy/approvals.js";

describe("dev test proposal", () => {
  it("is labelled as a dev test, and executing it moves nothing", () => {
    const t0 = new Date("2026-10-29T10:00:00Z");
    const db = openDb(":memory:");
    const p = proposeDevTest(db, t0);
    const terms = JSON.parse(p.terms_json) as Record<string, string>;
    expect(terms).toMatchObject({ kind: "dev_test", label: "DEV TEST: moves no money", expires_at: "2026-10-29T10:30:00Z" });
    decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, t0);
    executeDevTest(db, p.proposal_id, t0);
    expect(db.prepare("SELECT status FROM proposals").get()).toEqual({ status: "EXECUTED" });
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.executed'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toEqual({ dev_test: true, moved: "nothing" });
  });
});
