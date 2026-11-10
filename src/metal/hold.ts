// A MIP20 hold for exactly the amount the CFO approved (Metal "payment from reserved funds"). After the CFO's passkey
// signs an invoice's exact terms, Purser reserves that amount on chain for one spender: the holder's funds leave its
// spendable balance, and the spender can capture at most what is held. A capture one base unit over the approved
// amount is refused by the token itself (shown with a read-only simulation, nothing sent); the exact amount is then
// captured to the supplier. The token enforces the cap, not Purser's code.
// Docs: https://docs.metalntwx.com/build/payments/payment-from-reserved-funds

import { createPublicClient, createWalletClient, custom, defineChain, http, parseAbi, type Address, type EIP1193RequestFn, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { centsToBaseUnits } from "../lib/money.js";
import { readKeyFile } from "./chain.js";
import { CHAIN_ID, EXPLORER_TX, USDZ, rpcUrl } from "./network.js";

export const HOLD_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function holdFrom(address owner, uint256 amount)",
  "function captureHold(address owner, address to, uint256 amount)",
  "function releaseHold(address owner, uint256 amount)",
  "function heldBalanceOf(address owner, address spender) view returns (uint256)",
  "event HoldPlaced(address indexed owner, address indexed spender, uint256 amount)",
  "event HoldReleased(address indexed owner, address indexed spender, uint256 amount)",
]);

export interface HoldPlan {
  /** The amount the CFO's passkey signed, in cents of *USDZ. */
  approvedCents: number;
  /** SHA-256 of the signed terms, kept with the record so the hold links back to the approval. */
  termsHash: string;
  holder: Address;
  spender: Address;
  supplier: Address;
}

export interface HoldDeps {
  approve(spender: Address, amount: bigint): Promise<Hex>;
  placeHold(holder: Address, amount: bigint): Promise<Hex>;
  /** Read-only: would this capture succeed? Nothing is sent. */
  simulateCapture(holder: Address, to: Address, amount: bigint): Promise<{ ok: boolean; reason: string | null }>;
  capture(holder: Address, to: Address, amount: bigint): Promise<Hex>;
}

export interface HoldRecord {
  termsHash: string;
  approved: { cents: number; baseUnits: string };
  holder: Address;
  spender: Address;
  supplier: Address;
  approveTx: Hex;
  holdTx: Hex;
  overCapture: { baseUnits: string; refusedByChain: true; reason: string | null };
  captureTx: Hex;
  explorer: string[];
}

/** Each step's id as soon as it exists, so a run stopped halfway (budget, network) still names what landed on chain. */
export type HoldProgress = (step: "approve" | "hold" | "over-capture-refused" | "capture", detail: string) => void;

export async function runApprovedHold(plan: HoldPlan, deps: HoldDeps, onStep: HoldProgress = () => {}): Promise<HoldRecord> {
  if (!Number.isInteger(plan.approvedCents) || plan.approvedCents <= 0) throw new Error("hold: the approved amount must be a positive whole number of cents");
  if (!/^[0-9a-f]{64}$/.test(plan.termsHash)) throw new Error("hold: termsHash must be the 64-hex SHA-256 the CFO signed");
  const amount = centsToBaseUnits(plan.approvedCents);
  const approveTx = await deps.approve(plan.spender, amount);
  onStep("approve", approveTx);
  const holdTx = await deps.placeHold(plan.holder, amount);
  onStep("hold", holdTx);
  const over = amount + 1n;
  const sim = await deps.simulateCapture(plan.holder, plan.supplier, over);
  // The point of the hold: the token must refuse more than the CFO approved. If it would not, stop before paying.
  if (sim.ok) throw new Error("hold: the chain would accept a capture above the approved amount; not capturing");
  onStep("over-capture-refused", sim.reason ?? "refused");
  const captureTx = await deps.capture(plan.holder, plan.supplier, amount);
  onStep("capture", captureTx);
  return {
    termsHash: plan.termsHash,
    approved: { cents: plan.approvedCents, baseUnits: amount.toString() },
    holder: plan.holder, spender: plan.spender, supplier: plan.supplier,
    approveTx, holdTx,
    overCapture: { baseUnits: over.toString(), refusedByChain: true, reason: sim.reason },
    captureTx,
    explorer: [approveTx, holdTx, captureTx].map((h) => EXPLORER_TX + h),
  };
}

