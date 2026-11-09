// A counter of refused passkey submissions, kept apart from the audit log. Anyone can post to the relay, so an
// unverified submission never writes its text into the hash-chained log; but a burst of failures must still reach an
// operator. So each refusal adds one to (hour, code): a fixed reason code from this list and a number, never anything
// the sender sent. health() turns the last hour into a metric and an alert on a spike.

import type { DB } from "../db/open.js";

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
