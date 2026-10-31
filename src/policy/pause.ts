// 4.2 Pause one agent with Face ID. The CFO stops one agent instead of all (the emergency stop stays for all). An
// approved pause does three things: Purser refuses the agent's payments before signing (src/policy/rules.ts), its card
// is set to inactive at Airwallex (src/policy/cards.ts), and its Metal mandate is revoked on chain, so even a signed
// payment would be refused there. Resuming re-grants spending power: it is a mandate change, so it takes four eyes
// when the CFO has that on (src/policy/fourEyes.ts), and the chain is restored before Purser lets the agent sign again.
//
// Order, so that a failure always leaves the agent stopped:
//   pause:  the switch goes on first (nothing signs from that moment), then the mandate is revoked on chain;
//   resume: the mandate is restored on chain first, then the switch goes off. A failed restore leaves it paused.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { applyPolicyChanges, checkChanges, type PolicyChangeTerms } from "../executors/policyChange.js";
import { beginExecution, finishExecution } from "./approvals.js";

export { paused } from "./rules.js";

/** The chain side of a pause: revoke the agent's bound mandate; restore one with the same limits and its spend. */
export interface PauseChain {
  revoke(agent: string): Promise<{ tx: string | null; credential_hash: string }>;
  resume(agent: string): Promise<{ tx: string | null; credential_hash: string }>;
}

const agentOf = (key: string) => key.slice("pause.".length);

/** The credential hash the agent's last pause revoked (its mandate.revoked row), or null. Resume restores exactly it. */
export function pausedCredential(db: DB, agent: string): string | null {
  const r = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'mandate.revoked' AND subject = ? ORDER BY seq DESC LIMIT 1").get(agent) as { payload_json: string } | undefined;
  const h = r ? (JSON.parse(r.payload_json) as { credential_hash?: unknown }).credential_hash : null;
  return typeof h === "string" && h ? h : null;
}

export async function executePauseChange(db: DB, proposalId: string, chain: PauseChain, now = new Date()): Promise<void> {
  const terms = beginExecution<PolicyChangeTerms>(db, proposalId, (t) => {
    if (t.kind !== "policy_change") throw new Error(`${proposalId} is not a policy change`);
    checkChanges(db, t.changes);
  }, now);
  const resumes = terms.changes.filter((c) => c.key.startsWith("pause.") && c.to !== "on").map((c) => agentOf(c.key));
  const pauses = terms.changes.filter((c) => c.key.startsWith("pause.") && c.to === "on").map((c) => agentOf(c.key));

  // Resume: the chain first. Until the mandate is back, the agent stays paused in Purser too.
  for (const agent of resumes) {
    try {
      const r = await chain.resume(agent);
      audit(db, "owner-signer", "mandate.resumed", agent, { agent, proposal_id: proposalId, tx: r.tx, credential_hash: r.credential_hash }, now);
    } catch (e) {
      finishExecution(db, proposalId, "FAILED", { error: `resume ${agent}: ${(e as Error).message}` }, now);
      throw e;
    }
  }

  // The switch, in one transaction with the rest of the change.
  applyPolicyChanges(db, proposalId, terms, now);

  // Pause: the switch is on, so Purser signs nothing for the agent; now the mandate goes on chain too.
  for (const agent of pauses) {
    try {
      const r = await chain.revoke(agent);
      audit(db, "owner-signer", "mandate.revoked", agent, { agent, proposal_id: proposalId, tx: r.tx, credential_hash: r.credential_hash, reason: "paused by the CFO" }, now);
    } catch (e) {
      audit(db, "owner-signer", "mandate.revoke_failed", agent, { agent, proposal_id: proposalId, error: (e as Error).message, note: "the agent is paused in Purser and signs nothing; the revoke is retried by npm run pause -- sync" }, now);
      throw e;
    }
  }
}

/**
 * Finishes a pause whose revoke failed (npm run pause -- sync): for each agent paused in Purser with no mandate.revoked
 * since that pause, revokes it now. The chain's own check makes a second revoke a no-op. Returns the agents revoked.
 */
export async function syncPauses(db: DB, chain: PauseChain, now = new Date()): Promise<string[]> {
  const done: string[] = [];
  const rows = db.prepare("SELECT key FROM settings WHERE key LIKE 'pause.%' AND value = 'on' ORDER BY key").all() as { key: string }[];
  for (const { key } of rows) {
    const agent = agentOf(key);
    const since = (db.prepare("SELECT MAX(seq) AS s FROM audit_log WHERE event = 'policy.changed' AND subject = ?").get(key) as { s: number | null }).s ?? 0;
    if (db.prepare("SELECT 1 FROM audit_log WHERE event = 'mandate.revoked' AND subject = ? AND seq > ?").get(agent, since)) continue;
    const r = await chain.revoke(agent);
    audit(db, "owner-signer", "mandate.revoked", agent, { agent, tx: r.tx, credential_hash: r.credential_hash, reason: "paused by the CFO (finished by the sync)" }, now);
    done.push(agent);
  }
  return done;
}
