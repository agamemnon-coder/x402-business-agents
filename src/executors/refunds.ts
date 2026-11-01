// Refunds are `mandate pull`s under the support agent's mandate (payee: the customer only, cap 0.10).
// Each carries the payment id refund-<sale_id>: the database allows one refund per sale, and metal-agent
// pays a payment id at most once, so a retry after a crash reports the first outcome instead of paying again.

import { originJson, parseOrigin, withOrigin } from "../provenance/origin.js";
import { releaseHold, reserveSpend, settleHold } from "../policy/holds.js";
import type { Address } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { livePull, type Puller } from "../metal/pull.js";
import { checkpoint } from "../policy/saga.js";
import { capRefusal } from "../policy/rules.js";
import { velocityGate } from "../policy/velocity.js";

export type RefundOutcome = "PAID" | "REFUSED" | "PENDING" | "HELD";

export interface RefundResult {
  sale_id: number;
  payment_id: string;
  outcome: RefundOutcome;
  tx: string | null;
  reason: string | null;
  already: boolean;
}

export async function refundSale(
  db: DB,
  r: { sale_id: number; amount_cents: number; to: Address; dispute_id: string; proposal_id?: string },
  opts: { retry?: boolean; pull?: Puller } = {},
): Promise<RefundResult> {
  // D24: a refund already sent (PENDING) or held is the same action, finished under the origin it started with; a
  // refused one started again (an agent's retry, or the CFO's batch) is a new attempt with the origin in force now.
  const before = db.prepare("SELECT outcome, origin_json FROM refunds WHERE sale_id = ?").get(r.sale_id) as { outcome: string; origin_json: string | null } | undefined;
  const stored = before && (before.outcome === "PENDING" || before.outcome === "HELD") ? parseOrigin(before.origin_json) : null;
  if (stored) return withOrigin(stored, () => refundUnder(db, r, opts));
  if (before && (before.outcome === "REFUSED" || before.outcome === "PROPOSED") && !opts.retry) {
    db.prepare("UPDATE refunds SET origin_json = ?, proposal_id = COALESCE(?, proposal_id) WHERE sale_id = ?").run(originJson(), r.proposal_id ?? null, r.sale_id);
  }
  return refundUnder(db, r, opts);
}

async function refundUnder(
  db: DB,
  r: { sale_id: number; amount_cents: number; to: Address; dispute_id: string; proposal_id?: string },
  opts: { retry?: boolean; pull?: Puller },
): Promise<RefundResult> {
  const paymentId = `refund-${r.sale_id}`;
  const sale = db.prepare("SELECT payer, price_cents FROM sales WHERE sale_id = ? AND status = 'DELIVERED'").get(r.sale_id) as { payer: string; price_cents: number } | undefined;
  if (!sale) throw new Error(`no delivered sale ${r.sale_id}`);
  if (sale.payer.toLowerCase() !== r.to.toLowerCase()) throw new Error(`sale ${r.sale_id} was paid by ${sale.payer}; a refund goes back to the payer only`);
  if (r.amount_cents > sale.price_cents) throw new Error(`refund ${r.amount_cents} exceeds what sale ${r.sale_id} cost`);

  const existing = db.prepare("SELECT outcome, tx_hash, payment_id FROM refunds WHERE sale_id = ?").get(r.sale_id) as { outcome: RefundOutcome | "PROPOSED"; tx_hash: string | null } | undefined;
  // A retry repeats a refund that was started; it never starts one (nothing approved it).
  if (opts.retry && !existing) {
    return { sale_id: r.sale_id, payment_id: paymentId, outcome: "REFUSED", tx: null, reason: "nothing to retry: this sale has no refund yet", already: false };
  }
  if (existing && (existing.outcome === "PAID" || existing.outcome === "HELD") && !opts.retry) {
    return { sale_id: r.sale_id, payment_id: paymentId, outcome: existing.outcome, tx: existing.tx_hash, reason: null, already: true };
  }
  if (!existing) {
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, proposal_id, dispute_id, origin_json) VALUES (?, ?, ?, ?, 'PROPOSED', ?, ?, ?)")
      .run(r.sale_id, paymentId, r.amount_cents, r.to, r.proposal_id ?? null, r.dispute_id, originJson());
  }

  // The CFO policy's limit per refund, the velocity limits, the mandate's budget and the agents' shared total, reserved
  // together before anything is signed (a hold). A pull already sent is counted by its ledger row: its retry only checks.
  const inFlight = !!existing && (existing.outcome === "PENDING" || existing.outcome === "HELD");
  const refusal = inFlight
    ? capRefusal(db, "support", r.amount_cents) ?? velocityGate(db, "support", "metal", r.amount_cents, new Date(), paymentId)
    : reserveSpend(db, { agent: "support", rail: "metal", cents: r.amount_cents, ref: paymentId, payee: "customer" });
  if (refusal) {
    // A pull already sent (PENDING) or held may still settle on chain: refuse to send anything now, but keep its state.
    if (existing && (existing.outcome === "PENDING" || existing.outcome === "HELD")) {
      audit(db, "support", "refund.deferred", String(r.sale_id), { payment_id: paymentId, amount: fromCents(r.amount_cents), to: r.to, tx: null, reason: refusal, kept: existing.outcome });
      return { sale_id: r.sale_id, payment_id: paymentId, outcome: existing.outcome, tx: existing.tx_hash, reason: refusal, already: false };
    }
    db.prepare("UPDATE refunds SET outcome = 'REFUSED', refusal_reason = ? WHERE sale_id = ?").run(refusal, r.sale_id);
    audit(db, "support", "refund.refused", String(r.sale_id), { payment_id: paymentId, amount: fromCents(r.amount_cents), to: r.to, tx: null, reason: refusal });
    return { sale_id: r.sale_id, payment_id: paymentId, outcome: "REFUSED", tx: null, reason: refusal, already: false };
  }
  await checkpoint("refund:before-pull");
  const { outcome, tx, reason, already } = await (opts.pull ?? livePull)({ agent: "support", to: r.to, amountCents: r.amount_cents, paymentId });
  // A crash here: the pull may be on chain, the ledger does not know. The retry pulls the same payment id again,
  // and metal-agent answers "already paid, nothing sent".
  await checkpoint("refund:after-pull");
  db.prepare("UPDATE refunds SET outcome = ?, tx_hash = COALESCE(?, tx_hash), refusal_reason = ? WHERE sale_id = ?").run(outcome, tx, reason, r.sale_id);
  if (outcome === "REFUSED") releaseHold(db, paymentId, reason ?? "refused on chain");
  else settleHold(db, paymentId);
  audit(db, "support", already ? "refund.already_paid" : `refund.${outcome.toLowerCase()}`, String(r.sale_id), { payment_id: paymentId, amount: fromCents(r.amount_cents), to: r.to, tx, reason });
  return { sale_id: r.sale_id, payment_id: paymentId, outcome, tx, reason, already };
}
