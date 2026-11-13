// Who is calling, and what they may do. Systems use API keys (shown once, stored as a SHA-256 hash, scoped,
// revocable, expiring); people sign in with a passkey and get a short session token. The platform admin token (a Worker
// secret) only creates tenants. Every check fails closed.

import { verifyAssertion, type AssertionB64 } from "../../worker/src/webauthn.js";
import { hmacB64u, randomToken, sameString, sha256Hex, signedPayload, toB64u } from "./crypto.js";
import type { Sql } from "./store.js";
import { TenantDb, WriteConflict, type Stmt } from "./tenant.js";

export type Scope = "read" | "sync" | "admin";
/**
 * A Claude connector token (cloud/src/claude/): an API key with the read scope that works at /mcp only. 'claude' reads;
 * 'claude-propose' also files an invoice's payment for the CFO's approval, which only the CFO's passkey (Face ID) can
 * give. 'claude-demo' is the demo company's public token (no key row).
 */
export type ConnectorPurpose = "claude" | "claude-propose";
export const isConnector = (purpose: string | null | undefined): boolean => purpose === "claude" || purpose === "claude-propose" || purpose === "claude-demo";
/** The demo company's connector token: public on purpose (read only, made-up data); kept apart from guest.ts so auth needs no seed. */
export const DEMO_CONNECTOR_TOKEN = "purser-demo-read-only";
export const DEMO_CONNECTOR_TENANT = "t_demo_company";
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
  /** 'first-owner': a new company's starter key, good only for the first owner's passkey (red team round 5). */
  purpose?: string | null;
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
/** A new company's starter key: a week, and only until the first owner's passkey exists (red team round 5). */
export const STARTER_KEY_DAYS = 7;
/** An owner recovery key: one day, one enrolment of the owner it names. */
export const RECOVERY_KEY_DAYS = 1;
export const KEY_MAX_DAYS = 365;

/**
 * A new API key: its full text is returned once; only the hash of its secret is stored. A key made by a key never has
 * more scope or a later expiry than the key that made it, and is revoked with it (red team round 4: a one-day admin-only
 * key made a year-long read+sync+admin key that outlived its revoke). The insert commits only while the caller is still
 * live (a key minted while its person was being erased outlived the erasure).
 */
export async function newApiKey(db: TenantDb, a: { name: string; scopes: Scope[]; caller: Caller; expiresInDays?: number; purpose?: ConnectorPurpose; now: Date }): Promise<{ id: string; key: string; expires_at: string }> {
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
      parent_key: parent, purpose: a.purpose ?? null, created_at: iso, expires_at,
    })]);
  } catch (e) {
    if (e instanceof WriteConflict) throw new AuthError(401, "the key or person asking was revoked or erased meanwhile; no key was made");
    throw e;
  }
  return { id, key: `pck_${id}_${secret}`, expires_at };
}

/** A key made outside a request (a new company's first owner key): no caller to guard, no parent. */
export async function firstApiKey(db: TenantDb, a: { name: string; scopes: Scope[]; createdBy: string; createdByUser: string | null; expiresInDays?: number; purpose?: "first-owner" | "recovery"; before?: Stmt[]; after?: Stmt[]; now: Date }): Promise<{ id: string; key: string; expires_at: string }> {
  if (!a.scopes.length || a.scopes.some((s) => !SCOPES.includes(s))) throw new AuthError(403, `scopes must be some of ${SCOPES.join(", ")}`);
  const id = `k${randomToken(9)}`.replace(/[^A-Za-z0-9]/g, "x");
  const secret = randomToken(32);
  const expires_at = new Date(a.now.getTime() + (a.expiresInDays ?? KEY_DEFAULT_DAYS) * 86_400_000).toISOString();
  await db.apply([...(a.before ?? []), db.insert("api_keys", {
    id, name: a.name.slice(0, 80), scopes: a.scopes.join(" "), secret_sha256: await sha256Hex(secret), created_by: a.createdBy, created_by_user: a.createdByUser,
    purpose: a.purpose ?? null, created_at: a.now.toISOString(), expires_at,
  }), ...(a.after ?? [])]);
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
  return liveKey(sql, m[1]!, m[2]!, now);
}

