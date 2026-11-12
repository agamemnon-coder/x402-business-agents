// The transactions of Purser's invoice token, over any EIP-1193 request function: the in-memory chain
// (src/tokenize/localChain.ts, loaded only by the stand-in and the tests) or Metal testnet behind a call budget.
//
// Nothing is sent twice, and a stopped step resumes. Every transaction has a key in the run's journal (the run's own
// ledger, src/tokenize/ledger.ts). It is signed locally, and its hash and its signed bytes are written to the journal
// before it is sent (as src/metal/hold.ts hands the hash to onSigned before send). On a re-run, a key the journal
// knows is never signed again: a finished one is answered from the journal with no request at all; an unfinished one
// first has its receipt read, and only if there is none are the very same signed bytes sent again (same nonce, same
// hash, so they cannot execute twice).
//
// Gas (docs/tokenize.md, "Gas"): a call to Purser's own contract asks the node first (eth_estimateGas, as Purser's
// working contract runs on Metal do in src/cli/passkeyOwners.ts and src/cli/compliancePolicy.ts) and adds half, never
// below the fixed floor; an estimate that reverts stops the step before anything is signed. A direct call to *USDZ
// uses the limits Purser's working MIP20 calls use (src/metal/chain.ts, src/metal/hold.ts), with no estimate. maxFee 1,
// as in Purser's other Metal runs.

import {
  BaseError, ContractFunctionRevertedError, decodeErrorResult, decodeFunctionResult, encodeDeployData, encodeFunctionData, erc20Abi, http, keccak256, stringToHex,
  type Abi, type Address, type Hex, type LocalAccount,
} from "viem";
import { loadContract } from "./compile.js";

export interface Receipt { transactionHash: Hex; status: "0x1" | "0x0"; contractAddress: Address | null; gasUsed: Hex; blockNumber?: Hex; logs: { address: Address; topics: Hex[]; data: Hex }[]; from: Address; to: Address | null }
export type Request = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

/**
 * Gas limits. For Purser's own contract (deploy, mint, offer, accept, settle) these are floors under the node's
 * estimate, each at least twice what the in-memory run measures (test/tokenize.test.ts checks this). For direct calls
 * to *USDZ they are the limits themselves: `transfer` 200,000 as src/metal/chain.ts transferUsdz, `approve` 300,000 as
 * the approve in src/metal/hold.ts (both ran on Metal testnet).
 */
export const GAS = { deploy: 3_500_000n, mint: 700_000n, offer: 200_000n, approve: 300_000n, accept: 400_000n, settle: 400_000n, transfer: 200_000n, standInToken: 1_500_000n, standInMint: 120_000n } as const;
/** What is added to the node's estimate: half again (Purser's other Metal runs add a fifth; gas is paid at 1 wei). */
export const ESTIMATE_MARGIN = { num: 3n, den: 2n } as const;

export class TxReverted extends Error {
  constructor(readonly label: string, readonly hash: Hex) { super(`${label} ${hash} reverted on chain`); this.name = "TxReverted"; }
}
/** A signed, recorded transaction with no receipt yet. Nothing new is signed for its step until it has one. */
export class TxUnresolved extends Error {
  constructor(readonly label: string, readonly hash: Hex, readonly note = "") {
    super(`${label} ${hash}: no receipt yet${note ? ` (${note})` : ""}. It is recorded; run the command again: it reads the receipt first and sends nothing new`);
    this.name = "TxUnresolved";
  }
}
/** The node says this transaction would revert. Nothing was signed or sent. */
export class WouldRevert extends Error {
  constructor(readonly label: string, readonly reason: string) { super(`${label}: the chain would refuse it (${reason}); nothing signed, nothing sent`); this.name = "WouldRevert"; }
}
export class BudgetReached extends Error {
  constructor(message: string) { super(message); this.name = "BudgetReached"; }
}

/** What the node itself said, in one line: never viem's full message, which quotes the RPC URL and the request. */
export function nodeSays(e: unknown): string {
  const x = e as { details?: unknown; shortMessage?: unknown; message?: unknown };
  const s = typeof x.details === "string" && x.details ? x.details : typeof x.shortMessage === "string" && x.shortMessage ? x.shortMessage : String(x.message ?? e);
  return s.split("\n")[0]!.slice(0, 200);
}

