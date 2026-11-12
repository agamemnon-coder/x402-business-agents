// Signing and encryption for the Intelligent Commerce Connect client, built from the public documentation only
// (docs/visa-icc.md, "Authentication"). Nothing here has been sent to the service: the structure is tested against the
// documentation's own examples, and signatures against Node's own verify with keys made in the test.
//
// Three documented ways to prove who is calling, each computed per request (no login call):
//   jwt-p12            a JWT signed with the private key of the P12 certificate (RS256), "v-c-jwt-version" 2;
//   jwt-shared-secret  the same JWT signed with the shared secret (HS256);
//   http-signature     the older HTTP Signature (HmacSHA256 over a validation string of header lines).
// And Message-Level Encryption (MLE): the request's JSON becomes {"encryptedRequest": <compact JWE>}, encrypted for the
// service's certificate (RSA-OAEP, A256GCM, kid = the SERIALNUMBER of the certificate's subject); an answer comes as
// {"encryptedResponse": <compact JWE>} (RSA-OAEP-256, A256GCM) and is opened with the Response MLE private key.
//
// Keys are PEM files (Node cannot open a PKCS#12 file without a library; the runbook converts the downloads once).
// A private key file must be a regular file of this user that nobody else can read. No key, passphrase, token or
// decrypted text is ever put in an error: an error names the environment variable and what is wrong, nothing more.
//
// Only node:crypto. Where the documentation shows two forms that only the sandbox can settle, one switch each: the
// digest (of the hash's raw bytes, the default, or of its hexadecimal text) and the HTTP Signature's date header
// ("v-c-date", the default, or "date").

import {
  constants, createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, privateDecrypt, publicEncrypt,
  randomBytes, sign, X509Certificate, type KeyObject,
} from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, constants as fsConstants } from "node:fs";

export type IccAuthScheme = "jwt-p12" | "jwt-shared-secret" | "http-signature";
export type IccDigestForm = "raw" | "hex";
export type IccDateHeader = "v-c-date" | "date";
export type IccMethod = "GET" | "POST" | "PUT";

/** Something about a key, a token or an encrypted message is wrong. Its text never holds key material or content. */
export class IccCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IccCryptoError";
  }
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

/**
 * The digest of an HTTP body. "raw": Base64 of the SHA-256's 32 bytes, as the documentation's C#, Java and MLE
 * samples compute it. "hex": Base64 of the hash's hexadecimal text, as its shell example does.
 */
export function bodyDigest(body: string, form: IccDigestForm = "raw"): string {
  const hash = createHash("sha256").update(body, "utf8");
  return form === "raw" ? hash.digest("base64") : Buffer.from(hash.digest("hex"), "ascii").toString("base64");
}

// ---- the JWT -------------------------------------------------------------------------------------------------------

export interface JwtRequest {
  method: IccMethod;
  /** The host name only, as "request-host" wants it. */
  host: string;
  path: string;
  /** The HTTP body exactly as it is sent (with MLE: the {"encryptedRequest": …} text), or null when there is none. */
  body: string | null;
  merchantId: string;
  issuedAt: Date;
  /** A version 4 UUID, new for every request ("used for replay prevention"). */
  jti: string;
  digestForm?: IccDigestForm;
  /** The key ID of the Response MLE key: asks the service to encrypt its answer for that key. */
  responseMleKeyId?: string;
  /** How long the token lives: two minutes at most, which is also the default. */
  lifetimeSeconds?: number;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
export const JWT_MAX_LIFETIME_SECONDS = 120;

/** The JWT's body claims, in the order of the documentation's own example. `iat` and `exp` are numbers, as there. */
export function jwtClaims(r: JwtRequest): Record<string, string | number> {
  if (!UUID_V4.test(r.jti)) throw new IccCryptoError("the token ID (jti) must be a version 4 UUID");
  if (!HOST.test(r.host)) throw new IccCryptoError("the request host must be a host name only, in lower case");
  if (!r.path.startsWith("/")) throw new IccCryptoError("the request path must start with /");
  const lifetime = r.lifetimeSeconds ?? JWT_MAX_LIFETIME_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime <= 0 || lifetime > JWT_MAX_LIFETIME_SECONDS) throw new IccCryptoError("a token lives two minutes at most");
  const iat = Math.floor(r.issuedAt.getTime() / 1000);
  return {
    ...(r.body === null || r.body === "" ? {} : { digest: bodyDigest(r.body, r.digestForm ?? "raw"), digestAlgorithm: "SHA-256" }),
    iat, exp: iat + lifetime,
    "request-method": r.method.toLowerCase(),
    "request-resource-path": r.path,
    "request-host": r.host,
    iss: r.merchantId,
    jti: r.jti,
    "v-c-jwt-version": "2",
    "v-c-merchant-id": r.merchantId,
    ...(r.responseMleKeyId ? { "v-c-response-mle-kid": r.responseMleKeyId } : {}),
  };
}

