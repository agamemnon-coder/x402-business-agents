// Who is calling, and what they may do. Systems use API keys (shown once, stored as a SHA-256 hash, scoped,
// revocable, expiring); people sign in with a passkey and get a short session token. The platform admin token (a Worker
// secret) only creates tenants. Every check fails closed.

import { verifyAssertion, type AssertionB64 } from "../../worker/src/webauthn.js";
import { fromB64, hmacB64u, hmacValid, randomToken, sameString, sha256Hex, toB64u } from "./crypto.js";
import type { Sql } from "./store.js";
import { TenantDb, WriteConflict } from "./tenant.js";

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
  /** The person behind the call: the signed-in user, or the person a key was made for (inherited down a chain of keys). */
  user: string | null;
}

export class AuthError extends Error {
  constructor(readonly status: 401 | 403 | 429, message: string) { super(message); }
}

export const SESSION_TTL_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Sign-in challenges a company may have open (unused, unexpired) at once. */
export const MAX_OPEN_CHALLENGES = 200;
export const ENROLMENT_TTL_MS = 30 * 60 * 1000;
/** Every key expires: 90 days unless it is made with fewer, at most a year. */
export const KEY_DEFAULT_DAYS = 90;
export const KEY_MAX_DAYS = 365;

/**
 * A new API key: its full text is returned once; only the hash of its secret is stored. A key made by a key never has
 * more scope or a later expiry than the key that made it, and is revoked with it (red team round 4: a one-day admin-only
 * key made a year-long read+sync+admin key that outlived its revoke). The insert commits only while the caller is still
 * live (a key minted while its person was being erased outlived the erasure).
 */
export async function newApiKey(db: TenantDb, a: { name: string; scopes: Scope[]; caller: Caller; expiresInDays?: number; now: Date }): Promise<{ id: string; key: string; expires_at: string }> {
  if (!a.scopes.length || a.scopes.some((s) => !SCOPES.includes(s))) throw new AuthError(403, `scopes must be some of ${SCOPES.join(", ")}`);
  const days = a.expiresInDays ?? KEY_DEFAULT_DAYS;
  let expires_at = new Date(a.now.getTime() + days * 86_400_000).toISOString();
  let parent: string | null = null;
  if (a.caller.kind === "key") {
    const more = a.scopes.filter((s) => !a.caller.scopes.has(s));
    if (more.length) throw new AuthError(403, `a key cannot make a key with more scope than its own (${more.join(", ")})`);
    const p = await db.one<{ expires_at: string | null }>("api_keys", { id: a.caller.principal });
    if (p?.expires_at && p.expires_at < expires_at) expires_at = p.expires_at;
    parent = a.caller.principal;
  }
  const id = `k${randomToken(9)}`.replace(/[^A-Za-z0-9]/g, "x");
  const secret = randomToken(32);
  const iso = a.now.toISOString();
  try {
    await db.apply([db.callerGuard(a.caller, iso), db.insert("api_keys", {
      id, name: a.name.slice(0, 80), scopes: a.scopes.join(" "), secret_sha256: await sha256Hex(secret), created_by: a.caller.principal, created_by_user: a.caller.user,
      parent_key: parent, created_at: iso, expires_at,
    })]);
  } catch (e) {
    if (e instanceof WriteConflict) throw new AuthError(401, "the key or person asking was revoked or erased meanwhile; no key was made");
    throw e;
  }
  return { id, key: `pck_${id}_${secret}`, expires_at };
}

/** A key made outside a request (a new company's first owner key): no caller to guard, no parent. */
export async function firstApiKey(db: TenantDb, a: { name: string; scopes: Scope[]; createdBy: string; createdByUser: string | null; expiresInDays?: number; now: Date }): Promise<{ id: string; key: string; expires_at: string }> {
  if (!a.scopes.length || a.scopes.some((s) => !SCOPES.includes(s))) throw new AuthError(403, `scopes must be some of ${SCOPES.join(", ")}`);
  const id = `k${randomToken(9)}`.replace(/[^A-Za-z0-9]/g, "x");
  const secret = randomToken(32);
  const expires_at = new Date(a.now.getTime() + (a.expiresInDays ?? KEY_DEFAULT_DAYS) * 86_400_000).toISOString();
  await db.apply([db.insert("api_keys", {
    id, name: a.name.slice(0, 80), scopes: a.scopes.join(" "), secret_sha256: await sha256Hex(secret), created_by: a.createdBy, created_by_user: a.createdByUser,
    created_at: a.now.toISOString(), expires_at,
  })]);
  return { id, key: `pck_${id}_${secret}`, expires_at };
}

