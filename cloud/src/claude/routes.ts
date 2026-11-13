// Connect Claude (docs/connect-claude.md): the route table's block for it, handed the table's own helpers by
// cloud/src/app.ts (which imports this file, so this file cannot import it).
//
//   Connector tokens: an owner makes one in Purser Cloud (a signed-in owner only: making one is the company's consent),
//   sees it once, and revokes it there. A token is an API key with the read scope and purpose 'claude' (reads) or
//   'claude-propose' (also files an invoice's payment for the CFO's approval). It is stored as the hash of its secret
//   like every key, expires (90 days unless made with fewer), and works at /mcp only.
//   /mcp: the MCP server (./mcp.ts). The demo company's public token reads the demo company and nothing else.
//   OAuth (./oauth.ts): for claude.ai's custom connectors, which connect by address and sign in by OAuth.

import { z } from "zod";
import { AuthError, KEY_MAX_DAYS, newApiKey, type Caller } from "../auth.js";
import type { EngineApi } from "../engine/api.js";
import { DEMO_END, ensureDemoCompany, isDemoTenant } from "../guest/guest.js";
import type { Blobs, Sql } from "../store.js";
import type { TenantDb } from "../tenant.js";
import { connectPage } from "./connectPage.js";
import { mcpAnswer } from "./mcp.js";
import { ICON_ICO, ICON_PNG_180, ICON_PNG_512, ICON_SVG } from "../../../src/ui/brand/icons.gen.js";
import { type FetchDoc, authorizationServer, authorizeAsk, consent, consentPage, exchange, OAuthRefused, protectedResource, registerClient } from "./oauth.js";

export interface ClaudeCtx {
  env: { sql: Sql; blobs: Blobs; sessionSecret: string; origin: string; engine?: (tenantId: string) => EngineApi; outbound?: FetchDoc };
  req: Request;
  url: URL;
  now: Date;
  params: string[];
  caller: Caller | null;
  db: TenantDb | null;
}

export interface ClaudeKit<C extends ClaudeCtx> {
  json(status: number, body: unknown): Response;
  err(status: number, error: string): Response;
  body<T>(c: C, schema: z.ZodType<T>, maxBytes?: number): Promise<T>;
  text(c: C, maxBytes: number): Promise<string>;
}

export interface ClaudeRoute<C extends ClaudeCtx> { method: "GET" | "POST" | "DELETE"; path: string; summary: string; need: "public" | "read" | "admin"; run: (c: C) => Promise<Response> }

/** The paths outside /v1 this block answers (the rest of the site is the console's). */
export const isClaudePath = (p: string): boolean => p === "/mcp" || p === "/connect-ai" || p.startsWith("/oauth/") || p.startsWith("/.well-known/oauth-") || ICON_PATHS.includes(p);

