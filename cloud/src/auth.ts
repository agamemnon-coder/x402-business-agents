// Who is calling, and what they may do. Systems use API keys (shown once, stored as a SHA-256 hash, scoped,
// revocable); people sign in with a passkey and get a short session token. The platform admin token (a Worker secret)
// only creates tenants. Every check fails closed.

import { verifyAssertion, type AssertionB64 } from "../../worker/src/webauthn.js";
import { hmacB64u, hmacValid, randomToken, sameString, sha256Hex, toB64u } from "./crypto.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";

export type Scope = "read" | "sync" | "admin";
export type Role = "owner" | "cfo" | "accountant" | "viewer";
export const ROLES: Role[] = ["owner", "cfo", "accountant", "viewer"];
export const SCOPES: Scope[] = ["read", "sync", "admin"];

export interface Caller {
  tenantId: string;
  kind: "key" | "session";
  /** The key's id, or the signed-in user's id. */
  principal: string;
  scopes: Set<Scope>;
  role?: Role;
}

export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) { super(message); }
}

export const SESSION_TTL_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** A new API key: its full text is returned once; only the hash of its secret is stored. */
export async function newApiKey(db: TenantDb, a: { name: string; scopes: Scope[]; createdBy: string; now: Date }): Promise<{ id: string; key: string }> {
  if (!a.scopes.length || a.scopes.some((s) => !SCOPES.includes(s))) throw new AuthError(403, `scopes must be some of ${SCOPES.join(", ")}`);
  const id = `k${randomToken(9)}`.replace(/[^A-Za-z0-9]/g, "x");
  const secret = randomToken(32);
  await db.apply([db.insert("api_keys", { id, name: a.name.slice(0, 80), scopes: a.scopes.join(" "), secret_sha256: await sha256Hex(secret), created_by: a.createdBy, created_at: a.now.toISOString() })]);
  return { id, key: `pck_${id}_${secret}` };
}

async function fromApiKey(sql: Sql, token: string, now: Date): Promise<Caller> {
  const m = /^pck_(k[A-Za-z0-9]{12})_([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) throw new AuthError(401, "not a Purser API key");
  const row = await sql.first<{ tenant_id: string; scopes: string; secret_sha256: string; revoked_at: string | null }>(
    "SELECT tenant_id, scopes, secret_sha256, revoked_at FROM api_keys WHERE id = ?", [m[1]!]);
  const digest = await sha256Hex(m[2]!);
  if (!row || !sameString(row.secret_sha256, digest)) throw new AuthError(401, "unknown API key");
  if (row.revoked_at) throw new AuthError(401, "this API key was revoked");
  const tenant = await sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [row.tenant_id]);
  if (!tenant || tenant.closed_at) throw new AuthError(401, "this company's account is closed");
  await sql.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [now.toISOString(), m[1]!]);
  return { tenantId: row.tenant_id, kind: "key", principal: m[1]!, scopes: new Set(row.scopes.split(" ") as Scope[]) };
}

const scopesOf = (role: Role): Set<Scope> => new Set<Scope>(role === "owner" ? ["read", "admin"] : ["read"]);

export async function sessionToken(secret: string, s: { tenantId: string; userId: string; role: Role }, now: Date): Promise<string> {
  const body = toB64u(new TextEncoder().encode(JSON.stringify({ t: s.tenantId, u: s.userId, r: s.role, exp: now.getTime() + SESSION_TTL_MS })));
  return `pcs.${body}.${await hmacB64u(secret, body)}`;
}

async function fromSession(sql: Sql, secret: string, token: string, now: Date): Promise<Caller> {
  const [, body, sig] = token.split(".");
  if (!body || !sig || !(await hmacValid(secret, body, sig))) throw new AuthError(401, "bad session");
  const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((body.length + 3) % 4)), (c) => c.charCodeAt(0)))) as { t: string; u: string; r: Role; exp: number };
  if (p.exp <= now.getTime()) throw new AuthError(401, "the session expired; sign in again");
  // A person erased or demoted since the token was issued loses access at once.
  const user = await sql.first<{ role: Role; erased_at: string | null }>("SELECT role, erased_at FROM users WHERE tenant_id = ? AND id = ?", [p.t, p.u]);
  if (!user || user.erased_at || user.role !== p.r) throw new AuthError(401, "this sign-in is no longer valid");
  return { tenantId: p.t, kind: "session", principal: p.u, scopes: scopesOf(p.r), role: p.r };
}

