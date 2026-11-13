// Connect Claude, the sign-in part: OAuth 2.1 as the MCP authorization spec asks, so claude.ai can add Purser as a custom
// connector by its address alone. Claude Code and Claude Desktop can also send a connector token as a bearer header and
// skip this.
//
//   GET  /.well-known/oauth-protected-resource      (RFC 9728) /mcp is protected by this cloud's own authorization server
//   GET  /.well-known/oauth-authorization-server    (RFC 8414) where to register, authorize and get a token
//   POST /oauth/register                            (RFC 7591) a public client: its redirect addresses, signed into its id
//   GET  /oauth/authorize                           the consent page: paste a connector token, or open the demo company
//   POST /oauth/authorize                           checks the token, then sends the browser back with a one-time code
//   POST /oauth/token                               the code and its PKCE verifier (S256) for an access token
//
// No new secret is kept anywhere: the client's id is signed, not stored; a code is stored as its hash, five minutes,
// good once; the access token is signed and names the connector key it is for (never its secret), so revoking that key
// in Purser Cloud ends the connection at once. The consent page asks for a connector token made in Purser Cloud
// (Settings, Connect Claude), so whoever connects Claude already holds the company's own consent for it.

import { accessToken, ACCESS_TOKEN_TTL_MS, AuthError, callerOf, DEMO_CONNECTOR_TOKEN, isConnector } from "../auth.js";
import { hmacB64u, hmacValid, randomToken, sha256Hex, toB64u, fromB64 } from "../crypto.js";
import type { Sql } from "../store.js";

export const CODE_TTL_MS = 5 * 60 * 1000;
/** How long the consent page's form is good for: one answer, within ten minutes. */
export const CONSENT_TTL_MS = 10 * 60 * 1000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function resourceOf(origin: string): string { return `${origin}/mcp`; }

export function protectedResource(origin: string): Record<string, unknown> {
  return { resource: resourceOf(origin), authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: ["purser"], resource_name: "Purser" };
}

export function authorizationServer(origin: string): Record<string, unknown> {
  return {
    issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["purser"],
  };
}

export class OAuthRefused extends Error {
  constructor(readonly status: 400 | 401, readonly code: string, message: string) { super(message); }
}

/** A redirect address a client may register: https anywhere, or http on this machine (a desktop client's loopback). */
function goodRedirect(u: string): boolean {
  if (u.length > 500) return false;
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
}

interface Client { n: string; r: string[] }

/** RFC 7591: the client's name and redirect addresses, signed into its id. Nothing is stored. */
export async function registerClient(secret: string, body: unknown): Promise<Record<string, unknown>> {
  const b = (body && typeof body === "object" ? body : {}) as { redirect_uris?: unknown; client_name?: unknown };
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > 5 || !uris.every((u) => typeof u === "string" && goodRedirect(u))) throw new OAuthRefused(400, "invalid_redirect_uri", "redirect_uris: 1 to 5 https addresses (or http on localhost)");
  const name = typeof b.client_name === "string" ? [...b.client_name].filter((ch) => ch >= " " && ch !== "\u007f").join("").slice(0, 60) : "";
  const client: Client = { n: name || "An MCP client", r: uris as string[] };
  const body64 = toB64u(enc.encode(JSON.stringify(client)));
  const client_id = `pcc.${body64}.${await hmacB64u(`client:${secret}`, body64)}`;
  return { client_id, client_name: client.n, redirect_uris: client.r, grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" };
}

export async function clientOf(secret: string, clientId: string): Promise<Client> {
  const [tag, body, sig] = clientId.split(".");
  if (tag !== "pcc" || !body || !sig || clientId.length > 4000 || !(await hmacValid(`client:${secret}`, body, sig))) throw new OAuthRefused(401, "invalid_client", "unknown client: register first");
  try {
    const c = JSON.parse(dec.decode(fromB64(body))) as Client;
    if (typeof c.n !== "string" || !Array.isArray(c.r)) throw new Error("shape");
    return c;
  } catch {
    throw new OAuthRefused(401, "invalid_client", "unknown client: register first");
  }
}

