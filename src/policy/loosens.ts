// Whether a CFO policy change loosens the policy. Pure (no database, no Node modules), so the runner's rules
// (src/policy/rules.ts re-exports it) and /try/sign's policy step (src/try/policy.ts) decide it with the same code.

/**
 * Whether a change makes the policy less strict: a higher or removed agent limit, a higher approval threshold, a
 * lower reserve floor, or a payee unblocked. The phone may only tighten (review N2); loosening is proposed on the
 * runner (npm run policy -- set) and then approved with Face ID like any proposal.
 */
export function loosens(c: { key: string; from: string; to: string }): boolean {
  const cents = (v: string) => (/^\d+\.\d{2}$/.test(v) ? Number(v.replace(".", "")) : null);
  const [from, to] = [cents(c.from), cents(c.to)];
  // The Airi rail (src/airi/policy.ts): more purchases a day without Face ID, or a merchant allowed, loosens.
  if (c.key === "approval.airi_alone_per_day") return /^\d+$/.test(c.from) && (!/^\d+$/.test(c.to) || Number(c.to) > Number(c.from));
  if (c.key.startsWith("airi.merchant.")) return c.from !== "allowed" && c.to === "allowed";
  if (c.key.startsWith("cap.")) return from !== null && (to === null || to > from);
  if (c.key.startsWith("card.")) return from !== null && (to === null || to > from);
  // Four eyes: turning it off or raising the threshold loosens; turning it on or lowering it tightens.
  if (c.key === "approval.four_eyes_eur") return from !== null && (to === null || to > from);
  // A second key for high-risk payments: off, or a higher amount, loosens; on, or a lower amount, tightens.
  if (c.key === "approval.second_key_eur") return from !== null && (to === null || to > from);
  if (c.key.startsWith("approval.second_key_")) return c.from === "on" && c.to !== "on";
  if (c.key.startsWith("approval.")) return from !== null && to !== null && to > from;
  if (c.key.endsWith("_floor") || c.key.startsWith("floor.")) return from !== null && (to === null || to < from);
  // Supplier payouts: less held back for the fee loosens; any other funding currency is a change for Face ID.
  if (c.key.startsWith("fee_reserve.")) return from !== null && (to === null || to < from);
  if (c.key.startsWith("counterparty:")) return c.from === "blocked" && c.to === "allowed";
  if (c.key === "freeze" || c.key.startsWith("stop.") || c.key.startsWith("pause.")) return c.from === "on" && c.to !== "on";
  return true;
}
