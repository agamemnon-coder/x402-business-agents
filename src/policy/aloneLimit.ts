// Where the limit to pay alone comes from (security review, 20 November, finding 7). Until now the seed of a /try test
// company wrote ap.alone_eur as a plain setting (src/engine/host.ts seed, TRY_ALONE_LIMIT): the CFO never signed it, and
// any setting written into the ledger counted. Now a limit counts only when the last record of it is one of:
//   - policy.changed  from a policy_change proposal (src/executors/policyChange.ts) that sets ap.alone_eur to exactly
//                     this amount, ran (EXECUTED), and was approved with a passkey: the CFO signed it; or
//   - policy.system_default  a /try test company's default, written by its seed and labelled as such: not signed by the
//                     CFO, and every record and `npm run verify` say so.
// Anything else (a setting written by hand, an unlabelled write, a removal) means no limit, and the CFO signs every
// invoice. Whether the signed change's signature itself still verifies is the execution guard's to check
// (src/policy/signedApproval.ts), before money moves; here only the record is read, cheaply, for the checks that ask.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { plainCents } from "./withinLimit.js";

export const ALONE_KEY = "ap.alone_eur";
/** The audit event of a test company's default limit: not signed by the CFO. */
export const SYSTEM_DEFAULT = "policy.system_default";
/** How the record and verify name such a limit. */
export const SYSTEM_DEFAULT_LABEL = "system default of a /try test company (TRY_ALONE_LIMIT), not signed by the CFO";

export type AloneSource = { kind: "signed"; proposal_id: string } | { kind: "system_default"; label: string };
export interface AloneRecord { currency: "EUR"; amount: string; source: AloneSource; seq: number }

const valid = (v: unknown): v is string => typeof v === "string" && (plainCents(v) ?? 0) > 0;

/**
 * The limit to pay alone the record puts in force just before audit row `beforeSeq` (now, when omitted), with where it
 * comes from; null when none is in force. Reads the ledger only.
 */
export function aloneLimitRecord(db: DB, beforeSeq = Number.MAX_SAFE_INTEGER): AloneRecord | null {
  const last = db.prepare(`SELECT seq, event, payload_json FROM audit_log WHERE event IN ('policy.changed', ?, 'setting.changed') AND subject = ? AND seq < ? ORDER BY seq DESC LIMIT 1`)
    .get(SYSTEM_DEFAULT, ALONE_KEY, beforeSeq) as { seq: number; event: string; payload_json: string } | undefined;
  if (!last) return null;
  let payload: { proposal_id?: unknown; to?: unknown; value?: unknown; label?: unknown };
  try { payload = JSON.parse(last.payload_json) as typeof payload; } catch { return null; }
  if (last.event === SYSTEM_DEFAULT) {
    return valid(payload.value) && payload.label === SYSTEM_DEFAULT_LABEL ? { currency: "EUR", amount: payload.value, source: { kind: "system_default", label: SYSTEM_DEFAULT_LABEL }, seq: last.seq } : null;
  }
  if (last.event !== "policy.changed" || !valid(payload.to) || typeof payload.proposal_id !== "string") return null;
  const p = db.prepare("SELECT kind, status, terms_json FROM proposals WHERE proposal_id = ?").get(payload.proposal_id) as { kind: string; status: string; terms_json: string } | undefined;
  if (!p || p.kind !== "policy_change" || p.status !== "EXECUTED") return null;
  let to: unknown;
  try { to = (JSON.parse(p.terms_json) as { kind?: unknown; changes?: { key?: unknown; to?: unknown }[] }).changes?.find((c) => c.key === ALONE_KEY)?.to; } catch { return null; }
  if (to !== payload.to) return null;
  const a = db.prepare("SELECT method FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(payload.proposal_id) as { method: string } | undefined;
  return a?.method === "passkey" ? { currency: "EUR", amount: payload.to, source: { kind: "signed", proposal_id: payload.proposal_id }, seq: last.seq } : null;
}

/** The limit in force now: the record's, and only while the setting still holds that value. */
export function aloneLimitInForce(db: DB): AloneRecord | null {
  const r = aloneLimitRecord(db);
  if (!r) return null;
  const v = (db.prepare("SELECT value FROM settings WHERE key = ?").get(ALONE_KEY) as { value: string } | undefined)?.value;
  return v === r.amount ? r : null;
}

/** The source in words, for the record and verify. */
export function sourceWords(s: AloneSource): string {
  return s.kind === "signed" ? `signed by the CFO with the passkey (${s.proposal_id})` : s.label;
}

/**
 * A /try test company's default limit (its seed): written with its label, once; never over a limit the CFO signed, and
 * never again while the same default is in force. True when it was written.
 */
export function setSystemDefaultAloneLimit(db: DB, amount: string, now = new Date()): boolean {
  if (!valid(amount)) throw new Error(`a limit to pay alone is a plain amount above zero, not ${JSON.stringify(amount)}`);
  return db.transaction((): boolean => {
    const r = aloneLimitInForce(db);
    if (r?.source.kind === "system_default" && r.amount === amount) return false;
    if (db.prepare("SELECT 1 FROM audit_log WHERE event = 'policy.changed' AND subject = ? LIMIT 1").get(ALONE_KEY)) return false;
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(ALONE_KEY, amount, now.toISOString());
    audit(db, "system", SYSTEM_DEFAULT, ALONE_KEY, { key: ALONE_KEY, value: amount, label: SYSTEM_DEFAULT_LABEL }, now);
    return true;
  }).immediate();
}
