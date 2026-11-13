// WebCrypto only (the Worker has no node:crypto by default): hashes, random tokens, HMAC and a constant-time compare.

const enc = new TextEncoder();

export function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "===".slice((norm.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : new Uint8Array(data);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  return toB64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Equal strings compared without an early exit (for secrets' hashes). */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function hmacB64u(secret: string, message: string): Promise<string> {
  return toB64u(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message))));
}

export async function hmacValid(secret: string, message: string, sigB64u: string): Promise<boolean> {
  try {
    const sig = fromB64(sigB64u);
    // Only the one spelling hmacB64u writes (13 Nov): base64url keeps two padding bits in the last character of a 32-byte
    // MAC, so "…A" and "…B" decode to the same bytes. A token checked or spent by its text (a consent form's, by its
    // hash) could otherwise be replayed under a second spelling; and a test that forged one by its last character
    // passed now and then.
    if (toB64u(sig) !== sigB64u) return false;
    return await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(message));
  } catch {
    return false;
  }
}

/**
 * The JSON a signed token carries (`<tag>.<base64url JSON>.<HMAC of the JSON part under secret>`), or null: another tag,
 * longer than maxLen, a signature that does not check, or a body that is not JSON. Sessions, connector access tokens,
 * OAuth client ids and consent forms are all read through it; each caller then checks the fields it needs.
 */
export async function signedPayload(secret: string, tag: string, token: string, maxLen: number): Promise<unknown> {
  if (token.length > maxLen) return null;
  const [t, body, sig] = token.split(".");
  if (t !== tag || !body || !sig || !(await hmacValid(secret, body, sig))) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64(body))) as unknown;
  } catch {
    return null;
  }
}
