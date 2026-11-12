// Real customers, part 2 (docs/real-customers.md): a company connects the Airwallex account and the Moneybird
// administration it already has, by OAuth. Against fake providers shaped like their documentation: no network.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Airwallex, fromEnv } from "../src/airwallex/client.js";
import { airwallexOAuthConfig, cloudTokens } from "../src/cloudsync/connections.js";
import { authorizeUrl, challengeOf, exchangeCode, OAUTH_PROVIDERS, OAuthRefused } from "../src/lib/oauth.js";
import { aadOf, seal, sealKey, unseal } from "../cloud/src/sealed.js";
import { testCloud, ORIGIN, type TestCloud, type TestTenant } from "./support/cloud.js";

const TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
const AWX = { clientId: "purser-test-client", clientSecret: "purser-test-secret-not-real", redirectUri: `${ORIGIN}/v1/connect/airwallex/callback` };
const MB = { clientId: "purser-mb-client", clientSecret: "purser-mb-secret-not-real", redirectUri: `${ORIGIN}/v1/connect/moneybird/callback` };

/** Airwallex's and Moneybird's token endpoints as their docs describe them, holding codes, PKCE and rotating refresh tokens. */
class FakeProviders {
  calls: { url: string; form: Record<string, string> }[] = [];
  codes = new Map<string, { challenge?: string; redirect: string; account: string; provider: string }>();
  refresh = new Map<string, { account: string; provider: string }>();
  revoked: string[] = [];
  n = 0;
  failRefresh: number | null = null;
  issue(provider: "airwallex" | "moneybird", challenge: string | undefined, account = "acct_companyA0001") {
    const code = `code-${++this.n}`;
    this.codes.set(code, { challenge, redirect: provider === "airwallex" ? AWX.redirectUri : MB.redirectUri, account, provider });
    return code;
  }
  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    this.calls.push({ url, form });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url === "https://moneybird.com/oauth/revoke") { this.revoked.push(form.token!); return json(200, {}); }
    const provider = url === OAUTH_PROVIDERS.airwallex.tokenUrl ? "airwallex" : url === OAUTH_PROVIDERS.moneybird.tokenUrl ? "moneybird" : null;
    if (!provider) return json(404, {});
    const cred = provider === "airwallex" ? AWX : MB;
    if (form.client_id !== cred.clientId || form.client_secret !== cred.clientSecret) return json(401, { error: "invalid_client" });
    const pair = (account: string) => {
      const n = ++this.n;
      const r = `${provider}-refresh-${n}`;
      this.refresh.set(r, { account, provider });
      return provider === "airwallex"
        ? { access_token: `${provider}-access-${n}-${account}`, account_id: account, expires_in: 300, refresh_token: r, refresh_token_expires_in: 7776000, scope: "balance:read transfer:write", token_type: "bearer" }
        : { access_token: `${provider}-access-${n}`, token_type: "bearer", refresh_token: r, scope: "documents", created_at: 1 };
    };
    if (form.grant_type === "authorization_code") {
      const c = this.codes.get(form.code!);
      this.codes.delete(form.code!);
      if (!c || c.provider !== provider || c.redirect !== form.redirect_uri) return json(400, { error: "invalid_grant", error_description: `echo ${form.code}` });
      if (c.challenge && (await challengeOf(form.code_verifier ?? "")) !== c.challenge) return json(400, { error: "invalid_grant" });
      return json(200, pair(c.account));
    }
    if (form.grant_type === "refresh_token") {
      if (this.failRefresh) { const s = this.failRefresh; this.failRefresh = null; return json(s, { error: s === 400 ? "invalid_grant" : "server_error", refresh_token: form.refresh_token }); }
      const r = this.refresh.get(form.refresh_token!);
      // Single use: the old refresh token stops working once a new one is issued.
      this.refresh.delete(form.refresh_token!);
      if (!r) return json(400, { error: "invalid_grant" });
      return json(200, pair(r.account));
    }
    return json(400, { error: "unsupported_grant_type" });
  };
}

let c: TestCloud;
let a: TestTenant;
let b: TestTenant;
let fake: FakeProviders;
beforeEach(async () => {
  c = testCloud();
  fake = new FakeProviders();
  c.env.connect = { tokenKey: TOKEN_KEY, fetch: fake.fetch, clients: { airwallex: AWX, moneybird: MB }, airwallexWebhookSecret: "whsec-partner-test-not-a-secret" };
  a = await c.tenant("company-a");
  b = await c.tenant("company-b");
});
afterEach(() => c.close());

