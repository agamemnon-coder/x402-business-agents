// The hub gate, at the one place every approved proposal passes before it runs: beginExecution in
// src/policy/approvals.ts, which every executor calls. It is an EXTRA gate. It never replaces the person's approval
// (passkey, terms hash, four eyes, expiry): beginExecution checks all of those first, as it always did, and this gate
// can only add a refusal. With HUB_DECISIONS_ENABLED off it returns at once and reads nothing.
//
// With it on, a proposal starts executing only when:
//   - Purser's own check on the run (src/hub/runs.ts proposalCheck) is not `fail` — a failed run never executes,
//     whatever the hub or anyone says;
//   - the hub was consulted for this execution, moments ago, on these exact terms (src/hub/consult.ts records it);
//   - and the hub said `approve` with the check `pass`, or the hub could not be reached (then the existing approval
//     alone decides, as without the hub, and the record says the hub was unreachable).
// A hub `reject`, or no decision yet, runs nothing.

import type { DB } from "../db/open.js";
import { hubDecisionsEnabled } from "./config.js";
import { lastConsult, proposalCheck } from "./runs.js";

/** A consult counts for an execution that begins within this long after it. */
export const CONSULT_FRESH_MS = 60_000;

export type HubOutcome = "approve" | "reject" | "none" | "unreachable";

interface Gated {
  proposal_id: string;
  kind: string;
  terms_json: string;
  terms_sha256: string;
  created_by: string;
  status: string;
}

/** Why the hub gate stops this proposal now, or null when it may begin (or the gate is off). Reads only; writes nothing. */
export function hubGateRefusal(db: DB, p: Gated, now: Date, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!hubDecisionsEnabled(env)) return null;
  const { check, rule } = proposalCheck(db, p);
  if (check === "fail") return `hub gate: Purser's rules fail ${p.proposal_id} (${rule}); a failed run never executes`;
  const c = lastConsult(db, p.proposal_id);
  const fresh = c !== null && c.terms_sha256 === p.terms_sha256 && Math.abs(now.getTime() - Date.parse(c.ts)) <= CONSULT_FRESH_MS;
  if (!c || !fresh) return `hub gate: the hub was not consulted for this execution of ${p.proposal_id}; nothing runs`;
  switch (c.outcome as HubOutcome) {
    case "approve":
      return check === "pass" ? null : `hub gate: the hub approved ${p.proposal_id}, but Purser's check is ${check}; nothing runs`;
    case "unreachable":
      // Fallback: the existing approval alone, already checked by beginExecution. Recorded as unreachable by the consult.
      return null;
    case "reject":
      return `hub gate: ${p.proposal_id} was rejected on the hub; nothing runs`;
    default:
      return `hub gate: ${p.proposal_id} waits for the hub's decision; nothing runs yet`;
  }
}