/** A transport that answers eth_chainId locally and refuses any request past `max`, so a live run cannot exceed its budget. */
export function budgetedTransport(url: string, max: number, onCall: (method: string) => void = () => {}) {
  let used = 0;
  const inner = http(url)({ chain: undefined, retryCount: 0 });
  const request: EIP1193RequestFn = async (args) => {
    if (args.method === "eth_chainId") return `0x${CHAIN_ID.toString(16)}` as never;
    if (used >= max) throw new Error(`Metal RPC budget of ${max} calls reached; stopping`);
    used++;
    onCall(args.method);
    return inner.request(args as never) as never;
  };
  return { transport: custom({ request }), used: () => used };
}

const GAS_LIMIT = 300_000n;

export function liveHoldDeps(o: { holderKeyFile: string; spenderKeyFile: string; maxCalls: number; onCall?: (m: string) => void; onSigned?: (step: string, hash: Hex) => void }): { deps: HoldDeps; used: () => number; client: PublicClient } {
  const chain = defineChain({ id: CHAIN_ID, name: "Metal testnet", nativeCurrency: { name: "Gas", symbol: "GAS", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl()] } } });
  const b = budgetedTransport(rpcUrl(), o.maxCalls, o.onCall);
  const client = createPublicClient({ chain, transport: b.transport, pollingInterval: 2_500 }) as PublicClient;
  const holder = privateKeyToAccount(readKeyFile(o.holderKeyFile).privateKey);
  const spender = privateKeyToAccount(readKeyFile(o.spenderKeyFile).privateKey);
  const wallet = (account: typeof holder) => createWalletClient({ account, chain, transport: b.transport });
  const send = async (account: typeof holder, functionName: "approve" | "holdFrom" | "captureHold", args: readonly unknown[]): Promise<Hex> => {
    const { signMip20Contract } = await import("@metalntwx/metal-ts");
    const signed = await signMip20Contract({
      walletClient: wallet(account), publicClient: client, abi: HOLD_ABI, address: USDZ, functionName, args: args as never,
      gasToken: USDZ, gasFallback: GAS_LIMIT, gasLimit: GAS_LIMIT, maxFeePerGas: 1n,
    } as never);
    // Metal's docs: save the signed hash before sending, so an interrupted run still knows what it sent.
    o.onSigned?.(functionName, signed.txHash);
    const hash = await signed.send();
    // One receipt read per poll (viem's waitForTransactionReceipt also reads blocks and the transaction).
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2_500));
      const receipt = await client.getTransactionReceipt({ hash }).catch((e: Error) => { if (/budget/.test(e.message) || !/not be found|not found/i.test(e.message)) throw e; return null; });
      if (receipt) { if (receipt.status !== "success") throw new Error(`${functionName} ${hash} reverted`); return hash; }
    }
    throw new Error(`${functionName} ${hash}: no receipt yet`);
  };
  return {
    client,
    used: b.used,
    deps: {
      approve: (s, amount) => send(holder, "approve", [s, amount]),
      placeHold: (h, amount) => send(spender, "holdFrom", [h, amount]),
      capture: (h, to, amount) => send(spender, "captureHold", [h, to, amount]),
      simulateCapture: async (h, to, amount) => {
        try {
          await client.simulateContract({ address: USDZ, abi: HOLD_ABI, functionName: "captureHold", args: [h, to, amount], account: spender });
          return { ok: true, reason: null };
        } catch (e) {
          // An RPC budget stop or a network failure is not a refusal by the chain: viem wraps both, so read the full
          // message (it carries the cause), and count only a contract revert as a refusal.
          const full = (e as Error).message;
          if (/budget/.test(full)) throw e;
          const short = (e as { shortMessage?: string }).shortMessage ?? full;
          if (!/revert/i.test(full)) throw new Error(`hold: the over-capture check failed without a revert (${short.split("\n")[0]})`, { cause: e });
          return { ok: false, reason: short.split("\n")[0]!.slice(0, 200) };
        }
      },
    },
  };
}
