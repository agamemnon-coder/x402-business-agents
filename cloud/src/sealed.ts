// Sealing a company's OAuth tokens at rest (docs/real-customers.md). AES-256-GCM with a key that is a Worker secret
// (OAUTH_TOKEN_KEY, 32 random bytes in base64; never in git, never in the database), a fresh 96-bit IV per value, and
// the company, the provider and the field as additional authenticated data: a sealed token copied into another
// company's row, or into another field, does not open. WebCrypto only (the Worker has no node:crypto by default).

import { fromB64, toB64u } from "./crypto.js";

const enc = new TextEncoder();
const VERSION = "v1";

export class SealError extends Error {
  constructor(message: string) { super(message); this.name = "SealError"; }
}

/** The AES key from its base64 form; anything but 32 bytes is refused (no weaker key is accepted). */
export async function sealKey(b64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = fromB64(b64.trim()); } catch { throw new SealError("the token key is not base64"); }
  if (raw.byteLength !== 32) throw new SealError("the token key must be 32 bytes (base64), for AES-256-GCM");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** What a sealed value is bound to: one company, one provider, one field. */
export const aadOf = (tenantId: string, provider: string, field: string) => `purser-oauth|${tenantId}|${provider}|${field}`;

export async function seal(key: CryptoKey, plain: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(plain)));
  return `${VERSION}.${toB64u(iv)}.${toB64u(ct)}`;
}

/** Opens a sealed value; a wrong key, a tampered value or another company's/field's value throws (and says no more). */
export async function unseal(key: CryptoKey, sealed: string, aad: string): Promise<string> {
  const [v, iv, ct, extra] = sealed.split(".");
  if (v !== VERSION || !iv || !ct || extra !== undefined) throw new SealError("not a sealed value");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv), additionalData: enc.encode(aad) }, key, fromB64(ct));
    return new TextDecoder().decode(plain);
  } catch {
    throw new SealError("a sealed token does not open for this company");
  }
}
