// Monitoring (go-live hardening): the cloud's own health for an uptime monitor, a company's status for its owners, the
// runner's health as it reports it, and the company's alert webhook: alert events POSTed to a URL an owner sets,
// signed with HMAC-SHA256, retried three times, capped per hour and turned off after twenty failures in a row.

import { z } from "zod";
import { withinRate } from "./auth.js";
import { randomToken } from "./crypto.js";
import { logEvent } from "./log.js";
import { MAIL_QUOTA } from "./mail.js";
import type { Blobs, Sql } from "./store.js";
import { TenantDb } from "./tenant.js";

export class MonitorRefused extends Error {}

/** Delivery attempts per event, events per company per hour, failed events in a row before the hook is turned off. */
export const HOOK_ATTEMPTS = 3;
export const HOOK_EVENTS_PER_HOUR = 30;
export const HOOK_OFF_AFTER = 20;

export interface Outbound { (url: string, init: RequestInit): Promise<Response> }

/** Public: whether the database and the document store answer, the version, and how much mail waits in all. */
export async function cloudHealth(sql: Sql, blobs: Blobs, version: string): Promise<{ status: number; body: Record<string, unknown> }> {
  let d1 = "ok", r2 = "ok", queued: number | null = null;
  try {
    await sql.first("SELECT 1 AS ok");
    queued = (await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM inbound_mail WHERE status = 'queued'"))?.n ?? 0;
  } catch { d1 = "down"; }
  try { await blobs.list("health/"); } catch { r2 = "down"; }
  const ok = d1 === "ok" && r2 === "ok";
  return { status: ok ? 200 : 503, body: { ok, version, d1, r2, mail_queued: queued } };
}

export const HealthReport = z.object({
  at: z.string().datetime(),
  status: z.enum(["ok", "alert"]),
  // Codes and severities only: the words of an alert can name a supplier or a proposal, so they are dropped here.
  alerts: z.array(z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/), severity: z.enum(["info", "warning", "critical"]), since: z.string().max(40).nullable().optional(), words: z.string().max(2000).optional() })).max(50),
}).strict();
export type HealthReport = z.infer<typeof HealthReport>;
type Alert = { code: string; severity: string };

/** Stores the runner's report and sends the alerts that were raised or cleared since the last one to the webhook. */
export async function receiveReport(sql: Sql, tenantId: string, r: HealthReport, now: Date, out: Outbound | undefined, retryDelayMs = 500): Promise<{ raised: string[]; cleared: string[]; delivered: number }> {
  const db = new TenantDb(sql, tenantId);
  const alerts: Alert[] = r.alerts.map((a) => ({ code: a.code, severity: a.severity }));
  const before = await db.one<{ alerts_json: string }>("runner_health", { id: "latest" });
  const old: Alert[] = before ? (JSON.parse(before.alerts_json) as Alert[]) : [];
  const row = { at: r.at, status: r.status, alerts_json: JSON.stringify(alerts) };
  await db.apply([before ? db.update("runner_health", { id: "latest" }, row) : db.insert("runner_health", { id: "latest", ...row })]);
  const raised = alerts.filter((a) => !old.some((o) => o.code === a.code));
  const cleared = old.filter((o) => !alerts.some((a) => a.code === o.code));
  let delivered = 0;
  for (const [type, list] of [["alert.raised", raised], ["alert.cleared", cleared]] as const) {
    for (const a of list) if (await deliver(sql, tenantId, { type, alert: a }, now, out, retryDelayMs)) delivered++;
  }
  return { raised: raised.map((a) => a.code), cleared: cleared.map((a) => a.code), delivered };
}

/** Owners: where the company stands, in numbers and codes (no supplier, no person, no amount). */
export async function companyStatus(sql: Sql, tenantId: string, now: Date): Promise<Record<string, unknown>> {
  const db = new TenantDb(sql, tenantId);
  const last = (await db.select<{ at: string }>("push_log", {}, { order: ["at"], desc: true, limit: 1 }))[0]?.at ?? null;
  const day = Math.floor(now.getTime() / 86_400_000) * 86_400;
  const used = async (bucket: string) => (await sql.first<{ count: number }>("SELECT count FROM rate_hits WHERE bucket = ? AND window_start = ?", [`${bucket}:${tenantId}`, day]))?.count ?? 0;
  const h = await db.one<{ at: string; status: string; alerts_json: string }>("runner_health", { id: "latest" });
  const hook = await webhookOf(sql, tenantId);
  return {
    last_push_at: last,
    mail: { queued: await db.count("inbound_mail", { status: "queued" }), refused: await db.count("inbound_mail", { status: "refused" }), done: await db.count("inbound_mail", { status: "done" }) },
    quota: { messages_today: await used("mail"), bytes_today: await used("mailbytes"), messages_per_day: MAIL_QUOTA.messagesPerDay, bytes_per_day: MAIL_QUOTA.bytesPerDay },
    runner: h ? { at: h.at, status: h.status, alerts: JSON.parse(h.alerts_json) as Alert[] } : null,
    webhook: hook,
  };
}