export interface TxRequest {
  /** This transaction's name in the run's journal: one transaction per key, ever. */
  key: string;
  label: string;
  from: LocalAccount;
  to: Address | null;
  data: Hex;
  /** With `estimate`: the least the gas limit may be. Without: the gas limit. */
  gas: bigint;
  /** Ask the node what it needs (one eth_estimateGas) and add the margin. Off for direct calls to *USDZ. */
  estimate: boolean;
  /** To name a revert the estimate reports. */
  abi?: Abi;
}

export interface Sent {
  key: string;
  label: string;
  hash: Hex;
  from: Address;
  receipt: Receipt;
  /** sent: signed and sent now. resumed: recorded earlier, its receipt read now. recorded: finished earlier, no request made. */
  how: "sent" | "resumed" | "recorded";
}

export interface JournalRow { key: string; label: string; hash: Hex; raw: Hex; from: Address; nonce: number; gas: bigint; status: "signed" | "success" | "reverted"; receipt: Receipt | null }
/** The run's own record of its transactions (src/tokenize/ledger.ts). */
export interface TxJournal {
  /** The latest transaction recorded for this key. */
  last(key: string): JournalRow | undefined;
  /** Called with a signed transaction before it is sent. */
  signed(row: Omit<JournalRow, "status" | "receipt">): void;
  done(hash: Hex, status: "success" | "reverted", receipt: Receipt): void;
}

export interface TxClientOptions {
  request: Request;
  chainId: number;
  journal?: TxJournal;
  /** Called with the hash of a signed transaction before it is sent. */
  onSigned?: (label: string, hash: Hex, from: Address) => void;
  /** false: no estimate calls at all; every limit is its fixed value (TOKENIZE_GAS=fixed). */
  estimate?: boolean;
  /** How many requests the budget still allows. A transaction is signed only when at least two are left: the send and one receipt read. */
  room?: () => number;
  /** Allow a new transaction for a key whose last one reverted on chain (TOKENIZE_RESEND_REVERTED=yes). */
  resendReverted?: boolean;
  pollMs?: number;
  polls?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface TxClient {
  send(t: TxRequest): Promise<Sent>;
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
  const receiptOf = async (hash: Hex) => (await o.request({ method: "eth_getTransactionReceipt", params: [hash] })) as Receipt | null;
  /** One receipt read per poll, after a wait: the first read usually finds it. */
  const poll = async (hash: Hex) => {
    for (let i = 0; i < (o.polls ?? 8); i++) {
      await sleep(o.pollMs ?? 2_500);
      const receipt = await receiptOf(hash);
      if (receipt) return receipt;
    }
    return null;
  };
  const finish = (t: { key: string; label: string }, hash: Hex, from: Address, receipt: Receipt, how: Sent["how"]): Sent => {
    const ok = receipt.status === "0x1";
    o.journal?.done(hash, ok ? "success" : "reverted", receipt);
    if (!ok) throw new TxReverted(t.label, hash);
    return { key: t.key, label: t.label, hash, from, receipt, how };
  };
  /** A transaction the journal knows but has no receipt for: its receipt first; without one, the same bytes again. */
  const resume = async (t: TxRequest, prior: JournalRow): Promise<Sent> => {
    let receipt = await receiptOf(prior.hash);
    let note = "";
    if (!receipt) {
      try { await o.request({ method: "eth_sendRawTransaction", params: [prior.raw] }); } catch (e) {
        if (e instanceof BudgetReached) throw e;
        note = `sending the same signed bytes again, the node said: ${nodeSays(e)}`; // "already known" or "nonce too low" when it is already there
      }
      receipt = await poll(prior.hash);
    }
    if (!receipt) throw new TxUnresolved(t.label, prior.hash, note);
    return finish(t, prior.hash, prior.from, receipt, "resumed");
  };
  return {
    async send(t) {
      const prior = o.journal?.last(t.key);
      if (prior) {
        if (prior.status === "success") {
          if (!prior.receipt) throw new Error(`${t.label}: the journal marks ${prior.hash} done but holds no receipt; nothing sent`);
          return { key: t.key, label: t.label, hash: prior.hash, from: prior.from, receipt: prior.receipt, how: "recorded" };
        }
        if (prior.status === "signed") return resume(t, prior);
        // Reverted on chain: a new transaction only on an explicit decision.
        if (!o.resendReverted) throw new TxReverted(t.label, prior.hash);
      }

      let gas = t.gas;
      if (t.estimate && o.estimate !== false) {
        let estimated: bigint;
        try {
          estimated = BigInt((await o.request({ method: "eth_estimateGas", params: [{ from: t.from.address, ...(t.to ? { to: t.to } : {}), data: t.data }] })) as string);
        } catch (e) {
          if (e instanceof BudgetReached) throw e;
          const why = revertOf(e, t.abi);
          if (why) throw new WouldRevert(t.label, why);
          throw e;
        }
        const withMargin = (estimated * ESTIMATE_MARGIN.num) / ESTIMATE_MARGIN.den;
        if (withMargin > gas) gas = withMargin;
      }
      const nonce = await nonceOf(t.from.address);
      if (o.room && o.room() < 2) throw new BudgetReached(`${t.label}: fewer than two requests left in the budget (the send and one receipt read); nothing signed, nothing sent`);
      const serialized = await t.from.signTransaction({ type: "eip1559", chainId: o.chainId, nonce, to: t.to ?? undefined, data: t.data, gas, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, value: 0n });
      const hash = keccak256(serialized);
      o.journal?.signed({ key: t.key, label: t.label, hash, raw: serialized, from: t.from.address, nonce, gas });
      o.onSigned?.(t.label, hash, t.from.address);
      try {
        const sent = (await o.request({ method: "eth_sendRawTransaction", params: [serialized] })) as Hex;
        if (sent.toLowerCase() !== hash.toLowerCase()) throw new Error(`the node returned ${sent}, not the signed ${hash}`);
      } catch (e) {
        nonces.delete(t.from.address.toLowerCase()); // read the nonce again next time: the node may or may not have it
        if (e instanceof BudgetReached) throw e;
        throw new TxUnresolved(t.label, hash, `the send failed: ${nodeSays(e)}`);
      }
      nonces.set(t.from.address.toLowerCase(), nonce + 1);
      const receipt = await poll(hash);
      if (!receipt) throw new TxUnresolved(t.label, hash);
      return finish(t, hash, t.from.address, receipt, "sent");
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
        if (e instanceof BudgetReached) throw e;
        const why = revertOf(e, abi);
        if (!why) throw e;
        return why;
      }
    },
  };
}

