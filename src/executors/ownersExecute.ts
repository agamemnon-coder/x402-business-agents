// Block 1: runs an approved owners_execute. The two approvals are the account's owners' WebAuthn signatures over its
// Execute digest; this builds the account signature from them and relays executeSigned. The sender only pays gas: no
// key it holds is an owner, so a wrong or missing signature reverts on chain whatever this code does.
//
// Sent at most once (src/metal/ownersTx.ts): the transaction's hash is in the ledger (owners.sent) before it leaves,
// and a later run carries on from it. How a run ends:
//   - the account ran it: EXECUTED;
//   - the chain refused it (a revert on chain, or a call the chain would revert, which is then not sent), or it can no
//     longer run (the signed deadline passed): FAILED, with the account's own error decoded;
//   - anything that leaves the outcome open (no receipt yet, the network, a spent call budget): the proposal stays
//     EXECUTING. Both owners' signatures are still good, so the runner's next start resumes it (src/policy/saga.ts)
//     from the recorded hash, and nothing is sent twice.

import { encodeFunctionData, type Address, type Hex } from "viem";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { ACCOUNT_BATCH_MODE, accountAbi, executionData } from "../metal/fourEyes.js";
import { approvalHashOf, OWNERS_EXECUTE, quorumOf, type OwnersExecuteTerms } from "../metal/ownersExecute.js";
import { ChainRefused, NoReceiptYet } from "../metal/ownersChain.js";
import { sendOnce, type Sent, type TxJournal } from "../metal/ownersTx.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { passkeyOwnersOn } from "../config/agents.js";

export interface Relay {
  /** Sends a transaction to the account and returns its hash. `onSigned` gets the hash before the transaction leaves. */
  send(to: Address, data: Hex, onSigned?: (s: Sent) => void): Promise<Hex>;
  /** Waits for a receipt: true for success, false for a revert. Throws while there is none. */
  wait(tx: Hex): Promise<boolean>;
  /** Sends the identical transaction again when the chain does not have it (the recorded nonce and gas, so the same hash). */
  again?(to: Address, data: Hex, earlier: Sent): Promise<void>;
  /** Why the account refuses this call, from one read-only call: its own error, decoded. Null when the call would pass. */
  why?(to: Address, data: Hex): Promise<string | null>;
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

/** The proposal's sends in the audit log: owners.sent before a transaction leaves, owners.unsent when a node refused it outright. */
function journal(db: DB, proposalId: string, account: Address, now: Date): TxJournal {
  const of = (event: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(event, proposalId) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Sent);
  return {
    open() {
      const void_ = new Set(of("owners.unsent").map((s) => s.tx.toLowerCase()));
      return of("owners.sent").filter((s) => !void_.has(s.tx.toLowerCase())).at(-1) ?? null;
    },
    sent: (s) => { audit(db, "owner-signer", "owners.sent", proposalId, { account, tx: s.tx, ...(s.from ? { from: s.from } : {}), ...(s.nonce === undefined ? {} : { nonce: s.nonce }), ...(s.gas === undefined ? {} : { gas: s.gas }) }, now); },
    unsent: (tx, why) => { audit(db, "owner-signer", "owners.unsent", proposalId, { tx, why: why.slice(0, 300) }, now); },
  };
}

/** An outcome that will not change: the chain refused the call, or its signed deadline is over. */
class Settled extends Error {}

export async function executeOwnersExecute(db: DB, proposalId: string, relay: Relay, now = new Date()): Promise<{ tx: Hex }> {
  const terms = beginExecution<OwnersExecuteTerms>(db, proposalId, (t) => {
    if (t.kind !== OWNERS_EXECUTE) throw new Error(`${proposalId} is not an owners_execute`);
    if (!passkeyOwnersOn()) throw new Error("on-chain owner signing is off (KIT11_PASSKEY_OWNERS)");
  }, now);
  const sends = journal(db, proposalId, terms.account, now);
  const late = BigInt(terms.valid_until) * 1000n < BigInt(now.getTime() + 15_000);
  let tx: Hex | null = sends.open()?.tx ?? null;
  try {
    let call: { account: Address; data: Hex };
    try { call = signedCallOf(db, proposalId); } catch (e) { throw new Settled((e as Error).message, { cause: e }); }
    const { account, data } = call;
    // Nothing sent yet: the signed deadline must still leave time to land. A send recorded earlier is past this check:
    // it left in time, and the chain decides what became of it.
    if (!tx && late) throw new Settled("the signed deadline has passed (or is too close); a new proposal is needed");
    // A send recorded by an earlier attempt (a crash or a lost receipt) is waited for, never signed again: the nonce
    // would make a second send revert and the proposal read FAILED although the account ran it (review of block 1).
    const r = await sendOnce(
      { ...sends, sent: (s) => { tx = s.tx; sends.sent(s); } },
      { send: (onSigned) => relay.send(account, data, onSigned), ...(relay.again ? { again: (earlier: Sent) => relay.again!(account, data, earlier) } : {}) },
      (hash) => relay.wait(hash),
    );
    tx = r.tx;
    if (!r.ok) {
      const why = (await relay.why?.(account, data).catch((e: Error) => `the reason could not be read (${e.message.slice(0, 120)})`)) ?? "the account gave no reason this runner could read";
      audit(db, "owner-signer", "owners.reverted", proposalId, { account, tx, reason: why }, now);
      throw new Settled(`the account reverted executeSigned (${tx}): ${why}`);
    }
    audit(db, "owner-signer", "owners.executed", proposalId, { account, tx, action: terms.action, note: "signed by the CFO's and the controller's passkeys; the runner only relayed it" }, now);
    finishExecution(db, proposalId, "EXECUTED", { tx }, now);
    return { tx };
  } catch (e) {
    const message = (e as Error).message;
    if (e instanceof Settled || e instanceof ChainRefused) {
      finishExecution(db, proposalId, "FAILED", { error: message.slice(0, 300) }, now);
      throw e;
    }
    if (tx && late && e instanceof NoReceiptYet) {
      // Past the deadline the account refuses these signatures, so a transaction with no receipt by now cannot run any more.
      const error = `${proposalId} was sent as ${tx}, but it has no receipt and the signed deadline has passed: the account refuses it from now on; a new proposal is needed`;
      finishExecution(db, proposalId, "FAILED", { error, tx }, now);
      throw new Error(error, { cause: e });
    }
    // The outcome is open, and both owners' signatures are still good: the proposal stays EXECUTING for the next start.
    audit(db, "owner-signer", "owners.waiting", proposalId, { ...(tx ? { tx } : {}), why: message.slice(0, 300) }, now);
    (e as Error).message = `${message}; ${proposalId} stays executing: start the runner again to carry on${tx ? ` from ${tx}` : ""}, nothing is sent twice`;
    throw e;
  }
}
