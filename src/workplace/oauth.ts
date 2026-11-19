// OAuth 2.0 authorization code with PKCE (RFC 7636, S256) for the workplace integrations: Google, Microsoft (Entra ID)
// and Xero. The PKCE pair, `state` and the refusal error are the ones Purser's own connections use (src/lib/oauth.ts);
// this file adds the three providers, their minimum scopes, a nonce for OpenID Connect, and a token source made from
// the environment. WebCrypto and fetch only. Nothing here logs, and no error carries a token or a token answer's body.
//
// Endpoints, each from the provider's documentation:
// - Google: https://developers.google.com/identity/protocols/oauth2/web-server (authorize
//   https://accounts.google.com/o/oauth2/v2/auth, token https://oauth2.googleapis.com/token, PKCE, access_type=offline
//   for a refresh token) and https://developers.google.com/identity/openid-connect/openid-connect (nonce, id_token).
// - Microsoft: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow (authorize and token at
//   https://login.microsoftonline.com/{tenant}/oauth2/v2.0/..., PKCE, offline_access for a refresh token).
// - Xero: https://developer.xero.com/documentation/guides/oauth2/pkce-flow and .../auth-flow (authorize
//   https://login.xero.com/identity/connect/authorize, token https://identity.xero.com/connect/token), scopes at
//   https://developer.xero.com/documentation/guides/oauth2/scopes (granular scopes for apps made after 2 March 2026).
//
// Built and tested against a mock (test/workplace-oauth.test.ts); needs the owner's OAuth app to run live.

import { challengeOf, newPkce, OAuthRefused, randomState } from "../lib/oauth.js";
import { setting, WorkplaceError, type Fetch, type TokenSource } from "./http.js";

export { challengeOf, newPkce, OAuthRefused, randomState };

export type WorkplaceProviderName = "google" | "microsoft" | "xero";

export interface WorkplaceProvider {
  name: WorkplaceProviderName;
  authorizeUrl: string;
  tokenUrl: string;
}

const GOOGLE_API = "https://www.googleapis.com/auth";
const GRAPH = "https://graph.microsoft.com";

/**
 * The least each integration needs, and no more. Read-only wherever the integration only reads; Sheets is the one
 * Google integration that writes, and only to the spreadsheet the owner names. None of these can move money: Purser's
 * payments need the CFO's passkey, which no OAuth scope reaches.
 */
export const WORKPLACE_SCOPES = {
  gmail: [`${GOOGLE_API}/gmail.readonly`],
  drive: [`${GOOGLE_API}/drive.readonly`],
  sheets: [`${GOOGLE_API}/spreadsheets`],
  googleSignIn: ["openid", "email"],
  outlook: ["offline_access", `${GRAPH}/Mail.Read`],
  onedrive: ["offline_access", `${GRAPH}/Files.Read`],
  xero: ["offline_access", "accounting.manualjournals", "accounting.contacts"],
} as const satisfies Record<string, readonly string[]>;
export type WorkplaceIntegration = keyof typeof WORKPLACE_SCOPES;

/** Scopes this code never asks for: each would let an integration change mail, files or payments. */
export const NEVER_ASKED = [
  "https://mail.google.com/", `${GOOGLE_API}/gmail.modify`, `${GOOGLE_API}/gmail.send`, `${GOOGLE_API}/drive`,
  `${GRAPH}/Mail.ReadWrite`, `${GRAPH}/Mail.Send`, `${GRAPH}/Files.ReadWrite`, `${GRAPH}/Files.ReadWrite.All`,
  "accounting.transactions", "accounting.payments", "accounting.banktransactions",
] as const;

