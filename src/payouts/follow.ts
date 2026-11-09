// Following supplier payouts after they were sent (red team 6): live, Airwallex answers a new payout NEW and moves it to
// PAID later (the sandbox's settle step only simulates that), so Purser's fee for it could never be taken at execution.
// Here each written payout of an executed supplier payment is read again from Airwallex (a payout.transfer.paid
// webhook only prompts this; its body is never trusted for money), its row follows, and once it is PAID its Purser fee
// is taken, under the request id in the signed terms, from the account the CFO signed for. A payout that failed voids
// its fee. Nothing here sends a payout.

import type { PayoutRail } from "../airwallex/port.js";
import { checkPayingAccount } from "../airwallex/binding.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { takePlatformFee } from "../executors/supplierPayment.js";
import type { PlatformFields, SupplierPaymentTerms } from "./plan.js";

const FINAL = new Set(["PAID", "FAILED", "CANCELLED"]);

export interface Followed { proposal_id: string; payout: string; fee: string | null }

export async function followPayouts(db: DB, rail: PayoutRail, now = new Date()): Promise<Followed[]> {
  const rows = db.prepare(`SELECT p.proposal_id, p.terms_json, p.terms_sha256, t.transfer_id, t.status FROM proposals p
    JOIN transfers t ON t.request_id = json_extract(p.terms_json, '$.transfer_request_id')
    WHERE p.kind = 'supplier_payment' AND p.status = 'EXECUTED' AND t.transfer_id IS NOT NULL ORDER BY p.proposal_id`).all() as
    { proposal_id: string; terms_json: string; terms_sha256: string; transfer_id: string; status: string }[];
  const out: Followed[] = [];
  for (const r of rows) {
    const terms = JSON.parse(r.terms_json) as SupplierPaymentTerms & PlatformFields;
    let status = r.status;
    if (!FINAL.has(status)) {
      try {
        const fresh = await rail.getTransfer(r.transfer_id);
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
    const fee = terms.platform_fee;
    if (!fee) continue;
    const row = db.prepare("SELECT status FROM platform_fees WHERE request_id = ?").get(fee.request_id) as { status: string } | undefined;
    if (status === "FAILED" || status === "CANCELLED") {
      if (row && ["DUE", "OPEN"].includes(row.status)) {
        db.prepare("UPDATE platform_fees SET status = 'VOID', updated_at = ? WHERE request_id = ?").run(now.toISOString(), fee.request_id);
        audit(db, "awx-executor", "platform_fee.void", fee.request_id, { why: `the payout is ${status}; no fee is owed` }, now);
      }
      continue;
    }
    if (status !== "PAID" || (row && ["SETTLED", "NOT_TAKEN", "VOID"].includes(row.status))) continue;
    try {
      // The fee leaves the account the CFO signed for, the company's own in a valid binding, and nothing else.
      checkPayingAccount(db, terms, rail, now);
    } catch (e) {
      audit(db, "awx-executor", "platform_fee.waiting", fee.request_id, { why: (e as Error).message.slice(0, 300) }, now);
      out.push({ proposal_id: r.proposal_id, payout: status, fee: row?.status ?? "DUE" });
      continue;
    }
    out.push({ proposal_id: r.proposal_id, payout: status, fee: await takePlatformFee(db, rail, terms, r.terms_sha256, r.proposal_id) });
  }
  return out;
}
