// The execution guard's synchronous re-check of a stored passkey signature (src/passkey/storedSignature.ts), refusal by
// refusal, each with its own reason: a stored row that is not a passkey assertion, names another credential or is not
// whole; client data that is not an assertion's, sits in a frame, or carries a malformed token binding; authenticator
// data with bytes it does not account for, without user presence, or with impossible backup flags; an enrolled key that
// is neither ES256 nor RS256. The re-check never throws: whatever it cannot read is a refusal with a short reason.
// test/stored-signature.test.ts holds it to the product's verifier on genuine and forged signatures.
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { assertionSha256, challengeFor, verifyStoredSignature, type PinnedKey } from "../src/passkey/storedSignature.js";
import { sha256Hex } from "../src/lib/terms.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const HASH = sha256Hex("the exact terms");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const ID = b64(Buffer.from("es256-credential-01"));

/** An ES256 passkey of the test's own, so each field of an assertion can be set and still be signed. */
function es256() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
  return { privateKey, key: { credential_id: ID, public_key: b64(cose), rp_id: RP, origin: ORIGIN } satisfies PinnedKey };
}
const phone = es256();

function assertion(o: { client?: Record<string, unknown>; flags?: number; extra?: Uint8Array; rpId?: string; signer?: KeyObject } = {}): AuthenticationResponseJSON {
  const authData = Buffer.concat([createHash("sha256").update(o.rpId ?? RP).digest(), Buffer.from([o.flags ?? 0x05]), Buffer.from([0, 0, 0, 9]), o.extra ?? Buffer.alloc(0)]);
  const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challengeFor(HASH), origin: ORIGIN, crossOrigin: false, ...o.client }));
  const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(client).digest()]), o.signer ?? phone.privateKey);
  return { id: ID, rawId: ID, type: "public-key", response: { clientDataJSON: b64(client), authenticatorData: b64(authData), signature: b64(signature) }, clientExtensionResults: {} };
}
const check = (r: unknown, key: PinnedKey = phone.key, hash = HASH) => verifyStoredSignature(r as AuthenticationResponseJSON, hash, key);
const refused = (reason: string) => ({ ok: false, reason });

describe("a stored signature the re-check accepts", () => {
  it("a genuine ES256 assertion over the exact terms, also with a token binding of a known status", () => {
    expect(check(assertion())).toEqual({ ok: true });
    for (const status of ["present", "supported", "notSupported"]) expect(check(assertion({ client: { tokenBinding: { status } } }))).toEqual({ ok: true });
    // Backed up and eligible for backup: a synced passkey, allowed.
    expect(check(assertion({ flags: 0x05 | 0x08 | 0x10 }))).toEqual({ ok: true });
  });
});

describe("a stored row that is not a whole passkey assertion of the pinned credential", () => {
  it("is refused with what is wrong with it", () => {
    const good = assertion();
    expect(check(null)).toEqual(refused("the stored signature cannot be read"));
    expect(check("a string")).toEqual(refused("the stored signature cannot be read"));
    expect(check({ ...good, type: "password" })).toEqual(refused("the stored signature is not a passkey's"));
    expect(check({ ...good, id: "" })).toEqual(refused("the stored signature's credential id is malformed"));
    expect(check({ ...good, rawId: "another" })).toEqual(refused("the stored signature's credential id is malformed"));
    expect(check({ ...good, response: undefined })).toEqual(refused("the stored signature is incomplete"));
    expect(check({ ...good, response: { ...good.response, signature: 42 } })).toEqual(refused("the stored signature is incomplete"));
    expect(check({ ...good, response: { ...good.response, signature: "not+base64/url=" } })).toEqual(refused("the stored signature is not base64url"));
  });

  it("client data that is not JSON is a refusal with the parser's reason, never an exception", () => {
    const good = assertion();
    const r = check({ ...good, response: { ...good.response, clientDataJSON: b64(Buffer.from("{not json")) } });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason.length).toBeLessThanOrEqual(240);
  });

  it("a terms hash that is not one is refused, not thrown", () => {
    expect(check(assertion(), phone.key, "ABC")).toEqual(refused("a terms hash is 64 lowercase hex characters"));
    expect(() => challengeFor("ABC")).toThrow("a terms hash is 64 lowercase hex characters");
  });
});

