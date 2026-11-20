// Connect Claude's block of the route table (cloud/src/claude/routes.ts) run with the table's own helpers on the cloud's
// database in memory: the token endpoint's JSON body, the connector tokens' expiry and revocation answers, /mcp for a
// company the database no longer names and a cloud with no engine, /mcp/airwallex refusing the demo's token and
// slowing a token past its minute's reads, and an OAuth route whose database fails answering a failure, not an OAuth
// refusal. The whole flow behind the cloud's gates runs in test/cloud-claude.test.ts.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ensureSchema } from "../cloud/src/app.js";
import type { Caller } from "../cloud/src/auth.js";
import { AWX_MCP_PATH, AWX_MCP_PER_MINUTE, claudeRoutes, type ClaudeCtx } from "../cloud/src/claude/routes.js";
import { registerClient } from "../cloud/src/claude/oauth.js";
import { toB64u } from "../cloud/src/crypto.js";
import { dirBlobs, sqliteSql } from "../cloud/src/node.js";
import type { Sql } from "../cloud/src/store.js";
import { TenantDb } from "../cloud/src/tenant.js";

const SECRET = "s".repeat(48);
const ORIGIN = "https://cloud.test";
const TENANT = "t_claudeunit1";
const NOW = new Date("2026-11-20T09:00:00Z");
type Json = Record<string, unknown>;

let sql: ReturnType<typeof sqliteSql>;
beforeAll(async () => {
  sql = sqliteSql(":memory:");
  await ensureSchema(sql);
  await sql.run("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, 'claude-unit', 'Unit BV', 'en', '2026-11-01')", [TENANT]);
  await sql.run("INSERT INTO users (tenant_id, id, display_name, role, created_at) VALUES (?, 'u_owner', 'Olga Owner', 'owner', '2026-11-01')", [TENANT]);
  for (const [id, purpose, revoked] of [["kConn00000001", "claude", null], ["kConn00000002", "claude-propose", "2026-11-19T00:00:00Z"], ["kPlain0000001", null, null]] as const) {
    await sql.run("INSERT INTO api_keys (id, tenant_id, name, scopes, secret_sha256, created_by, purpose, created_at, expires_at, revoked_at) VALUES (?, ?, ?, 'read', ?, 'u_owner', ?, '2026-11-01', '2027-01-01T00:00:00Z', ?)", [id, TENANT, id, "0".repeat(64), purpose, revoked]);
  }
});
afterAll(() => sql.close());

const kit = {
  json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  err: (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } }),
  body: async <T>(c: ClaudeCtx, schema: z.ZodType<T>) => schema.parse(await c.req.json()),
  text: async (c: ClaudeCtx) => c.req.text(),
};
const owner: Caller = { tenantId: TENANT, kind: "session", principal: "u_owner", user: "u_owner", role: "owner", scopes: new Set(["read", "admin"]) as Caller["scopes"] };
const connector = (purpose = "claude", tenantId = TENANT): Caller => ({ tenantId, kind: "key", principal: "kConn00000001", user: "u_owner", purpose, scopes: new Set(["read"]) as Caller["scopes"] });

async function run(o: { method: "GET" | "POST" | "DELETE"; path: string; params?: string[]; body?: string; contentType?: string; caller?: Caller | null; sql?: Sql; engine?: boolean }): Promise<{ status: number; json: Json; res: Response }> {
  const route = claudeRoutes<ClaudeCtx>(kit).find((r) => r.method === o.method && r.path === o.path)!;
  const url = new URL(`${ORIGIN}${o.path}`);
  const req = new Request(url, { method: o.method, ...(o.body !== undefined ? { body: o.body, headers: { "content-type": o.contentType ?? "application/json" } } : {}) });
  const caller = o.caller === undefined ? owner : o.caller;
  const c: ClaudeCtx = {
    env: { sql: o.sql ?? sql, blobs: dirBlobs("/nonexistent-blobs-never-written"), sessionSecret: SECRET, origin: ORIGIN },
    req, url, now: NOW, params: o.params ?? [], caller, db: caller ? new TenantDb(o.sql ?? sql, caller.tenantId) : null,
  };
  const res = await route.run(c);
  const text = await res.clone().text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { /* not JSON */ }
  return { status: res.status, json, res };
}

describe("connector tokens", () => {
  it("made with an expiry of its own", async () => {
    const r = await run({ method: "POST", path: "/v1/claude/connectors", body: JSON.stringify({ name: "Claude (a week)", expires_in_days: 7 }) });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ can_propose: false, expires_at: "2026-11-27T09:00:00.000Z", mcp_url: `${ORIGIN}/mcp`, note: "shown once" });
  });

  it("revoking: an unknown id or a key that is not a connector's is 404; one already revoked stays as it was", async () => {
    expect(await run({ method: "DELETE", path: "/v1/claude/connectors/{id}", params: ["kNothere00001"] })).toMatchObject({ status: 404, json: { error: "no Claude connector token" } });
    expect((await run({ method: "DELETE", path: "/v1/claude/connectors/{id}", params: ["kPlain0000001"] })).status).toBe(404);
    expect(await run({ method: "DELETE", path: "/v1/claude/connectors/{id}", params: ["kConn00000002"] })).toMatchObject({ status: 200, json: { revoked: true } });
    expect((await sql.first<{ revoked_at: string }>("SELECT revoked_at FROM api_keys WHERE id = 'kConn00000002'"))!.revoked_at).toBe("2026-11-19T00:00:00Z");
    expect(await run({ method: "DELETE", path: "/v1/claude/connectors/{id}", params: ["kConn00000001"] })).toMatchObject({ status: 200 });
    expect((await sql.first<{ revoked_at: string }>("SELECT revoked_at FROM api_keys WHERE id = 'kConn00000001'"))!.revoked_at).toBe(NOW.toISOString());
  });
});

