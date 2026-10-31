// A CFO policy change (tier 2 item 6): proposed like any other change, approved by a person (passkey or typed
// hash), then applied in one transaction. Each change carries the value it replaces; if that moved meanwhile,
// nothing is applied and the proposal stays approved but unexecuted.

import { audit, type Actor } from "../audit/log.js";
import { PROPOSAL_TTL_MS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { beginExecution, createProposal, finishExecution, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { policyValue, rules, validateChange } from "../policy/rules.js";

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
}

/** Every change must be valid against the current policy, and no key may appear twice. */
export function checkChanges(db: DB, changes: PolicyChange[]): void {
  if (changes.length === 0) throw new Error("no change");
  const keys = new Set<string>();
  for (const c of changes) {
    if (keys.has(c.key)) throw new Error(`${c.key} is changed twice`);
    keys.add(c.key);
    const label = rules(db).find((r) => r.key === c.key)?.label;
    if (label !== undefined && c.label !== label) throw new Error(`${c.key} is labelled ${JSON.stringify(c.label)}, not ${JSON.stringify(label)}`);
    const problem = validateChange(db, c);
    if (problem) throw new Error(problem);
  }
}

export function proposePolicyChange(db: DB, req: { changes: { key: string; to: string }[]; reason: string; ttlMs?: number }, createdBy: Actor, now = new Date()): ProposalRow {
  const changes = req.changes.map((c) => ({ key: c.key, label: rules(db).find((r) => r.key === c.key)?.label ?? c.key, from: policyValue(db, c.key), to: c.to }));
  checkChanges(db, changes);
  const terms: PolicyChangeTerms = {
    schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + (req.ttlMs ?? PROPOSAL_TTL_MS)).toISOString().replace(/\.\d{3}Z$/, "Z"),
    changes, reason: req.reason,
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
}
