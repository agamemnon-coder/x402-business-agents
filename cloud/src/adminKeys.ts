// The platform admin as named, scoped, expiring keys (ASVS 4.0.3 V2.5.4, V4.3.1, V1.2.4; docs/runbook.md "Platform
// admin keys"). Until 19 Nov the platform admin was one static token (its SHA-256 in ADMIN_TOKEN_SHA256), shared by
// whoever held it, able to do everything, for ever.
//
// Now the Worker secret ADMIN_KEYS lists one entry per key, "id:sha256:scopes:last-day", separated by commas, spaces or
// lines: the key's id names its holder (a person, "max-2026q4"), the SHA-256 is of the whole key (the key itself is never
// stored), the scopes say what it may do, and it stops working on its last day (at most 90 days after it was made). A
// key is "pak_<id>_<43 random characters>", shown once by npm run cloud:admin-key. Its hash is compared in constant
// time; every use is an admin.action in the security log under platform:<id>, every refusal an admin.auth_failure (its
// id, never its secret) that counts toward the auth_failures alarm. No lockout (a flood must not lock the admin out).
//
// Rotation: make a new key, add its entry to ADMIN_KEYS (wrangler secret put ADMIN_KEYS), then remove the old entry.
// Migration: while ADMIN_TOKEN_SHA256 is still set, the old token keeps working with every scope, logged as
// platform:legacy with a warning on each use; deleting that secret ends it.
import { randomToken, sameString, sha256Hex } from "./crypto.js";
import { logEvent } from "./log.js";

/** tenants: make a company. recovery: issue an owner's recovery key. read: the operator's read-only views. try: the hands-on deployment's controls. */
export const ADMIN_SCOPES = ["tenants", "recovery", "read", "try"] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];
export const ADMIN_KEY_MAX_DAYS = 90;

/** Each platform route's scope, by "METHOD path". A platform route not listed here takes every scope (fails closed). */
export const ADMIN_ROUTE_SCOPES: Record<string, AdminScope> = {
  "POST /v1/admin/tenants": "tenants",
  "POST /v1/admin/tenants/{id}/recovery": "recovery",
  "GET /v1/admin/companies": "read",
  "GET /v1/admin/security-log": "read",
  "POST /v1/try/ops": "read",
  "POST /v1/try/admin": "try",
};

export interface AdminKey { id: string; sha256: string; scopes: Set<AdminScope>; expires: string }

const ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const ENTRY = /^([a-z0-9][a-z0-9-]{1,38}[a-z0-9]):([0-9a-f]{64}):([a-z]+(?:\+[a-z]+)*):(\d{4}-\d{2}-\d{2})$/;
const TOKEN = /^pak_([a-z0-9][a-z0-9-]{1,38}[a-z0-9])_([A-Za-z0-9_-]{43})$/;

/** One entry of ADMIN_KEYS. */
export function adminKeyEntry(k: { id: string; sha256: string; scopes: readonly AdminScope[]; expires: string }): string {
  return `${k.id}:${k.sha256}:${k.scopes.join("+")}:${k.expires}`;
}

/** The entries of ADMIN_KEYS; a malformed one is skipped and named by its position only (it may hold a typo'd secret). */
export function parseAdminKeys(text: string | undefined): { keys: AdminKey[]; skipped: number[] } {
  const keys: AdminKey[] = [];
  const skipped: number[] = [];
  (text ?? "").split(/[\s,]+/).filter(Boolean).forEach((part, i) => {
    const m = ENTRY.exec(part);
    const scopes = m ? m[3]!.split("+") : [];
    if (!m || !scopes.every((s) => (ADMIN_SCOPES as readonly string[]).includes(s)) || Number.isNaN(Date.parse(`${m[4]}T00:00:00Z`))) { skipped.push(i + 1); return; }
    keys.push({ id: m[1]!, sha256: m[2]!, scopes: new Set(scopes as AdminScope[]), expires: m[4]! });
  });
  return { keys, skipped };
}

/** A new key and its ADMIN_KEYS entry: the key is shown once and never stored. */
export async function newAdminKey(a: { id: string; scopes: AdminScope[]; days: number; now: Date }): Promise<{ key: string; entry: string; expires: string }> {
  if (!ID.test(a.id)) throw new Error("an admin key's id is 3 to 40 lowercase letters, digits and dashes, naming its holder (e.g. max-2026q4)");
  if (!a.scopes.length || !a.scopes.every((s) => (ADMIN_SCOPES as readonly string[]).includes(s))) throw new Error(`scopes are some of ${ADMIN_SCOPES.join(", ")}`);
  if (!Number.isInteger(a.days) || a.days < 1 || a.days > ADMIN_KEY_MAX_DAYS) throw new Error(`an admin key lives 1 to ${ADMIN_KEY_MAX_DAYS} days`);
  const key = `pak_${a.id}_${randomToken(32)}`;
  if (!TOKEN.test(key)) throw new Error("internal: the key does not have its own shape");
  const expires = new Date(a.now.getTime() + a.days * 86_400_000).toISOString().slice(0, 10);
  return { key, entry: adminKeyEntry({ id: a.id, sha256: await sha256Hex(key), scopes: [...new Set(a.scopes)], expires }), expires };
}

export type AdminDecision = { ok: true; id: string } | { ok: false; status: 401 | 403; why: string; id: string | null };

/**
 * Whether a request's bearer is a live admin key with the route's scope (or, while it is set, the legacy token). The
 * key named by its id is looked up, then its hash compared in constant time; an unknown id costs the same hash.
 */
export async function platformAdmin(cfg: { adminKeys?: string | undefined; adminTokenSha256: string }, authorization: string | null, route: string, now: Date): Promise<AdminDecision> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!token) return { ok: false, status: 401, why: "platform admin only", id: null };
  const scope = ADMIN_ROUTE_SCOPES[route];
  const m = TOKEN.exec(token);
  if (m) {
    const { keys, skipped } = parseAdminKeys(cfg.adminKeys);
    if (skipped.length) logEvent("error", "admin_keys_malformed", { entries: skipped.join(" ") }, now);
    const key = keys.find((k) => k.id === m[1]);
    const hash = await sha256Hex(token);
    if (!key || !sameString(hash, key.sha256)) return { ok: false, status: 401, why: "platform admin only", id: m[1]! };
    if (`${key.expires}T00:00:00.000Z` <= now.toISOString()) return { ok: false, status: 401, why: `this admin key expired on ${key.expires}; make a new one (npm run cloud:admin-key)`, id: key.id };
    const allowed = scope ? key.scopes.has(scope) : ADMIN_SCOPES.every((s) => key.scopes.has(s));
    if (!allowed) return { ok: false, status: 403, why: `this admin key may not do this (it needs the ${scope ?? "every"} scope)`, id: key.id };
    return { ok: true, id: key.id };
  }
  // The single token of before (ADMIN_TOKEN_SHA256), while it is still set: every scope, a warning on each use.
  if (cfg.adminTokenSha256 && sameString(await sha256Hex(token), cfg.adminTokenSha256)) {
    logEvent("warn", "admin.legacy_token_used", { route, note: "move to ADMIN_KEYS (docs/runbook.md, Platform admin keys) and delete ADMIN_TOKEN_SHA256" }, now);
    return { ok: true, id: "legacy" };
  }
  return { ok: false, status: 401, why: "platform admin only", id: null };
}
