// /try/sign's own check of a new passkey (worker/src/trySign.ts verifyRegistration) and the CBOR reader under it
// (readCbor): a registration is accepted only as a webauthn.create for this world's challenge, from this origin, for this
// relying party, with the user present and verified, carrying the credential it names and an ES256 key on P-256; each
// other registration is refused with its own reason, and bytes that are not a well-formed attestation are "malformed",
// never an exception. The CBOR reader reads every length form and refuses what it does not support.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { describe, expect, it } from "vitest";
import { readCbor, verifyRegistration } from "../worker/src/trySign.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const CHALLENGE = Buffer.from("one-time challenge").toString("base64url");
const EXP = { challenge: CHALLENGE, origin: ORIGIN, rpId: RP };
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha = (s: string) => createHash("sha256").update(s).digest();

const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const X = Buffer.from(jwk.x!, "base64url"), Y = Buffer.from(jwk.y!, "base64url");
const ES256 = () => new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, X], [-3, Y]]);

interface Parts {
  client?: Record<string, unknown>;
  rpId?: string;
  flags?: number;
  counter?: number;
  credId?: Uint8Array;
  claimedId?: string;
  cose?: unknown;
  authData?: Uint8Array;
  attestation?: unknown;
}
/** A registration as a phone sends it, every part settable wrong on purpose. */
function registration(p: Parts = {}) {
  const credId = p.credId ?? randomBytes(16);
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credId.length);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(p.counter ?? 7);
  const authData = p.authData ?? Buffer.concat([sha(p.rpId ?? RP), Buffer.from([p.flags ?? 0x45]), counter, Buffer.alloc(16), idLen, credId, Buffer.from(isoCBOR.encode((p.cose ?? ES256()) as never))]);
  const attestation = p.attestation ?? new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]);
  const client = p.client ?? { type: "webauthn.create", challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false };
  return { id: p.claimedId ?? b64u(credId), response: { clientDataJSON: b64u(Buffer.from(JSON.stringify(client))), attestationObject: b64u(isoCBOR.encode(attestation as never)) } };
}

describe("a new passkey for a test world", () => {
  it("is accepted with its key and counter when every part is right", async () => {
    expect(await verifyRegistration(registration(), EXP)).toEqual({ ok: true, key: { x: jwk.x, y: jwk.y }, counter: 7 });
  });

  it("is refused for the wrong ceremony, challenge or origin, and when made in a cross-origin frame", async () => {
    const client = (over: object) => registration({ client: { type: "webauthn.create", challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false, ...over } });
    expect(await verifyRegistration(client({ type: "webauthn.get" }), EXP)).toEqual({ ok: false, why: "type" });
    expect(await verifyRegistration(client({ challenge: "b2xk" }), EXP)).toEqual({ ok: false, why: "challenge" });
    expect(await verifyRegistration(client({ origin: "https://evil.example" }), EXP)).toEqual({ ok: false, why: "origin" });
    expect(await verifyRegistration(client({ crossOrigin: true }), EXP)).toEqual({ ok: false, why: "origin" });
  });

  it("is refused for another relying party, without the user present or verified, or without a credential", async () => {
    expect(await verifyRegistration(registration({ rpId: "evil.example" }), EXP)).toEqual({ ok: false, why: "rp id" });
    expect(await verifyRegistration(registration({ flags: 0x44 }), EXP)).toEqual({ ok: false, why: "user presence" });
    expect(await verifyRegistration(registration({ flags: 0x41 }), EXP)).toEqual({ ok: false, why: "user verification" });
    expect(await verifyRegistration(registration({ flags: 0x05 }), EXP)).toEqual({ ok: false, why: "no credential in the authenticator data" });
  });

  it("is refused when the authenticator data is missing or too short to hold a credential", async () => {
    expect(await verifyRegistration(registration({ attestation: new Map([["fmt", "none"]]) }), EXP)).toEqual({ ok: false, why: "authenticator data" });
    expect(await verifyRegistration(registration({ attestation: ["not", "a", "map"] }), EXP)).toEqual({ ok: false, why: "authenticator data" });
    expect(await verifyRegistration(registration({ authData: new Uint8Array(54) }), EXP)).toEqual({ ok: false, why: "authenticator data" });
  });

  it("is refused when it names another credential than the one inside, or an empty one", async () => {
    expect(await verifyRegistration(registration({ claimedId: b64u(randomBytes(16)) }), EXP)).toEqual({ ok: false, why: "credential id" });
    expect(await verifyRegistration(registration({ credId: new Uint8Array(0), claimedId: "" }), EXP)).toEqual({ ok: false, why: "credential id" });
  });

  it("is refused unless its key is ES256 on P-256 with 32-byte coordinates", async () => {
    const withKey = (edit: (m: Map<number, unknown>) => void) => { const m = ES256() as Map<number, unknown>; edit(m); return registration({ cose: m }); };
    const NOT = { ok: false, why: "this passkey is not ES256 (P-256)" };
    expect(await verifyRegistration(withKey((m) => m.set(1, 3)), EXP)).toEqual(NOT); // RSA
    expect(await verifyRegistration(withKey((m) => m.set(3, -8)), EXP)).toEqual(NOT); // EdDSA
    expect(await verifyRegistration(withKey((m) => m.set(-1, 2)), EXP)).toEqual(NOT); // P-384
    expect(await verifyRegistration(withKey((m) => m.set(-2, X.subarray(1))), EXP)).toEqual(NOT);
    expect(await verifyRegistration(withKey((m) => m.set(-3, "y")), EXP)).toEqual(NOT);
    expect(await verifyRegistration(registration({ cose: [1, 2] }), EXP)).toEqual({ ok: false, why: "public key" });
  });

  it("is malformed, not an exception, for a point off the curve, bytes that are not base64url, or not JSON", async () => {
    const off = Buffer.from(X);
    off[31] = off[31]! ^ 1;
    expect(await verifyRegistration(registration({ cose: new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, off], [-3, Y]]) }), EXP)).toEqual({ ok: false, why: "malformed" });
    const r = registration();
    expect(await verifyRegistration({ ...r, response: { ...r.response, clientDataJSON: "not base64url!" } }, EXP)).toEqual({ ok: false, why: "malformed" });
    expect(await verifyRegistration({ ...r, response: { ...r.response, clientDataJSON: b64u(Buffer.from("{not json")) } }, EXP)).toEqual({ ok: false, why: "malformed" });
    expect(await verifyRegistration({ ...r, response: { ...r.response, attestationObject: b64u(Buffer.from([0x5f])) } }, EXP)).toEqual({ ok: false, why: "malformed" });
  });
});

