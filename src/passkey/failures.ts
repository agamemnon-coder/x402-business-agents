// A counter of refused passkey submissions, kept apart from the audit log. Anyone can post to the relay, so an
// unverified submission never writes its text into the hash-chained log; but a burst of failures must still reach an
// operator. So each refusal adds one to (hour, code): a fixed reason code from this list and a number, never anything
// the sender sent. health() turns the last hour into a metric and an alert on a spike.

import type { DB } from "../db/open.js";
import type { Alert } from "../ops/publicHealth.js";

export const FAILURE_CODES = [
  // approvals, rejections and phone policy changes
  "malformed", "unknown_proposal", "not_pending", "terms_tampered", "other_option_approved", "unknown_passkey",
  "revoked_passkey", "bad_signature", "verify_error", "owner_signing_off", "wrong_account", "not_owner", "store_error",
  "terms_hash_mismatch", "policy_invalid", "policy_exists", "policy_loosens",
  // enrolment
  "no_enrol_window", "wrong_enrol_code", "enrol_verify_failed", "enrol_credential_mismatch", "enrol_store_error",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

/** This many refusals in an hour raise the passkey_failures_spike alert. */
export const PASSKEY_FAILURE_SPIKE = 10;
/** Hours older than this are dropped on the next write. */
const KEEP_MS = 30 * 86_400_000;

const hourOf = (d: Date) => `${d.toISOString().slice(0, 13)}:00:00Z`;

export function countFailure(db: DB, code: FailureCode, now = new Date()): void {
  db.prepare("INSERT INTO passkey_failures (hour, code, n) VALUES (?, ?, 1) ON CONFLICT (hour, code) DO UPDATE SET n = n + 1").run(hourOf(now), code);
  db.prepare("DELETE FROM passkey_failures WHERE hour < ?").run(hourOf(new Date(now.getTime() - KEEP_MS)));
}

/** Refusals in the current and previous hour bucket (so a burst straddling the hour still counts), and per code over 24 hours. */
export function failureCounts(db: DB, now = new Date()): { lastHour: number; last24h: number; byCode: Partial<Record<FailureCode, number>> } {
  const sum = (since: Date) => (db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM passkey_failures WHERE hour >= ? AND hour <= ?").get(hourOf(since), hourOf(now)) as { n: number }).n;
  const rows = db.prepare("SELECT code, SUM(n) AS n FROM passkey_failures WHERE hour >= ? AND hour <= ? GROUP BY code ORDER BY code")
    .all(hourOf(new Date(now.getTime() - 23 * 3_600_000)), hourOf(now)) as { code: FailureCode; n: number }[];
  return {
    lastHour: sum(new Date(now.getTime() - 3_600_000)),
    last24h: sum(new Date(now.getTime() - 23 * 3_600_000)),
    byCode: Object.fromEntries(rows.map((r) => [r.code, r.n])),
  };
}

/** Refusals that are normal use (a double tap, an option already decided, a looser change asked on the phone): counted, never alerted on. */
export const BENIGN_FAILURES = ["not_pending", "other_option_approved", "owner_signing_off", "policy_exists", "policy_invalid", "policy_loosens"] as const satisfies readonly FailureCode[];
const ENROL: readonly FailureCode[] = ["wrong_enrol_code", "enrol_verify_failed", "enrol_credential_mismatch"];
const ERRORS: readonly FailureCode[] = ["verify_error", "store_error", "enrol_store_error"];
/** Enrolment failures in an hour that raise passkey_enrol_attempts, and signature errors that raise passkey_errors. */
export const PASSKEY_ENROL_ALERT = 3;
export const PASSKEY_ERRORS_ALERT = 3;
/** Enrolment failures in a day (passkey_enrol_attempts_day) and signature-type failures in 7 days (passkey_failures_week). */
export const PASSKEY_ENROL_DAY_ALERT = 5;
export const PASSKEY_WEEK_ALERT = 20;
/** A type alerts above its baseline when its last day is at least this many and this many times its usual day. */
export const BASELINE_MIN = 5;
export const BASELINE_FACTOR = 3;
/** The refusals that point at someone trying signatures or passkeys: the weekly window and the baseline watch these. */
const ATTACK: readonly FailureCode[] = ["malformed", "unknown_proposal", "unknown_passkey", "revoked_passkey", "bad_signature", "terms_hash_mismatch", "wrong_account", "not_owner"];

/** Each attack-type code whose last day is far above its average day over the 29 days before (counts are kept 30 days). */
function aboveBaseline(db: DB, now: Date): { code: FailureCode; day: number; usual: number }[] {
  const dayStart = new Date(now.getTime() - 23 * 3_600_000);
  const histStart = new Date(dayStart.getTime() - 29 * 24 * 3_600_000);
  const out: { code: FailureCode; day: number; usual: number }[] = [];
  for (const code of ATTACK) {
    const day = sumSince(db, [code], dayStart, now);
    if (day < BASELINE_MIN) continue;
    const before = sumSince(db, [code], histStart, new Date(dayStart.getTime() - 3_600_000));
    const usual = before / 29;
    if (day >= BASELINE_FACTOR * usual) out.push({ code, day, usual });
  }
  return out;
}

function sumSince(db: DB, codes: readonly FailureCode[] | null, since: Date, now: Date): number {
  const rows = db.prepare("SELECT code, n FROM passkey_failures WHERE hour >= ? AND hour <= ?").all(hourOf(since), hourOf(now)) as { code: FailureCode; n: number }[];
  return rows.filter((r) => (codes ? codes.includes(r.code) : !(BENIGN_FAILURES as readonly FailureCode[]).includes(r.code))).reduce((t, r) => t + r.n, 0);
}

/**
 * The alerts per type of refusal: the types do not weigh the same. Stored terms that no longer match their hash are
 * critical on the first one (the ledger itself changed) and stand for a day; a few enrolment failures or signature errors
 * in an hour are someone trying codes or something broken; everything else counts toward one spike, benign refusals not.
 */
export function failureAlerts(db: DB, now = new Date()): Alert[] {
  const alerts: Alert[] = [];
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const tampered = sumSince(db, ["terms_tampered"], new Date(now.getTime() - 23 * 3_600_000), now);
  if (tampered > 0) alerts.push({ code: "passkey_terms_tampered", severity: "critical", since: null, words: `${tampered} approval(s) in the last day were refused because a proposal's stored terms no longer match their hash: the ledger was changed outside Purser. Pull the emergency stop and run npm run verify.` });
  const enrol = sumSince(db, ENROL, hourAgo, now);
  if (enrol >= PASSKEY_ENROL_ALERT) alerts.push({ code: "passkey_enrol_attempts", severity: "warning", since: null, words: `${enrol} passkey enrolments failed in the last hour (wrong code or a passkey that did not verify); if no one is enrolling, close the enrolment window and issue a new code.` });
  const errors = sumSince(db, ERRORS, hourAgo, now);
  if (errors >= PASSKEY_ERRORS_ALERT) alerts.push({ code: "passkey_errors", severity: "warning", since: null, words: `${errors} passkey signatures could not be verified or stored in the last hour; check the runner's log and the passkeys table.` });
  // Longer windows (slow, low-volume attacks stay under every hourly rule). Counts are kept 30 days.
  const dayAgo = new Date(now.getTime() - 23 * 3_600_000);
  const closed = sumSince(db, ["no_enrol_window"], dayAgo, now);
  if (closed > 0) alerts.push({ code: "passkey_enrol_closed", severity: "warning", since: null, words: `${closed} enrolment submission(s) in the last day while no enrolment window was open: no one should be enrolling, so someone is trying.` });
  const enrolDay = sumSince(db, ENROL, dayAgo, now);
  if (enrolDay >= PASSKEY_ENROL_DAY_ALERT && enrol < PASSKEY_ENROL_ALERT) alerts.push({ code: "passkey_enrol_attempts_day", severity: "warning", since: null, words: `${enrolDay} passkey enrolments failed in the last day, spread out under the hourly rule; if no one is enrolling, close the window and issue a new code in person.` });
  const week = sumSince(db, ATTACK, new Date(now.getTime() - (7 * 24 - 1) * 3_600_000), now);
  if (week >= PASSKEY_WEEK_ALERT) alerts.push({ code: "passkey_failures_week", severity: "warning", since: null, words: `${week} bad signatures or unknown passkeys in the last 7 days; check the codes in /metrics: a slow, steady stream is someone trying.` });
  const above = aboveBaseline(db, now);
  if (above.length) alerts.push({ code: "passkey_failures_above_baseline", severity: "warning", since: null, words: `Well above their own 30-day normal in the last day: ${above.map((a) => `${a.code} ${a.day} (usual ${a.usual.toFixed(1)} a day)`).join(", ")}.` });
  const spike = sumSince(db, null, hourAgo, now);
  if (spike >= PASSKEY_FAILURE_SPIKE) {
    const top = Object.entries(failureCounts(db, now).byCode).filter(([c]) => !(BENIGN_FAILURES as readonly string[]).includes(c)).sort(([, a], [, b]) => b - a).slice(0, 3).map(([c, k]) => `${c} ${k}`).join(", ");
    alerts.push({ code: "passkey_failures_spike", severity: "warning", since: null, words: `${spike} passkey submissions were refused in the last hour (most: ${top}); someone may be trying signatures or enrolment codes. Nothing was approved by them.` });
  }
  return alerts;
}