/**
 * A key by its id, with every check a key's use goes through (revoked, expired, its person erased, a key up its chain
 * dead, the company closed). With a secret, the secret must hash to the stored hash; without one (null), the caller
 * already proved the key some other way: an access token Purser signed for this key after its owner pasted it on the
 * consent page (cloud/src/claude/oauth.ts). Either way a revoke ends it at once.
 */
export async function liveKey(sql: Sql, keyId: string, secret: string | null, now: Date): Promise<Caller> {
  const row = await sql.first<{ tenant_id: string; scopes: string; secret_sha256: string; revoked_at: string | null; expires_at: string | null; created_by_user: string | null; parent_key: string | null; purpose: string | null }>(
    "SELECT tenant_id, scopes, secret_sha256, revoked_at, expires_at, created_by_user, parent_key, purpose FROM api_keys WHERE id = ?", [keyId]);
  if (!row) throw new AuthError(401, "unknown API key");
  if (secret !== null && !sameString(row.secret_sha256, await sha256Hex(secret))) throw new AuthError(401, "unknown API key");
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
  await sql.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [now.toISOString(), keyId]);
  return { tenantId: row.tenant_id, kind: "key", principal: keyId, scopes: new Set(row.scopes.split(" ") as Scope[]), user: row.created_by_user, purpose: row.purpose };
}

const scopesOf = (role: Role): Set<Scope> => new Set<Scope>(role === "owner" ? ["read", "admin"] : ["read"]);

export async function sessionToken(secret: string, s: { tenantId: string; userId: string; role: Role; gen: number }, now: Date): Promise<string> {
  const body = toB64u(new TextEncoder().encode(JSON.stringify({ t: s.tenantId, u: s.userId, r: s.role, g: s.gen, exp: now.getTime() + SESSION_TTL_MS })));
  return `pcs.${body}.${await hmacB64u(secret, body)}`;
}

async function fromSession(sql: Sql, secret: string, token: string, now: Date): Promise<Caller> {
  const p = await signedPayload(secret, "pcs", token, Infinity) as { t: string; u: string; r: Role; g: number; exp: number } | null;
  if (!p) throw new AuthError(401, "bad session");
  if (typeof p.exp !== "number" || p.exp <= now.getTime()) throw new AuthError(401, "the session expired; sign in again");
  // A person erased, given another role or signed out since the token was issued, or a closed company: access ends at once.
  const user = await sql.first<{ role: Role; erased_at: string | null; session_gen: number; closed_at: string | null }>(
    "SELECT u.role, u.erased_at, u.session_gen, t.closed_at FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.tenant_id = ? AND u.id = ?", [p.t, p.u]);
  if (!user || user.erased_at || user.closed_at || user.role !== p.r || user.session_gen !== p.g) throw new AuthError(401, "this sign-in is no longer valid");
  return { tenantId: p.t, kind: "session", principal: p.u, scopes: scopesOf(p.r), role: p.r, user: p.u };
}

/** How long an access token Purser signs for a connector key lasts (never past the key's own expiry). */
export const ACCESS_TOKEN_TTL_MS = 30 * 86_400_000;

/**
 * An OAuth access token for a Claude connector key (cloud/src/claude/oauth.ts): signed by Purser, naming the key and
 * the client it was issued to, never holding the key's secret. Every use checks the key as a key's own use does, so
 * revoking the key in Purser Cloud ends the token at once.
 */
export async function accessToken(secret: string, a: { keyId: string; clientId: string; expiresAt: number }): Promise<string> {
  const body = toB64u(new TextEncoder().encode(JSON.stringify({ k: a.keyId, c: a.clientId, exp: a.expiresAt })));
  return `pca.${body}.${await hmacB64u(`access:${secret}`, body)}`;
}

async function fromAccessToken(sql: Sql, secret: string, token: string, now: Date): Promise<Caller> {
  const p = await signedPayload(`access:${secret}`, "pca", token, Infinity) as { k: string; c: string; exp: number } | null;
  if (!p) throw new AuthError(401, "bad access token");
  if (typeof p.exp !== "number" || p.exp <= now.getTime() || typeof p.k !== "string") throw new AuthError(401, "the access token expired; connect again");
  const c = await liveKey(sql, p.k, null, now);
  if (!isConnector(c.purpose)) throw new AuthError(401, "bad access token");
  return c;
}

