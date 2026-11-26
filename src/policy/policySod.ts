// Segregation of duties for the CFO policy (26 Nov). Loosening the policy above a threshold the CFO sets
// (approval.policy_sod_eur; off until set) needs the passkeys of two different people, as four eyes does for a payment
// (src/policy/fourEyes.ts asks this module; src/policy/approvals.ts decide() keeps the first signature in cosignatures
// and approves with the second). Tightening stays one person and runs at once. Whoever proposed a policy change
// (its signed proposed_by, else the proposal's owner) never approves it, with one person or two.
//
// What counts as above the threshold, per loosening change (src/policy/loosens.ts decides what loosens):
// - a limit in EUR set or raised: when the new limit is above the threshold (so a limit cannot be walked up in small
//   steps past it: once above, every further raise needs two);
// - a floor or reserve in EUR lowered: when it is lowered by more than the threshold;
// - anything else that loosens (a limit removed, a rule switched off, a payee or a merchant allowed, a new currency, a
//   wider window, a longer mandate, an amount in another unit): there is no euro amount to weigh, so it counts as above,
//   as a payment with no euro value does for four eyes.

import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { loosens } from "./loosens.js";
import { policyValue, ruleFor } from "./rules.js";

export const POLICY_SOD_KEY = "approval.policy_sod_eur";

export interface SodChange { key: string; from: string; to: string; why: string }

const MONEY = /^\d+\.\d{2}$/;

/** Why one loosening change is above the threshold (cents), or null when one person may approve it. */
function aboveWhy(db: DB, c: { key: string; from: string; to: string }, threshold: number): string | null {
  const unit = ruleFor(db, c.key)?.unit;
  const [from, to] = [MONEY.test(c.from) ? toCents(c.from) : null, MONEY.test(c.to) ? toCents(c.to) : null];
  const limit = (cents: number) => `${(cents / 100).toFixed(2)} EUR`;
  if (unit === "EUR" && to !== null && (from === null || to > from)) return to > threshold ? `raised to ${limit(to)}, above ${limit(threshold)}` : null;
  if (unit === "EUR" && to !== null && from !== null && to < from) return from - to > threshold ? `lowered by ${limit(from - to)}, more than ${limit(threshold)}` : null;
  if (unit === "EUR" && c.to === "") return "removed or switched off: no limit left to weigh";
  return "no euro amount to weigh, so it counts as above the threshold";
}

/**
 * The changes of a policy_change's terms that loosen the policy above the segregation-of-duties threshold: each needs a
 * second person. Empty when the threshold is off, or when the change only tightens or loosens below it.
 */
export function sodChanges(db: DB, termsJson: string): SodChange[] {
  const v = policyValue(db, POLICY_SOD_KEY);
  if (!MONEY.test(v)) return [];
  const threshold = toCents(v);
  const changes = (JSON.parse(termsJson) as { changes?: { key?: unknown; from?: unknown; to?: unknown }[] }).changes ?? [];
  const out: SodChange[] = [];
  for (const raw of Array.isArray(changes) ? changes : []) {
    const c = { key: String(raw?.key ?? ""), from: String(raw?.from ?? ""), to: String(raw?.to ?? "") };
    if (!loosens(c)) continue;
    const why = aboveWhy(db, c, threshold);
    if (why) out.push({ ...c, why });
  }
  return out;
}

/** The threshold in force, "" when off. */
export function sodThreshold(db: DB): string {
  return policyValue(db, POLICY_SOD_KEY);
}

/**
 * Who proposed a proposal, as the approvers must not be: a policy change's signed proposed_by (a person's name, inside
 * the hashed terms), else the role that filed it (created_by).
 */
export function proposerOf(p: { kind: string; terms_json: string; created_by: string }): string {
  if (p.kind !== "policy_change") return p.created_by;
  try {
    const by = (JSON.parse(p.terms_json) as { proposed_by?: unknown }).proposed_by;
    return typeof by === "string" && by ? by : p.created_by;
  } catch {
    return p.created_by;
  }
}
