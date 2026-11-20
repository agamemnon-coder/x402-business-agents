// A stored passkey signature, checked again where code cannot wait (security review, 20 November, finding 1). The
// execution guard (src/policy/approvals.ts beginExecution) is one synchronous transaction under the write lock, and
// about twenty executors and checks call it synchronously; @simplewebauthn/server verifies with WebCrypto, which only
// answers asynchronously. So the guard re-verifies here, with node:crypto (as the receipt check in src/try/receipt.ts
// does), making the checks verifyApprovalSignature (src/passkey/webauthn.ts) makes at counter 0, as `npm run verify`
// does: a passkey assertion (webauthn.get), the challenge equal to the signed hash, the enrolled origin and not inside a
// frame, the enrolled RP id, user present and user verified, and the signature over the authenticator data and the
// client data's SHA-256 with the enrolled public key (ES256 or RS256, the two keys enrolment accepts).
// test/stored-signature.test.ts holds the two verifiers to the same answer on the same inputs.
// Nothing runs at import: no key is parsed until a signature is checked.

import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const HEX64 = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]*$/;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

/** base64url of the hash's 32 raw bytes: what the page passes as the challenge, and what the passkey signs. */
export function challengeFor(termsSha256: string): string {
  if (!HEX64.test(termsSha256)) throw new Error("a terms hash is 64 lowercase hex characters");
  return Buffer.from(termsSha256, "hex").toString("base64url");
}

/** One signature's identity: what the authenticator signed and the signature itself. */
export function assertionSha256(r: AuthenticationResponseJSON): string {
  return createHash("sha256").update(`${r.response.clientDataJSON}.${r.response.authenticatorData}.${r.response.signature}`).digest("hex");
}

/** What a stored signature is checked against: the credential as enrolment pinned it. */
export interface PinnedKey { credential_id: string; public_key: string; rp_id: string; origin: string }

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

/** The enrolled COSE key as a node:crypto key, with its algorithm: ES256 (P-256) or RS256, nothing else. */
function keyOf(cosePublicKey: string): KeyObject {
  const cose = isoCBOR.decodeFirst<Map<number, number | Uint8Array>>(new Uint8Array(Buffer.from(cosePublicKey, "base64url")));
  const b64 = (v: unknown) => Buffer.from(v as Uint8Array).toString("base64url");
  const [kty, alg] = [cose.get(1), cose.get(3)];
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64(cose.get(-2)), y: b64(cose.get(-3)) }, format: "jwk" });
  if (kty === 3 && alg === -257) return createPublicKey({ key: { kty: "RSA", n: b64(cose.get(-1)), e: b64(cose.get(-2)) }, format: "jwk" });
  throw new Error(`the enrolled key is not ES256 or RS256 (kty ${String(kty)}, alg ${String(alg)})`);
}

/**
 * Whether `response`, a passkey assertion as stored, is a signature over `signedSha256` by the pinned key: the checks
 * verifyApprovalSignature makes at counter 0, synchronously. Never throws.
 */
export function verifyStoredSignature(response: AuthenticationResponseJSON, signedSha256: string, key: PinnedKey): { ok: true } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  try {
    if (!response || typeof response !== "object") return no("the stored signature cannot be read");
    if (response.type !== "public-key") return no("the stored signature is not a passkey's");
    if (!response.id || response.id !== response.rawId) return no("the stored signature's credential id is malformed");
    if (response.id !== key.credential_id) return no("the stored signature names another passkey");
    const r = response.response;
    if (!r || typeof r.clientDataJSON !== "string" || typeof r.authenticatorData !== "string" || typeof r.signature !== "string") return no("the stored signature is incomplete");
    if (![r.clientDataJSON, r.authenticatorData, r.signature].every((s) => B64URL.test(s))) return no("the stored signature is not base64url");
    const clientBytes = Buffer.from(r.clientDataJSON, "base64url");
    const client = JSON.parse(clientBytes.toString("utf8")) as { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown; topOrigin?: unknown; tokenBinding?: unknown };
    if (client.type !== "webauthn.get") return no(`the stored signature is not a passkey assertion (${String(client.type)})`);
    if (client.challenge !== challengeFor(signedSha256)) return no("the passkey signed other terms");
    if (client.crossOrigin === true) return no("the passkey was used inside a frame on another site (cross-origin)");
    if (client.topOrigin) return no("the stored signature names a top origin outside a frame");
    if (client.origin !== key.origin) return no(`the passkey signed on ${String(client.origin)}, not ${key.origin}`);
    if (client.tokenBinding !== undefined) {
      const status = (client.tokenBinding as { status?: unknown } | null)?.status;
      if (typeof client.tokenBinding !== "object" || !["present", "supported", "notSupported"].includes(String(status))) return no("the stored signature's token binding is malformed");
    }
    const auth = Buffer.from(r.authenticatorData, "base64url");
    if (auth.length < 37) return no("the stored authenticator data is too short");
    const flags = auth[32]!;
    if (!(flags & (FLAG_AT | FLAG_ED)) && auth.length !== 37) return no("the stored authenticator data has bytes it does not account for");
    if (!sha256(key.rp_id).equals(auth.subarray(0, 32))) return no(`the passkey signed for another RP id than ${key.rp_id}`);
    if (!(flags & FLAG_UP)) return no("User not present during authentication");
    if (!(flags & FLAG_UV)) return no("User verification required, but user could not be verified");
    if ((flags & FLAG_BS) && !(flags & FLAG_BE)) return no("the stored authenticator data has impossible backup flags");
    const ok = verify("sha256", Buffer.concat([auth, sha256(clientBytes)]), keyOf(key.public_key), Buffer.from(r.signature, "base64url"));
    return ok ? { ok: true } : no("the signature does not verify");
  } catch (e) {
    return no(((e instanceof Error ? e.message : String(e)) || "the stored signature cannot be checked").slice(0, 240));
  }
}
