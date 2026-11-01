// D20: the Worker verifies a passkey sign-in itself (WebAuthn assertion, ES256) against an enrolled credential's
// public key. Real signatures from a software passkey (test only). Breaks if any check is dropped: challenge, origin,
// RP id, user presence and verification, the signature, or a counter that did not move forward.
import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { softPasskey } from "../src/metal/softPasskey.js";
import { verifyAssertion, type PublicKeyXY } from "../worker/src/webauthn.js";

const RP = "relay.example";
const ORIGIN = "https://relay.example";
const CHALLENGE = "c2Vzc2lvbi1jaGFsbGVuZ2UtMTIzNDU2Nzg5MA";
const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

function setup() {
  const pk = softPasskey();
  const key: PublicKeyXY = { x: Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url") };
  const sign = (o: { challenge?: string; origin?: string; rpId?: string; uv?: boolean } = {}) => {
    const a = pk.assert("0x00", { challenge: o.challenge ?? CHALLENGE, origin: o.origin ?? ORIGIN, rpId: o.rpId ?? RP, uv: o.uv });
    return { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) };
  };
  return { key, sign };
}
const expect_ = { challenge: CHALLENGE, origin: ORIGIN, rpId: RP };

describe("the Worker's passkey check", () => {
  it("accepts a real assertion and returns its counter", async () => {
    const { key, sign } = setup();
    expect(await verifyAssertion(sign(), key, { ...expect_, lastCounter: 0 })).toEqual({ ok: true, counter: 1 });
  });

  it("refuses another challenge, another origin, another RP id", async () => {
    const { key, sign } = setup();
    expect(await verifyAssertion(sign({ challenge: "b3RoZXI" }), key, { ...expect_, lastCounter: 0 })).toMatchObject({ ok: false, why: "challenge" });
    expect(await verifyAssertion(sign({ origin: "https://evil.example" }), key, { ...expect_, lastCounter: 0 })).toMatchObject({ ok: false, why: "origin" });
    expect(await verifyAssertion(sign({ rpId: "evil.example" }), key, { ...expect_, lastCounter: 0 })).toMatchObject({ ok: false, why: "rp id" });
  });

  it("refuses an assertion without user verification", async () => {
    const { key, sign } = setup();
    expect(await verifyAssertion(sign({ uv: false }), key, { ...expect_, lastCounter: 0 })).toMatchObject({ ok: false, why: "user verification" });
  });

  it("refuses another passkey's signature and a tampered one", async () => {
    const a = setup(), b = setup();
    expect(await verifyAssertion(b.sign(), a.key, { ...expect_, lastCounter: 0 })).toMatchObject({ ok: false, why: "signature" });
    const s = a.sign();
    const bad = Buffer.from(s.authenticatorData, "base64url"); bad[36] ^= 1;
    expect(await verifyAssertion({ ...s, authenticatorData: bad.toString("base64url") }, a.key, { ...expect_, lastCounter: 0 })).toMatchObject({ ok: false });
  });

  it("refuses a replay: the counter must move forward", async () => {
    const { key, sign } = setup();
    const first = sign();
    expect(await verifyAssertion(first, key, { ...expect_, lastCounter: 0 })).toMatchObject({ ok: true, counter: 1 });
    expect(await verifyAssertion(first, key, { ...expect_, lastCounter: 1 })).toMatchObject({ ok: false, why: "counter" });
  });

  it("accepts an authenticator that keeps no counter (0 and 0, as iCloud passkeys do); the one-time challenge stops replays", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = privateKey.export({ format: "jwk" }) as { x: string; y: string };
    const authData = Buffer.concat([createHash("sha256").update(RP).digest(), Buffer.from([0x05, 0, 0, 0, 0])]);
    const cd = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN }));
    const sig = nodeSign("sha256", Buffer.concat([authData, createHash("sha256").update(cd).digest()]), privateKey);
    const a = { authenticatorData: b64u(authData), clientDataJSON: b64u(cd), signature: b64u(sig) };
    expect(await verifyAssertion(a, { x: jwk.x, y: jwk.y }, { ...expect_, lastCounter: 0 })).toEqual({ ok: true, counter: 0 });
    // Once a counter was seen, 0 is a step back.
    expect(await verifyAssertion(a, { x: jwk.x, y: jwk.y }, { ...expect_, lastCounter: 3 })).toMatchObject({ ok: false, why: "counter" });
  });

  it("refuses garbage without throwing", async () => {
    const { key } = setup();
    expect(await verifyAssertion({ authenticatorData: "x", clientDataJSON: "y", signature: "z" }, key, { ...expect_, lastCounter: 0 })).toMatchObject({ ok: false });
  });
});
