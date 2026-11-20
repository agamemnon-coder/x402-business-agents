// OAuth 2.0 authorization code flow for the accounts a company connects to Purser itself (docs/real-customers.md):
// its existing Airwallex account and its Moneybird administration. WebCrypto and fetch only, so Purser Cloud (a Worker)
// and the runner (Node) use the same code. Nothing here logs, and no error carries a token or a token answer's body:
// a refused token request keeps only the OAuth error code (RFC 6749 section 5.2), checked to be a plain word.
//
// Every endpoint and parameter is from the provider's own documentation (read 12 November 2026):
// - Airwallex: https://www.airwallex.com/docs/partner-api/authentication/oauth2 (authorize, token, PKCE S256, errors) and
//   https://www.airwallex.com/docs/developer-tools/partner-connections/implement-your-authorization-flow/existing-customers
//   (sandbox authorize host www.sandbox.airwallex.com, token host api.sandbox.airwallex.com; access token 300 s,
//   refresh token 90 days, single use and rotated on every refresh, 60 s grace for a lost answer).
// - Moneybird: https://developer.moneybird.com/authentication (authorize, token, revoke at moneybird.com/oauth/*; scopes;
//   access tokens "do not expire" for now; no PKCE is documented, so none is sent).

// - Xero (developer.xero.com, "OAuth 2.0 auth flow", "Scopes", read 20 Nov 2026): authorize login.xero.com, token and
//   revocation identity.xero.com, the client's id and secret as HTTP Basic, PKCE (S256); access token 30 minutes,
//   refresh token 60 days and rotated on every refresh; apps made after 2 March 2026 take granular scopes
//   (accounting.invoices, accounting.contacts) plus offline_access for a refresh token.
// - QuickBooks Online (developer.intuit.com, "OAuth 2.0", read 20 Nov 2026): authorize appcenter.intuit.com, token
//   oauth.platform.intuit.com, revoke developer.api.intuit.com (JSON body), HTTP Basic; scope
//   com.intuit.quickbooks.accounting; the company (realmId) comes back on the redirect; no PKCE is documented.
// - Exact Online (support.exactonline.com, "Step 3. Get and use access tokens"): authorize and token on
//   start.exactonline.nl/api/oauth2; access token 600 s, refreshed only in its last 30 s; no scopes, no PKCE.

export type OAuthProviderName = "airwallex" | "moneybird" | "xero" | "quickbooks" | "exact";
/** The accounting systems a company connects itself (cloud/src/connect.ts keeps them in books_connections). */
export const BOOKS_PROVIDERS = ["xero", "quickbooks", "exact"] as const;

export interface OAuthProvider {
  name: OAuthProviderName;
  authorizeUrl: string;
  tokenUrl: string;
  /** RFC 7009 revocation, where the provider documents one. Airwallex documents none for partners. */
  revokeUrl: string | null;
  /** Whether the provider documents PKCE (S256). */
  pkce: boolean;
  /** The scopes Purser asks for: the least its calls need. */
  scopes: readonly string[];
  /** Airwallex answers which account the token is for (account_id); Moneybird does not. */
  accountField: "account_id" | null;
  /** How Purser's client id and secret go to the token endpoint: in the form (default) or as HTTP Basic (Xero, Intuit). */
  clientAuth?: "body" | "basic";
  /** Revocation takes a JSON body { token } (Intuit) instead of a form. */
  revokeJson?: boolean;
  /** Refresh when the access token has less than this left (default 60 s; Exact refuses a refresh before its last 30 s). */
  freshMs?: number;
}

/**
 * The Airwallex scopes the payout rail needs (oauth-scopes page, "Payouts", "Business Accounts", "Transactional FX"):
 * balances, beneficiaries, transfers (which covers current rates), conversions, and the account's own details.
 * Simulations only in the sandbox.
 */
export const AIRWALLEX_SCOPES = ["account_details:read", "balance:read", "beneficiary:write", "transfer:write", "fx.conversion:write", "simulation:write"] as const;

