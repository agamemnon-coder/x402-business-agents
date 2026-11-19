// Hash first (security hardening, 19 November). An executor that moves money calls this before anything outside
// Purser: no balance read, no chain read, no login. The execution guard (beginExecution, src/policy/approvals.ts) checks
// the same again inside its write lock, together with expiry, the hub gate and the executor's own preconditions; this
// earlier check only makes sure a proposal whose stored terms no longer hash to what was signed, or that nobody
// approved, never reaches Airwallex or the chain at all. The Airwallex soak of 19 November found the invoice executor
// reading GET /balances/current before it refused a tampered proposal (docs/security/2026-11-19-hardening.md).

import type { DB } from "../db/open.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { resuming } from "./approvals.js";

/**
 * Why the stored terms of `proposalId` are not the terms that were approved, or null when they are: an approval on
 * record, and the stored terms hashing to both the stored hash and the hash the approval records. Reads the ledger only.
 */
export function signedHashRefusal(db: DB, proposalId: string): string | null {
  const p = db.prepare("SELECT terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string; terms_sha256: string } | undefined;
  if (!p) return `no proposal ${proposalId}`;
  const a = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(proposalId) as { approved_sha256: string; decision: string } | undefined;
  if (!a || a.decision !== "APPROVED") return `${proposalId} has no approval`;
  let recomputed: string | null;
  try {
    recomputed = termsHash(JSON.parse(p.terms_json) as Terms);
  } catch {
    recomputed = null;
  }
  return recomputed !== null && recomputed === p.terms_sha256 && recomputed === a.approved_sha256 ? null : `${proposalId}: terms do not match the approved hash ${a.approved_sha256}`;
}

/**
 * Throws unless `proposalId` may run on the terms that were signed: approved (or a failed or interrupted run of an
 * approved one), with an approval on record, and stored terms that hash to the approved hash. Call it first, before
 * any outside call; the messages are the execution guard's own.
 */
export function hashFirst(db: DB, proposalId: string): void {
  const p = db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string } | undefined;
  if (!p) throw new Error(`no proposal ${proposalId}`);
  // As in beginExecution: APPROVED or FAILED starts a run; EXECUTING only as a restart's resume.
  const runnable = p.status === "APPROVED" || p.status === "FAILED" || (p.status === "EXECUTING" && resuming.has(proposalId));
  if (!runnable) throw new Error(`${proposalId} is ${p.status}, not approved`);
  const why = signedHashRefusal(db, proposalId);
  if (why) throw new Error(why);
}
