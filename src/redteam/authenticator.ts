// A software WebAuthn authenticator (P-256, ES256, attestation "none") that produces the same JSON a phone's passkey
// hands the page. The tests use it to play the CFO's phone; the red team (src/redteam) uses it as the attacker's own
// key. Every field it signs can be set wrong on purpose: origin, rpId, challenge, counter, user verification.

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();
const b64url = (data: Uint8Array) => Buffer.from(data).toString("base64url");
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export interface Ceremony {
  /** base64url, exactly as the page passes it in the options. */
  challenge: string;
  origin: string;
  rpId: string;
  userVerified?: boolean;
  counter?: number;
}

export class FakeAuthenticator {
  readonly credentialId: string;
  private readonly privateKey: KeyObject;
  private readonly cosePublicKey: Uint8Array;
  /** sha256 of the public key as SPKI DER: what the phone shows as the new passkey's fingerprint. */
  readonly spkiSha256: string;
  /** The public key as a JWK (P-256): what a receipt carries so anyone can check a signature offline. */
  readonly publicJwk: { kty: "EC"; crv: "P-256"; x: string; y: string };

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    this.spkiSha256 = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
    const jwk = publicKey.export({ format: "jwk" });
    this.publicJwk = { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! };
    // COSE_Key for ES256: kty EC2 (2), alg ES256 (-7), crv P-256 (1), x, y.
    this.cosePublicKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
      [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")],
    ]));
    this.credentialId = b64url(randomBytes(16));
  }

  private flags(c: Ceremony, extra = 0): number {
    return FLAG_UP | (c.userVerified === false ? 0 : FLAG_UV) | FLAG_BE | FLAG_BS | extra;
  }

  /** What navigator.credentials.create() returns, serialised as the page sends it. */
  register(c: Ceremony): RegistrationResponseJSON {
    const credId = Buffer.from(this.credentialId, "base64url");
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(credId.length);
    const authData = Buffer.concat([
      sha256(c.rpId), Buffer.from([this.flags(c, FLAG_AT)]), u32(c.counter ?? 0),
      Buffer.alloc(16), idLen, credId, Buffer.from(this.cosePublicKey),
    ]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]) as never);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: c.challenge, origin: c.origin, crossOrigin: false }));
    return {
      id: this.credentialId, rawId: this.credentialId, type: "public-key",
      response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ["internal", "hybrid"] },
      clientExtensionResults: {}, authenticatorAttachment: "platform",
    };
  }

  /** What navigator.credentials.get() returns, serialised as the page sends it. */
  sign(c: Ceremony & { userHandle?: string }): AuthenticationResponseJSON {
    const authData = Buffer.concat([sha256(c.rpId), Buffer.from([this.flags(c)]), u32(c.counter ?? 0)]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: c.challenge, origin: c.origin, crossOrigin: false }));
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: this.credentialId, rawId: this.credentialId, type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature),
        ...(c.userHandle ? { userHandle: c.userHandle } : {}),
      },
      clientExtensionResults: {}, authenticatorAttachment: "platform",
    };
  }
}
