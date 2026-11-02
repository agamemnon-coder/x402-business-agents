// Defense in depth, one purchase (Max, 2 November; the main run only). Purser refuses a purchase over the Sourcing
// mandate's cap before anything is signed, so Metal itself never refuses one. To show that the rail enforces the limit
// too, the world can let exactly ONE such purchase past Purser's pre-check to Metal, which must refuse it.
//
//   npm run world -- let-one-through      (or: price-rise 0.04 --silent --let-one-through)
//
// The request is a setting of this world's ledger (world.let_one_through), stage "pending". The world's serve loop
// claims it before its next query (stage "armed") and arms its own Sourcing agent in memory for one purchase, tied to
// that claim. The first purchase Purser refuses over a cap takes it (stage "used", in the same transaction), whatever
// happens next; it lapses after LET_THROUGH_TTL_MS. It never survives a restart: a claimed request is never armed again,
// and the arm itself lives only in that process's memory. Once used, a second request in the world is refused; one
// that lapsed unused may be asked again.
//
// What may pass (src/agents/sourcing.ts): only a Sourcing upstream purchase, only to the supplier the buy policy
// targets, only while the agent is not frozen, paused, stopped or revoked, within its budget, the shared total and the
// velocity limits, and only when the amount is over the cap written in the mandate's bound credential (which Metal's
// Mandate Binding checks on every payment: Metal must refuse it) by at most LET_THROUGH_MAX_OVER_CENTS. Its amount is
// held while it is in flight. If Metal accepts it anyway (an incident), the purchase is
// recorded as paid, the Sourcing agent is stopped (stop.sourcing, lifted only by the CFO's Face ID) and an alarm row is
// written; the most that can move is that one payment, inside the mandate's on-chain budget.

import type { DB } from "../db/open.js";
import { getSetting, setSetting } from "./settings.js";

export const LET_THROUGH_TTL_MS = 10 * 60_000;
/** The most a let-through may be over the bound cap: a price rise of a cent or two, never an arbitrary ask. */
export const LET_THROUGH_MAX_OVER_CENTS = 2;
export const LET_THROUGH_LABEL = "Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved.";

export interface LetThrough {
  stage: "pending" | "armed" | "used" | "expired";
  requested_at: string;
  armed_at?: string;
  /** Used: the purchase it let through (or not), and what came of it. */
  purchase_id?: number;
  seq?: number;
  /** in_flight: taken by a purchase that is now with Metal; inconclusive: refused, but not on the cap by Metal. */
  outcome?: "in_flight" | "metal_refused" | "inconclusive" | "incident" | "not_let_through" | "not_sent";
  detail?: string;
}

export function letThrough(db: DB): LetThrough | null {
  const v = getSetting(db, "world.let_one_through", "");
  try { return v ? (JSON.parse(v) as LetThrough) : null; } catch { return null; }
}

const save = (db: DB, r: LetThrough, now: Date) => setSetting(db, "system", "world.let_one_through", JSON.stringify(r), now);

/** Asks the world's serve loop to let one over-cap purchase through to Metal. Refused while one is under way or once used. */
export function requestLetThrough(db: DB, now = new Date()): LetThrough {
  return db.transaction(() => {
    const r = expireIfDue(db, now);
    if (r && r.stage !== "expired") throw new Error(r.stage === "used" ? `this world already used its one let-through (${r.outcome ?? "used"}); it is not done twice` : `a let-through is already ${r.stage}`);
    const next: LetThrough = { stage: "pending", requested_at: now.toISOString() };
    save(db, next, now);
    return next;
  }).immediate();
}

/** A pending or armed request past its time lapses. */
function expireIfDue(db: DB, now: Date): LetThrough | null {
  const r = letThrough(db);
  if (!r || (r.stage !== "pending" && r.stage !== "armed")) return r;
  const from = Date.parse(r.stage === "armed" ? r.armed_at ?? r.requested_at : r.requested_at);
  if (now.getTime() - from < LET_THROUGH_TTL_MS) return r;
  const next: LetThrough = { ...r, stage: "expired" };
  save(db, next, now);
  return next;
}

/** Before a query, in the world's serve loop: a pending request becomes armed (returned once); otherwise null. */
export function claimLetThrough(db: DB, now = new Date()): LetThrough | null {
  return db.transaction(() => {
    const r = expireIfDue(db, now);
    if (r?.stage !== "pending") return null;
    const next: LetThrough = { ...r, stage: "armed", armed_at: now.toISOString() };
    save(db, next, now);
    return next;
  }).immediate();
}

/**
 * A purchase takes the arm: true only when this ledger's request is armed with exactly `armedAt` (the claim this
 * process made) and not lapsed; it is then marked used, in the same transaction, so no other arm can use it again.
 */
export function consumeLetThrough(db: DB, armedAt: string, now = new Date()): boolean {
  return db.transaction(() => {
    const r = expireIfDue(db, now);
    if (r?.stage !== "armed" || r.armed_at !== armedAt) return false;
    save(db, { ...r, stage: "used", outcome: "in_flight" }, now);
    return true;
  }).immediate();
}

/** What came of the purchase that took the arm (or of the cap refusal that took it without being let through). */
export function finishLetThrough(db: DB, u: { outcome: Exclude<LetThrough["outcome"], "in_flight" | undefined> } & Pick<LetThrough, "purchase_id" | "seq" | "detail">, now = new Date()): void {
  db.transaction(() => {
    const r = letThrough(db);
    if (r?.stage !== "used" || r.outcome !== "in_flight") return;
    save(db, { ...r, ...u, ...(u.detail ? { detail: u.detail.slice(0, 300) } : {}) }, now);
  }).immediate();
}
