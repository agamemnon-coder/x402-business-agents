// D25: the two signatures on an agent's card checkout. Pure: no I/O, no clock, no database (the caller passes the
// time, the nonce and the key).
//
// Signature 1 is the Trusted Agent Protocol signature as Visa's reference proxy (cdn-proxy/server.js at commit 16d59bd,
// github.com/visa/trusted-agent-protocol, unmodified) reads and verifies it: headers Signature-Input and Signature, label sig2, components ("@authority" "@path"),
// parameters created, expires, keyId (camelCase: the proxy reads keyId, so this is not RFC 9421's keyid and not an RFC
// 8941 key), alg="ed25519", nonce and tag. The proxy rebuilds the signature base from the header text it received
// (minus "sig2="), so the signer signs the exact text it sends; it is built by hand because http-message-sig cannot
// emit keyId. The layout ("; " between parameters) is the one the reference's own agent emits.
//
// Signature 2 is ours, on top of TAP (the reference ignores it): headers Purser-Signature-Input and Purser-Signature,
// label body, RFC 9421 format, the same key, over "@method" "@authority" "@path" "@query" "content-digest"
// "signature-input" "signature" with created, expires, keyid, alg, nonce (equal to signature 1's) and tag="purser-body".
// Covering TAP's two headers binds the body to that one TAP signature and authenticates its tag, window, key and nonce
// for our merchant layer; Content-Digest (RFC 9530) binds the exact body bytes.
//
// Both sides import the same window and skew from here: a signature lives at most TAP_MAX_WINDOW_S, and the merchant
// allows TAP_CLOCK_SKEW_S of clock difference either way.

import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from "node:crypto";

export type TapTag = "agent-payer-auth" | "agent-browser-auth";
export const TAP_TAGS: readonly TapTag[] = ["agent-payer-auth", "agent-browser-auth"];
export const BODY_TAG = "purser-body";
/** The spec's window: a signature lives at most 8 minutes. */
export const TAP_MAX_WINDOW_S = 480;
/** Clock difference allowed either way, on every check of created and expires; the signer's default life leaves room for it. */
export const TAP_CLOCK_SKEW_S = 30;
/** What the signer gives a signature by default: well inside the window. */
export const TAP_DEFAULT_LIFE_S = 300;

const SIG1_LABEL = "sig2";
const SIG1_COMPONENTS = '("@authority" "@path")';
const SIG2_LABEL = "body";
export const SIG2_COMPONENTS = ["@method", "@authority", "@path", "@query", "content-digest", "signature-input", "signature"] as const;
const SIG2_COMPONENTS_TEXT = `(${SIG2_COMPONENTS.map((c) => `"${c}"`).join(" ")})`;
/** The reference proxy's own rule for a key id (server.js validateKeyId): letters, digits, ".", "_", "-", at most 100. */
const KEY_ID = /^[A-Za-z0-9._-]{1,100}$/;
/** A nonce we read: base64, base64url or a UUID (the reference agent's), 16 to 200 characters, never a quote. */
const NONCE = /^[A-Za-z0-9+/=._~-]{16,200}$/;

export interface Sig1Params { created: number; expires: number; keyId: string; nonce: string; tag: TapTag }
export interface Sig2Params { created: number; expires: number; keyid: string; nonce: string }
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

// ---- serialisation ---------------------------------------------------------------------------------------------

/** Signature 1's parameters as sent after "sig2=" and signed as @signature-params. */
export function sig1ParamsText(p: Sig1Params): string {
  return `${SIG1_COMPONENTS}; created=${p.created}; expires=${p.expires}; keyId="${p.keyId}"; alg="ed25519"; nonce="${p.nonce}"; tag="${p.tag}"`;
}

/** The signature base the reference proxy rebuilds: its Host header, its req.url (with any query), the parameters. */
export function sig1Base(authority: string, target: string, paramsText: string): string {
  return `"@authority": ${authority}\n"@path": ${target}\n"@signature-params": ${paramsText}`;
}

/** Signature 2's parameters (RFC 8941 serialisation) as sent after "body=" and signed as @signature-params. */
export function sig2ParamsText(p: Sig2Params): string {
  return `${SIG2_COMPONENTS_TEXT};created=${p.created};expires=${p.expires};keyid="${p.keyid}";alg="ed25519";nonce="${p.nonce}";tag="${BODY_TAG}"`;
}

