// The compliance decision for an outgoing Metal payment (enterprise item 2): only a payee the CFO approved and not on
// the sanctions list gets one, screened by signDecision itself, valid for at most an hour, bound to that payment. The
// contract side ran live: docs/runs/2026-10-30-compliance-policy.md.
import { hashTypedData, recoverAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { CANCEL_TYPES, DECISION_TYPES, listsHash, policyDomain, screenPayee, signCancel, signDecision } from "../src/compliance/screening.js";

const compliance = privateKeyToAccount("0x4444444444444444444444444444444444444444444444444444444444444444");
const PAYEE = "0x00000000000000000000000000000000000000b1" as Address;
const SANCTIONED = "0x00000000000000000000000000000000000000ba" as Address;
const OTHER = "0x00000000000000000000000000000000000000c3" as Address;
const CONTRACT = "0x00000000000000000000000000000000000000ee" as Address;
const lists = { approved: [PAYEE, SANCTIONED], sanctioned: [SANCTIONED], version: "test-list-1" };
const id = `0x${"01".repeat(32)}` as Hex;
const NOW = 1_900_000_000n;

describe("screening a payee", () => {
  it("clears an approved payee that is not sanctioned, case-insensitively", () => {
    expect(screenPayee(PAYEE.toUpperCase().replace("0X", "0x") as Address, lists, NOW)).toMatchObject({ cleared: true, reasons: [] });
  });
  it("refuses a sanctioned payee even if approved, and one the CFO never approved", () => {
    expect(screenPayee(SANCTIONED, lists, NOW)).toMatchObject({ cleared: false, reasons: ["on the sanctions list"] });
    expect(screenPayee(OTHER, lists, NOW)).toMatchObject({ cleared: false, reasons: ["not a payee the CFO approved"] });
  });
  it("commits the reference to the lists' contents, the payee and the time, not just a label", () => {
    const ref = screenPayee(PAYEE, lists, NOW).ref;
    expect(screenPayee(PAYEE, { ...lists, sanctioned: [SANCTIONED, OTHER] }, NOW).ref).not.toBe(ref);
    expect(screenPayee(PAYEE, lists, NOW + 1n).ref).not.toBe(ref);
    expect(screenPayee(OTHER, lists, NOW).ref).not.toBe(ref);
    // The same lists in another order are the same lists.
    expect(listsHash({ ...lists, approved: [SANCTIONED, PAYEE] })).toBe(listsHash(lists));
  });
});

describe("the signed decision", () => {
  it("is signed only after its own screening, and recovers to the compliance key over exactly this payment", async () => {
    const { signature, screening } = await signDecision(compliance, { chainId: 63825, contract: CONTRACT, payee: PAYEE, lists, paymentId: id, amount: 500_000n, validUntil: NOW + 600n, now: NOW });
    const message = { paymentId: id, to: PAYEE, amount: 500_000n, validUntil: NOW + 600n, screeningRef: screening.ref };
    expect(await recoverAddress({ hash: hashTypedData({ domain: policyDomain(63825, CONTRACT), types: DECISION_TYPES, primaryType: "Decision", message }), signature })).toBe(compliance.address);
    // The same signature over another amount recovers to someone else: the contract refuses it.
    expect(await recoverAddress({ hash: hashTypedData({ domain: policyDomain(63825, CONTRACT), types: DECISION_TYPES, primaryType: "Decision", message: { ...message, amount: 1_500_000n } }), signature })).not.toBe(compliance.address);
    // v is 27 or 28 and s is in the lower half, as the contract requires.
    expect(["1b", "1c"]).toContain(signature.slice(-2));
    expect(BigInt(`0x${signature.slice(66, 130)}`) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n).toBe(true);
  });

  it("is never signed for a refused payee, a zero amount or a validity over an hour", async () => {
    const base = { chainId: 63825, contract: CONTRACT, lists, paymentId: id, now: NOW };
    await expect(signDecision(compliance, { ...base, payee: SANCTIONED, amount: 1n, validUntil: NOW + 60n })).rejects.toThrow(/sanctions list/);
    await expect(signDecision(compliance, { ...base, payee: OTHER, amount: 1n, validUntil: NOW + 60n })).rejects.toThrow(/approved/);
    await expect(signDecision(compliance, { ...base, payee: PAYEE, amount: 0n, validUntil: NOW + 60n })).rejects.toThrow(/positive/);
    await expect(signDecision(compliance, { ...base, payee: PAYEE, amount: 1n, validUntil: NOW + 3601n })).rejects.toThrow(/at most 3600/);
  });

  it("signs a cancellation the contract can check", async () => {
    const sig = await signCancel(compliance, { chainId: 63825, contract: CONTRACT, paymentId: id });
    expect(await recoverAddress({ hash: hashTypedData({ domain: policyDomain(63825, CONTRACT), types: CANCEL_TYPES, primaryType: "Cancel", message: { paymentId: id } }), signature: sig })).toBe(compliance.address);
  });
});
