// A software stand-in for a phone's passkey, for tests and the testnet proof of block 1 only (labelled so in every
// record): a P-256 key that answers navigator.credentials.get the way an authenticator does, with authenticator data
// (rpIdHash, flags, counter) and clientDataJSON. The real flow signs with the phone's passkey (Face ID).

import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { Hex } from "viem";
import { challengeOf, type Assertion, type P256Key } from "./passkeyOwner.js";

export interface SoftPasskey { key: P256Key; privateKey: KeyObject; assert(digest: Hex, o?: { rpId?: string; origin?: string; uv?: boolean; challenge?: string }): Assertion }

export function softPasskey(privateKey?: KeyObject): SoftPasskey {
  const pk = privateKey ?? generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  const jwk = pk.export({ format: "jwk" }) as { x: string; y: string };
  const hex = (b64: string) => `0x${Buffer.from(b64, "base64url").toString("hex")}` as Hex;
  let counter = 0;
  return {
    key: { qx: hex(jwk.x), qy: hex(jwk.y) }, privateKey: pk,
    assert(digest, o = {}) {
      const rpIdHash = createHash("sha256").update(o.rpId ?? "purser.test").digest();
      const flags = 0x01 | (o.uv === false ? 0 : 0x04);
      const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([flags]), Buffer.from([0, 0, 0, ++counter])]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: o.challenge ?? challengeOf(digest), origin: o.origin ?? "https://purser.test", crossOrigin: false }));
      const signature = sign("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]), pk);
      return { authenticatorData: new Uint8Array(authenticatorData), clientDataJSON: new Uint8Array(clientDataJSON), signature: new Uint8Array(signature) };
    },
  };
}