/** The contract's error name when `e` is a revert (or "reverted" when it has no name); null when it is anything else. */
function revertOf(e: unknown, abi?: Abi): string | null {
  const data = errorData(e);
  if (!data) return /revert/i.test(`${nodeSays(e)} ${String((e as Error).message ?? "")}`) ? "reverted" : null;
  if (!abi) return "reverted";
  try { return decodeErrorResult({ abi, data }).errorName; } catch { return "reverted"; }
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

// ---- The call budget -----------------------------------------------------------------------------------------------

export interface CallCount { used: number; max: number; running: number; total: number }
export interface BudgetOptions {
  chainId: number;
  /** This command's own budget (TOKENIZE_CALL_BUDGET). */
  max: number;
  /** The whole run's budget (TOKENIZE_CALL_BUDGET_TOTAL), held against `logged()` before every request. */
  total: number;
  /** How many requests the call log holds so far, over all commands. */
  logged: () => number;
  /** Called before each request goes out, with the counters as they stand with this one. */
  onCall: (method: string, n: CallCount) => void;
  /** true: eth_chainId goes to the node and is counted (preflight); otherwise it is answered here. */
  askChainId?: boolean;
}

/** An EIP-1193 request that refuses past either budget before anything goes out, and logs each request first. */
export function budgeted(inner: Request, b: BudgetOptions): { request: Request; used: () => number; room: () => number } {
  let used = 0;
  return {
    used: () => used,
    room: () => Math.max(0, Math.min(b.max - used, b.total - b.logged())),
    request: async (args) => {
      if (args.method === "eth_chainId" && !b.askChainId) return `0x${b.chainId.toString(16)}`;
      if (used >= b.max) throw new BudgetReached(`Metal RPC budget of ${b.max} calls for this command reached; stopping`);
      const running = b.logged();
      if (running >= b.total) throw new BudgetReached(`Metal RPC budget of ${b.total} calls for the whole run reached (${running} in the call log); stopping`);
      used++;
      b.onCall(args.method, { used, max: b.max, running: running + 1, total: b.total });
      return inner(args);
    },
  };
}

/** Metal's RPC over HTTP, one attempt per request (a retry would be a second, uncounted call). */
export function httpRequest(url: string): Request {
  const t = http(url, { retryCount: 0 })({ chain: undefined, retryCount: 0 });
  return (args) => t.request(args as never);
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

/** The journal keys of the run's transactions, in order. The four funding transfers are `fund-<role>`. */
export const TX_KEYS = ["deploy", "mint", "offer", "financier-approve", "accept", "payer-approve", "settle"] as const;
export type TxKey = (typeof TX_KEYS)[number];

export function invoiceTokenCalls(c: TxClient) {
  const abi = token().abi;
  const own = (key: string, label: string, from: LocalAccount, to: Address | null, data: Hex, gas: bigint) => c.send({ key, label, from, to, data, gas, estimate: true, abi });
  return {
    abi,
    async deploy(issuer: LocalAccount, settlementToken: Address): Promise<{ address: Address; sent: Sent }> {
      const sent = await own("deploy", "deploy PurserInvoiceToken", issuer, null, encodeDeployData({ abi, bytecode: token().bytecode, args: [settlementToken, issuer.address] }), GAS.deploy);
      if (!sent.receipt.contractAddress) throw new Error("deploy: no contract address in the receipt");
      return { address: sent.receipt.contractAddress, sent };
    },
    mintData: (creditor: Address, inv: OnChainInvoice) => encodeFunctionData({ abi, functionName: "mint", args: [creditor, inv] as never }),
    mint: (issuer: LocalAccount, contract: Address, creditor: Address, inv: OnChainInvoice) =>
      own("mint", "mint the invoice token", issuer, contract, encodeFunctionData({ abi, functionName: "mint", args: [creditor, inv] as never }), GAS.mint),
    offerData: (tokenId: bigint, financier: Address, price: bigint) => encodeFunctionData({ abi, functionName: "offerFinancing", args: [tokenId, financier, price] }),
    offer: (holder: LocalAccount, contract: Address, tokenId: bigint, financier: Address, price: bigint) =>
      own("offer", "offer the token to the financier", holder, contract, encodeFunctionData({ abi, functionName: "offerFinancing", args: [tokenId, financier, price] }), GAS.offer),
    acceptData: (tokenId: bigint, price: bigint) => encodeFunctionData({ abi, functionName: "acceptFinancing", args: [tokenId, price] }),
    accept: (financier: LocalAccount, contract: Address, tokenId: bigint, price: bigint) =>
      own("accept", "the financier pays the advance and takes the token", financier, contract, encodeFunctionData({ abi, functionName: "acceptFinancing", args: [tokenId, price] }), GAS.accept),
    settleData: (tokenId: bigint) => encodeFunctionData({ abi, functionName: "settle", args: [tokenId] }),
    settle: (payer: LocalAccount, contract: Address, tokenId: bigint) =>
      own("settle", "the debtor settles: face value to the holder", payer, contract, encodeFunctionData({ abi, functionName: "settle", args: [tokenId] }), GAS.settle),
    /** A direct call to the settlement token (*USDZ live): the fixed limit, no estimate. */
    approve: (owner: LocalAccount, settlementToken: Address, spender: Address, amount: bigint, tx: { key: string; label: string }) =>
      c.send({ ...tx, from: owner, to: settlementToken, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }), gas: GAS.approve, estimate: false }),
    /** A direct transfer of the settlement token (funding a role's key): the fixed limit, no estimate. */
    transfer: (from: LocalAccount, settlementToken: Address, to: Address, amount: bigint, tx: { key: string; label: string }) =>
      c.send({ ...tx, from, to: settlementToken, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), gas: GAS.transfer, estimate: false }),
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
      const s = await c.send({ key: "stand-in-token", label: "deploy the *USDZ stand-in (in memory)", from, to: null, data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode }), gas: GAS.standInToken, estimate: false });
      return s.receipt.contractAddress!;
    },
    mint: (from: LocalAccount, tokenAddr: Address, to: Address, amount: bigint) =>
      c.send({ key: `stand-in-mint-${to}`, label: "mint stand-in test money", from, to: tokenAddr, data: encodeFunctionData({ abi: a.abi, functionName: "mint", args: [to, amount] }), gas: GAS.standInMint, estimate: false }),
  };
}
