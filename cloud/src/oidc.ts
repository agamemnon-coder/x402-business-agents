// Sign in with Google, Microsoft or Apple (OpenID Connect) for Purser Cloud, per person and per company (20 Nov).
//
// A person LINKS their own identity to their own membership while signed in with their passkey (a fresh passkey check),
// and may unlink it. After that they can sign in to that company with it. Such a sign-in is READ ONLY: it never gives
// owner rights, never replaces the passkey, and approving money still takes the CFO's passkey over the exact terms (and
// step-up where it applies). A link is the provider's issuer and subject (its stable id for the person), never an e-mail
// match: an address someone controls elsewhere signs no one in.
//
// The flow is the authorization code flow with state and nonce, and PKCE (S256) where the provider documents it (Google,
// Microsoft; Apple documents no PKCE for its REST flow, so its code is bound by state, nonce and its client secret). The
// state is good once, for ten minutes, and only in the browser that started it (the hash of a browser secret the console
// keeps in its tab). The ID token is checked here: RS256 only, the signature against the provider's JWKS (fetched on
// first use and cached, never at module load), the issuer, the audience, the expiry, the issue time and the nonce.
//
// Providers, from their documentation (read 20 Nov 2026):
//   Google     accounts.google.com/o/oauth2/v2/auth, oauth2.googleapis.com/token, www.googleapis.com/oauth2/v3/certs,
//              issuer https://accounts.google.com (or accounts.google.com).
//   Microsoft  login.microsoftonline.com/{tenant}/oauth2/v2.0/{authorize,token}, …/discovery/v2.0/keys; tenant "common",
//              "organizations" or a directory id; the issuer is https://login.microsoftonline.com/{tid}/v2.0 for the
//              token's own tid (checked to be a directory id, and the configured one when one is configured).
//   Apple      appleid.apple.com/auth/{authorize,token,keys}, issuer https://appleid.apple.com; with a scope Apple answers
//              by form_post (a POST to the redirect URI); the client secret is an ES256 JWT Purser signs with the Sign
//              in with Apple key (a Worker secret), five minutes long, made for each token request.
// Off unless the cloud has a client for the provider (OIDC_GOOGLE_*, OIDC_MICROSOFT_*, OIDC_APPLE_*; cloud/src/worker.ts).

import { fromB64, randomToken, sha256Hex, toB64u } from "./crypto.js";
import { egressAllowed } from "./egress.js";
import { logEvent } from "./log.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";

export const IDPS = ["google", "microsoft", "apple"] as const;
export type IdpName = (typeof IDPS)[number];
export const isIdp = (s: string): s is IdpName => (IDPS as readonly string[]).includes(s);

export interface IdpClient {
  clientId: string;
  /** Google and Microsoft: the client secret. Apple: none (the secret is a JWT made from `apple`). */
  clientSecret?: string;
  /** Microsoft: "common" (default), "organizations" or a directory (tenant) id. */
  tenant?: string;
  /** Apple: the team id, the Sign in with Apple key's id and its private key (PKCS#8 PEM, from the .p8 file). */
  apple?: { teamId: string; keyId: string; privateKeyPem: string };
}

export interface OidcEnv {
  clients: Partial<Record<IdpName, IdpClient>>;
  /** How the cloud reaches the providers' token and JWKS endpoints (the Worker's fetch; a stand-in in tests). */
  fetch: typeof fetch;
}

export class OidcRefused extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 502, message: string) { super(message); }
}

const STATE_TTL_MS = 10 * 60_000;
const SKEW_MS = 60_000;
const MS_CONSUMERS = "9188040d-6c67-4c5b-b112-36a304b66dad";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Idp {
  authorize: string; token: string; jwks: string; scope: string; pkce: boolean; formPost: boolean;
  issuerOk(iss: string, claims: Record<string, unknown>): boolean;
}

