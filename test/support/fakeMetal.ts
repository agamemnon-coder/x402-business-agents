// Metal testnet's JSON-RPC, in process: enough of a chain for the owners path's tests. Every request is recorded in the
// order it arrives. A transaction is its signed bytes (hash = keccak256 of them, as on the chain), checked for its
// sender's nonce, mined after a set number of receipt reads, and then applied: a factory call deploys the account, a
// *USDZ transfer moves balance, and an account's executeSigned runs the mandate calls it carries (bind, replace,
// revoke), read from the call data itself with the SDK's ABI, never from a proposal's words. A mandate call the
// account could not run (a revoke or a replace of a mandate it does not hold live, a bind of one it holds) reverts.
// It does not check the owners' signatures: that is the real account's work, and no test here claims it.
// Nothing here signs or decides anything for the code under test.
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, getAddress, encodeFunctionResult, erc20Abi, fromRlp, keccak256, numberToHex, parseAbiParameters, parseTransaction, recoverTransactionAddress, slice, toFunctionSelector, type Address, type Hex } from "viem";
import { decodeAgentKey, mandateBindingAbi, mandateReference } from "@metalntwx/metal-pay/mandates";
import { accountAbi, factoryAbi } from "../../src/metal/fourEyes.js";
import { USDZ } from "../../src/metal/network.js";
import { ACCOUNT_FACTORY } from "../../src/metal/passkeyRelay.js";

export interface FakeTx { hash: Hex; raw: Hex; from: Address; to: Address; data: Hex; nonce: number; gas: bigint; reads: number; mined: boolean; ok: boolean }
export type Fault = "drop" | "lose-answer" | `refuse:${string}`;

/** A node's JSON-RPC error answer, as a transport throws it. */
export const rpcError = (code: number, message: string, data?: Hex) => Object.assign(new Error(message), { code, ...(data ? { data } : {}) });
const lower = (a: string) => a.toLowerCase();
const SEL = {
  predict: toFunctionSelector(factoryAbi.find((x) => x.name === "predictAccount")!), create: toFunctionSelector(factoryAbi.find((x) => x.name === "createAccount")!),
  nonces: toFunctionSelector(accountAbi.find((x) => x.name === "nonces")!), mandates: toFunctionSelector(mandateBindingAbi.find((x) => x.type === "function" && x.name === "mandates")!),
  balanceOf: toFunctionSelector(erc20Abi.find((x) => x.type === "function" && x.name === "balanceOf")!), transfer: toFunctionSelector(erc20Abi.find((x) => x.type === "function" && x.name === "transfer")!),
  execute: toFunctionSelector(accountAbi.find((x) => x.name === "executeSigned")!),
};

type Mandate = { principal: Address; revoked: boolean; boundBlock: bigint; spent: bigint; occurrences: bigint };
/** The mandate calls an executeSigned carries to the account itself, decoded from its call data: what each does to which mandate. */
function mandateCalls(account: Address, data: Hex): ({ what: "bind"; ref: string } | { what: "replace"; ref: string; predecessor: string } | { what: "revoke"; ref: string })[] {
  const [, execution] = decodeFunctionData({ abi: accountAbi, data }).args as unknown as [Hex, Hex];
  const [calls] = decodeAbiParameters(parseAbiParameters("(address target, uint256 value, bytes callData)[]"), execution);
  return calls.filter((c) => lower(c.target) === lower(account)).map((c) => {
    const d = decodeFunctionData({ abi: mandateBindingAbi, data: c.callData });
    if (d.functionName === "bind") { const [hashC, , agentKey] = d.args as unknown as [Hex, Hex, Hex]; return { what: "bind" as const, ref: lower(mandateReference(account, decodeAgentKey(agentKey), hashC)) }; }
    if (d.functionName === "replace") { const [predecessor, hashC, , agentKey] = d.args as unknown as [Hex, Hex, Hex, Hex]; return { what: "replace" as const, ref: lower(mandateReference(account, decodeAgentKey(agentKey), hashC)), predecessor: lower(predecessor) }; }
    if (d.functionName === "revoke") return { what: "revoke" as const, ref: lower((d.args as unknown as [Hex])[0]) };
    throw new Error(`the stand-in account does not run ${d.functionName}`);
  });
}

