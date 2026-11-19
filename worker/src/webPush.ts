// Web Push from the relay (docs/app/README.md): "Payment needs your signature" on the CFO's phone when a proposal waits
// above the agents' limit, with the passkey page to open. Standard Web Push, WebCrypto only (runs in the Worker and in
// Node tests alike): a VAPID token (RFC 8292, ES256) and the message encrypted for the one subscription (RFC 8291,
// aes128gcm), so the push service carries bytes it cannot read.
//
// The VAPID key pair comes from the Worker's secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT), set by the
// owner (`npx tsx scripts/vapid-keys.ts` prints a new pair; nothing here stores one). Without all three there is no push.
// The private key stays inside the sender this module returns; the relay itself only holds the public key.

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes, uncompressed). */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** base64url of the uncompressed P-256 public key (65 bytes). */
  publicKey: string;
  /** base64url of the private scalar d (32 bytes). */
  privateKey: string;
  /** mailto: or https: contact for the push services. */
  subject: string;
}

/** What one send gives: the push service's status (201 sent; 404 and 410: the subscription is gone), or 0 when it never answered. */
export type PushSend = (sub: PushSubscriptionKeys, payload: string) => Promise<number>;

/** The push services browsers use (Chrome and Android, Firefox, Safari on iPhone and Mac, Edge): the only hosts a send may reach. */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

/** Whether an endpoint is a real push service's, over https: the relay never sends a request anywhere else. */
export function pushEndpointOk(endpoint: string): boolean {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  return PUSH_HOSTS.includes(u.hostname) || PUSH_SUFFIXES.some((s) => u.hostname.endsWith(s) && u.hostname.length > s.length);
}

export const b64u = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function fromB64u(s: string): Uint8Array | null {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
}

/** A subscription as the browser gives it ({endpoint, keys: {p256dh, auth}}), checked; null when anything is off. */
export function readSubscription(v: unknown): PushSubscriptionKeys | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof o.endpoint !== "string" || !pushEndpointOk(o.endpoint) || typeof o.keys !== "object" || o.keys === null) return null;
  const p = typeof o.keys.p256dh === "string" ? fromB64u(o.keys.p256dh) : null;
  const a = typeof o.keys.auth === "string" ? fromB64u(o.keys.auth) : null;
  if (!p || p.length !== 65 || p[0] !== 4 || !a || a.length !== 16) return null;
  return { endpoint: o.endpoint, p256dh: o.keys.p256dh as string, auth: o.keys.auth as string };
}

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, bytes * 8));
}

/**
 * The message encrypted for one subscription (RFC 8291 with RFC 8188's aes128gcm, one record). `local` and `salt` are
 * for tests only (fixed values); otherwise each message gets a new key pair and salt.
 */
export async function encryptPush(sub: { p256dh: string; auth: string }, plaintext: string, test: { local?: CryptoKeyPair; salt?: Uint8Array } = {}): Promise<Uint8Array> {
  const uaPublic = fromB64u(sub.p256dh), authSecret = fromB64u(sub.auth);
  if (!uaPublic || uaPublic.length !== 65 || !authSecret || authSecret.length !== 16) throw new Error("bad subscription keys");
  const local = test.local ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const ua = await crypto.subtle.importKey("raw", buf(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  // { name, public }: WebCrypto's ECDH parameters (Cloudflare's types spell the member $public; the runtime reads public).
  const ecdhAlg = { name: "ECDH", public: ua } as unknown as Parameters<SubtleCrypto["deriveBits"]>[0];
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhAlg, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, cat(enc("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = test.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  // One record: the text, then the delimiter 2 (the last record), no padding.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, key, buf(cat(enc(plaintext), Uint8Array.of(2)))));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, Uint8Array.of(asPublic.length), asPublic, sealed);
}

/** The VAPID token for one push service (its origin is the audience), valid 12 hours: `vapid t=<jwt>, k=<public key>`. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date = new Date()): Promise<string> {
  const pub = fromB64u(keys.publicKey), d = fromB64u(keys.privateKey);
  if (!pub || pub.length !== 65 || pub[0] !== 4 || !d || d.length !== 32) throw new Error("bad VAPID keys");
  if (!/^(mailto:|https:\/\/)/.test(keys.subject)) throw new Error("VAPID_SUBJECT must be a mailto: or https: address");
  const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: keys.privateKey, ext: false };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (o: object) => b64u(enc(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: keys.subject })}`;
  // WebCrypto's ECDSA signature is r and s, 32 bytes each: exactly JWS's ES256 form.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, buf(enc(unsigned))));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** The VAPID keys from the Worker's secrets, or null when any of the three is missing. */
export function vapidFromEnv(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }): VapidKeys | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  return publicKey && privateKey && subject ? { publicKey: publicKey.trim(), privateKey: privateKey.trim(), subject: subject.trim() } : null;
}

/**
 * A sender that holds the VAPID keys and nothing else: it posts one encrypted message to one subscription's push service
 * (only a known push service's https address), five seconds at most, and says the service's status.
 */
export function pushSender(keys: VapidKeys, fetchFn: typeof fetch = fetch): PushSend {
  return async (sub, payload) => {
    if (!pushEndpointOk(sub.endpoint)) return 0;
    try {
      const body = await encryptPush(sub, payload);
      const r = await fetchFn(sub.endpoint, {
        method: "POST",
        headers: {
          authorization: await vapidAuthorization(sub.endpoint, keys), "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
          // An hour: an approval older than that may have expired; "high" so a phone in power saving still shows it.
          ttl: "3600", urgency: "high",
        },
        body: buf(body),
        signal: AbortSignal.timeout(5000),
      });
      return r.status;
    } catch {
      return 0;
    }
  };
}
