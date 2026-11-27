// Segregation of duties for the CFO policy (26 Nov). Loosening the policy above a threshold the CFO sets
// (approval.policy_sod_eur; off until set) needs the passkeys of two different people, as four eyes does for a payment
// (src/policy/fourEyes.ts asks this module; src/policy/approvals.ts decide() keeps the first signature in cosignatures
// and approves with the second). Tightening stays one person and runs at once. Whoever proposed a policy change
// (its signed proposed_by, else the proposal's owner) never approves it, with one person or two.
//
// What counts as above the threshold, per loosening change (src/policy/loosens.ts decides what loosens):
// - a limit in EUR set or raised: when the new limit is above the threshold (so a limit cannot be walked up in small
//   steps past it: once above, every further raise needs two);
// - a floor or reserve in EUR lowered: when it ends more than the threshold below the higher of its value just before
//   and its reference (27 Nov, red team, runner finding 4: a floor walked down in steps under the threshold): the value
//   two people last approved for it, or, when two people never did, its highest within SOD_FLOOR_WINDOW_DAYS. So a floor
//   cannot be walked down in small steps past it either: once below by more, every further lowering needs two;
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

/**
 * How far back one person's values of a floor count when no two people ever approved it (runner finding 4): a quarter.
 * A floor lowered in steps under the threshold is weighed against its highest value in this window, so one person would
 * need more than three months between steps to walk it down; two people's approval sets a new reference at once.
 */
export const SOD_FLOOR_WINDOW_DAYS = 90;

/**
 * What a floor's lowering is weighed against, in cents, with why; null when nothing on record: the value two people last
 * approved for it (an executed policy change with two cosignatures over its terms), else its highest value, before or
 * after, in the executed policy changes approved within SOD_FLOOR_WINDOW_DAYS before `now`.
 */
function floorReference(db: DB, key: string, now: Date): { cents: number; why: string } | null {
  const rows = db.prepare(`SELECT p.proposal_id, p.terms_json, MAX(a.created_at) AS at,
      (SELECT COUNT(DISTINCT c.person) FROM cosignatures c WHERE c.proposal_id = p.proposal_id AND c.terms_sha256 = p.terms_sha256) AS people
    FROM proposals p JOIN approvals a ON a.proposal_id = p.proposal_id AND a.decision = 'APPROVED'
    WHERE p.kind = 'policy_change' AND p.status = 'EXECUTED' AND a.created_at <= ? GROUP BY p.proposal_id ORDER BY at DESC`).all(now.toISOString()) as { terms_json: string; at: string; people: number }[];
  const since = new Date(now.getTime() - SOD_FLOOR_WINDOW_DAYS * 86_400_000).toISOString();
  let high: number | null = null;
  for (const r of rows) {
    let changes: { key?: unknown; from?: unknown; to?: unknown }[];
    try { changes = (JSON.parse(r.terms_json) as { changes?: typeof changes }).changes ?? []; } catch { continue; }
    const c = changes.find((x) => x?.key === key);
    if (!c) continue;
    const to = typeof c.to === "string" && MONEY.test(c.to) ? toCents(c.to) : null;
    if (r.people >= 2 && to !== null) return { cents: to, why: "its value as last approved by two people" };
    if (r.at < since) continue;
    for (const v of [c.from, c.to]) if (typeof v === "string" && MONEY.test(v)) high = Math.max(high ?? 0, toCents(v));
  }
  return high === null ? null : { cents: high, why: `its highest in the last ${SOD_FLOOR_WINDOW_DAYS} days` };
}

/** Why one loosening change is above the threshold (cents), or null when one person may approve it. */
function aboveWhy(db: DB, c: { key: string; from: string; to: string }, threshold: number, now: Date): string | null {
  const unit = ruleFor(db, c.key)?.unit;
  const [from, to] = [MONEY.test(c.from) ? toCents(c.from) : null, MONEY.test(c.to) ? toCents(c.to) : null];
  const limit = (cents: number) => `${(cents / 100).toFixed(2)} EUR`;
  if (unit === "EUR" && to !== null && (from === null || to > from)) return to > threshold ? `raised to ${limit(to)}, above ${limit(threshold)}` : null;
  if (unit === "EUR" && to !== null && from !== null && to < from) {
    const ref = floorReference(db, c.key, now);
    if (ref && ref.cents > from) return ref.cents - to > threshold ? `lowered to ${limit(to)}, ${limit(ref.cents - to)} below ${limit(ref.cents)}, ${ref.why}, more than ${limit(threshold)}` : null;
    return from - to > threshold ? `lowered by ${limit(from - to)}, more than ${limit(threshold)}` : null;
  }
  if (unit === "EUR" && c.to === "") return "removed or switched off: no limit left to weigh";
  return "no euro amount to weigh, so it counts as above the threshold";
}

/**
 * The changes of a policy_change's terms that loosen the policy above the segregation-of-duties threshold: each needs a
 * second person. Empty when the threshold is off, or when the change only tightens or loosens below it. `now`: when it is
 * weighed, for the window of a floor's earlier values (SOD_FLOOR_WINDOW_DAYS).
 */
export function sodChanges(db: DB, termsJson: string, now = new Date()): SodChange[] {
  const v = policyValue(db, POLICY_SOD_KEY);
  if (!MONEY.test(v)) return [];
  const threshold = toCents(v);
  const changes = (JSON.parse(termsJson) as { changes?: { key?: unknown; from?: unknown; to?: unknown }[] }).changes ?? [];
  const out: SodChange[] = [];
  for (const raw of Array.isArray(changes) ? changes : []) {
    const c = { key: String(raw?.key ?? ""), from: String(raw?.from ?? ""), to: String(raw?.to ?? "") };
    if (!loosens(c)) continue;
    const why = aboveWhy(db, c, threshold, now);
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
