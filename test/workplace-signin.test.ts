// OAuth 2.0 with PKCE for the workplace integrations (src/workplace/oauth.ts) and "Sign in with Google" as a viewer
// login (src/workplace/googleSignIn.ts), against a local mock of Google's and Microsoft's token endpoints and Google's
// JWKS. The ID tokens are signed in the test with a key made here (WebCrypto), so every check the OpenID Connect guide
// lists is exercised: signature, issuer, audience, expiry, nonce, verified e-mail, hosted domain. A Google sign-in gives
// a viewer, never an approver. No network. Built and tested against a mock; needs the owner's OAuth app to run live.
import { describe, expect, it } from "vitest";
import { finishGoogleSignIn, googleKeys, startGoogleSignIn, verifyGoogleIdToken, type RsaJwk } from "../src/workplace/googleSignIn.js";
import { challengeOf, exchangeWorkplaceCode, GOOGLE, microsoft, NEVER_ASKED, refreshingToken, tokenSourceFromEnv, WORKPLACE_SCOPES, workplaceAuthorizeUrl, XERO } from "../src/workplace/oauth.js";
import { MockApi } from "./fakes/workplace.js";

const CLIENT = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";
const NOW = Date.parse("2026-11-19T09:00:00Z");
const b64u = (b: Uint8Array | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function signer() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as { n: string; e: string };
  const pub: RsaJwk = { kty: "RSA", kid: "test-kid-1", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "test-kid-1", typ: "JWT" }) => {
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(input)));
    return `${input}.${b64u(sig)}`;
  };
  return { pub, sign };
}
const claims = (o: Record<string, unknown> = {}) => ({ iss: "https://accounts.google.com", aud: CLIENT, azp: CLIENT, sub: "110169484474386276334", email: "cfo@northwind.example", email_verified: true, hd: "northwind.example", iat: NOW / 1000 - 10, exp: NOW / 1000 + 3600, nonce: "the-nonce", ...o });