/** Ends every session of one person (sign-out; erasure and closing a company end them too, see privacy.ts). */
export async function endSessions(sql: Sql, tenantId: string, userId: string): Promise<void> {
  await sql.run("UPDATE users SET session_gen = session_gen + 1 WHERE tenant_id = ? AND id = ?", [tenantId, userId]);
}

export async function callerOf(sql: Sql, sessionSecret: string, authorization: string | null, now: Date): Promise<Caller> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!token) throw new AuthError(401, "sign in, or send an API key as Authorization: Bearer");
  if (token.startsWith("pck_")) return fromApiKey(sql, token, now);
  if (token.startsWith("pcs.")) return fromSession(sql, sessionSecret, token, now);
  if (token.startsWith("pca.")) return fromAccessToken(sql, sessionSecret, token, now);
  // The demo company's public connector token: read only, demo data, the same for everyone (docs/connect-claude.md).
  if (token === DEMO_CONNECTOR_TOKEN) return { tenantId: DEMO_CONNECTOR_TENANT, kind: "key", principal: "demo-connector", scopes: new Set<Scope>(["read"]), user: null, purpose: "claude-demo" };
  throw new AuthError(401, "unknown token type");
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
/**
 * A challenge's purpose is in its id (final review S6): "c…" signs in, "u…" steps up an existing session. Each is taken
 * only by its own ceremony, so a sign-in challenge never serves as a step-up, nor the other way round.
 */
