// Basic monitoring (backend review B7): what an operator needs to be woken for, from the ledger alone. The runner
// computes it and sends it with every snapshot; the relay's /health answers 503 while any alarm stands or when the
// runner has not synced for two minutes (it cannot report its own outage), so an uptime monitor pointed at it pages a
// person. Locally the dashboard server serves the same as /health and as Prometheus metrics on /metrics.

import type { DB } from "../db/open.js";
import { heldRefunds, heldThenRefused, lastReconciliation } from "../finance/reconcile.js";
import { frozen } from "../policy/rules.js";
import { pausesNotRevoked } from "../policy/pause.js";
import { HANDOVER_AFTER, legacyUnfinished, openDecisions } from "../agents/disputeDecision.js";
import { codeMayCarryOut, escalatedUndecided } from "../agents/disputeSource.js";
import { failureAlerts, failureCounts } from "../passkey/failures.js";
import { unsealedPasskeys } from "../passkey/seal.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { BLOCKED_ALERT, blockedApprovals } from "../policy/blocked.js";
import { checkpointAlerts } from "../audit/checkpointer.js";

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

/** The Sourcing agent's own "none" buy policy, when it stands, with code's reason from when it was set; else null. */
function notBuyingSince(db: DB): { since: string; why: string } | null {
  if (!has(db, "settings") || !has(db, "audit_log")) return null;
  const s = db.prepare("SELECT value, updated_at FROM settings WHERE key = 'sourcing.buy_policy'").get() as { value: string; updated_at: string } | undefined;
  let p: { supplier?: string; set_by?: string } = {};
  try { p = s ? JSON.parse(s.value) as typeof p : {}; } catch { return null; }
  if (!s || p.supplier !== "none" || p.set_by !== "sourcing") return null;
  const e = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'sourcing.stopped_buying' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
  const why = e ? String((JSON.parse(e.payload_json) as { why?: unknown }).why ?? "") : "";
  return { since: s.updated_at, why: why || "code recorded no reason" };
}