/** Moneybird: one scope covers every call the connector makes (src/erp/moneybird.ts, `documents`). */
export const MONEYBIRD_SCOPES = ["documents"] as const;

/** This build talks to Airwallex's sandbox only (the payout client refuses any other host, src/airwallex/client.ts). */
export const OAUTH_PROVIDERS: Record<OAuthProviderName, OAuthProvider> = {
  airwallex: {
    name: "airwallex",
    authorizeUrl: "https://www.sandbox.airwallex.com/oauth/authorize",
    tokenUrl: "https://api.sandbox.airwallex.com/oauth/token",
    revokeUrl: null,
    pkce: true,
    scopes: AIRWALLEX_SCOPES,
    accountField: "account_id",
  },
  moneybird: {
    name: "moneybird",
    authorizeUrl: "https://moneybird.com/oauth/authorize",
    tokenUrl: "https://moneybird.com/oauth/token",
    revokeUrl: "https://moneybird.com/oauth/revoke",
    pkce: false,
    scopes: MONEYBIRD_SCOPES,
    accountField: null,
  },
  xero: {
    name: "xero",
    authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    revokeUrl: "https://identity.xero.com/connect/revocation",
    pkce: true,
    scopes: ["offline_access", "accounting.invoices", "accounting.contacts"],
    accountField: null,
    clientAuth: "basic",
  },
  quickbooks: {
    name: "quickbooks",
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    pkce: false,
    scopes: ["com.intuit.quickbooks.accounting"],
    accountField: null,
    clientAuth: "basic",
    revokeJson: true,
  },
  exact: {
    name: "exact",
    authorizeUrl: "https://start.exactonline.nl/api/oauth2/auth",
    tokenUrl: "https://start.exactonline.nl/api/oauth2/token",
    revokeUrl: null,
    pkce: false,
    scopes: [],
    accountField: null,
    freshMs: 25_000,
  },
};

export const isProvider = (s: string): s is OAuthProviderName => Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, s);

/** Purser's registered application at the provider (client id and secret are the owner's to register; never in git). */
export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  /** Must match a redirect URI registered (Airwallex: whitelisted) for the application exactly. */
  redirectUri: string;
}

/** The answer of a token request, as Purser keeps it. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds; null when the provider gives none (Moneybird's tokens do not expire for now). */
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  scope: string;
  /** Airwallex's account the token acts for (acct_…); null for Moneybird. */
  accountId: string | null;
}

/** A refused or failed OAuth request: the HTTP status and the OAuth error code only (never the body or a token). */
export class OAuthRefused extends Error {
  constructor(readonly status: number, readonly code: string, where: string) {
    super(`${where}: ${status}${code ? ` ${code}` : ""}`);
    this.name = "OAuthRefused";
  }
  /**
   * The grant or refresh token itself is dead (`invalid_grant`: expired, revoked, already used outside the grace period,
   * or the consenting user lost their role): the connection must be made again. Any other refusal (`invalid_client`, a
   * malformed request, 429, 5xx) is Purser's configuration or a passing fault: the company's tokens are kept, so one
   * wrong client secret never ends every company's connection.
   */
  get permanent(): boolean { return this.code === "invalid_grant"; }
}

const b64u = (u: Uint8Array) => {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A random value for `state` (256 bits, base64url). */
export const randomState = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

/** RFC 7636 section 4: a 43-character verifier (32 random bytes, base64url) and its S256 challenge. */
export async function newPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await challengeOf(verifier) };
}

