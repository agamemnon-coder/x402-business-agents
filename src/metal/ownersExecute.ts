// Block 1, with the phone's own passkey: a proposal whose approval IS the on-chain signature. The business account's
// owners are the CFO's and the controller's passkeys (src/metal/passkeyOwner.ts), so an account call (bind, replace or
// revoke a mandate) runs only with both their Face IDs. The terms carry the exact calls, the nonce, the deadline and
// the account's EIP-712 Execute digest over them; the phone shows the terms (their hash checked as for every
// proposal) and signs the digest as the WebAuthn challenge. The runner checks the digest follows from the terms, that
// the passkey is one of the account's owners, and verifies the assertion; then it relays executeSigned and pays gas.
// It signs nothing itself: the account checks both Face IDs on chain.

import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { mandateBindingAbi } from "@metalntwx/metal-pay/mandates";
import { CHAIN_ID, USDZ } from "./network.js";
import { centsToBaseUnits, toCents } from "../lib/money.js";
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

/** The account calls an owners_execute may carry: binding or revoking a mandate on the account itself. */
export const OWNER_CALL_SELECTORS = { bind: "0x240c29bb", revoke: "0xb75c7dc6" } as const;
/** How long the signed deadline may outlive the proposal's expiry: enough to relay it, no more. */
export const DEADLINE_SLACK_S = 300;

/**
 * The terms describe exactly what the account will run (security review of block 1): one call, to the account itself,
 * with no value, that binds or revokes a mandate whose cap, budget and payee are the ones the phone shows; the chain
 * is Metal testnet; the nonce lane is a quorum lane; the deadline ends within minutes of the proposal's expiry.
 */
export function checkOwnersTerms(t: OwnersExecuteTerms): void {
  const bad = (why: string): never => { throw new Error(`these owners_execute terms are refused: ${why}`); };
  if (t.chain_id !== String(CHAIN_ID)) bad(`chain ${t.chain_id} is not Metal testnet`);
  if (!Array.isArray(t.calls) || t.calls.length !== 1) bad("exactly one account call");
  const c = t.calls[0]!;
  if (c.target.toLowerCase() !== t.account.toLowerCase() || c.value !== "0") bad("the call must go to the account itself, with no value");
  if ((BigInt(t.nonce) >> 64n) >> 191n !== 0n) bad("the nonce lane has its top bit set (a lane for signatures below the threshold)");
  const exp = Math.floor(Date.parse(t.expires_at) / 1000), until = Number(t.valid_until);
  if (!Number.isSafeInteger(until) || until < exp || until > exp + DEADLINE_SLACK_S) bad(`the signed deadline must end within ${DEADLINE_SLACK_S} s after the proposal's expiry`);
  let d: ReturnType<typeof decodeFunctionData<typeof mandateBindingAbi>>;
  try { d = decodeFunctionData({ abi: mandateBindingAbi, data: c.call_data }); } catch { return bad("the call is not a mandate call"); }
  const a = t.action;
  if (d.functionName === "bind") {
    if (a.what !== "bind") bad("the call binds, the words say otherwise");
    const [, , , cons, terms] = d.args as unknown as [Hex, Hex, Hex, { token: Address; perPaymentCap: bigint; budget: bigint }, { payees: readonly { account: Address }[]; openSdHash: Hex }];
    if (cons.token.toLowerCase() !== USDZ.toLowerCase()) bad("the mandate is not in USDZ");
    if (cons.perPaymentCap !== centsToBaseUnits(toCents(a.cap))) bad(`the call's cap is not the ${a.cap} shown`);
    if (cons.budget !== centsToBaseUnits(toCents(a.budget))) bad(`the call's budget is not the ${a.budget} shown`);
    if (terms.payees.length !== 1 || terms.payees[0]!.account.toLowerCase() !== a.payee.toLowerCase() || !/^0x0{64}$/.test(terms.openSdHash)) bad(`the call's payees are not ${a.payee_name} alone`);
  } else if (d.functionName === "revoke") {
    if (a.what !== "revoke" || (d.args as unknown as [Hex])[0].toLowerCase() !== a.mandate.toLowerCase()) bad("the call revokes another mandate than the one shown");
  } else bad(`${d.functionName} is not allowed here`);
}

/**
 * What a passkey approval of this proposal signs, as 64 hex characters: the terms hash for every proposal, and the
 * account's Execute digest for an owners_execute, after checking that digest follows from the terms.
 */
export function approvalHashOf(p: { kind: string; terms_json: string; terms_sha256: string }): string {
  if (p.kind !== OWNERS_EXECUTE) return p.terms_sha256;
  const t = JSON.parse(p.terms_json) as OwnersExecuteTerms;
  checkOwnersTerms(t);
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