describe("client data an approval cannot rest on", () => {
  it("a top origin outside a frame, or a token binding that is malformed", () => {
    expect(check(assertion({ client: { topOrigin: "https://evil.example" } }))).toEqual(refused("the stored signature names a top origin outside a frame"));
    expect(check(assertion({ client: { tokenBinding: "present" } }))).toEqual(refused("the stored signature's token binding is malformed"));
    expect(check(assertion({ client: { tokenBinding: null } }))).toEqual(refused("the stored signature's token binding is malformed"));
    expect(check(assertion({ client: { tokenBinding: { status: "odd" } } }))).toEqual(refused("the stored signature's token binding is malformed"));
  });

  it("names the site it was signed on when that is not the enrolled origin", () => {
    expect(check(assertion({ client: { origin: "https://purser.example:8443" } }))).toEqual(refused("the passkey signed on https://purser.example:8443, not https://purser.example"));
  });
});

describe("authenticator data an approval cannot rest on", () => {
  it("bytes it does not account for, without the flags that would explain them", () => {
    expect(check(assertion({ extra: Buffer.from([0xa0]) }))).toEqual(refused("the stored authenticator data has bytes it does not account for"));
  });

  it("no user present, no user verified, or backed up without being eligible", () => {
    expect(check(assertion({ flags: 0x04 }))).toEqual(refused("User not present during authentication"));
    expect(check(assertion({ flags: 0x01 }))).toEqual(refused("User verification required, but user could not be verified"));
    expect(check(assertion({ flags: 0x05 | 0x10 }))).toEqual(refused("the stored authenticator data has impossible backup flags"));
  });

  it("signed for another RP id", () => {
    expect(check(assertion({ rpId: "purser.example.evil" }))).toEqual(refused("the passkey signed for another RP id than purser.example"));
  });

  it("signed by another key: the signature does not verify", () => {
    expect(check(assertion({ signer: es256().privateKey }))).toEqual(refused("the signature does not verify"));
  });
});

describe("an enrolled key the re-check does not take", () => {
  it("anything but ES256 on P-256 or RS256 is a refusal naming its type and algorithm", () => {
    const coseOf = (m: [number, number | Uint8Array][]) => b64(isoCBOR.encode(new Map<number, number | Uint8Array>(m)));
    const ed25519 = coseOf([[1, 1], [3, -8], [-1, 6], [-2, new Uint8Array(32)]]);
    expect(check(assertion(), { ...phone.key, public_key: ed25519 })).toEqual(refused("the enrolled key is not ES256 or RS256 (kty 1, alg -8)"));
    // ES256's algorithm on another curve (P-384) is not ES256.
    const p384 = coseOf([[1, 2], [3, -7], [-1, 2], [-2, new Uint8Array(48)], [-3, new Uint8Array(48)]]);
    expect(check(assertion(), { ...phone.key, public_key: p384 })).toEqual(refused("the enrolled key is not ES256 or RS256 (kty 2, alg -7)"));
  });
});

describe("a signature's identity", () => {
  it("is the SHA-256 of what was signed and the signature, so one signature is counted once", () => {
    const a = assertion();
    const b = assertion();
    expect(assertionSha256(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(assertionSha256(a)).toBe(assertionSha256({ ...a, clientExtensionResults: { credProps: { rk: true } } }));
    // ECDSA signs with a fresh nonce: the same terms signed twice are two signatures.
    expect(assertionSha256(a)).not.toBe(assertionSha256(b));
  });
});
