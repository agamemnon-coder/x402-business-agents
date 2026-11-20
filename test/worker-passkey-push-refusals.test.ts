// Two of the relay Worker's own checks, refusal by refusal (worker/src/webauthn.ts, worker/src/webPush.ts):
// a passkey sign-in verified with WebCrypto names the check that failed (type, challenge, origin, a frame, the RP id,
// presence, verification, the signature, a counter that did not move) and never throws; its DER reader refuses
// anything but one SEQUENCE of two INTEGERs. The push sender reaches only a known push service over https, never with a
// port, user or overlong address; malformed subscription keys or VAPID keys are refused; a send that fails says 0.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { derToRaw, verifyAssertion } from "../worker/src/webauthn.js";
import { b64u, encryptPush, fromB64u, pushEndpointOk, pushSender, readSubscription, vapidAuthorization, vapidFromEnv } from "../worker/src/webPush.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const CHALLENGE = "Y2hhbGxlbmdlLW9mLXRoZS1zaWduLWlu";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const KEY = { x: jwk.x!, y: jwk.y! };
const B = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");

function assertion(o: { client?: Record<string, unknown>; flags?: number; counter?: number; rpId?: string; signer?: typeof privateKey; authLen?: number } = {}) {
  const ctr = Buffer.alloc(4); ctr.writeUInt32BE(o.counter ?? 5);
  let auth = Buffer.concat([createHash("sha256").update(o.rpId ?? RP).digest(), Buffer.from([o.flags ?? 0x05]), ctr]);
  if (o.authLen !== undefined) auth = auth.subarray(0, o.authLen);
  const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN, ...o.client }));
  const sig = sign("sha256", Buffer.concat([auth, createHash("sha256").update(client).digest()]), o.signer ?? privateKey);
  return { authenticatorData: B(auth), clientDataJSON: B(client), signature: B(sig) };
}
const verify = (a: ReturnType<typeof assertion>, lastCounter = 0) => verifyAssertion(a, KEY, { challenge: CHALLENGE, origin: ORIGIN, rpId: RP, lastCounter });

describe("a passkey sign-in verified in the Worker", () => {
  it("accepts a genuine assertion and returns its counter", async () => {
    expect(await verify(assertion())).toEqual({ ok: true, counter: 5 });
    // An authenticator that keeps no counter: 0 after 0 is allowed.
    expect(await verify(assertion({ counter: 0 }), 0)).toEqual({ ok: true, counter: 0 });
  });

  it("names the check that failed", async () => {
    const cases: [ReturnType<typeof assertion>, string, number?][] = [
      [assertion({ client: { type: "webauthn.create" } }), "type"],
      [assertion({ client: { challenge: "other" } }), "challenge"],
      [assertion({ client: { origin: "https://evil.example" } }), "origin"],
      [assertion({ client: { crossOrigin: true } }), "origin"],
      [assertion({ authLen: 36 }), "authenticator data"],
      [assertion({ rpId: "evil.example" }), "rp id"],
      [assertion({ flags: 0x04 }), "user presence"],
      [assertion({ flags: 0x01 }), "user verification"],
      [assertion({ signer: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey }), "signature"],
      [assertion({ counter: 5 }), "counter", 5],
      [assertion({ counter: 4 }), "counter", 5],
      [assertion({ counter: 0 }), "counter", 3],
    ];
    for (const [a, why, last] of cases) expect(await verify(a, last ?? 0), why).toEqual({ ok: false, why });
  });

  it("anything it cannot read is malformed, never an exception", async () => {
    const good = assertion();
    for (const bad of [{ ...good, authenticatorData: "not+base64" }, { ...good, clientDataJSON: B(Buffer.from("{not json")) }, { ...good, signature: B(Buffer.from([0x31, 0x00])) }]) {
      expect(await verify(bad)).toEqual({ ok: false, why: "malformed" });
    }
    expect(await verifyAssertion(good, { x: "short", y: "short" }, { challenge: CHALLENGE, origin: ORIGIN, rpId: RP, lastCounter: 0 })).toEqual({ ok: false, why: "malformed" });
  });
});

