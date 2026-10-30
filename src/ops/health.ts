// Basic monitoring (backend review B7): what an operator needs to be woken for, from the ledger alone. The runner
// computes it and sends it with every snapshot; the relay's /health answers 503 while any alarm stands or when the
// runner has not synced for two minutes (it cannot report its own outage), so an uptime monitor pointed at it pages a
// person. Locally the dashboard server serves the same as /health and as Prometheus metrics on /metrics.

import type { DB } from "../db/open.js";
import { lastReconciliation } from "../finance/reconcile.js";
import { frozen } from "../policy/rules.js";

import type { Alert, Health } from "./publicHealth.js";
export type { Alert, Health, Severity } from "./publicHealth.js";

/** An action executing longer than this is stuck (a crash the runner has not resumed, or an outside call hanging). */
export const STUCK_AFTER_MS = 10 * 60_000;
/** A hold older than this was never settled or released. */
export const HOLD_STALE_AFTER_MS = 60 * 60_000;
/**
 * The runner reconciles the ledger with Airwallex and the chain every hour, so a payment that reached neither the
 * webhook nor the poll (the red team's hidden card payment) is found within the hour, not prevented.
 */
export const RECONCILE_EVERY_MS = 60 * 60_000;
/** Older than three rounds, the reconciliation stopped. */
export const RECONCILE_STALE_AFTER_MS = 3 * RECONCILE_EVERY_MS;

const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const n = (db: DB, sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number | null }).n ?? 0;

export function health(db: DB, now = new Date()): Health {
  const alerts: Alert[] = [];

  const freeze = db.prepare("SELECT ts FROM audit_log WHERE event = 'policy.changed' AND subject = 'freeze' ORDER BY seq DESC LIMIT 1").get() as { ts: string } | undefined;
  if (frozen(db)) alerts.push({ code: "emergency_stop", severity: "critical", since: freeze?.ts ?? null, words: "The CFO pulled the emergency stop: no agent pays until it is lifted with Face ID." });

  const stopped = db.prepare("SELECT key, updated_at FROM settings WHERE key LIKE 'stop.%' AND value = 'on' ORDER BY key").all() as { key: string; updated_at: string }[];
  for (const s of stopped) alerts.push({ code: "velocity_stop", severity: "warning", since: s.updated_at, words: `The ${s.key.slice(5)} agent hit a speed limit and was stopped; the CFO lifts it with Face ID.` });

  const rec = lastReconciliation(db);
  if (rec && rec.differences > 0) alerts.push({ code: "reconciliation_difference", severity: "critical", since: rec.at, words: `The last reconciliation found ${rec.differences} difference(s) between the ledger and the outside services.` });
  if (rec && now.getTime() - Date.parse(rec.at) > RECONCILE_STALE_AFTER_MS) alerts.push({ code: "reconciliation_stale", severity: "warning", since: rec.at, words: "The reconciliation has not run for over three hours." });

  const stuck = db.prepare("SELECT p.proposal_id, MAX(a.ts) AS since FROM proposals p JOIN audit_log a ON a.subject = p.proposal_id AND a.event IN ('proposal.executing', 'proposal.resumed') WHERE p.status = 'EXECUTING' GROUP BY p.proposal_id").all() as { proposal_id: string; since: string }[];
  for (const s of stuck.filter((x) => now.getTime() - Date.parse(x.since) > STUCK_AFTER_MS)) {
    alerts.push({ code: "action_stuck", severity: "warning", since: s.since, words: `${s.proposal_id} has been executing since ${s.since}; a restart resumes it from its last finished step.` });
  }

  const holdsOpen = has(db, "holds") ? (db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cents), 0) AS cents, MIN(created_at) AS oldest FROM holds WHERE status = 'HELD'").get() as { n: number; cents: number; oldest: string | null }) : { n: 0, cents: 0, oldest: null };
  if (holdsOpen.oldest && now.getTime() - Date.parse(holdsOpen.oldest) > HOLD_STALE_AFTER_MS) {
    alerts.push({ code: "hold_stale", severity: "warning", since: holdsOpen.oldest, words: `${holdsOpen.n} spend hold(s) open, the oldest since ${holdsOpen.oldest}; they keep counting until resolved.` });
  }

  const metrics: Record<string, number> = {
    approvals_waiting: n(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'PENDING_APPROVAL' AND expires_at > ?", now.toISOString()),
    actions_executing: n(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'EXECUTING'"),
    holds_open: holdsOpen.n,
    holds_open_cents: holdsOpen.cents,
    agents_stopped: stopped.length,
    emergency_stop: frozen(db) ? 1 : 0,
    reconcile_differences: rec?.differences ?? 0,
    reconcile_age_seconds: rec ? Math.round((now.getTime() - Date.parse(rec.at)) / 1000) : -1,
    principals_revoked: has(db, "principals") ? n(db, "SELECT COUNT(*) AS n FROM principals WHERE status = 'REVOKED'") : 0,
    policy_version: has(db, "policy_versions") ? n(db, "SELECT MAX(version) AS n FROM policy_versions") : 0,
    audit_rows: n(db, "SELECT COUNT(*) AS n FROM audit_log"),
    alerts: alerts.length,
  };
  return { status: alerts.length ? "alert" : "ok", at: now.toISOString(), alerts, metrics };
}

/** The same numbers in the Prometheus text format, for a scraper. */
export function prometheus(h: Health, extra: Record<string, number> = {}): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries({ ...h.metrics, ...extra })) {
    lines.push(`# TYPE purser_${k} gauge`, `purser_${k} ${v}`);
  }
  for (const a of h.alerts) lines.push(`purser_alert{code="${a.code}",severity="${a.severity}"} 1`);
  return `${lines.join("\n")}\n`;
}