/** What is signed: the Base64URL of the header's JSON text, a point, the Base64URL of the claims' JSON text. */
export function signingInput(headerJson: string, claimsJson: string): string {
  return `${b64url(headerJson)}.${b64url(claimsJson)}`;
}

export type IccSigner =
  | { scheme: "jwt-p12"; keyId: string; privateKey: KeyObject }
  | { scheme: "jwt-shared-secret"; keyId: string; secret: Buffer }
  | { scheme: "http-signature"; keyId: string; secret: Buffer };

/** The complete token: header, claims and signature, each Base64URL without padding, joined by points. */
export function signJwt(signer: Exclude<IccSigner, { scheme: "http-signature" }>, claims: Record<string, string | number>): string {
  const header = { alg: signer.scheme === "jwt-p12" ? "RS256" : "HS256", kid: signer.keyId, typ: "JWT" };
  const input = signingInput(JSON.stringify(header), JSON.stringify(claims));
  const signature = signer.scheme === "jwt-p12"
    ? sign("sha256", Buffer.from(input, "ascii"), signer.privateKey)
    : createHmac("sha256", signer.secret).update(input, "ascii").digest();
  return `${input}.${b64url(signature)}`;
}

// ---- the HTTP Signature ----------------------------------------------------------------------------------------------

/**
 * The validation string: one `name: value` line per signed header, in the order of the `headers` parameter, joined by
 * a new line; `request-target` is the method in lower case, a space and the path. No digest line without a body.
 */
export function httpSignatureBase(r: { method: IccMethod; host: string; path: string; date: Date; dateHeader?: IccDateHeader; digest: string | null; merchantId: string }): { headers: string; text: string } {
  const lines: [string, string][] = [
    ["host", r.host],
    [r.dateHeader ?? "v-c-date", r.date.toUTCString()],
    ["request-target", `${r.method.toLowerCase()} ${r.path}`],
    ...(r.digest === null ? [] : [["digest", r.digest] as [string, string]]),
    ["v-c-merchant-id", r.merchantId],
  ];
  return { headers: lines.map(([name]) => name).join(" "), text: lines.map(([name, value]) => `${name}: ${value}`).join("\n") };
}

export interface SignedRequest {
  method: IccMethod;
  host: string;
  path: string;
  body: string | null;
  merchantId: string;
  at: Date;
  digestForm?: IccDigestForm;
  dateHeader?: IccDateHeader;
}

/** The headers of an HTTP Signature message: the date, the merchant ID, the digest (with a body) and the signature. */
export function httpSignatureHeaders(key: { keyId: string; secret: Buffer }, r: SignedRequest): Record<string, string> {
  const dateHeader = r.dateHeader ?? "v-c-date";
  const digest = r.body === null || r.body === "" ? null : `SHA-256=${bodyDigest(r.body, r.digestForm ?? "raw")}`;
  const base = httpSignatureBase({ method: r.method, host: r.host, path: r.path, date: r.at, dateHeader, digest, merchantId: r.merchantId });
  const signature = createHmac("sha256", key.secret).update(base.text, "utf8").digest("base64");
  return {
    [dateHeader]: r.at.toUTCString(),
    "v-c-merchant-id": r.merchantId,
    ...(digest === null ? {} : { digest }),
    signature: `keyid="${key.keyId}", algorithm="HmacSHA256", headers="${base.headers}", signature="${signature}"`,
  };
}

/** The headers that prove who is calling, for one request, in the signer's scheme. The host header is fetch's own. */
export function requestHeaders(signer: IccSigner, r: SignedRequest & { jti: string; responseMleKeyId?: string }): Record<string, string> {
  // content-type on every call, a GET included: the page lists content-type, host and authorization as required.
  const content: Record<string, string> = { "content-type": "application/json" };
  if (signer.scheme === "http-signature") return { ...content, ...httpSignatureHeaders(signer, r) };
  const claims = jwtClaims({ method: r.method, host: r.host, path: r.path, body: r.body, merchantId: r.merchantId, issuedAt: r.at, jti: r.jti, digestForm: r.digestForm, responseMleKeyId: r.responseMleKeyId });
  return { ...content, authorization: `Bearer ${signJwt(signer, claims)}` };
}

// ---- Message-Level Encryption ----------------------------------------------------------------------------------------

/** The service's certificate that requests are encrypted for: its public key and the key ID that goes in the JWE. */
export interface MleRequestKey {
  publicKey: KeyObject;
  keyId: string;
}