/** The keys a key made, and the keys those made, down the chain (for a revoke). */
export async function descendantKeys(db: TenantDb, id: string): Promise<string[]> {
  const out: string[] = [];
  let level = [id];
  for (let depth = 0; depth < 32 && level.length; depth++) {
    const next = (await db.select<{ id: string }>("api_keys", { parent_key: { in: level } })).map((r) => r.id).filter((x) => !out.includes(x) && x !== id);
    out.push(...next);
    level = next;
  }
  return out;
}

/** The key id a token names, when it has the shape of a Purser API key (to count failures per key). */
export function keyIdOf(token: string | undefined): string | null {
  return /^pck_(k[A-Za-z0-9]{12})_/.exec(token ?? "")?.[1] ?? null;
}

async function fromApiKey(sql: Sql, token: string, now: Date): Promise<Caller> {
  const m = /^pck_(k[A-Za-z0-9]{12})_([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) throw new AuthError(401, "not a Purser API key");
  const row = await sql.first<{ tenant_id: string; scopes: string; secret_sha256: string; revoked_at: string | null; expires_at: string | null; created_by_user: string | null; parent_key: string | null }>(
    "SELECT tenant_id, scopes, secret_sha256, revoked_at, expires_at, created_by_user, parent_key FROM api_keys WHERE id = ?", [m[1]!]);
  const digest = await sha256Hex(m[2]!);
  if (!row || !sameString(row.secret_sha256, digest)) throw new AuthError(401, "unknown API key");
  if (row.revoked_at) throw new AuthError(401, "this API key was revoked");
  if (!row.expires_at || row.expires_at <= now.toISOString()) throw new AuthError(401, "this API key expired; make a new one");
  // The person behind it erased, or a key up its chain revoked or expired: it is dead too (red team round 4).
  if (row.created_by_user) {
    const u = await sql.first<{ erased_at: string | null }>("SELECT erased_at FROM users WHERE tenant_id = ? AND id = ?", [row.tenant_id, row.created_by_user]);
    if (!u || u.erased_at) throw new AuthError(401, "the person behind this API key was erased; it no longer works");
  }
  let parent = row.parent_key;
  for (let depth = 0; parent && depth < 32; depth++) {
    const p = await sql.first<{ revoked_at: string | null; expires_at: string | null; parent_key: string | null }>("SELECT revoked_at, expires_at, parent_key FROM api_keys WHERE tenant_id = ? AND id = ?", [row.tenant_id, parent]);
    if (!p || p.revoked_at || !p.expires_at || p.expires_at <= now.toISOString()) throw new AuthError(401, "the key that made this API key was revoked or expired; it no longer works");
    parent = p.parent_key;
  }
  const tenant = await sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [row.tenant_id]);
  if (!tenant || tenant.closed_at) throw new AuthError(401, "this company's account is closed");
  await sql.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [now.toISOString(), m[1]!]);
  return { tenantId: row.tenant_id, kind: "key", principal: m[1]!, scopes: new Set(row.scopes.split(" ") as Scope[]), user: row.created_by_user };
}

const scopesOf = (role: Role): Set<Scope> => new Set<Scope>(role === "owner" ? ["read", "admin"] : ["read"]);

export async function sessionToken(secret: string, s: { tenantId: string; userId: string; role: Role; gen: number }, now: Date): Promise<string> {
  const body = toB64u(new TextEncoder().encode(JSON.stringify({ t: s.tenantId, u: s.userId, r: s.role, g: s.gen, exp: now.getTime() + SESSION_TTL_MS })));
  return `pcs.${body}.${await hmacB64u(secret, body)}`;
}

async function fromSession(sql: Sql, secret: string, token: string, now: Date): Promise<Caller> {
  const [, body, sig] = token.split(".");
  if (!body || !sig || !(await hmacValid(secret, body, sig))) throw new AuthError(401, "bad session");
  let p: { t: string; u: string; r: Role; g: number; exp: number };
  try {
    p = JSON.parse(new TextDecoder().decode(fromB64(body))) as typeof p;
  } catch {
    throw new AuthError(401, "bad session");
  }
  if (typeof p.exp !== "number" || p.exp <= now.getTime()) throw new AuthError(401, "the session expired; sign in again");
  // A person erased, given another role or signed out since the token was issued, or a closed company: access ends at once.
  const user = await sql.first<{ role: Role; erased_at: string | null; session_gen: number; closed_at: string | null }>(
    "SELECT u.role, u.erased_at, u.session_gen, t.closed_at FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.tenant_id = ? AND u.id = ?", [p.t, p.u]);
  if (!user || user.erased_at || user.closed_at || user.role !== p.r || user.session_gen !== p.g) throw new AuthError(401, "this sign-in is no longer valid");
  return { tenantId: p.t, kind: "session", principal: p.u, scopes: scopesOf(p.r), role: p.r, user: p.u };
}

