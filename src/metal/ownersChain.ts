// Metal testnet behind the owners call budget (src/metal/ownersBudget.ts). One request function, and everything on the
// owners path goes through it: Purser's own reads, sends and receipt polls, and the requests viem and the Metal SDK make
// when they are handed this client. So each request is in the log before it is sent, and the one over the budget never
// leaves. Built for a budget:
//   - a transaction is signed here, with the nonce and the gas given, and makes no request; its hash is known before it
//     is sent (the caller records it first), and the same call signed again with the same nonce is the same transaction;
//   - a receipt poll is one request (viem's waitForTransactionReceipt reads blocks and the transaction too);
//   - nothing is sent blind: a gas estimate the chain reverts stops the step with the account's own error, decoded.
// Over a stand-in request function (test/support/fakeMetal.ts) the same code runs with no network.

import {
  createPublicClient, createWalletClient, custom, decodeFunctionResult, defineChain, encodeFunctionData, erc20Abi, http, keccak256,
  type Abi, type Address, type Hex, type LocalAccount, type PublicClient,
} from "viem";
import { nodeSaid, revertReason, whyRefused } from "./accountErrors.js";
import { USDZ_TRANSFER } from "./chain.js";
import { CHAIN_ID, USDZ, rpcUrl } from "./network.js";
import type { CallBudget } from "./ownersBudget.js";

export type Rpc = (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;

export interface SignedTx { tx: Hex; raw: Hex; from: Address; nonce: number; gas: bigint }
export interface Receipt { ok: boolean; block: number; gasUsed: bigint }

/** The transaction is not in a block the node shows yet. It may still land: nothing is known, nothing is sent again by itself. */
export class NoReceiptYet extends Error {
  /** `nonceMoved`: the sender's nonce is past this transaction's, so it may be in a block whose receipt the node does not show yet. */
  constructor(readonly tx: Hex, more = "", readonly nonceMoved = false) { super(`no receipt yet for ${tx}${more ? `; ${more}` : ""}`); this.name = "NoReceiptYet"; }
}
/** The node answered the send with a refusal: the transaction is in no pool and can never land. */
export class NodeRefused extends Error {
  constructor(said: string) { super(`the node refused the transaction (${said}); it was not sent`); this.name = "NodeRefused"; }
}
/** The chain would revert the call, so it was not sent. The reason is the account's own error, decoded. */
export class ChainRefused extends Error {
  constructor(what: string, readonly reason: string) { super(`the chain would refuse ${what}: ${reason}; nothing was sent`); this.name = "ChainRefused"; }
}

/** Whether an error, however viem wrapped it, is the call budget stopping a request before it was sent. */
export function isBudgetStop(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 12; x = (x as { cause?: unknown }).cause, i++) if ((x as { name?: unknown }).name === "OwnersBudgetSpent") return true;
  return false;
}

/** A send the node answered with a JSON-RPC error whose words say the transaction can never land. Anything else stays in doubt. */
function refusedForGood(e: unknown): boolean {
  let answered = false;
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 12; x = (x as { cause?: unknown }).cause, i++) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === "number" && code !== -1 && code !== -32603) answered = true;
  }
  return answered && /nonce too (low|high)|insufficient funds|underpriced|intrinsic gas|gas limit|invalid sender|invalid signature|invalid chain|fee cap|max fee|not supported|invalid transaction|rejected/i.test(nodeSaid(e));
}

