// Metal's receive policy (B1): which senders an account accepts *USDZ from. Purser sets it on the sweep wallet so only
// Northwind's own business account can pay into it; anything else completes into quarantine at ReceivePolicy
// (0x…0f4d) and waits there for the CFO. Reference: https://docs.metalntwx.com/reference/compliance/receive-policy.md
// Testnet has an earlier ReceivePolicy: allowlist, blocklist, token filter, minimum, quarantine and claim work;
// maximum amounts and sender limits do not yet.

import { createWalletClient, custom, encodeAbiParameters, keccak256, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient, readKeyFile } from "./chain.js";
import { USDZ } from "./network.js";

export const RECEIVE_POLICY = "0x0000000000000000000000000000000000000f4d" as const;

export const RECEIVE_POLICY_ABI = parseAbi([
  "function setPolicy(bool allowlistOnly, bool tokenFilter, uint8 refusal, uint8 recovery, address authority)",
  "function setAllowedSenders(address[] senders, bool allowed)",
  "function policyOf(address account) view returns (bool allowlistOnly, bool tokenFilter, uint8 refusal, uint8 recovery, address authority)",
  "function senderAllowed(address account, address sender) view returns (bool)",
  "function reasonFor(address token, address from, address to, uint256 amount) view returns (uint8)",
  "function open(bytes32 receiptId) view returns (bool)",
  "function claim((uint256 nonce,address token,address originator,address receiver,address authority,uint256 amount) receipt,address to)",
  "event Quarantined(bytes32 indexed receiptId,address indexed receiver,address indexed originator,(uint256 nonce,address token,address originator,address receiver,address authority,uint256 amount) receipt,uint8 reason)",
  "event Claimed(bytes32 indexed receiptId,address indexed to)",
]);

/** Refusal QUARANTINE (1) and recovery RECEIVER (1): refused credits are held, and the wallet itself releases them. */
export const QUARANTINE = 1;
export const RECEIVER = 1;

export interface Receipt { nonce: bigint; token: Address; originator: Address; receiver: Address; authority: Address; amount: bigint }
export interface Quarantined { receiptId: Hex; receipt: Receipt; reason: number; tx: Hex; logIndex: number; block: number }
export interface PolicyState { allowlistOnly: boolean; tokenFilter: boolean; refusal: number; recovery: number; authority: Address }

/** What Purser needs from ReceivePolicy; the live one is below, the tests use a fake (src/redteam/receivePolicy.ts). */
export interface ReceivePolicyPort {
  policyOf(account: Address): Promise<PolicyState>;
  senderAllowed(account: Address, sender: Address): Promise<boolean>;
  /** Allowlist-only, quarantine, recovery by the account itself, and these senders allowed. Signed by `keyFile`. */
  configure(keyFile: string, allowed: Address[]): Promise<Hex[]>;
  /** Credits to `receiver` held in quarantine in blocks [fromBlock, latest]; returns the next block to read from. */
  quarantinedSince(receiver: Address, fromBlock: number): Promise<{ events: Quarantined[]; next: number }>;
  isOpen(receiptId: Hex): Promise<boolean>;
  latestBlock(): Promise<number>;
  /** Releases the receipt to `to`, signed by `keyFile` (the receipt's authority); resolves once Claimed is on chain. */
  claim(keyFile: string, receipt: Receipt, to: Address): Promise<Hex>;
}

/** The receipt's id as ReceivePolicy computes it: keccak256(abi.encode(receipt)). */
export function receiptId(r: Receipt): Hex {
  return keccak256(encodeAbiParameters([{ type: "tuple", components: [
    { name: "nonce", type: "uint256" }, { name: "token", type: "address" }, { name: "originator", type: "address" },
    { name: "receiver", type: "address" }, { name: "authority", type: "address" }, { name: "amount", type: "uint256" }] }], [r]));
}

const GAS = 300_000n;