describe("/mcp and /mcp/airwallex", () => {
  it("/mcp for a company the database no longer names, on a cloud without an engine: it still answers, as 'the company', and proposes nothing", async () => {
    const gone = { ...connector("claude-propose", "t_goneaway01") };
    const init = await run({ method: "POST", path: "/mcp", caller: gone, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    expect((init.json.result as { instructions: string }).instructions).toMatch(/^You are connected to Purser for the company\./);
    const call = await run({ method: "POST", path: "/mcp", caller: gone, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "propose_invoice_payment", arguments: { invoice_id: "AP-0001" } } }) });
    expect(JSON.stringify(call.json)).toContain("runner_only");
    expect((await run({ method: "POST", path: "/mcp", caller: gone, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) })).status).toBe(202);
  });

  it("/mcp/airwallex: not with the demo's public token; past the minute's reads, 429; a notification is taken", async () => {
    expect(await run({ method: "POST", path: AWX_MCP_PATH, caller: connector("claude-demo"), body: "{}" })).toMatchObject({ status: 403 });
    const reader = connector("claude");
    const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    for (let i = 0; i < AWX_MCP_PER_MINUTE; i++) expect((await run({ method: "POST", path: AWX_MCP_PATH, caller: reader, body: ping })).status).toBe(200);
    expect(await run({ method: "POST", path: AWX_MCP_PATH, caller: reader, body: ping })).toMatchObject({ status: 429, json: { error: "too many Airwallex reads; wait a minute" } });
    const other = { ...connector("claude"), principal: "kOther0000001" };
    expect((await run({ method: "POST", path: AWX_MCP_PATH, caller: other, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) })).status).toBe(202);
  });
});

describe("the OAuth routes", () => {
  it("the token endpoint takes JSON as well as a form (only its string values), and says when the JSON is not JSON", async () => {
    const bad = await run({ method: "POST", path: "/oauth/token", caller: null, body: "{nope" });
    expect(bad).toMatchObject({ status: 400, json: { error: "invalid_request", error_description: "the body is not JSON" } });
    const grant = await run({ method: "POST", path: "/oauth/token", caller: null, body: JSON.stringify({ grant_type: "authorization_code", code: 5 }) });
    expect(grant.json).toMatchObject({ error: "invalid_client" });
    const form = await run({ method: "POST", path: "/oauth/token", caller: null, body: "grant_type=password", contentType: "application/x-www-form-urlencoded" });
    expect(form.json).toMatchObject({ error: "unsupported_grant_type" });
    expect(form.res.headers.get("cache-control")).toBe("no-store");
  });

  it("a database that fails is a failure of the request, on every route that touches it, not an OAuth refusal", async () => {
    const broken: Sql = { ...sql, run: async () => { throw new Error("D1 is away"); }, first: async () => { throw new Error("D1 is away"); }, all: async () => { throw new Error("D1 is away"); } };
    const client = (await registerClient(SECRET, { redirect_uris: ["https://claude.ai/cb"] })).client_id as string;
    const verifier = "v".repeat(50);
    const tokenForm = new URLSearchParams({ grant_type: "authorization_code", client_id: client, code: "c", code_verifier: verifier }).toString();
    await expect(run({ method: "POST", path: "/oauth/token", caller: null, sql: broken, body: tokenForm, contentType: "application/x-www-form-urlencoded" })).rejects.toThrow("D1 is away");
    const challenge = toB64u(createHash("sha256").update(verifier).digest());
    const { consentToken } = await import("../cloud/src/claude/oauth.js");
    const ask = { client_id: client, redirect_uri: "https://claude.ai/cb", state: "", code_challenge: challenge, resource: `${ORIGIN}/mcp` };
    const consentForm = new URLSearchParams({ ...ask, act: "deny", consent: await consentToken(SECRET, ask, NOW) }).toString();
    await expect(run({ method: "POST", path: "/oauth/authorize", caller: null, sql: broken, body: consentForm, contentType: "application/x-www-form-urlencoded" })).rejects.toThrow("D1 is away");
    // The same consent, on a database that works, sends the browser back with access_denied.
    const denied = await run({ method: "POST", path: "/oauth/authorize", caller: null, body: consentForm, contentType: "application/x-www-form-urlencoded" });
    expect(denied.status).toBe(303);
    expect(denied.res.headers.get("location")).toMatch(/^https:\/\/claude\.ai\/cb\?error=access_denied&iss=/);
  });
});
