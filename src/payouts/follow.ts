// Following supplier payouts after they were sent (red team 6): live, Airwallex answers a new payout NEW and moves it to
// PAID later (the sandbox's settle step only simulates that), so Purser's fee for it could never be taken at execution.
// Here each written payout of an executed supplier or invoice payment is read again from Airwallex (a
// payout.transfer.paid webhook only prompts this; its body is never trusted for money), its row follows (IN_APPROVAL in
// Airwallex's own approval workflow, SCHEDULED, PROCESSING, SENT, PAID), and once it is PAID the Purser fee Airwallex took
// with it (application_fees) is counted and booked. A payout that failed voids its fee. Nothing here sends anything.
//
// PAID is not always final (Airwallex, "Late failures after PAID": a transfer can still move to FAILED when the local
// clearing system or the recipient bank rejects it; keep listening for payout.transfer.failed). A paid payout is read
// again when a payout.transfer.failed or .cancelled webhook asked for it (src/policy/airwallexEvents.ts records the
// request; its body is never trusted). One that came back is recorded as returned: its invoice goes back to a person
// (src/ap/pay.ts), the books take the payment back, and nothing is ever sent again under that approval.

import type { PayoutRail, Transfer } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { takePlatformFee } from "../executors/supplierPayment.js";
import { recordRationale } from "./rationale.js";
import { RETURNED_AFTER_PAID } from "./feeKept.js";
import type { PlatformFields, SupplierPaymentTerms } from "./plan.js";

/** The audit event a payout.transfer.failed or .cancelled webhook writes for a payout the ledger has as PAID. */
export const RECHECK_EVENT = "transfer.recheck_requested";
/** The audit event written when a payout Airwallex had marked PAID came back (FAILED, then CANCELLED). */
export const RETURNED_EVENT = RETURNED_AFTER_PAID;

/** Whether a webhook asked for this paid payout to be read again, after its last read. */
export function recheckDue(db: DB, transferId: string): boolean {
  const last = (event: string) => (db.prepare("SELECT MAX(seq) AS s FROM audit_log WHERE event = ? AND subject = ?").get(event, transferId) as { s: number | null }).s ?? 0;
  const asked = last(RECHECK_EVENT);
  return asked > 0 && asked > last("transfer.rechecked");
}

const FINAL = new Set(["PAID", "FAILED", "CANCELLED"]);

export interface Followed { proposal_id: string; payout: string; fee: string | null }

export interface FollowOptions {
  /**
   * Replaces a payout Airwallex failed for good, once, on the same approved terms: src/executors/replaceFailed.ts
   * (replaceFailedHook), handed in by a runner that switched it on (KIT11_REPLACE_FAILED_PAYOUT=on, src/cli/payables.ts).
   * Not imported here, so the Cloud engine's bundle does not carry it. Absent: a failed payout waits for a person.
   * Returns what came of it, in a word.
   */
  replaceFailed?: (proposalId: string) => Promise<string>;
}

/** The request_id of the payout that now stands for this one: its replacement when it has one, else itself. */
export function liveRequestId(db: DB, requestId: string): string {
  const r = db.prepare("SELECT request_id FROM transfers WHERE replaces_request_id = ?").get(requestId) as { request_id: string } | undefined;
  return r?.request_id ?? requestId;
}