/** The S256 code challenge of a verifier: BASE64URL(SHA256(ASCII(verifier))) (RFC 7636 section 4.2). */
export async function challengeOf(verifier: string): Promise<string> {
  return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** The URL the owner's browser goes to: the provider's own sign-in and consent screen. */
export function authorizeUrl(p: OAuthProvider, c: Pick<OAuthClient, "clientId" | "redirectUri">, o: { state: string; challenge?: string }): string {
  if (p.pkce && !o.challenge) throw new Error(`${p.name} takes PKCE; no code challenge was given`);
  const q = new URLSearchParams({ response_type: "code", client_id: c.clientId, redirect_uri: c.redirectUri, ...(p.scopes.length ? { scope: p.scopes.join(" ") } : {}), state: o.state });
  if (p.pkce) { q.set("code_challenge", o.challenge!); q.set("code_challenge_method", "S256"); }
  return `${p.authorizeUrl}?${q.toString()}`;
}

const CODE = /^[a-z_]{1,40}$/;
/** RFC 6749 section 2.3.1: HTTP Basic with the form-encoded client id and secret. */
const basicAuth = (c: OAuthClient) => `Basic ${btoa(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`)}`;
/** A token request that has not answered in this time is abandoned (below Purser Cloud's 30 s refresh lock). */
export const TOKEN_TIMEOUT_MS = 20_000;

async function tokenCall(f: typeof fetch, p: OAuthProvider, c: OAuthClient, form: Record<string, string>, where: string): Promise<TokenSet> {
  let res: Response;
  try {
    const basic = p.clientAuth === "basic";
    res = await f(p.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...(basic ? { authorization: basicAuth(c) } : {}) },
      body: new URLSearchParams(basic ? form : { client_id: c.clientId, client_secret: c.clientSecret, ...form }).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch {
    // No answer: the request may or may not have been taken (Airwallex: retry a refresh within its 60 s grace).
    throw new OAuthRefused(0, "no_answer", where);
  }
  const text = await res.text().catch(() => "");
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  if (!res.ok) {
    const code = typeof j.error === "string" && CODE.test(j.error) ? j.error : "";
    throw new OAuthRefused(res.status, code, where);
  }
  const accessToken = typeof j.access_token === "string" ? j.access_token : "";
  if (!accessToken || accessToken.length > 8192) throw new OAuthRefused(502, "no_access_token", where);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : null);
  const accountId = p.accountField && typeof j[p.accountField] === "string" ? (j[p.accountField] as string) : null;
  return {
    accessToken,
    refreshToken: typeof j.refresh_token === "string" && j.refresh_token ? j.refresh_token : null,
    expiresIn: num(j.expires_in),
    refreshExpiresIn: num(j.refresh_token_expires_in),
    scope: typeof j.scope === "string" ? j.scope.slice(0, 500) : "",
    accountId,
  };
}

/** POST {token} grant_type=authorization_code (with the PKCE verifier where the provider takes one). */
export function exchangeCode(f: typeof fetch, p: OAuthProvider, c: OAuthClient, code: string, verifier?: string): Promise<TokenSet> {
  if (p.pkce && !verifier) throw new Error(`${p.name} takes PKCE; no code verifier was given`);
  return tokenCall(f, p, c, { grant_type: "authorization_code", code, redirect_uri: c.redirectUri, ...(p.pkce ? { code_verifier: verifier! } : {}) }, `${p.name} token exchange`);
}

/** POST {token} grant_type=refresh_token. The answer's refresh token replaces the old one at once (Airwallex rotates). */
export function refreshTokens(f: typeof fetch, p: OAuthProvider, c: OAuthClient, refreshToken: string): Promise<TokenSet> {
  return tokenCall(f, p, c, { grant_type: "refresh_token", refresh_token: refreshToken }, `${p.name} token refresh`);
}

/** RFC 7009 revocation where the provider documents it (Moneybird: one call ends both tokens). False when none exists. */
export async function revokeToken(f: typeof fetch, p: OAuthProvider, c: OAuthClient, token: string): Promise<boolean> {
  if (!p.revokeUrl) return false;
  const basic = p.clientAuth === "basic";
  const res = await f(p.revokeUrl, {
    method: "POST",
    headers: { "content-type": p.revokeJson ? "application/json" : "application/x-www-form-urlencoded", accept: "application/json", ...(basic ? { authorization: basicAuth(c) } : {}) },
    body: p.revokeJson ? JSON.stringify({ token }) : new URLSearchParams(basic ? { token } : { client_id: c.clientId, client_secret: c.clientSecret, token }).toString(),
  });
  if (!res.ok) throw new OAuthRefused(res.status, "", `${p.name} revoke`);
  return true;
}