describe("the CBOR reader", () => {
  it("reads one-, two- and four-byte lengths, negative numbers, and true, false and null", () => {
    expect(readCbor(Uint8Array.from([0x18, 200]))).toEqual({ v: 200, end: 2 });
    expect(readCbor(Uint8Array.from([0x19, 0x01, 0x00]))).toEqual({ v: 256, end: 3 });
    expect(readCbor(Uint8Array.from([0x1a, 0x80, 0, 0, 0]))).toEqual({ v: 2 ** 31, end: 5 });
    expect(readCbor(Uint8Array.from([0x38, 99])).v).toBe(-100);
    expect(readCbor(Uint8Array.from([0x83, 0xf4, 0xf5, 0xf6])).v).toEqual([false, true, null]);
    expect(readCbor(Uint8Array.from([0x62, 0x6f, 0x6b])).v).toBe("ok");
    expect(readCbor(Uint8Array.from([0x42, 1, 2])).v).toEqual(Uint8Array.from([1, 2]));
  });

  it("refuses eight-byte lengths, floats, tags, too deep nesting, over-long arrays and maps, and bytes that end early", () => {
    expect(() => readCbor(Uint8Array.from([0x1b, 0, 0, 0, 0, 0, 0, 0, 1]))).toThrow("CBOR length not supported");
    expect(() => readCbor(Uint8Array.from([0xf9, 0, 0]))).toThrow("CBOR item not supported");
    expect(() => readCbor(Uint8Array.from([0xc1, 0x00]))).toThrow("CBOR item not supported");
    expect(() => readCbor(Uint8Array.from(Array(10).fill(0x81).concat([0])))).toThrow("CBOR too deep");
    expect(() => readCbor(Uint8Array.from([0x98, 65]))).toThrow("CBOR array too long");
    expect(() => readCbor(Uint8Array.from([0xb8, 65]))).toThrow("CBOR map too long");
    expect(() => readCbor(Uint8Array.from([]))).toThrow("CBOR truncated");
    expect(() => readCbor(Uint8Array.from([0x19, 0x01]))).toThrow("CBOR truncated");
    expect(() => readCbor(Uint8Array.from([0x82, 0x01]))).toThrow("CBOR truncated");
    expect(() => readCbor(Uint8Array.from([0x63, 0x61, 0x62]))).toThrow("CBOR truncated");
  });

  it("refuses text that is not UTF-8", () => {
    expect(() => readCbor(Uint8Array.from([0x61, 0xff]))).toThrow();
  });
});
