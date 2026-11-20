// Renewal instructions before an API key expires (ASVS 4.0.3 V2.3.3). Every key expires (cloud/src/auth.ts: 90 days by
// default, at most a year), so whoever relies on one is told in time to make the next:
// - the program using it: each call in the key's last 14 days carries the purser-key-renewal header (when it expires,
//   the days left, and what to do);
// - the company's owners: 14 and 3 days before, once each, a key.expiring security event (GET /v1/security/events) and
//   an event to the company's alert webhook when one is set. The scheduled job sends them (cloud/src/worker.ts).
// Never the key's secret: its id, its name and its expiry only. Nothing here runs at import.
import { bump } from "./auth.js";
import { randomToken } from "./crypto.js";
import { notify, type Outbound } from "./monitor.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";

export const KEY_RENEWAL_HEADER = "purser-key-renewal";
/** Days before expiry when the owners are told (the header starts at the first). */
export const KEY_WARN_DAYS = [14, 3] as const;
const DAY_MS = 86_400_000;

/** The renewal header for a key expiring at `expiresAt`, or null while it has more than 14 days left. */
export function renewalNotice(expiresAt: string | null | undefined, now: Date): string | null {
  if (!expiresAt) return null;
  const left = Date.parse(expiresAt) - now.getTime();
  if (!(left > 0) || left > KEY_WARN_DAYS[0] * DAY_MS) return null;
  return `expires=${expiresAt}; days=${Math.ceil(left / DAY_MS)}; renew="make a new key (POST /v1/keys, or Settings, API keys), switch to it, then revoke this one"`;
}

/**
 * Tells each company's owners of their keys that reach 14 or 3 days before expiry: once per key and threshold, however
 * often the job runs (a marker in rate_hits kept until the key's expiry). Revoked, expired, starter and recovery keys
 * (a week and a day long, by design) are left out. Returns how many notices were sent.
 */
export async function warnExpiringKeys(sql: Sql, now: Date, out?: Outbound, retryDelayMs?: number): Promise<number> {
  const iso = now.toISOString();
  let sent = 0;
  for (const days of KEY_WARN_DAYS) {
    const until = new Date(now.getTime() + days * DAY_MS).toISOString();
    const keys = await sql.all<{ id: string; tenant_id: string; name: string; expires_at: string }>(
      "SELECT id, tenant_id, name, expires_at FROM api_keys WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ? AND (purpose IS NULL OR purpose NOT IN ('first-owner', 'recovery')) ORDER BY expires_at LIMIT 500",
      [iso, until]);
    for (const k of keys) {
      // The 3-day notice stands for the 14-day one too when a key was made with less than 14 days to live.
      if (days === KEY_WARN_DAYS[0] && Date.parse(k.expires_at) - now.getTime() <= KEY_WARN_DAYS[1] * DAY_MS) continue;
      if ((await bump(sql, `keyexpiry:${k.id}:${days}`, Math.floor(Date.parse(k.expires_at) / 1000), 1)) !== 1) continue;
      const left = Math.ceil((Date.parse(k.expires_at) - now.getTime()) / DAY_MS);
      const detail = { key_id: k.id, name: k.name, expires_at: k.expires_at, days_left: left, renew: "make a new key, switch to it, then revoke this one" };
      const t = new TenantDb(sql, k.tenant_id);
      await t.apply([t.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: iso, kind: "key.expiring", actor: "purser", detail_json: JSON.stringify(detail) })]);
      await notify(sql, k.tenant_id, "security.key.expiring", { key_id: k.id, name: k.name, expires_at: k.expires_at, days_left: String(left) }, now, out, retryDelayMs);
      sent++;
    }
  }
  return sent;
}