/** Ends every session of one person (sign-out; erasure and closing a company end them too, see privacy.ts). */
export async function endSessions(sql: Sql, tenantId: string, userId: string): Promise<void> {
  await sql.run("UPDATE users SET session_gen = session_gen + 1 WHERE tenant_id = ? AND id = ?", [tenantId, userId]);
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

// Passkey sign-in: a one-time challenge, then the assertion checked in the Worker against a credential the person
// enrolled in the cloud (its public key, x and y).
export async function newChallenge(sql: Sql, tenantId: string, now: Date): Promise<{ challenge_id: string; challenge: string }> {
  const id = `c${randomToken(12)}`;
  const challenge = randomToken(32);
  // Expired challenges go at once, and a company has a bounded number open (red team round 4: every unauthenticated
  // call added a row until the daily housekeeping; from many addresses that was unbounded).
  await sql.run("DELETE FROM challenges WHERE tenant_id = ? AND expires_at <= ?", [tenantId, now.toISOString()]);
  const open = (await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM challenges WHERE tenant_id = ? AND used_at IS NULL", [tenantId]))?.n ?? 0;
  if (open >= MAX_OPEN_CHALLENGES) throw new AuthError(429, "too many sign-ins are open for this company; try again in a few minutes");
  await sql.run("INSERT INTO challenges (id, tenant_id, challenge, expires_at) VALUES (?, ?, ?, ?)", [id, tenantId, challenge, new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString()]);
  return { challenge_id: id, challenge };
}

export async function passkeyLogin(sql: Sql, a: { tenantId: string; challengeId: string; credentialId: string; assertion: AssertionB64; rpId: string; origin: string; secret: string; now: Date }): Promise<{ token: string; role: Role; user_id: string }> {
  // Used once, whatever the outcome, and taken atomically: the same assertion sent several times at once gets one
  // session (the update succeeds for one request only); a failed attempt cannot be retried with the same challenge.
  const iso = a.now.toISOString();
  const taken = await sql.run("UPDATE challenges SET used_at = ? WHERE id = ? AND tenant_id = ? AND used_at IS NULL AND expires_at > ?", [iso, a.challengeId, a.tenantId, iso]);
  if (taken.changes !== 1) throw new AuthError(401, "the sign-in challenge is unknown, used or expired");
  const ch = (await sql.first<{ challenge: string }>("SELECT challenge FROM challenges WHERE id = ? AND tenant_id = ?", [a.challengeId, a.tenantId]))!;
  const db = new TenantDb(sql, a.tenantId);
  const cred = await db.one<{ user_id: string; x: string; y: string; counter: number }>("credentials", { credential_id: a.credentialId });
  if (!cred) throw new AuthError(401, "unknown passkey");
  const v = await verifyAssertion(a.assertion, { x: cred.x, y: cred.y }, { challenge: ch.challenge, origin: a.origin, rpId: a.rpId, lastCounter: cred.counter });
  if (!v.ok) throw new AuthError(401, `the passkey sign-in failed (${v.why})`);
  const user = await db.one<{ role: Role; erased_at: string | null; session_gen: number }>("users", { id: cred.user_id });
  if (!user || user.erased_at) throw new AuthError(401, "this person has no access");
  // The counter only moves forward: of two sign-ins at once, the one with the lower counter cannot set it back.
  await db.apply([db.update("credentials", { credential_id: a.credentialId, counter: { op: "<=", v: v.counter } }, { counter: v.counter })]);
  return { token: await sessionToken(a.secret, { tenantId: a.tenantId, userId: cred.user_id, role: user.role, gen: user.session_gen }, a.now), role: user.role, user_id: cred.user_id };
}

// Passkey enrolment in the cloud (security review of 8 November: a credential pushed with a sync key let it sign in as
// the owner). An owner starts it for one person; the person proves the new passkey by signing the enrolment's secret
// with it. A sync push can no longer bring a credential at all.

/** Starts one person's enrolment: its secret is returned once; single use, 30 minutes. */
export async function startEnrolment(db: TenantDb, caller: Caller, userId: string, now: Date): Promise<{ enrolment_id: string; token: string; expires_at: string }> {
  const person = await db.one<{ role: Role; erased_at: string | null }>("users", { id: userId });
  if (!person || person.erased_at) throw new AuthError(403, `no person ${userId} in this company`);
  if (person.role === "owner") {
    // An owner's passkey can do everything: once any owner has one, only a signed-in owner may start another. Before
    // that (a new company) the first owner's key may, or the company could never get its first passkey.
    const owners = (await db.select<{ id: string }>("users", { role: "owner", erased_at: null })).map((u) => u.id);
    const ownerPasskeys = await db.count("credentials", { user_id: { in: owners } });
    if (ownerPasskeys > 0 && !(caller.kind === "session" && caller.role === "owner")) throw new AuthError(403, "only a signed-in owner may enrol an owner's passkey");
  }
  const id = `n${randomToken(9)}`.replace(/[^A-Za-z0-9]/g, "x");
  const token = randomToken(32);
  const iso = now.toISOString();
  const expires_at = new Date(now.getTime() + ENROLMENT_TTL_MS).toISOString();
  // Checked again when it commits (red team round 4: counted before an owner's erasure committed, a key got an owner
  // enrolment): the caller is still live, and for an owner's passkey asked by anyone but a signed-in owner, still no
  // owner has one.
  const ownerByOther = person.role === "owner" && !(caller.kind === "session" && caller.role === "owner");
  try {
    await db.apply([db.callerGuard(caller, iso), ...(ownerByOther ? [db.noOwnerPasskeyGuard(iso)] : []),
      db.insert("enrolments", { id, user_id: userId, token_sha256: await sha256Hex(token), created_by: caller.principal, created_at: iso, expires_at })]);
  } catch (e) {
    if (e instanceof WriteConflict) throw new AuthError(403, "the caller was revoked meanwhile, or an owner now has a passkey: only a signed-in owner may enrol an owner's passkey");
    throw e;
  }
  return { enrolment_id: id, token, expires_at };
}

/** Finishes an enrolment: the secret matches, it is unused and unexpired, and the new passkey signed the secret. */
export async function enrolPasskey(sql: Sql, a: { tenantId: string; enrolmentId: string; token: string; credentialId: string; x: string; y: string; assertion: AssertionB64; rpId: string; origin: string; now: Date }): Promise<{ user_id: string; credential_id: string }> {
  const db = new TenantDb(sql, a.tenantId);
  const e = await db.one<{ user_id: string; token_sha256: string }>("enrolments", { id: a.enrolmentId });
  if (!e || !sameString(e.token_sha256, await sha256Hex(a.token))) throw new AuthError(401, "the enrolment is unknown, used or expired");
  const iso = a.now.toISOString();
  // Taken once, atomically, whatever happens next.
  const taken = await sql.run("UPDATE enrolments SET used_at = ? WHERE tenant_id = ? AND id = ? AND used_at IS NULL AND expires_at > ?", [iso, a.tenantId, a.enrolmentId, iso]);
  if (taken.changes !== 1) throw new AuthError(401, "the enrolment is unknown, used or expired");
  const v = await verifyAssertion(a.assertion, { x: a.x, y: a.y }, { challenge: a.token, origin: a.origin, rpId: a.rpId, lastCounter: 0 });
  if (!v.ok) throw new AuthError(401, `the new passkey's signature does not check (${v.why})`);
  const person = await db.one<{ erased_at: string | null }>("users", { id: e.user_id });
  if (!person || person.erased_at) throw new AuthError(401, "this person has no access");
  if (await db.one("credentials", { credential_id: a.credentialId })) throw new AuthError(401, "this passkey is already enrolled");
  await db.apply([db.insert("credentials", { credential_id: a.credentialId, user_id: e.user_id, x: a.x, y: a.y, counter: v.counter, created_at: iso })]);
  return { user_id: e.user_id, credential_id: a.credentialId };
}

/** Failed authentications from one address in the current minute: at the limit, requests are turned away before any lookup. */
export async function failedAuthBlocked(sql: Sql, ip: string, now: Date, max: number): Promise<boolean> {
  const win = Math.floor(now.getTime() / 60_000) * 60;
  const row = await sql.first<{ count: number }>("SELECT count FROM rate_hits WHERE bucket = ? AND window_start = ?", [`authfail:${ip}`, win]);
  return (row?.count ?? 0) >= max;
}

export async function noteFailedAuth(sql: Sql, ip: string, keyId: string | null, now: Date): Promise<void> {
  const win = Math.floor(now.getTime() / 60_000) * 60;
  for (const b of [`authfail:${ip}`, ...(keyId ? [`authfail-key:${keyId}`] : [])]) await bump(sql, b, win, 1);
}

/** A counter in a fixed window that grows by `amount` (the mail quota counts bytes); returns the new count. */
export async function bump(sql: Sql, bucket: string, windowStart: number, amount: number): Promise<number> {
  await sql.run("INSERT INTO rate_hits (bucket, window_start, count) VALUES (?, ?, ?) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + ?", [bucket, windowStart, amount, amount]);
  return (await sql.first<{ count: number }>("SELECT count FROM rate_hits WHERE bucket = ? AND window_start = ?", [bucket, windowStart]))?.count ?? 0;
}

/** A fixed window per key or session: true when the call is within the limit. */
export async function withinRate(sql: Sql, bucket: string, now: Date, limit: { windowSec: number; max: number }): Promise<boolean> {
  const win = Math.floor(now.getTime() / 1000 / limit.windowSec) * limit.windowSec;
  return (await bump(sql, bucket, win, 1)) <= limit.max;
}