describe("authorization URLs ask for the least, with PKCE", () => {
  it("Google: S256 challenge, state, offline for a refresh token, and no merged earlier grants", async () => {
    const u = new URL(workplaceAuthorizeUrl(GOOGLE, { clientId: CLIENT, redirectUri: "https://purser.example/oauth/google" }, { scopes: WORKPLACE_SCOPES.gmail, state: "s", challenge: await challengeOf("v".repeat(43)), offline: true }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", scope: "https://www.googleapis.com/auth/gmail.readonly", code_challenge_method: "S256", access_type: "offline", prompt: "consent", state: "s" });
    expect(u.searchParams.has("include_granted_scopes")).toBe(false);
  });

  it("every integration's scopes are read-only but Sheets' and Xero's two, and none is on the never-asked list", () => {
    expect(WORKPLACE_SCOPES).toEqual({
      gmail: ["https://www.googleapis.com/auth/gmail.readonly"], drive: ["https://www.googleapis.com/auth/drive.readonly"], sheets: ["https://www.googleapis.com/auth/spreadsheets"],
      googleSignIn: ["openid", "email"], outlook: ["offline_access", "https://graph.microsoft.com/Mail.Read"], onedrive: ["offline_access", "https://graph.microsoft.com/Files.Read"],
      xero: ["offline_access", "accounting.manualjournals", "accounting.contacts"],
    });
    for (const s of Object.values(WORKPLACE_SCOPES).flat()) expect(NEVER_ASKED as readonly string[]).not.toContain(s);
    expect(() => workplaceAuthorizeUrl(GOOGLE, { clientId: CLIENT, redirectUri: "https://x.example" }, { scopes: ["https://www.googleapis.com/auth/gmail.modify"], state: "s", challenge: "c" })).toThrow(/never asked for/);
  });

  it("Microsoft is one company's tenant, never common; Xero has its own hosts", () => {
    expect(microsoft("northwind.onmicrosoft.com").tokenUrl).toBe("https://login.microsoftonline.com/northwind.onmicrosoft.com/oauth2/v2.0/token");
    expect(() => microsoft("common")).toThrow(/company's own tenant/);
    expect(XERO.authorizeUrl).toBe("https://login.xero.com/identity/connect/authorize");
  });
});

describe("token exchange and refresh against a mock token endpoint", () => {
  it("sends the code with the PKCE verifier and keeps only the error code of a refusal", async () => {
    const api = new MockApi("https://oauth2.googleapis.com")
      .on("POST", /\/token/, (req) => new URLSearchParams(req.body!).get("code") === "good"
        ? { json: { access_token: "ya29.test", expires_in: 3599, refresh_token: "1//rt", scope: "https://www.googleapis.com/auth/gmail.readonly", token_type: "Bearer" } }
        : { status: 400, json: { error: "invalid_grant", error_description: "Bad Request; secret details here" } });
    const verifier = "a".repeat(43);
    const t = await exchangeWorkplaceCode(api.fetch, GOOGLE, { clientId: CLIENT, clientSecret: "shh", redirectUri: "https://purser.example/cb" }, "good", verifier);
    expect(t).toMatchObject({ accessToken: "ya29.test", refreshToken: "1//rt", expiresIn: 3599 });
    expect(Object.fromEntries(new URLSearchParams(api.calls[0]!.body!))).toEqual({ grant_type: "authorization_code", code: "good", redirect_uri: "https://purser.example/cb", code_verifier: verifier, client_id: CLIENT, client_secret: "shh" });
    const e = await exchangeWorkplaceCode(api.fetch, GOOGLE, { clientId: CLIENT, redirectUri: "https://purser.example/cb" }, "bad", verifier).then(() => null, (x: unknown) => x as Error);
    expect(e?.message).toBe("google token exchange: 400 invalid_grant");
  });

  it("a Microsoft refresh asks the same scopes again, caches the access token and keeps a rotated refresh token", async () => {
    let n = 0;
    const api = new MockApi("https://login.microsoftonline.com").on("POST", /\/tenant-id\/oauth2\/v2\.0\/token/, () => ({ json: { access_token: `at-${++n}`, expires_in: 3600, refresh_token: `rt-${n}`, token_type: "Bearer" } }));
    const rotated: string[] = [];
    let now = NOW;
    const src = refreshingToken({ fetch: api.fetch, provider: microsoft("tenant-id"), client: { clientId: "app" }, refreshToken: "rt-0", scopes: WORKPLACE_SCOPES.outlook, now: () => now, onRotate: (r) => rotated.push(r) });
    expect(await src()).toBe("at-1");
    expect(await src()).toBe("at-1");
    now += 3600_000;
    expect(await src()).toBe("at-2");
    expect(rotated).toEqual(["rt-1", "rt-2"]);
    expect(new URLSearchParams(api.calls[1]!.body!).get("refresh_token")).toBe("rt-1");
    expect(new URLSearchParams(api.calls[0]!.body!).get("scope")).toBe("offline_access https://graph.microsoft.com/Mail.Read");
  });

  it("takes credentials from the environment only, naming a missing one without any value", async () => {
    expect(await tokenSourceFromEnv({ PURSER_GMAIL_ACCESS_TOKEN: "ya29.from-env" }, "gmail", "PURSER_GMAIL")()).toBe("ya29.from-env");
    expect(() => tokenSourceFromEnv({ PURSER_GMAIL_REFRESH_TOKEN: "1//x" }, "gmail", "PURSER_GMAIL")).toThrow(/^PURSER_GOOGLE_CLIENT_ID is not set$/);
    expect(() => tokenSourceFromEnv({}, "outlook", "PURSER_OUTLOOK")).toThrow(/^PURSER_OUTLOOK_REFRESH_TOKEN is not set$/);
  });
});

describe("Sign in with Google: a viewer, never an approver", () => {
  it("starts with openid email, PKCE, state and nonce", async () => {
    const { url, pending } = await startGoogleSignIn({ clientId: CLIENT, redirectUri: "https://purser.example/signin/google" });
    const u = new URL(url);
    expect(u.searchParams.get("scope")).toBe("openid email");
    expect(u.searchParams.get("nonce")).toBe(pending.nonce);
    expect(u.searchParams.get("state")).toBe(pending.state);
    expect(u.searchParams.get("code_challenge")).toBe(await challengeOf(pending.verifier));
    expect(u.searchParams.has("access_type")).toBe(false);
  });

  it("verifies a good ID token from the JWKS and answers a viewer that cannot approve", async () => {
    const { pub, sign } = await signer();
    const jwks = new MockApi("https://www.googleapis.com").on("GET", /\/oauth2\/v3\/certs/, () => ({ json: { keys: [pub, { kty: "EC", kid: "other" }] } }));
    const v = await verifyGoogleIdToken(await sign(claims()), { clientId: CLIENT, nonce: "the-nonce", keys: googleKeys(jwks.fetch, undefined, () => NOW), allowedDomains: ["northwind.example"], now: () => NOW });
    expect(v).toEqual({ provider: "google", subject: "110169484474386276334", email: "cfo@northwind.example", domain: "northwind.example", role: "viewer", canApprove: false });
    expect(jwks.calls[0]!.headers.authorization).toBeUndefined();
  });

  it("refuses each way a token can be wrong", async () => {
    const { pub, sign } = await signer();
    const other = await signer();
    const keys = async (kid: string) => (kid === pub.kid ? pub : null);
    const check = async (token: string, o: { nonce?: string; domains?: string[] } = {}) =>
      verifyGoogleIdToken(token, { clientId: CLIENT, nonce: o.nonce ?? "the-nonce", keys, now: () => NOW, ...(o.domains ? { allowedDomains: o.domains } : {}) }).then(() => "accepted", (e: Error) => e.message);
    expect(await check(await sign(claims({ aud: "someone-else.apps.googleusercontent.com" })))).toMatch(/another app/);
    expect(await check(await sign(claims({ iss: "https://evil.example" })))).toMatch(/issuer is not Google/);
    expect(await check(await sign(claims({ exp: NOW / 1000 - 3600 })))).toMatch(/expired/);
    expect(await check(await sign(claims({ iat: NOW / 1000 + 3600 })))).toMatch(/in the future/);
    expect(await check(await sign(claims()), { nonce: "another-nonce" })).toMatch(/nonce/);
    expect(await check(await sign(claims({ nonce: undefined }))))
      .toMatch(/nonce/);
    expect(await check(await sign(claims({ email_verified: false })))).toMatch(/not verified/);
    expect(await check(await sign(claims({ hd: undefined })), { domains: ["northwind.example"] })).toMatch(/domain/);
    expect(await check(await other.sign(claims()))).toMatch(/signature does not verify/);
    expect(await check(await sign(claims(), { alg: "none", kid: "test-kid-1" }))).toMatch(/not RS256/);
    expect(await check(await sign(claims(), { alg: "RS256", kid: "unknown" }))).toMatch(/no Google key/);
    const good = await sign(claims());
    const [h, , s] = good.split(".");
    expect(await check(`${h}.${b64u(JSON.stringify(claims({ email: "attacker@evil.example" })))}.${s}`)).toMatch(/signature does not verify/);
    expect(await check("not-a-jwt")).toMatch(/not a signed JWT/);
  });

  it("finishes the callback: state checked, code exchanged with the verifier, ID token verified", async () => {
    const { pub, sign } = await signer();
    const { pending } = await startGoogleSignIn({ clientId: CLIENT, redirectUri: "https://purser.example/signin/google" });
    const idToken = await sign(claims({ nonce: pending.nonce }));
    const google = new MockApi("https://oauth2.googleapis.com").on("POST", /\/token/, () => ({ json: { access_token: "ya29.x", expires_in: 3599, id_token: idToken, scope: "openid email", token_type: "Bearer" } }));
    const client = { clientId: CLIENT, redirectUri: "https://purser.example/signin/google" };
    const o = { keys: async () => pub, now: () => NOW };
    expect(await finishGoogleSignIn(google.fetch, client, { code: "c", state: pending.state }, pending, o)).toMatchObject({ role: "viewer", canApprove: false });
    expect(new URLSearchParams(google.calls[0]!.body!).get("code_verifier")).toBe(pending.verifier);
    await expect(finishGoogleSignIn(google.fetch, client, { code: "c", state: "forged" }, pending, o)).rejects.toThrow(/state does not match/);
    expect(google.calls).toHaveLength(1);
  });
});
