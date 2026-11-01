// D20: a passkey sign-in, verified in the Worker itself (WebCrypto only, no library): the WebAuthn assertion's
// clientDataJSON (type, challenge, origin), its authenticator data (RP id hash, user present, user verified, the
// signature counter) and its ES256 signature over authenticatorData ‖ SHA-256(clientDataJSON), against the public key
// of a credential the runner enrolled. Every failure says which check, and nothing throws to the caller.

export interface PublicKeyXY { x: string; y: string }
export interface AssertionB64 { authenticatorData: string; clientDataJSON: string; signature: string }
export interface Expected { challenge: string; origin: string; rpId: string; lastCounter: number }
export type Verdict = { ok: true; counter: number } | { ok: false; why: string };

const fromB64u = (s: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** An ES256 DER signature (SEQUENCE of two INTEGERs) as the 64-byte r ‖ s WebCrypto verifies. */
export function derToRaw(der: Uint8Array): Uint8Array {
  let i = 0;
  const take = (tag: number) => {
    if (der[i++] !== tag) throw new Error("bad DER");
    let len = der[i++]!;
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = (len << 8) | der[i++]!; }
    const out = der.slice(i, i + len); i += len;
    if (out.length !== len) throw new Error("short DER");
    return out;
  };
  const seq = take(0x30);
  if (i !== der.length) throw new Error("trailing bytes");
  der = seq; i = 0;
  const int = (b: Uint8Array) => { let s = 0; while (s < b.length - 1 && b[s] === 0) s++; const v = b.slice(s); if (v.length > 32) throw new Error("integer too long"); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = int(take(0x02)), s = int(take(0x02));
  if (i !== der.length) throw new Error("trailing bytes");
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32);
  return raw;
}

export async function verifyAssertion(a: AssertionB64, key: PublicKeyXY, exp: Expected): Promise<Verdict> {
  try {
    const authData = fromB64u(a.authenticatorData), clientData = fromB64u(a.clientDataJSON), der = fromB64u(a.signature);
    const c = JSON.parse(new TextDecoder().decode(clientData)) as { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
    if (c.type !== "webauthn.get") return { ok: false, why: "type" };
    if (c.challenge !== exp.challenge) return { ok: false, why: "challenge" };
    if (c.origin !== exp.origin || c.crossOrigin === true) return { ok: false, why: "origin" };
    if (authData.length < 37) return { ok: false, why: "authenticator data" };
    const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exp.rpId)));
    if (!same(authData.slice(0, 32), rpHash)) return { ok: false, why: "rp id" };
    const flags = authData[32]!;
    if (!(flags & 0x01)) return { ok: false, why: "user presence" };
    if (!(flags & 0x04)) return { ok: false, why: "user verification" };
    const counter = ((authData[33]! << 24) | (authData[34]! << 16) | (authData[35]! << 8) | authData[36]!) >>> 0;
    const pub = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: key.x, y: key.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const cdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(clientData)));
    const signed = new Uint8Array(authData.length + 32); signed.set(authData, 0); signed.set(cdHash, authData.length);
    const good = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, new Uint8Array(derToRaw(der)), signed);
    if (!good) return { ok: false, why: "signature" };
    // A counter that is used must move forward (a cloned or replayed authenticator); 0 and 0 means the authenticator
    // keeps no counter (iCloud passkeys), and the one-time challenge stops a replay.
    if ((counter !== 0 || exp.lastCounter !== 0) && counter <= exp.lastCounter) return { ok: false, why: "counter" };
    return { ok: true, counter };
  } catch {
    return { ok: false, why: "malformed" };
  }
}