/** A request's JSON as a compact JWE: RSA-OAEP for the content key, A256GCM for the message, as the Java sample does. */
export function encryptRequest(json: string, key: MleRequestKey): string {
  const header = b64url(JSON.stringify({ alg: "RSA-OAEP", enc: "A256GCM", cty: "JWT", kid: key.keyId }));
  const contentKey = randomBytes(32), iv = randomBytes(12);
  try {
    const wrapped = publicEncrypt({ key: key.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, contentKey);
    const cipher = createCipheriv("aes-256-gcm", contentKey, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(header, "ascii"));
    const ciphertext = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
    return [header, b64url(wrapped), b64url(iv), b64url(ciphertext), b64url(cipher.getAuthTag())].join(".");
  } catch {
    throw new IccCryptoError("the request could not be encrypted for the request certificate");
  } finally {
    contentKey.fill(0);
  }
}

/** The OAEP hash per documented `alg`: RSA-OAEP-256 for answers; RSA-OAEP is what requests use. */
const OAEP_HASH: Record<string, string> = { "RSA-OAEP-256": "sha256", "RSA-OAEP": "sha1" };

/** Opens a compact JWE with the private key. Any failure is one error that says nothing about the content. */
export function decryptResponse(jwe: string, privateKey: KeyObject): string {
  const parts = jwe.split(".");
  if (parts.length !== 5 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new IccCryptoError("the encrypted answer is not a compact JWE");
  const [header, wrapped, iv, ciphertext, tag] = parts as [string, string, string, string, string];
  let alg: unknown, enc: unknown;
  try {
    ({ alg, enc } = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: unknown; enc?: unknown });
  } catch {
    throw new IccCryptoError("the encrypted answer's header is not JSON");
  }
  const oaepHash = typeof alg === "string" ? OAEP_HASH[alg] : undefined;
  if (!oaepHash || enc !== "A256GCM") throw new IccCryptoError("the encrypted answer uses an algorithm the documentation does not name");
  let contentKey: Buffer | null = null;
  try {
    contentKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash }, Buffer.from(wrapped, "base64url"));
    const authTag = Buffer.from(tag, "base64url");
    if (contentKey.length !== 32 || authTag.length !== 16) throw new Error("size");
    const decipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(iv, "base64url"), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(header, "ascii"));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new IccCryptoError("the encrypted answer could not be opened with the response key");
  } finally {
    contentKey?.fill(0);
  }
}

// ---- key files ---------------------------------------------------------------------------------------------------------

const MAX_KEY_FILE = 64 * 1024;

/** A file's bytes: a regular file (no symlink), at most 64 KiB; with `privateOnly`, this user's and nobody else's to read. */
function readKeyFileBytes(file: string, name: string, privateOnly: boolean): Buffer {
  let fd: number;
  try {
    fd = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (e) {
    throw new IccCryptoError(`${name}: the file could not be opened (${(e as NodeJS.ErrnoException).code ?? "error"})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new IccCryptoError(`${name}: not a regular file`);
    if (privateOnly && (st.mode & 0o077) !== 0) throw new IccCryptoError(`${name}: the file is readable by others; refused (chmod 600)`);
    if (privateOnly && typeof process.getuid === "function" && st.uid !== process.getuid()) throw new IccCryptoError(`${name}: the file belongs to another user; refused`);
    if (st.size === 0 || st.size > MAX_KEY_FILE) throw new IccCryptoError(`${name}: the file is empty or too large`);
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, st.size, 0);
    return buf;
  } finally {
    closeSync(fd);
  }
}

/** A PEM private key from a file only this user can read. `name` is the environment variable, for the error. */
export function readPrivateKeyFile(file: string, passphrase: string | undefined, name: string): KeyObject {
  const pem = readKeyFileBytes(file, name, true);
  try {
    const key = createPrivateKey({ key: pem, format: "pem", ...(passphrase ? { passphrase } : {}) });
    if (key.asymmetricKeyType !== "rsa") throw new Error("type");
    return key;
  } catch {
    throw new IccCryptoError(`${name}: not a PEM RSA private key this passphrase opens (or a passphrase is needed and none is set)`);
  } finally {
    pem.fill(0);
  }
}

/**
 * The certificate that requests are encrypted for (PEM). Its key ID is the SERIALNUMBER of the certificate's subject;
 * without one, the certificate's own serial number in decimal, as the documentation's Java sample falls back to.
 */
export function readRequestCertificate(file: string, name: string): MleRequestKey {
  const pem = readKeyFileBytes(file, name, false);
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    throw new IccCryptoError(`${name}: not a PEM certificate`);
  }
  if (cert.publicKey.asymmetricKeyType !== "rsa") throw new IccCryptoError(`${name}: the certificate's key is not RSA`);
  const inSubject = /^serialNumber=(.+)$/im.exec(cert.subject)?.[1]?.trim();
  const keyId = inSubject || BigInt(`0x${cert.serialNumber}`).toString(10);
  return { publicKey: cert.publicKey, keyId };
}

/** The shared secret's bytes: the Business Center gives it Base64-encoded, and the HMAC is keyed with the decoded bytes. */
export function sharedSecretKey(base64: string): Buffer {
  const text = base64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) throw new IccCryptoError("the shared secret is not Base64");
  return Buffer.from(text, "base64");
}