/** The owner starts; the provider's consent screen answers with a code for `account`; the owner finishes. */
async function connect(t: TestTenant, provider: "airwallex" | "moneybird", account = "acct_companyA0001") {
  const s = await c.req("POST", `/v1/connect/${provider}/start`, { key: t.session });
  expect(s.status).toBe(200);
  const u = new URL(s.json.url as string);
  const code = fake.issue(provider, u.searchParams.get("code_challenge") ?? undefined, account);
  const back = await c.req("GET", `/v1/connect/${provider}/callback?code=${code}&state=${u.searchParams.get("state")}`);
  expect(back.status).toBe(302);
  const frag = new URLSearchParams(new URL(back.res.headers.get("location")!).hash.split("?")[1]);
  return c.req("POST", `/v1/connect/${provider}/finish`, { key: t.session, body: { code: frag.get("code"), state: frag.get("state") } });
}

describe("the OAuth helpers (provider documentation)", () => {
  it("builds Airwallex's sandbox authorize URL with state, the scopes and an S256 challenge; Moneybird's without PKCE", async () => {
    const u = new URL(authorizeUrl(OAUTH_PROVIDERS.airwallex, AWX, { state: "s".repeat(43), challenge: "c".repeat(43) }));
    expect(u.origin + u.pathname).toBe("https://www.sandbox.airwallex.com/oauth/authorize");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", client_id: AWX.clientId, redirect_uri: AWX.redirectUri, code_challenge_method: "S256", state: "s".repeat(43) });
    expect(u.searchParams.get("scope")).toContain("transfer:write");
    expect(() => authorizeUrl(OAUTH_PROVIDERS.airwallex, AWX, { state: "x" })).toThrow(/PKCE/);
    const m = new URL(authorizeUrl(OAUTH_PROVIDERS.moneybird, MB, { state: "y" }));
    expect(m.origin + m.pathname).toBe("https://moneybird.com/oauth/authorize");
    expect(m.searchParams.get("scope")).toBe("documents");
    expect(m.searchParams.has("code_challenge")).toBe(false);
  });
  it("computes the S256 challenge as RFC 7636 appendix B does", async () => {
    expect(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("a refused token request keeps the OAuth error code only, never what the provider echoed", async () => {
    const e = await exchangeCode(fake.fetch, OAUTH_PROVIDERS.airwallex, AWX, "secret-looking-code", "v".repeat(43)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OAuthRefused);
    expect((e as OAuthRefused).code).toBe("invalid_grant");
    expect((e as Error).message).not.toContain("secret-looking-code");
    expect((e as OAuthRefused).permanent).toBe(true);
  });
});

describe("connecting is off by default", () => {
  it("answers 404 on every connect route without the configuration, and says so", async () => {
    delete c.env.connect;
    expect((await c.req("GET", "/v1/connect", { key: a.session })).json).toMatchObject({ switched_on: false });
    for (const [m, p] of [["POST", "/v1/connect/airwallex/start"], ["POST", "/v1/connect/moneybird/start"], ["GET", "/v1/connect/airwallex/token"], ["DELETE", "/v1/connect/airwallex"]] as const) {
      expect((await c.req(m, p, { key: m === "GET" ? a.key : a.session })).status).toBe(404);
    }
    expect((await c.req("GET", "/v1/connect/airwallex/callback?code=x&state=y")).status).toBe(404);
  });
  it("the runner keeps its API key path unless AIRWALLEX_OAUTH=on", () => {
    expect(fromEnv({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "key" })).toMatchObject({ clientId: "id", apiKey: "key" });
    expect(airwallexOAuthConfig(null, {})).toBeNull();
    expect(() => airwallexOAuthConfig(null, { AIRWALLEX_OAUTH: "on" })).toThrow(/PURSER_CLOUD_URL/);
  });
});

describe("Connect your Airwallex account", () => {
  it("runs the authorization code flow with state and PKCE, exchanges the code server side and keeps the tokens sealed", async () => {
    const r = await connect(a, "airwallex");
    expect(r.status).toBe(201);
    expect(r.json.connection).toMatchObject({ provider: "airwallex", status: "connected", account: "acct_companyA0001" });
    const exch = fake.calls.find((x) => x.form.grant_type === "authorization_code")!;
    expect(exch.form.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(exch.form.redirect_uri).toBe(AWX.redirectUri);
    // Nothing the provider issued is stored in the clear, and nothing is shown to a person.
    const raw = JSON.stringify(await c.env.sql.all("SELECT * FROM oauth_connections"));
    expect(raw).not.toMatch(/airwallex-access-|airwallex-refresh-/);
    const list = await c.req("GET", "/v1/connect", { key: a.session });
    expect(JSON.stringify(list.json)).not.toMatch(/access-|refresh-/);
    // The state was spent: no row is left.
    expect(await c.env.sql.all("SELECT * FROM oauth_states")).toEqual([]);
  });

  it("only a signed-in owner starts or finishes; a state is good once, for that person and company, for ten minutes", async () => {
    expect((await c.req("POST", "/v1/connect/airwallex/start", { key: a.key })).status).toBe(403);
    const s = await c.req("POST", "/v1/connect/airwallex/start", { key: a.session });
    const u = new URL(s.json.url as string);
    const state = u.searchParams.get("state")!;
    const code = fake.issue("airwallex", u.searchParams.get("code_challenge")!);
    // Company B's owner cannot finish A's start (and spends it trying).
    expect((await c.req("POST", "/v1/connect/airwallex/finish", { key: b.session, body: { code, state } })).status).toBe(400);
    expect((await c.req("POST", "/v1/connect/airwallex/finish", { key: a.session, body: { code, state } })).status).toBe(400);
    // Expired.
    const s2 = await c.req("POST", "/v1/connect/airwallex/start", { key: a.session });
    const u2 = new URL(s2.json.url as string);
    c.clock.now = new Date(c.clock.now.getTime() + 11 * 60_000);
    const late = await c.req("POST", "/v1/connect/airwallex/finish", { key: a.session, body: { code: fake.issue("airwallex", u2.searchParams.get("code_challenge")!), state: u2.searchParams.get("state")! } });
    expect(late.status).toBe(400);
    expect(fake.calls.filter((x) => x.form.grant_type === "authorization_code")).toHaveLength(0);
  });

  it("a declined consent comes back as an error and stores nothing", async () => {
    const back = await c.req("GET", "/v1/connect/airwallex/callback?error=access_denied&state=abc");
    expect(back.res.headers.get("location")).toBe(`${ORIGIN}/#/connect?provider=airwallex&error=access_denied`);
    expect(await c.env.sql.all("SELECT * FROM oauth_connections")).toEqual([]);
  });

  it("company A's token can never be used for company B", async () => {
    expect((await connect(a, "airwallex", "acct_companyA0001")).status).toBe(201);
    expect((await connect(b, "airwallex", "acct_companyB0002")).status).toBe(201);
    const ta = await c.req("GET", "/v1/connect/airwallex/token", { key: a.key });
    const tb = await c.req("GET", "/v1/connect/airwallex/token", { key: b.key });
    expect(ta.json).toMatchObject({ account: "acct_companyA0001", access_token: expect.stringContaining("acct_companyA0001") });
    expect(tb.json).toMatchObject({ account: "acct_companyB0002", access_token: expect.stringContaining("acct_companyB0002") });

    // A's sealed tokens copied into B's row do not open for B: each value is bound to its company.
    const rowA = await c.env.sql.first<{ access_sealed: string; refresh_sealed: string }>("SELECT access_sealed, refresh_sealed FROM oauth_connections WHERE tenant_id = ?", [a.id]);
    await c.env.sql.run("UPDATE oauth_connections SET access_sealed = ?, refresh_sealed = ? WHERE tenant_id = ?", [rowA!.access_sealed, rowA!.refresh_sealed, b.id]);
    const stolen = await c.req("GET", "/v1/connect/airwallex/token", { key: b.key });
    expect(stolen.status).toBe(409);
    expect(JSON.stringify(stolen.json)).not.toContain("acct_companyA0001");
    const key = await sealKey(TOKEN_KEY);
    await expect(unseal(key, rowA!.access_sealed, aadOf(b.id, "airwallex", "access"))).rejects.toThrow(/does not open/);
    expect(await unseal(key, rowA!.access_sealed, aadOf(a.id, "airwallex", "access"))).toContain("acct_companyA0001");

    // The runner of company A, with A's sync key, calls Airwallex with A's token only.
    const seen: string[] = [];
    const awxFetch: typeof fetch = async (_i, init) => { seen.push(String((init?.headers as Record<string, string>).authorization)); return new Response(JSON.stringify([]), { status: 200 }); };
    const api = new Airwallex({ oauth: cloudTokens({ url: ORIGIN, key: a.key, fetch: c.fetch }, "airwallex", { expectAccount: "acct_companyA0001" }), fetchImpl: awxFetch, sleep: async () => {}, minGapMs: 0 });
    await api.call("GET", "/balances/current");
    expect(seen).toEqual([`Bearer ${ta.json.access_token}`]);
    // A runner pinned to A's account refuses a token for any other account.
    const wrong = new Airwallex({ oauth: cloudTokens({ url: ORIGIN, key: a.key, fetch: c.fetch }, "airwallex", { expectAccount: "acct_companyB0002" }), fetchImpl: awxFetch, sleep: async () => {}, minGapMs: 0 });
    await expect(wrong.call("GET", "/balances/current")).rejects.toThrow(/not acct_companyB0002/);
    expect(seen).toHaveLength(1);
  });

  it("one Airwallex account belongs to one company", async () => {
    expect((await connect(a, "airwallex", "acct_shared000001")).status).toBe(201);
    const r = await connect(b, "airwallex", "acct_shared000001");
    expect(r.status).toBe(409);
    expect((await c.req("GET", "/v1/connect/airwallex/token", { key: b.key })).status).toBe(404);
  });

  it("refreshes a token about to run out, one at a time, and keeps the rotated refresh token at once", async () => {
    await connect(a, "airwallex");
    const first = (await c.req("GET", "/v1/connect/airwallex/token", { key: a.key })).json.access_token;
    c.clock.now = new Date(c.clock.now.getTime() + 250_000); // 50 s left of 300 s
    const second = await c.req("GET", "/v1/connect/airwallex/token", { key: a.key });
    expect(second.status).toBe(200);
    expect(second.json.access_token).not.toBe(first);
    const refreshes = fake.calls.filter((x) => x.form.grant_type === "refresh_token");
    expect(refreshes).toHaveLength(1);
    // The old refresh token is dead at the provider; the stored one is the new one, so the next refresh works.
    c.clock.now = new Date(c.clock.now.getTime() + 290_000);
    expect((await c.req("GET", "/v1/connect/airwallex/token", { key: a.key })).status).toBe(200);
    // A refresh under way blocks a second one (Airwallex revokes a refresh token used twice).
    c.clock.now = new Date(c.clock.now.getTime() + 290_000);
    await c.env.sql.run("UPDATE oauth_connections SET refreshing_until = ? WHERE tenant_id = ?", [c.clock.now.getTime() + 10_000, a.id]);
    expect((await c.req("GET", "/v1/connect/airwallex/token", { key: a.key })).status).toBe(409);
  });

  it("a 5xx on refresh keeps the connection; a refusal (invalid_grant) ends it and the owner connects again", async () => {
    await connect(a, "airwallex");
    c.clock.now = new Date(c.clock.now.getTime() + 290_000);
    fake.failRefresh = 503;
    expect((await c.req("GET", "/v1/connect/airwallex/token", { key: a.key })).status).toBe(502);
    expect((await c.req("GET", "/v1/connect", { key: a.session })).json.connections).toContainEqual(expect.objectContaining({ provider: "airwallex", status: "connected" }));
    fake.failRefresh = 400;
    expect((await c.req("GET", "/v1/connect/airwallex/token", { key: a.key })).status).toBe(409);
    const v = (await c.req("GET", "/v1/connect", { key: a.session })).json.connections as { provider: string; status: string; ended_reason: string }[];
    expect(v.find((x) => x.provider === "airwallex")).toMatchObject({ status: "disconnected", ended_reason: "refused" });
    expect(await c.env.sql.first("SELECT access_sealed, refresh_sealed FROM oauth_connections WHERE tenant_id = ?", [a.id])).toEqual({ access_sealed: null, refresh_sealed: null });
    expect((await connect(a, "airwallex")).status).toBe(201);
  });

  it("disconnecting removes the tokens; Airwallex has no revocation for apps, so the owner is told to remove Purser there too", async () => {
    await connect(a, "airwallex");
    expect((await c.req("DELETE", "/v1/connect/airwallex", { key: a.key })).status).toBe(403);
    const d = await c.req("DELETE", "/v1/connect/airwallex", { key: a.session });
    expect(d.json).toMatchObject({ disconnected: true, revoked_at_provider: false, note: expect.stringMatching(/Airwallex's own settings/) });
    expect((await c.req("GET", "/v1/connect/airwallex/token", { key: a.key })).status).toBe(404);
  });

  it("Airwallex's partner_connection.disconnected webhook ends the named accounts' connections (signed)", async () => {
    await connect(a, "airwallex", "acct_companyA0001");
    await connect(b, "airwallex", "acct_companyB0002");
    const text = JSON.stringify({ id: "evt1", name: "partner_connection.disconnected", app_id: "appid_x", data: { account_ids: ["acct_companyA0001"], reason: "user_initiated" } });
    const ts = String(c.clock.now.getTime());
    expect((await c.req("POST", "/v1/connect/airwallex/webhook", { raw: text, headers: { "x-timestamp": ts, "x-signature": "0".repeat(64) } })).status).toBe(401);
    const sig = createHmac("sha256", "whsec-partner-test-not-a-secret").update(ts + text).digest("hex");
    expect((await c.req("POST", "/v1/connect/airwallex/webhook", { raw: text, headers: { "x-timestamp": ts, "x-signature": sig } })).json).toEqual({ ended: 1 });
    expect((await c.req("GET", "/v1/connect/airwallex/token", { key: a.key })).status).toBe(404);
    expect((await c.req("GET", "/v1/connect/airwallex/token", { key: b.key })).status).toBe(200);
  });

  it("closing the company removes its tokens", async () => {
    await connect(a, "airwallex");
    const { closeTenant } = await import("../cloud/src/privacy.js");
    await closeTenant(c.env.sql, a.id, c.clock.now);
    expect(await c.env.sql.all("SELECT * FROM oauth_connections WHERE tenant_id = ?", [a.id])).toEqual([]);
  });

  it("the client refuses a company token together with an API key or on behalf of another account", () => {
    const oauth = { token: async () => "t", invalidate: () => {} };
    expect(() => new Airwallex({ oauth, onBehalfOf: "acct_other00001" })).toThrow(/never used on behalf/);
    expect(() => new Airwallex({ oauth, clientId: "id", apiKey: "key" })).toThrow(/not both/);
    expect(() => new Airwallex({})).toThrow(/API key pair or the company's OAuth token/);
  });
});

describe("Moneybird OAuth for the company's books", () => {
  it("connects without PKCE (none is documented), hands the runner the company's token, and revokes it at Moneybird on disconnect", async () => {
    const r = await connect(a, "moneybird");
    expect(r.status).toBe(201);
    expect(r.json.connection).toMatchObject({ provider: "moneybird", status: "connected", account: null });
    expect(fake.calls.find((x) => x.form.grant_type === "authorization_code")!.form.code_verifier).toBeUndefined();
    const tokens = cloudTokens({ url: ORIGIN, key: a.key, fetch: c.fetch }, "moneybird");
    const tok = await tokens.token();
    expect(tok).toMatch(/^moneybird-access-/);
    // B has none.
    await expect(cloudTokens({ url: ORIGIN, key: b.key, fetch: c.fetch }, "moneybird").token()).rejects.toThrow(/404/);
    const d = await c.req("DELETE", "/v1/connect/moneybird", { key: a.session });
    expect(d.json).toMatchObject({ disconnected: true, revoked_at_provider: true, note: null });
    expect(fake.revoked).toHaveLength(1);
    expect(fake.calls.at(-1)!.form).toMatchObject({ client_id: MB.clientId, client_secret: MB.clientSecret });
  });

  it("the Moneybird connector takes the company's token from the cloud with ERP_MONEYBIRD_OAUTH=on", async () => {
    const { liveConnector } = await import("../src/erp/registry.js");
    expect(() => liveConnector("moneybird", { ERP_MONEYBIRD_OAUTH: "on", ERP_MONEYBIRD_ADMINISTRATION_ID: "123456789" })).toThrow(/PURSER_CLOUD_URL/);
  });
});

describe("sealing", () => {
  it("refuses a key that is not 32 bytes and a tampered value", async () => {
    await expect(sealKey(Buffer.alloc(16).toString("base64"))).rejects.toThrow(/32 bytes/);
    const key = await sealKey(TOKEN_KEY);
    const s = await seal(key, "tok", "aad");
    const parts = s.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}AA`;
    await expect(unseal(key, tampered, "aad")).rejects.toThrow();
    expect(await unseal(key, s, "aad")).toBe("tok");
  });
});
