// Approved, then blocked at execution (outside audit 2.1, 20 November). The chaos run for money movement found approved
// payments refused by their executor before anything was sent (the EUR floor, mostly) that stayed APPROVED with no
// alarm until they expired: nothing wrong was paid, but nobody was told. Now such a refusal is recorded at once
// (execution.blocked, with the reason and the time), the proposal shows as BLOCKED_NEEDS_REVIEW wherever its status
// is shown, /health raises approved_blocked, and a restart does not try it again by itself. It stays blocked until it
// expires or a person closes it; a payment on other terms is a new proposal with a new approval (the old signature
// never runs other terms: the hash checks in beginExecution and hashFirst are unchanged).
//
// The status is derived, not stored: the proposal is still APPROVED in the state machine (src/policy/approvals.ts),
// so every other rule about APPROVED holds as before.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";

/** The audit row of an approved proposal refused by its executor before it began. */
export const BLOCKED_EVENT = "execution.blocked";
/** The status shown for it: approved, blocked at execution, waiting for a person. */
export const BLOCKED_STATUS = "BLOCKED_NEEDS_REVIEW";
/** The /health alarm. */
export const BLOCKED_ALERT = "approved_blocked";

/** Which check refused it, from the refusal's words (for the alarm, the dashboard and the chaos report). */
export function blockedCheck(reason: string): string {
  const rules: [RegExp, string][] = [
    [/terms do not match the approved hash/, "terms_changed"],
    [/execution_refused_unsigned/, "unsigned"],
    [/ledger_tampered/, "ledger_tampered"],
    [/EUR would now drop under its floor/, "eur_floor"],
    [/USD would now drop under its floor/, "usd_floor"],
    [/emergency stop|stopped automatically|is paused|blocked by the CFO policy/, "policy_hold"],
    [/no longer the active account/, "payee_changed"],
    [/already paid|already has a payout/, "already_paid"],
    [/quote/, "quote"],
  ];
  return rules.find(([re]) => re.test(reason))?.[1] ?? "other";
}

/** Terms changed or an approval with no signature behind it: a possible tamper, critical. The rest: a warning. */
const CRITICAL = new Set(["terms_changed", "unsigned", "ledger_tampered"]);

/**
 * Records that the executor refused `proposalId` before it began, while it is APPROVED (not a failed run's retry, not a
 * restart's resume). Committed on its own, so it survives the error the caller throws. A refusal for the same reason
 * as the last one recorded is not written again. Never throws: recording must not hide the refusal itself.
 */
export function recordBlocked(db: DB, proposalId: string, reason: string, now = new Date()): void {
  try {
    db.transaction(() => {
      const p = db.prepare("SELECT status, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string; terms_sha256: string } | undefined;
      if (p?.status !== "APPROVED") return;
      const last = lastBlock(db, proposalId);
      if (last?.reason === reason.slice(0, 400)) return;
      audit(db, "system", BLOCKED_EVENT, proposalId, { reason: reason.slice(0, 400), check: blockedCheck(reason), terms_sha256: p.terms_sha256, status: "APPROVED", next: "nothing was paid; it is not tried again by itself; it stays blocked until it expires or a person closes it" }, now);
    }).immediate();
  } catch {
    // The refusal stands whatever happens here; a ledger that cannot be written is its own alarm.
  }
}

function lastBlock(db: DB, proposalId: string): { ts: string; reason: string; check: string } | null {
  const rows = db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(BLOCKED_EVENT, proposalId) as { ts: string; payload_json: string }[];
  const r = rows.at(-1);
  if (!r) return null;
  const p = JSON.parse(r.payload_json) as { reason?: unknown; check?: unknown };
  return { ts: r.ts, reason: String(p.reason ?? ""), check: String(p.check ?? "other") };
}

export interface Blocked {
  proposal_id: string;
  kind: string;
  /** The latest refusal, in the executor's words, and which check made it. */
  reason: string;
  check: string;
  severity: "critical" | "warning";
  /** When it was first refused, and last. */
  since: string;
  last: string;
  expires_at: string;
}

/**
 * Approved proposals blocked at execution and not resolved: still APPROVED, not past their expiry, with an
 * execution.blocked row. One that expires, is closed, or runs after all leaves this list (and the alarm clears).
 */
export function blockedApprovals(db: DB, now = new Date()): Blocked[] {
  const has = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'").get();
  if (!has) return [];
  const rows = db.prepare(`SELECT p.proposal_id, p.kind, p.terms_json, p.expires_at FROM proposals p WHERE p.status = 'APPROVED'
      AND EXISTS (SELECT 1 FROM audit_log a WHERE a.event = ? AND a.subject = p.proposal_id) ORDER BY p.proposal_id`).all(BLOCKED_EVENT) as { proposal_id: string; kind: string; terms_json: string; expires_at: string }[];
  const out: Blocked[] = [];
  for (const r of rows) {
    const expires = earlier(r.expires_at, r.terms_json);
    if (Date.parse(expires) <= now.getTime()) continue;
    const first = db.prepare("SELECT MIN(ts) AS ts FROM audit_log WHERE event = ? AND subject = ?").get(BLOCKED_EVENT, r.proposal_id) as { ts: string };
    const last = lastBlock(db, r.proposal_id)!;
    out.push({ proposal_id: r.proposal_id, kind: r.kind, reason: last.reason, check: last.check, severity: CRITICAL.has(last.check) ? "critical" : "warning", since: first.ts, last: last.ts, expires_at: expires });
  }
  return out;
}

/** The expiry that counts: the one inside the signed terms when it is earlier than the column's (as beginExecution reads it). */
function earlier(column: string, termsJson: string): string {
  let inTerms: unknown;
  try { inTerms = (JSON.parse(termsJson) as { expires_at?: unknown }).expires_at; } catch { return column; }
  return typeof inTerms === "string" && Date.parse(inTerms) < Date.parse(column) ? inTerms : column;
}

/** Whether `proposalId` is approved and blocked at execution now. */
export function isBlocked(db: DB, proposalId: string, now = new Date()): boolean {
  return blockedApprovals(db, now).some((b) => b.proposal_id === proposalId);
}

/** The status to show for a proposal: BLOCKED_NEEDS_REVIEW for an approved one blocked at execution, else its own. */
export function shownStatus(db: DB, p: { proposal_id: string; status: string }, now = new Date()): string {
  return p.status === "APPROVED" && isBlocked(db, p.proposal_id, now) ? BLOCKED_STATUS : p.status;
}
