// Who pays a refund out: small refunds run on their own; one large refund, or a large batch, waits for a person.
// The limits are the seller's (in Purser, the CFO's policy: src/config/policy.ts and src/policy/rules.ts); there is
// no default here, so a seller has to choose them. Purser's src/policy/refunds.ts calls this with its defaults.

export type RefundRoute = { route: "auto" } | { route: "approval"; reason: string };

/** Routes one dispute's refunds, given in whole cents, against a per-refund and a per-dispute limit. */
export function routeRefundBatch(amountsCents: number[], limits: { eachCents: number; perDisputeCents: number }): RefundRoute {
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
