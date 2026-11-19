// Before money moves, the audit log must still verify (19 Nov, fourth round; red team rewrite-history). Someone who
// holds the database file can drop its write guard and change a row: no code in the same file can stop that, and until
// now the hash chain found it afterwards (npm run verify, the hourly health check). Now every payment asks first: an
// agent's spend (reserveSpend, src/policy/holds.ts) and every approved action that moves money (beginExecution,
// src/policy/approvals.ts). A log that does not verify refuses them all, so no money moves on a rewritten history; only
// a person who has looked (npm run verify) and restored the log lets payments run again.
//
// The whole chain is hashed once per database handle; after that only the rows added since, while nothing could have
// changed the old ones: the three guards (no update, no delete, no replace) are in place and the schema's version is
// the one the full check saw (dropping a guard, or putting it back, changes it). Otherwise it is hashed whole again.

import type { DB } from "../db/open.js";
import { GENESIS, verifyAuditRowsFrom, type AuditRowStored } from "./log.js";

export const AUDIT_GUARDS = ["audit_log_no_update", "audit_log_no_delete", "audit_log_no_replace"] as const;

const verified = new WeakMap<DB, { schema: number; seq: number; head: string }>();

/** The value, or null where the database refuses the read (a Durable Object: "not authorized"). Other errors throw. */
function readable(read: () => number): number | null {
  try { return read(); } catch (e) {
    if (/not authorized/i.test(String((e as Error)?.message ?? e))) return null;
    throw e;
  }
}

/** Why the audit log cannot be trusted to move money on (where it breaks), or null when it verifies. */
export function auditChainRefusal(db: DB): string | null {
  // A Durable Object's SQLite refuses PRAGMA schema_version and reads of sqlite_master ("not authorized"). There the
  // guards cannot be read back, so nothing is remembered and the whole chain is hashed on every check: slower, as safe.
  const schema = readable(() => Number(db.pragma("schema_version", { simple: true })));
  const guards = readable(() => (db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log' AND name IN (${AUDIT_GUARDS.map(() => "?").join(", ")})`).get(...AUDIT_GUARDS) as { n: number }).n);
  const seen = verified.get(db);
  // The rows after the point seen, if that point still stands and nothing could have changed what is before it.
  const from = seen && schema !== null && seen.schema === schema && guards === AUDIT_GUARDS.length
    && (db.prepare("SELECT row_hash FROM audit_log WHERE seq = ?").get(seen.seq) as { row_hash: string } | undefined)?.row_hash === seen.head
    ? { seq: seen.seq, head: seen.head } : { seq: 0, head: GENESIS };
  const rows = db.prepare("SELECT * FROM audit_log WHERE seq > ? ORDER BY seq").all(from.seq) as AuditRowStored[];
  const check = verifyAuditRowsFrom(rows, from);
  if (!check.ok) {
    verified.delete(db);
    return `ledger_tampered: the audit log does not verify at row ${check.seq} (${check.reason}); no money moves until a person has checked it (npm run verify)`;
  }
  // Only a log with its guards in place is remembered; without them every check hashes the whole chain again.
  if (schema !== null && guards === AUDIT_GUARDS.length && check.rows > 0) verified.set(db, { schema, seq: check.rows, head: check.head });
  else verified.delete(db);
  return null;
}