export interface AuthorizeAsk { client_id: string; redirect_uri: string; state: string; code_challenge: string; resource: string }

/** What an authorize request asks, checked: a registered client, one of its redirect addresses, PKCE S256, this resource. */
export async function authorizeAsk(secret: string, origin: string, q: URLSearchParams): Promise<{ ask: AuthorizeAsk; client: Client }> {
  const client = await clientOf(secret, q.get("client_id") ?? "");
  const redirect = q.get("redirect_uri") ?? (client.r.length === 1 ? client.r[0]! : "");
  if (!client.r.includes(redirect)) throw new OAuthRefused(400, "invalid_request", "redirect_uri is not one this client registered");
  if (q.get("response_type") !== "code") throw new OAuthRefused(400, "unsupported_response_type", "response_type must be code");
  const challenge = q.get("code_challenge") ?? "";
  if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) throw new OAuthRefused(400, "invalid_request", "PKCE is required: code_challenge with code_challenge_method S256");
  const resource = q.get("resource") ?? resourceOf(origin);
  if (resource !== resourceOf(origin) && resource !== origin) throw new OAuthRefused(400, "invalid_target", `resource must be ${resourceOf(origin)}`);
  const state = (q.get("state") ?? "").slice(0, 500);
  return { ask: { client_id: q.get("client_id")!, redirect_uri: redirect, state, code_challenge: challenge, resource }, client };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Where the browser goes back to: the client's own redirect address with the code (or the error) and the state. */
export function backTo(ask: AuthorizeAsk, origin: string, add: Record<string, string>): string {
  const u = new URL(ask.redirect_uri);
  for (const [k, v] of Object.entries(add)) u.searchParams.set(k, v);
  if (ask.state) u.searchParams.set("state", ask.state);
  u.searchParams.set("iss", origin);
  return u.toString();
}

/** What a consent form is bound to: this client, its redirect address, its PKCE challenge, its state and the resource. */
const bindingOf = (ask: AuthorizeAsk) => sha256Hex(JSON.stringify([ask.client_id, ask.redirect_uri, ask.code_challenge, ask.state, ask.resource]));

/**
 * The consent form's own token. The page is reached through a chain of redirects from the client (claude.ai, often in an
 * app's own browser), and its POST may carry Origin: null, so the Origin check cannot hold its forms; this does instead.
 * It is signed by Purser, bound to this authorization request, good for ten minutes and spent on its first use, so a page
 * elsewhere cannot answer the consent for a person, and an answer cannot be replayed.
 */
export async function consentToken(secret: string, ask: AuthorizeAsk, now: Date): Promise<string> {
  const body = toB64u(enc.encode(JSON.stringify({ b: await bindingOf(ask), n: randomToken(16), exp: now.getTime() + CONSENT_TTL_MS })));
  return `pcf.${body}.${await hmacB64u(`consent:${secret}`, body)}`;
}

/** Checks a consent form's token for this request and spends it; false when it is missing, forged, for another request, expired or used. */
async function spendConsentToken(sql: Sql, secret: string, ask: AuthorizeAsk, token: string, now: Date): Promise<boolean> {
  const [tag, body, sig] = token.split(".");
  if (tag !== "pcf" || !body || !sig || token.length > 1000 || !(await hmacValid(`consent:${secret}`, body, sig))) return false;
  let p: { b: string; n: string; exp: number };
  try { p = JSON.parse(dec.decode(fromB64(body))) as typeof p; } catch { return false; }
  if (typeof p.exp !== "number" || p.exp <= now.getTime() || p.b !== (await bindingOf(ask))) return false;
  await sql.run("DELETE FROM oauth_consents WHERE expires_at < ?", [now.getTime()]);
  const spent = await sql.run("INSERT OR IGNORE INTO oauth_consents (token_sha256, expires_at) VALUES (?, ?)", [await sha256Hex(token), p.exp]);
  return spent.changes === 1;
}

