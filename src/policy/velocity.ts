// Velocity limits (security item 2). Each payment an agent makes is counted in a sliding minute (how many) and a
// sliding hour (how much, per rail). One payment over a limit stops that agent at once: code sets stop.<agent> to on,
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

/** The start of the counting window: never before the stop was last lifted, so a lifted agent starts clean. */
function windowStart(db: DB, agent: string, now: Date, span: number): string {
  const lifted = db.prepare("SELECT updated_at FROM settings WHERE key = ? AND value != 'on'").get(stopKey(agent)) as { updated_at: string } | undefined;
  const from = now.getTime() - span;
  const liftedAt = lifted ? Date.parse(lifted.updated_at) : NaN;
  return new Date(Number.isFinite(liftedAt) && liftedAt > from ? liftedAt : from).toISOString();
}

/** The breach this payment would cause, in words, or null. Counts what is on record plus this payment. */
function breach(db: DB, agent: string, rail: Rail, cents: number, approved: boolean, now: Date): string | null {
  const lim = limitsOf(agent);
  const end = now.toISOString();
  const count = (db.prepare("SELECT COUNT(*) AS n FROM velocity_events WHERE agent = ? AND at > ? AND at <= ?").get(agent, windowStart(db, agent, now, MINUTE), end) as { n: number }).n + 1;
  if (count > lim.perMinute) return `${count} payments in a minute, the limit is ${lim.perMinute}`;
  if (!approved) return null;
  const spent = (db.prepare("SELECT COALESCE(SUM(cents), 0) AS c FROM velocity_events WHERE agent = ? AND rail = ? AND approved = 1 AND at > ? AND at <= ?")
    .get(agent, rail, windowStart(db, agent, now, HOUR), end) as { c: number }).c + cents;
  const max = rail === "metal" ? lim.usdzPerHourCents : lim.eurPerHourCents;
  const unit = rail === "metal" ? "USDZ" : "EUR";
  return spent > max ? `${fromCents(spent)} ${unit} in an hour, the limit is ${fromCents(max)} ${unit}` : null;
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
export function velocityGate(db: DB, agent: string, rail: Rail, cents: number, now = new Date()): string | null {
  return db.transaction((): string | null => {
    if (stopped(db, agent)) return `stopped_by_velocity: the ${agent} agent was stopped automatically; the CFO lifts it with Face ID`;
    const why = breach(db, agent, rail, cents, true, now);
    if (why) {
      trip(db, agent, rail, why, now);
      return `velocity_exceeded: ${why}; the ${agent} agent is stopped until the CFO lifts it with Face ID`;
    }
    db.prepare("INSERT INTO velocity_events (agent, rail, cents, approved, at) VALUES (?, ?, ?, 1, ?)").run(agent, rail, cents, now.toISOString());
    return null;
  }).immediate();
}

/**
 * Called once for each card charge Airwallex reports. The charge has happened already, so it is always counted; one
 * over a limit stops the agent, and the next card sync freezes the card. Returns the breach, or null.
 */
export function velocityObserve(db: DB, agent: string, cents: number, approved: boolean, now = new Date()): string | null {
  return db.transaction((): string | null => {
    const why = stopped(db, agent) ? null : breach(db, agent, "card", cents, approved, now);
    db.prepare("INSERT INTO velocity_events (agent, rail, cents, approved, at) VALUES (?, 'card', ?, ?, ?)").run(agent, cents, approved ? 1 : 0, now.toISOString());
    if (!why) return null;
    trip(db, agent, "card", why, now);
    return `velocity_exceeded: ${why}`;
  }).immediate();
}

