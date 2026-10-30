// Purser's compliance decision for an outgoing payment on Metal (enterprise item 2). Before a payment may leave the
// ComplianceSendPolicy contract (contracts/ComplianceSendPolicy.sol), Purser screens the payee and, only if it passes,
// signs a decision bound to that payment: its id, payee, amount, an expiry of at most an hour, and a reference to the
// screening (the lists' contents, the payee, the time). The contract reverts without such a decision. What it proves
// is that the compliance key signed: so signDecision screens the payee itself, never trusting a result handed to it,
// and the compliance key belongs in a signer of its own, apart from the payer key (in the demo they share a machine).
//
// The screening here is two checks: the payee is one the CFO approved, and it is not on the sanctions list. The list in
// this build is a TEST list (a stand-in address for a sanctioned party), not a screening service; in production the
// same decision would be signed after a provider's check (and Airwallex screens its own payments itself).

import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

export interface ScreeningLists {
  /** The payees the CFO approved (the policy's payee allowlist). */
  approved: readonly Address[];
  /** Sanctioned addresses; here a labelled test list. */
  sanctioned: readonly Address[];
  /** Names the list version that was used. */
  version: string;
}

export interface Screening {
  payee: Address;
  cleared: boolean;
  reasons: string[];
  /** When the payee was screened (unix seconds). */
  screened_at: bigint;
  /** keccak256 of the lists' contents, the payee, the result and the time: what the decision carries as screeningRef. */
  ref: Hex;
}

/** The longest a decision may stay usable: a payee sanctioned later cannot be paid on an old one. */
export const MAX_DECISION_SECONDS = 3600n;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sorted = (xs: readonly Address[]) => [...xs].map((x) => x.toLowerCase() as Address).sort();

/** keccak256 of the lists as screened: the version and both address lists, sorted. */
export function listsHash(lists: ScreeningLists): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("string, address[], address[]"), [lists.version, sorted(lists.approved), sorted(lists.sanctioned)]));
}

export function screenPayee(payee: Address, lists: ScreeningLists, now = BigInt(Math.floor(Date.now() / 1000))): Screening {
  const reasons: string[] = [];
  if (lists.sanctioned.some((s) => same(s, payee))) reasons.push("on the sanctions list");
  if (!lists.approved.some((a) => same(a, payee))) reasons.push("not a payee the CFO approved");
  const cleared = reasons.length === 0;
  const ref = keccak256(encodeAbiParameters(parseAbiParameters("bytes32, address, bool, uint64"), [listsHash(lists), payee, cleared, now]));
  return { payee, cleared, reasons, screened_at: now, ref };
}

export interface Decision {
  paymentId: Hex;
  to: Address;
  amount: bigint;
  validUntil: bigint;
  screeningRef: Hex;
}

export const DECISION_TYPES = {
  Decision: [
    { name: "paymentId", type: "bytes32" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" },
    { name: "validUntil", type: "uint64" }, { name: "screeningRef", type: "bytes32" },
  ],
} as const;
export const CANCEL_TYPES = { Cancel: [{ name: "paymentId", type: "bytes32" }] } as const;

export const policyDomain = (chainId: number, contract: Address) => ({ name: "PurserComplianceSendPolicy", version: "1", chainId, verifyingContract: contract }) as const;

/**
 * Screens the payee and, only if it passes, signs the decision for this one payment. Throws for a payee that does
 * not pass, a zero amount, or a validity longer than MAX_DECISION_SECONDS: no decision exists to submit then.
 * Returns the signature and the screening it was signed on.
 */
export async function signDecision(key: PrivateKeyAccount, a: { chainId: number; contract: Address; payee: Address; lists: ScreeningLists; paymentId: Hex; amount: bigint; validUntil: bigint; now?: bigint }): Promise<{ signature: Hex; screening: Screening }> {
  const now = a.now ?? BigInt(Math.floor(Date.now() / 1000));
  const screening = screenPayee(a.payee, a.lists, now);
  if (!screening.cleared) throw new Error(`no compliance decision for ${a.payee}: ${screening.reasons.join("; ")}`);
  if (a.amount <= 0n) throw new Error("the amount must be positive");
  if (a.validUntil - now > MAX_DECISION_SECONDS) throw new Error(`a decision may be valid for at most ${MAX_DECISION_SECONDS} seconds`);
  const message: Decision = { paymentId: a.paymentId, to: a.payee, amount: a.amount, validUntil: a.validUntil, screeningRef: screening.ref };
  return { signature: await key.signTypedData({ domain: policyDomain(a.chainId, a.contract), types: DECISION_TYPES, primaryType: "Decision", message }), screening };
}

/** Purser withdraws an unused decision: the contract's cancel marks the payment id spent. */
export function signCancel(key: PrivateKeyAccount, a: { chainId: number; contract: Address; paymentId: Hex }): Promise<Hex> {
  return key.signTypedData({ domain: policyDomain(a.chainId, a.contract), types: CANCEL_TYPES, primaryType: "Cancel", message: { paymentId: a.paymentId } });
}
