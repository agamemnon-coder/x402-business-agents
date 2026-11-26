// The CFO's emergency stop as one place says it, for the runner and Purser Cloud's engine alike. The stop itself is the
// CFO policy's setting "freeze" (src/policy/rules.ts frozen): pulled and lifted only by a policy change the CFO approves
// with the passkey (src/executors/policyChange.ts, audited as policy.changed), and asked by every way money leaves:
// reserveSpend and stopRefusal for the agents (./holds.ts), and the payment executors when their execution begins and
// again immediately before every create at the bank (src/executors/invoicePayment.ts and supplierPayment.ts refuseIfHeld,
// audited as transfer.held_before_create).
//
// Purser Cloud (26 Nov) adds three askers on top, none instead of one: the routed rail right before a create reaches
// either bank (railStop, src/airwallex/routedRail.ts), the agent's payment within the limit to pay alone (src/ap/pay.ts),
// and /try's mirror of a paid payment at the Airwallex sandbox (cloud/src/engine/livePayout.ts).
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { frozen } from "./rules.js";

/** The CFO policy's key of the emergency stop. */
export const STOP_KEY = "freeze";
/** Why nothing is paid while the stop is on, as the executors' holdReason says it. */
export const STOP_WORDS = "the CFO pulled the emergency stop; nothing is paid until it is lifted";

export interface StopState {
  on: boolean;
  /** When the policy change that set it as it stands was applied, and which proposal it was; null when never changed. */
  since: string | null;
  proposal_id: string | null;
}

/** Whether the stop is on now, and since when (the last policy.changed of the key). Reads only. */
export function stopState(db: DB): StopState {
  const last = db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = 'policy.changed' AND subject = ? ORDER BY seq DESC LIMIT 1").get(STOP_KEY) as { ts: string; payload_json: string } | undefined;
  const proposal = (() => {
    try { const p = last ? JSON.parse(last.payload_json) as { proposal_id?: unknown } : {}; return typeof p.proposal_id === "string" ? p.proposal_id : null; } catch { return null; }
  })();
  return { on: frozen(db), since: last?.ts ?? null, proposal_id: proposal };
}

/**
 * A payout row written for a first send that the rail then held back (src/airwallex/routedRail.ts HeldBeforeCreate):
 * nothing was sent, so it is closed as CANCELLED, as the executors' refuseIfHeld closes theirs, never left counting as
 * money under way. A row of an earlier run (a resend) is not one: the first send may be at the bank.
 */
export function closeHeldRow(db: DB, requestId: string, reason: string, at: Date): void {
  db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = 'held_by_purser', failure_reason = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL AND status = 'SUBMITTING'")
    .run(`not sent: ${reason}`.slice(0, 300), at.toISOString(), requestId);
}

/** What a create at the bank is: a conversion, a payout, or a batch's lines and its submission. */
export type CreateKind = "conversion" | "transfer" | "batch";

/**
 * The last ask, at the rail, immediately before a create reaches the bank: null when it may go, else the reason, with
 * the refusal written to the audit log as the executors write theirs (transfer.held_before_create, checked "rail").
 */
export function railStop(db: DB, now: () => Date = () => new Date()): (what: CreateKind, ref: string) => string | null {
  return (what, ref) => {
    if (!frozen(db)) return null;
    audit(db, "awx-executor", "transfer.held_before_create", ref || null, { before: what, reason: STOP_WORDS, request_id: ref, checked: "rail" }, now());
    return STOP_WORDS;
  };
}
