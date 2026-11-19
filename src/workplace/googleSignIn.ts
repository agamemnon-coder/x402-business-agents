// "Sign in with Google" as an optional viewer login (docs/integrations/workplace.md, "Sign in with Google"): OpenID
// Connect, authorization code with PKCE, a nonce and a state, and the ID token verified here before any claim in it is
// used. What it gives is a VIEWER: someone who may read the company's books. It never approves: an approval is the
// CFO's passkey signing the exact terms in Purser Cloud, and a Google sign-in does not reach that (canApprove is false
// in the type itself).
//
// From Google's OpenID Connect guide (developers.google.com/identity/openid-connect/openid-connect, "Validating an ID
// token"): verify the signature with Google's public keys (the JWKS at https://www.googleapis.com/oauth2/v3/certs,
// RS256), iss is https://accounts.google.com or accounts.google.com, aud is the app's client id, exp has not passed;
// and the nonce is the one sent. hd names a Google Workspace domain, which the owner may require.
//
// Built and tested against a mock (test/workplace-signin.test.ts, with a key made in the test); needs the owner's OAuth
// app to run live.

import { z } from "zod";
import { callJson, WorkplaceError, type Fetch } from "./http.js";
import { exchangeWorkplaceCode, GOOGLE, newPkce, randomState, WORKPLACE_SCOPES, workplaceAuthorizeUrl, type WorkplaceClient } from "./oauth.js";

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;
/** Clock difference allowed on exp and iat. */
export const SKEW_SECONDS = 60;

/** Who signed in: a viewer, never an approver. */
export interface ViewerIdentity {
  provider: "google";
  subject: string;
  email: string;
  domain: string | null;
  role: "viewer";
  canApprove: false;
}

/** What the caller keeps between the redirect and the callback (in the signed-in session's cookie, never the URL). */
export interface SignInPending { state: string; nonce: string; verifier: string }

/** The Google consent URL for openid email, with PKCE, state and nonce; and what to keep for the callback. */
export async function startGoogleSignIn(c: Pick<WorkplaceClient, "clientId" | "redirectUri">): Promise<{ url: string; pending: SignInPending }> {
  const { verifier, challenge } = await newPkce();
  const pending = { state: randomState(), nonce: randomState(), verifier };
  return { url: workplaceAuthorizeUrl(GOOGLE, c, { scopes: WORKPLACE_SCOPES.googleSignIn, state: pending.state, challenge, nonce: pending.nonce }), pending };
}

const Jwk = z.object({ kty: z.literal("RSA"), kid: z.string().max(200), n: z.string().max(2048), e: z.string().max(16), alg: z.string().optional(), use: z.string().optional() });
const Jwks = z.object({ keys: z.array(z.unknown()).max(50) });
export type RsaJwk = z.infer<typeof Jwk>;
export type KeySource = (kid: string) => Promise<RsaJwk | null>;

/** Google's signing keys, fetched once an hour at most (Google rotates them; an unknown kid fetches again once). */
export function googleKeys(f?: Fetch, url = GOOGLE_JWKS_URL, now: () => number = Date.now): KeySource {
  let cache: { at: number; keys: RsaJwk[] } | null = null;
  const load = async () => {
    const j = await callJson(url, Jwks, { token: null, ...(f ? { fetch: f } : {}) }, 256 * 1024);
    cache = { at: now(), keys: j.keys.flatMap((k) => { const p = Jwk.safeParse(k); return p.success ? [p.data] : []; }) };
    return cache.keys;
  };
  return async (kid) => {
    let keys = cache && now() - cache.at < 3_600_000 ? cache.keys : await load();
    let k = keys.find((x) => x.kid === kid);
    if (!k && cache && now() - cache.at > 60_000) { keys = await load(); k = keys.find((x) => x.kid === kid); }
    return k ?? null;
  };
}

const b64u = (s: string) => new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
const Header = z.object({ alg: z.string(), kid: z.string().max(200), typ: z.string().optional() });
const Claims = z.object({
  iss: z.string(), aud: z.union([z.string(), z.array(z.string()).max(10)]), azp: z.string().optional(), sub: z.string().min(1).max(255),
  exp: z.number(), iat: z.number(), nonce: z.string().optional(), email: z.string().max(320).optional(), email_verified: z.boolean().optional(), hd: z.string().max(253).optional(),
});

const fail = (why: string): never => { throw new WorkplaceError("auth", `the Google ID token is refused: ${why}`); };

export interface VerifyOptions {
  clientId: string;
  /** The nonce sent with this sign-in; the token must carry it. */
  nonce: string;
  keys: KeySource;
  /** Google Workspace domains allowed in (hd); absent: any verified Google account the owner then lets in by e-mail. */
  allowedDomains?: string[];
  now?: () => number;
}

/** Verifies a Google ID token as the guide says, then answers the viewer it names. Throws with the reason otherwise. */
export async function verifyGoogleIdToken(idToken: string, o: VerifyOptions): Promise<ViewerIdentity> {
  if (idToken.length > 8192) fail("it is too long");
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) fail("it is not a signed JWT");
  const [h, p, s] = parts as [string, string, string];
  let header: z.infer<typeof Header>;
  let claims: z.infer<typeof Claims>;
  try {
    header = Header.parse(JSON.parse(new TextDecoder().decode(b64u(h))));
    claims = Claims.parse(JSON.parse(new TextDecoder().decode(b64u(p))));
  } catch {
    return fail("its header or claims are not the documented shape");
  }
  if (header.alg !== "RS256") fail(`it is signed with ${header.alg.slice(0, 20)}, not RS256`);
  const jwk = await o.keys(header.kid);
  if (!jwk) fail("no Google key has its key id");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk!.n, e: jwk!.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!good) fail("its signature does not verify");
  const now = Math.floor((o.now ?? Date.now)() / 1000);
  if (!(GOOGLE_ISSUERS as readonly string[]).includes(claims.iss)) fail("its issuer is not Google");
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(o.clientId)) fail("it was issued to another app (aud)");
  if (auds.length > 1 && claims.azp !== o.clientId) fail("it names several audiences and this app is not its authorized party (azp)");
  if (claims.exp + SKEW_SECONDS < now) fail("it has expired");
  if (claims.iat - SKEW_SECONDS > now) fail("it was issued in the future");
  if (!o.nonce || claims.nonce !== o.nonce) fail("its nonce is not this sign-in's");
  if (!claims.email || claims.email_verified !== true) fail("its e-mail address is not verified by Google");
  if (o.allowedDomains?.length && !(claims.hd && o.allowedDomains.includes(claims.hd))) fail("its Google Workspace domain is not one this company allows");
  return { provider: "google", subject: claims.sub, email: claims.email!.toLowerCase(), domain: claims.hd ?? null, role: "viewer", canApprove: false };
}

/** The callback: the state checked, the code exchanged with the PKCE verifier, the ID token verified. */
export async function finishGoogleSignIn(f: Fetch, c: WorkplaceClient, callback: { code: string; state: string }, pending: SignInPending, o: Omit<VerifyOptions, "clientId" | "nonce">): Promise<ViewerIdentity> {
  if (!callback.state || callback.state !== pending.state) fail("the state does not match this sign-in");
  const t = await exchangeWorkplaceCode(f, GOOGLE, c, callback.code, pending.verifier);
  if (!t.idToken) fail("Google answered no ID token");
  return verifyGoogleIdToken(t.idToken!, { ...o, clientId: c.clientId, nonce: pending.nonce });
}