export function idpOf(name: IdpName, c: IdpClient): Idp {
  if (name === "google") return {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", jwks: "https://www.googleapis.com/oauth2/v3/certs",
    scope: "openid email", pkce: true, formPost: false, issuerOk: (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com",
  };
  if (name === "microsoft") {
    const tenant = c.tenant || "common";
    if (tenant !== "common" && tenant !== "organizations" && !GUID.test(tenant)) throw new OidcRefused(404, "the Microsoft sign-in is set up with an unknown tenant");
    const base = `https://login.microsoftonline.com/${tenant}`;
    return {
      authorize: `${base}/oauth2/v2.0/authorize`, token: `${base}/oauth2/v2.0/token`, jwks: `${base}/discovery/v2.0/keys`,
      scope: "openid email profile", pkce: true, formPost: false,
      issuerOk: (iss, claims) => {
        const tid = typeof claims.tid === "string" ? claims.tid : "";
        if (!GUID.test(tid) || iss !== `https://login.microsoftonline.com/${tid}/v2.0`) return false;
        if (GUID.test(tenant)) return tid === tenant;
        return tenant === "organizations" ? tid !== MS_CONSUMERS : true;
      },
    };
  }
  return {
    authorize: "https://appleid.apple.com/auth/authorize", token: "https://appleid.apple.com/auth/token", jwks: "https://appleid.apple.com/auth/keys",
    scope: "email", pkce: false, formPost: true, issuerOk: (iss) => iss === "https://appleid.apple.com",
  };
}

/** The redirect URI each provider is registered with: one per provider, for linking and signing in alike. */
export const redirectUriOf = (origin: string, p: IdpName) => `${origin.replace(/\/$/, "")}/v1/auth/oidc/${p}/callback`;

function clientOf(env: OidcEnv | undefined, p: IdpName): IdpClient {
  const c = env?.clients[p];
  if (!c) throw new OidcRefused(404, `signing in with ${p} is not switched on in this cloud`);
  return c;
}

export const offered = (env: OidcEnv | undefined): IdpName[] => IDPS.filter((p) => Boolean(env?.clients[p]));

const b64uText = (s: string) => toB64u(new TextEncoder().encode(s));

/**
 * Starts a link (a signed-in person, for their own membership) or a sign-in (anyone, for a company). Answers the
 * provider's URL and the browser secret the console keeps in its tab until it finishes.
 */
export async function startOidc(sql: Sql, env: OidcEnv | undefined, a: { provider: IdpName; purpose: "link" | "sign-in"; tenantId: string; userId: string | null; origin: string; now: Date }): Promise<{ url: string; browser_secret: string; expires_at: string }> {
  const client = clientOf(env, a.provider);
  const idp = idpOf(a.provider, client);
  const state = randomToken(32), nonce = randomToken(24), browser = randomToken(32);
  const verifier = idp.pkce ? randomToken(32) : null;
  await sql.run("DELETE FROM oidc_states WHERE expires_at < ?", [a.now.getTime()]);
  // At most a few open starts per company: an unauthenticated sign-in start must not fill the table.
  const open = (await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM oidc_states WHERE tenant_id = ?", [a.tenantId]))?.n ?? 0;
  if (open >= 200) throw new OidcRefused(409, "too many sign-ins are open for this company; try again in a few minutes");
  await sql.run("INSERT INTO oidc_states (state_sha256, purpose, tenant_id, user_id, provider, nonce, verifier, browser_sha256, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [await sha256Hex(state), a.purpose, a.tenantId, a.userId, a.provider, nonce, verifier, await sha256Hex(browser), a.now.getTime() + STATE_TTL_MS]);
  const q = new URLSearchParams({ response_type: "code", client_id: client.clientId, redirect_uri: redirectUriOf(a.origin, a.provider), scope: idp.scope, state, nonce });
  if (verifier) { q.set("code_challenge", toB64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))); q.set("code_challenge_method", "S256"); }
  if (idp.formPost) q.set("response_mode", "form_post");
  if (a.provider === "google" || a.provider === "microsoft") q.set("prompt", "select_account");
  return { url: `${idp.authorize}?${q.toString()}`, browser_secret: browser, expires_at: new Date(a.now.getTime() + STATE_TTL_MS).toISOString() };
}

// --- The ID token -----------------------------------------------------------------------------------------------------

interface Jwk { kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string }
/** JWKS per URL, fetched on first use and kept an hour; refetched at most once a minute for a key id it does not hold. */
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();
export function forgetJwks(): void { jwksCache.clear(); }

async function keysOf(f: typeof fetch, url: string, kid: string, now: number): Promise<Jwk[]> {
  const held = jwksCache.get(url);
  if (held && now - held.at < 3_600_000 && (held.keys.some((k) => k.kid === kid) || now - held.at < 60_000)) return held.keys;
  let res: Response;
  // The providers' endpoints are fixed in this file; the allow rule holds them anyway (./egress.ts; ASVS V12.6.1).
  if (!egressAllowed(url)) throw new OidcRefused(502, "the provider's signing keys are at an address Purser does not call");
  try { res = await f(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) }); } catch { throw new OidcRefused(502, "the provider's signing keys could not be read; try again"); }
  if (!res.ok) throw new OidcRefused(502, "the provider's signing keys could not be read; try again");
  const j = (await res.json().catch(() => ({}))) as { keys?: unknown };
  const keys = Array.isArray(j.keys) ? (j.keys as Jwk[]).filter((k) => k && k.kty === "RSA" && typeof k.n === "string" && typeof k.e === "string").slice(0, 50) : [];
  jwksCache.set(url, { keys, at: now });
  return keys;
}

