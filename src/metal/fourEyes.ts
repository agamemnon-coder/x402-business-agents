// Four eyes on chain (enterprise item 1): a Metal smart account with two owners and a threshold of two, the CFO and
// the controller. Metal's MetalAccount takes ERC-7913 signers with weights and one threshold
// (docs.metalntwx.com/build/controls/create-and-manage-a-smart-account); every call the account makes, binding,
// replacing or revoking a mandate and any payment it sends itself, needs signatures reaching the threshold. Agents
// still pay alone inside their mandates: a mandate payment is signed by the mandate key, not by the owners. So a
// large payment is anything above the mandate's cap, and it can only go as an executeSigned both owners sign.
//
// This builds what the account checks: the EIP-712 Execute digest over (mode, executionData, nonce, validUntil),
// computed here and never asked of the RPC (as metal-pay's authorizeMandateCall does), and the signature
// abi.encode(bytes[] signers, bytes[] signatures) with the signers sorted by address.

import { encodeAbiParameters, encodeFunctionData, hashTypedData, hexToBigInt, bytesToHex, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

export const ACCOUNT_BATCH_MODE: Hex = "0x0100000000000000000000000000000000000000000000000000000000000000";
export const factoryAbi = parseAbi([
  "function createAccount(bytes[] signers, uint64[] weights, uint64 threshold) returns (address)",
  "function predictAccount(bytes[] signers, uint64[] weights, uint64 threshold) view returns (address)",
]);
export const accountAbi = parseAbi([
  "function nonces(address owner, uint192 key) view returns (uint256)",
  "function executeSigned(bytes32 mode, bytes executionData, uint256 nonce, uint64 validUntil, bytes signature)",
]);

export interface Call { target: Address; value: bigint; callData: Hex }

/** The owners in the order the account expects them: by address, each once. */
export function sortedOwners(owners: readonly Address[]): Address[] {
  const s = [...owners].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (new Set(s.map((a) => a.toLowerCase())).size !== s.length) throw new Error("an owner appears twice");
  return s;
}

/** createAccount's arguments for equal-weight owners and a threshold (2 of 2 for the CFO and the controller). */
export function accountConfig(owners: readonly Address[], threshold: number): readonly [Hex[], bigint[], bigint] {
  const s = sortedOwners(owners);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > s.length) throw new Error(`threshold ${threshold} is not between 1 and ${s.length}`);
  return [s.map((a) => a.toLowerCase() as Hex), s.map(() => 1n), BigInt(threshold)];
}

export function executionData(calls: readonly Call[]): Hex {
  return encodeAbiParameters(parseAbiParameters("(address target, uint256 value, bytes callData)[]"), [calls.map((c) => ({ target: c.target, value: c.value, callData: c.callData }))]);
}

/** The account's Execute digest: what each owner signs. */
export function executeDigest(a: { chainId: number; account: Address; data: Hex; nonce: bigint; validUntil: bigint }): Hex {
  return hashTypedData({
    domain: { name: "MetalAccount", version: "1", chainId: a.chainId, verifyingContract: a.account },
    types: { Execute: [{ name: "mode", type: "bytes32" }, { name: "executionData", type: "bytes" }, { name: "nonce", type: "uint256" }, { name: "validUntil", type: "uint64" }] },
    primaryType: "Execute",
    message: { mode: ACCOUNT_BATCH_MODE, executionData: a.data, nonce: a.nonce, validUntil: a.validUntil },
  });
}

/** A fresh nonce lane with the top bit clear (the account reserves set top bits for below-threshold lanes). */
export function quorumLane(random: Uint8Array = crypto.getRandomValues(new Uint8Array(24))): bigint {
  return hexToBigInt(bytesToHex(random)) >> 1n;
}

/** The quorum signature from these keys, each signing the raw digest, ordered by address. */
export async function quorumSignature(digest: Hex, signers: readonly PrivateKeyAccount[]): Promise<Hex> {
  const s = [...signers].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  if (new Set(s.map((k) => k.address.toLowerCase())).size !== s.length) throw new Error("a signer appears twice");
  return encodeAbiParameters(parseAbiParameters("bytes[], bytes[]"), [s.map((k) => k.address.toLowerCase() as Hex), await Promise.all(s.map((k) => k.sign({ hash: digest })))]);
}

/** The executeSigned call data for these calls, signed by these keys. */
export async function signedExecution(a: { chainId: number; account: Address; calls: readonly Call[]; nonce: bigint; validUntil: bigint; signers: readonly PrivateKeyAccount[] }): Promise<Hex> {
  const data = executionData(a.calls);
  const signature = await quorumSignature(executeDigest({ chainId: a.chainId, account: a.account, data, nonce: a.nonce, validUntil: a.validUntil }), a.signers);
  return encodeFunctionData({ abi: accountAbi, functionName: "executeSigned", args: [ACCOUNT_BATCH_MODE, data, a.nonce, a.validUntil, signature] });
}