export class LiveReceivePolicy implements ReceivePolicyPort {
  async policyOf(account: Address): Promise<PolicyState> {
    const [allowlistOnly, tokenFilter, refusal, recovery, authority] = await publicClient().readContract({ address: RECEIVE_POLICY, abi: RECEIVE_POLICY_ABI, functionName: "policyOf", args: [account] });
    return { allowlistOnly, tokenFilter, refusal, recovery, authority };
  }

  senderAllowed(account: Address, sender: Address): Promise<boolean> {
    return publicClient().readContract({ address: RECEIVE_POLICY, abi: RECEIVE_POLICY_ABI, functionName: "senderAllowed", args: [account, sender] });
  }

  private async write(keyFile: string, functionName: "setPolicy" | "setAllowedSenders" | "claim", args: readonly unknown[]): Promise<Hex> {
    const pc = publicClient();
    const account = privateKeyToAccount(readKeyFile(keyFile).privateKey);
    const walletClient = createWalletClient({ account, chain: pc.chain, transport: custom(pc) });
    const { writeMip20Contract } = await import("@metalntwx/metal-ts");
    // Gas is paid in *USDZ from the signing wallet, like a transfer.
    const hash = await writeMip20Contract({ walletClient, publicClient: pc, abi: RECEIVE_POLICY_ABI, address: RECEIVE_POLICY, functionName, args,
      gasToken: USDZ, gasFallback: GAS, gasLimit: GAS, maxFeePerGas: 1n } as never);
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} ${hash} reverted`);
    return hash;
  }

  async configure(keyFile: string, allowed: Address[]): Promise<Hex[]> {
    return [
      await this.write(keyFile, "setAllowedSenders", [allowed, true]),
      await this.write(keyFile, "setPolicy", [true, false, QUARANTINE, RECEIVER, "0x0000000000000000000000000000000000000000"]),
    ];
  }

  async latestBlock(): Promise<number> {
    return Number(await publicClient().getBlockNumber());
  }

  /** Reads in ranges of 2,000 blocks (RPC endpoints cap a log query), at most 50 ranges a call; the rest next call. */
  async quarantinedSince(receiver: Address, fromBlock: number): Promise<{ events: Quarantined[]; next: number }> {
    const pc = publicClient();
    const latest = Number(await pc.getBlockNumber());
    const events: Quarantined[] = [];
    let from = fromBlock;
    for (let i = 0; i < 50 && from <= latest; i++) {
      const to = Math.min(latest, from + 1999);
      // The receiver is an indexed topic of Quarantined: only this wallet's events come back.
      const logs = await pc.getLogs({ address: RECEIVE_POLICY, event: RECEIVE_POLICY_ABI.find((x) => x.type === "event" && x.name === "Quarantined") as never, args: { receiver } as never, fromBlock: BigInt(from), toBlock: BigInt(to) });
      events.push(...parseEventLogs({ abi: RECEIVE_POLICY_ABI, eventName: "Quarantined", strict: true, logs })
        .filter((l) => l.args.receiver.toLowerCase() === receiver.toLowerCase())
        .map((l) => ({ receiptId: l.args.receiptId, receipt: { ...l.args.receipt }, reason: l.args.reason, tx: l.transactionHash!, logIndex: l.logIndex!, block: Number(l.blockNumber) })));
      from = to + 1;
    }
    return { events, next: from };
  }

  isOpen(id: Hex): Promise<boolean> {
    return publicClient().readContract({ address: RECEIVE_POLICY, abi: RECEIVE_POLICY_ABI, functionName: "open", args: [id] });
  }

  async claim(keyFile: string, receipt: Receipt, to: Address): Promise<Hex> {
    const hash = await this.write(keyFile, "claim", [receipt, to]);
    const logs = (await publicClient().getTransactionReceipt({ hash })).logs.filter((l) => l.address.toLowerCase() === RECEIVE_POLICY);
    const claimed = parseEventLogs({ abi: RECEIVE_POLICY_ABI, eventName: "Claimed", strict: true, logs });
    if (!claimed.some((c) => c.args.receiptId === receiptId(receipt) && c.args.to.toLowerCase() === to.toLowerCase())) throw new Error(`${hash} carries no Claimed event for this receipt`);
    return hash;
  }
}
