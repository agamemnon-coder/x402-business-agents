// A company connects accounts it already has to Purser by OAuth (docs/real-customers.md): its existing Airwallex account
// ("Connect your Airwallex account") and its Moneybird administration (its books). Purser Cloud runs the authorization
// code flow (state, and PKCE where the provider documents it), exchanges the code server side, keeps the tokens sealed
// per company (cloud/src/sealed.ts), refreshes them one at a time, and hands only a short-lived access token to the
// company's own runner, which then makes every call for that company with that token. Disconnecting removes the tokens
// (and revokes them where the provider documents a revocation endpoint).
//
// Off unless the cloud is configured for it (CloudEnv.connect, which needs the sealing key and an OAuth application
// per provider the owner registered); no token is ever logged, returned to a person, exported or restored.

import { ACCOUNT_ID } from "../../src/airwallex/platform.js";
import { authorizeUrl, exchangeCode, newPkce, OAUTH_PROVIDERS, OAuthRefused, randomState, refreshTokens, revokeToken, type OAuthClient, type OAuthProviderName, type TokenSet } from "../../src/lib/oauth.js";
import { sha256Hex } from "./crypto.js";
import { logEvent } from "./log.js";
import { aadOf, seal, SealError, sealKey, unseal as unsealRaw } from "./sealed.js";
import type { Sql } from "./store.js";

export interface ConnectEnv {
  /** AES-256 key (base64, 32 bytes) that seals the tokens: a Worker secret (OAUTH_TOKEN_KEY). */
  tokenKey: string;
  /** Purser's OAuth application per provider (client id, secret, redirect URI), as the owner registered it. */
  clients: Partial<Record<OAuthProviderName, OAuthClient>>;
  /** How the cloud reaches the providers' token endpoints (the Worker's fetch; a fake in tests). */
  fetch: typeof fetch;
  /** The secret Airwallex signs partner webhooks with (partner_connection.disconnected); absent: that route answers 404. */
  airwallexWebhookSecret?: string;
}

export class ConnectRefused extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 502, message: string) { super(message); }
}

/** How long an OAuth start may wait for its callback. Airwallex's code itself lives 5 minutes. */
const STATE_TTL_MS = 10 * 60_000;
/** An access token with less than this left is refreshed before it is handed out. */
const FRESH_MS = 60_000;
/** How long one refresh may hold the lock. */
const REFRESH_LOCK_MS = 30_000;

export interface ConnectionView {
  provider: OAuthProviderName;
  /** Whether Purser offers this connection on this cloud at all (an OAuth application is configured for it). */
  offered: boolean;
  status: "not_connected" | "connected" | "disconnected";
  /** Airwallex: the connected account's id (acct_…). Moneybird: null (the administration is chosen in the runner). */
  account: string | null;
  scope: string | null;
  connected_at: string | null;
  connected_by: string | null;
  /** Why it ended: owner, refused (the provider refused the refresh token: connect again), provider. */
  ended_reason: string | null;
  /** When the provider's refresh token runs out (Airwallex: 90 days, renewed on every refresh). */
  refresh_expires_at: string | null;
}

interface Row {
  tenant_id: string; provider: OAuthProviderName; status: "connected" | "disconnected"; account_ref: string | null; scope: string;
  access_sealed: string | null; access_expires_at: number | null; refresh_sealed: string | null; refresh_expires_at: number | null;
  refreshing_until: number; connected_by: string; connected_at: string; updated_at: string; ended_reason: string | null;
}

function clientOf(env: ConnectEnv, provider: OAuthProviderName): OAuthClient {
  const c = env.clients[provider];
  if (!c) throw new ConnectRefused(404, `connecting ${provider} is not switched on`);
  return c;
}

/** A sealed value that does not open for this company (another company's, tampered, or an old key) ends nothing silently. */
async function unseal(key: CryptoKey, sealed: string, aad: string): Promise<string> {
  try {
    return await unsealRaw(key, sealed, aad);
  } catch (e) {
    if (e instanceof SealError) throw new ConnectRefused(409, "the stored connection does not open for this company; an owner connects it again");
    throw e;
  }
}

