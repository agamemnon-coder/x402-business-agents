// Sign in with Google, Microsoft and Apple (cloud/src/oidc.ts), against a stand-in identity provider: a locally made RSA
// key and its JWKS, token endpoints shaped like each provider's documentation. No network.
// It holds: a person links their own account to their own membership only while signed in with their passkey (fresh),
// and may unlink it; a linked account then signs that person in to that company, READ ONLY (no admin, no step-up's
// "fresh passkey", no approval); an account linked to no one, another company, another browser, a spent or expired
// state, a wrong nonce, issuer, audience, signature or algorithm, or an expired token signs no one in; PKCE is sent and
// checked for Google and Microsoft; Apple answers by form_post and is paid with an ES256 client secret; the JWKS is
// fetched on first use and cached, never at module load.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetJwks, verifyIdToken, type OidcEnv } from "../cloud/src/oidc.js";
import { oidcOf } from "../cloud/src/worker.js";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const enc = new TextEncoder();
const b64u = (u: Uint8Array | string) => Buffer.from(typeof u === "string" ? enc.encode(u) : u).toString("base64url");

/** One identity provider for all three: its RSA key, its JWKS, the codes it issued and every request it saw. */
class FakeIdp {
  key!: CryptoKeyPair;
  kid = "test-kid-1";
  apple!: CryptoKeyPair;
  applePem = "";
  calls: { url: string; form: Record<string, string> }[] = [];
  codes = new Map<string, { provider: string; claims: Record<string, unknown>; challenge: string | null }>();
  n = 0;
  async init() {
    this.key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    this.apple = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", this.apple.privateKey));
    this.applePem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----`;
  }
  async sign(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: this.kid, typ: "JWT" }): Promise<string> {
    const h = b64u(JSON.stringify(header)), b = b64u(JSON.stringify(claims));
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", this.key.privateKey, enc.encode(`${h}.${b}`)));
    return `${h}.${b}.${b64u(sig)}`;
  }
  /** What the provider's consent screen does: a code bound to the request's nonce and PKCE challenge. */
  issue(provider: string, authUrl: string, claims: Record<string, unknown>): string {
    const u = new URL(authUrl);
    const code = `code-${++this.n}`;
    this.codes.set(code, { provider, challenge: u.searchParams.get("code_challenge"), claims: { nonce: u.searchParams.get("nonce"), ...claims } });
    return code;
  }
  /** The next ID token, changed by the test (a wrong nonce, issuer, ...). */
  tamper: ((claims: Record<string, unknown>) => Record<string, unknown>) | null = null;
  rawToken: string | null = null;
  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    this.calls.push({ url, form });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/certs") || url.endsWith("/keys")) return json(200, { keys: [{ ...(await crypto.subtle.exportKey("jwk", this.key.publicKey)), kid: this.kid, use: "sig", alg: "RS256" }] });
    const c = this.codes.get(form.code ?? "");
    this.codes.delete(form.code ?? "");
    if (!c) return json(400, { error: "invalid_grant" });
    if (c.challenge) {
      const want = b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(form.code_verifier ?? ""))));
      if (want !== c.challenge) return json(400, { error: "invalid_grant" });
    }
    if (c.provider === "apple") {
      // Apple's client secret: an ES256 JWT signed with the Sign in with Apple key.
      const [h, b, s] = form.client_secret!.split(".");
      const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, this.apple.publicKey, Buffer.from(s!, "base64url"), enc.encode(`${h}.${b}`));
      const p = JSON.parse(Buffer.from(b!, "base64url").toString()) as Record<string, unknown>;
      if (!ok || p.iss !== "TEAM123456" || p.sub !== "com.example.purser.web" || p.aud !== "https://appleid.apple.com") return json(400, { error: "invalid_client" });
    } else if (form.client_secret !== `${c.provider}-secret-not-real`) return json(401, { error: "invalid_client" });
    const claims = this.tamper ? this.tamper(c.claims) : c.claims;
    this.tamper = null;
    const id_token = this.rawToken ?? (await this.sign(claims));
    this.rawToken = null;
    return json(200, { access_token: "at-not-used", token_type: "Bearer", expires_in: 3600, id_token });
  };
}

const NOW_S = Math.floor(new Date("2026-11-08T12:00:00Z").getTime() / 1000);
const MS_TENANT = "11111111-2222-3333-4444-555555555555";
const claimsFor = (provider: string, sub: string): Record<string, unknown> => provider === "google"
  ? { iss: "https://accounts.google.com", aud: "google-client-id", sub, email: "owner@example.com", email_verified: true, iat: NOW_S, exp: NOW_S + 3600 }
  : provider === "microsoft"
    ? { iss: `https://login.microsoftonline.com/${MS_TENANT}/v2.0`, tid: MS_TENANT, aud: "microsoft-client-id", sub, email: "owner@example.com", iat: NOW_S, exp: NOW_S + 3600 }
    : { iss: "https://appleid.apple.com", aud: "com.example.purser.web", sub, email: "owner@privaterelay.appleid.com", email_verified: "true", iat: NOW_S, exp: NOW_S + 3600 };

let c: TestCloud, a: TestTenant, b: TestTenant, idp: FakeIdp;
beforeEach(async () => {
  forgetJwks();
  idp = new FakeIdp();
  await idp.init();
  c = testCloud();
  c.env.oidc = { fetch: idp.fetch, clients: {
    google: { clientId: "google-client-id", clientSecret: "google-secret-not-real" },
    microsoft: { clientId: "microsoft-client-id", clientSecret: "microsoft-secret-not-real", tenant: "organizations" },
    apple: { clientId: "com.example.purser.web", apple: { teamId: "TEAM123456", keyId: "KEY1234567", privateKeyPem: idp.applePem } },
  } } satisfies OidcEnv;
  a = await c.tenant("company-a");
  b = await c.tenant("company-b");
});
afterEach(() => c.close());

/** The provider's redirect back to the cloud, then to the console's fragment; the code and state from there. */
async function back(provider: string, code: string, state: string): Promise<URLSearchParams> {
  const r = provider === "apple"
    ? await c.req("POST", "/v1/auth/oidc/apple/callback", { raw: new URLSearchParams({ code, state, id_token: "ignored" }).toString(), headers: { origin: "https://appleid.apple.com", "content-type": "application/x-www-form-urlencoded" } })
    : await c.req("GET", `/v1/auth/oidc/${provider}/callback?code=${code}&state=${state}`);
  expect(r.status).toBe(provider === "apple" ? 303 : 302);
  const loc = new URL(r.res.headers.get("location")!);
  expect(loc.origin + loc.pathname).toBe(`${ORIGIN}/`);
  return new URLSearchParams(loc.hash.split("?")[1]);
}

async function link(t: TestTenant, provider: string, sub: string) {
  const s = await c.req("POST", `/v1/me/identities/${provider}/start`, { key: t.session });
  expect(s.status, JSON.stringify(s.json)).toBe(200);
  const url = s.json.url as string;
  const q = await back(provider, idp.issue(provider, url, claimsFor(provider, sub)), new URL(url).searchParams.get("state")!);
  return c.req("POST", `/v1/me/identities/${provider}/finish`, { key: t.session, body: { code: q.get("code"), state: q.get("state"), browser_secret: s.json.browser_secret } });
}

async function signIn(slug: string, provider: string, sub: string, o: { browser?: string; claims?: Record<string, unknown> } = {}) {
  const s = await c.req("POST", `/v1/auth/oidc/${provider}/start`, { body: { tenant: slug } });
  expect(s.status, JSON.stringify(s.json)).toBe(200);
  const url = s.json.url as string;
  const q = await back(provider, idp.issue(provider, url, { ...claimsFor(provider, sub), ...o.claims }), new URL(url).searchParams.get("state")!);
  return { start: s, res: await c.req("POST", `/v1/auth/oidc/${provider}/finish`, { body: { code: q.get("code"), state: q.get("state"), browser_secret: o.browser ?? s.json.browser_secret } }) };
}

describe("the providers", () => {
  it("are off unless all of a provider's settings are there", () => {
    expect(oidcOf({ ORIGIN } as never)).toBeUndefined();
    expect(Object.keys(oidcOf({ OIDC_GOOGLE_CLIENT_ID: "x", OIDC_MICROSOFT_CLIENT_ID: "y", OIDC_APPLE_CLIENT_ID: "z" } as never)?.clients ?? {})).toEqual([]);
    expect(Object.keys(oidcOf({ OIDC_GOOGLE_CLIENT_ID: "x", OIDC_GOOGLE_CLIENT_SECRET: "s" } as never)!.clients)).toEqual(["google"]);
  });

  it("are listed for the sign-in page, and a provider that is not on answers 404", async () => {
    expect((await c.req("GET", "/v1/auth/oidc")).json).toMatchObject({ providers: ["google", "microsoft", "apple"], read_only: true });
    delete c.env.oidc!.clients.apple;
    expect((await c.req("POST", "/v1/auth/oidc/apple/start", { body: { tenant: "company-a" } })).status).toBe(404);
    expect((await c.req("POST", "/v1/auth/oidc/facebook/start", { body: { tenant: "company-a" } })).status).toBe(404);
  });

  it("send Google and Microsoft PKCE, state and nonce, and Apple form_post", async () => {
    for (const p of ["google", "microsoft", "apple"]) {
      const u = new URL((await c.req("POST", `/v1/auth/oidc/${p}/start`, { body: { tenant: "company-a" } })).json.url as string);
      expect(u.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/v1/auth/oidc/${p}/callback`);
      expect(u.searchParams.get("state")!.length).toBeGreaterThan(30);
      expect(u.searchParams.get("nonce")!.length).toBeGreaterThan(20);
      expect(u.searchParams.get("code_challenge_method")).toBe(p === "apple" ? null : "S256");
      expect(u.searchParams.get("response_mode")).toBe(p === "apple" ? "form_post" : null);
    }
  });
});

describe("linking your own account", () => {
  it("needs your passkey session, fresh; links to you; shows on your list; another person cannot take it", async () => {
    // A key cannot link anything.
    expect((await c.req("POST", "/v1/me/identities/google/start", { key: a.key })).status).toBe(403);
    // Five minutes after the passkey sign-in, the passkey is asked for again.
    c.clock.now = new Date(c.clock.now.getTime() + 6 * 60_000);
    const stale = await c.req("POST", "/v1/me/identities/google/start", { key: a.session });
    expect(stale.json.code).toBe("step_up_required");
    c.clock.now = new Date("2026-11-08T12:00:00Z");
    expect((await link(a, "google", "g-owner-1")).status).toBe(201);
    const mine = await c.req("GET", "/v1/me/identities", { key: a.session });
    expect(mine.json.linked).toEqual([{ provider: "google", email: "owner@example.com", linked_at: "2026-11-08T12:00:00.000Z" }]);
    // The other company's owner sees none of it.
    expect((await c.req("GET", "/v1/me/identities", { key: b.session })).json.linked).toEqual([]);
  });

  it("refuses a code finished by another person than the one who started", async () => {
    const s = await c.req("POST", "/v1/me/identities/google/start", { key: a.session });
    const url = s.json.url as string;
    const q = await back("google", idp.issue("google", url, claimsFor("google", "g-x")), new URL(url).searchParams.get("state")!);
    const r = await c.req("POST", "/v1/me/identities/google/finish", { key: b.session, body: { code: q.get("code"), state: q.get("state"), browser_secret: s.json.browser_secret } });
    expect(r.status).toBe(400);
  });
});

describe("signing in with a linked account", () => {
  it("signs that person in to that company, read only: no admin, no fresh passkey, no approval", async () => {
    await link(a, "google", "g-owner-1");
    const { res } = await signIn("company-a", "google", "g-owner-1");
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ role: "owner", user_id: a.owner, tenant: "company-a", read_only: true, expires_in: 900 });
    const s = res.json.session as string;
    expect((await c.req("GET", "/v1/me", { key: s })).json.scopes).toEqual(["read"]);
    // This owner's company has no CFO, so the same owner signed in with the passkey approves (docs/security/roles.md);
    // signed in with Google, never: no approve scope, no approves, no approval passkey (review finding 5).
    expect((await c.req("GET", "/v1/me", { key: a.session })).json.approves).toBe("owner_without_cfo");
    expect((await c.req("GET", "/v1/me", { key: s })).json).toMatchObject({ approves: null, signed_in_with: "oidc" });
    expect((await c.req("GET", "/v1/invoices", { key: s })).status).toBe(200);
    // Owner rights take the passkey: keys, people, webhooks, chat hooks, connections, the export, closing.
    expect((await c.req("POST", "/v1/keys", { key: s, body: { name: "x", scopes: ["read"] } })).status).toBe(403);
    expect((await c.req("POST", "/v1/users", { key: s, body: { display_name: "x", role: "owner" } })).status).toBe(403);
    expect((await c.req("POST", `/v1/users/${a.owner}/enrolment`, { key: s })).status).toBe(403);
    expect((await c.req("POST", "/v1/chat-hooks/slack", { key: s, body: { url: "https://hooks.slack.com/services/T0000TEST/B0000TEST/abcdefghijklmnop" } })).status).toBe(403);
    expect((await c.req("POST", "/v1/engine/proposals/P-0001/approve", { key: s, body: {} })).status).toBe(403);
    // It is no passkey check: it cannot link another account either.
    expect((await c.req("POST", "/v1/me/identities/microsoft/start", { key: s })).status).toBe(403);
  });

  it("is a listed session the person sees and ends like a passkey's, and stays read only (ASVS V3.3.4)", async () => {
    await link(a, "google", "g-owner-1");
    const { res } = await signIn("company-a", "google", "g-owner-1");
    const oidc = res.json.session as string;
    const items = (await c.req("GET", "/v1/sessions", { key: a.session })).json.items as { id: string; current: boolean }[];
    const mine = (await c.req("GET", "/v1/sessions", { key: oidc })).json.items as { id: string; current: boolean }[];
    const it2 = mine.find((i) => i.current)!;
    expect(items.some((i) => i.id === it2.id)).toBe(true);
    expect((await c.req("POST", "/v1/keys", { key: oidc, body: { name: "x", scopes: ["read"] } })).status).toBe(403);
    expect((await c.req("DELETE", `/v1/sessions/${it2.id}`, { key: a.session })).status).toBe(200);
    expect((await c.req("GET", "/v1/me", { key: oidc })).status).toBe(401);
    expect((await c.req("GET", "/v1/me", { key: a.session })).status).toBe(200);
  });

  it("signs in with Microsoft (organizations) and Apple (form_post, ES256 client secret) too", async () => {
    await link(a, "microsoft", "ms-owner-1");
    await link(a, "apple", "apple-owner-1");
    expect((await signIn("company-a", "microsoft", "ms-owner-1")).res.json.read_only).toBe(true);
    expect((await signIn("company-a", "apple", "apple-owner-1")).res.json.read_only).toBe(true);
    // A personal Microsoft account (the consumers directory) is not an organisation's.
    const consumer = await signIn("company-a", "microsoft", "ms-owner-1", { claims: { iss: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0", tid: "9188040d-6c67-4c5b-b112-36a304b66dad" } });
    expect(consumer.res.status).toBe(401);
  });

  it("signs in no one for an account linked to no one, or linked in another company", async () => {
    await link(a, "google", "g-owner-1");
    const none = (await signIn("company-a", "google", "g-stranger")).res;
    expect(none.status).toBe(401);
    expect(none.json.error).toMatch(/not linked/);
    expect((await signIn("company-b", "google", "g-owner-1")).res.status).toBe(401);
  });

  it("stops after unlinking", async () => {
    await link(a, "google", "g-owner-1");
    expect((await c.req("DELETE", "/v1/me/identities/google", { key: a.session })).json).toEqual({ unlinked: true });
    expect((await signIn("company-a", "google", "g-owner-1")).res.status).toBe(401);
  });

  it("finishes only in the browser that started it, once, within ten minutes", async () => {
    await link(a, "google", "g-owner-1");
    expect((await signIn("company-a", "google", "g-owner-1", { browser: "x".repeat(43) })).res.status).toBe(400);
    const { start } = await signIn("company-a", "google", "g-owner-1");
    // The same state again: spent.
    const url = start.json.url as string;
    const replay = await c.req("POST", "/v1/auth/oidc/google/finish", { body: { code: idp.issue("google", url, claimsFor("google", "g-owner-1")), state: new URL(url).searchParams.get("state"), browser_secret: start.json.browser_secret } });
    expect(replay.status).toBe(400);
    const s = await c.req("POST", "/v1/auth/oidc/google/start", { body: { tenant: "company-a" } });
    c.clock.now = new Date(c.clock.now.getTime() + 11 * 60_000);
    const u = s.json.url as string;
    const late = await c.req("POST", "/v1/auth/oidc/google/finish", { body: { code: idp.issue("google", u, claimsFor("google", "g-owner-1")), state: new URL(u).searchParams.get("state"), browser_secret: s.json.browser_secret } });
    expect(late.status).toBe(400);
  });

  it("refuses an ID token with another nonce, issuer, audience or signature, alg none, or expired", async () => {
    await link(a, "google", "g-owner-1");
    for (const bad of [{ nonce: "someone-else" }, { iss: "https://evil.example" }, { aud: "another-app" }, { exp: NOW_S - 3600 }, { iat: NOW_S + 3600 }]) {
      const r = (await signIn("company-a", "google", "g-owner-1", { claims: bad })).res;
      expect(r.status, JSON.stringify(bad)).toBe(401);
    }
    // A token signed by another key, and one with alg none.
    const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"]);
    const keep = idp.key;
    idp.key = { ...keep, privateKey: other.privateKey };
    expect((await signIn("company-a", "google", "g-owner-1")).res.status).toBe(401);
    idp.key = keep;
    idp.rawToken = `${b64u(JSON.stringify({ alg: "none", kid: idp.kid }))}.${b64u(JSON.stringify(claimsFor("google", "g-owner-1")))}.`;
    expect((await signIn("company-a", "google", "g-owner-1")).res.status).toBe(401);
  });

  it("reads the JWKS on first use and keeps it, never at module load", async () => {
    expect(idp.calls).toEqual([]);
    await link(a, "google", "g-owner-1");
    await signIn("company-a", "google", "g-owner-1");
    expect(idp.calls.filter((x) => x.url === "https://www.googleapis.com/oauth2/v3/certs")).toHaveLength(1);
    // The token request carries the PKCE verifier and the client secret, to Google's token endpoint.
    const tokenCalls = idp.calls.filter((x) => x.url === "https://oauth2.googleapis.com/token");
    expect(tokenCalls.every((x) => x.form.code_verifier && x.form.client_id === "google-client-id")).toBe(true);
  });

  it("verifyIdToken refuses a Microsoft token from another directory when one directory is configured", async () => {
    const t = await idp.sign({ ...claimsFor("microsoft", "x"), nonce: "n" });
    await expect(verifyIdToken(idp.fetch, "microsoft", { clientId: "microsoft-client-id", tenant: "99999999-2222-3333-4444-555555555555" }, t, "n", new Date(NOW_S * 1000))).rejects.toThrow(/issuer/);
    await expect(verifyIdToken(idp.fetch, "microsoft", { clientId: "microsoft-client-id", tenant: MS_TENANT }, t, "n", new Date(NOW_S * 1000))).resolves.toMatchObject({ sub: "x" });
  });
});
