// A CFO policy change (tier 2 item 6): proposed like any other change, approved by a person (passkey or typed
// hash), then applied in one transaction. Each change carries the value it replaces; if that moved meanwhile,
// nothing is applied and the proposal stays approved but unexecuted.

import { audit, type Actor } from "../audit/log.js";
import { PROPOSAL_TTL_MS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { beginExecution, createProposal, finishExecution, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { sodChanges } from "../policy/policySod.js";
import { policyValue, ruleFor, validateChange } from "../policy/rules.js";
import { autonomyOn } from "../config/agents.js";
import { publish, type AgentName } from "../autonomy/bus.js";

export type PolicyChange = {
  key: string;
  label: string;
  from: string;
  to: string;
};

export interface PolicyChangeTerms extends Terms {
  kind: "policy_change";
  changes: PolicyChange[];
  reason: string;
  // proposed_by (a string, only when a person is named): who proposed it, never its approver (src/policy/policySod.ts).
}

/** A person's name as a passkey is enrolled under (src/passkey/ledger.ts openEnrolment). */
const PERSON = /^[a-z][a-z0-9-]{1,30}$/;
/** Names of agents and parts of the system, never a person (as src/passkey/ledger.ts keeps them apart). */
const NOT_PEOPLE = new Set(["system", "claude", "sourcing", "support", "treasury", "customer", "human", "owner-signer", "awx-executor", "payer", "checker", "learning", "controller"]);

/**
 * A signed-in person's name, as the Cloud labels their approval passkey (their display name): what approvals.ts
 * compares the approver with, so it may not hold what an approver string uses to join people (" (", " + ").
 */
function signedInName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 80 || n !== name || [...n].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) || n.includes(" (") || n.includes(" + ") || NOT_PEOPLE.has(n.toLowerCase()) || n.startsWith("ext")) {
    throw new Error(`not a signed-in person's name: ${JSON.stringify(name)}`);
  }
  return n;
}

/** Every change must be valid against the current policy, and no key may appear twice. */
export function checkChanges(db: DB, changes: PolicyChange[]): void {
  if (changes.length === 0) throw new Error("no change");
  const keys = new Set<string>();
  for (const c of changes) {
    if (keys.has(c.key)) throw new Error(`${c.key} is changed twice`);
    keys.add(c.key);
    const label = ruleFor(db, c.key)?.label;
    if (label !== undefined && c.label !== label) throw new Error(`${c.key} is labelled ${JSON.stringify(c.label)}, not ${JSON.stringify(label)}`);
    const problem = validateChange(db, c);
    if (problem) throw new Error(problem);
  }
}

/**
 * Who proposes it, signed into the terms as proposed_by, so that person can never approve it (segregation of duties,
 * src/policy/policySod.ts): proposedBy, a person's name as enrolled with a passkey (the command line's --by), or
 * signedInAs, the authenticated session's person as the Cloud labels their passkey (the engine passes it; recorded as the
 * proposer only where segregation of duties applies, so the CFO alone still asks for and approves a tightening). Left
 * out, the terms are as before; but a person's change (createdBy "human") that loosens the policy above the threshold
 * is refused without one, since nobody could then tell its proposer from its approver. An agent's proposal is its own.
 */
export function proposePolicyChange(db: DB, req: { changes: { key: string; to: string }[]; reason: string; ttlMs?: number; proposedBy?: string; signedInAs?: string }, createdBy: Actor, now = new Date()): ProposalRow {
  const changes = req.changes.map((c) => ({ key: c.key, label: ruleFor(db, c.key)?.label ?? c.key, from: policyValue(db, c.key), to: c.to }));
  checkChanges(db, changes);
  if (req.proposedBy !== undefined && !PERSON.test(req.proposedBy)) throw new Error(`not a person's name: ${JSON.stringify(req.proposedBy)} (lower-case letters, digits and dashes)`);
  const signedIn = req.signedInAs !== undefined ? signedInName(req.signedInAs) : undefined;
  const sod = sodChanges(db, JSON.stringify({ changes }), now);
  // The signed-in person is the proposer where segregation of duties needs one; below the threshold (or with it off) a
  // change asked for in the Cloud stays one person's to ask for and approve, as before.
  const by = req.proposedBy ?? (sod.length ? signedIn : undefined);
  if (by === undefined && createdBy === "human" && sod.length) {
    throw new Error(`segregation of duties applies (${sod.map((c) => `${c.key}: ${c.why}`).join("; ")}): name who proposes it, who then cannot approve it (--by <person> on the command line; in Purser Cloud, the signed-in person)`);
  }
  const terms: PolicyChangeTerms = {
    schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + (req.ttlMs ?? PROPOSAL_TTL_MS)).toISOString().replace(/\.\d{3}Z$/, "Z"),
    changes, reason: req.reason, ...(by !== undefined ? { proposed_by: by } : {}),
  };
  return createProposal(db, { terms, createdBy }, now);
}

/** Whether a policy change pauses or resumes an agent: that one needs the chain (src/policy/pause.ts). */
export function touchesPause(t: { changes?: { key: string }[] }): boolean {
  return (t.changes ?? []).some((c) => c.key.startsWith("pause."));
}

export function executePolicyChange(db: DB, proposalId: string, now = new Date()): void {
  const pending = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string } | undefined)?.terms_json ?? "{\"changes\":[]}") as PolicyChangeTerms;
  // A pause without the chain would leave the mandate live, a resume would leave it revoked: refuse, before anything.
  if (touchesPause(pending)) throw new Error(`${proposalId} pauses or resumes an agent: it runs with the chain (executePauseChange), not here`);
  const terms = beginExecution<PolicyChangeTerms>(db, proposalId, (t) => {
    if (t.kind !== "policy_change") throw new Error(`${proposalId} is not a policy change`);
    checkChanges(db, t.changes);
  }, now);
  applyPolicyChanges(db, proposalId, terms, now);
}

/** Applies an approved, begun policy change in one transaction and marks it executed. */
export function applyPolicyChanges(db: DB, proposalId: string, terms: PolicyChangeTerms, now = new Date()): void {
  db.transaction(() => {
    for (const c of terms.changes) {
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run(c.key, c.to, now.toISOString());
      audit(db, "human", "policy.changed", c.key, { key: c.key, label: c.label, from: c.from, to: c.to, proposal_id: proposalId }, now);
    }
    finishExecution(db, proposalId, "EXECUTED", { changes: String(terms.changes.length) }, now);
  }).immediate();
  // D19: with the autonomous agents on, an agent hears that the CFO changed its card's limit (it may now buy).
  if (autonomyOn()) {
    for (const c of terms.changes) {
      const m = /^card\.(sourcing|support|treasury)\.per_tx$/.exec(c.key);
      if (m) publish(db, "card.limit_changed", { agent: m[1], per_purchase: c.to, was: c.from, proposal_id: proposalId }, m[1] as AgentName, "human", now);
    }
  }
}