describe("the DER reader", () => {
  const der = (...parts: number[]) => Uint8Array.from(parts);
  it("takes one SEQUENCE of two INTEGERs, leading zeros dropped, padded to 32 bytes each", () => {
    const raw = derToRaw(der(0x30, 0x08, 0x02, 0x02, 0x00, 0x81, 0x02, 0x02, 0x01, 0x02));
    expect(raw.length).toBe(64);
    expect(raw[31]).toBe(0x81);
    expect([...raw.slice(62)]).toEqual([0x01, 0x02]);
    // A long-form length.
    expect(derToRaw(der(0x30, 0x81, 0x06, 0x02, 0x01, 0x07, 0x02, 0x01, 0x09))[63]).toBe(0x09);
  });
  it("refuses another tag, a short body, trailing bytes and an integer longer than 32 bytes", () => {
    expect(() => derToRaw(der(0x31, 0x00))).toThrow("bad DER");
    expect(() => derToRaw(der(0x30, 0x09, 0x02, 0x01))).toThrow("short DER");
    expect(() => derToRaw(der(0x30, 0x06, 0x02, 0x01, 0x07, 0x02, 0x01, 0x09, 0x00))).toThrow("trailing bytes");
    expect(() => derToRaw(der(0x30, 0x07, 0x02, 0x01, 0x07, 0x02, 0x01, 0x09, 0x05))).toThrow("trailing bytes");
    expect(() => derToRaw(Uint8Array.from([0x30, 0x25, 0x02, 0x21, 0x01, ...new Array(32).fill(1), 0x02, 0x00]))).toThrow("integer too long");
  });
});

describe("web push to the CFO's phone", () => {
  const ua = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const uaJwk = ua.publicKey.export({ format: "jwk" });
  const p256dh = B(Buffer.concat([Buffer.from([4]), Buffer.from(uaJwk.x!, "base64url"), Buffer.from(uaJwk.y!, "base64url")]));
  const auth = B(Buffer.alloc(16, 7));
  const vp = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const vj = vp.privateKey.export({ format: "jwk" });
  const vapid = { publicKey: B(Buffer.concat([Buffer.from([4]), Buffer.from(vj.x!, "base64url"), Buffer.from(vj.y!, "base64url")])), privateKey: vj.d!, subject: "mailto:cfo@example.com" };
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

  it("reaches only a push service's own https address", () => {
    for (const ok of [endpoint, "https://web.push.apple.com/x", "https://db5p.notify.windows.com/w/?token=1", "https://api.push.apple.com:443/x"]) expect(pushEndpointOk(ok), ok).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://user:pw@fcm.googleapis.com/x", "https://evil.example/x", "https://.push.apple.com/x", "https://push.apple.com.evil.example/x", "not a url", `https://fcm.googleapis.com/${"a".repeat(1100)}`, 42 as unknown as string]) {
      expect(pushEndpointOk(bad), String(bad).slice(0, 60)).toBe(false);
    }
  });

  it("takes a subscription only with a P-256 key and a 16-byte secret", () => {
    expect(readSubscription({ endpoint, keys: { p256dh, auth } })).toEqual({ endpoint, p256dh, auth });
    for (const bad of [null, "x", { endpoint }, { endpoint: "https://evil.example/x", keys: { p256dh, auth } }, { endpoint, keys: null }, { endpoint, keys: { p256dh: auth, auth } }, { endpoint, keys: { p256dh, auth: p256dh } }, { endpoint, keys: { p256dh: "not base64!", auth } }, { endpoint, keys: { p256dh, auth: 16 } }]) {
      expect(readSubscription(bad)).toBeNull();
    }
    expect(fromB64u("a+b")).toBeNull();
    expect(fromB64u("A")).toBeNull();
    expect(b64u(fromB64u("AQID")!)).toBe("AQID");
  });

  it("refuses to encrypt for keys that are not a subscription's, or to sign with VAPID keys that are not a pair", async () => {
    await expect(encryptPush({ p256dh: auth, auth }, "x")).rejects.toThrow("bad subscription keys");
    await expect(vapidAuthorization(endpoint, { ...vapid, privateKey: "short" })).rejects.toThrow("bad VAPID keys");
    await expect(vapidAuthorization(endpoint, { ...vapid, publicKey: auth })).rejects.toThrow("bad VAPID keys");
    await expect(vapidAuthorization(endpoint, { ...vapid, subject: "cfo@example.com" })).rejects.toThrow("VAPID_SUBJECT must be a mailto: or https: address");
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: " a ", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "mailto:x@y.z " })).toEqual({ publicKey: "a", privateKey: "b", subject: "mailto:x@y.z" });
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })).toBeNull();
  });

  it("a send to an address that is not a push service, or that fails, says 0 and reaches nothing", async () => {
    const asked: string[] = [];
    const send = pushSender(vapid, (async (url: string) => { asked.push(url); throw new Error("down"); }) as unknown as typeof fetch);
    expect(await send({ endpoint: "https://evil.example/x", p256dh, auth }, "Payment needs your signature")).toBe(0);
    expect(asked).toEqual([]);
    expect(await send({ endpoint, p256dh, auth }, "Payment needs your signature")).toBe(0);
    expect(asked).toEqual([endpoint]);
    // Keys that cannot be encrypted for: 0, nothing sent.
    expect(await send({ endpoint, p256dh: auth, auth }, "x")).toBe(0);
    expect(asked).toHaveLength(1);
  });
});