/** Only an https URL to a public host name: no address literals, no local names, no credentials, port 443. */
export function hookUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new MonitorRefused("not a URL"); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:") throw new MonitorRefused("the webhook must be https");
  if (u.username || u.password) throw new MonitorRefused("no credentials in the webhook URL");
  if (u.port && u.port !== "443") throw new MonitorRefused("the webhook must use port 443");
  if (/^[\d.]+$/.test(host) || host.startsWith("[") || host.includes(":")) throw new MonitorRefused("the webhook must name a host, not an address");
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|home|lan|corp|localdomain)$/.test(host)) throw new MonitorRefused("the webhook must be a public host name");
  if (raw.length > 500) throw new MonitorRefused("the webhook URL is too long");
  return u.toString();
}

export async function setWebhook(sql: Sql, tenantId: string, url: string, by: string, now: Date): Promise<{ url: string; secret: string }> {
  const db = new TenantDb(sql, tenantId);
  const clean = hookUrl(url);
  const secret = `whsec_${randomToken(32).replace(/[^A-Za-z0-9_-]/g, "x")}`;
  const row = { url: clean, secret, created_at: now.toISOString(), created_by: by, consecutive_failures: 0, last_attempt_at: null, last_status: null, disabled_at: null };
  const had = await db.one("webhooks", { id: "main" });
  await db.apply([had ? db.update("webhooks", { id: "main" }, row) : db.insert("webhooks", { id: "main", ...row })]);
  logEvent("info", "webhook.set", { tenant: tenantId, host: new URL(clean).hostname });
  return { url: clean, secret };
}

export async function removeWebhook(sql: Sql, tenantId: string): Promise<boolean> {
  const db = new TenantDb(sql, tenantId);
  if (!(await db.one("webhooks", { id: "main" }))) return false;
  await db.apply([db.delete("webhooks", { id: "main" })]);
  return true;
}

/** The webhook without its secret. */
export async function webhookOf(sql: Sql, tenantId: string): Promise<Record<string, unknown> | null> {
  const h = await new TenantDb(sql, tenantId).one<Record<string, unknown>>("webhooks", { id: "main" });
  if (!h) return null;
  const { url, created_at, consecutive_failures, last_attempt_at, last_status, disabled_at } = h;
  return { url, created_at, consecutive_failures, last_attempt_at, last_status, disabled_at };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One event to the company's webhook, if it has a live one and the hourly cap allows: up to three attempts, a 2xx ends
 * it. The receiver checks x-purser-signature "t=<unix seconds>,v1=<HMAC-SHA256 hex of `${t}.${body}`>" under its secret.
 */
async function deliver(sql: Sql, tenantId: string, event: { type: string; alert: Alert }, now: Date, out: Outbound | undefined, retryDelayMs: number): Promise<boolean> {
  const db = new TenantDb(sql, tenantId);
  const h = await db.one<{ url: string; secret: string; consecutive_failures: number; disabled_at: string | null }>("webhooks", { id: "main" });
  if (!h || h.disabled_at || !out) return false;
  if (!(await withinRate(sql, `hook:${tenantId}`, now, { windowSec: 3600, max: HOOK_EVENTS_PER_HOUR }))) {
    logEvent("warn", "webhook.capped", { tenant: tenantId, type: event.type });
    return false;
  }
  const body = JSON.stringify({ id: `evt_${randomToken(12).replace(/[^A-Za-z0-9]/g, "x")}`, type: event.type, created_at: now.toISOString(), alert: event.alert });
  const t = Math.floor(now.getTime() / 1000);
  const headers = { "content-type": "application/json", "user-agent": "PurserCloud-Webhook/1", "x-purser-signature": `t=${t},v1=${await hmacHex(h.secret, `${t}.${body}`)}` };
  let status = 0;
  for (let attempt = 1; attempt <= HOOK_ATTEMPTS; attempt++) {
    try {
      const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(5000) : undefined;
      status = (await out(h.url, { method: "POST", headers, body, redirect: "manual", ...(signal ? { signal } : {}) })).status;
    } catch { status = 0; }
    if (status >= 200 && status < 300) break;
    if (attempt < HOOK_ATTEMPTS && retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
  }
  const ok = status >= 200 && status < 300;
  const failures = ok ? 0 : h.consecutive_failures + 1;
  await db.apply([db.update("webhooks", { id: "main" }, { consecutive_failures: failures, last_attempt_at: now.toISOString(), last_status: status, ...(failures >= HOOK_OFF_AFTER ? { disabled_at: now.toISOString() } : {}) })]);
  logEvent(ok ? "info" : "warn", "webhook.delivery", { tenant: tenantId, type: event.type, code: event.alert.code, status, failures, ...(failures >= HOOK_OFF_AFTER ? { disabled: true } : {}) });
  return ok;
}
