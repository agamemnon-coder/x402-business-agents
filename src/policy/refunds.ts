import { REFUND_AUTO_EACH_CENTS, REFUND_AUTO_PER_DISPUTE_CENTS } from "../config/policy.js";

export type RefundRoute = { route: "auto" } | { route: "approval"; reason: string };

/** Small refunds run on their own; one large item, or a large batch, waits for a person. */
export function routeRefundBatch(amountsCents: number[]): RefundRoute {
  if (amountsCents.length === 0) throw new Error("empty refund batch");
  for (const a of amountsCents) if (!Number.isSafeInteger(a) || a <= 0) throw new Error(`bad refund amount: ${a}`);
  const big = amountsCents.find((a) => a > REFUND_AUTO_EACH_CENTS);
  if (big !== undefined) return { route: "approval", reason: `one refund is ${big} cents, over the ${REFUND_AUTO_EACH_CENTS} cent limit` };
  const total = amountsCents.reduce((s, a) => s + a, 0);
  if (total > REFUND_AUTO_PER_DISPUTE_CENTS) {
    return { route: "approval", reason: `the batch is ${total} cents, over the ${REFUND_AUTO_PER_DISPUTE_CENTS} cent limit per dispute` };
  }
  return { route: "auto" };
}
