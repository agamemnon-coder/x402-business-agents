// The arithmetic of paying alone (approveWithinLimit, src/policy/approvals.ts): whether a payment's stored amount and
// currency are within the CFO's limit to pay alone, in integer cents. Proven in formal/dafny/Limit.dfy (AloneDecision,
// PaidAloneIffWithinLimit) and run against that proof's compiled reference in test/formal-dafny-differential.test.ts.
// Until 19 November approveWithinLimit computed cents as Math.round(Number(a) * 100): right for every amount this
// regular expression accepts, but a float; now it is integer arithmetic only (docs/evidence/formal-proofs.md).

/** A plain amount: 1 to 9 digits (leading zeros allowed), a dot, 2 digits. */
const PLAIN = /^(\d{1,9})\.(\d{2})$/;

/**
 * The cents of a plain amount, or null. Exact: at most 99,999,999,999 cents, so every step is a JavaScript integer far
 * below 2^53.
 */
export function plainCents(amount: string): number | null {
  const m = PLAIN.exec(amount);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

/** no_limit: no limit to pay alone is set; not_within: the amount or currency is not within it; within: it is. */
export type AloneDecision = "no_limit" | "not_within" | "within";

/**
 * Within only when the limit is a plain amount above zero, the amount is a plain amount (a string) in the limit's own
 * currency, and amount_cents <= limit_cents.
 */
export function aloneDecision(amount: unknown, currency: unknown, limit: { currency: string; amount: string }): AloneDecision {
  const top = plainCents(limit.amount);
  if (top === null || top <= 0) return "no_limit";
  const cents = typeof amount === "string" ? plainCents(amount) : null;
  if (cents === null || currency !== limit.currency || cents > top) return "not_within";
  return "within";
}
