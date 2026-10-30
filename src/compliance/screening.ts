// Purser's compliance decision for an outgoing payment on Metal (enterprise item 2). Before a payment may leave the
// ComplianceSendPolicy contract (contracts/ComplianceSendPolicy.sol), Purser screens the payee and, only if it passes,
// signs a decision bound to that payment: its id, payee, amount, an expiry and a reference to the screening. The
// contract reverts without such a decision, so a payee that failed screening cannot be paid, whoever holds the payer key.
//
// The screening here is two checks: the payee is one the CFO approved, and it is not on the sanctions list. The list in
// this build is a TEST list (a stand-in address for a sanctioned party), not a screening service; in production the
// same decision would be signed after a provider's check (and Airwallex screens its own payments itself).

import { encodePacked, keccak256, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

export interface ScreeningLists {
  /** The payees the CFO approved (the policy's payee allowlist). */
  approved: readonly Address[];
  /** Sanctioned addresses; here a labelled test list. */
  sanctioned: readonly Address[];
  /** Names the list version that was used, so the decision says which list cleared the payee. */
  version: string;
}

export interface Screening {
  payee: Address;
  cleared: boolean;
  reasons: string[];
  /** keccak256(list version, payee, result): what the signed decision carries as screeningRef. */
  ref: Hex;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function screenPayee(payee: Address, lists: ScreeningLists): Screening {
  const reasons: string[] = [];
  if (lists.sanctioned.some((s) => same(s, payee))) reasons.push("on the sanctions list");
  if (!lists.approved.some((a) => same(a, payee))) reasons.push("not a payee the CFO approved");
  const cleared = reasons.length === 0;
  return { payee, cleared, reasons, ref: keccak256(encodePacked(["string", "address", "bool"], [lists.version, payee, cleared])) };
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

export const policyDomain = (chainId: number, contract: Address) => ({ name: "PurserComplianceSendPolicy", version: "1", chainId, verifyingContract: contract }) as const;

/**
 * Signs the decision for one payment, only for a payee that passed screening. Throws for one that did not: the
 * compliance key never signs for a refused payee, so no decision for it exists to submit.
 */
export function signDecision(key: PrivateKeyAccount, a: { chainId: number; contract: Address; screening: Screening; paymentId: Hex; amount: bigint; validUntil: bigint }): Promise<Hex> {
  if (!a.screening.cleared) throw new Error(`no compliance decision for ${a.screening.payee}: ${a.screening.reasons.join("; ")}`);
  if (a.amount <= 0n) throw new Error("the amount must be positive");
  const message: Decision = { paymentId: a.paymentId, to: a.screening.payee, amount: a.amount, validUntil: a.validUntil, screeningRef: a.screening.ref };
  return key.signTypedData({ domain: policyDomain(a.chainId, a.contract), types: DECISION_TYPES, primaryType: "Decision", message });
}