export function health(db: DB, now = new Date()): Health {
  const alerts: Alert[] = [];

  const freeze = db.prepare("SELECT ts FROM audit_log WHERE event = 'policy.changed' AND subject = 'freeze' ORDER BY seq DESC LIMIT 1").get() as { ts: string } | undefined;
  // 4.2 A paused agent whose mandate is still bound on chain (a failed or interrupted revoke): Purser refuses it, but
  // the chain would not; npm run pause -- sync (also run at the runner's start) finishes it.
  for (const a of pausesNotRevoked(db)) alerts.push({ code: "pause_not_revoked", severity: "critical", since: null, words: `The ${a} agent is paused, but its Metal mandate is not revoked on chain yet; run npm run pause -- sync.` });
  if (frozen(db)) alerts.push({ code: "emergency_stop", severity: "critical", since: freeze?.ts ?? null, words: "The CFO pulled the emergency stop: no agent pays until it is lifted with Face ID." });

  // A dispute decision not fully carried out (a restart cut it off, or a refund was refused at payment): the runner's
  // start finishes it (npm run s2 -- --resume-only); it is never decided again. Not one whose dispute is with the CFO
  // (dispute.escalated) with a refund or a proposal left: the runner's start leaves that to a person, who carries it out
  // with npm run s2 -- --dispute <id> (the dispute review 2, LOW 4: codeMayCarryOut).
  // Critical once a refund could not be paid (it goes to the CFO as a proposal) or carrying out failed more than once.
  for (const d of openDecisions(db)) {
    const next = !codeMayCarryOut(db, d) ? `it is with the CFO: npm run s2 -- --dispute ${d.dispute_id} carries it out, without deciding again` : "the runner's start or npm run s2 -- --resume-only finishes it, without deciding again";
    alerts.push({ code: "dispute_decision_open", severity: d.handover.length || d.attempts >= HANDOVER_AFTER - 1 ? "critical" : "warning", since: d.decided_at, words: `Dispute ${d.dispute_id} was decided at ${d.decided_at} but is not fully carried out${d.last_note ? ` (${d.last_note})` : ""}; ${next}.` });
  }
  // A refund sent but held at Metal for over two hours is not refunded yet; one held and then refused was never refunded.
  for (const h of heldRefunds(db, now)) alerts.push({ code: "refund_held", severity: "warning", since: h.since, words: `Refund ${h.payment_id} (sale ${h.sale_id}) was sent but is held at Metal${h.since ? ` since ${h.since}` : ""}: not refunded yet. The hourly reconciliation looks it up on chain.` });
  for (const r of heldThenRefused(db)) alerts.push({ code: "refund_held_then_refused", severity: "critical", since: null, words: `Refund ${r.payment_id} (sale ${r.sale_id}) was held at Metal and then refused${r.reason ? ` (${r.reason})` : ""}: nothing was refunded for it.` });
  // A customer dispute that came in and that code could not settle (holdout H9): with the CFO until it is decided.
  if (has(db, "audit_log")) for (const e of escalatedUndecided(db)) alerts.push({ code: "dispute_with_cfo", severity: "warning", since: e.at, words: `Dispute ${e.id} came in and code could not settle it (${e.reason}); it waits for a person: ${/^D-ev\d+$/.test(e.id) ? "settle it yourself (it has no email code can read)" : `npm run s2 -- --dispute ${e.id}, or a refund proposal with Face ID`}; once handled, npm run s2 -- --resolve ${e.id} --note "how it was settled" clears this.` });
  // A dispute settled before decisions were recorded, with refunds left unfinished: it is never decided again, so a person looks.
  for (const l of legacyUnfinished(db)) alerts.push({ code: "dispute_legacy_unfinished", severity: "warning", since: null, words: `Dispute ${l.dispute_id} was settled before decisions were recorded and has unfinished refunds (${l.refunds.join(", ")}); it is not decided again: check it and propose what is left for Face ID.` });

  const stopped = db.prepare("SELECT key, updated_at FROM settings WHERE key LIKE 'stop.%' AND value = 'on' ORDER BY key").all() as { key: string; updated_at: string }[];
  for (const s of stopped) alerts.push({ code: "velocity_stop", severity: "warning", since: s.updated_at, words: `The ${s.key.slice(5)} agent hit a speed limit and was stopped; the CFO lifts it with Face ID.` });
  // The long run of 20 November: the Sourcing agent stopped buying and customers were turned away with nobody told. It
  // may set "none" only when no supplier its mandate pays can serve (src/autonomy/sourcingCore.ts checkBuyPolicy); while
  // that policy stands it is before the CFO here, with code's reason.
  const notBuying = notBuyingSince(db);
  if (notBuying) alerts.push({ code: "sourcing_not_buying", severity: "warning", since: notBuying.since, words: `The Sourcing agent stopped buying stock checks: no supplier its mandate pays could serve (${notBuying.why}). Customers are turned away, and not charged, until it buys again. A supplier only over the cap needs a higher cap (the Treasury agent proposes one for your Face ID); a new supplier needs a new mandate.` });

  const rec = lastReconciliation(db);
  if (rec && rec.differences > 0) alerts.push({ code: "reconciliation_difference", severity: "critical", since: rec.at, words: `The last reconciliation found ${rec.differences} difference(s) between the ledger and the outside services.` });
  if (rec && now.getTime() - Date.parse(rec.at) > RECONCILE_STALE_AFTER_MS) alerts.push({ code: "reconciliation_stale", severity: "warning", since: rec.at, words: "The reconciliation has not run for over three hours." });

  const stuck = db.prepare("SELECT p.proposal_id, MAX(a.ts) AS since FROM proposals p JOIN audit_log a ON a.subject = p.proposal_id AND a.event IN ('proposal.executing', 'proposal.resumed') WHERE p.status = 'EXECUTING' GROUP BY p.proposal_id").all() as { proposal_id: string; since: string }[];
  for (const s of stuck.filter((x) => now.getTime() - Date.parse(x.since) > STUCK_AFTER_MS)) {
    alerts.push({ code: "action_stuck", severity: "warning", since: s.since, words: `${s.proposal_id} has been executing since ${s.since}; a restart resumes it from its last finished step.` });
  }
  // Chaos for money movement (19 Nov, H11): an approved payment whose stored terms no longer hash to what the passkey
  // signed is refused by its executor at every start, so nothing is paid; this tells a person at once, instead of it
  // waiting silently, APPROVED, until it expires.
  const tampered = tamperedApprovals(db);
  for (const t of tampered) {
    alerts.push({ code: "approved_terms_changed", severity: "critical", since: t.since, words: `${t.proposal_id} was approved with a passkey, but its stored terms no longer match the signed hash: it will not be paid. Check who changed them; a new proposal needs a new approval.` });
  }
  // Outside audit 2.1 (chaos H17, 49 scenarios): an approved payment its executor refused before it began (the EUR
  // floor, a hold, a changed payee) is recorded (execution.blocked) and stands here until it expires or a person closes
  // it; a restart does not try it again. One with changed terms is already above, critical, and not repeated.
  for (const b of blockedApprovals(db, now).filter((x) => !tampered.some((t) => t.proposal_id === x.proposal_id))) {
    alerts.push({ code: BLOCKED_ALERT, severity: b.severity, since: b.since, words: `${b.proposal_id} was approved, but its execution was refused at ${b.last} (${b.check}): ${b.reason}. Nothing was paid and it is not tried again by itself; it stays blocked until ${b.expires_at}, or close it (npm run approve -- ${b.proposal_id} <hash prefix> --reject). Paying it on other terms needs a new proposal and a new approval.` });
  }
  // dry-179 review: a mandate replace that failed after a step of it ran leaves the mandates half replaced. Its guard
  // never closes it (src/executors/mandateReplace.ts) and the spending hold lifts at its expiry, so a person looks.
  const halfRun = db.prepare(`SELECT p.proposal_id, (SELECT MAX(a.ts) FROM audit_log a WHERE a.subject = p.proposal_id AND a.event = 'proposal.failed') AS since,
      (SELECT COUNT(*) FROM executions e WHERE e.proposal_id = p.proposal_id AND e.status = 'DONE') AS done
    FROM proposals p WHERE p.kind = 'mandate_replace' AND p.status = 'FAILED'
      AND EXISTS (SELECT 1 FROM executions e WHERE e.proposal_id = p.proposal_id AND e.status = 'DONE') ORDER BY p.proposal_id`).all() as { proposal_id: string; since: string | null; done: number }[];
  for (const r of halfRun) {
    alerts.push({ code: "replace_half_run", severity: "warning", since: r.since, words: `Mandate replace ${r.proposal_id} failed after ${r.done} of its steps ran on chain: the agents' mandates are half replaced. A retry carries on if its checks still hold; otherwise a person decides what is left.` });
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

  // Outside audit 1.4: with a checkpoint key configured, the audit log against its latest signed checkpoint
  // (src/audit/checkpointer.ts), and any sensitive operation refused for it in the last day.
  if (has(db, "audit_log")) alerts.push(...checkpointAlerts(db, now));

  // Refused passkey submissions (src/passkey/failures.ts): counted, never logged; a burst in the last hour is someone
  // trying signatures or codes, so a person looks.
  const pkFail = has(db, "passkey_failures") ? failureCounts(db, now) : { lastHour: 0, last24h: 0, byCode: {} };
  if (has(db, "passkey_failures")) alerts.push(...failureAlerts(db, now));
  // A passkey row the enrolment ceremony did not seal (outside audit, finding 1.3): it approves nothing, and someone
  // wrote it into the ledger, or it predates the seal (npm run passkey -- seal, after comparing its fingerprint).
  const unsealed = has(db, "passkeys") ? unsealedPasskeys(db) : [];
  if (unsealed.length) alerts.push({ code: "passkey_unsealed", severity: "critical", since: null, words: `${unsealed.length} active passkey(s) (${unsealed.map((k) => `${k.label}, ${k.credential_id.slice(0, 8)}`).join("; ")}) carry no enrolment seal from this runner, so they approve nothing. If one was enrolled before the seal existed, compare its fingerprint with the phone and run npm run passkey -- seal; otherwise someone wrote it into the ledger: pull the emergency stop and run npm run verify.` });

  const metrics: Record<string, number> = {
    approvals_waiting: n(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'PENDING_APPROVAL' AND expires_at > ?", now.toISOString()),
    actions_executing: n(db, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'EXECUTING'"),
    approvals_blocked: blockedApprovals(db, now).length,
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
    passkey_failures_1h: pkFail.lastHour,
    passkey_failures_24h: pkFail.last24h,
    ...Object.fromEntries(Object.entries(pkFail.byCode).map(([c, k]) => [`passkey_failures_24h_${c}`, k])),
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

/** Approved proposals whose stored terms no longer hash to the signed hash (nothing is paid for them; a person looks). */
function tamperedApprovals(db: DB): { proposal_id: string; since: string | null }[] {
  if (!has(db, "approvals")) return [];
  const rows = db.prepare("SELECT p.proposal_id, p.terms_json, p.terms_sha256, a.approved_sha256, a.created_at AS since FROM proposals p JOIN approvals a ON a.proposal_id = p.proposal_id WHERE p.status = 'APPROVED' AND a.decision = 'APPROVED'").all() as { proposal_id: string; terms_json: string; terms_sha256: string; approved_sha256: string; since: string | null }[];
  return rows.filter((r) => {
    let h: string | null;
    try { h = termsHash(JSON.parse(r.terms_json) as Terms); } catch { h = null; }
    return h === null || h !== r.terms_sha256 || h !== r.approved_sha256;
  }).map(({ proposal_id, since }) => ({ proposal_id, since }));
}
