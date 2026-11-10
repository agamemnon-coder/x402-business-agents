// An in-memory EVM (ethereumjs, cancun) behind the small EIP-1193 surface Purser's live client uses, so the stand-in
// run and the tests send the very same signed transactions a live run sends, with zero network. It answers
// eth_chainId, eth_getTransactionCount, eth_sendRawTransaction, eth_getTransactionReceipt and eth_call; anything else
// is refused. Transactions are decoded and their sender recovered with viem; nonces must be in order.

import { createCustomCommon, Hardfork, Mainnet } from "@ethereumjs/common";
import { createEVM, type EVM } from "@ethereumjs/evm";
import { Account, createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { getContractAddress, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex, type TransactionSerialized } from "viem";
import { CHAIN_ID } from "../metal/network.js";

export interface Receipt { transactionHash: Hex; status: "0x1" | "0x0"; contractAddress: Address | null; gasUsed: Hex; logs: { address: Address; topics: Hex[]; data: Hex }[]; from: Address; to: Address | null }
export type Request = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

export interface LocalChain {
  request: Request;
  /** Every method asked, in order (what a live run would have spent on its budget). */
  calls: string[];
  /** Execution gas (excluding the intrinsic part) of each transaction, by hash. */
  gas: Map<Hex, bigint>;
}

export async function localChain(chainId = CHAIN_ID): Promise<LocalChain> {
  const common = createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Cancun });
  const evm: EVM = await createEVM({ common });
  const nonces = new Map<string, number>();
  const receipts = new Map<Hex, Receipt>();
  const calls: string[] = [];
  const gas = new Map<Hex, bigint>();

  const setNonce = async (a: Address, n: number) => {
    const addr = createAddressFromString(a);
    const acct = (await evm.stateManager.getAccount(addr)) ?? new Account();
    acct.nonce = BigInt(n);
    await evm.stateManager.putAccount(addr, acct);
  };

  const request: Request = async ({ method, params = [] }) => {
    calls.push(method);
    switch (method) {
      case "eth_chainId": return `0x${chainId.toString(16)}`;
      case "eth_getTransactionCount": return `0x${(nonces.get((params[0] as string).toLowerCase()) ?? 0).toString(16)}`;
      case "eth_getTransactionReceipt": return receipts.get(params[0] as Hex) ?? null;
      case "eth_call": {
        const p = params[0] as { from?: Address; to: Address; data: Hex };
        await evm.stateManager.checkpoint();
        try {
          const r = await evm.runCall({ caller: createAddressFromString(p.from ?? "0x0000000000000000000000000000000000000001"), to: createAddressFromString(p.to), data: hexToBytes(p.data), gasLimit: 30_000_000n });
          if (r.execResult.exceptionError) {
            const err = new Error(`execution reverted`) as Error & { data?: Hex; code?: number };
            err.code = 3;
            err.data = bytesToHex(r.execResult.returnValue) as Hex;
            throw err;
          }
          return bytesToHex(r.execResult.returnValue);
        } finally {
          await evm.stateManager.revert();
        }
      }
      case "eth_sendRawTransaction": {
        const raw = params[0] as TransactionSerialized;
        const tx = parseTransaction(raw);
        if (tx.chainId !== chainId) throw new Error(`wrong chain id ${tx.chainId}`);
        const from = (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() as Address;
        const expected = nonces.get(from) ?? 0;
        if (tx.nonce !== expected) throw new Error(`nonce too ${(tx.nonce ?? 0) < expected ? "low" : "high"}: expected ${expected}, got ${tx.nonce}`);
        const hash = keccak256(raw);
        await setNonce(from, expected);
        const r = await evm.runCall({
          caller: createAddressFromString(from), to: tx.to ? createAddressFromString(tx.to) : undefined,
          data: hexToBytes(tx.data ?? "0x"), gasLimit: tx.gas ?? 0n, value: tx.value ?? 0n,
        });
        nonces.set(from, expected + 1);
        await setNonce(from, expected + 1);
        const ok = !r.execResult.exceptionError;
        gas.set(hash, r.execResult.executionGasUsed);
        receipts.set(hash, {
          transactionHash: hash, status: ok ? "0x1" : "0x0", from, to: tx.to ?? null,
          contractAddress: !tx.to && ok ? (r.createdAddress ? (r.createdAddress.toString() as Address) : getContractAddress({ from, nonce: BigInt(expected) })) : null,
          gasUsed: `0x${r.execResult.executionGasUsed.toString(16)}`,
          logs: ok ? (r.execResult.logs ?? []).map(([a, topics, data]) => ({ address: bytesToHex(a) as Address, topics: topics.map((t) => bytesToHex(t) as Hex), data: bytesToHex(data) as Hex })) : [],
        });
        return hash;
      }
      default: throw new Error(`local chain: ${method} is not served`);
    }
  };
  return { request, calls, gas };
}
