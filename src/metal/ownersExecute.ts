// Block 1, with the phone's own passkey: a proposal whose approval IS the on-chain signature. The business account's
// owners are the CFO's and the controller's passkeys (src/metal/passkeyOwner.ts), so an account call (bind, replace or
// revoke a mandate) runs only with both their Face IDs. The terms carry the exact calls, the nonce, the deadline and
// the account's EIP-712 Execute digest over them; the phone shows the terms (their hash checked as for every
// proposal) and signs the digest as the WebAuthn challenge. The runner checks the digest follows from the terms, that
// the passkey is one of the account's owners, and verifies the assertion; then it relays executeSigned and pays gas.
// It signs nothing itself: the account checks both Face IDs on chain.

import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { Address, Hex } from "viem";
import { executeDigest, executionData } from "./fourEyes.js";
import { passkeyQuorum, passkeySigner, webauthnSignature, type Assertion, type P256Key } from "./passkeyOwner.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";

export const OWNERS_EXECUTE = "owners_execute";

export interface OwnersExecuteTerms extends Terms {
  kind: typeof OWNERS_EXECUTE;
  account: Address;
  chain_id: string;
  /** The account's owners as ERC-7913 signers (verifier ‖ P-256 key), as created. */
  owners: Hex[];
  calls: { target: Address; value: string; call_data: Hex }[];
  nonce: string;
  valid_until: string;
  /** The account's Execute digest over the calls, nonce and deadline: what both passkeys sign. */
  onchain_digest: Hex;
  /** What the calls do, in words the phone shows; the calls themselves are what the account runs. */
  action: { what: string; agent: string; cap: string; budget: string; payee: string; payee_name: string; mandate: Hex };
}

const HEX32 = /^0x[0-9a-f]{64}$/;

export function digestOfTerms(t: OwnersExecuteTerms): Hex {
  const data = executionData(t.calls.map((c) => ({ target: c.target, value: BigInt(c.value), callData: c.call_data })));
  return executeDigest({ chainId: Number(t.chain_id), account: t.account, data, nonce: BigInt(t.nonce), validUntil: BigInt(t.valid_until) });
}

export function ownersExecuteTerms(a: Omit<OwnersExecuteTerms, "schema" | "kind" | "onchain_digest">): OwnersExecuteTerms {
  const t = { schema: TERMS_SCHEMA, kind: OWNERS_EXECUTE, ...a, onchain_digest: "0x" as Hex } as OwnersExecuteTerms;
  t.onchain_digest = digestOfTerms(t).toLowerCase() as Hex;
  return t;
}

/**
 * What a passkey approval of this proposal signs, as 64 hex characters: the terms hash for every proposal, and the
 * account's Execute digest for an owners_execute, after checking that digest follows from the terms.
 */
export function approvalHashOf(p: { kind: string; terms_json: string; terms_sha256: string }): string {
  if (p.kind !== OWNERS_EXECUTE) return p.terms_sha256;
  const t = JSON.parse(p.terms_json) as OwnersExecuteTerms;
  if (!HEX32.test(t.onchain_digest) || digestOfTerms(t).toLowerCase() !== t.onchain_digest) throw new Error("the on-chain digest in the terms does not follow from their calls, nonce and deadline");
  return t.onchain_digest.slice(2);
}

/** The P-256 public key of a passkey, from the COSE key the runner stored at enrolment. */
export function coseP256(publicKey: string): P256Key {
  const cose = isoCBOR.decodeFirst<Map<number, number | Uint8Array>>(new Uint8Array(Buffer.from(publicKey, "base64url")));
  if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) throw new Error("this passkey is not an ES256 (P-256) key, so it cannot be an account owner");
  const hex = (b: unknown) => `0x${Buffer.from(b as Uint8Array).toString("hex").padStart(64, "0")}` as Hex;
  return { qx: hex(cose.get(-2)), qy: hex(cose.get(-3)) };
}

/** The signer bytes this passkey has as an owner of the account in these terms, or null if it is not one. */
export function ownerSignerOf(t: OwnersExecuteTerms, publicKey: string): Hex | null {
  const key = coseP256(publicKey);
  return t.owners.map((o) => o.toLowerCase() as Hex).find((o) => o === passkeySigner(`0x${o.slice(2, 42)}` as Address, key)) ?? null;
}

export function assertionOf(r: AuthenticationResponseJSON): Assertion {
  const b = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
  return { authenticatorData: b(r.response.authenticatorData), clientDataJSON: b(r.response.clientDataJSON), signature: b(r.response.signature) };
}

/** The account signature from the verified approvals: each an owner, each once, each over this digest. */
export function quorumOf(t: OwnersExecuteTerms, approvals: { publicKey: string; response: AuthenticationResponseJSON }[]): Hex {
  return passkeyQuorum(approvals.map((a) => {
    const signer = ownerSignerOf(t, a.publicKey);
    if (!signer) throw new Error("an approval came from a passkey that is not an owner of the account");
    return { signer, signature: webauthnSignature(t.onchain_digest, assertionOf(a.response)) };
  }));
}
