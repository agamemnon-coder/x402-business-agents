// Velocity limits (security item 2). Each approved payment an agent makes is counted in a sliding minute (how many)
// and a sliding hour (how much, per rail). One payment over a limit stops that agent at once: code sets stop.<agent> to on,
// every payment it tries after that is refused before signing, and the runner freezes its card at Airwallex. Only an
// approved policy change (Face ID) lifts the stop; the phone may never send it (a loosening). Other agents go on.
//
// Metal payments pass velocityGate just before they are signed, so a refused one is never made. Card charges are made
// by the merchant, so velocityObserve sees them as Airwallex reports them and stops the agent after the fact.

import { audit } from "../audit/log.js";
import { VELOCITY, type Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";

export type Rail = "metal" | "card";

const MINUTE = 60_000;
const HOUR = 3_600_000;

const limitsOf = (agent: string) => VELOCITY[(agent in VELOCITY ? agent : "outside") as Agent | "outside"];
const stopKey = (agent: string) => `stop.${agent}`;

/** Whether code (or the CFO) has stopped this agent. */
export function stopped(db: DB, agent: string): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(stopKey(agent)) as { value: string } | undefined;
  return row?.value === "on";
}

/** Why this agent is stopped, from the audit log, or null. */
export function stopReason(db: DB, agent: string): { since: string; reason: string } | null {
  if (!stopped(db, agent)) return null;
  const r = db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = 'velocity.tripped' AND subject = ? ORDER BY seq DESC LIMIT 1").get(agent) as { ts: string; payload_json: string } | undefined;
  return r ? { since: r.ts, reason: String((JSON.parse(r.payload_json) as { reason?: unknown }).reason ?? "") } : { since: "", reason: "stopped by the CFO" };
}

/** When this agent's stop was last lifted (ms), or 0: a lifted agent starts with a clean window. */
function liftedAt(db: DB, agent: string): number {
  const row = db.prepare("SELECT updated_at FROM settings WHERE key = ? AND value != 'on'").get(stopKey(agent)) as { updated_at: string } | undefined;
  const t = row ? Date.parse(row.updated_at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * The breach this payment would cause, in words, or null. Payments are reported out of order (a card poll holds back
 * fresh approvals, webhooks are not ordered), so every window that would contain this payment is checked: the one
 * ending at it, and each one ending at a payment on record up to a minute (an hour) after it. Only approved payments
 * count; a declined card attempt moves no money (and counting it would let anyone with the card number stop an agent).
 */
function breach(db: DB, agent: string, rail: Rail, cents: number, at: Date): string | null {
  const lim = limitsOf(agent);
  const lifted = liftedAt(db, agent);
  const t = at.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const ends = (span: number, railOnly: boolean) => [t, ...(db.prepare(`SELECT at FROM velocity_events WHERE agent = ? AND approved = 1 ${railOnly ? "AND rail = ?" : ""} AND at > ? AND at <= ?`)
    .all(...[agent, ...(railOnly ? [rail] : []), iso(t), iso(t + span)]) as { at: string }[]).map((r) => Date.parse(r.at))];
  for (const end of ends(MINUTE, false)) {
    const from = Math.max(end - MINUTE, lifted);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM velocity_events WHERE agent = ? AND approved = 1 AND at > ? AND at <= ?").get(agent, iso(from), iso(end)) as { n: number }).n + 1;
    if (count > lim.perMinute) return `${count} payments in a minute, the limit is ${lim.perMinute}`;
  }
  const max = rail === "metal" ? lim.usdzPerHourCents : lim.eurPerHourCents;
  const unit = rail === "metal" ? "USDZ" : "EUR";
  for (const end of ends(HOUR, true)) {
    const from = Math.max(end - HOUR, lifted);
    const spent = (db.prepare("SELECT COALESCE(SUM(cents), 0) AS c FROM velocity_events WHERE agent = ? AND rail = ? AND approved = 1 AND at > ? AND at <= ?")
      .get(agent, rail, iso(from), iso(end)) as { c: number }).c + cents;
    if (spent > max) return `${fromCents(spent)} ${unit} in an hour, the limit is ${fromCents(max)} ${unit}`;
  }
  return null;
}

function trip(db: DB, agent: string, rail: Rail, reason: string, now: Date): void {
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, 'on', ?) ON CONFLICT(key) DO UPDATE SET value = 'on', updated_at = excluded.updated_at")
    .run(stopKey(agent), now.toISOString());
  audit(db, "system", "velocity.tripped", agent, { agent, rail, reason, lift: "an approved policy change (Face ID) setting this agent's stop to off" }, now);
}

/**
 * Called just before an agent signs a payment on Metal: null lets it through (and counts it); otherwise the reason it
 * must not be signed. A payment over a limit stops the agent and is not made.
 */
export function velocityGate(db: DB, agent: string, rail: Rail, cents: number, now = new Date(), paymentId?: string): string | null {
  return db.transaction((): string | null => {
    if (stopped(db, agent)) return `stopped_by_velocity: the ${agent} agent was stopped automatically; the CFO lifts it with Face ID`;
    // A retry under the same payment id is the same payment: counted once.
    if (paymentId && db.prepare("SELECT 1 FROM velocity_events WHERE payment_id = ?").get(paymentId)) return null;
    const why = breach(db, agent, rail, cents, now);
    if (why) {
      trip(db, agent, rail, why, now);
      return `velocity_exceeded: ${why}; the ${agent} agent is stopped until the CFO lifts it with Face ID`;
    }
    db.prepare("INSERT INTO velocity_events (agent, rail, cents, approved, at, payment_id) VALUES (?, ?, ?, 1, ?, ?)").run(agent, rail, cents, now.toISOString(), paymentId ?? null);
    return null;
  }).immediate();
}

/**
 * Called once for each card charge Airwallex reports. The charge has happened already, so it is always recorded; an
 * approved one over a limit stops the agent: its purchases are refused in code at once, and the next card sync
 * freezes the card at Airwallex. Returns the breach, or null.
 */
export function velocityObserve(db: DB, agent: string, cents: number, approved: boolean, now = new Date()): string | null {
  return db.transaction((): string | null => {
    const why = stopped(db, agent) || !approved ? null : breach(db, agent, "card", cents, now);
    db.prepare("INSERT INTO velocity_events (agent, rail, cents, approved, at) VALUES (?, 'card', ?, ?, ?)").run(agent, cents, approved ? 1 : 0, now.toISOString());
    if (!why) return null;
    trip(db, agent, "card", why, now);
    return `velocity_exceeded: ${why}`;
  }).immediate();
}

