// A suggestion from the CFO's past decisions becomes a policy_change proposal, and nothing more: it waits for the CFO's
// Face ID like any other change (src/executors/policyChange.ts), and only that signature applies it. Learning never
// changes a limit on its own.

import type { Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import type { ProposalRow } from "../policy/approvals.js";
import { currentPolicy } from "../policy/rules.js";
import { suggestions, type Suggestion } from "./precedent.js";
import { labelledCases } from "./records.js";

/** The suggestions this runner's records hold now, against the policy as it stands. */
export function suggestionsNow(db: DB): Suggestion[] {
  return suggestions(labelledCases(db), currentPolicy(db).map((r) => ({ key: r.key, label: r.label, value: r.value })));
}

/**
 * Files a suggestion as a policy_change proposal from its agent, PENDING_APPROVAL. A pattern without a setting is
 * refused. The setting is unchanged until the CFO approves and the change executes.
 */
export function proposeSuggestion(db: DB, s: Suggestion, now = new Date()): ProposalRow {
  if (!s.key || !s.to) throw new Error("this pattern has no setting to change: nothing to propose");
  const reason = `Learned from the CFO's past decisions: ${s.evidence.join(", ")} were all signed. ${s.text}`.slice(0, 500);
  return proposePolicyChange(db, { changes: [{ key: s.key, to: s.to }], reason }, s.agent as Actor, now);
}
