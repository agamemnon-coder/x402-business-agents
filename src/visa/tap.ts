// Agent recognition per the agent-recognition profile of Visa's Trusted Agent Protocol specification
// (developer.visa.com, 2025): an RFC 9421 HTTP Message Signature over "@authority" and "@path", label sig2, with
// created, expires, keyid, alg="ed25519", a nonce and a tag (agent-browser-auth to browse, agent-payer-auth to pay).
// Our own code against RFC 9421 (http-message-sig, Apache-2.0); not Visa's reference code, not Visa's key directory.
// The registry is self-hosted (tap_agents) and the keys are test keys. A merchant accepts a request only if:
//   the tag fits the route; every parameter is there; expires - created <= 480 s and now is inside it; the key is in
//   the registry, not revoked, not past its end date, and registered for this merchant's domain; the signature
//   verifies; and the nonce was never accepted before (stored only after everything else passed).

import { randomBytes } from "node:crypto";
import { createSignature, isSignatureError, verifySignature, webcrypto } from "http-message-sig";
import type { DB } from "../db/open.js";

export type TapTag = "agent-browser-auth" | "agent-payer-auth";
/** The spec's window: a signature lives at most 8 minutes. */
export const TAP_MAX_WINDOW_S = 480;
const LABEL = "sig2";
const COMPONENTS = ["@authority", "@path"];
const REQUIRED = ["created", "expires", "keyid", "alg", "nonce", "tag"];

export interface TapAgentKey { agent: string; keyid: string; privateKey: CryptoKey; publicJwk: JsonWebKey }

/** A fresh Ed25519 key for an agent; the keyid names the agent and part of its public key. */
export async function newAgentKey(agent: string): Promise<TapAgentKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const keyid = `${agent}-${Buffer.from(publicJwk.x ?? "", "base64url").subarray(0, 9).toString("base64url")}`;
  return { agent, keyid, privateKey: pair.privateKey, publicJwk };
}

/** Registers (or updates) an agent's public key for the merchant domains it may sign for, until notAfter (seconds). */
export function registerAgent(db: DB, a: { agent: string; keyid: string; publicJwk: JsonWebKey; domains: string[]; notAfter: number }): void {
  // A revocation sticks: registering a revoked key id again updates the row but never clears revoked_at.
  db.prepare(`INSERT INTO tap_agents (keyid, agent, public_jwk, domains_json, not_after, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT (keyid) DO UPDATE SET agent = excluded.agent, public_jwk = excluded.public_jwk, domains_json = excluded.domains_json, not_after = excluded.not_after`)
    .run(a.keyid, a.agent, JSON.stringify({ kty: a.publicJwk.kty, crv: a.publicJwk.crv, x: a.publicJwk.x }), JSON.stringify(a.domains.map((d) => d.toLowerCase())), a.notAfter);
}

export function revokeAgent(db: DB, keyid: string, at = new Date()): void {
  db.prepare("UPDATE tap_agents SET revoked_at = ? WHERE keyid = ?").run(at.toISOString(), keyid);
}

/** Signs a request as the agent: the headers TAP's agent-recognition profile defines, valid for expiresIn seconds. */
export async function signTapRequest(o: { url: string; method: string; key: TapAgentKey; tag: TapTag; now?: number; expiresIn?: number; nonce?: string; body?: string }): Promise<Request> {
  const created = o.now ?? Math.floor(Date.now() / 1000);
  const req = new Request(o.url, { method: o.method, body: o.body, headers: o.body ? { "content-type": "application/json" } : {} });
  const fields = await createSignature(req, {
    label: LABEL,
    components: COMPONENTS,
    parameters: { created, expires: created + (o.expiresIn ?? 300), keyid: o.key.keyid, alg: "ed25519", nonce: o.nonce ?? randomBytes(64).toString("base64"), tag: o.tag },
    signer: webcrypto.signer(o.key.privateKey),
  });
  const headers = new Headers(req.headers);
  headers.set("signature-input", fields.signatureInput);
  headers.set("signature", fields.signature);
  return new Request(o.url, { method: o.method, body: o.body, headers });
}

