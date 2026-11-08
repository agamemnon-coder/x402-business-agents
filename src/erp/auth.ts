// How each ERP connector gets a token. Credentials come only from the environment; nothing here logs a token.
//
// Exact Online (support.exactonline.com, "Step 3. Get and use access tokens" and "Step 4"): OAuth 2.0 authorization
// code; the access token lives 600 seconds and may only be refreshed in its last 30 seconds (a refresh before that is
// refused with 401 "Access Token not expired"); every refresh returns a new refresh token and invalidates the old one,
// and a refresh token unused for 30 days expires. So the rotating refresh token is kept in a file outside git
// (data/erp/exact.token.json, mode 600), seeded once from ERP_EXACT_REFRESH_TOKEN.
//
// Business Central (learn.microsoft.com, "Using service to service authentication"): Microsoft Entra client
// credentials, token URL https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token, scope
// https://api.businesscentral.dynamics.com/.default, application permission API.ReadWrite.All.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorForStatus, ErpError, type Transport } from "./connector.js";

export interface TokenProvider {
  token(): Promise<string>;
  /** Forget the cached access token (after a 401), so the next call gets a new one if it may. */
  invalidate(): void;
}

export interface StoredTokens { access_token?: string; expires_at?: number; refresh_token: string }
export interface TokenStore { load(): StoredTokens | null; save(t: StoredTokens): void }

/** A token file outside git, readable by its owner only. */
export function fileTokenStore(path: string): TokenStore {
  return {
    load: () => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as StoredTokens) : null),
    save: (t) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(t), { mode: 0o600 });
      chmodSync(path, 0o600);
    },
  };
}

export function memoryTokenStore(initial: StoredTokens | null = null): TokenStore & { current(): StoredTokens | null } {
  let t = initial;
  return { load: () => t, save: (x) => { t = x; }, current: () => t };
}

const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

async function postToken(transport: Transport, url: string, body: Record<string, string>, where: string): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const res = await transport.send({ method: "POST", url, headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form(body) });
  if (res.status !== 200) {
    // The body of a refused token request can echo what was sent; only its error code is kept.
    let code = "";
    try { code = String((JSON.parse(res.body) as { error?: unknown }).error ?? ""); } catch { /* not JSON */ }
    const e = errorForStatus(res.status, res.headers, where, code);
    throw res.status === 400 ? new ErpError("auth", e.message, { status: 400 }) : e;
  }
  const j = JSON.parse(res.body) as { access_token?: string; expires_in?: number | string; refresh_token?: string };
  if (!j.access_token) throw new ErpError("auth", `${where}: no access token in the answer`);
  return { access_token: j.access_token, expires_in: Number(j.expires_in ?? 600), ...(j.refresh_token ? { refresh_token: j.refresh_token } : {}) };
}

/** Exact Online: refresh only in the token's last 30 seconds; save the rotated refresh token before using the new access token. */
export function exactTokens(o: { baseUrl: string; clientId: string; clientSecret: string; store: TokenStore; seedRefreshToken?: string; transport: Transport; now?: () => number }): TokenProvider {
  const now = o.now ?? Date.now;
  return {
    async token() {
      const t = o.store.load() ?? (o.seedRefreshToken ? { refresh_token: o.seedRefreshToken } : null);
      if (!t) throw new ErpError("config", "no Exact Online refresh token: set ERP_EXACT_REFRESH_TOKEN once, from the authorization step");
      // Valid for more than 30 more seconds: use it (Exact refuses a refresh before then).
      if (t.access_token && t.expires_at && t.expires_at - now() > 30_000) return t.access_token;
      const r = await postToken(o.transport, `${o.baseUrl}/api/oauth2/token`, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: o.clientId, client_secret: o.clientSecret }, "Exact Online token");
      // The old refresh token is now invalid: keep the new one first, whatever happens next.
      o.store.save({ access_token: r.access_token, expires_at: now() + r.expires_in * 1000, refresh_token: r.refresh_token ?? t.refresh_token });
      return r.access_token;
    },
    invalidate() {
      const t = o.store.load();
      if (t) o.store.save({ refresh_token: t.refresh_token });
    },
  };
}

/** Business Central: client credentials, cached until a minute before it expires. */
export function entraTokens(o: { tenantId: string; clientId: string; clientSecret: string; transport: Transport; now?: () => number; authority?: string }): TokenProvider {
  const now = o.now ?? Date.now;
  let cached: { token: string; until: number } | null = null;
  return {
    async token() {
      if (cached && cached.until > now()) return cached.token;
      const r = await postToken(o.transport, `${o.authority ?? "https://login.microsoftonline.com"}/${encodeURIComponent(o.tenantId)}/oauth2/v2.0/token`,
        { grant_type: "client_credentials", client_id: o.clientId, client_secret: o.clientSecret, scope: "https://api.businesscentral.dynamics.com/.default" }, "Microsoft Entra token");
      cached = { token: r.access_token, until: now() + Math.max(0, r.expires_in - 60) * 1000 };
      return r.access_token;
    },
    invalidate() { cached = null; },
  };
}

/** A fixed token (tests and dry runs). */
export function staticToken(token = "dry-run-token"): TokenProvider {
  return { token: async () => token, invalidate: () => {} };
}
