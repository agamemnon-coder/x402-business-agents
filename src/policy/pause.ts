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
import { AGENTS } from "../config/policy.js";

export { paused } from "./rules.js";

/**
 * The chain side of a pause. Revoke: the agent's bound mandate. Resume: Metal cannot replace a revoked mandate, only
 * bind a fresh one, whose spend starts at nothing (tested on testnet, 31 October); so the fresh one gets the same cap
 * and what was left of the budget, and the agent's lifetime limit on chain stays what it was.
 */
export interface PauseChain {
  revoke(agent: string): Promise<{ tx: string | null; credential_hash: string }>;
  /** `bound: false`: the old mandate was still bound (its revoke never happened), so nothing new was bound. */
  resume(agent: string): Promise<{ tx: string | null; credential_hash: string; spent_before?: string; budget?: string; bound?: boolean }>;
}

/** Every agent: a rebalance after any resume is refused (a resumed budget on chain hides what was spent before). */
export const AGENTS_ALL: string[] = [...AGENTS];

/**
 * The mandate a pause revoked, among an agent's credentials: the revoked one bound last. A rebalance revokes its
 * predecessor too, but that one was bound earlier. Used when a retried revoke finds the first try already landed.
 */
export function latestRevoked<T extends { bound: boolean; revoked: boolean; boundBlock: bigint }>(all: T[]): T | null {
  return all.filter((x) => x.bound && x.revoked).sort((a, b) => (a.boundBlock < b.boundBlock ? 1 : a.boundBlock > b.boundBlock ? -1 : 0))[0] ?? null;
}

/** Seconds a resumed mandate may live: the revoked one's own expiry, never longer; an expired one is not revived. */
export function resumeExpiresIn(expiry: number, nowSeconds = Math.floor(Date.now() / 1000)): number {
  const left = expiry - nowSeconds;
  if (left <= 60) throw new Error("the paused mandate has expired (or expires within a minute); resuming would revive it, so a new mandate needs its own approval");
  return left;
}

/** Agents paused in Purser whose mandate was not revoked on chain since that pause (a failed or interrupted revoke). */
export function pausesNotRevoked(db: DB): string[] {
  const rows = db.prepare("SELECT key FROM settings WHERE key LIKE 'pause.%' AND value = 'on' ORDER BY key").all() as { key: string }[];
  return rows.map((r) => r.key).filter((key) => {
    const since = (db.prepare("SELECT MAX(seq) AS s FROM audit_log WHERE event = 'policy.changed' AND subject = ?").get(key) as { s: number | null }).s ?? 0;
    return !db.prepare("SELECT 1 FROM audit_log WHERE event = 'mandate.revoked' AND subject = ? AND seq > ?").get(agentOf(key), since);
  }).map(agentOf);
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
      if (r.bound === false) {
        // The pause's revoke never landed: the old mandate is still bound, nothing new was bound, nothing re-granted.
        audit(db, "owner-signer", "mandate.resume_not_needed", agent, { agent, proposal_id: proposalId, credential_hash: r.credential_hash, note: "its mandate was still bound: the revoke had not happened" }, now);
        continue;
      }
      audit(db, "owner-signer", "mandate.resumed", agent, {
        agent, proposal_id: proposalId, tx: r.tx, credential_hash: r.credential_hash,
        ...(r.spent_before !== undefined ? { spent_before: r.spent_before } : {}), ...(r.budget !== undefined ? { budget: r.budget } : {}),
      }, now);
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
  for (const agent of pausesNotRevoked(db)) {
    const r = await chain.revoke(agent);
    audit(db, "owner-signer", "mandate.revoked", agent, { agent, tx: r.tx, credential_hash: r.credential_hash, reason: "paused by the CFO (finished by the sync)" }, now);
    done.push(agent);
  }
  return done;
}

/** Whether this agent's mandate was ever resumed after a pause (its spend on chain then restarted at nothing). */
export function resumedSince(db: DB, agent: string): boolean {
  return !!db.prepare("SELECT 1 FROM audit_log WHERE event = 'mandate.resumed' AND subject = ?").get(agent);
}

/**
 * A mandate change (Treasury's rebalance) for an agent that was resumed after a pause is refused, before any credential
 * is issued or signed: the resumed mandate's spend starts at nothing, a replace carries only that, and the new budgets
 * would no longer count what was spent before the pause. Purser's own 20.00 total (src/policy/holds.ts) still holds;
 * this keeps the chain's limit honest too. Lifting it needs the spend before the pause carried into the new budgets.
 */
export function refuseAfterResume(db: DB, agents: string[]): void {
  const hit = agents.filter((a) => resumedSince(db, a));
  if (hit.length) throw new Error(`${hit.join(", ")} was resumed after a pause: its spend on chain started again at nothing, so a mandate change would not count what it spent before. Not supported yet; nothing was issued or signed.`);
}
