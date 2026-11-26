// Know your agent (26 Nov): a signed agent identity on every money-relevant request (docs/security/agent-identity.md).
// Each agent principal (./principals.ts) gets an Ed25519 key pair when it is created and each time its key is rotated.
// The ledger keeps the public key only (principal_identity_keys); the private key goes to whoever holds the agent's
// credentials, as the principal's bearer key does: returned once by rotation (the CLI writes it to a key file, mode
// 0600, under KIT11_KEYS_DIR), and held in this process for an agent that runs in it. Never in the ledger, git or a log.
//
// The agent signs a canonical envelope (JCS, RFC 8785): its id, its key's id, the method, the tool name or path, the
// SHA-256 of the body, the time and a fresh nonce. The agent API checks, in this order: the proof's shape, that it is
// this agent's, that the principal is active, that the key is its current one, the signature, that the envelope is this
// request's, the time within five minutes, and last the nonce (never seen before for that key; kept past the window).
// Each refusal is audited as principal.identity_refused with its reason code.
//
// Rollout: PURSER_AGENT_IDENTITY = required | optional | off. optional (the default) checks a proof when there is one
// and audits a request without one (principal.identity_absent); required refuses it; an unknown value counts as required.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { identityHook } from "./identityHook.js";

export type IdentityMode = "required" | "optional" | "off";
/** How far the signer's clock may be from ours, either way. */
export const IDENTITY_WINDOW_S = 300;
/** The MCP request's _meta key, and the HTTP header, that carry the proof. */
export const IDENTITY_META = "purser/agent-identity";
export const IDENTITY_HEADER = "purser-agent-identity";

export const IDENTITY_REFUSED = "principal.identity_refused";
export type IdentityCode =
  | "identity_missing" | "identity_malformed" | "identity_wrong_agent" | "identity_principal_inactive" | "identity_no_key" | "identity_key_rotated"
  | "identity_unknown_key" | "identity_bad_signature" | "identity_request_mismatch" | "identity_body_mismatch" | "identity_stale" | "identity_nonce_reused";

/** What the agent signs: these fields, as JCS. */
export interface IdentityEnvelope { v: 1; agent: string; key_id: string; method: string; target: string; body_sha256: string; ts: string; nonce: string }
/** The envelope and its signature (base64url), as sent. */
export interface IdentityProof extends IdentityEnvelope { sig: string }

export function identityMode(env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env): IdentityMode {
  const v = env.PURSER_AGENT_IDENTITY?.trim();
  if (!v) return "optional";
  return v === "optional" || v === "off" ? v : "required";
}

const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
/** A body as bytes (an HTTP body) is hashed as it is; a parsed one (an MCP tool's arguments) as its JCS text. */
export const bodyHash = (body: unknown): string => sha256(typeof body === "string" || body instanceof Uint8Array ? body : jcs((body ?? null) as Json));

// --- The keys --------------------------------------------------------------------------------------------------------