export async function newChallenge(sql: Sql, tenantId: string, now: Date, purpose: "sign-in" | "step-up" = "sign-in"): Promise<{ challenge_id: string; challenge: string }> {
  const id = `${purpose === "step-up" ? "u" : "c"}${randomToken(12)}`;
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
  if (!a.challengeId.startsWith("c")) throw new AuthError(401, "the sign-in challenge is unknown, used or expired");
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
  // A recovery key (an owner who lost their passkey; the platform issued it after checking who asks) enrols that owner
  // and nobody else, even though the company's owners already have passkeys.
  const recovery = caller.kind === "key" && caller.purpose === "recovery";
  if (recovery && (person.role !== "owner" || caller.user !== userId)) throw new AuthError(403, "a recovery key enrols only the owner it was issued for");
  if (person.role === "owner" && !recovery) {
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
  const byOwner = caller.kind === "session" && caller.role === "owner";
  const ownerByOther = person.role === "owner" && !byOwner && !recovery;
  try {
    // A new enrolment for a person cancels their unused ones (red team round 5: a re-invite left the first link working).
    await db.apply([db.callerGuard(caller, iso), ...(ownerByOther ? [db.noOwnerPasskeyGuard(iso)] : []),
      db.update("enrolments", { user_id: userId, used_at: null, cancelled_at: null }, { cancelled_at: iso }),
      db.insert("enrolments", { id, user_id: userId, token_sha256: await sha256Hex(token), created_by: caller.principal, created_by_kind: caller.kind,
        created_by_user: caller.user, by_owner: byOwner ? 1 : 0, recovery: recovery ? 1 : 0, created_at: iso, expires_at })]);
  } catch (e) {
    if (e instanceof WriteConflict) throw new AuthError(403, "the caller was revoked meanwhile, or an owner now has a passkey: only a signed-in owner may enrol an owner's passkey");
    throw e;
  }
  return { enrolment_id: id, token, expires_at };
}

/** Finishes an enrolment: the secret matches, it is unused and unexpired, and the new passkey signed the secret. */
export async function enrolPasskey(sql: Sql, a: { tenantId: string; enrolmentId: string; token: string; credentialId: string; x: string; y: string; assertion: AssertionB64; rpId: string; origin: string; now: Date }): Promise<{ user_id: string; credential_id: string; recovery?: true }> {
  const db = new TenantDb(sql, a.tenantId);
  const e = await db.one<{ user_id: string; token_sha256: string; created_by: string; created_by_kind: "key" | "session"; by_owner: number; recovery: number }>("enrolments", { id: a.enrolmentId });
  if (!e || !sameString(e.token_sha256, await sha256Hex(a.token))) throw new AuthError(401, "the enrolment is unknown, used or expired");
  const iso = a.now.toISOString();
  // Taken once, atomically, whatever happens next; a cancelled one (a newer invite, its starter revoked or erased) never.
  const taken = await sql.run("UPDATE enrolments SET used_at = ? WHERE tenant_id = ? AND id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?", [iso, a.tenantId, a.enrolmentId, iso]);
  if (taken.changes !== 1) throw new AuthError(401, "the enrolment is unknown, used or expired");
  const v = await verifyAssertion(a.assertion, { x: a.x, y: a.y }, { challenge: a.token, origin: a.origin, rpId: a.rpId, lastCounter: 0 });
  if (!v.ok) throw new AuthError(401, `the new passkey's signature does not check (${v.why})`);
  const person = await db.one<{ erased_at: string | null; role: Role; session_gen: number }>("users", { id: e.user_id });
  if (!person || person.erased_at) throw new AuthError(401, "this person has no access");
  if (await db.one("credentials", { credential_id: a.credentialId })) throw new AuthError(401, "this passkey is already enrolled");
  // Checked again when the passkey is written (red team round 5: an owner enrolment the starter key started was still
  // good after the first owner's passkey existed and the starter key was revoked): whoever started it is still live
  // (the key not revoked or expired, the signed-in person not erased); and an owner's passkey that no signed-in owner
  // started still needs no owner to have one. The first owner's passkey revokes the starter key in the same write.
  const owner = person.role === "owner";
  // An owner recovery: in the same write as the new passkey, the owner's other passkeys go, their sessions end and the
  // recovery key is spent. Until this commits nothing of the old access changes (a recovery never finished does nothing).
  const recovery = owner && e.recovery === 1 && e.created_by_kind === "key";
  // What changed in the company's access lately, for the owners to check after a recovery (red team 6: a thief of the
  // passkey could add an owner, a key or a webhook before the recovery; the recovery event names them all).
  const recent = recovery ? await recentAccessChanges(db, a.now) : null;
  try {
    await db.apply([db.callerGuard({ kind: e.created_by_kind, principal: e.created_by }, iso),
      ...(owner && !e.by_owner && !recovery ? [db.noOwnerPasskeyGuard(iso)] : []),
      db.insert("credentials", { credential_id: a.credentialId, user_id: e.user_id, x: a.x, y: a.y, counter: v.counter, created_at: iso }),
      ...(owner ? [db.update("api_keys", { purpose: "first-owner", revoked_at: null }, { revoked_at: iso })] : []),
      ...(recovery ? [
        db.delete("credentials", { user_id: e.user_id, credential_id: { op: "<>", v: a.credentialId } }),
        // Incremented in SQL at commit (red team 6: a session signed in between the read and this write survived a set).
        { sql: "UPDATE users SET session_gen = session_gen + 1 WHERE tenant_id = ? AND id = ?", params: [a.tenantId, e.user_id] },
        db.update("api_keys", { id: e.created_by }, { revoked_at: iso }),
        // Whoever held the lost passkey could make keys as this owner: every key behind the owner goes, with the keys
        // those keys made (they carry the same person), and every invite the owner or those keys started.
        db.update("api_keys", { created_by_user: e.user_id, revoked_at: null }, { revoked_at: iso }),
        db.update("api_keys", { created_by: e.user_id, revoked_at: null }, { revoked_at: iso }),
        db.update("enrolments", { created_by_user: e.user_id, used_at: null, cancelled_at: null }, { cancelled_at: iso }),
        db.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: iso, kind: "recovery.completed", actor: e.user_id,
          detail_json: JSON.stringify({ owner: e.user_id, recovery_key: e.created_by, new_passkey: a.credentialId.slice(0, 12),
            ended: "the owner's other passkeys and sessions, every key behind the owner (and the keys those made), and every open invite the owner or those keys started",
            check_these: recent }) }),
      ] : [])]);
  } catch (err) {
    if (err instanceof WriteConflict) throw new AuthError(401, "this enrolment no longer holds: whoever started it lost access, or an owner already has a passkey; ask an owner for a new invite");
    throw err;
  }
  return { user_id: e.user_id, credential_id: a.credentialId, ...(recovery ? { recovery: true as const } : {}) };
}

/** How far back a recovery lists the company's access changes. */
const RECENT_CHANGES_DAYS = 30;

/**
 * The company's access changes of the last 30 days, for the recovery event: owners added, owner passkeys enrolled,
 * keys made (live or not) and webhooks set. Names and ids only; never a secret, never a whole webhook address.
 */
