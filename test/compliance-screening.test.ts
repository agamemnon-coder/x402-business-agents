// The compliance decision for an outgoing Metal payment (enterprise item 2): only a payee the CFO approved and not on
// the sanctions list gets one, and it is bound to that payment. The contract side ran live: docs/runs/2026-10-30-compliance-policy.md.
import { hashTypedData, recoverAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { DECISION_TYPES, policyDomain, screenPayee, signDecision } from "../src/compliance/screening.js";

const compliance = privateKeyToAccount("0x4444444444444444444444444444444444444444444444444444444444444444");
const PAYEE = "0x00000000000000000000000000000000000000b1" as Address;
const SANCTIONED = "0x00000000000000000000000000000000000000bad" .slice(0, 42) as Address;
const OTHER = "0x00000000000000000000000000000000000000c3" as Address;
const CONTRACT = "0x00000000000000000000000000000000000000ee" as Address;
const lists = { approved: [PAYEE, SANCTIONED], sanctioned: [SANCTIONED], version: "test-list-1" };
const id = `0x${"01".repeat(32)}` as Hex;

describe("screening a payee", () => {
  it("clears an approved payee that is not sanctioned, case-insensitively", () => {
    expect(screenPayee(PAYEE.toUpperCase().replace("0X", "0x") as Address, lists)).toMatchObject({ cleared: true, reasons: [] });
  });
  it("refuses a sanctioned payee even if approved, and one the CFO never approved", () => {
    expect(screenPayee(SANCTIONED, lists)).toMatchObject({ cleared: false, reasons: ["on the sanctions list"] });
    expect(screenPayee(OTHER, lists)).toMatchObject({ cleared: false, reasons: ["not a payee the CFO approved"] });
  });
  it("names the list and the result in the screening reference", () => {
    expect(screenPayee(PAYEE, lists).ref).not.toBe(screenPayee(PAYEE, { ...lists, version: "test-list-2" }).ref);
    expect(screenPayee(PAYEE, lists).ref).not.toBe(screenPayee(OTHER, lists).ref);
  });
});

describe("the signed decision", () => {
  it("is signed only for a cleared payee, and recovers to the compliance key over exactly this payment", async () => {
    const s = screenPayee(PAYEE, lists);
    const sig = await signDecision(compliance, { chainId: 63825, contract: CONTRACT, screening: s, paymentId: id, amount: 500_000n, validUntil: 1_900_000_000n });
    const digest = hashTypedData({ domain: policyDomain(63825, CONTRACT), types: DECISION_TYPES, primaryType: "Decision", message: { paymentId: id, to: PAYEE, amount: 500_000n, validUntil: 1_900_000_000n, screeningRef: s.ref } });
    expect(await recoverAddress({ hash: digest, signature: sig })).toBe(compliance.address);
    // The same signature over another amount, payee or contract recovers to someone else: the contract refuses it.
    const other = hashTypedData({ domain: policyDomain(63825, CONTRACT), types: DECISION_TYPES, primaryType: "Decision", message: { paymentId: id, to: PAYEE, amount: 1_500_000n, validUntil: 1_900_000_000n, screeningRef: s.ref } });
    expect(await recoverAddress({ hash: other, signature: sig })).not.toBe(compliance.address);
    // v is 27 or 28 and s is in the lower half, as the contract requires.
    expect(["1b", "1c"]).toContain(sig.slice(-2));
    expect(BigInt(`0x${sig.slice(66, 130)}`) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n).toBe(true);
  });
  it("is never signed for a refused payee or a zero amount", async () => {
    await expect(Promise.resolve().then(() => signDecision(compliance, { chainId: 63825, contract: CONTRACT, screening: screenPayee(SANCTIONED, lists), paymentId: id, amount: 1n, validUntil: 1n }))).rejects.toThrow(/sanctions list/);
    await expect(Promise.resolve().then(() => signDecision(compliance, { chainId: 63825, contract: CONTRACT, screening: screenPayee(PAYEE, lists), paymentId: id, amount: 0n, validUntil: 1n }))).rejects.toThrow(/positive/);
  });
});
