// The execution guard re-verifies stored passkey signatures synchronously (src/passkey/storedSignature.ts), because it
// is one synchronous transaction and @simplewebauthn/server only answers asynchronously. This holds the two to the same
// answer: every assertion the product's verifier (verifyApprovalSignature at counter 0, as `npm run verify` uses it)
// accepts, the re-check accepts, and every one it refuses, the re-check refuses. Breaks if the re-check ever accepts a
// signature over other terms, from another site or RP id, without user presence or verification, by another key, or
// with a changed signature; or if it refuses a genuine ES256 or RS256 signature.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { PasskeyRow } from "../src/passkey/ledger.js";
import { verifyStoredSignature } from "../src/passkey/storedSignature.js";
import { challengeFor, verifyApprovalSignature } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { sha256Hex } from "../src/lib/terms.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const HASH = sha256Hex("the exact terms");
const OTHER = sha256Hex("other terms");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");

/** The pinned row of a FakeAuthenticator, as enrolment stores it (its COSE key from its registration). */
function pinned(phone: FakeAuthenticator): PasskeyRow {
  const reg = phone.register({ challenge: "x", origin: ORIGIN, rpId: RP });
  const att = isoCBOR.decodeFirst<Map<string, Uint8Array>>(new Uint8Array(Buffer.from(reg.response.attestationObject, "base64url")));
  const auth = Buffer.from(att.get("authData")!);
  const idLen = auth.readUInt16BE(53);
  const cose = auth.subarray(55 + idLen);
  return { credential_id: phone.credentialId, public_key: b64(cose), counter: 0, transports: null, rp_id: RP, origin: ORIGIN, label: "max", aaguid: null, registration_json: "{}", enrolled_at: "2026-11-20T10:00:00Z", status: "ACTIVE" };
}

/** An RS256 authenticator (some Windows Hello keys): the other algorithm enrolment accepts. */
function rsaPhone() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 3], [3, -257], [-1, Buffer.from(jwk.n!, "base64url")], [-2, Buffer.from(jwk.e!, "base64url")]]));
  const id = b64(Buffer.from("rsa-credential-01"));
  const row: PasskeyRow = { credential_id: id, public_key: b64(cose), counter: 0, transports: null, rp_id: RP, origin: ORIGIN, label: "max", aaguid: null, registration_json: "{}", enrolled_at: "2026-11-20T10:00:00Z", status: "ACTIVE" };
  const signFor = (hash: string): AuthenticationResponseJSON => {
    const authData = Buffer.concat([createHash("sha256").update(RP).digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);
    const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challengeFor(hash), origin: ORIGIN, crossOrigin: false }));
    const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(client).digest()]), privateKey);
    return { id, rawId: id, type: "public-key", response: { clientDataJSON: b64(client), authenticatorData: b64(authData), signature: b64(signature) }, clientExtensionResults: {} };
  };
  return { row, signFor };
}

/** The same assertion with its client data rewritten (the signature then no longer covers it). */
function rewriteClient(r: AuthenticationResponseJSON, f: (c: Record<string, unknown>) => Record<string, unknown>): AuthenticationResponseJSON {
  const c = JSON.parse(Buffer.from(r.response.clientDataJSON, "base64url").toString("utf8")) as Record<string, unknown>;
  return { ...r, response: { ...r.response, clientDataJSON: b64(Buffer.from(JSON.stringify(f(c)))) } };
}

describe("the synchronous re-check agrees with the product's verifier", () => {
  const max = new FakeAuthenticator();
  const mallory = new FakeAuthenticator();
  const pk = pinned(max);
  const good = max.sign({ challenge: challengeFor(HASH), origin: ORIGIN, rpId: RP, counter: 7 });
  const flip = (s: string) => `${s.slice(0, 10)}${s[10] === "A" ? "B" : "A"}${s.slice(11)}`;
  const rsa = rsaPhone();
  const cases: [string, AuthenticationResponseJSON, string, PasskeyRow, boolean][] = [
    ["a genuine signature over the exact terms", good, HASH, pk, true],
    ["a genuine signature with counter 0", max.sign({ challenge: challengeFor(HASH), origin: ORIGIN, rpId: RP, counter: 0 }), HASH, pk, true],
    ["a genuine RS256 signature", rsa.signFor(HASH), HASH, rsa.row, true],
    ["the same signature checked against other terms", good, OTHER, pk, false],
    ["an RS256 signature over other terms", rsa.signFor(OTHER), HASH, rsa.row, false],
    ["signed on another site", max.sign({ challenge: challengeFor(HASH), origin: "https://purser.example.evil", rpId: RP }), HASH, pk, false],
    ["signed for another RP id", max.sign({ challenge: challengeFor(HASH), origin: ORIGIN, rpId: "evil.example" }), HASH, pk, false],
    ["without user verification", max.sign({ challenge: challengeFor(HASH), origin: ORIGIN, rpId: RP, userVerified: false }), HASH, pk, false],
    ["signed by another key under the CFO's credential id", { ...mallory.sign({ challenge: challengeFor(HASH), origin: ORIGIN, rpId: RP }), id: max.credentialId, rawId: max.credentialId }, HASH, pk, false],
    ["with a changed signature", { ...good, response: { ...good.response, signature: flip(good.response.signature) } }, HASH, pk, false],
    ["inside a frame on another site", rewriteClient(good, (c) => ({ ...c, crossOrigin: true })), HASH, pk, false],
    ["a registration's client data", rewriteClient(good, (c) => ({ ...c, type: "webauthn.create" })), HASH, pk, false],
    ["with a token binding of no known status", rewriteClient(good, (c) => ({ ...c, tokenBinding: { status: "odd" } })), HASH, pk, false],
    ["with the authenticator data cut short", { ...good, response: { ...good.response, authenticatorData: b64(Buffer.from(good.response.authenticatorData, "base64url").subarray(0, 30)) } }, HASH, pk, false],
  ];
  for (const [what, response, hash, key, expected] of cases) {
    it(`${expected ? "accepts" : "refuses"} ${what}, as verifyApprovalSignature does`, async () => {
      const product = await verifyApprovalSignature(response, hash, key, 0);
      const recheck = verifyStoredSignature(response, hash, key);
      expect(product.ok, `product: ${product.ok ? "ok" : product.reason}`).toBe(expected);
      expect(recheck.ok, `re-check: ${recheck.ok ? "ok" : recheck.reason}`).toBe(expected);
    });
  }

  it("refuses a signature that names another credential than the one pinned", () => {
    expect(verifyStoredSignature(mallory.sign({ challenge: challengeFor(HASH), origin: ORIGIN, rpId: RP }), HASH, pk)).toEqual({ ok: false, reason: "the stored signature names another passkey" });
  });
});
