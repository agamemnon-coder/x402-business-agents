import { REFUND_AUTO_EACH_CENTS, REFUND_AUTO_PER_DISPUTE_CENTS } from "../config/policy.js";

export type RefundRoute = { route: "auto" } | { route: "approval"; reason: string };

/** Small refunds run on their own; one large item, or a large batch, waits for a person (CFO policy thresholds). */
export function routeRefundBatch(
  amountsCents: number[],
  limits: { eachCents: number; perDisputeCents: number } = { eachCents: REFUND_AUTO_EACH_CENTS, perDisputeCents: REFUND_AUTO_PER_DISPUTE_CENTS },
): RefundRoute {
  if (amountsCents.length === 0) throw new Error("empty refund batch");
  for (const a of amountsCents) if (!Number.isSafeInteger(a) || a <= 0) throw new Error(`bad refund amount: ${a}`);
  const big = amountsCents.find((a) => a > limits.eachCents);
  if (big !== undefined) return { route: "approval", reason: `one refund is ${big} cents, over the ${limits.eachCents} cent limit` };
  const total = amountsCents.reduce((s, a) => s + a, 0);
  if (total > limits.perDisputeCents) {
    return { route: "approval", reason: `the batch is ${total} cents, over the ${limits.perDisputeCents} cent limit per dispute` };
  }
  return { route: "auto" };
}
