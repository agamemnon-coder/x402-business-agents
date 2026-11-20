// The ID token check and the provider settings behind "Sign in with ..." (cloud/src/oidc.ts), on their own: a token
// that is not a JWT, a key the provider does not list, signing keys that cannot be read, a token with no subject, an
// audience list, Microsoft's directory rules and Apple's key. Each signs no one in and says which check failed. A
// locally made RSA key stands in for the provider; no network.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appleClientSecret, forgetJwks, idpOf, OidcRefused, verifyIdToken } from "../cloud/src/oidc.js";

const enc = new TextEncoder();
const b64u = (u: Uint8Array | string) => Buffer.from(typeof u === "string" ? enc.encode(u) : u).toString("base64url");
const NOW = new Date("2026-11-08T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const GOOGLE = { clientId: "google-client-id", clientSecret: "x" };
const MS_TENANT = "11111111-2222-3333-4444-555555555555";
const MS_CONSUMERS = "9188040d-6c67-4c5b-b112-36a304b66dad";

let key: CryptoKeyPair;
let jwk: JsonWebKey;
beforeAll(async () => {
  key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
});
beforeEach(() => forgetJwks());

async function sign(claims: Record<string, unknown>, kid = "k1"): Promise<string> {
  const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), b = b64u(JSON.stringify(claims));
  return `${h}.${b}.${b64u(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, enc.encode(`${h}.${b}`))))}`;
}
const good = (extra: Record<string, unknown> = {}) => ({ iss: "https://accounts.google.com", aud: GOOGLE.clientId, sub: "g-1", nonce: "n", iat: NOW_S, exp: NOW_S + 3600, ...extra });
/** A JWKS endpoint answering `answer` and counting its calls. */
function jwks(answer: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => { calls.push(String(input)); return answer(); }) as typeof fetch;
  return { f, calls };
}
const listing = (kid = "k1") => () => new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }, { kty: "EC", kid: "ec" }, null] }), { status: 200 });
async function refusal(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(OidcRefused); return { status: (e as OidcRefused).status, message: (e as Error).message }; }
  throw new Error("expected a refusal");
}

describe("the ID token itself", () => {
  it("accepts a good token, and an audience list naming this client as the authorised party", async () => {
    const { f } = jwks(listing());
    await expect(verifyIdToken(f, "google", GOOGLE, await sign(good()), "n", NOW)).resolves.toMatchObject({ sub: "g-1" });
    await expect(verifyIdToken(f, "google", GOOGLE, await sign(good({ aud: [GOOGLE.clientId] })), "n", NOW)).resolves.toMatchObject({ sub: "g-1" });
    await expect(verifyIdToken(f, "google", GOOGLE, await sign(good({ aud: [GOOGLE.clientId, "other"], azp: GOOGLE.clientId })), "n", NOW)).resolves.toMatchObject({ sub: "g-1" });
  });

  it("refuses an audience list where another client is the authorised party", async () => {
    const { f } = jwks(listing());
    expect(await refusal(verifyIdToken(f, "google", GOOGLE, await sign(good({ aud: [GOOGLE.clientId, "other"], azp: "other" })), "n", NOW)))
      .toEqual({ status: 401, message: "the ID token is for another application" });
    expect(await refusal(verifyIdToken(f, "google", GOOGLE, await sign(good({ aud: [GOOGLE.clientId, "other"] })), "n", NOW)))
      .toEqual({ status: 401, message: "the ID token is for another application" });
  });

  it("refuses what is not a JWT, without asking the provider for keys", async () => {
    const { f, calls } = jwks(listing());
    for (const t of ["", "a.b", "a.b.c.d", `${"a".repeat(16_000)}.b.c`]) {
      expect(await refusal(verifyIdToken(f, "google", GOOGLE, t, "n", NOW))).toEqual({ status: 401, message: "the ID token is not a JWT" });
    }
    // Parts that are not JSON objects are no header: not RS256.
    expect((await refusal(verifyIdToken(f, "google", GOOGLE, `${b64u("[1]")}.${b64u("x")}.sig`, "n", NOW))).message).toBe("the ID token is not signed with RS256");
    expect(calls).toEqual([]);
  });

  it("refuses a token with no subject, or one too long to be one", async () => {
    const { f } = jwks(listing());
    for (const sub of [undefined, "", 7, "s".repeat(256)]) {
      expect(await refusal(verifyIdToken(f, "google", GOOGLE, await sign(good({ sub })), "n", NOW)), String(sub)).toEqual({ status: 401, message: "the ID token names no subject" });
    }
  });
});