const jsonOf = (part: string): Record<string, unknown> => {
  try { const v = JSON.parse(new TextDecoder().decode(fromB64(part))) as unknown; return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; }
};

/** The ID token's claims once every check passes; OidcRefused(401) with the check that failed otherwise. */
export async function verifyIdToken(f: typeof fetch, provider: IdpName, client: IdpClient, token: string, nonce: string, now: Date): Promise<Record<string, unknown>> {
  const idp = idpOf(provider, client);
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 16_000) throw new OidcRefused(401, "the ID token is not a JWT");
  const header = jsonOf(parts[0]!), claims = jsonOf(parts[1]!);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new OidcRefused(401, "the ID token is not signed with RS256");
  const jwk = (await keysOf(f, idp.jwks, header.kid, now.getTime())).find((k) => k.kid === header.kid);
  if (!jwk) throw new OidcRefused(401, "the ID token's key is not among the provider's keys");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  let good: boolean;
  try { good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)); } catch { good = false; }
  if (!good) throw new OidcRefused(401, "the ID token's signature does not check");
  if (typeof claims.iss !== "string" || !idp.issuerOk(claims.iss, claims)) throw new OidcRefused(401, "the ID token is from another issuer");
  const aud = claims.aud;
  const audOk = aud === client.clientId || (Array.isArray(aud) && aud.includes(client.clientId) && (aud.length === 1 || claims.azp === client.clientId));
  if (!audOk) throw new OidcRefused(401, "the ID token is for another application");
  const t = now.getTime();
  if (typeof claims.exp !== "number" || claims.exp * 1000 + SKEW_MS <= t) throw new OidcRefused(401, "the ID token expired");
  if (typeof claims.iat !== "number" || claims.iat * 1000 - SKEW_MS > t) throw new OidcRefused(401, "the ID token is issued in the future");
  if (typeof claims.nonce !== "string" || claims.nonce !== nonce) throw new OidcRefused(401, "the ID token's nonce is not this sign-in's");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw new OidcRefused(401, "the ID token names no subject");
  return claims;
}

// --- The token request ------------------------------------------------------------------------------------------------

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/\\n/g, "\n").replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return fromB64(body);
}