/** The address this stand-in's factory gives a set of signers: fixed by them, as the real factory's is. */
export function predictedAccount(calldata: Hex): Address {
  return `0x${keccak256(slice(calldata, 4)).slice(-40)}` as Address;
}

export function fakeMetal() {
  const requests: { method: string; params: readonly unknown[] }[] = [];
  const code = new Map<string, Hex>([[lower(ACCOUNT_FACTORY), "0x60"]]);
  const balances = new Map<string, bigint>();
  const pending = new Map<string, number>();
  const latest = new Map<string, number>();
  const txs = new Map<Hex, FakeTx>();
  const mandates = new Map<string, Mandate>();
  const live = (ref: string) => { const m = mandates.get(ref); return !!m && m.boundBlock > 0n && !m.revoked; };
  let lastAsked: Address | null = null;
  const state = {
    /** How many receipt reads a transaction stays unmined; Infinity keeps it pending until mine() is called. */
    receiptAfter: 0,
    /** What the next eth_sendRawTransaction meets: the request is lost on the way (drop), its answer is (lose-answer), or the node refuses it. */
    sendFault: null as Fault | null,
    /** Revert data a transaction to this address reverts with: in a gas estimate, a call, and on chain. */
    reverts: new Map<string, Hex>(),
    /** The node's answer to any request of this method, thrown instead of answered. */
    fail: new Map<string, Error>(),
  };

  /** Whether the account can run the mandate calls of this transaction, on the mandates it holds now. Any other transaction passes. */
  function accountRuns(t: FakeTx): boolean {
    if (!t.data.startsWith(SEL.execute)) return true;
    return mandateCalls(t.to, t.data).every((c) => (c.what === "bind" ? !mandates.has(c.ref) : c.what === "replace" ? live(c.predecessor) && !mandates.has(c.ref) : live(c.ref)));
  }
  function apply(t: FakeTx): void {
    if (t.data.startsWith(SEL.execute)) {
      for (const c of mandateCalls(t.to, t.data)) {
        if (c.what === "revoke") { mandates.set(c.ref, { ...mandates.get(c.ref)!, revoked: true }); continue; }
        // A replace ends its predecessor and carries what was spent, and how many payments were made, into the new mandate.
        const old = c.what === "replace" ? mandates.get(c.predecessor)! : undefined;
        if (old && c.what === "replace") mandates.set(c.predecessor, { ...old, revoked: true });
        mandates.set(c.ref, { principal: getAddress(t.to), boundBlock: 5n, spent: old?.spent ?? 0n, occurrences: old?.occurrences ?? 0n, revoked: false });
      }
    }
    if (lower(t.to) === lower(ACCOUNT_FACTORY) && t.data.startsWith(SEL.create)) code.set(lower(predictedAccount(t.data)), "0x363d3d37");
    if (lower(t.to) === lower(USDZ) && t.data.startsWith(SEL.transfer)) {
      const [to, amount] = decodeFunctionData({ abi: erc20Abi, data: t.data }).args as [Address, bigint];
      balances.set(lower(t.from), (balances.get(lower(t.from)) ?? 0n) - amount);
      balances.set(lower(to), (balances.get(lower(to)) ?? 0n) + amount);
    }
  }
  function mine(hash: Hex): void {
    const t = txs.get(hash);
    if (!t || t.mined) return;
    t.mined = true;
    t.ok = !state.reverts.has(lower(t.to)) && accountRuns(t);
    latest.set(lower(t.from), Math.max(latest.get(lower(t.from)) ?? 0, t.nonce + 1));
    if (t.ok) apply(t);
  }
  async function decode(raw: Hex): Promise<Omit<FakeTx, "hash" | "raw" | "reads" | "mined" | "ok">> {
    if (raw.startsWith("0x7f")) {
      // Metal's MIP20 envelope: [chainId, nonce, tip, fee, gas, to, value, data, accessList, authorizations, gasToken, v, r, s].
      const f = fromRlp(`0x${raw.slice(4)}`, "hex") as Hex[];
      if (!lastAsked) throw rpcError(-32000, "invalid sender");
      return { from: lastAsked, to: f[5] as Address, data: f[7]!, nonce: Number(BigInt(f[1] === "0x" ? "0x0" : f[1]!)), gas: BigInt(f[4]!) };
    }
    const p = parseTransaction(raw as `0x02${string}`);
    return { from: await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` }), to: p.to!, data: p.data ?? "0x", nonce: p.nonce ?? 0, gas: p.gas ?? 0n };
  }

  async function rpc(a: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    const params = a.params ?? [];
    requests.push({ method: a.method, params });
    const failing = state.fail.get(a.method);
    if (failing) throw failing;
    switch (a.method) {
      case "eth_chainId": return "0xf951";
      case "eth_getCode": return code.get(lower(params[0] as string)) ?? "0x";
      case "eth_getTransactionCount": {
        lastAsked = params[0] as Address;
        return numberToHex((params[1] === "latest" ? latest : pending).get(lower(lastAsked)) ?? 0);
      }
      case "eth_estimateGas":
      case "eth_call": {
        const c = params[0] as { to: Address; data: Hex };
        const revert = state.reverts.get(lower(c.to));
        // A view still answers; the account's (or factory's) own calls are what it reverts.
        if (revert && ![SEL.nonces, SEL.mandates, SEL.predict, SEL.balanceOf].some((v) => c.data.startsWith(v))) throw rpcError(3, "execution reverted", revert === "0x" ? undefined : revert);
        if (a.method === "eth_estimateGas") return numberToHex(500_000);
        if (c.data.startsWith(SEL.predict)) return encodeAbiParameters(parseAbiParameters("address"), [predictedAccount(c.data)]);
        if (c.data.startsWith(SEL.balanceOf)) return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: balances.get(lower(decodeFunctionData({ abi: erc20Abi, data: c.data }).args![0] as string)) ?? 0n });
        if (c.data.startsWith(SEL.nonces)) return encodeAbiParameters(parseAbiParameters("uint256"), [0n]);
        if (c.data.startsWith(SEL.mandates)) {
          const m = mandates.get(lower(slice(c.data, 4, 36)));
          const zero = `0x${"00".repeat(32)}` as Hex;
          return encodeFunctionResult({ abi: mandateBindingAbi, functionName: "mandates", result: {
            principal: m?.principal ?? "0x0000000000000000000000000000000000000000", revoked: m?.revoked ?? false, agentX: zero, agentY: zero, kid: "", openSdHash: zero,
            boundBlock: m?.boundBlock ?? 0n, occurrences: m?.occurrences ?? 0n, spent: m?.spent ?? 0n,
          } as never });
        }
        return "0x";
      }
      case "eth_sendRawTransaction": {
        const raw = params[0] as Hex;
        const hash = keccak256(raw);
        const fault = state.sendFault;
        state.sendFault = null;
        if (fault === "drop") throw new Error("fetch failed");
        if (fault?.startsWith("refuse:")) throw rpcError(-32000, fault.slice(7));
        if (txs.has(hash)) throw rpcError(-32000, txs.get(hash)!.mined ? "nonce too low" : "already known");
        const d = await decode(raw);
        const next = pending.get(lower(d.from)) ?? 0;
        if (d.nonce !== next) throw rpcError(-32000, d.nonce < next ? "nonce too low" : "nonce too high");
        pending.set(lower(d.from), next + 1);
        txs.set(hash, { hash, raw, ...d, reads: 0, mined: false, ok: false });
        if (fault === "lose-answer") throw new Error("socket hang up");
        return hash;
      }
      case "eth_getTransactionReceipt": {
        const t = txs.get(params[0] as Hex);
        if (!t) return null;
        if (!t.mined && t.reads++ >= state.receiptAfter) mine(t.hash);
        return t.mined ? { transactionHash: t.hash, status: t.ok ? "0x1" : "0x0", blockNumber: "0x18ad1cd", gasUsed: "0x1c6c3b" } : null;
      }
      default: throw rpcError(-32601, `the stand-in chain does not answer ${a.method}`);
    }
  }

  return {
    rpc, requests, code, balances, txs, mandates, state, mine,
    methods: () => requests.map((r) => r.method),
    /** The transactions the node accepted, oldest first. */
    sent: () => [...txs.values()],
  };
}
export type FakeMetal = ReturnType<typeof fakeMetal>;
