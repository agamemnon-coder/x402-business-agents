// Metal's Offer Pay-per-Call Clearing (the x402 scheme `bajillion`, new on testnet in October 2026): a payer deposits
// *USDZ once under its clearing key and then pays each request with a signed running total; Metal's clearing service
// issues a receipt per payment and certifies the totals on chain each epoch. No transaction per query.
//
// What this build learned live (docs/runs/2026-10-29-clearing.md):
//   - the payment is counted when the payer creates it, before the seller's handler and before the seller can say no,
//     so the seller offers clearing only when it can deliver (src/servers/seller.ts, the prepaid route);
//   - the service refuses payments for a few seconds around each epoch close (`between_epochs`): wait and send again;
//   - a seller's earnings leave only once their epoch is final, about 20 minutes later.
// Keys: the payer's gas-and-deposit key (an ordinary EOA) and both clearing wallets live in the keys dir.

import { readFileSync } from "node:fs";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  clearingSpendable, createClearingClient, depositToClearing, withdrawFromClearing, type ClearingWithdrawal,
} from "@metalntwx/metal-pay";
import { openClearingWallet } from "@metalntwx/metal-pay/node";
import { keyPath } from "./agentCli.js";
import { FACILITATOR_URL, rpcUrl, USDZ } from "./network.js";

export const NETWORK = "eip155:63825" as const;
export const CHAIN_ID = 63825;
/** Summit's EOA that pays the deposit and its gas; funded from the testnet faucet. */
export const CUSTOMER_CLEARING_KEY = "customer-clearing.key.json";
export const WALLET_DIRS = { customer: "clearing-customer", seller: "clearing-seller" } as const;
export type ClearingParty = keyof typeof WALLET_DIRS;

export interface ClearingDeployment {
  settlement: Hex;
  asset: Hex;
  serviceUrl: string;
}

let cached: ClearingDeployment | null | undefined;

/** The deployment Metal's facilitator settles on testnet, from its /supported list; null when it offers none. */
export async function clearingDeployment(fetcher: typeof fetch = fetch): Promise<ClearingDeployment | null> {
  if (cached !== undefined) return cached;
  const res = await fetcher(`${FACILITATOR_URL}/supported`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`the facilitator's /supported answered ${res.status}`);
  const body = (await res.json()) as { kinds?: { scheme: string; network: string; extra?: Partial<ClearingDeployment> }[] };
  const k = body.kinds?.find((x) => x.scheme === "bajillion" && x.network === NETWORK);
  const e = k?.extra;
  cached = e?.settlement && e.asset && e.serviceUrl ? { settlement: e.settlement, asset: e.asset, serviceUrl: e.serviceUrl } : null;
  if (cached && cached.asset.toLowerCase() !== USDZ.toLowerCase()) throw new Error(`the clearing deployment holds ${cached.asset}, not *USDZ`);
  return cached;
}

async function need(): Promise<ClearingDeployment> {
  const d = await clearingDeployment();
  if (!d) throw new Error("Metal's facilitator offers no clearing deployment on testnet");
  return d;
}

/** Opens a party's clearing wallet (a P-256 key and its receipt journal). One process at a time owns it. */
export function openWallet(party: ClearingParty) {
  return openClearingWallet(keyPath(WALLET_DIRS[party]));
}

const payerAccount = () => privateKeyToAccount((JSON.parse(readFileSync(keyPath(CUSTOMER_CLEARING_KEY), "utf8")) as { privateKey: Hex }).privateKey);

/** Summit puts `units` of *USDZ into clearing under its clearing key. */
export async function depositCustomer(units: bigint): Promise<{ approveTx: Hex | null; depositTx: Hex; account: Hex }> {
  const d = await need();
  const w = await openWallet("customer");
  try {
    const r = await depositToClearing({ rpcUrl: rpcUrl(), chainId: CHAIN_ID, from: payerAccount(), settlement: d.settlement, asset: d.asset, account: w.signer.publicKey, amount: units });
    return { ...r, account: w.signer.publicKey };
  } finally {
    await w.close();
  }
}

/** What a party may spend now, in base units: the service's own estimate (it can read low around an epoch close). */
export async function spendable(party: ClearingParty): Promise<{ account: Hex; units: bigint }> {
  const d = await need();
  const w = await openWallet(party);
  try {
    return { account: w.signer.publicKey, units: await clearingSpendable({ rpcUrl: rpcUrl(), settlement: d.settlement, serviceUrl: d.serviceUrl, account: w.signer.publicKey }) };
  } finally {
    await w.close();
  }
}

/** Takes the seller's finalized earnings out of clearing to `destination`; `gasKeyFile` pays the transactions. */
export async function withdrawSeller(destination: Hex, gasKeyFile: string): Promise<ClearingWithdrawal> {
  const d = await need();
  const w = await openWallet("seller");
  try {
    const from = privateKeyToAccount((JSON.parse(readFileSync(gasKeyFile, "utf8")) as { privateKey: Hex }).privateKey);
    return await withdrawFromClearing({ rpcUrl: rpcUrl(), chainId: CHAIN_ID, from, settlement: d.settlement, serviceUrl: d.serviceUrl, signer: w.signer, destination });
  } finally {
    await w.close();
  }
}

/** A clearing payer for Summit, paying at most `maxUnits` a request. The caller closes the wallet. */
export async function customerClearingClient(maxUnits: bigint) {
  const d = await need();
  const w = await openWallet("customer");
  const client = createClearingClient({ serviceUrl: d.serviceUrl, rpcUrl: rpcUrl(), network: NETWORK, settlement: d.settlement, asset: d.asset, signer: w.signer, store: w.store, maxAmount: maxUnits });
  return { client, wallet: w };
}

/** True when an error (or its causes) is the service's short pause around an epoch close: nothing was paid. */
export function betweenEpochs(e: unknown): boolean {
  for (let x: unknown = e; x && typeof x === "object"; x = (x as { cause?: unknown }).cause) {
    if ((x as { reason?: string }).reason === "between_epochs" || /between epochs/.test((x as Error).message ?? "")) return true;
  }
  return false;
}