/** Apple's client secret: an ES256 JWT { iss: team, sub: Services ID, aud: appleid.apple.com }, five minutes long. */
export async function appleClientSecret(c: IdpClient, now: Date): Promise<string> {
  if (!c.apple) throw new OidcRefused(404, "signing in with Apple is not set up (team id, key id and private key)");
  let key: CryptoKey;
  try { key = await crypto.subtle.importKey("pkcs8", pemToDer(c.apple.privateKeyPem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]); } catch { throw new OidcRefused(404, "the Sign in with Apple key does not load (a PKCS#8 .p8 key is expected)"); }
  const iat = Math.floor(now.getTime() / 1000);
  const head = b64uText(JSON.stringify({ alg: "ES256", kid: c.apple.keyId, typ: "JWT" }));
  const body = b64uText(JSON.stringify({ iss: c.apple.teamId, iat, exp: iat + 300, aud: "https://appleid.apple.com", sub: c.clientId }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${toB64u(sig)}`;
}

async function idTokenFor(env: OidcEnv, provider: IdpName, client: IdpClient, code: string, verifier: string | null, origin: string, now: Date): Promise<string> {
  const idp = idpOf(provider, client);
  const secret = provider === "apple" ? await appleClientSecret(client, now) : client.clientSecret ?? "";
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUriOf(origin, provider), client_id: client.clientId, client_secret: secret });
  if (verifier) form.set("code_verifier", verifier);
  let res: Response;
  if (!egressAllowed(idp.token)) throw new OidcRefused(502, "the provider's token endpoint is at an address Purser does not call");
  try {
    res = await env.fetch(idp.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString(), signal: AbortSignal.timeout(15_000) });
  } catch { throw new OidcRefused(502, `${provider} did not answer; try again`); }
  const j = (await res.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown };
  if (!res.ok || typeof j.id_token !== "string") {
    logEvent("warn", "oidc_exchange_failed", { provider, status: res.status, code: typeof j.error === "string" && /^[a-z_]{1,40}$/.test(j.error) ? j.error : "" }, now);
    throw new OidcRefused(502, `${provider} did not accept the sign-in; nothing changed, and you can try again`);
  }
  return j.id_token;
}

/**
 * Spends the state (once, whatever follows), checks it is this provider's and this browser's and still fresh, exchanges
 * the code and checks the ID token. Answers what the state was for and the provider's claims.
 */
async function finish(sql: Sql, env: OidcEnv | undefined, a: { provider: IdpName; code: string; state: string; browserSecret: string; origin: string; now: Date })
  : Promise<{ purpose: "link" | "sign-in"; tenantId: string; userId: string | null; issuer: string; subject: string; email: string | null }> {
  const client = clientOf(env, a.provider);
  const hash = await sha256Hex(a.state);
  const st = await sql.first<{ purpose: "link" | "sign-in"; tenant_id: string; user_id: string | null; provider: string; nonce: string; verifier: string | null; browser_sha256: string; expires_at: number }>(
    "SELECT purpose, tenant_id, user_id, provider, nonce, verifier, browser_sha256, expires_at FROM oidc_states WHERE state_sha256 = ?", [hash]);
  const spent = st ? (await sql.run("DELETE FROM oidc_states WHERE state_sha256 = ?", [hash])).changes : 0;
  if (!st || spent !== 1 || st.provider !== a.provider || st.expires_at < a.now.getTime() || st.browser_sha256 !== (await sha256Hex(a.browserSecret))) {
    throw new OidcRefused(400, "this sign-in was not started in this browser, or it expired; start again");
  }
  const idToken = await idTokenFor(env!, a.provider, client, a.code, st.verifier, a.origin, a.now);
  const claims = await verifyIdToken(env!.fetch, a.provider, client, idToken, st.nonce, a.now);
  const verified = claims.email_verified === true || claims.email_verified === "true" || claims.xms_edov === true;
  const email = typeof claims.email === "string" && verified ? claims.email.slice(0, 200).toLowerCase() : null;
  return { purpose: st.purpose, tenantId: st.tenant_id, userId: st.user_id, issuer: claims.iss as string, subject: claims.sub as string, email };
}

/** Finishes a link for the signed-in person who started it: their identity, on their membership, in their company. */
export async function finishLink(sql: Sql, env: OidcEnv | undefined, a: { provider: IdpName; code: string; state: string; browserSecret: string; origin: string; tenantId: string; userId: string; now: Date }): Promise<{ provider: IdpName; email: string | null; linked_at: string }> {
  const r = await finish(sql, env, a);
  if (r.purpose !== "link" || r.tenantId !== a.tenantId || r.userId !== a.userId) throw new OidcRefused(400, "this link was started by someone else, or for another company; start again");
  const db = new TenantDb(sql, a.tenantId);
  const taken = await db.one<{ user_id: string }>("identity_links", { provider: a.provider, issuer: r.issuer, subject: r.subject });
  if (taken && taken.user_id !== a.userId) throw new OidcRefused(409, "this account is already linked to another person in this company");
  const iso = a.now.toISOString();
  await db.apply([db.delete("identity_links", { user_id: a.userId, provider: a.provider }),
    db.insert("identity_links", { provider: a.provider, issuer: r.issuer, subject: r.subject, user_id: a.userId, email: r.email, linked_at: iso }),
    db.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: iso, kind: "identity.linked", actor: a.userId, detail_json: JSON.stringify({ provider: a.provider }) })]);
  logEvent("info", "identity.linked", { tenant: a.tenantId, provider: a.provider }, a.now);
  return { provider: a.provider, email: r.email, linked_at: iso };
}

/** Finishes a sign-in: the person whose membership the identity is linked to, if any, and still there. */
export async function finishSignIn(sql: Sql, env: OidcEnv | undefined, a: { provider: IdpName; code: string; state: string; browserSecret: string; origin: string; now: Date }): Promise<{ tenantId: string; userId: string }> {
  const r = await finish(sql, env, a);
  if (r.purpose !== "sign-in") throw new OidcRefused(400, "this was a link, not a sign-in; start again");
  const db = new TenantDb(sql, r.tenantId);
  const link = await db.one<{ user_id: string }>("identity_links", { provider: a.provider, issuer: r.issuer, subject: r.subject });
  if (!link) throw new OidcRefused(401, `this ${a.provider} account is not linked to anyone in this company: sign in with your passkey, then link it in Settings`);
  const user = await db.one<{ erased_at: string | null }>("users", { id: link.user_id });
  if (!user || user.erased_at) throw new OidcRefused(401, "this person has no access");
  return { tenantId: r.tenantId, userId: link.user_id };
}

export async function identitiesOf(sql: Sql, env: OidcEnv | undefined, tenantId: string, userId: string): Promise<{ offered: IdpName[]; linked: { provider: string; email: string | null; linked_at: string }[] }> {
  const rows = await new TenantDb(sql, tenantId).select<{ provider: string; email: string | null; linked_at: string }>("identity_links", { user_id: userId }, { order: ["provider"] });
  return { offered: offered(env), linked: rows.map((r) => ({ provider: r.provider, email: r.email, linked_at: r.linked_at })) };
}

export async function unlink(sql: Sql, tenantId: string, userId: string, provider: IdpName, now: Date): Promise<{ unlinked: boolean }> {
  const db = new TenantDb(sql, tenantId);
  if (!(await db.one("identity_links", { user_id: userId, provider }))) return { unlinked: false };
  await db.apply([db.delete("identity_links", { user_id: userId, provider }),
    db.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: now.toISOString(), kind: "identity.unlinked", actor: userId, detail_json: JSON.stringify({ provider }) })]);
  return { unlinked: true };
}