export interface OwnersChain {
  readonly budget: CallBudget;
  /** Names the step the requests that follow are logged under. */
  step(name: string): void;
  /** One JSON-RPC request: logged, counted, then sent. */
  readonly rpc: Rpc;
  /** Logs and counts a call made outside this client under the current step: a run of the metal-agent CLI (`cli:<command>`). */
  logged(method: string): void;
  /** viem over the same requests, for the SDK's own reads. Its chain-id question is answered here and is no request. */
  readonly client: PublicClient;
  /** The chain id the node itself reports (one request). */
  chainId(): Promise<number>;
  hasCode(address: Address): Promise<boolean>;
  /** The *USDZ balance, in base units. */
  balance(address: Address): Promise<bigint>;
  read(o: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  nonce(address: Address, tag: "pending" | "latest"): Promise<number>;
  /** The gas limit for a call: a fifth above the node's estimate. Throws ChainRefused when the chain would revert it. */
  gasFor(from: Address, to: Address, data: Hex, what: string): Promise<bigint>;
  /** Why the chain refuses a call, from one read-only call; null when it would pass. */
  why(from: Address, to: Address, data: Hex): Promise<string | null>;
  /** Signs a contract call (EIP-1559, 1 per gas). No request. */
  signCall(account: LocalAccount, to: Address, data: Hex, as: { nonce: number; gas: bigint }): Promise<SignedTx>;
  /** Signs a *USDZ transfer as Metal's own transaction type, gas paid in *USDZ (metal-ts). No request. */
  signTransfer(account: LocalAccount, to: Address, amount: bigint, as: { nonce: number }): Promise<SignedTx>;
  /** Sends signed bytes. Throws NodeRefused when the node says it can never land; `again` is a repeat of bytes sent before. */
  broadcast(signed: Pick<SignedTx, "raw">, again?: boolean): Promise<void>;
  /** One receipt read; null when the node shows none. */
  receipt(tx: Hex): Promise<Receipt | null>;
  /** Polls for the receipt, one read per poll. Throws NoReceiptYet when the polls run out. */
  wait(tx: Hex): Promise<Receipt>;
}

/** Metal makes about 13 blocks a second (measured 30 October), so a receipt is there within a poll or two. */
const POLLS_MS = [1_000, 2_000, 3_000, 4_000] as const;
/** How often a receipt is read at most before a step stops with NoReceiptYet. */
export const RECEIPT_POLLS = POLLS_MS.length;

export function ownersChain(o: { budget: CallBudget; rpc?: Rpc; pollsMs?: readonly number[]; sleep?: (ms: number) => Promise<void> }): OwnersChain {
  const inner: Rpc = o.rpc ?? (http(rpcUrl())({ chain: undefined, retryCount: 0 }).request as Rpc);
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let step = "owners";
  const rpc: Rpc = async (a) => {
    o.budget.count(a.method, step);
    return inner(a);
  };
  // The address is never used: every request goes through `rpc` above.
  const chain = defineChain({ id: CHAIN_ID, name: "Metal testnet", nativeCurrency: { name: "Gas", symbol: "GAS", decimals: 18 }, rpcUrls: { default: { http: ["http://localhost"] } } });
  const viaViem: Rpc = async (a) => (a.method === "eth_chainId" ? `0x${CHAIN_ID.toString(16)}` : rpc(a));
  const client = createPublicClient({ chain, transport: custom({ request: viaViem as never }, { retryCount: 0 }) }) as PublicClient;
  const call = (to: Address, data: Hex, from?: Address) => rpc({ method: "eth_call", params: [{ ...(from ? { from } : {}), to, data }, "latest"] }) as Promise<Hex>;

  const self: OwnersChain = {
    budget: o.budget,
    step: (name) => { step = name; },
    rpc,
    logged: (method) => o.budget.count(method, step),
    client,
    chainId: async () => Number(BigInt((await rpc({ method: "eth_chainId" })) as string)),
    hasCode: async (address) => {
      const c = await rpc({ method: "eth_getCode", params: [address, "latest"] });
      return typeof c === "string" && c !== "0x";
    },
    read: async ({ address, abi, functionName, args = [] }) =>
      decodeFunctionResult({ abi, functionName, data: await call(address, encodeFunctionData({ abi, functionName, args } as never)) } as never),
    balance: async (address) => (await self.read({ address: USDZ, abi: erc20Abi as Abi, functionName: "balanceOf", args: [address] })) as bigint,
    nonce: async (address, tag) => Number(BigInt((await rpc({ method: "eth_getTransactionCount", params: [address, tag] })) as string)),
    async gasFor(from, to, data, what) {
      try {
        // Without fees: Metal refuses a fee-carrying estimate from a sender that holds no gas token (metal-pay).
        return (BigInt((await rpc({ method: "eth_estimateGas", params: [{ from, to, data }] })) as string) * 6n) / 5n;
      } catch (e) {
        if (isBudgetStop(e)) throw e;
        const why = revertReason(e);
        if (why !== null) throw new ChainRefused(what, why);
        throw new Error(`the gas estimate for ${what} failed (${nodeSaid(e)}); nothing was sent`, { cause: e });
      }
    },
    why: (from, to, data) => whyRefused(() => call(to, data, from)),
    async signCall(account, to, data, as) {
      const raw = await account.signTransaction({ type: "eip1559", chainId: CHAIN_ID, nonce: as.nonce, to, data, gas: as.gas, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, value: 0n });
      return { tx: keccak256(raw), raw, from: account.address, nonce: as.nonce, gas: as.gas };
    },
    async signTransfer(account, to, amount, as) {
      const { signMip20Contract } = await import("@metalntwx/metal-ts");
      const walletClient = createWalletClient({ account, chain, transport: custom({ request: async () => { throw new Error("signing makes no request"); } }) });
      // metal-ts asks its client for the chain id and the sender's nonce; both are given here, so it asks no node.
      const s = await signMip20Contract({ walletClient, publicClient: { getChainId: async () => CHAIN_ID, getTransactionCount: async () => as.nonce }, ...USDZ_TRANSFER, args: [to, amount] } as never);
      return { tx: s.txHash, raw: s.raw, from: account.address, nonce: as.nonce, gas: USDZ_TRANSFER.gasLimit };
    },
    async broadcast(signed, again = false) {
      try {
        await rpc({ method: "eth_sendRawTransaction", params: [signed.raw] });
      } catch (e) {
        if (isBudgetStop(e)) throw e;
        const said = nodeSaid(e);
        // The node has these bytes already, or (for a repeat) has them in a block: sent, as far as this call goes.
        if (/already known|known transaction|already imported/i.test(said) || (again && /nonce too low/i.test(said))) return;
        if (!again && refusedForGood(e)) throw new NodeRefused(said);
        throw e;
      }
    },
    async receipt(tx) {
      const r = (await rpc({ method: "eth_getTransactionReceipt", params: [tx] })) as { status: string; blockNumber: string; gasUsed: string } | null;
      return r ? { ok: r.status === "0x1", block: Number(BigInt(r.blockNumber)), gasUsed: BigInt(r.gasUsed) } : null;
    },
    async wait(tx) {
      for (const ms of o.pollsMs ?? POLLS_MS) {
        await sleep(ms);
        const r = await self.receipt(tx);
        if (r) return r;
      }
      throw new NoReceiptYet(tx);
    },
  };
  return self;
}