describe("the provider's signing keys", () => {
  it("refuses a token whose key the provider does not list", async () => {
    const { f } = jwks(listing("another-kid"));
    expect(await refusal(verifyIdToken(f, "google", GOOGLE, await sign(good()), "n", NOW))).toEqual({ status: 401, message: "the ID token's key is not among the provider's keys" });
  });

  it("answers 502 when the keys cannot be read, and reads nothing it cannot use", async () => {
    const down = jwks(() => { throw new Error("connect ECONNREFUSED"); });
    expect(await refusal(verifyIdToken(down.f, "google", GOOGLE, await sign(good()), "n", NOW))).toEqual({ status: 502, message: "the provider's signing keys could not be read; try again" });
    forgetJwks();
    const err = jwks(() => new Response("oops", { status: 503 }));
    expect(await refusal(verifyIdToken(err.f, "google", GOOGLE, await sign(good()), "n", NOW))).toEqual({ status: 502, message: "the provider's signing keys could not be read; try again" });
    forgetJwks();
    const notJson = jwks(() => new Response("<html>", { status: 200 }));
    expect((await refusal(verifyIdToken(notJson.f, "google", GOOGLE, await sign(good()), "n", NOW))).message).toBe("the ID token's key is not among the provider's keys");
  });

  it("keeps the keys an hour, and asks again for an unknown key id at most once a minute", async () => {
    const { f, calls } = jwks(listing());
    await verifyIdToken(f, "google", GOOGLE, await sign(good()), "n", NOW);
    await verifyIdToken(f, "google", GOOGLE, await sign(good()), "n", new Date(NOW.getTime() + 30 * 60_000));
    expect(calls).toHaveLength(1);
    // A key id it does not hold, within the minute: not fetched again.
    await refusal(verifyIdToken(f, "google", GOOGLE, await sign(good(), "rotated"), "n", new Date(NOW.getTime() + 30_000)));
    expect(calls).toHaveLength(1);
    // After the minute it is, once.
    await refusal(verifyIdToken(f, "google", GOOGLE, await sign(good(), "rotated"), "n", new Date(NOW.getTime() + 31 * 60_000)));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("https://www.googleapis.com/oauth2/v3/certs");
  });
});

describe("Microsoft's directory rules", () => {
  const ms = (tenant: string | undefined, tid: unknown) => ({ client: { clientId: "ms", ...(tenant ? { tenant } : {}) }, claims: { iss: `https://login.microsoftonline.com/${String(tid)}/v2.0`, tid } });

  it("refuses a sign-in set up with a tenant that is neither common, organizations nor a directory id", () => {
    expect(() => idpOf("microsoft", { clientId: "ms", tenant: "contoso.example" })).toThrow(OidcRefused);
    expect(() => idpOf("microsoft", { clientId: "ms", tenant: "contoso.example" })).toThrow("the Microsoft sign-in is set up with an unknown tenant");
  });

  it("organizations takes any work directory but not personal accounts; common takes both", () => {
    const work = ms("organizations", MS_TENANT), personal = ms("organizations", MS_CONSUMERS);
    expect(idpOf("microsoft", work.client).issuerOk(work.claims.iss, work.claims)).toBe(true);
    expect(idpOf("microsoft", personal.client).issuerOk(personal.claims.iss, personal.claims)).toBe(false);
    const common = ms(undefined, MS_CONSUMERS);
    expect(idpOf("microsoft", common.client).jwks).toBe("https://login.microsoftonline.com/common/discovery/v2.0/keys");
    expect(idpOf("microsoft", common.client).issuerOk(common.claims.iss, common.claims)).toBe(true);
  });

  it("refuses an issuer that does not name the token's own directory", () => {
    const i = idpOf("microsoft", { clientId: "ms" });
    expect(i.issuerOk(`https://login.microsoftonline.com/${MS_TENANT}/v2.0`, { tid: "not-a-guid" })).toBe(false);
    expect(i.issuerOk(`https://login.microsoftonline.com/${MS_TENANT}/v2.0`, {})).toBe(false);
    expect(i.issuerOk(`https://login.microsoftonline.com/${MS_CONSUMERS}/v2.0`, { tid: MS_TENANT })).toBe(false);
  });
});

describe("Sign in with Apple's client secret", () => {
  it("is refused when Apple is not set up, or its key is not a PKCS#8 key", async () => {
    expect(await refusal(appleClientSecret({ clientId: "com.example" }, NOW))).toEqual({ status: 404, message: "signing in with Apple is not set up (team id, key id and private key)" });
    expect(await refusal(appleClientSecret({ clientId: "com.example", apple: { teamId: "T", keyId: "K", privateKeyPem: "-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----" } }, NOW)))
      .toEqual({ status: 404, message: "the Sign in with Apple key does not load (a PKCS#8 .p8 key is expected)" });
  });

  it("is a five-minute ES256 JWT for Apple, from a key whose line breaks were escaped", async () => {
    const ec = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const der = Buffer.from(new Uint8Array(await crypto.subtle.exportKey("pkcs8", ec.privateKey))).toString("base64");
    const pem = `-----BEGIN PRIVATE KEY-----\\n${der}\\n-----END PRIVATE KEY-----`;
    const jwt = await appleClientSecret({ clientId: "com.example.web", apple: { teamId: "TEAM", keyId: "KEY", privateKeyPem: pem } }, NOW);
    const [h, b, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY", typ: "JWT" });
    expect(JSON.parse(Buffer.from(b!, "base64url").toString())).toEqual({ iss: "TEAM", iat: NOW_S, exp: NOW_S + 300, aud: "https://appleid.apple.com", sub: "com.example.web" });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, ec.publicKey, Buffer.from(s!, "base64url"), enc.encode(`${h}.${b}`))).toBe(true);
  });
});
