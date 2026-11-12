// viem clients for Metal testnet. Gas is paid in *USDZ (MIP20), so transfers go through metal-ts.

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, custom, defineChain, erc20Abi, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, USDZ, rpcUrl } from "./network.js";

const TRANSFER_GAS_LIMIT = 200_000n;

/** A plain *USDZ transfer as Purser sends it through metal-ts: gas paid in *USDZ, a fixed limit, 1 per gas. One shape
 *  for transferUsdz here and for the owners path, which signs the same transaction behind its call budget. */
export const USDZ_TRANSFER = { abi: erc20Abi, address: USDZ, functionName: "transfer", gasToken: USDZ, gasFallback: TRANSFER_GAS_LIMIT, gasLimit: TRANSFER_GAS_LIMIT, maxFeePerGas: 1n } as const;

let client: PublicClient | undefined;

export function publicClient(): PublicClient {
  if (client) return client;
  const url = rpcUrl();
  const chain = defineChain({
    id: CHAIN_ID,
    name: "Metal testnet",
    nativeCurrency: { name: "Gas", symbol: "GAS", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  client = createPublicClient({ chain, transport: http(url) }) as PublicClient;
  return client;
}

export function usdzBalance(address: Address): Promise<bigint> {
  return publicClient().readContract({ address: USDZ, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

export function readKeyFile(path: string): { address: Address; privateKey: Hex } {
  const k = JSON.parse(readFileSync(path, "utf8")) as { address: Address; privateKey: Hex };
  if (!k.address || !k.privateKey) throw new Error(`not a metal-agent key file: ${path}`);
  return k;
}

/** Plain *USDZ transfer from a key file, waited to a successful receipt. */
export async function transferUsdz(fromKeyFile: string, to: Address, amount: bigint): Promise<Hex> {
  const pc = publicClient();
  const account = privateKeyToAccount(readKeyFile(fromKeyFile).privateKey);
  const walletClient = createWalletClient({ account, chain: pc.chain, transport: custom(pc) });
  const { writeMip20Contract } = await import("@metalntwx/metal-ts");
  const hash = await writeMip20Contract({ walletClient, publicClient: pc, ...USDZ_TRANSFER, args: [to, amount] });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transfer ${hash} reverted`);
  return hash;
}
