// dry-131: Treasury proposed a rebalance (P-0002) and nobody approved it before the run ended. Its credentials are
// signed when the proposal is made and bound on chain only after the approval, so verify's "bound on the principal's
// account" check failed on a mandate that, rightly, never became active. A rebalance the CFO has not approved (pending,
// rejected, expired) must NOT be bound; one that was executed must pass the full check, as before. Breaks if an
// unapproved credential that is bound passes, or an executed one skips the full check.
import { describe, expect, it } from "vitest";
import { proposalCredentialCheck } from "../src/verify/credentials.js";

describe("verify: a credential issued for a proposal", () => {
  it("of an executed proposal gets the full check, as before", () => {
    expect(proposalCredentialCheck("sourcing.P-0002.credential.json", "EXECUTED", 0n)).toEqual({ kind: "full" });
    expect(proposalCredentialCheck("sourcing.P-0002.credential.json", "EXECUTED", 99n)).toEqual({ kind: "full" });
  });
  it("of a proposal not approved passes only while it is not bound on chain", () => {
    for (const status of ["PENDING_APPROVAL", "REJECTED", "EXPIRED"]) {
      expect(proposalCredentialCheck("sourcing.P-0002.credential.json", status, 0n)).toEqual({ kind: "done", ok: true, detail: `issued for P-0002 (${status}), never bound: nothing can be paid under it` });
      expect(proposalCredentialCheck("sourcing.P-0002.credential.json", status, 12n)).toEqual({ kind: "done", ok: false, detail: `issued for P-0002 (${status}) but bound on chain at block 12 without an executed approval` });
    }
  });
  it("of an unknown proposal, or a file without a proposal tag, gets the full check", () => {
    expect(proposalCredentialCheck("sourcing.P-0009.credential.json", undefined, 0n)).toEqual({ kind: "full" });
    expect(proposalCredentialCheck("sourcing.credential.json", undefined, 0n)).toEqual({ kind: "full" });
    expect(proposalCredentialCheck("sourcing.resume-1.credential.json", undefined, 0n)).toEqual({ kind: "full" });
  });
});