export function identityTables(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS principal_identity_keys (key_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, public_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('current', 'retired')), created_at TEXT NOT NULL, retired_at TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_identity_current ON principal_identity_keys (principal_id) WHERE status = 'current';
  CREATE TABLE IF NOT EXISTS agent_identity_nonces (key_id TEXT NOT NULL, nonce TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (key_id, nonce));`);
}

/** Private keys held by this process, for the agents that run in it. */
const HELD = new Map<string, { key_id: string; key: KeyObject }>();
type Sink = (principalId: string, keyId: string, privatePem: string) => void;
let sink: Sink | null = null;
/** Where a node process keeps a new private key besides holding it (the CLIs: a key file, mode 0600). */
export function onIdentityKey(s: Sink | null): void { sink = s; }
export function heldIdentityKey(principalId: string): { key_id: string; private_pem: string } | null {
  const h = HELD.get(principalId);
  return h ? { key_id: h.key_id, private_pem: h.key.export({ type: "pkcs8", format: "pem" }).toString() } : null;
}

/**
 * A new key pair for the principal: the public key becomes its current one (the previous is retired), the private key
 * is returned once and held here. Null where the runtime cannot make an Ed25519 key (the principal then has none).
 */
export function issueIdentityKey(db: DB, principalId: string, now = new Date()): { key_id: string; private_pem: string } | null {
  let pair: { publicKey: KeyObject; privateKey: KeyObject };
  try { pair = generateKeyPairSync("ed25519"); } catch { return null; }
  identityTables(db);
  const spki = pair.publicKey.export({ type: "spki", format: "der" });
  const key_id = keyIdOf(spki);
  db.transaction(() => {
    db.prepare("UPDATE principal_identity_keys SET status = 'retired', retired_at = ? WHERE principal_id = ? AND status = 'current'").run(now.toISOString(), principalId);
    db.prepare("INSERT INTO principal_identity_keys (key_id, principal_id, public_key, status, created_at) VALUES (?, ?, ?, 'current', ?)").run(key_id, principalId, spki.toString("base64url"), now.toISOString());
  })();
  HELD.set(principalId, { key_id, key: pair.privateKey });
  const private_pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  sink?.(principalId, key_id, private_pem);
  return { key_id, private_pem };
}

/** A key's id: from its public key, so the agent holding the private key can name it. */
const keyIdOf = (spki: Uint8Array) => `aik_${sha256(spki).slice(0, 16)}`;
export const identityKeyId = (privatePem: string): string => keyIdOf(createPublicKey(createPrivateKey(privatePem)).export({ type: "spki", format: "der" }));

interface KeyRow { key_id: string; principal_id: string; public_key: string; status: "current" | "retired" }
export function currentIdentityKey(db: DB, principalId: string): { key_id: string; public_key: string } | null {
  identityTables(db);
  const r = db.prepare("SELECT key_id, public_key FROM principal_identity_keys WHERE principal_id = ? AND status = 'current'").get(principalId) as KeyRow | undefined;
  return r ? { key_id: r.key_id, public_key: r.public_key } : null;
}

// --- Signing (the agent's side) ----------------------------------------------------------------------------------------

/** The agent signs one request (keyId: its key's id, worked out from the key when left out). */
export function signAgentRequest(privatePem: string, r: { agent: string; keyId?: string; method: string; target: string; body: unknown; now?: Date; nonce?: string }): IdentityProof {
  const env: IdentityEnvelope = {
    v: 1, agent: r.agent, key_id: r.keyId ?? identityKeyId(privatePem), method: r.method, target: r.target, body_sha256: bodyHash(r.body),
    ts: (r.now ?? new Date()).toISOString(), nonce: r.nonce ?? randomBytes(18).toString("base64url"),
  };
  return { ...env, sig: sign(null, Buffer.from(jcs(env as unknown as Json), "utf8"), createPrivateKey(privatePem)).toString("base64url") };
}

/** The proof as one header value (base64url of its JSON), and back; null for anything that is not one. */
export const proofHeader = (p: IdentityProof): string => Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
export function proofFromHeader(v: string | null | undefined): IdentityProof | null {
  if (!v || v.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(v)) return null;
  try { return parseProof(JSON.parse(Buffer.from(v, "base64url").toString("utf8"))); } catch { return null; }
}

const STR = (max: number, re: RegExp) => (x: unknown): x is string => typeof x === "string" && x.length <= max && re.test(x);
const FIELDS: Record<keyof IdentityProof, (x: unknown) => boolean> = {
  v: (x) => x === 1, agent: STR(80, /^[a-z0-9:_-]+$/), key_id: STR(40, /^aik_[0-9a-f]{16}$/), method: STR(40, /^[A-Za-z/_-]+$/), target: STR(200, /^[\x21-\x7e]+$/),
  body_sha256: STR(64, /^[0-9a-f]{64}$/), ts: STR(40, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/), nonce: STR(200, /^[A-Za-z0-9_-]{16,200}$/), sig: STR(200, /^[A-Za-z0-9_-]{80,90}$/),
};
/** The proof with exactly its fields, each well formed; null otherwise. */
function parseProof(x: unknown): IdentityProof | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== Object.keys(FIELDS).length || !keys.every((k) => k in FIELDS && FIELDS[k as keyof IdentityProof](o[k]))) return null;
  return o as unknown as IdentityProof;
}

// --- Verifying (the agent API's side) ---------------------------------------------------------------------------------

export type IdentityVerdict =
  | { ok: true; key_id: string | null; mode: IdentityMode }
  | { ok: false; code: IdentityCode; why: string; mode: IdentityMode };

/**
 * Checks the request's proof. ok with key_id null: no proof was needed (off), or none came in optional mode. Every
 * refusal and every absence is audited; a verified request is too (principal.identity_verified, with its key).
 */
export function verifyAgentIdentity(
  db: DB, req: { agent: string; method: string; target: string; body: unknown; proof: unknown },
  o: { mode?: IdentityMode; now?: Date; via: string },
): IdentityVerdict {
  const mode = o.mode ?? identityMode();
  if (mode === "off") return { ok: true, key_id: null, mode };
  const now = o.now ?? new Date();
  const target = req.target.slice(0, 120);
  const no = (code: IdentityCode, why: string, keyId?: string): IdentityVerdict => {
    audit(db, "system", IDENTITY_REFUSED, req.agent, { agent: req.agent, code, via: o.via, target, mode, ...(keyId ? { key_id: keyId } : {}) }, now);
    return { ok: false, code, why, mode };
  };
  if (req.proof === undefined || req.proof === null) {
    if (mode === "required") return no("identity_missing", "this request carries no signed agent identity, and this agent API requires one");
    audit(db, "system", "principal.identity_absent", req.agent, { agent: req.agent, via: o.via, target }, now);
    return { ok: true, key_id: null, mode };
  }
  const p = parseProof(req.proof);
  if (!p) return no("identity_malformed", "the signed identity is not one: its fields are missing, extra or malformed");
  if (p.agent !== req.agent) return no("identity_wrong_agent", `the identity is signed for ${p.agent}, not for ${req.agent}`, p.key_id);
  const pr = db.prepare("SELECT status, expires_at FROM principals WHERE principal_id = ?").get(req.agent) as { status: string; expires_at: string | null } | undefined;
  if (pr && (pr.status !== "ACTIVE" || (pr.expires_at && Date.parse(pr.expires_at) <= now.getTime()))) return no("identity_principal_inactive", `${req.agent}'s identity was revoked or has expired`, p.key_id);
  identityTables(db);
  const key = db.prepare("SELECT * FROM principal_identity_keys WHERE key_id = ?").get(p.key_id) as KeyRow | undefined;
  if (!pr || !currentIdentityKey(db, req.agent)) return no("identity_no_key", `${req.agent} has no signing key yet; it gets one when its key is rotated`, p.key_id);
  if (!key || key.principal_id !== req.agent) return no("identity_unknown_key", `${p.key_id} is not a key of ${req.agent}`, p.key_id);
  if (key.status !== "current") return no("identity_key_rotated", `${p.key_id} was replaced by a newer key; sign with the current one`, p.key_id);
  const { sig, ...env } = p;
  let good = false;
  try { good = verify(null, Buffer.from(jcs(env as unknown as Json), "utf8"), createPublicKey({ key: Buffer.from(key.public_key, "base64url"), format: "der", type: "spki" }), Buffer.from(sig, "base64url")); } catch { good = false; }
  if (!good) return no("identity_bad_signature", `the signature does not verify against ${p.key_id}`, p.key_id);
  if (p.method !== req.method || p.target !== req.target) return no("identity_request_mismatch", `the identity was signed for ${p.method} ${p.target.slice(0, 80)}, not this request`, p.key_id);
  if (p.body_sha256 !== bodyHash(req.body)) return no("identity_body_mismatch", "the request's body is not the one that was signed", p.key_id);
  const ts = Date.parse(p.ts);
  if (!Number.isFinite(ts) || Math.abs(ts - now.getTime()) > IDENTITY_WINDOW_S * 1000) return no("identity_stale", `signed at ${p.ts}: more than ${IDENTITY_WINDOW_S / 60} minutes from now`, p.key_id);
  // The nonce last, so a refused request never spends one. Kept for twice the window: no proof carrying it can still pass.
  const fresh = db.transaction(() => {
    db.prepare("DELETE FROM agent_identity_nonces WHERE seen_at < ?").run(now.getTime() - 2 * IDENTITY_WINDOW_S * 1000);
    return db.prepare("INSERT OR IGNORE INTO agent_identity_nonces (key_id, nonce, seen_at) VALUES (?, ?, ?)").run(p.key_id, p.nonce, now.getTime()).changes === 1;
  })();
  if (!fresh) return no("identity_nonce_reused", "this nonce was used before: a replay", p.key_id);
  audit(db, "system", "principal.identity_verified", req.agent, { agent: req.agent, key_id: p.key_id, via: o.via, target, method: p.method }, now);
  return { ok: true, key_id: p.key_id, mode };
}

// Loaded, this module makes each new principal's key pair (./principals.ts calls it through the hook).
identityHook.issue = issueIdentityKey as NonNullable<typeof identityHook.issue>;
