// dry-131: Treasury proposed a rebalance (P-0002) and nobody approved it before the run ended. Its credentials are
// signed when the proposal is made and bound on chain only after the approval, so verify's "bound on the principal's
// account" check failed on a mandate that, rightly, never became active. Review: options A and B share credentials,
// so approving B (P-0003) binds the credential named after P-0002 and supersedes P-0002; the check goes by the
// credential's hash over every proposal naming it. Breaks if a bound credential without any approval passes, or an
// executed or approved one skips the full check.
import { describe, expect, it } from "vitest";
import { proposalCredentialCheck, type Naming } from "../src/verify/credentials.js";

const p = (proposal_id: string, status: string, approved = false): Naming => ({ proposal_id, status, approved });

describe("verify: a credential a rebalance issued", () => {
  it("gets the full check when no proposal names it, or one naming it was executed", () => {
    expect(proposalCredentialCheck([], 0n)).toEqual({ kind: "full" });
    expect(proposalCredentialCheck([p("P-0002", "EXECUTED", true)], 0n)).toEqual({ kind: "full" });
    // the CFO chose option B: P-0003 executed, P-0002 superseded, the credential is bound
    expect(proposalCredentialCheck([p("P-0002", "SUPERSEDED"), p("P-0003", "EXECUTED", true)], 40n)).toEqual({ kind: "full" });
  });
  it("passes only while unbound when nothing naming it was executed", () => {
    for (const status of ["PENDING_APPROVAL", "REJECTED", "EXPIRED", "SUPERSEDED", "FAILED"]) {
      expect(proposalCredentialCheck([p("P-0002", status), p("P-0003", "PENDING_APPROVAL")], 0n)).toEqual({ kind: "done", ok: true, detail: `issued for P-0002 ${status}, P-0003 PENDING_APPROVAL, never bound: nothing can be paid under it` });
    }
  });
  it("fails when bound and no proposal naming it was approved", () => {
    expect(proposalCredentialCheck([p("P-0002", "PENDING_APPROVAL"), p("P-0003", "REJECTED")], 12n)).toEqual({ kind: "done", ok: false, detail: "bound on chain at block 12, but no proposal naming it was approved (P-0002 PENDING_APPROVAL, P-0003 REJECTED)" });
  });
  it("gets the full check when bound after an approval whose replace did not finish (crash, failure, expiry)", () => {
    for (const status of ["EXECUTING", "FAILED", "EXPIRED"]) expect(proposalCredentialCheck([p("P-0002", status, true)], 9n)).toEqual({ kind: "full" });
  });
});
