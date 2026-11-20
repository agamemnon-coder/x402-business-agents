// A person's active sessions (ASVS 4.0.3 V3.3.4): each passkey sign-in is recorded (when it began, until when, the
// browser's user agent cut short and the network it came from, never the token), its id travels inside the signed
// session token, and a session whose row is ended or missing stops working at once (./auth.ts fromSession). The person
// lists them (GET /v1/sessions) and ends any one (DELETE /v1/sessions/{id}); sign-out ends them all, as before.
// The demo's guest and the hands-on demo's visitor sessions carry no id and are not listed. Nothing runs at import.
import type { Sql } from "./store.js";
import { randomToken } from "./crypto.js";
import { truncatedIp } from "../../src/lib/securityEvents.js";

/** Also cloud/migrations/0011_sessions.sql (test/cloud-sessions.test.ts holds the two equal). */
export const SESSIONS_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT NOT NULL, ip TEXT NOT NULL, ended_at TEXT)",
  "CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (tenant_id, user_id, expires_at)",
];

const ready = new WeakMap<Sql, Promise<void>>();
function table(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) { p = (async () => { for (const s of SESSIONS_SCHEMA) await sql.run(s); })().catch((e: unknown) => { ready.delete(sql); throw e; }); ready.set(sql, p); }
  return p;
}

/** Records a new session; returns its id (for the token). */
export async function recordSession(sql: Sql, a: { tenantId: string; userId: string; userAgent: string | null; ip: string | null; now: Date; expiresAt: Date }): Promise<string> {
  await table(sql);
  const id = `ses_${randomToken(12).replace(/[^A-Za-z0-9]/g, "x")}`;
  const ua = (a.userAgent ?? "").replace(/[^\x20-\x7e]/g, "").slice(0, 160) || "unknown";
  await sql.run("INSERT INTO sessions (id, tenant_id, user_id, created_at, expires_at, user_agent, ip, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
    [id, a.tenantId, a.userId, a.now.toISOString(), a.expiresAt.toISOString(), ua, truncatedIp(a.ip)]);
  return id;
}

/** Whether a session id is still live for this person. */
export async function sessionLive(sql: Sql, id: string, tenantId: string, userId: string): Promise<boolean> {
  await table(sql);
  const r = await sql.first<{ ended_at: string | null }>("SELECT ended_at FROM sessions WHERE id = ? AND tenant_id = ? AND user_id = ?", [id, tenantId, userId]);
  return !!r && !r.ended_at;
}

/** The person's live sessions, newest first (at most 50). */
export async function listSessions(sql: Sql, tenantId: string, userId: string, now: Date, current: string | null): Promise<{ id: string; created_at: string; expires_at: string; user_agent: string; ip: string; current: boolean }[]> {
  await table(sql);
  const rows = await sql.all<{ id: string; created_at: string; expires_at: string; user_agent: string; ip: string }>(
    "SELECT id, created_at, expires_at, user_agent, ip FROM sessions WHERE tenant_id = ? AND user_id = ? AND ended_at IS NULL AND expires_at > ? ORDER BY created_at DESC, id LIMIT 50", [tenantId, userId, now.toISOString()]);
  return rows.map((r) => ({ ...r, current: r.id === current }));
}

/** Ends one of the person's sessions; false when there is no such live session of theirs. */
export async function endSession(sql: Sql, tenantId: string, userId: string, id: string, now: Date): Promise<boolean> {
  await table(sql);
  return (await sql.run("UPDATE sessions SET ended_at = ? WHERE id = ? AND tenant_id = ? AND user_id = ? AND ended_at IS NULL", [now.toISOString(), id, tenantId, userId])).changes === 1;
}

/** Ends all of a person's sessions (sign-out, erasure): their tokens already stop through session_gen; this clears the list. */
export async function endAllSessions(sql: Sql, tenantId: string, userId: string, now: Date): Promise<void> {
  await table(sql);
  await sql.run("UPDATE sessions SET ended_at = ? WHERE tenant_id = ? AND user_id = ? AND ended_at IS NULL", [now.toISOString(), tenantId, userId]);
}

/** Rows a day past their expiry go (the daily job). */
export async function pruneSessions(sql: Sql, now: Date): Promise<number> {
  await table(sql);
  return (await sql.run("DELETE FROM sessions WHERE expires_at < ?", [new Date(now.getTime() - 86_400_000).toISOString()])).changes;
}
