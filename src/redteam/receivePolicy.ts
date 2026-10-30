// In-memory stand-in for Metal's ReceivePolicy, for the unit tests and the red team (never a live run). It behaves as
// the receive policy page and the live spike of 30 October 2026 showed: an allowlist-only account in quarantine mode
// gets nothing from an unknown sender; the credit is held under a receipt that its authority can claim once.

import type { Address, Hex } from "viem";
import { receiptId, type PolicyState, type Quarantined, type Receipt, type ReceivePolicyPort } from "../metal/receivePolicy.js";
import { USDZ } from "../metal/network.js";

export class FakeReceivePolicy implements ReceivePolicyPort {
  policies = new Map<string, PolicyState>();
  allowed = new Map<string, Set<string>>();
  log: Quarantined[] = [];
  openIds = new Set<string>();
  block = 100;
  claims: { receipt: Receipt; to: Address }[] = [];
  /** The address whose key file each configure/claim is signed with (tests set it). */
  signer: (keyFile: string) => Address = () => "0x00000000000000000000000000000000000000e1";

  async policyOf(a: Address) { return this.policies.get(a.toLowerCase()) ?? { allowlistOnly: false, tokenFilter: false, refusal: 0, recovery: 0, authority: "0x0000000000000000000000000000000000000000" as Address }; }
  async senderAllowed(a: Address, s: Address) { return this.allowed.get(a.toLowerCase())?.has(s.toLowerCase()) ?? false; }
  async configure(keyFile: string, senders: Address[]): Promise<Hex[]> {
    const me = this.signer(keyFile).toLowerCase();
    const set = this.allowed.get(me) ?? new Set<string>();
    senders.forEach((s) => set.add(s.toLowerCase()));
    this.allowed.set(me, set);
    this.policies.set(me, { allowlistOnly: true, tokenFilter: false, refusal: 1, recovery: 1, authority: "0x0000000000000000000000000000000000000000" });
    return [`0x${"a1".repeat(32)}`, `0x${"a2".repeat(32)}`];
  }
  /** A transfer arrives: credited if the sender is allowed (true), held in quarantine otherwise (false). */
  receive(from: Address, to: Address, amount: bigint): boolean {
    const p = this.policies.get(to.toLowerCase());
    if (!p?.allowlistOnly || this.allowed.get(to.toLowerCase())?.has(from.toLowerCase())) return true;
    const receipt: Receipt = { nonce: BigInt(this.log.length + 1), token: USDZ, originator: from, receiver: to, authority: to, amount };
    const id = receiptId(receipt);
    this.block++;
    this.log.push({ receiptId: id, receipt, reason: 2, tx: `0x${String(this.log.length + 1).padStart(64, "0")}`, logIndex: 0, block: this.block });
    this.openIds.add(id);
    return false;
  }
  async quarantinedSince(receiver: Address, fromBlock: number) {
    return { events: this.log.filter((q) => q.block >= fromBlock && q.receipt.receiver.toLowerCase() === receiver.toLowerCase()), next: this.block + 1 };
  }
  async isOpen(id: Hex) { return this.openIds.has(id); }
  async claim(keyFile: string, receipt: Receipt, to: Address): Promise<Hex> {
    const id = receiptId(receipt);
    if (!this.openIds.has(id)) throw new Error("UnknownReceipt()");
    if (this.signer(keyFile).toLowerCase() !== receipt.authority.toLowerCase()) throw new Error("NotRecoveryAuthority()");
    this.openIds.delete(id);
    this.claims.push({ receipt, to });
    return `0x${"c1".repeat(32)}`;
  }
}