export async function followPayouts(db: DB, rail: PayoutRail, now = new Date(), opts: FollowOptions = {}): Promise<Followed[]> {
  // Each executed payment's payout, and its replacement when a failed one was replaced (followed the same way).
  const rows = db.prepare(`SELECT p.proposal_id, p.terms_json, p.terms_sha256, t.transfer_id, t.status, t.replaces_request_id FROM proposals p
    JOIN transfers t ON t.request_id = json_extract(p.terms_json, '$.transfer_request_id') OR t.replaces_request_id = json_extract(p.terms_json, '$.transfer_request_id')
    WHERE p.kind IN ('supplier_payment', 'invoice_payment') AND p.status = 'EXECUTED' AND t.transfer_id IS NOT NULL ORDER BY p.proposal_id, t.rowid`).all() as
    { proposal_id: string; terms_json: string; terms_sha256: string; transfer_id: string; status: string; replaces_request_id: string | null }[];
  const out: Followed[] = [];
  const replaceOn = !!opts.replaceFailed;
  const failedFirst: string[] = [];
  const moved = new Set<string>();
  for (const r of rows) {
    const terms = JSON.parse(r.terms_json) as SupplierPaymentTerms & PlatformFields;
    const fee = terms.platform_fee;
    const feeRow = () => (fee ? db.prepare("SELECT status FROM platform_fees WHERE request_id = ?").get(fee.request_id) as { status: string } | undefined : undefined);
    let status = r.status;
    let fresh: Transfer | null = null;
    // Read again while under way, once more when PAID with its fee still due (the fee is read off the payout), and when
    // a webhook said a PAID payout failed (a late failure: Airwallex's answer is read, never the webhook's body).
    const recheck = status === "PAID" && recheckDue(db, r.transfer_id);
    if (!FINAL.has(status) || recheck || (status === "PAID" && fee && ["DUE", undefined].includes(feeRow()?.status))) {
      try {
        fresh = await rail.getTransfer(r.transfer_id);
        if (recheck) audit(db, "awx-executor", "transfer.rechecked", r.transfer_id, { status: fresh.status, read: "read again at Airwallex after a webhook" }, now);
        if (fresh.status !== status) {
          db.prepare("UPDATE transfers SET status = ?, failure_type = ?, failure_reason = ?, updated_at = ? WHERE transfer_id = ?")
            .run(fresh.status, fresh.failureType ?? null, fresh.failureReason ?? null, now.toISOString(), r.transfer_id);
          audit(db, "awx-executor", "transfer.status", r.transfer_id, { status: fresh.status, read: "followed up at Airwallex" }, now);
          if (status === "PAID" && (fresh.status === "FAILED" || fresh.status === "CANCELLED")) {
            // Airwallex returns the amount less the transfer fee, which it keeps ("Handle failed transfers").
            audit(db, "awx-executor", RETURNED_EVENT, r.transfer_id, {
              proposal_id: r.proposal_id, status: fresh.status, failure_type: fresh.failureType ?? null, failure_reason: fresh.failureReason ?? null,
              note: "Airwallex had it PAID; the supplier's bank returned it. Airwallex refunds the amount less the transfer fee. Nothing is sent again under this approval.",
            }, now);
          }
          status = fresh.status;
          moved.add(r.proposal_id);
        }
      } catch (e) {
        audit(db, "awx-executor", "transfer.follow_failed", r.transfer_id, { error: (e as Error).message.slice(0, 200) }, now);
        continue;
      }
    }
    // A first payout failed for good: handed to the hook after the loop, which replaces it once or leaves it to a person.
    if (replaceOn && !r.replaces_request_id && (status === "FAILED" || status === "CANCELLED")) failedFirst.push(r.proposal_id);
    if (!fee) continue;
    const row = feeRow();
    if (status === "FAILED" || status === "CANCELLED") {
      if (row && ["DUE", "OPEN"].includes(row.status)) {
        db.prepare("UPDATE platform_fees SET status = 'VOID', updated_at = ? WHERE request_id = ?").run(now.toISOString(), fee.request_id);
        audit(db, "awx-executor", "platform_fee.void", fee.request_id, { why: `the payout is ${status}; no fee is owed` }, now);
      } else if (row?.status === "SETTLED" && !db.prepare("SELECT 1 FROM audit_log WHERE event = 'platform_fee.refund_due' AND subject = ?").get(fee.request_id)) {
        // Purser's fee was taken on a payout that came back after PAID: owed back to the company, by a person.
        audit(db, "awx-executor", "platform_fee.refund_due", fee.request_id, { why: `the payout came back (${status}) after Purser's fee was taken; a person refunds it` }, now);
      }
      continue;
    }
    if (status !== "PAID" || !fresh || (row && ["SETTLED", "NOT_TAKEN", "VOID", "OPEN"].includes(row.status))) continue;
    // The fee went with the payout (application_fee_options): here it is only read off the paid payout and booked.
    out.push({ proposal_id: r.proposal_id, payout: status, fee: takePlatformFee(db, terms, r.terms_sha256, r.proposal_id, fresh) });
  }
  for (const id of failedFirst) out.push({ proposal_id: id, payout: await opts.replaceFailed!(id), fee: null });
  // The rationale follows the payout's new status (src/payouts/rationale.ts).
  for (const id of moved) recordRationale(db, id, null, now);
  return out;
}
