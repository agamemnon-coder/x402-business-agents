// Executes an approved refund_batch proposal: the refunds exactly as approved, one pull per sale.

import type { Address } from "viem";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import type { Terms } from "../lib/terms.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { refundSale } from "./refunds.js";
import type { Puller } from "../metal/pull.js";
import { step, stepDone } from "../policy/saga.js";
import { stopRefusal } from "../policy/holds.js";

export interface RefundBatchTerms extends Terms {
  kind: "refund_batch";
  dispute_id: string;
  customer: string;
  refunds: { sale_id: string; payment_id: string; to: string; amount: string }[];
  total: string;
  reason: string;
  evidence: { type: string; ref: string; sha256: string }[];
}

export async function executeRefundBatch(db: DB, proposalId: string, pull?: Puller): Promise<void> {
  const terms = beginExecution<RefundBatchTerms>(db, proposalId, (t) => {
    const sum = t.refunds.reduce((s, r) => s + toCents(r.amount), 0);
    if (sum !== toCents(t.total)) throw new Error(`refunds add up to ${sum} cents, not ${t.total}`);
    for (const r of t.refunds) if (r.payment_id !== `refund-${r.sale_id}`) throw new Error(`payment id ${r.payment_id} does not name sale ${r.sale_id}`);
  });
  const results = [];
  try {
    // One step per refund in the step log; a refund a crash interrupted is pulled again under its own payment id,
    // which metal-agent pays at most once.
    for (const [i, r] of terms.refunds.entries()) {
      // Before each refund not yet finished (also on a resume after a crash): the emergency stop, the support agent's
      // pause and velocity stop and its identity, asked again (outside audit, 22 November). Stopped, the batch fails here:
      // nothing more is pulled, what was already pulled keeps its state, and a re-run after the stop is lifted continues.
      if (stepDone(db, proposalId, `refund ${r.sale_id}`) === null) {
        const stop = stopRefusal(db, "support", "metal", "customer");
        if (stop) throw new Error(`${stop}; refund ${r.payment_id} is not pulled`);
      }
      results.push(await step(db, proposalId, i + 1, `refund ${r.sale_id}`, r.payment_id, () =>
        refundSale(db, { sale_id: Number(r.sale_id), amount_cents: toCents(r.amount), to: r.to as Address, dispute_id: terms.dispute_id, proposal_id: proposalId }, { pull }), undefined, (x) => x.outcome === "PAID" || x.outcome === "HELD"));
    }
  } catch (err) {
    finishExecution(db, proposalId, "FAILED", { error: (err as Error).message });
    throw err;
  }
  const ok = results.every((r) => r.outcome === "PAID" || r.outcome === "HELD");
  finishExecution(db, proposalId, ok ? "EXECUTED" : "FAILED", { outcomes: results.map((r) => `${r.sale_id}:${r.outcome}`) });
}
