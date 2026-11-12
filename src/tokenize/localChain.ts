// An in-memory EVM (ethereumjs, cancun) behind the small EIP-1193 surface Purser's live client uses, so the stand-in
// run and the tests send the very same signed transactions and the very same requests a live run sends, with zero
// network. It answers eth_chainId, eth_getTransactionCount, eth_estimateGas, eth_sendRawTransaction,
// eth_getTransactionReceipt and eth_call; anything else is refused. Transactions are decoded and their sender
// recovered with viem; nonces must be in order.
//
// Only `npm run tokenize -- stand-in` and the tests load this file (and with it @ethereumjs, a dev dependency): the
// live commands never import it (test/tokenize-live.test.ts holds that).

import { createCustomCommon, Hardfork, Mainnet } from "@ethereumjs/common";
import { createEVM, type EVM } from "@ethereumjs/evm";
import { Account, createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { getContractAddress, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex, type TransactionSerialized } from "viem";
import { CHAIN_ID } from "../metal/network.js";
import type { Receipt, Request } from "./client.js";

export type { Receipt, Request };

export interface LocalChain {
  request: Request;
  /** Every method asked, in order (what a live run would have spent on its budget). */
  calls: string[];
  /** Execution gas (excluding the intrinsic part) of each transaction, by hash. */
  gas: Map<Hex, bigint>;
  /** The hash of every transaction the chain accepted, in order. */
  mined: Hex[];
  /**
   * Puts a deployed contract's code at another address, with fresh storage. The tests put the *USDZ stand-in at
   * Metal's own *USDZ address this way, so the unmodified command line runs against this chain.
   */
  cloneCode(from: Address, to: Address): Promise<void>;
}

/** What a transaction costs before it runs: 21,000, its data (4 per zero byte, 16 otherwise), and for a creation 32,000 plus 2 per word of init code. */
export function intrinsicGas(data: Hex, create: boolean): bigint {
  const bytes = hexToBytes(data);
  let g = 21_000n;
  for (const b of bytes) g += b === 0 ? 4n : 16n;
  if (create) g += 32_000n + 2n * BigInt(Math.ceil(bytes.length / 32));
  return g;
}

export async function localChain(chainId = CHAIN_ID): Promise<LocalChain> {
  const common = createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Cancun });
  const evm: EVM = await createEVM({ common });
  const nonces = new Map<string, number>();
  const receipts = new Map<Hex, Receipt>();
  const calls: string[] = [];
  const gas = new Map<Hex, bigint>();
  const mined: Hex[] = [];

  const setNonce = async (a: Address, n: number) => {
    const addr = createAddressFromString(a);
    const acct = (await evm.stateManager.getAccount(addr)) ?? new Account();
    acct.nonce = BigInt(n);
    await evm.stateManager.putAccount(addr, acct);
  };
  /**
   * A transaction's boundary, as a chain has it: every address and storage slot is cold again, a slot's "original"
   * value is its value now, and the sender and the target start warm (EIP-2929). Without this the EVM would carry
   * warm slots from one call into the next and measure too little gas.
   */
  const begin = async (from: Address, to?: Address | null) => {
    await evm.journal.cleanup();
    evm.stateManager.originalStorageCache.clear();
    evm.journal.addAlwaysWarmAddress(from.toLowerCase());
    if (to) evm.journal.addAlwaysWarmAddress(to.toLowerCase());
  };
  /** A read-only run: the state is put back afterwards. A revert throws as a node reports it (code 3, the revert data). */
  const dryRun = async (p: { from?: Address; to?: Address; data?: Hex }) => {
    const from = p.from ?? "0x0000000000000000000000000000000000000001";
    await begin(from, p.to);
    await evm.stateManager.checkpoint();
    try {
      const r = await evm.runCall({ caller: createAddressFromString(from), to: p.to ? createAddressFromString(p.to) : undefined, data: hexToBytes(p.data ?? "0x"), gasLimit: 30_000_000n });
      if (r.execResult.exceptionError) {
        const err = new Error(`execution reverted`) as Error & { data?: Hex; code?: number };
        err.code = 3;
        err.data = bytesToHex(r.execResult.returnValue) as Hex;
        throw err;
      }
      return r.execResult;
    } finally {
      await evm.stateManager.revert();
    }
  };

  /** A send the chain does not take, as a node reports it: a JSON-RPC error (code -32000) with the reason. */
  const refusal = (message: string) => Object.assign(new Error(message), { code: -32000 });

  const request: Request = async ({ method, params = [] }) => {
    calls.push(method);
    switch (method) {
      case "eth_chainId": return `0x${chainId.toString(16)}`;
      case "eth_getTransactionCount": return `0x${(nonces.get((params[0] as string).toLowerCase()) ?? 0).toString(16)}`;
      case "eth_getTransactionReceipt": return receipts.get(params[0] as Hex) ?? null;
      case "eth_call": return bytesToHex((await dryRun(params[0] as { from?: Address; to: Address; data: Hex })).returnValue);
      case "eth_estimateGas": {
        const p = params[0] as { from?: Address; to?: Address; data?: Hex };
        const r = await dryRun(p);
        return `0x${(r.executionGasUsed + intrinsicGas(p.data ?? "0x", !p.to)).toString(16)}`;
      }
      case "eth_sendRawTransaction": {
        const raw = params[0] as TransactionSerialized;
        const tx = parseTransaction(raw);
        if (tx.chainId !== chainId) throw refusal(`wrong chain id ${tx.chainId}`);
        const from = (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() as Address;
        const expected = nonces.get(from) ?? 0;
        const hash = keccak256(raw);
        if (tx.nonce !== expected) throw refusal(`nonce too ${(tx.nonce ?? 0) < expected ? "low" : "high"}: expected ${expected}, got ${tx.nonce}`);
        await begin(from, tx.to);
        await setNonce(from, expected);
        const r = await evm.runCall({
          caller: createAddressFromString(from), to: tx.to ? createAddressFromString(tx.to) : undefined,
          data: hexToBytes(tx.data ?? "0x"), gasLimit: tx.gas ?? 0n, value: tx.value ?? 0n,
        });
        nonces.set(from, expected + 1);
        await setNonce(from, expected + 1);
        const ok = !r.execResult.exceptionError;
        gas.set(hash, r.execResult.executionGasUsed);
        mined.push(hash);
        receipts.set(hash, {
          transactionHash: hash, status: ok ? "0x1" : "0x0", from, to: tx.to ?? null, blockNumber: `0x${mined.length.toString(16)}`,
          contractAddress: !tx.to && ok ? (r.createdAddress ? (r.createdAddress.toString() as Address) : getContractAddress({ from, nonce: BigInt(expected) })) : null,
          gasUsed: `0x${(r.execResult.executionGasUsed + intrinsicGas(tx.data ?? "0x", !tx.to)).toString(16)}`,
          logs: ok ? (r.execResult.logs ?? []).map(([a, topics, data]) => ({ address: bytesToHex(a) as Address, topics: topics.map((t) => bytesToHex(t) as Hex), data: bytesToHex(data) as Hex })) : [],
        });
        return hash;
      }
      default: throw new Error(`local chain: ${method} is not served`);
    }
  };
  const cloneCode = async (from: Address, to: Address) => {
    const code = await evm.stateManager.getCode(createAddressFromString(from));
    if (!code.length) throw new Error(`local chain: no code at ${from}`);
    await evm.stateManager.putAccount(createAddressFromString(to), new Account());
    await evm.stateManager.putCode(createAddressFromString(to), code);
  };
  return { request, calls, gas, mined, cloneCode };
}