export async function callerOf(sql: Sql, sessionSecret: string, authorization: string | null, now: Date): Promise<Caller> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!token) throw new AuthError(401, "sign in, or send an API key as Authorization: Bearer");
  return token.startsWith("pck_") ? fromApiKey(sql, token, now) : token.startsWith("pcs.") ? fromSession(sql, sessionSecret, token, now) : Promise.reject(new AuthError(401, "unknown token type"));
}

export function need(c: Caller, scope: Scope): void {
  if (!c.scopes.has(scope)) throw new AuthError(403, `this ${c.kind === "key" ? "key" : "sign-in"} may not ${scope === "read" ? "read" : scope === "sync" ? "push data" : "manage this company"}`);
}

/** The platform admin's token: only its SHA-256 is configured (a Worker secret). */
export async function isPlatformAdmin(adminTokenSha256: string, authorization: string | null): Promise<boolean> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  return !!token && !!adminTokenSha256 && sameString(await sha256Hex(token), adminTokenSha256);
}

// Passkey sign-in: a one-time challenge, then the assertion checked in the Worker against the credential the company's
// Purser runner enrolled and pushed (its public key, x and y).
export async function newChallenge(sql: Sql, tenantId: string, now: Date): Promise<{ challenge_id: string; challenge: string }> {
  const id = `c${randomToken(12)}`;
  const challenge = randomToken(32);
  await sql.run("INSERT INTO challenges (id, tenant_id, challenge, expires_at) VALUES (?, ?, ?, ?)", [id, tenantId, challenge, new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString()]);
  return { challenge_id: id, challenge };
}

export async function passkeyLogin(sql: Sql, a: { tenantId: string; challengeId: string; credentialId: string; assertion: AssertionB64; rpId: string; origin: string; secret: string; now: Date }): Promise<{ token: string; role: Role; user_id: string }> {
  const ch = await sql.first<{ challenge: string; expires_at: string; used_at: string | null }>("SELECT challenge, expires_at, used_at FROM challenges WHERE id = ? AND tenant_id = ?", [a.challengeId, a.tenantId]);
  if (!ch || ch.used_at || ch.expires_at <= a.now.toISOString()) throw new AuthError(401, "the sign-in challenge is unknown, used or expired");
  // Used once, whatever the outcome: a failed attempt cannot be retried with the same challenge.
  await sql.run("UPDATE challenges SET used_at = ? WHERE id = ?", [a.now.toISOString(), a.challengeId]);
  const db = new TenantDb(sql, a.tenantId);
  const cred = await db.one<{ user_id: string; x: string; y: string; counter: number }>("credentials", { credential_id: a.credentialId });
  if (!cred) throw new AuthError(401, "unknown passkey");
  const v = await verifyAssertion(a.assertion, { x: cred.x, y: cred.y }, { challenge: ch.challenge, origin: a.origin, rpId: a.rpId, lastCounter: cred.counter });
  if (!v.ok) throw new AuthError(401, `the passkey sign-in failed (${v.why})`);
  const user = await db.one<{ role: Role; erased_at: string | null }>("users", { id: cred.user_id });
  if (!user || user.erased_at) throw new AuthError(401, "this person has no access");
  await db.apply([db.update("credentials", { credential_id: a.credentialId }, { counter: v.counter })]);
  return { token: await sessionToken(a.secret, { tenantId: a.tenantId, userId: cred.user_id, role: user.role }, a.now), role: user.role, user_id: cred.user_id };
}

/** A fixed window per key or session: true when the call is within the limit. */
export async function withinRate(sql: Sql, bucket: string, now: Date, limit: { windowSec: number; max: number }): Promise<boolean> {
  const win = Math.floor(now.getTime() / 1000 / limit.windowSec) * limit.windowSec;
  await sql.run("INSERT INTO rate_hits (bucket, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1", [bucket, win]);
  const row = await sql.first<{ count: number }>("SELECT count FROM rate_hits WHERE bucket = ? AND window_start = ?", [bucket, win]);
  return (row?.count ?? 0) <= limit.max;
}
