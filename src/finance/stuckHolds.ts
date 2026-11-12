// Money held for a payment that is no longer running (payout_reservations, src/policy/payoutLock.ts): a hold stays
// HELD when its execution died between the hold and the moment its payout row or conversion was recorded (a crash, a
// lost answer). Such a hold keeps counting against the floors. `npm run reconcile -- --holds` lists them;
// `npm run reconcile -- --release-hold <key>` releases one, only when all of these hold (seam review L4):
// - the hold is HELD and older than STUCK_HOLD_MIN_AGE_MINUTES;
// - its proposal is not APPROVED or EXECUTING (nothing may still pick it up);
// - and the money it speaks for is counted elsewhere or never moved: a payout hold whose payout row is written (the row
//   counts it), or whose request_id a strict look-up at Airwallex finds no transfer under; a conversion hold whose
//   conversion is recorded (it is in the balance), or whose request_id Airwallex finds no conversion under.
// Anything Airwallex does hold, or a look-up that fails, is refused: a person resolves it (a re-run of the proposal
// adopts what Airwallex holds). It reads Airwallex, never writes to it; the release is audited.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";

export const STUCK_HOLD_MIN_AGE_MINUTES = 30;

export interface StuckHold { key: string; proposal_id: string; proposal_status: string; kind: "payout" | "conversion" | "unknown"; currency: string; cents: number; since: string }

/** The look-ups a release needs at Airwallex, both strict (an error is an error, never "nothing"). */
export interface HoldLookup {
  transfer(requestId: string): Promise<{ id: string; status: string } | undefined>;
  conversion(requestId: string): Promise<{ id: string; status: string } | undefined>;
}

function kindOf(termsJson: string | null, key: string): StuckHold["kind"] {
  if (!termsJson) return "unknown";
  const t = JSON.parse(termsJson) as { transfer_request_id?: string; conversion?: { request_id?: string } | null };
  return t.transfer_request_id === key ? "payout" : t.conversion?.request_id === key ? "conversion" : "unknown";
}

/** Holds whose proposal is no longer running and that are older than the minimum age, oldest first. */
export function stuckHolds(db: DB, now = new Date(), minAgeMinutes = STUCK_HOLD_MIN_AGE_MINUTES): StuckHold[] {
  const before = new Date(now.getTime() - minAgeMinutes * 60_000).toISOString();
  const rows = db.prepare(`SELECT r.key, r.proposal_id, r.currency, r.cents, r.updated_at, p.status, p.terms_json FROM payout_reservations r
    LEFT JOIN proposals p ON p.proposal_id = r.proposal_id WHERE r.status = 'HELD' AND r.updated_at <= ? ORDER BY r.updated_at`).all(before) as
    { key: string; proposal_id: string; currency: string; cents: number; updated_at: string; status: string | null; terms_json: string | null }[];
  return rows.filter((r) => r.status !== "APPROVED" && r.status !== "EXECUTING").map((r) => ({
    key: r.key, proposal_id: r.proposal_id, proposal_status: r.status ?? "missing", kind: kindOf(r.terms_json, r.key), currency: r.currency, cents: r.cents, since: r.updated_at,
  }));
}

export type ReleaseResult = { released: true; key: string; why: string } | { released: false; reason: string };

/** Releases one stuck hold after the checks above; refuses in every other case. */
export async function releaseStuckHold(db: DB, key: string, lookup: HoldLookup, now = new Date()): Promise<ReleaseResult> {
  const h = stuckHolds(db, now).find((x) => x.key === key);
  if (!h) return { released: false, reason: `${key} is not a stuck hold (not HELD, younger than ${STUCK_HOLD_MIN_AGE_MINUTES} minutes, or its proposal may still run)` };
  let why: string;
  try {
    if (h.kind === "payout") {
      if (db.prepare("SELECT 1 FROM transfers WHERE request_id = ?").get(key)) why = "its payout row is written and counts the money itself";
      else {
        const t = await lookup.transfer(key);
        if (t) return { released: false, reason: `Airwallex holds transfer ${t.id} (${t.status}) under ${key}; re-run ${h.proposal_id} to adopt it, or a person resolves it` };
        why = "Airwallex holds no transfer under its request_id";
      }
    } else if (h.kind === "conversion") {
      if (db.prepare("SELECT 1 FROM fx_conversions WHERE request_id = ?").get(key)) why = "its conversion is recorded and is in the balance";
      else {
        const c = await lookup.conversion(key);
        if (c) return { released: false, reason: `Airwallex holds conversion ${c.id} (${c.status}) under ${key}; re-run ${h.proposal_id} to record it, or a person resolves it` };
        why = "Airwallex holds no conversion under its request_id";
      }
    } else {
      return { released: false, reason: `${key} is neither the payout nor the conversion of ${h.proposal_id}; a person checks it` };
    }
  } catch (e) {
    return { released: false, reason: `the look-up at Airwallex failed (${(e as Error).message}); nothing is released without it` };
  }
  const done = db.prepare("UPDATE payout_reservations SET status = 'RELEASED', updated_at = ? WHERE key = ? AND status = 'HELD'").run(now.toISOString(), key);
  if (done.changes !== 1) return { released: false, reason: `${key} changed while Airwallex was being asked; nothing is released` };
  audit(db, "human", "payout.hold_released", key, { proposal_id: h.proposal_id, currency: h.currency, cents: h.cents, why, command: "npm run reconcile -- --release-hold" }, now);
  return { released: true, key, why };
}