/** The consent page (no script; one form). Its CSP lets the form go to this page and, after it, to the client's address. */
export async function consentPage(secret: string, ask: AuthorizeAsk, client: Client, origin: string, now: Date, error = "", status = 401): Promise<Response> {
  const nonce = randomToken(12);
  const form = await consentToken(secret, ask, now);
  const hidden = [...(Object.entries(ask) as [string, string][]), ["consent", form] as [string, string]].map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Claude to Purser</title><meta name="robots" content="noindex">
<style nonce="${nonce}">
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#0f172a;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:480px;margin:6vh auto;padding:0 16px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 14px;color:#334155}.who{font-weight:600;color:#0f172a}ul{margin:0 0 18px;padding-left:20px;color:#334155}li{margin:4px 0}
label{display:block;font-weight:600;margin:0 0 6px}input[type=password]{width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font:14px ui-monospace,monospace}
button{font:600 15px system-ui,sans-serif;border-radius:10px;padding:11px 16px;cursor:pointer;border:1px solid #4f46e5;background:#4f46e5;color:#fff;width:100%;margin-top:12px}
button.ghost{background:#fff;color:#4f46e5}button.plain{background:none;border:0;color:#64748b;font-weight:500}.or{display:flex;align-items:center;gap:10px;color:#94a3b8;margin:18px 0 0;font-size:13px}
.or:before,.or:after{content:"";flex:1;height:1px;background:#e5e7eb}.err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:10px 12px;margin:0 0 14px}
.small{font-size:13px;color:#64748b;margin-top:16px}.brand{font-weight:700;letter-spacing:-.01em;margin:0 0 18px;color:#0f172a}
</style></head><body><main><div class="brand">Purser</div><div class="card">
<h1>Connect Claude to Purser</h1>
<p><span class="who">${esc(client.n)}</span> asks to use your company's Purser. It says it is a Claude client; Purser cannot check a client's name.</p>
<ul><li>It reads your books: invoices, money movements, reports and what your agents decided.</li>
<li>With a token made to propose, it can file an invoice's payment for approval. It can never approve or pay: every payment needs the CFO's Face ID in Purser Cloud.</li>
<li>Revoke the token in Purser Cloud and the connection ends at once.</li></ul>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
<form method="post" action="/oauth/authorize">${hidden}
<label for="token">Your Claude connector token</label>
<input id="token" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="pck_…" required>
<button type="submit" name="act" value="connect">Connect</button></form>
<div class="or">or</div>
<form method="post" action="/oauth/authorize">${hidden}<button class="ghost" type="submit" name="act" value="demo">Use the demo company (read only, made-up data)</button></form>
<form method="post" action="/oauth/authorize">${hidden}<button class="plain" type="submit" name="act" value="deny">Cancel</button></form>
<p class="small">Make a token in Purser Cloud: Settings, Connect Claude. Only an owner can make one.</p>
</div></main></body></html>`;
  const formTo = new URL(ask.redirect_uri).origin;
  return new Response(html, {
    status: error ? status : 200,
    headers: {
      // same-origin, not no-referrer: under no-referrer a browser sends the form's POST with Origin: null.
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "same-origin",
      "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self' ${formTo}; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

/**
 * The consent page's answer. connect: the pasted token must be a live Claude connector token (not any other key);
 * demo: the demo company's public read-only token. Either way the browser goes back with a one-time code.
 */
export async function consent(sql: Sql, secret: string, origin: string, form: URLSearchParams, now: Date): Promise<{ redirect: string } | { page: Response }> {
  const { ask, client } = await authorizeAsk(secret, origin, new URLSearchParams({ ...Object.fromEntries(form), response_type: "code", code_challenge_method: "S256" }));
  // The form's own token, spent here whatever the answer: without it nothing happens, not even a cancel.
  if (!(await spendConsentToken(sql, secret, ask, form.get("consent") ?? "", now))) {
    return { page: await consentPage(secret, ask, client, origin, now, "This page expired or was already used. Choose again below.", 403) };
  }
  const act = form.get("act");
  if (act === "deny") return { redirect: backTo(ask, origin, { error: "access_denied" }) };
  let tenant: string, keyId: string;
  if (act === "demo") {
    tenant = "demo"; keyId = "demo";
  } else {
    const token = (form.get("token") ?? "").trim();
    let ok: { tenantId: string; principal: string } | null = null;
    try {
      const c = await callerOf(sql, secret, `Bearer ${token}`, now);
      if (c.kind === "key" && token.startsWith("pck_") && isConnector(c.purpose)) ok = { tenantId: c.tenantId, principal: c.principal };
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
    }
    if (!ok) return { page: await consentPage(secret, ask, client, origin, now, "That is not a live Claude connector token. Make one in Purser Cloud (Settings, Connect Claude); an ordinary API key is not one.") };
    tenant = ok.tenantId; keyId = ok.principal;
  }
  const code = randomToken(32);
  await sql.run("DELETE FROM oauth_codes WHERE expires_at < ?", [now.getTime() - CODE_TTL_MS]);
  await sql.run("INSERT INTO oauth_codes (code_sha256, tenant_id, key_id, client_id_sha256, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [await sha256Hex(code), tenant, keyId, await sha256Hex(ask.client_id), ask.redirect_uri, ask.code_challenge, now.getTime() + CODE_TTL_MS]);
  return { redirect: backTo(ask, origin, { code }) };
}

/** POST /oauth/token: the code, once, from the client it was issued to, with the verifier of its PKCE challenge. */
export async function exchange(sql: Sql, secret: string, origin: string, form: URLSearchParams, now: Date): Promise<Record<string, unknown>> {
  if (form.get("grant_type") !== "authorization_code") throw new OAuthRefused(400, "unsupported_grant_type", "grant_type must be authorization_code");
  const code = form.get("code") ?? "", verifier = form.get("code_verifier") ?? "", clientId = form.get("client_id") ?? "";
  await clientOf(secret, clientId);
  const resource = form.get("resource");
  if (resource && resource !== resourceOf(origin) && resource !== origin) throw new OAuthRefused(400, "invalid_target", `resource must be ${resourceOf(origin)}`);
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthRefused(400, "invalid_request", "code_verifier: 43 to 128 characters");
  const hash = await sha256Hex(code);
  // Spent first, in one statement: two requests with one code cannot both get a token.
  const spent = await sql.run("UPDATE oauth_codes SET used_at = ? WHERE code_sha256 = ? AND used_at IS NULL AND expires_at > ?", [now.getTime(), hash, now.getTime()]);
  const row = await sql.first<{ tenant_id: string; key_id: string; client_id_sha256: string; redirect_uri: string; code_challenge: string; used_at: number | null }>(
    "SELECT tenant_id, key_id, client_id_sha256, redirect_uri, code_challenge, used_at FROM oauth_codes WHERE code_sha256 = ?", [hash]);
  if (spent.changes === 0 || !row || row.used_at !== now.getTime()) throw new OAuthRefused(400, "invalid_grant", "the code is unknown, used or expired");
  const challenge = toB64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
  if (row.client_id_sha256 !== (await sha256Hex(clientId)) || (form.get("redirect_uri") ?? row.redirect_uri) !== row.redirect_uri || challenge !== row.code_challenge) {
    throw new OAuthRefused(400, "invalid_grant", "the code was not issued to this client, this address or this verifier");
  }
  if (row.key_id === "demo") return { access_token: DEMO_CONNECTOR_TOKEN, token_type: "Bearer", scope: "purser" };
  const key = await sql.first<{ expires_at: string | null; revoked_at: string | null }>("SELECT expires_at, revoked_at FROM api_keys WHERE tenant_id = ? AND id = ?", [row.tenant_id, row.key_id]);
  if (!key || key.revoked_at || !key.expires_at) throw new OAuthRefused(400, "invalid_grant", "the connector token was revoked");
  const exp = Math.min(now.getTime() + ACCESS_TOKEN_TTL_MS, Date.parse(key.expires_at));
  if (exp <= now.getTime()) throw new OAuthRefused(400, "invalid_grant", "the connector token expired");
  return { access_token: await accessToken(secret, { keyId: row.key_id, clientId, expiresAt: exp }), token_type: "Bearer", expires_in: Math.floor((exp - now.getTime()) / 1000), scope: "purser" };
}
