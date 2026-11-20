// The live ReceivePolicy reads (src/metal/receivePolicy.ts LiveReceivePolicy) against a stand-in node on this machine
// (test/support/rpcServer.ts): the policy and an allowed sender as the contract answers them, the latest block, whether
// a receipt is still open, and the credits held for one wallet, read in windows of 2,000 blocks from where the last read
// stopped, other wallets' credits left out. Nothing leaves this machine.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, type Address, type Hex } from "viem";
import { RECEIVE_POLICY, RECEIVE_POLICY_ABI, receiptId, type Receipt } from "../src/metal/receivePolicy.js";
import { serveRpc } from "./support/rpcServer.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const SENDER = "0x3333333333333333333333333333333333333333" as Address;
const receipt = (receiver: Address, nonce: bigint): Receipt => ({ nonce, token: "0x0000000000000000000000000000000000000099", originator: SENDER, receiver, authority: receiver, amount: 1_500_000n });
const RECEIPT_TUPLE = [{ type: "tuple", components: [
  { name: "nonce", type: "uint256" }, { name: "token", type: "address" }, { name: "originator", type: "address" },
  { name: "receiver", type: "address" }, { name: "authority", type: "address" }, { name: "amount", type: "uint256" }] }, { type: "uint8" }] as const;
const hex = (n: number) => `0x${n.toString(16)}`;

/** A Quarantined log as a node returns it. */
function quarantinedLog(r: Receipt, block: number, i: number) {
  const id = receiptId(r);
  return {
    address: RECEIVE_POLICY, blockNumber: hex(block), blockHash: `0x${"ab".repeat(32)}`, transactionHash: `0x${String(i).padStart(64, "0")}`, transactionIndex: "0x0", logIndex: hex(i), removed: false,
    topics: encodeEventTopics({ abi: RECEIVE_POLICY_ABI, eventName: "Quarantined", args: { receiptId: id, receiver: r.receiver, originator: r.originator } }),
    data: encodeAbiParameters(RECEIPT_TUPLE, [r, 2]),
  };
}

let node: Awaited<ReturnType<typeof serveRpc>>;
let ranges: [number, number][] = [];
let live: InstanceType<typeof import("../src/metal/receivePolicy.js").LiveReceivePolicy>;
const latest = 4500;
const held = [quarantinedLog(receipt(WALLET, 1n), 1200, 1), quarantinedLog(receipt(OTHER, 2n), 1300, 2), quarantinedLog(receipt(WALLET, 3n), 4400, 3)];

beforeAll(async () => {
  node = await serveRpc(async ({ method, params }) => {
    if (method === "eth_blockNumber") return hex(latest);
    if (method === "eth_chainId") return "0xf9d1";
    if (method === "eth_getLogs") {
      const f = (params as [{ fromBlock: Hex; toBlock: Hex }])[0];
      const [from, to] = [Number(f.fromBlock), Number(f.toBlock)];
      ranges.push([from, to]);
      return held.filter((l) => Number(l.blockNumber) >= from && Number(l.blockNumber) <= to);
    }
    if (method === "eth_call") {
      const { data } = (params as [{ data: Hex }])[0];
      const call = decodeFunctionData({ abi: RECEIVE_POLICY_ABI, data });
      if (call.functionName === "policyOf") return encodeFunctionResult({ abi: RECEIVE_POLICY_ABI, functionName: "policyOf", result: [true, false, 1, 1, call.args[0]] });
      if (call.functionName === "senderAllowed") return encodeFunctionResult({ abi: RECEIVE_POLICY_ABI, functionName: "senderAllowed", result: call.args[1] === SENDER });
      if (call.functionName === "open") return encodeFunctionResult({ abi: RECEIVE_POLICY_ABI, functionName: "open", result: call.args[0] === receiptId(receipt(WALLET, 1n)) });
    }
    throw new Error(`unexpected ${method}`);
  });
  vi.stubEnv("METAL_RPC_URL", node.url);
  vi.resetModules();
  const m = await import("../src/metal/receivePolicy.js");
  live = new m.LiveReceivePolicy();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await node.close();
});

describe("the live ReceivePolicy reads", () => {
  it("reads an account's policy and whether a sender is allowed", async () => {
    expect(await live.policyOf(WALLET)).toEqual({ allowlistOnly: true, tokenFilter: false, refusal: 1, recovery: 1, authority: WALLET });
    expect(await live.senderAllowed(WALLET, SENDER)).toBe(true);
    expect(await live.senderAllowed(WALLET, OTHER)).toBe(false);
  });

  it("reads the latest block and whether a receipt is still held", async () => {
    expect(await live.latestBlock()).toBe(latest);
    expect(await live.isOpen(receiptId(receipt(WALLET, 1n)))).toBe(true);
    expect(await live.isOpen(receiptId(receipt(WALLET, 3n)))).toBe(false);
  });

  it("reads the wallet's held credits in windows of 2,000 blocks up to the latest, leaving other wallets' out", async () => {
    ranges = [];
    const { events, next } = await live.quarantinedSince(WALLET, 1000);
    expect(ranges).toEqual([[1000, 2999], [3000, 4500]]);
    expect(next).toBe(latest + 1);
    expect(events.map((e) => [e.receipt.nonce, e.block, e.reason, e.logIndex])).toEqual([[1n, 1200, 2, 1], [3n, 4400, 2, 3]]);
    expect(events[0]!.receiptId).toBe(receiptId(receipt(WALLET, 1n)));
    expect(events[0]!.receipt).toEqual(receipt(WALLET, 1n));
    ranges = [];
    expect(await live.quarantinedSince(WALLET, latest + 1)).toEqual({ events: [], next: latest + 1 });
    expect(ranges).toEqual([]);
  });
});
