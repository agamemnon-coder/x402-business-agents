// Purser Cloud's security event log (ASVS 4.0.3 V7.1.3, V7.1.4, V7.2.1, V7.2.2, V8.1.4, V11.1.8): one append-only D1
// table across the whole cloud, beside the per-company security_events the owners read. Each event is also a log line
// ("security.<kind>"). Authentication failures and successes, refusals, rate-limit hits, the platform admin's actions,
// key and policy changes, webhook signature failures and tamper alarms: who (a key id, a user id, "platform:<admin key
// id>"), from where (the address cut to its network), which route, what status; never a secret, never a body.
//
// Append-only in the database itself: a trigger refuses every UPDATE, and a DELETE of a row less than a year old. A row
// is never written by anything but recordSecurityEvent.
//
// Alarms: each event adds to a counter per rule and window (src/lib/securityEvents.ts); the event that reaches a rule's
// threshold writes one "alarm.raised" row and an error log line. GET /v1/health shows how many alarms were raised in the
// last 24 hours (a count, no company, no address), so an uptime monitor can watch it; the platform admin reads the rows
// with GET /v1/admin/security-log. Writing an event never fails the request it is about.
import { bump } from "./auth.js";
import { logEvent } from "./log.js";
import type { Sql } from "./store.js";
import { alarmRules, cleanDetail, DEFAULT_ALARM_RULES, truncatedIp, windowStart, type AlarmRule, type SecurityKind } from "../../src/lib/securityEvents.js";

/** How long a row is kept at least: the trigger refuses to delete a younger one. */
export const SECURITY_LOG_KEEP_DAYS = 365;
/** Rows per kind and network per minute; past it the event is still counted toward its alarm, not written again. */
export const SECURITY_LOG_ROWS_PER_MINUTE = 30;

/** The table, its index and the two triggers that keep it append-only: one statement each (also cloud/migrations/0006_security_log.sql). */
export const SECURITY_LOG_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS security_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, tenant_id TEXT, actor TEXT, ip TEXT NOT NULL, route TEXT, status INTEGER, detail_json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS security_log_by_kind ON security_log (kind, at)",
  "CREATE TRIGGER IF NOT EXISTS security_log_no_update BEFORE UPDATE ON security_log BEGIN SELECT RAISE(ABORT, 'security_log is append-only'); END",
  `CREATE TRIGGER IF NOT EXISTS security_log_keep BEFORE DELETE ON security_log WHEN OLD.at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${SECURITY_LOG_KEEP_DAYS} days') BEGIN SELECT RAISE(ABORT, 'security_log rows are kept a year'); END`,
];

const ready = new WeakMap<Sql, Promise<void>>();
export function securityLogTable(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = (async () => { for (const s of SECURITY_LOG_SCHEMA) await sql.run(s); })().catch((e: unknown) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}

export interface SecurityEvent {
  kind: SecurityKind;
  tenant?: string | null;
  /** Who: a key id, a user id, "platform:<admin key id>", "anonymous". Never a token. */
  actor?: string | null;
  /** The caller's full address: only its network is kept. */
  ip?: string | null;
  route?: string | null;
  status?: number | null;
  detail?: Record<string, unknown>;
}

/** Writes one event (and its alarm, when it crosses a threshold). Never throws: a log that fails is logged, nothing more. */
export async function recordSecurityEvent(sql: Sql, e: SecurityEvent, now: Date, rules: AlarmRule[] = DEFAULT_ALARM_RULES): Promise<void> {
  const ip = truncatedIp(e.ip);
  const detail = cleanDetail(e.detail);
  const iso = now.toISOString();
  const warn = e.kind.endsWith("failure") || e.kind === "access.denied" || e.kind === "rate.limited";
  logEvent(e.kind === "tamper.alarm" ? "error" : warn ? "warn" : "info", `security.${e.kind}`, { tenant: e.tenant ?? null, actor: e.actor ?? null, ip, route: e.route ?? null, status: e.status ?? null, ...detail }, now);
  try {
    await securityLogTable(sql);
    const minute = Math.floor(now.getTime() / 60_000) * 60;
    if ((await bump(sql, `seclog:${e.kind}:${ip}`, minute, 1)) <= SECURITY_LOG_ROWS_PER_MINUTE) {
      await sql.run("INSERT INTO security_log (at, kind, tenant_id, actor, ip, route, status, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [iso, e.kind, e.tenant ?? null, (e.actor ?? "").slice(0, 80) || null, ip, (e.route ?? "").slice(0, 120) || null, e.status ?? null, JSON.stringify(detail)]);
    }
    for (const rule of rules.filter((r) => r.kinds.includes(e.kind))) {
      const win = windowStart(now, rule.windowSec);
      if ((await bump(sql, `secalarm:${rule.name}`, win, 1)) !== rule.threshold) continue;
      const alarm = { rule: rule.name, threshold: rule.threshold, window_sec: rule.windowSec, window_start: new Date(win * 1000).toISOString() };
      logEvent("error", "security.alarm", alarm, now);
      await sql.run("INSERT INTO security_log (at, kind, tenant_id, actor, ip, route, status, detail_json) VALUES (?, 'alarm.raised', NULL, 'security-log', ?, NULL, NULL, ?)", [iso, "unknown", JSON.stringify(alarm)]);
    }
  } catch (x) {
    logEvent("error", "security_log_failed", { kind: e.kind, error: x instanceof Error ? x.message.slice(0, 200) : "unknown" }, now);
  }
}

/** Alarms raised in the last `hours`, in all and per rule: for /v1/health (counts only). */
export async function securityAlarms(sql: Sql, now: Date, hours = 24): Promise<{ last_24h: number; rules: Record<string, number> }> {
  await securityLogTable(sql);
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const rows = await sql.all<{ detail_json: string }>("SELECT detail_json FROM security_log WHERE kind = 'alarm.raised' AND at > ? ORDER BY seq", [since]);
  const rules: Record<string, number> = {};
  for (const r of rows) { const name = String((JSON.parse(r.detail_json) as { rule?: string }).rule ?? "unknown"); rules[name] = (rules[name] ?? 0) + 1; }
  return { last_24h: rows.length, rules };
}

/** The log for the platform admin, newest first: by kind and since a time, at most 500 rows. */
export async function readSecurityLog(sql: Sql, q: { kind?: string | null; since?: string | null; limit?: number }): Promise<{ items: Record<string, unknown>[] }> {
  await securityLogTable(sql);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q.kind) { where.push("kind = ?"); params.push(q.kind); }
  if (q.since) { where.push("at >= ?"); params.push(q.since); }
  const rows = await sql.all<{ seq: number; at: string; kind: string; tenant_id: string | null; actor: string | null; ip: string; route: string | null; status: number | null; detail_json: string }>(
    `SELECT seq, at, kind, tenant_id, actor, ip, route, status, detail_json FROM security_log${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`,
    [...params, Math.min(500, Math.max(1, q.limit ?? 100))]);
  return { items: rows.map(({ detail_json, ...r }) => ({ ...r, detail: JSON.parse(detail_json) as unknown })) };
}

/** Rows past their year go (the daily job). The trigger refuses any younger one, whatever asks. */
export async function pruneSecurityLog(sql: Sql, now: Date): Promise<number> {
  await securityLogTable(sql);
  const before = new Date(now.getTime() - (SECURITY_LOG_KEEP_DAYS + 1) * 86_400_000).toISOString();
  return (await sql.run("DELETE FROM security_log WHERE at < ?", [before])).changes;
}

export { alarmRules };