async function recentAccessChanges(db: TenantDb, now: Date): Promise<Record<string, unknown>> {
  const since = new Date(now.getTime() - RECENT_CHANGES_DAYS * 86_400_000).toISOString();
  const owners = await db.select<{ id: string; display_name: string; created_at: string; erased_at: string | null }>("users", { role: "owner", created_at: { op: ">=", v: since } });
  const ownerIds = (await db.select<{ id: string }>("users", { role: "owner" })).map((u) => u.id);
  const passkeys = await db.select<{ user_id: string; created_at: string }>("credentials", { user_id: { in: ownerIds }, created_at: { op: ">=", v: since } });
  const keys = await db.select<{ id: string; name: string; scopes: string; created_by: string; created_by_user: string | null; created_at: string; revoked_at: string | null; purpose: string | null }>("api_keys", { created_at: { op: ">=", v: since } });
  const hooks = await db.select<{ url: string; created_at: string; created_by: string; disabled_at: string | null }>("webhooks", { created_at: { op: ">=", v: since } });
  const host = (u: string) => { try { return new URL(u).host; } catch { return "?"; } };
  return {
    since,
    owners_added: owners.map((o) => ({ id: o.id, name: o.erased_at ? "[erased]" : o.display_name.slice(0, 80), at: o.created_at })),
    owner_passkeys_added: passkeys.map((p) => ({ owner: p.user_id, at: p.created_at })),
    keys_made: keys.filter((k) => k.purpose !== "recovery").map((k) => ({ id: k.id, name: k.name.slice(0, 80), scopes: k.scopes, by: k.created_by, at: k.created_at, revoked: !!k.revoked_at })),
    webhooks_set: hooks.map((h) => ({ host: host(h.url), by: h.created_by, at: h.created_at, off: !!h.disabled_at })),
  };
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
  // One statement that counts and reads back its own count (D1 conformance run, 9 Nov: an upsert and then a separate
  // SELECT let sixty concurrent deliveries all read the final total, so every one of them was refused).
  return (await sql.first<{ count: number }>("INSERT INTO rate_hits (bucket, window_start, count) VALUES (?, ?, ?) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + ? RETURNING count", [bucket, windowStart, amount, amount]))?.count ?? 0;
}

/** A fixed window per key or session: true when the call is within the limit. */
export async function withinRate(sql: Sql, bucket: string, now: Date, limit: { windowSec: number; max: number }): Promise<boolean> {
  const win = Math.floor(now.getTime() / 1000 / limit.windowSec) * limit.windowSec;
  return (await bump(sql, bucket, win, 1)) <= limit.max;
}

/** What an invite's secret is for, without signing in: the company and the person (red team round 5: the link named its
 * company in plain text, so a link could claim any company). Unknown, used, cancelled or expired: 401. */
export async function inviteInfo(sql: Sql, a: { enrolmentId: string; token: string; now: Date }): Promise<{ tenant: string; company: string; person: string; expires_at: string }> {
  const e = await sql.first<{ tenant_id: string; user_id: string; token_sha256: string; used_at: string | null; cancelled_at: string | null; expires_at: string }>(
    "SELECT tenant_id, user_id, token_sha256, used_at, cancelled_at, expires_at FROM enrolments WHERE id = ?", [a.enrolmentId]);
  if (!e || !sameString(e.token_sha256, await sha256Hex(a.token)) || e.used_at || e.cancelled_at || e.expires_at <= a.now.toISOString()) throw new AuthError(401, "this invite is unknown, used, replaced or expired; ask an owner for a new one");
  const t = await sql.first<{ slug: string; name: string; closed_at: string | null }>("SELECT slug, name, closed_at FROM tenants WHERE id = ?", [e.tenant_id]);
  const u = await sql.first<{ display_name: string; erased_at: string | null }>("SELECT display_name, erased_at FROM users WHERE tenant_id = ? AND id = ?", [e.tenant_id, e.user_id]);
  if (!t || t.closed_at || !u || u.erased_at) throw new AuthError(401, "this invite is unknown, used, replaced or expired; ask an owner for a new one");
  return { tenant: t.slug, company: t.name, person: u.display_name, expires_at: e.expires_at };
}