/** Purser's mark (src/ui/brand/icons.gen.ts, the site header's, the same bytes the site serves): what a browser tab, a home screen and a connector show. */
const ICON_PATHS = ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/icon.png"];
const bytes = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
const icon = (body: string | Uint8Array<ArrayBuffer>, type: string) => new Response(body, { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
export { iconsOf } from "../brand.js";

/** What a 401 at /mcp says, so a client finds where to sign in (RFC 9728 section 5.1). */
export const mcpChallenge = (origin: string) => `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="purser"`;

const CONNECTOR_PURPOSES = ["claude", "claude-propose"];
const oauthError = (e: OAuthRefused) => new Response(JSON.stringify({ error: e.code, error_description: e.message }), { status: e.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** A token request's or registration's body: a form (as OAuth sends it) or JSON. */
async function formOf<C extends ClaudeCtx>(kit: ClaudeKit<C>, c: C): Promise<URLSearchParams> {
  const text = await kit.text(c, 20_000);
  if ((c.req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === "string") as [string, string][]);
    } catch {
      throw new OAuthRefused(400, "invalid_request", "the body is not JSON");
    }
  }
  return new URLSearchParams(text);
}

export function claudeRoutes<C extends ClaudeCtx>(kit: ClaudeKit<C>): ClaudeRoute<C>[] {
  const { json, err } = kit;
  const ownerSession = (c: C) => {
    if (c.caller!.kind !== "session" || c.caller!.role !== "owner") throw new AuthError(403, "only a signed-in owner makes or revokes a Claude connector token");
  };
  return [
    { method: "GET", path: "/v1/claude/connectors", summary: "The company's Claude connector tokens (never their secrets): name, whether it may propose payments, when made, when it expires, when last used, whether revoked.", need: "admin", run: async (c) => {
      const rows = await c.db!.select<{ id: string; name: string; purpose: string; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null }>("api_keys", { purpose: { in: CONNECTOR_PURPOSES } }, { order: ["created_at"] });
      return json(200, { mcp_url: `${c.env.origin}/mcp`, items: rows.reverse().map((r) => ({ id: r.id, name: r.name, can_propose: r.purpose === "claude-propose", created_at: r.created_at, expires_at: r.expires_at, revoked_at: r.revoked_at, last_used_at: r.last_used_at })) });
    } },
    { method: "POST", path: "/v1/claude/connectors", summary: "Make a Claude connector token (a signed-in owner): { name, propose?, expires_in_days? }. It reads the books at /mcp; with propose it also files an invoice's payment for the CFO's approval, which only the CFO's Face ID gives. Returned once; only its hash is kept.", need: "admin", run: async (c) => {
      ownerSession(c);
      const b = await kit.body(c, z.object({ name: z.string().min(1).max(60), propose: z.boolean().optional(), expires_in_days: z.number().int().min(1).max(KEY_MAX_DAYS).optional() }).strict());
      const k = await newApiKey(c.db!, { name: b.name, scopes: ["read"], caller: c.caller!, purpose: b.propose ? "claude-propose" : "claude", ...(b.expires_in_days ? { expiresInDays: b.expires_in_days } : {}), now: c.now });
      return json(201, { id: k.id, token: k.key, can_propose: !!b.propose, expires_at: k.expires_at, mcp_url: `${c.env.origin}/mcp`, note: "shown once" });
    } },
    { method: "DELETE", path: "/v1/claude/connectors/{id}", summary: "Revoke a Claude connector token (a signed-in owner): Claude's connection with it, and every access token signed for it, ends at once.", need: "admin", run: async (c) => {
      ownerSession(c);
      const t = c.db!;
      const k = await t.one<{ purpose: string | null; revoked_at: string | null }>("api_keys", { id: c.params[0]! });
      if (!k || !CONNECTOR_PURPOSES.includes(k.purpose ?? "")) return err(404, "no Claude connector token");
      if (!k.revoked_at) await t.apply([t.update("api_keys", { id: c.params[0]! }, { revoked_at: c.now.toISOString() })]);
      return json(200, { id: c.params[0], revoked: true });
    } },

    { method: "POST", path: "/mcp", summary: "Purser as a remote MCP server (Streamable HTTP; JSON answers, no session) for Claude: read the books, and with a token made to propose, file an invoice's payment for the CFO's approval. Never approves or pays. A Claude connector token (or an access token from /oauth/token) as Authorization: Bearer; the demo company's public token reads the demo company.", need: "read", run: async (c) => {
      const caller = c.caller!;
      const demo = isDemoTenant(caller.tenantId);
      if (demo) await ensureDemoCompany(c.env.sql, c.env.blobs, c.now);
      const company = (await c.env.sql.first<{ name: string }>("SELECT name FROM tenants WHERE id = ?", [caller.tenantId]))?.name ?? "the company";
      const out = await mcpAnswer({ origin: c.env.origin, caller, db: c.db!, now: demo ? new Date(DEMO_END) : c.now, company, engine: demo ? null : (c.env.engine?.(caller.tenantId) ?? null), demo }, await kit.text(c, 1_000_000), c.req.headers);
      return out.status === 202 ? new Response(null, { status: 202 }) : json(out.status, out.body);
    } },

    { method: "GET", path: "/connect-ai", summary: "How to connect each AI client (Claude, ChatGPT, Cursor, VS Code, Gemini CLI, Windsurf) to /mcp: a tab per client with an exact config or a one-click install link.", need: "public", run: async (c) => connectPage(c.env.origin) },
    { method: "GET", path: "/favicon.ico", summary: "Purser's icon (ICO, 32 and 48 px).", need: "public", run: async () => icon(bytes(ICON_ICO), "image/x-icon") },
    { method: "GET", path: "/favicon.svg", summary: "Purser's icon (SVG).", need: "public", run: async () => icon(ICON_SVG, "image/svg+xml") },
    { method: "GET", path: "/apple-touch-icon.png", summary: "Purser's icon for a home screen (PNG, 180 px).", need: "public", run: async () => icon(bytes(ICON_PNG_180), "image/png") },
    { method: "GET", path: "/icon.png", summary: "Purser's icon (PNG, 512 px): the MCP server's and the OAuth sign-in's.", need: "public", run: async () => icon(bytes(ICON_PNG_512), "image/png") },

    { method: "GET", path: "/.well-known/oauth-protected-resource", summary: "OAuth protected resource metadata (RFC 9728) for /mcp: this cloud is its authorization server.", need: "public", run: async (c) => json(200, protectedResource(c.env.origin)) },
    { method: "GET", path: "/.well-known/oauth-protected-resource/mcp", summary: "The same metadata at the path RFC 9728 derives from /mcp.", need: "public", run: async (c) => json(200, protectedResource(c.env.origin)) },
    { method: "GET", path: "/.well-known/oauth-authorization-server", summary: "OAuth authorization server metadata (RFC 8414): registration, the consent page and the token endpoint; PKCE S256; public clients.", need: "public", run: async (c) => json(200, authorizationServer(c.env.origin)) },
    { method: "POST", path: "/oauth/register", summary: "Dynamic client registration (RFC 7591) for a public client: { redirect_uris, client_name? }; its id is signed, nothing is stored.", need: "public", run: async (c) => {
      try {
        let b: unknown;
        try { b = JSON.parse(await kit.text(c, 20_000)); } catch { throw new OAuthRefused(400, "invalid_client_metadata", "the body is not JSON"); }
        return json(201, await registerClient(c.env.sessionSecret, b));
      } catch (e) {
        if (e instanceof OAuthRefused) return oauthError(e);
        throw e;
      }
    } },
    { method: "GET", path: "/oauth/authorize", summary: "The consent page: connect Claude with a connector token made in Purser Cloud, or open the demo company (read only). PKCE S256 required.", need: "public", run: async (c) => {
      try {
        const { ask, client } = await authorizeAsk(c.env.sessionSecret, c.env.origin, c.url.searchParams, c.env.outbound, c.now);
        return await consentPage(c.env.sessionSecret, ask, client, c.env.origin, c.now);
      } catch (e) {
        if (e instanceof OAuthRefused) return err(400, `${e.code}: ${e.message}`);
        throw e;
      }
    } },
    { method: "POST", path: "/oauth/authorize", summary: "The consent page's answer: the form's own token (signed, bound to this request, ten minutes, good once), then a live connector token (or the demo), then back to the client with a one-time code (five minutes).", need: "public", run: async (c) => {
      try {
        const out = await consent(c.env.sql, c.env.sessionSecret, c.env.origin, new URLSearchParams(await kit.text(c, 20_000)), c.now, c.env.outbound);
        return "page" in out ? out.page : new Response(null, { status: 303, headers: { location: out.redirect, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      } catch (e) {
        if (e instanceof OAuthRefused) return err(400, `${e.code}: ${e.message}`);
        throw e;
      }
    } },
    { method: "POST", path: "/oauth/token", summary: "A code and its PKCE verifier for an access token (authorization_code, public client). The token names the connector token it was issued for, never its secret; revoking that ends it.", need: "public", run: async (c) => {
      try {
        return json(200, await exchange(c.env.sql, c.env.sessionSecret, c.env.origin, await formOf(kit, c), c.now, c.env.outbound));
      } catch (e) {
        if (e instanceof OAuthRefused) return oauthError(e);
        throw e;
      }
    } },
  ];
}