const rowOf = (sql: Sql, tenantId: string, provider: OAuthProviderName) =>
  sql.first<Row>("SELECT * FROM oauth_connections WHERE tenant_id = ? AND provider = ?", [tenantId, provider]);

export async function connections(sql: Sql, tenantId: string, env: ConnectEnv | undefined): Promise<{ switched_on: boolean; connections: ConnectionView[] }> {
  const out: ConnectionView[] = [];
  for (const provider of ["airwallex", "moneybird"] as const) {
    const r = env ? await rowOf(sql, tenantId, provider) : null;
    out.push({
      provider, offered: Boolean(env?.clients[provider]), status: r ? r.status : "not_connected", account: r?.account_ref ?? null, scope: r?.scope || null,
      connected_at: r?.connected_at ?? null, connected_by: r?.connected_by ?? null, ended_reason: r?.ended_reason ?? null,
      refresh_expires_at: r?.status === "connected" && r.refresh_expires_at ? new Date(r.refresh_expires_at).toISOString() : null,
    });
  }
  return { switched_on: Boolean(env), connections: out };
}

/**
 * Starts a connection for the signed-in owner: a fresh state (only its hash is kept) and, where the provider takes it,
 * a PKCE verifier (sealed). Returns the provider's own sign-in and consent URL.
 */
