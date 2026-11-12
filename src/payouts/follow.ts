// Following supplier payouts after they were sent (red team 6): live, Airwallex answers a new payout NEW and moves it to
// PAID later (the sandbox's settle step only simulates that), so Purser's fee for it could never be taken at execution.
// Here each written payout of an executed supplier or invoice payment is read again from Airwallex (a
// payout.transfer.paid webhook only prompts this; its body is never trusted for money), its row follows (IN_APPROVAL in
// Airwallex's own approval workflow, SCHEDULED, PROCESSING, SENT, PAID), and once it is PAID the Purser fee Airwallex took
// with it (application_fees) is counted and booked. A payout that failed voids its fee. Nothing here sends anything.

import type { PayoutRail, Transfer } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { takePlatformFee } from "../executors/supplierPayment.js";
import type { PlatformFields, SupplierPaymentTerms } from "./plan.js";

const FINAL = new Set(["PAID", "FAILED", "CANCELLED"]);

export interface Followed { proposal_id: string; payout: string; fee: string | null }

export async function followPayouts(db: DB, rail: PayoutRail, now = new Date()): Promise<Followed[]> {
  const rows = db.prepare(`SELECT p.proposal_id, p.terms_json, p.terms_sha256, t.transfer_id, t.status FROM proposals p
    JOIN transfers t ON t.request_id = json_extract(p.terms_json, '$.transfer_request_id')
    WHERE p.kind IN ('supplier_payment', 'invoice_payment') AND p.status = 'EXECUTED' AND t.transfer_id IS NOT NULL ORDER BY p.proposal_id`).all() as
    { proposal_id: string; terms_json: string; terms_sha256: string; transfer_id: string; status: string }[];
  const out: Followed[] = [];
  for (const r of rows) {
    const terms = JSON.parse(r.terms_json) as SupplierPaymentTerms & PlatformFields;
    const fee = terms.platform_fee;
    const feeRow = () => (fee ? db.prepare("SELECT status FROM platform_fees WHERE request_id = ?").get(fee.request_id) as { status: string } | undefined : undefined);
    let status = r.status;
    let fresh: Transfer | null = null;
    // Read again while under way, and once more when PAID with its fee still due (the fee is read off the payout).
    if (!FINAL.has(status) || (status === "PAID" && fee && ["DUE", undefined].includes(feeRow()?.status))) {
      try {
        fresh = await rail.getTransfer(r.transfer_id);
        if (fresh.status !== status) {
          db.prepare("UPDATE transfers SET status = ?, failure_type = ?, failure_reason = ?, updated_at = ? WHERE transfer_id = ?")
            .run(fresh.status, fresh.failureType ?? null, fresh.failureReason ?? null, now.toISOString(), r.transfer_id);
          audit(db, "awx-executor", "transfer.status", r.transfer_id, { status: fresh.status, read: "followed up at Airwallex" }, now);
          status = fresh.status;
        }
      } catch (e) {
        audit(db, "awx-executor", "transfer.follow_failed", r.transfer_id, { error: (e as Error).message.slice(0, 200) }, now);
        continue;
      }
    }
    if (!fee) continue;
    const row = feeRow();
    if (status === "FAILED" || status === "CANCELLED") {
      if (row && ["DUE", "OPEN"].includes(row.status)) {
        db.prepare("UPDATE platform_fees SET status = 'VOID', updated_at = ? WHERE request_id = ?").run(now.toISOString(), fee.request_id);
        audit(db, "awx-executor", "platform_fee.void", fee.request_id, { why: `the payout is ${status}; no fee is owed` }, now);
      }
      continue;
    }
    if (status !== "PAID" || !fresh || (row && ["SETTLED", "NOT_TAKEN", "VOID", "OPEN"].includes(row.status))) continue;
    // The fee went with the payout (application_fee_options): here it is only read off the paid payout and booked.
    out.push({ proposal_id: r.proposal_id, payout: status, fee: takePlatformFee(db, terms, r.terms_sha256, r.proposal_id, fresh) });
  }
  return out;
}
