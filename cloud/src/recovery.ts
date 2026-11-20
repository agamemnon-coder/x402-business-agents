// Owner recovery takes two platform admins (review finding 2, 20 Nov 2026). Before, one admin bearer issued a recovery
// key for any owner, with `checked_by` as free text: the operator alone could reach an owner's session, then a new
// approval key, then approvals. Now one named admin key asks (POST /v1/admin/tenants/{id}/recovery, saying how the owner
// was checked, from a fixed list), and a second, different named admin key approves it (POST .../recovery/{request}/
// approve); only then is the recovery key issued (cloud/src/app.ts). The legacy single token takes no part. A request
// lives a day; one is open per owner at a time. What the recovered owner can then do is limited too: a new approval
// key cools off before it approves (cloud/src/engine/routes.ts, src/engine/host.ts).
//
// The table is made on first use (IF NOT EXISTS), as export_links_used is; cloud/migrations/0010_recovery_requests.sql
// holds the same statement for D1 (test/cloud-recovery-two-admins.test.ts holds the two equal).
import { randomToken } from "./crypto.js";
import type { Sql } from "./store.js";

export const RECOVERY_REQUESTS_SCHEMA = "CREATE TABLE IF NOT EXISTS recovery_requests (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_id TEXT NOT NULL, check_method TEXT NOT NULL, requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, expires_at TEXT NOT NULL, approved_by TEXT, approved_at TEXT, recovery_key TEXT)";
/** How the admin who asks checked, out of band, that the owner is who they say: one of these, never free text. */
export const RECOVERY_CHECKS = ["video_call", "in_person", "phone_callback"] as const;
export type RecoveryCheck = (typeof RECOVERY_CHECKS)[number];
/** How long a request waits for its second admin. */
export const RECOVERY_REQUEST_TTL_MS = 24 * 3_600_000;

export class RecoveryRefused extends Error {
  constructor(readonly status: 403 | 404 | 409, message: string) { super(message); }
}

const ready = new WeakMap<Sql, Promise<void>>();
function table(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) { p = sql.run(RECOVERY_REQUESTS_SCHEMA).then(() => undefined).catch((e: unknown) => { ready.delete(sql); throw e; }); ready.set(sql, p); }
  return p;
}

/** Each admin of a recovery is a named admin key: the legacy single token (shared, every scope) is refused. */
export function namedAdmin(id: string | null | undefined): string {
  if (!id || id === "legacy") throw new RecoveryRefused(403, "an owner recovery takes two named platform admin keys (ADMIN_KEYS); the legacy admin token takes no part");
  return id;
}

/** The first admin asks: a request for one owner, open a day. A second open request for the same owner is refused. */
export async function requestRecovery(sql: Sql, a: { tenantId: string; ownerId: string; check: RecoveryCheck; by: string; now: Date }): Promise<{ id: string; expires_at: string }> {
  await table(sql);
  const iso = a.now.toISOString();
  const open = await sql.first("SELECT id FROM recovery_requests WHERE tenant_id = ? AND owner_id = ? AND approved_at IS NULL AND expires_at > ?", [a.tenantId, a.ownerId, iso]);
  if (open) throw new RecoveryRefused(409, "a recovery request for this owner is already waiting for its second admin");
  const id = `rr_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
  const expires_at = new Date(a.now.getTime() + RECOVERY_REQUEST_TTL_MS).toISOString();
  await sql.run("INSERT INTO recovery_requests (id, tenant_id, owner_id, check_method, requested_by, requested_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, a.tenantId, a.ownerId, a.check, a.by, iso, expires_at]);
  return { id, expires_at };
}

/**
 * The second admin approves: the request is taken once, atomically, and only by an admin key other than the one that
 * asked, while it is open. Answers the request; release() gives it back when the key cannot be issued after all.
 */
export async function approveRecovery(sql: Sql, a: { tenantId: string; id: string; by: string; now: Date }): Promise<{ owner_id: string; check: RecoveryCheck; requested_by: string; release(): Promise<void>; issued(keyId: string): Promise<void> }> {
  await table(sql);
  const iso = a.now.toISOString();
  const r = await sql.first<{ owner_id: string; check_method: RecoveryCheck; requested_by: string; expires_at: string; approved_at: string | null }>(
    "SELECT owner_id, check_method, requested_by, expires_at, approved_at FROM recovery_requests WHERE id = ? AND tenant_id = ?", [a.id, a.tenantId]);
  if (!r) throw new RecoveryRefused(404, "no such recovery request for this company");
  if (r.requested_by === a.by) throw new RecoveryRefused(403, "the admin who asked for this recovery cannot approve it: a second, different admin key must");
  if (r.approved_at) throw new RecoveryRefused(409, "this recovery request was already approved");
  if (r.expires_at <= iso) throw new RecoveryRefused(409, "this recovery request expired unapproved; ask again");
  const taken = await sql.run("UPDATE recovery_requests SET approved_by = ?, approved_at = ? WHERE id = ? AND tenant_id = ? AND approved_at IS NULL AND expires_at > ? AND requested_by <> ?", [a.by, iso, a.id, a.tenantId, iso, a.by]);
  if (taken.changes !== 1) throw new RecoveryRefused(409, "this recovery request was approved or expired meanwhile");
  return {
    owner_id: r.owner_id, check: r.check_method, requested_by: r.requested_by,
    release: async () => { await sql.run("UPDATE recovery_requests SET approved_by = NULL, approved_at = NULL WHERE id = ? AND tenant_id = ? AND recovery_key IS NULL", [a.id, a.tenantId]); },
    issued: async (keyId) => { await sql.run("UPDATE recovery_requests SET recovery_key = ? WHERE id = ? AND tenant_id = ?", [keyId, a.id, a.tenantId]); },
  };
}
