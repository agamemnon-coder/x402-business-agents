// Which transfers' fees the books keep (src/accounting/gl.ts), for the totals that must agree with them: a PAID payout's
// fee, and the fee of a payout that came back after PAID (src/payouts/follow.ts), which Airwallex keeps (non-refundable,
// "Handle failed transfers"). A payout that failed before PAID is not one of them. The payables insights and the control
// tower count the same fees (review, 17 Nov: both counted PAID only, below the books after a return).

/** The audit event src/payouts/follow.ts records for a payout that came back after PAID (its RETURNED_EVENT). */
export const RETURNED_AFTER_PAID = "transfer.returned_after_paid";

/** SQL condition on the transfers table (under `alias`): the transfer's fee is one the books keep. */
export const feeKeptSql = (alias = "transfers"): string =>
  `(${alias}.status = 'PAID' OR (${alias}.status IN ('FAILED', 'CANCELLED') AND EXISTS (SELECT 1 FROM audit_log fk WHERE fk.event = '${RETURNED_AFTER_PAID}' AND fk.subject = ${alias}.transfer_id)))`;
