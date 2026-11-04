// Basic monitoring (backend review B7): what an operator needs to be woken for, from the ledger alone. The runner
// computes it and sends it with every snapshot; the relay's /health answers 503 while any alarm stands or when the
// runner has not synced for two minutes (it cannot report its own outage), so an uptime monitor pointed at it pages a
// person. Locally the dashboard server serves the same as /health and as Prometheus metrics on /metrics.

import type { DB } from "../db/open.js";
import { heldRefunds, heldThenRefused, lastReconciliation } from "../finance/reconcile.js";
import { frozen } from "../policy/rules.js";
import { pausesNotRevoked } from "../policy/pause.js";
import { HANDOVER_AFTER, legacyUnfinished, openDecisions } from "../agents/disputeDecision.js";
import { escalatedUndecided } from "../agents/disputeSource.js";

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
  // 4.2 A paused agent whose mandate is still bound on chain (a failed or interrupted revoke): Purser refuses it, but
  // the chain would not; npm run pause -- sync (also run at the runner's start) finishes it.
  for (const a of pausesNotRevoked(db)) alerts.push({ code: "pause_not_revoked", severity: "critical", since: null, words: `The ${a} agent is paused, but its Metal mandate is not revoked on chain yet; run npm run pause -- sync.` });
  if (frozen(db)) alerts.push({ code: "emergency_stop", severity: "critical", since: freeze?.ts ?? null, words: "The CFO pulled the emergency stop: no agent pays until it is lifted with Face ID." });

  // A dispute decision not fully carried out (a restart cut it off, or a refund was refused at payment): the runner's
  // start finishes it (npm run s2 -- --resume-only); it is never decided again.
  // Critical once a refund could not be paid (it goes to the CFO as a proposal) or carrying out failed more than once.
  for (const d of openDecisions(db)) alerts.push({ code: "dispute_decision_open", severity: d.handover.length || d.attempts >= HANDOVER_AFTER - 1 ? "critical" : "warning", since: d.decided_at, words: `Dispute ${d.dispute_id} was decided at ${d.decided_at} but is not fully carried out${d.last_note ? ` (${d.last_note})` : ""}; the runner's start or npm run s2 -- --resume-only finishes it, without deciding again.` });
  // A refund sent but held at Metal for over two hours is not refunded yet; one held and then refused was never refunded.
  for (const h of heldRefunds(db, now)) alerts.push({ code: "refund_held", severity: "warning", since: h.since, words: `Refund ${h.payment_id} (sale ${h.sale_id}) was sent but is held at Metal${h.since ? ` since ${h.since}` : ""}: not refunded yet. The hourly reconciliation looks it up on chain.` });
  for (const r of heldThenRefused(db)) alerts.push({ code: "refund_held_then_refused", severity: "critical", since: null, words: `Refund ${r.payment_id} (sale ${r.sale_id}) was held at Metal and then refused${r.reason ? ` (${r.reason})` : ""}: nothing was refunded for it.` });
  // A customer dispute that came in and that code could not settle (holdout H9): with the CFO until it is decided.
  if (has(db, "audit_log")) for (const e of escalatedUndecided(db)) alerts.push({ code: "dispute_with_cfo", severity: "warning", since: e.at, words: `Dispute ${e.id} came in and code could not settle it (${e.reason}); it waits for a person: npm run s2 -- --dispute ${e.id}, or a refund proposal with Face ID.` });
  // A dispute settled before decisions were recorded, with refunds left unfinished: it is never decided again, so a person looks.
  for (const l of legacyUnfinished(db)) alerts.push({ code: "dispute_legacy_unfinished", severity: "warning", since: null, words: `Dispute ${l.dispute_id} was settled before decisions were recorded and has unfinished refunds (${l.refunds.join(", ")}); it is not decided again: check it and propose what is left for Face ID.` });

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

  // An Airwallex webhook the ledger cannot explain (a payout or conversion Purser did not make, a card live while the
  // policy has it frozen) stands for a day: a person looks at it in Airwallex and the hourly reconciliation.
  const DAY = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const odd = has(db, "airwallex_events") ? (db.prepare("SELECT COUNT(*) AS n, MIN(received_at) AS since FROM airwallex_events WHERE agrees = 0 AND received_at > ?").get(DAY) as { n: number; since: string | null }) : { n: 0, since: null };
  if (odd.n > 0) alerts.push({ code: "airwallex_disagrees", severity: "critical", since: odd.since, words: `${odd.n} Airwallex webhook(s) in the last day report something the ledger cannot explain; check them on the dashboard.` });

  const metrics: Record<string, number> = {
    approvals_waiting: n(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'PENDING_APPROVAL' AND expires_at > ?", now.toISOString()),
    actions_executing: n(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'EXECUTING'"),
    holds_open: holdsOpen.n,
    holds_open_cents: holdsOpen.cents,
    agents_stopped: stopped.length,
    emergency_stop: frozen(db) ? 1 : 0,
    reconcile_differences: rec?.differences ?? 0,
    airwallex_disagreements_24h: odd.n,
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
