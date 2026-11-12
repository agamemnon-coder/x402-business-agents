// The demo world's CFO passkeys: a software test passkey per test company (src/redteam/authenticator.ts, the same
// stand-in for a phone the tests use), with a key that comes from the company's public label and signatures that
// repeat, so two builds of the world give the same approvals. Every signature is a real ES256 signature: the engine
// verifies each one against the enrolled public key exactly as it verifies a phone's.
//
// A TEST key, on purpose not a secret: anyone can derive it from the label below. It signs nothing outside the seeded
// test world, and no deployment accepts it (the demo has no sign-in and its companies hold no credential).

import { createHash, createHmac, createPrivateKey } from "node:crypto";
import { FakeAuthenticator } from "../redteam/authenticator.js";

export const TEST_PASSKEY_LABEL = "test passkey (a software authenticator standing in for the CFO's phone; not Face ID)";

// NIST P-256, in plain BigInt arithmetic: a few signatures per build, so speed does not matter.
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const A = P - 3n;
type Point = { x: bigint; y: bigint } | null;
const G: Point = { x: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n, y: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n };

const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;
function inverse(a: bigint, m: bigint): bigint {
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return mod(s0, m);
}
function add(p: Point, q: Point): Point {
  if (!p) return q;
  if (!q) return p;
  if (p.x === q.x && mod(p.y + q.y, P) === 0n) return null;
  const l = p.x === q.x ? mod((3n * p.x * p.x + A) * inverse(2n * p.y, P), P) : mod((q.y - p.y) * inverse(q.x - p.x, P), P);
  const x = mod(l * l - p.x - q.x, P);
  return { x, y: mod(l * (p.x - x) - p.y, P) };
}
function times(k: bigint, p: Point): Point {
  let out: Point = null;
  for (let add_ = p; k > 0n; k >>= 1n, add_ = add(add_, add_)) if (k & 1n) out = add(out, add_);
  return out;
}
const big = (b: Uint8Array) => BigInt(`0x${Buffer.from(b).toString("hex") || "0"}`);
const be32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");
/** A DER integer: minimal, with a leading zero when the top bit is set. */
const derInt = (n: bigint) => { let b = be32(n); while (b.length > 1 && b[0] === 0 && !(b[1]! & 0x80)) b = b.subarray(1); if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return Buffer.concat([Buffer.from([0x02, b.length]), b]); };

/**
 * ES256 over `data` with the private scalar `d`, the nonce taken from an HMAC of the key and the message (so the same
 * message always gives the same signature, and no two messages share a nonce). Returns the DER signature.
 */
export function signP256(d: bigint, data: Uint8Array): Buffer {
  const z = big(createHash("sha256").update(data).digest());
  for (let i = 0; ; i++) {
    const k = mod(big(createHmac("sha256", be32(d)).update(be32(z)).update(String(i)).digest()), N - 1n) + 1n;
    const r = mod(times(k, G)!.x, N);
    const s0 = mod(inverse(k, N) * (z + r * d), N);
    if (r === 0n || s0 === 0n) continue;
    const s = s0 > N / 2n ? N - s0 : s0;
    const body = Buffer.concat([derInt(r), derInt(s)]);
    return Buffer.concat([Buffer.from([0x30, body.length]), body]);
  }
}

/** The test passkey of one test company: the same key, credential id and signatures on every build. */
export function testPasskey(label: string): FakeAuthenticator {
  const seed = createHash("sha256").update(`purser demo world test passkey: ${label}`).digest();
  const d = mod(big(seed), N - 1n) + 1n;
  const q = times(d, G)!;
  const b64 = (n: bigint) => be32(n).toString("base64url");
  const privateKey = createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: b64(d), x: b64(q.x), y: b64(q.y) } });
  const credentialId = createHash("sha256").update(`purser demo world credential: ${label}`).digest().subarray(0, 16).toString("base64url");
  return new FakeAuthenticator({ privateKey, credentialId, sign: (data) => signP256(d, data) });
}
