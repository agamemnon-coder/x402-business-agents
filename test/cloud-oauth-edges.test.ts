// Connecting an AI by OAuth (cloud/src/claude/oauth.ts) at the edges the sign-in flow's own tests do not reach: the token
// exchange's every refusal (another client, address or verifier, a code used twice, a connector token revoked, without
// an expiry or expired), the demo's code, the consent form's answer without its form token or without a token, a
// database failure that is not dressed up as an OAuth error, a client's name escaped on the page, and the metadata
// documents' cache, which keeps at most 500 clients.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "../cloud/src/app.js";
import { ACCESS_TOKEN_TTL_MS, DEMO_CONNECTOR_TOKEN } from "../cloud/src/auth.js";
import { authorizeAsk, clientOf, consent, consentPage, consentToken, exchange, isCimdId, OAuthRefused, registerClient, resourceOf } from "../cloud/src/claude/oauth.js";
import { sha256Hex, toB64u } from "../cloud/src/crypto.js";
import { sqliteSql } from "../cloud/src/node.js";
import type { Sql } from "../cloud/src/store.js";

const SECRET = "oauth-edges-secret-0123456789";
const ORIGIN = "https://cloud.test";
const NOW = new Date("2026-11-20T09:00:00Z");
const TENANT = "t_oauthedge1";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(50);
const CHALLENGE = toB64u(createHash("sha256").update(VERIFIER).digest());

let sql: ReturnType<typeof sqliteSql>;
let clientId: string;

beforeAll(async () => {
  sql = sqliteSql(":memory:");
  await ensureSchema(sql);
  await sql.run("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, 'oauth-edge', 'Edge BV', 'en', '2026-11-01')", [TENANT]);
  const key = (id: string, o: { expires_at: string | null; revoked_at?: string | null }) => sql.run(
    "INSERT INTO api_keys (id, tenant_id, name, scopes, secret_sha256, created_by, purpose, created_at, expires_at, revoked_at) VALUES (?, ?, ?, 'read', ?, 'u_owner', 'claude', '2026-11-01', ?, ?)",
    [id, TENANT, id, "0".repeat(64), o.expires_at, o.revoked_at ?? null]);
  await key("kLive00000001", { expires_at: "2027-01-01T00:00:00Z" });
  await key("kSoon00000001", { expires_at: "2026-11-21T09:00:00Z" });
  await key("kGone00000001", { expires_at: "2027-01-01T00:00:00Z", revoked_at: "2026-11-19T00:00:00Z" });
  await key("kNoExp0000001", { expires_at: null });
  await key("kOld000000001", { expires_at: "2026-11-19T00:00:00Z" });
  clientId = (await registerClient(SECRET, { client_name: `<b>"Tom" & 'Jerry'</b>`, redirect_uris: [REDIRECT, "https://claude.ai/other"] })).client_id as string;
});
afterAll(() => sql.close());

/** A one-time code as consent stores it, for this key, client, address and challenge. */
async function codeFor(keyId: string, o: { client?: string; redirect?: string; challenge?: string; expiresAt?: number } = {}): Promise<string> {
  const code = `code-${keyId}-${Math.random().toString(36).slice(2)}`;
  await sql.run("INSERT INTO oauth_codes (code_sha256, tenant_id, key_id, client_id_sha256, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [await sha256Hex(code), keyId === "demo" ? "demo" : TENANT, keyId, await sha256Hex(o.client ?? clientId), o.redirect ?? REDIRECT, o.challenge ?? CHALLENGE, o.expiresAt ?? NOW.getTime() + 60_000]);
  return code;
}
const form = (o: Record<string, string>) => new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code_verifier: VERIFIER, redirect_uri: REDIRECT, ...o });
const refusal = (p: Promise<unknown>) => p.then(() => "accepted", (e: unknown) => (e instanceof OAuthRefused ? `${e.code}: ${e.message}` : `thrown: ${(e as Error).message}`));

