import { routeRefundBatch as route, type RefundRoute } from "../../examples/metal-dispute-desk/src/refunds.js";
import { REFUND_AUTO_EACH_CENTS, REFUND_AUTO_PER_DISPUTE_CENTS } from "../config/policy.js";

export type { RefundRoute };

/**
 * Small refunds run on their own; one large item, or a large batch, waits for a person (CFO policy thresholds).
 * The rule is the shared one in examples/metal-dispute-desk; Purser adds its default limits.
 */
export function routeRefundBatch(
  amountsCents: number[],
  limits: { eachCents: number; perDisputeCents: number } = { eachCents: REFUND_AUTO_EACH_CENTS, perDisputeCents: REFUND_AUTO_PER_DISPUTE_CENTS },
): RefundRoute {
  return route(amountsCents, limits);
}

/** A dispute's refund plan: none when code's data check finds no delivered sale wrong, else the shared rule's route. */
export function planRefunds(
  amountsCents: number[],
  limits?: { eachCents: number; perDisputeCents: number },
): RefundRoute | { route: "none" } {
  return amountsCents.length === 0 ? { route: "none" } : routeRefundBatch(amountsCents, limits);
}
