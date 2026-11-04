// Block 1: Face ID signs on chain. A MetalAccount's owners are ERC-7913 signers (src/metal/fourEyes.ts); a passkey owner
// is the signer `verifier ‖ qx ‖ qy`: OpenZeppelin's audited ERC7913WebAuthnVerifier (5.6.1, deployed by us on Metal
// testnet) and the passkey's P-256 public key. The phone signs the account's EIP-712 Execute digest as the WebAuthn
// challenge; the verifier checks the type ("webauthn.get"), the challenge, user presence and user verification (Face ID),
// and the P-256 signature through the RIP-7212 precompile. No server key takes part in the owners' quorum.
//
// This module only encodes: the signer bytes, the signature the verifier decodes (its WebAuthnAuth struct, the fields as
// one ABI tuple body, since the verifier reads the struct from the start of the signature), and the quorum signature.

import { createHash } from "node:crypto";
import { concatHex, encodeAbiParameters, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";

/** The P-256 group order and half of it: the verifier refuses s above N/2 (malleability), so a high s is flipped. */
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const HALF_N = N / 2n;

export interface P256Key { qx: Hex; qy: Hex }

/** The ERC-7913 signer of a passkey owner: the verifier's address, then the 64-byte public key. */
export function passkeySigner(verifier: Address, key: P256Key): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key.qx) || !/^0x[0-9a-fA-F]{64}$/.test(key.qy)) throw new Error("a P-256 key is two 32-byte coordinates");
  return concatHex([verifier, key.qx, key.qy]).toLowerCase() as Hex;
}

/** r and s from a DER ECDSA signature (what WebAuthn returns), each 32 bytes, s in the lower half. */
export function derToRs(der: Uint8Array): { r: Hex; s: Hex } {
  let i = 0;
  const take = (tag: number): Uint8Array => {
    if (der[i++] !== tag) throw new Error("not a DER ECDSA signature");
    let len = der[i++]!;
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = (len << 8) | der[i++]!; }
    const out = der.slice(i, i + len);
    i += len;
    return out;
  };
  const seq = take(0x30);
  if (i !== der.length) throw new Error("trailing bytes after the DER signature");
  i = 0;
  const body = seq;
  const read = (): bigint => {
    if (body[i++] !== 0x02) throw new Error("not a DER integer");
    const len = body[i++]!;
    const v = body.slice(i, i + len);
    i += len;
    return BigInt(`0x${Buffer.from(v).toString("hex") || "0"}`);
  };
  const r = read();
  let s = read();
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error("r or s out of range");
  if (s > HALF_N) s = N - s;
  return { r: toHex(r, { size: 32 }), s: toHex(s, { size: 32 }) };
}

export interface Assertion {
  /** As the authenticator returned them (raw bytes, not base64url). */
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** DER. */
  signature: Uint8Array;
}

/** The base64url challenge an Execute digest becomes in clientDataJSON (what the phone passes to navigator.credentials.get). */
export function challengeOf(digest: Hex): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) throw new Error("a digest is 32 bytes");
  return Buffer.from(digest.slice(2), "hex").toString("base64url");
}

/**
 * The signature ERC7913WebAuthnVerifier decodes: (r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON).
 * Refuses an assertion whose challenge is not this digest or whose type is not webauthn.get, so a wrong one never
 * reaches the chain (the verifier would refuse it there too).
 */
export function webauthnSignature(digest: Hex, a: Assertion): Hex {
  const json = Buffer.from(a.clientDataJSON).toString("utf8");
  const typeIndex = json.indexOf('"type":"webauthn.get"');
  const challengeIndex = json.indexOf(`"challenge":"${challengeOf(digest)}"`);
  if (typeIndex < 0) throw new Error("the assertion is not a webauthn.get");
  if (challengeIndex < 0) throw new Error("the assertion's challenge is not this Execute digest");
  if (a.authenticatorData.length < 37) throw new Error("authenticator data too short");
  const flags = a.authenticatorData[32]!;
  if (!(flags & 0x01) || !(flags & 0x04)) throw new Error("the passkey did not verify the user (Face ID): UP and UV must be set");
  const { r, s } = derToRs(a.signature);
  return encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint256, uint256, bytes, string"), [
    r, s, BigInt(challengeIndex), BigInt(typeIndex), toHex(a.authenticatorData), json,
  ]);
}

/**
 * The account signature abi.encode(bytes[] signers, bytes[] signatures), each signer once. Ordered by the signer's
 * keccak256, as OpenZeppelin's multisigner recommends; Metal's account takes the order given (tested on testnet).
 */
export function passkeyQuorum(parts: { signer: Hex; signature: Hex }[]): Hex {
  const s = [...parts].sort((a, b) => (keccak256(a.signer) < keccak256(b.signer) ? -1 : 1));
  if (new Set(s.map((p) => p.signer.toLowerCase())).size !== s.length) throw new Error("a signer appears twice");
  return encodeAbiParameters(parseAbiParameters("bytes[], bytes[]"), [s.map((p) => p.signer), s.map((p) => p.signature)]);
}

/** SHA-256 helper for tests and the software stand-in authenticator. */
export const sha256 = (b: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(b).digest());