export type TapVerdict = { ok: true; agent: string; keyid: string; nonce: string; created: number } | { ok: false; reason: string };

interface RegistryRow { agent: string; public_jwk: string; domains_json: string; not_after: number; revoked_at: string | null }

/** The merchant's check. `tag` is the one this route requires; `now` in seconds. Never throws. */
export async function verifyTapRequest(db: DB, req: Request, o: { tag: TapTag; now?: number; clockSkew?: number }): Promise<TapVerdict> {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const skew = o.clockSkew ?? 5;
  if (!req.headers.get("signature") || !req.headers.get("signature-input")) return { ok: false, reason: "no signature: not a recognised agent" };
  const authority = new URL(req.url).host.toLowerCase();
  let refusal: string | null = null;
  const refuse = (why: string): never => { refusal = why; throw new Error(why); };
  try {
    const v = await verifySignature(req, {
      label: LABEL,
      policy: {
        algorithms: ["ed25519"],
        requiredComponents: COMPONENTS,
        requiredParameters: REQUIRED,
        now,
        clockSkew: skew,
        validate: (sig) => {
          const p = sig.parameters;
          if (p.tag !== o.tag) refuse(`wrong tag ${String(p.tag)}: this route needs ${o.tag}`);
          if (typeof p.created !== "number" || typeof p.expires !== "number") refuse("created and expires must be numbers");
          const [created, expires] = [p.created as number, p.expires as number];
          if (expires - created > TAP_MAX_WINDOW_S) refuse(`window ${expires - created} s is over ${TAP_MAX_WINDOW_S} s`);
          if (created > now + skew) refuse("created is in the future");
          if (expires < now - skew) refuse("the signature has expired");
          return true;
        },
      },
      resolveVerifier: async (cand) => {
        const keyid = cand.parameters.keyid;
        const row = typeof keyid === "string" ? (db.prepare("SELECT agent, public_jwk, domains_json, not_after, revoked_at FROM tap_agents WHERE keyid = ?").get(keyid) as RegistryRow | undefined) : undefined;
        if (!row) return refuse("unknown key: not in the agent registry");
        if (row.revoked_at) refuse(`key revoked at ${row.revoked_at}`);
        if (row.not_after < now) refuse("key expired in the agent registry");
        if (!(JSON.parse(row.domains_json) as string[]).includes(authority)) refuse(`key not registered for ${authority}`);
        if (cand.parameters.alg !== "ed25519") refuse("alg must be ed25519");
        const pub = await crypto.subtle.importKey("jwk", JSON.parse(row.public_jwk) as JsonWebKey, { name: "Ed25519" }, false, ["verify"]);
        return webcrypto.verifier(pub);
      },
    });
    const keyid = String(v.parameters.keyid);
    const nonce = String(v.parameters.nonce);
    // The nonce is stored only now, after the signature verified, so a forged request cannot burn a real nonce.
    const fresh = db.prepare("INSERT OR IGNORE INTO tap_nonces (nonce, keyid, seen_at) VALUES (?, ?, ?)").run(nonce, keyid, now).changes === 1;
    if (!fresh) return { ok: false, reason: "nonce already used: a replay" };
    const agent = (db.prepare("SELECT agent FROM tap_agents WHERE keyid = ?").get(keyid) as { agent: string }).agent;
    return { ok: true, agent, keyid, nonce, created: Number(v.parameters.created) };
  } catch (e) {
    if (refusal) return { ok: false, reason: refusal };
    if (isSignatureError(e)) return { ok: false, reason: `signature refused (${e.code}): ${e.message}` };
    return { ok: false, reason: `signature refused: ${(e as Error).message}` };
  }
}
