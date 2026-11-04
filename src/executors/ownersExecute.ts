// Block 1: runs an approved owners_execute. The two approvals are the account's owners' WebAuthn signatures over its
// Execute digest; this builds the account signature from them and relays executeSigned. The sender only pays gas: no
// key it holds is an owner, so a wrong or missing signature reverts on chain whatever this code does.

import { encodeFunctionData, type Address, type Hex } from "viem";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { ACCOUNT_BATCH_MODE, accountAbi, executionData } from "../metal/fourEyes.js";
import { approvalHashOf, OWNERS_EXECUTE, quorumOf, type OwnersExecuteTerms } from "../metal/ownersExecute.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { passkeyOwnersOn } from "../config/agents.js";

/** Sends a transaction to the account (returns its hash), and waits for a receipt (success or revert). */
export interface Relay {
  send(to: Address, data: Hex): Promise<Hex>;
  wait(tx: Hex): Promise<boolean>;
}

/** The executeSigned call data for an approved owners_execute, from its stored approvals. */
export function signedCallOf(db: DB, proposalId: string): { account: Address; data: Hex; terms: OwnersExecuteTerms } {
  const p = db.prepare("SELECT kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string; terms_sha256: string };
  if (p.kind !== OWNERS_EXECUTE) throw new Error(`${proposalId} is not an owners_execute`);
  approvalHashOf(p); // the digest still follows from the terms
  const t = JSON.parse(p.terms_json) as OwnersExecuteTerms;
  const rows = db.prepare(`SELECT a.assertion_json, k.public_key FROM passkey_assertions a JOIN passkeys k USING (credential_id)
    WHERE a.proposal_id = ? AND a.outcome = 'APPROVED' ORDER BY a.verified_at`).all(proposalId) as { assertion_json: string; public_key: string }[];
  if (rows.length < 2) throw new Error(`${proposalId} has ${rows.length} passkey approval(s); the account needs both owners`);
  const signature = quorumOf(t, rows.map((r) => ({ publicKey: r.public_key, response: JSON.parse(r.assertion_json) as AuthenticationResponseJSON })));
  const data = encodeFunctionData({ abi: accountAbi, functionName: "executeSigned", args: [
    ACCOUNT_BATCH_MODE, executionData(t.calls.map((c) => ({ target: c.target, value: BigInt(c.value), callData: c.call_data }))), BigInt(t.nonce), BigInt(t.valid_until), signature,
  ] });
  return { account: t.account, data, terms: t };
}

export async function executeOwnersExecute(db: DB, proposalId: string, relay: Relay, now = new Date()): Promise<{ tx: Hex }> {
  const terms = beginExecution<OwnersExecuteTerms>(db, proposalId, (t) => {
    if (t.kind !== OWNERS_EXECUTE) throw new Error(`${proposalId} is not an owners_execute`);
    if (!passkeyOwnersOn()) throw new Error("on-chain owner signing is off (KIT11_PASSKEY_OWNERS)");
    if (BigInt(t.valid_until) * 1000n < BigInt(now.getTime() + 15_000)) throw new Error("the signed deadline has passed (or is too close); a new proposal is needed");
  }, now);
  try {
    const { account, data } = signedCallOf(db, proposalId);
    // A send recorded by an earlier attempt (a crash or a lost receipt) is waited for, never sent again: the nonce
    // would make a second send revert and the proposal read FAILED although the account ran it (review of block 1).
    const earlier = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'owners.sent' AND subject = ? ORDER BY seq DESC LIMIT 1").get(proposalId) as { payload_json: string } | undefined;
    const tx = earlier ? (JSON.parse(earlier.payload_json) as { tx: Hex }).tx : await relay.send(account, data);
    if (!earlier) audit(db, "owner-signer", "owners.sent", proposalId, { account, tx }, now);
    const ok = await relay.wait(tx);
    if (!ok) throw new Error(`the account reverted executeSigned (${tx})`);
    audit(db, "owner-signer", "owners.executed", proposalId, { account, tx, action: terms.action, note: "signed by the CFO's and the controller's passkeys; the runner only relayed it" }, now);
    finishExecution(db, proposalId, "EXECUTED", { tx }, now);
    return { tx };
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message.slice(0, 300) }, now);
    throw e;
  }
}
