// npm run verify, for credentials issued for a proposal (`<agent>.<P-nnnn>.credential.json`). A rebalance signs its
// credentials when it is proposed and binds them on chain only after the approval (dry-131: a rebalance still waiting
// for the CFO failed verify's "bound" check). So: a proposal that was executed gets the full check, as every
// credential always did; one that was not (pending, rejected, expired) passes only while its credential is NOT bound,
// since a bound mandate without an executed approval is exactly what must never exist.

export type CredentialCheck = { kind: "full" } | { kind: "done"; ok: boolean; detail: string };

/** `status`: the proposal's status in the ledger (undefined: no such proposal); `boundBlock`: 0 when never bound. */
export function proposalCredentialCheck(file: string, status: string | undefined, boundBlock: bigint): CredentialCheck {
  const id = /\.(P-\d{4,})\.credential\.json$/.exec(file)?.[1];
  if (!id || status === undefined || status === "EXECUTED") return { kind: "full" };
  return boundBlock === 0n
    ? { kind: "done", ok: true, detail: `issued for ${id} (${status}), never bound: nothing can be paid under it` }
    : { kind: "done", ok: false, detail: `issued for ${id} (${status}) but bound on chain at block ${boundBlock} without an executed approval` };
}
