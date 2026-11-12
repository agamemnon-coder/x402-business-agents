// Why a Metal account refused a call, in words. A MetalAccount answers a call it refuses with a custom error; viem
// reports that as "reverted for an unknown reason" unless it is given the error's ABI (the four-eyes and passkey runs
// of 30 October and 1 November recorded exactly that). This decodes the revert data against the errors Purser has:
//   - Metal's Mandate Binding errors, from the pinned SDK (@metalntwx/metal-pay);
//   - the errors of the OpenZeppelin contracts the account is built on (its events name them: an ERC-7913 multi-signer,
//     keyed nonces, ERC-7579 execution), word for word from the pinned sources (@openzeppelin/contracts 5.6.1;
//     test/account-errors.test.ts compares the two);
//   - Solidity's own Error(string) and Panic(uint256).
// The pinned SDK carries no ABI of the account's own errors beyond these, so an error outside the lists is shown by its
// 4-byte selector and said to be unknown: never a guess, never "unknown reason". Add its line here once its name is known.

import { decodeAbiParameters, decodeErrorResult, parseAbi, parseAbiParameters, size, slice, type Abi, type Hex } from "viem";
import { mandateBindingAbi } from "@metalntwx/metal-pay/mandates";
import { redactSecrets } from "../lib/redact.js";

/** OpenZeppelin Contracts 5.6.1: MultiSignerERC7913(Weighted), ERC7579Utils, Nonces, Errors, Address, Initializable, IERC6093 (ERC-20), SafeERC20, ECDSA, Account, ReentrancyGuard. */
export const OPENZEPPELIN_ERRORS = [
  "error MultiSignerERC7913AlreadyExists(bytes signer)",
  "error MultiSignerERC7913NonexistentSigner(bytes signer)",
  "error MultiSignerERC7913InvalidSigner(bytes signer)",
  "error MultiSignerERC7913ZeroThreshold()",
  "error MultiSignerERC7913UnreachableThreshold(uint64 signers, uint64 threshold)",
  "error MultiSignerERC7913WeightedInvalidWeight(bytes signer, uint64 weight)",
  "error MultiSignerERC7913WeightedMismatchedLength()",
  "error ERC7579DecodingError()",
  "error InvalidAccountNonce(address account, uint256 currentNonce)",
  "error InsufficientBalance(uint256 balance, uint256 needed)",
  "error FailedCall()",
  "error MissingPrecompile(address)",
  "error AddressEmptyCode(address target)",
  "error InvalidInitialization()",
  "error NotInitializing()",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error SafeERC20FailedOperation(address token)",
  "error ECDSAInvalidSignature()",
  "error ECDSAInvalidSignatureLength(uint256 length)",
  "error ECDSAInvalidSignatureS(bytes32 s)",
  "error AccountUnauthorized(address sender)",
  "error ReentrancyGuardReentrantCall()",
] as const;

type AbiError = Extract<Abi[number], { type: "error" }>;

/** Every custom error Purser can name on a Metal account. */
export const ACCOUNT_ERRORS: readonly AbiError[] = [
  ...(mandateBindingAbi as Abi).filter((x): x is AbiError => x.type === "error"),
  ...(parseAbi(OPENZEPPELIN_ERRORS) as readonly AbiError[]),
];

const UNKNOWN = "(not in Purser's error lists for the Metal account)";
const NO_DATA = "reverted without revert data (the account gave no reason)";
const PANICS: Record<string, string> = {
  "0x1": "assertion failed", "0x11": "arithmetic overflow or underflow", "0x12": "division by zero", "0x21": "invalid enum value",
  "0x22": "badly encoded storage byte array", "0x31": "pop on an empty array", "0x32": "array index out of bounds", "0x41": "out of memory", "0x51": "call of an uninitialised function",
};

function show(value: unknown): string {
  if (typeof value === "string" && value.startsWith("0x") && value.length > 66) return `${value.slice(0, 18)}… (${size(value as Hex)} bytes)`;
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  return String(value);
}

/** A revert's data as words: the error's name and arguments when a list has it, else its selector, said to be unknown. */
export function decodeRevert(data: Hex | null | undefined): string {
  if (!data || data === "0x" || size(data) < 4) return NO_DATA;
  const selector = slice(data, 0, 4);
  try {
    if (selector === "0x08c379a0") return `revert ${JSON.stringify(decodeAbiParameters(parseAbiParameters("string"), slice(data, 4))[0])}`;
    if (selector === "0x4e487b71") {
      const code = `0x${decodeAbiParameters(parseAbiParameters("uint256"), slice(data, 4))[0].toString(16)}`;
      return `panic ${code} (${PANICS[code] ?? "unknown panic code"})`;
    }
    const d = decodeErrorResult({ abi: ACCOUNT_ERRORS, data });
    const inputs = (d.abiItem as AbiError).inputs ?? [];
    return `${d.errorName}(${(d.args ?? []).map((a, i) => `${inputs[i]?.name ? `${inputs[i]!.name} ` : ""}${show(a)}`).join(", ")})`;
  } catch {
    const args = size(data) - 4;
    return `custom error ${selector}${args ? ` with ${args} bytes of arguments` : ""} ${UNKNOWN}`;
  }
}

type Chained = { cause?: unknown; data?: unknown; code?: unknown; message?: unknown; details?: unknown; shortMessage?: unknown };
function chain(e: unknown): Chained[] {
  const out: Chained[] = [];
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 12; x = (x as Chained).cause, i++) out.push(x as Chained);
  return out;
}
const isHex = (v: unknown): v is Hex => typeof v === "string" && /^0x([0-9a-fA-F]{2})*$/.test(v);

/** The revert data inside an error from a node or from viem (which wraps it, sometimes several deep); null when there is none. */
export function revertDataOf(e: unknown): Hex | null {
  for (const x of chain(e)) {
    if (isHex(x.data)) return x.data;
    const inner = x.data && typeof x.data === "object" ? (x.data as { data?: unknown }).data : undefined;
    if (isHex(inner)) return inner;
  }
  return null;
}

/** Whether the chain itself refused the call (a revert), as opposed to a request that failed on the way. */
export function isRevert(e: unknown): boolean {
  return chain(e).some((x) => x.code === 3 || [x.details, x.shortMessage, typeof x.message === "string" ? x.message.split("\n")[0] : ""].some((m) => typeof m === "string" && /revert/i.test(m)));
}

/** What the node itself said, in one line, with no URL or credential in it (viem's long messages quote the RPC URL). */
export function nodeSaid(e: unknown): string {
  const all = chain(e);
  const x = all.find((y) => typeof y.details === "string" && y.details) ?? all[all.length - 1];
  const text = typeof x?.details === "string" && x.details ? x.details : typeof x?.shortMessage === "string" ? x.shortMessage : String(x?.message ?? e);
  return redactSecrets(text.split("\n")[0]!).slice(0, 200);
}

/** The chain's own reason inside an error, when the error is a revert; null when it is something else (the network, a spent call budget). */
export function revertReason(e: unknown): string | null {
  const data = revertDataOf(e);
  if (data && data !== "0x") return decodeRevert(data);
  return isRevert(e) ? `${NO_DATA}; the node said: ${nodeSaid(e)}` : null;
}

/**
 * Why the chain would refuse a call: runs `call` (one read-only eth_call or gas estimate) and decodes its revert.
 * Null when the call passes. An error that is not a revert (the network, a spent call budget) is thrown on as it is.
 */
export async function whyRefused(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (e) {
    const why = revertReason(e);
    if (why === null) throw e;
    return why;
  }
}
