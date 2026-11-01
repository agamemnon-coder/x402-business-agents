// npm run verify, for a credential a rebalance issued. A rebalance signs its credentials when it is proposed and binds
// them on chain only after the approval (dry-131: a rebalance still waiting for the CFO failed verify's "bound" check).
// Options A and B of one price rise share the same credentials, so the decision goes by the credential's hash across
// every proposal that names it (review: approving B binds the credential and supersedes A). The rule:
//   - no proposal names it, or one that names it was executed: the full check, as every credential always had;
//   - bound on chain: the full check if a proposal naming it was approved (a partial or crashed replace included),
//     otherwise FAIL: a bound mandate without an approval is exactly what must never exist;
//   - not bound, and none executed (pending, rejected, expired, superseded, failed before binding): passes, since
//     nothing can be paid under an unbound mandate.

export type CredentialCheck = { kind: "full" } | { kind: "done"; ok: boolean; detail: string };
export interface Naming { proposal_id: string; status: string; approved: boolean }

export function proposalCredentialCheck(naming: Naming[], boundBlock: bigint): CredentialCheck {
  if (naming.length === 0 || naming.some((p) => p.status === "EXECUTED")) return { kind: "full" };
  const ids = naming.map((p) => `${p.proposal_id} ${p.status}`).join(", ");
  if (boundBlock > 0n) {
    return naming.some((p) => p.approved)
      ? { kind: "full" }
      : { kind: "done", ok: false, detail: `bound on chain at block ${boundBlock}, but no proposal naming it was approved (${ids})` };
  }
  return { kind: "done", ok: true, detail: `issued for ${ids}, never bound: nothing can be paid under it` };
}
