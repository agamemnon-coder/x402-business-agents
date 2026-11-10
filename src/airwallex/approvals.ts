// Airwallex's own transfer approval workflow as a second, independent lock (docs/airwallex-approvals.md).
// With "Require API-initiated transfers to go through the same approval workflow?" set to Yes in the Airwallex web app,
// a transfer Purser creates after the CFO's Face ID waits at Airwallex as IN_APPROVAL until a person approves it in the
// web app (then SCHEDULED), rejects it (APPROVAL_REJECTED), recalls it (APPROVAL_RECALLED), or the workflow finds no
// next approver (APPROVAL_BLOCKED). Source: airwallex.com/docs/payouts/transfers/manage-transfers/manage-approvals-for-transfers.
//
// Purser's part: it never approves at Airwallex, never simulates past an approval, and never sends the payout again
// while one waits (the transfers row stays live, so the one-payout-per-invoice index refuses a second). It follows the
// transfer by its id and records each status; if the amount or payee at Airwallex no longer matches what the CFO signed
// (a rejected transfer can be edited and resubmitted in the web app), it raises an alarm instead of booking it.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import type { AirwallexRail, Transfer } from "./port.js";

/** The statuses of Airwallex's approval workflow. */
export const APPROVAL_STATES = ["IN_APPROVAL", "APPROVAL_REJECTED", "APPROVAL_RECALLED", "APPROVAL_BLOCKED"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const inAirwallexApproval = (status: string | null | undefined): boolean => (APPROVAL_STATES as readonly string[]).includes(status ?? "");

/** Statuses after which nothing more happens to a transfer. */
const TERMINAL = new Set(["PAID", "FAILED", "CANCELLED"]);

/** A transfer status in plain words, for the CFO's screens. */
export function describeTransferStatus(status: string): string {
  switch (status) {
    case "IN_APPROVAL": return "waiting for Airwallex approval";
    case "APPROVAL_REJECTED": return "rejected in Airwallex's approval workflow; not paid";
    case "APPROVAL_RECALLED": return "recalled from Airwallex's approval workflow; not paid";
    case "APPROVAL_BLOCKED": return "blocked in Airwallex's approval workflow (no next approver); not paid";
    case "SCHEDULED": return "approved at Airwallex, scheduled";
    case "PROCESSING": return "processing at Airwallex";
    case "SENT": return "sent by Airwallex";
    case "PAID": return "paid";
    case "FAILED": return "failed at Airwallex; not paid";
    case "CANCELLED": return "cancelled; not paid";
    default: return status.toLowerCase();
  }
}

export interface Followed {
  status: string;
  changed: boolean;
  /** True while a person at Airwallex still has to act. */
  waitingOnAirwallex: boolean;
  terminal: boolean;
  /** Set when the transfer at Airwallex no longer carries the terms in the ledger. */
  mismatch: string | null;
}

/**
 * Reads one transfer back from Airwallex and records what changed. Reads only: it never creates, approves, simulates
 * or resends anything, so it is safe to call on every poll and after every webhook.
 */
export async function followTransfer(db: DB, rail: Pick<AirwallexRail, "getTransfer">, transferId: string, now = new Date()): Promise<Followed> {
  const row = db.prepare("SELECT invoice_no, amount, status FROM transfers WHERE transfer_id = ?").get(transferId) as { invoice_no: string; amount: string; status: string } | undefined;
  if (!row) throw new Error(`transfer ${transferId} is not one Purser made; nothing is recorded`);
  const tr: Transfer = await rail.getTransfer(transferId);
  const mismatch = tr.amountCents !== toCents(row.amount) || tr.currency !== "EUR"
    ? `Airwallex now holds ${tr.currency} ${fromCents(tr.amountCents)} for ${row.invoice_no}, the CFO signed EUR ${row.amount}`
    : null;
  if (mismatch) {
    audit(db, "awx-executor", "transfer.terms_changed_at_airwallex", transferId, { invoice_no: row.invoice_no, status: tr.status, detail: mismatch }, now);
  }
  const changed = tr.status !== row.status;
  if (changed) {
    db.prepare("UPDATE transfers SET status = ?, failure_type = ?, failure_reason = ?, updated_at = ? WHERE transfer_id = ?")
      .run(tr.status, tr.failureType ?? null, tr.failureReason ?? null, now.toISOString(), transferId);
    audit(db, "awx-executor", "transfer.status", transferId, { status: tr.status, was: row.status, in_words: describeTransferStatus(tr.status) }, now);
  }
  return { status: tr.status, changed, waitingOnAirwallex: tr.status === "IN_APPROVAL" || tr.status === "APPROVAL_BLOCKED", terminal: TERMINAL.has(tr.status), mismatch };
}