export interface Sig2Components { method: string; authority: string; path: string; query: string; contentDigest: string; signatureInput: string; signature: string }

/** RFC 9421 §2.5 signature base for signature 2. Header values as sent (one field line each, trimmed). */
export function sig2Base(c: Sig2Components, paramsText: string): string {
  return [
    `"@method": ${c.method}`,
    `"@authority": ${c.authority}`,
    `"@path": ${c.path}`,
    `"@query": ${c.query}`,
    `"content-digest": ${c.contentDigest}`,
    `"signature-input": ${c.signatureInput}`,
    `"signature": ${c.signature}`,
    `"@signature-params": ${paramsText}`,
  ].join("\n");
}

/** RFC 9421 §2.2.6 and §2.2.7: @path without the query, @query with its "?" ("?" alone when there is none). */
export function splitTarget(target: string): { path: string; query: string } {
  const i = target.indexOf("?");
  return i < 0 ? { path: target || "/", query: "?" } : { path: target.slice(0, i) || "/", query: target.slice(i) };
}

/** RFC 9530 Content-Digest with one sha-256 entry over the exact body bytes. */
export function contentDigest(body: Uint8Array | string): string {
  return `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
}

// ---- keys --------------------------------------------------------------------------------------------------------

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

export interface Ed25519Key { privateKey: KeyObject; publicKey: KeyObject; publicRaw: Buffer }

/** An Ed25519 key from its 32-byte seed (tests use fixed seeds; agents keep theirs in a key file). */
export function ed25519FromSeed(seed: Uint8Array): Ed25519Key {
  if (seed.length !== 32) throw new Error("an Ed25519 seed is 32 bytes");
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
  return withPublic(privateKey);
}

/** The public half of a private key, and its raw 32 bytes (what the reference registry stores, in base64). */
export function withPublic(privateKey: KeyObject): Ed25519Key {
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || typeof jwk.x !== "string") throw new Error("not an Ed25519 key");
  return { privateKey, publicKey, publicRaw: Buffer.from(jwk.x, "base64url") };
}

/** Never throws: a malformed key or signature is simply not valid. */
export function verifyEd25519(publicKey: KeyObject, base: string, signature: Uint8Array): boolean {
  try {
    return signature.length === 64 && verify(null, Buffer.from(base, "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

/** 32 random bytes, base64url: fits both the reference proxy's and our nonce rules. */
export function newNonce(): string {
  return randomBytes(32).toString("base64url");
}

// ---- signing -----------------------------------------------------------------------------------------------------

export interface TapSignOptions {
  /** Host (and port) the request is sent to: what the reference proxy sees as @authority. */
  authority: string;
  /** The request target as sent: path and any query (the proxy's req.url). Checkout URLs carry no query. */
  target: string;
  method: string;
  body: Uint8Array | string;
  keyId: string;
  privateKey: KeyObject;
  /** Seconds since the epoch. */
  created: number;
  /** Seconds; TAP_DEFAULT_LIFE_S when absent, never over TAP_MAX_WINDOW_S. */
  expiresIn?: number;
  nonce: string;
  tag: TapTag;
}

export interface TapHeaders {
  "signature-input": string;
  signature: string;
  "content-digest": string;
  "purser-signature-input": string;
  "purser-signature": string;
}

/** Signs a checkout with both signatures. Refuses to sign what the merchant would refuse for its form. */
export function signTapCheckout(o: TapSignOptions): TapHeaders {
  const life = o.expiresIn ?? TAP_DEFAULT_LIFE_S;
  if (!Number.isSafeInteger(o.created) || !Number.isSafeInteger(life) || life <= 0) throw new Error(`an empty or invalid window (${life} s)`);
  if (life > TAP_MAX_WINDOW_S) throw new Error(`a window of ${life} s is over ${TAP_MAX_WINDOW_S} s`);
  if (!KEY_ID.test(o.keyId)) throw new Error("the keyId must match the reference proxy's rule (letters, digits, . _ -, at most 100)");
  if (!NONCE.test(o.nonce)) throw new Error("the nonce must be 16 to 200 base64, base64url or UUID characters");
  if (!TAP_TAGS.includes(o.tag)) throw new Error(`unknown tag ${o.tag}`);
  // Hosts are case-insensitive; the merchant compares lower case, so the agent signs (and must send) lower case.
  return signTapCheckoutUnchecked({ ...o, authority: o.authority.toLowerCase() });
}

/** For red-team tests only: signs whatever it is given, so the merchant's refusals can be shown. */
export function signTapCheckoutUnchecked(o: TapSignOptions): TapHeaders {
  const expires = o.created + (o.expiresIn ?? TAP_DEFAULT_LIFE_S);
  const p1 = sig1ParamsText({ created: o.created, expires, keyId: o.keyId, nonce: o.nonce, tag: o.tag });
  const signatureInput = `${SIG1_LABEL}=${p1}`;
  const signature = `${SIG1_LABEL}=:${sign(null, Buffer.from(sig1Base(o.authority, o.target, p1), "utf8"), o.privateKey).toString("base64")}:`;
  const digest = contentDigest(o.body);
  const p2 = sig2ParamsText({ created: o.created, expires, keyid: o.keyId, nonce: o.nonce });
  const { path, query } = splitTarget(o.target);
  const base2 = sig2Base({ method: o.method.toUpperCase(), authority: o.authority, path, query, contentDigest: digest, signatureInput, signature }, p2);
  return {
    "signature-input": signatureInput,
    signature,
    "content-digest": digest,
    "purser-signature-input": `${SIG2_LABEL}=${p2}`,
    "purser-signature": `${SIG2_LABEL}=:${sign(null, Buffer.from(base2, "utf8"), o.privateKey).toString("base64")}:`,
  };
}

// ---- parsing (strict: a subset of what the reference proxy reads, so where we accept, it reads the same values) ----

type ParamValue = string | number;

/** `;` (optionally one space) name=value pairs to the end; each allowed name exactly once. */
function parseParams(text: string, names: readonly string[], hint: Record<string, string> = {}): Parsed<Record<string, ParamValue>> {
  const out: Record<string, ParamValue> = {};
  let rest = text;
  while (rest.length) {
    const m = /^; ?([A-Za-z][A-Za-z0-9_-]*)=("[^"\\]*"|\d{1,15})/.exec(rest);
    if (!m) return { ok: false, reason: `cannot read the parameters at "${rest.slice(0, 40)}"` };
    const [all, name, raw] = m as unknown as [string, string, string];
    if (!names.includes(name)) return { ok: false, reason: `unknown parameter ${name}${hint[name] ? ` (${hint[name]})` : ""}` };
    if (name in out) return { ok: false, reason: `parameter ${name} twice` };
    out[name] = raw.startsWith('"') ? raw.slice(1, -1) : Number(raw);
    rest = rest.slice(all.length);
  }
  for (const n of names) if (!(n in out)) return { ok: false, reason: `missing parameter ${n}` };
  return { ok: true, value: out };
}

function common(p: Record<string, ParamValue>, keyName: string): string | null {
  if (typeof p.created !== "number" || typeof p.expires !== "number") return "created and expires must be integers";
  if (typeof p[keyName] !== "string" || !KEY_ID.test(p[keyName] as string)) return `${keyName} must match the reference proxy's rule (letters, digits, . _ -, at most 100)`;
  if (p.alg !== "ed25519") return `alg must be "ed25519", not ${String(p.alg)}`;
  if (typeof p.nonce !== "string" || !NONCE.test(p.nonce)) return "the nonce is not 16 to 200 base64, base64url or UUID characters";
  return null;
}