export async function startConnect(sql: Sql, tenantId: string, userId: string, provider: OAuthProviderName, env: ConnectEnv, now: Date): Promise<{ url: string; expires_at: string }> {
  const client = clientOf(env, provider);
  const p = OAUTH_PROVIDERS[provider];
  const key = await sealKey(env.tokenKey);
  const state = randomState();
  const pkce = p.pkce ? await newPkce() : null;
  await sql.run("DELETE FROM oauth_states WHERE expires_at < ?", [now.getTime()]);
  // One open start per person and provider: a newer one replaces the older.
  await sql.run("DELETE FROM oauth_states WHERE tenant_id = ? AND provider = ? AND user_id = ?", [tenantId, provider, userId]);
  const hash = await sha256Hex(state);
  await sql.run("INSERT INTO oauth_states (state_sha256, tenant_id, provider, user_id, verifier_sealed, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [hash, tenantId, provider, userId, pkce ? await seal(key, pkce.verifier, aadOf(tenantId, provider, `verifier:${hash}`)) : null, now.getTime() + STATE_TTL_MS]);
  return { url: authorizeUrl(p, client, { state, ...(pkce ? { challenge: pkce.challenge } : {}) }), expires_at: new Date(now.getTime() + STATE_TTL_MS).toISOString() };
}

/**
 * Finishes a connection: the state must be one this owner started for this company and provider, within ten minutes,
 * and is spent before anything else (a second use finds nothing). The code is exchanged server side; the tokens are
 * sealed for this company. An Airwallex account already connected to another company is refused.
 */
export async function finishConnect(sql: Sql, tenantId: string, userId: string, provider: OAuthProviderName, env: ConnectEnv, a: { code: string; state: string }, now: Date): Promise<ConnectionView> {
  const client = clientOf(env, provider);
  const p = OAUTH_PROVIDERS[provider];
  const key = await sealKey(env.tokenKey);
  const hash = await sha256Hex(a.state);
  const st = await sql.first<{ tenant_id: string; provider: string; user_id: string; verifier_sealed: string | null; expires_at: number }>("SELECT tenant_id, provider, user_id, verifier_sealed, expires_at FROM oauth_states WHERE state_sha256 = ?", [hash]);
  // Spent first, whatever follows: a state is good once.
  const spent = st ? (await sql.run("DELETE FROM oauth_states WHERE state_sha256 = ?", [hash])).changes : 0;
  if (!st || spent !== 1 || st.tenant_id !== tenantId || st.provider !== provider || st.user_id !== userId || st.expires_at < now.getTime()) {
    throw new ConnectRefused(400, "this connection request is not one you started here, or it expired; start again from Settings");
  }
  const verifier = st.verifier_sealed ? await unseal(key, st.verifier_sealed, aadOf(tenantId, provider, `verifier:${hash}`)) : undefined;
  let t: TokenSet;
  try {
    t = await exchangeCode(env.fetch, p, client, a.code, verifier);
  } catch (e) {
    logEvent("warn", "oauth_exchange_failed", { tenant: tenantId, provider, ...(e instanceof OAuthRefused ? { status: e.status, code: e.code } : {}) }, now);
    throw new ConnectRefused(502, `${provider} did not accept the connection; nothing is stored, and you can try again`);
  }
  let account: string | null = null;
  if (provider === "airwallex") {
    if (!t.accountId || !ACCOUNT_ID.test(t.accountId)) throw new ConnectRefused(502, "Airwallex did not say which account was connected; nothing is stored");
    account = t.accountId;
    const other = await sql.first<{ tenant_id: string }>("SELECT tenant_id FROM oauth_connections WHERE provider = 'airwallex' AND account_ref = ? AND status = 'connected' AND tenant_id <> ?", [account, tenantId]);
    if (other) throw new ConnectRefused(409, "this Airwallex account is already connected to another company in Purser; nothing is stored");
    const opened = await sql.first<{ tenant_id: string }>("SELECT tenant_id FROM awx_accounts WHERE account_id = ? AND tenant_id <> ?", [account, tenantId]);
    if (opened) throw new ConnectRefused(409, "this Airwallex account belongs to another company in Purser; nothing is stored");
  }
  const iso = now.toISOString();
  const access = await seal(key, t.accessToken, aadOf(tenantId, provider, "access"));
  const refresh = t.refreshToken ? await seal(key, t.refreshToken, aadOf(tenantId, provider, "refresh")) : null;
  try {
    await sql.run(`INSERT INTO oauth_connections (tenant_id, provider, status, account_ref, scope, access_sealed, access_expires_at, refresh_sealed, refresh_expires_at, refreshing_until, connected_by, connected_at, updated_at, ended_reason)
      VALUES (?, ?, 'connected', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)
      ON CONFLICT (tenant_id, provider) DO UPDATE SET status = 'connected', account_ref = excluded.account_ref, scope = excluded.scope, access_sealed = excluded.access_sealed,
        access_expires_at = excluded.access_expires_at, refresh_sealed = excluded.refresh_sealed, refresh_expires_at = excluded.refresh_expires_at, refreshing_until = 0,
        connected_by = excluded.connected_by, connected_at = excluded.connected_at, updated_at = excluded.updated_at, ended_reason = NULL`,
      [tenantId, provider, account, t.scope, access, t.expiresIn ? now.getTime() + t.expiresIn * 1000 : null, refresh, t.refreshExpiresIn ? now.getTime() + t.refreshExpiresIn * 1000 : null, userId, iso, iso]);
  } catch (e) {
    if (/constraint failed/i.test(String((e as Error).message ?? e))) throw new ConnectRefused(409, "this account is already connected to another company in Purser; nothing is stored");
    throw e;
  }
  logEvent("info", "oauth_connected", { tenant: tenantId, provider }, now);
  return (await connections(sql, tenantId, env)).connections.find((c) => c.provider === provider)!;
}

async function endConnection(sql: Sql, tenantId: string, provider: OAuthProviderName, reason: "owner" | "refused" | "provider", now: Date): Promise<void> {
  await sql.run("UPDATE oauth_connections SET status = 'disconnected', access_sealed = NULL, access_expires_at = NULL, refresh_sealed = NULL, refresh_expires_at = NULL, refreshing_until = 0, updated_at = ?, ended_reason = ? WHERE tenant_id = ? AND provider = ?",
    [now.toISOString(), reason, tenantId, provider]);
}

/**
 * The access token for this company's own runner (the only place a token leaves the cloud): the sealed one while it has
 * more than a minute left, else a refresh under a lock (one at a time: Airwallex revokes a refresh token that is used
 * twice), with the rotated refresh token sealed at once. A refusal by the provider (4xx, not 429) ends the connection:
 * the owner connects again. A token is only ever opened with this company's id, so a sealed value from another
 * company's row does not open.
 */
export async function accessToken(sql: Sql, tenantId: string, provider: OAuthProviderName, env: ConnectEnv, now: Date): Promise<{ access_token: string; expires_at: string | null; account: string | null }> {
  const client = clientOf(env, provider);
  const key = await sealKey(env.tokenKey);
  const r = await rowOf(sql, tenantId, provider);
  if (!r || r.status !== "connected" || !r.access_sealed) throw new ConnectRefused(404, `${provider} is not connected for this company; an owner connects it in Settings`);
  if (r.access_expires_at === null || r.access_expires_at - now.getTime() > FRESH_MS) {
    return { access_token: await unseal(key, r.access_sealed, aadOf(tenantId, provider, "access")), expires_at: r.access_expires_at ? new Date(r.access_expires_at).toISOString() : null, account: r.account_ref };
  }
  if (!r.refresh_sealed) throw new ConnectRefused(409, `the ${provider} access token ran out and there is no refresh token; an owner connects it again`);
  const lock = await sql.run("UPDATE oauth_connections SET refreshing_until = ? WHERE tenant_id = ? AND provider = ? AND status = 'connected' AND refreshing_until < ? AND updated_at = ?",
    [now.getTime() + REFRESH_LOCK_MS, tenantId, provider, now.getTime(), r.updated_at]);
  if (lock.changes !== 1) throw new ConnectRefused(409, "another request is refreshing this company's token right now; try again in a few seconds");
  const refresh = await unseal(key, r.refresh_sealed, aadOf(tenantId, provider, "refresh"));
  let t: TokenSet;
  try {
    t = await refreshTokens(env.fetch, OAUTH_PROVIDERS[provider], client, refresh);
  } catch (e) {
    if (e instanceof OAuthRefused && e.permanent) {
      await endConnection(sql, tenantId, provider, "refused", now);
      logEvent("warn", "oauth_refresh_refused", { tenant: tenantId, provider, status: e.status, code: e.code }, now);
      throw new ConnectRefused(409, `${provider} no longer accepts this company's connection; an owner connects it again in Settings`);
    }
    // No answer, 429 or 5xx: the refresh token is kept (Airwallex's 60 s grace answers a retry with the same new pair).
    await sql.run("UPDATE oauth_connections SET refreshing_until = 0 WHERE tenant_id = ? AND provider = ?", [tenantId, provider]);
    throw new ConnectRefused(502, `${provider} did not answer the token refresh; try again shortly`);
  }
  const iso = now.toISOString();
  await sql.run("UPDATE oauth_connections SET access_sealed = ?, access_expires_at = ?, refresh_sealed = ?, refresh_expires_at = ?, scope = ?, refreshing_until = 0, updated_at = ? WHERE tenant_id = ? AND provider = ? AND status = 'connected'",
    [await seal(key, t.accessToken, aadOf(tenantId, provider, "access")), t.expiresIn ? now.getTime() + t.expiresIn * 1000 : null,
      t.refreshToken ? await seal(key, t.refreshToken, aadOf(tenantId, provider, "refresh")) : r.refresh_sealed,
      t.refreshExpiresIn ? now.getTime() + t.refreshExpiresIn * 1000 : r.refresh_expires_at, t.scope || r.scope, iso, tenantId, provider]);
  if (provider === "airwallex" && t.accountId && t.accountId !== r.account_ref) {
    // The provider answered for another account than the one connected: nothing is handed out, the owner looks.
    await endConnection(sql, tenantId, provider, "refused", now);
    logEvent("error", "oauth_account_changed", { tenant: tenantId, provider }, now);
    throw new ConnectRefused(409, "Airwallex answered the refresh for another account than the one connected; the connection is ended, connect again");
  }
  return { access_token: t.accessToken, expires_at: t.expiresIn ? new Date(now.getTime() + t.expiresIn * 1000).toISOString() : null, account: r.account_ref };
}

/**
 * Disconnects: the tokens are removed from the cloud at once. Moneybird documents a revocation endpoint and it is
 * called first (one call ends both tokens). Airwallex documents none for partners: the owner also removes Purser in
 * Airwallex's own settings (the answer says so).
 */
export async function disconnect(sql: Sql, tenantId: string, provider: OAuthProviderName, env: ConnectEnv, now: Date): Promise<{ disconnected: boolean; revoked_at_provider: boolean; note: string | null }> {
  const client = clientOf(env, provider);
  const r = await rowOf(sql, tenantId, provider);
  if (!r || r.status !== "connected") return { disconnected: false, revoked_at_provider: false, note: null };
  let revoked = false;
  const sealedToken = r.refresh_sealed ?? r.access_sealed;
  if (OAUTH_PROVIDERS[provider].revokeUrl && sealedToken) {
    try {
      const key = await sealKey(env.tokenKey);
      const token = await unseal(key, sealedToken, aadOf(tenantId, provider, r.refresh_sealed ? "refresh" : "access"));
      revoked = await revokeToken(env.fetch, OAUTH_PROVIDERS[provider], client, token);
    } catch {
      revoked = false;
    }
  }
  await endConnection(sql, tenantId, provider, "owner", now);
  logEvent("info", "oauth_disconnected", { tenant: tenantId, provider, revoked }, now);
  const note = provider === "airwallex"
    ? "Purser no longer holds a token for this account. Also remove Purser under connected apps in Airwallex's own settings: Airwallex documents no way for an app to end the connection itself."
    : revoked ? null : "Purser no longer holds a token, but Moneybird did not confirm the revocation; you can also remove Purser in Moneybird's settings.";
  return { disconnected: true, revoked_at_provider: revoked, note };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Airwallex's partner_connection.disconnected webhook (developer-tools/webhooks/listen-for-webhook-events/partner-connections):
 * data.account_ids lists every account a person disconnected from Purser in Airwallex; each one's connection ends here.
 * Signed like Purser's other Airwallex webhooks (x-timestamp, x-signature = HMAC-SHA256(secret, timestamp + body)); that
 * partner webhooks use the same scheme is UNCONFIRMED (docs/real-customers.md).
 */
export async function receivePartnerEvent(sql: Sql, env: ConnectEnv, headers: Headers, text: string, now: Date): Promise<{ ended: number }> {
  if (!env.airwallexWebhookSecret) throw new ConnectRefused(404, "Airwallex partner webhooks are not switched on");
  const ts = headers.get("x-timestamp") ?? "";
  const sig = (headers.get("x-signature") ?? "").toLowerCase();
  const at = Number(ts);
  const good = /^\d{10,16}$/.test(ts) && Math.abs(now.getTime() - at) <= 5 * 60_000 && /^[0-9a-f]{64}$/.test(sig);
  const want = good ? await hmacHex(env.airwallexWebhookSecret, ts + text) : "";
  let same = good && want.length === sig.length;
  if (same) { let d = 0; for (let i = 0; i < sig.length; i++) d |= sig.charCodeAt(i) ^ want.charCodeAt(i); same = d === 0; }
  if (!same) throw new ConnectRefused(401, "bad or missing webhook signature");
  let e: { name?: unknown; data?: { account_ids?: unknown } };
  try { e = JSON.parse(text) as typeof e; } catch { return { ended: 0 }; }
  if (e.name !== "partner_connection.disconnected" || !Array.isArray(e.data?.account_ids)) return { ended: 0 };
  let ended = 0;
  for (const id of e.data.account_ids.slice(0, 100)) {
    if (typeof id !== "string" || !ACCOUNT_ID.test(id)) continue;
    const r = await sql.first<{ tenant_id: string }>("SELECT tenant_id FROM oauth_connections WHERE provider = 'airwallex' AND account_ref = ? AND status = 'connected'", [id]);
    if (r) { await endConnection(sql, r.tenant_id, "airwallex", "provider", now); ended++; }
  }
  return { ended };
}