describe("the token exchange", () => {
  it("an access token for a live connector token, until the earlier of 30 days and the token's own end; the demo's code gives the demo token", async () => {
    const t = await exchange(sql, SECRET, ORIGIN, form({ code: await codeFor("kLive00000001"), resource: resourceOf(ORIGIN) }), NOW);
    expect(t).toMatchObject({ token_type: "Bearer", scope: "purser", expires_in: ACCESS_TOKEN_TTL_MS / 1000 });
    const soon = await exchange(sql, SECRET, ORIGIN, form({ code: await codeFor("kSoon00000001"), resource: ORIGIN }), NOW);
    expect(soon.expires_in).toBe(86_400);
    expect(await exchange(sql, SECRET, ORIGIN, form({ code: await codeFor("demo") }), NOW)).toEqual({ access_token: DEMO_CONNECTOR_TOKEN, token_type: "Bearer", scope: "purser" });
    // Without redirect_uri the stored one stands.
    const f = form({ code: await codeFor("kLive00000001") });
    f.delete("redirect_uri");
    expect(await exchange(sql, SECRET, ORIGIN, f, NOW)).toHaveProperty("access_token");
  });

  it("refuses another grant, an unknown client, another resource and a verifier that is not one, before spending the code", async () => {
    const code = await codeFor("kLive00000001");
    expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code, grant_type: "refresh_token" }), NOW))).toBe("unsupported_grant_type: grant_type must be authorization_code");
    expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code, client_id: "pcc.forged.sig" }), NOW))).toMatch(/^invalid_client: /);
    expect(await refusal(exchange(sql, SECRET, ORIGIN, new URLSearchParams({ grant_type: "authorization_code" }), NOW))).toMatch(/^invalid_client: /);
    expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code, resource: "https://other.example/mcp" }), NOW))).toBe(`invalid_target: resource must be ${ORIGIN}/mcp`);
    expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code, code_verifier: "short" }), NOW))).toBe("invalid_request: code_verifier: 43 to 128 characters");
    const noVerifier = form({ code });
    noVerifier.delete("code_verifier");
    expect(await refusal(exchange(sql, SECRET, ORIGIN, noVerifier, NOW))).toMatch(/^invalid_request: /);
    // Still good: none of those spent it.
    expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code }), NOW))).toBe("accepted");
    expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code }), NOW))).toBe("invalid_grant: the code is unknown, used or expired");
    const noCode = form({});
    expect(await refusal(exchange(sql, SECRET, ORIGIN, noCode, NOW))).toBe("invalid_grant: the code is unknown, used or expired");
    expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code: await codeFor("kLive00000001", { expiresAt: NOW.getTime() }) }), NOW))).toBe("invalid_grant: the code is unknown, used or expired");
  });

  it("a code issued to another client, for another address or another verifier is refused, and spent", async () => {
    const other = (await registerClient(SECRET, { redirect_uris: [REDIRECT] })).client_id as string;
    for (const code of [await codeFor("kLive00000001", { client: other }), await codeFor("kLive00000001", { redirect: "https://claude.ai/other" }), await codeFor("kLive00000001", { challenge: "x".repeat(43) })]) {
      expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code }), NOW))).toBe("invalid_grant: the code was not issued to this client, this address or this verifier");
      expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code }), NOW))).toBe("invalid_grant: the code is unknown, used or expired");
    }
  });

  it("a connector token revoked, without an end, gone or expired gives no access token", async () => {
    for (const k of ["kGone00000001", "kNoExp0000001", "kNothere00001"]) {
      expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code: await codeFor(k) }), NOW)), k).toBe("invalid_grant: the connector token was revoked");
    }
    expect(await refusal(exchange(sql, SECRET, ORIGIN, form({ code: await codeFor("kOld000000001") }), NOW))).toBe("invalid_grant: the connector token expired");
  });
});

describe("the consent form's answer", () => {
  const ask = async () => (await authorizeAsk(SECRET, ORIGIN, new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256", state: "st" }))).ask;
  const answer = async (o: Record<string, string>, s: Sql = sql) => {
    const a = await ask();
    return consent(s, SECRET, ORIGIN, new URLSearchParams({ ...a, ...o }), NOW);
  };

  it("without the form's own token: the page again, 403, nothing happens, not even a cancel", async () => {
    const out = await answer({ act: "deny" });
    expect("page" in out).toBe(true);
    const page = (out as { page: Response }).page;
    expect(page.status).toBe(403);
    expect(await page.text()).toMatch(/This page expired or was already used/);
  });

  it("connect without a token, or with one that is not a connector's: the page again with why", async () => {
    const a = await ask();
    const out = await answer({ act: "connect", consent: await consentToken(SECRET, a, NOW) });
    const page = (out as { page: Response }).page;
    expect(page.status).toBe(401);
    expect(await page.text()).toMatch(/That is not a live Claude connector token/);
  });

  it("a database that fails while the token is checked fails the request; it is not an OAuth refusal", async () => {
    const a = await ask();
    const broken: Sql = { ...sql, first: async (q, p) => { if (/api_keys/.test(q)) throw new Error("D1 is away"); return sql.first(q, p); }, all: async (q, p) => { if (/api_keys/.test(q)) throw new Error("D1 is away"); return sql.all(q, p); } };
    expect(await refusal(answer({ act: "connect", consent: await consentToken(SECRET, a, NOW), token: `pck_kLive00000001_${"A".repeat(43)}` }, broken))).toBe("thrown: D1 is away");
  });

  it("the page shows the client's name escaped, and says whose address the browser goes back to", async () => {
    const { ask: a, client } = await authorizeAsk(SECRET, ORIGIN, new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256" }));
    const html = await (await consentPage(SECRET, a, client, ORIGIN, NOW)).text();
    expect(html).toContain("&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;");
    expect(html).not.toContain(`<b>"Tom"`);
    expect(html).toContain("Purser cannot check a client's name.");
  });

  it("an authorize request without a PKCE challenge is refused", async () => {
    expect(await refusal(authorizeAsk(SECRET, ORIGIN, new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge_method: "S256" })))).toMatch(/^invalid_request: PKCE is required/);
  });
});

describe("clients that are their metadata document's address", () => {
  const doc = (id: string, o: Record<string, unknown> = {}) => JSON.stringify({ client_id: id, client_name: "Example AI", redirect_uris: ["https://client.example/cb"], ...o });

  it("an address that is no URL is not one", () => {
    expect(isCimdId("https://[::1/x.json")).toBe(false);
  });

  it("redirect_uris that are not a list are refused", async () => {
    const id = "https://lists.example/meta.json";
    expect(await refusal(clientOf(SECRET, id, async () => new Response(doc(id, { redirect_uris: "https://client.example/cb" }), { status: 200 }), NOW))).toMatch(/needs 1 to 10 redirect_uris/);
  });

  it("the cache keeps at most 500 clients: the oldest is fetched again once 500 newer ones came", async () => {
    let fetched = 0;
    const f = async (url: string) => { fetched++; return new Response(doc(url), { status: 200, headers: { "cache-control": "max-age=3600" } }); };
    const first = "https://first.example/meta.json";
    await clientOf(SECRET, first, f, NOW);
    await clientOf(SECRET, first, f, NOW);
    expect(fetched).toBe(1);
    for (let i = 0; i < 500; i++) await clientOf(SECRET, `https://c${i}.example/meta.json`, f, NOW);
    expect(fetched).toBe(501);
    await clientOf(SECRET, first, f, NOW);
    expect(fetched).toBe(502);
  });
});