function signatureBytes(header: string, label: string, which: string): Parsed<Buffer> {
  const m = new RegExp(`^${label}=:([A-Za-z0-9+/]+={0,2}):$`).exec(header);
  if (!m) return { ok: false, reason: `${which} header must be exactly ${label}=:<base64>:` };
  const bytes = Buffer.from(m[1]!, "base64");
  return bytes.length === 64 ? { ok: true, value: bytes } : { ok: false, reason: `${which} must be 64 bytes (Ed25519), got ${bytes.length}` };
}

export interface ParsedSig1 extends Sig1Params { paramsText: string; signature: Buffer }

/** Signature-Input and Signature as received (one field line each). */
export function parseSig1(signatureInput: string, signature: string): Parsed<ParsedSig1> {
  if (!signatureInput.startsWith(`${SIG1_LABEL}=(`)) return { ok: false, reason: `signature 1 must have the label ${SIG1_LABEL} (the reference proxy reads no other)` };
  const paramsText = signatureInput.slice(SIG1_LABEL.length + 1);
  if (!paramsText.startsWith(SIG1_COMPONENTS)) return { ok: false, reason: `signature 1 components must be exactly ${SIG1_COMPONENTS}` };
  const p = parseParams(paramsText.slice(SIG1_COMPONENTS.length), ["created", "expires", "keyId", "alg", "nonce", "tag"], { keyid: "signature 1 names its key keyId, as the reference proxy reads it" });
  if (!p.ok) return { ok: false, reason: `signature 1: ${p.reason}` };
  const bad = common(p.value, "keyId");
  if (bad) return { ok: false, reason: `signature 1: ${bad}` };
  const tag = p.value.tag;
  if (!TAP_TAGS.includes(tag as TapTag)) return { ok: false, reason: `signature 1: tag ${String(tag)} is not a TAP tag` };
  const sig = signatureBytes(signature, SIG1_LABEL, "signature 1");
  if (!sig.ok) return sig;
  const v = p.value;
  return { ok: true, value: { created: v.created as number, expires: v.expires as number, keyId: v.keyId as string, nonce: v.nonce as string, tag: tag as TapTag, paramsText, signature: sig.value } };
}