export const GOOGLE: WorkplaceProvider = { name: "google", authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token" };
export const XERO: WorkplaceProvider = { name: "xero", authorizeUrl: "https://login.xero.com/identity/connect/authorize", tokenUrl: "https://identity.xero.com/connect/token" };
/** Microsoft for one tenant (its id or domain): "organizations" would let any work account in. */
export function microsoft(tenant: string): WorkplaceProvider {
  if (!/^[A-Za-z0-9.-]{1,100}$/.test(tenant) || tenant === "common" || tenant === "consumers") throw new WorkplaceError("config", "the Microsoft tenant must be the company's own tenant id or domain");
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  return { name: "microsoft", authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token` };
}

/** The owner's registered OAuth app. The secret is absent for a public client (PKCE alone). */
export interface WorkplaceClient { clientId: string; clientSecret?: string; redirectUri: string }

/** The provider's consent screen URL, with PKCE (S256), state and, for OpenID Connect, a nonce. */
export function workplaceAuthorizeUrl(p: WorkplaceProvider, c: Pick<WorkplaceClient, "clientId" | "redirectUri">, o: { scopes: readonly string[]; state: string; challenge: string; nonce?: string; offline?: boolean }): string {
  for (const s of o.scopes) if ((NEVER_ASKED as readonly string[]).includes(s)) throw new WorkplaceError("config", `${s} is broader than any workplace integration needs; it is never asked for`);
  const q = new URLSearchParams({ response_type: "code", client_id: c.clientId, redirect_uri: c.redirectUri, scope: o.scopes.join(" "), state: o.state, code_challenge: o.challenge, code_challenge_method: "S256" });
  if (o.nonce) q.set("nonce", o.nonce);
  // Google gives a refresh token only with access_type=offline; prompt=consent shows the scopes each time. Granted
  // scopes are never merged in (no include_granted_scopes), so a token holds only what this integration asked.
  if (p.name === "google" && o.offline) { q.set("access_type", "offline"); q.set("prompt", "consent"); }
  return `${p.authorizeUrl}?${q.toString()}`;
}

export interface WorkplaceTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds. */
  expiresIn: number | null;
  scope: string;
  /** OpenID Connect only; verify it (./googleSignIn.ts) before trusting a claim in it. */
  idToken: string | null;
}

const CODE = /^[a-z_]{1,40}$/;

async function tokenCall(f: Fetch, p: WorkplaceProvider, c: WorkplaceClient, form: Record<string, string>, what: string): Promise<WorkplaceTokens> {
  const at = `${p.name} ${what}`;
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const body = new URLSearchParams({ ...form });
  // Xero takes a confidential client's secret as HTTP Basic; Google and Microsoft in the form. A public client sends its id only.
  if (c.clientSecret && p.name === "xero") headers.authorization = `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`;
  else { body.set("client_id", c.clientId); if (c.clientSecret) body.set("client_secret", c.clientSecret); }
  let res: Response;
  try {
    res = await f(p.tokenUrl, { method: "POST", headers, body: body.toString(), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new OAuthRefused(0, "no_answer", at);
  }
  const text = await res.text().catch(() => "");
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text.slice(0, 64 * 1024)) as Record<string, unknown>; } catch { /* not JSON */ }
  if (!res.ok) throw new OAuthRefused(res.status, typeof j.error === "string" && CODE.test(j.error) ? j.error : "", at);
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
  const accessToken = str(j.access_token, 16_384);
  if (!accessToken) throw new OAuthRefused(502, "no_access_token", at);
  const n = typeof j.expires_in === "number" && Number.isFinite(j.expires_in) && j.expires_in > 0 ? j.expires_in : typeof j.expires_in === "string" && /^\d{1,10}$/.test(j.expires_in) ? Number(j.expires_in) : null;
  return { accessToken, refreshToken: str(j.refresh_token, 16_384), expiresIn: n, scope: typeof j.scope === "string" ? j.scope.slice(0, 2000) : "", idToken: str(j.id_token, 16_384) };
}

/** grant_type=authorization_code with the PKCE verifier. */
export function exchangeWorkplaceCode(f: Fetch, p: WorkplaceProvider, c: WorkplaceClient, code: string, verifier: string): Promise<WorkplaceTokens> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new WorkplaceError("config", "the PKCE verifier is not 43 to 128 unreserved characters");
  return tokenCall(f, p, c, { grant_type: "authorization_code", code, redirect_uri: c.redirectUri, code_verifier: verifier }, "token exchange");
}

/** grant_type=refresh_token. Microsoft and Xero may answer a new refresh token: it replaces the old one. */
export function refreshWorkplaceTokens(f: Fetch, p: WorkplaceProvider, c: WorkplaceClient, refreshToken: string, scopes?: readonly string[]): Promise<WorkplaceTokens> {
  // Microsoft asks for the scopes again on a refresh; asking the same ones keeps the token as narrow as it was granted.
  return tokenCall(f, p, c, { grant_type: "refresh_token", refresh_token: refreshToken, ...(p.name === "microsoft" && scopes ? { scope: scopes.join(" ") } : {}) }, "token refresh");
}

/**
 * A token source that refreshes: the access token is kept in memory until a minute before it expires. A rotated refresh
 * token is kept in memory and handed to `onRotate`, for the owner's secret store; it is never written by this code.
 */
export function refreshingToken(o: { fetch?: Fetch; provider: WorkplaceProvider; client: Omit<WorkplaceClient, "redirectUri">; refreshToken: string; scopes?: readonly string[]; now?: () => number; onRotate?: (refreshToken: string) => void }): TokenSource {
  const now = o.now ?? Date.now;
  let refresh = o.refreshToken;
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && cached.until > now()) return cached.token;
    const t = await refreshWorkplaceTokens(o.fetch ?? fetch, o.provider, { ...o.client, redirectUri: "" }, refresh, o.scopes);
    if (t.refreshToken && t.refreshToken !== refresh) { refresh = t.refreshToken; o.onRotate?.(refresh); }
    cached = { token: t.accessToken, until: now() + Math.max(0, (t.expiresIn ?? 300) - 60) * 1000 };
    return t.accessToken;
  };
}

/**
 * The token source an integration runs on, from the environment or secret config only. `<PREFIX>_ACCESS_TOKEN` alone
 * (a short-lived token, for a trial); otherwise `<PREFIX>_REFRESH_TOKEN` with the provider's client id (and secret for
 * a confidential client): PURSER_GOOGLE_CLIENT_ID / _SECRET, PURSER_MS_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET.
 */
export function tokenSourceFromEnv(env: Record<string, string | undefined>, integration: WorkplaceIntegration, prefix: string, f?: Fetch): TokenSource {
  const access = env[`${prefix}_ACCESS_TOKEN`]?.trim();
  if (access) return async () => access;
  const refreshToken = setting(env, `${prefix}_REFRESH_TOKEN`);
  const scopes = WORKPLACE_SCOPES[integration];
  if (integration === "outlook" || integration === "onedrive") {
    const client = { clientId: setting(env, "PURSER_MS_CLIENT_ID"), ...(env.PURSER_MS_CLIENT_SECRET ? { clientSecret: env.PURSER_MS_CLIENT_SECRET } : {}) };
    return refreshingToken({ ...(f ? { fetch: f } : {}), provider: microsoft(setting(env, "PURSER_MS_TENANT_ID")), client, refreshToken, scopes });
  }
  if (integration === "xero") throw new WorkplaceError("config", "Xero's tokens come from xeroTokensFromEnv (src/workplace/xero.ts): its refresh token rotates and is kept in a file");
  const client = { clientId: setting(env, "PURSER_GOOGLE_CLIENT_ID"), ...(env.PURSER_GOOGLE_CLIENT_SECRET ? { clientSecret: env.PURSER_GOOGLE_CLIENT_SECRET } : {}) };
  return refreshingToken({ ...(f ? { fetch: f } : {}), provider: GOOGLE, client, refreshToken });
}
