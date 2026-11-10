// The transactions of Purser's invoice token, over any EIP-1193 request function: the in-memory chain
// (src/tokenize/localChain.ts) for the stand-in and the tests, Metal testnet behind a call budget for a live run.
// Every transaction is signed locally first and its hash handed to `onSigned` before it is sent, so a run stopped
// halfway (budget, network) still knows what it sent. Gas limits are fixed (no estimate calls); maxFee 1, as in
// Purser's other Metal runs.

import {
  BaseError, ContractFunctionRevertedError, decodeErrorResult, decodeFunctionResult, encodeDeployData, encodeFunctionData, erc20Abi, http, keccak256, stringToHex,
  type Abi, type Address, type Hex, type LocalAccount,
} from "viem";
import type { Receipt, Request } from "./localChain.js";
import { loadContract } from "./compile.js";

/** Fixed gas limits, each at least twice what the in-memory run measures (test/tokenize-flow.test.ts checks this). */
export const GAS = { deploy: 3_500_000n, mint: 700_000n, offer: 150_000n, approve: 120_000n, accept: 250_000n, settle: 250_000n, standInToken: 1_500_000n, standInMint: 120_000n } as const;

export class TxReverted extends Error {
  constructor(readonly label: string, readonly hash: Hex) { super(`${label} ${hash} reverted on chain`); this.name = "TxReverted"; }
}

export interface Sent { label: string; hash: Hex; from: Address; receipt: Receipt }

export interface TxClientOptions {
  request: Request;
  chainId: number;
  /** Called with the hash of a signed transaction before it is sent. */
  onSigned?: (label: string, hash: Hex, from: Address) => void;
  pollMs?: number;
  polls?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface TxClient {
  send(label: string, from: LocalAccount, to: Address | null, data: Hex, gas: bigint): Promise<Sent>;
  read<T>(to: Address, abi: Abi, functionName: string, args?: readonly unknown[], from?: Address): Promise<T>;
  /** A read-only run of a transaction: null when it would succeed, else the contract's error name. Nothing is sent. */
  simulate(from: Address, to: Address, abi: Abi, data: Hex): Promise<string | null>;
}

export function txClient(o: TxClientOptions): TxClient {
  const nonces = new Map<string, number>();
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const nonceOf = async (a: Address) => {
    const k = a.toLowerCase();
    if (!nonces.has(k)) nonces.set(k, Number(BigInt((await o.request({ method: "eth_getTransactionCount", params: [a, "pending"] })) as string)));
    return nonces.get(k)!;
  };
  return {
    async send(label, from, to, data, gas) {
      const nonce = await nonceOf(from.address);
      const serialized = await from.signTransaction({ type: "eip1559", chainId: o.chainId, nonce, to: to ?? undefined, data, gas, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, value: 0n });
      const hash = keccak256(serialized);
      o.onSigned?.(label, hash, from.address);
      try {
        const sent = (await o.request({ method: "eth_sendRawTransaction", params: [serialized] })) as Hex;
        if (sent.toLowerCase() !== hash.toLowerCase()) throw new Error(`${label}: the node returned ${sent}, not the signed ${hash}`);
      } catch (e) {
        nonces.delete(from.address.toLowerCase()); // read the nonce again next time: the node may or may not have it
        throw e;
      }
      nonces.set(from.address.toLowerCase(), nonce + 1);
      for (let i = 0; i < (o.polls ?? 8); i++) {
        const receipt = (await o.request({ method: "eth_getTransactionReceipt", params: [hash] })) as Receipt | null;
        if (receipt) {
          if (receipt.status !== "0x1") throw new TxReverted(label, hash);
          return { label, hash, from: from.address, receipt };
        }
        await sleep(o.pollMs ?? 2_500);
      }
      throw new Error(`${label} ${hash}: no receipt yet (it may still land; check before sending anything again)`);
    },
    async read(to, abi, functionName, args = [], from) {
      const data = encodeFunctionData({ abi, functionName, args } as never);
      const out = (await o.request({ method: "eth_call", params: [{ to, data, ...(from ? { from } : {}) }, "latest"] })) as Hex;
      return decodeFunctionResult({ abi, functionName, data: out } as never) as never;
    },
    async simulate(from, to, abi, data) {
      try {
        await o.request({ method: "eth_call", params: [{ from, to, data }, "latest"] });
        return null;
      } catch (e) {
        if (/budget/i.test((e as Error).message)) throw e;
        const revertData = errorData(e);
        if (!revertData) {
          if (/revert/i.test((e as Error).message)) return "reverted";
          throw e;
        }
        try { return decodeErrorResult({ abi, data: revertData }).errorName; } catch { return "reverted"; }
      }
    },
  };
}

function errorData(e: unknown): Hex | null {
  const direct = (e as { data?: unknown }).data;
  if (typeof direct === "string" && direct.startsWith("0x") && direct.length >= 10) return direct as Hex;
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (rev?.raw) return rev.raw;
    const inner = e.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: string } | null;
    if (inner?.data?.startsWith("0x")) return inner.data as Hex;
  }
  return null;
}