export interface ParsedSig2 extends Sig2Params { tag: typeof BODY_TAG; paramsText: string; signature: Buffer }

/** Purser-Signature-Input and Purser-Signature as received (one field line each). */
export function parseSig2(signatureInput: string, signature: string): Parsed<ParsedSig2> {
  if (!signatureInput.startsWith(`${SIG2_LABEL}=(`)) return { ok: false, reason: `signature 2 must have the label ${SIG2_LABEL}` };
  const paramsText = signatureInput.slice(SIG2_LABEL.length + 1);
  if (!paramsText.startsWith(SIG2_COMPONENTS_TEXT)) return { ok: false, reason: `signature 2 components must be exactly ${SIG2_COMPONENTS_TEXT}` };
  const p = parseParams(paramsText.slice(SIG2_COMPONENTS_TEXT.length), ["created", "expires", "keyid", "alg", "nonce", "tag"]);
  if (!p.ok) return { ok: false, reason: `signature 2: ${p.reason}` };
  const bad = common(p.value, "keyid");
  if (bad) return { ok: false, reason: `signature 2: ${bad}` };
  if (p.value.tag !== BODY_TAG) return { ok: false, reason: `signature 2: tag must be ${BODY_TAG}, not ${String(p.value.tag)}` };
  const sig = signatureBytes(signature, SIG2_LABEL, "signature 2");
  if (!sig.ok) return sig;
  const v = p.value;
  return { ok: true, value: { created: v.created as number, expires: v.expires as number, keyid: v.keyid as string, nonce: v.nonce as string, tag: BODY_TAG, paramsText, signature: sig.value } };
}

/** Content-Digest as received: exactly one entry, sha-256, 32 bytes. */
export function parseContentDigest(header: string): Parsed<Buffer> {
  const m = /^sha-256=:([A-Za-z0-9+/]+={0,2}):$/.exec(header);
  if (!m) return { ok: false, reason: "Content-Digest must hold exactly one sha-256 entry" };
  const d = Buffer.from(m[1]!, "base64");
  return d.length === 32 ? { ok: true, value: d } : { ok: false, reason: `Content-Digest sha-256 must be 32 bytes, got ${d.length}` };
}

/** Null when now is inside the signature's window (with the shared skew) and the window is at most 8 minutes. */
export function windowProblem(created: number, expires: number, now: number, skew = TAP_CLOCK_SKEW_S): string | null {
  const w = expires - created;
  if (w <= 0) return `a window of ${w} s is empty`;
  if (w > TAP_MAX_WINDOW_S) return `a window of ${w} s is over ${TAP_MAX_WINDOW_S} s`;
  if (created > now + skew) return "created is in the future";
  if (expires < now - skew) return "the signature has expired";
  return null;
}