/** An EIP-1193 request over HTTP that refuses past `max` calls and logs each method; eth_chainId is answered locally. */
export function budgetedHttp(url: string, chainId: number, max: number, onCall: (method: string) => void = () => {}): { request: Request; used: () => number } {
  let used = 0;
  const inner = http(url)({ chain: undefined, retryCount: 0 });
  return {
    used: () => used,
    request: async (args) => {
      if (args.method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (used >= max) throw new Error(`Metal RPC budget of ${max} calls reached; stopping`);
      used++;
      onCall(args.method);
      return inner.request(args as never);
    },
  };
}

// ---- The invoice token's calls -------------------------------------------------------------------------------------

export interface OnChainInvoice {
  documentHash: Hex;
  termsHash: Hex;
  amountMinor: bigint;
  currency: Hex;
  faceValue: bigint;
  dueDate: bigint;
  debtorRef: Hex;
  creditorRef: Hex;
  payer: Address;
  settled: boolean;
}

export const currencyBytes3 = (code: string): Hex => {
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`not an ISO 4217 code: ${code}`);
  return stringToHex(code, { size: 3 });
};

const token = () => loadContract("PurserInvoiceToken");
const standIn = () => loadContract("TestUsdStandIn");

export const tokenIdOf = (documentHash: Hex): bigint => BigInt(documentHash);

export function invoiceTokenCalls(c: TxClient) {
  const abi = token().abi;
  return {
    abi,
    async deploy(issuer: LocalAccount, settlementToken: Address): Promise<{ address: Address; sent: Sent }> {
      const sent = await c.send("deploy PurserInvoiceToken", issuer, null, encodeDeployData({ abi, bytecode: token().bytecode, args: [settlementToken, issuer.address] }), GAS.deploy);
      if (!sent.receipt.contractAddress) throw new Error("deploy: no contract address in the receipt");
      return { address: sent.receipt.contractAddress, sent };
    },
    mintData: (creditor: Address, inv: OnChainInvoice) => encodeFunctionData({ abi, functionName: "mint", args: [creditor, inv] as never }),
    mint: (issuer: LocalAccount, contract: Address, creditor: Address, inv: OnChainInvoice) =>
      c.send("mint the invoice token", issuer, contract, encodeFunctionData({ abi, functionName: "mint", args: [creditor, inv] as never }), GAS.mint),
    offerData: (tokenId: bigint, financier: Address, price: bigint) => encodeFunctionData({ abi, functionName: "offerFinancing", args: [tokenId, financier, price] }),
    offer: (holder: LocalAccount, contract: Address, tokenId: bigint, financier: Address, price: bigint) =>
      c.send("offer the token to the financier", holder, contract, encodeFunctionData({ abi, functionName: "offerFinancing", args: [tokenId, financier, price] }), GAS.offer),
    acceptData: (tokenId: bigint, price: bigint) => encodeFunctionData({ abi, functionName: "acceptFinancing", args: [tokenId, price] }),
    accept: (financier: LocalAccount, contract: Address, tokenId: bigint, price: bigint) =>
      c.send("the financier pays the advance and takes the token", financier, contract, encodeFunctionData({ abi, functionName: "acceptFinancing", args: [tokenId, price] }), GAS.accept),
    settleData: (tokenId: bigint) => encodeFunctionData({ abi, functionName: "settle", args: [tokenId] }),
    settle: (payer: LocalAccount, contract: Address, tokenId: bigint) =>
      c.send("the debtor settles: face value to the holder", payer, contract, encodeFunctionData({ abi, functionName: "settle", args: [tokenId] }), GAS.settle),
    approve: (owner: LocalAccount, settlementToken: Address, spender: Address, amount: bigint, label: string) =>
      c.send(label, owner, settlementToken, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }), GAS.approve),
    invoiceOf: (contract: Address, tokenId: bigint) => c.read<OnChainInvoice>(contract, abi, "invoiceOf", [tokenId]),
    ownerOf: (contract: Address, tokenId: bigint) => c.read<Address>(contract, abi, "ownerOf", [tokenId]),
    balanceOf: (settlementToken: Address, who: Address) => c.read<bigint>(settlementToken, erc20Abi as Abi, "balanceOf", [who]),
    simulate: (from: Address, contract: Address, data: Hex) => c.simulate(from, contract, abi, data),
  };
}

/** The in-memory *USDZ stand-in: deploy it and mint test money. Never used against a network. */
export function standInTokenCalls(c: TxClient) {
  const a = standIn();
  return {
    async deploy(from: LocalAccount): Promise<Address> {
      const s = await c.send("deploy the *USDZ stand-in (in memory)", from, null, encodeDeployData({ abi: a.abi, bytecode: a.bytecode }), GAS.standInToken);
      return s.receipt.contractAddress!;
    },
    mint: (from: LocalAccount, tokenAddr: Address, to: Address, amount: bigint) =>
      c.send("mint stand-in test money", from, tokenAddr, encodeFunctionData({ abi: a.abi, functionName: "mint", args: [to, amount] }), GAS.standInMint),
  };
}
