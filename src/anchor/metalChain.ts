// The anchor's chain port on Metal testnet: the calldata goes in a value-0 transaction from a key file to its own
// address, gas paid in *USDZ through metal-ts like every other Purser transaction (src/metal/chain.ts). The key file and
// the RPC URL are never printed: an error names the key file's path only.

import { createWalletClient, custom, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient, readKeyFile } from "../metal/chain.js";
import { CHAIN_ID, USDZ } from "../metal/network.js";
import type { AnchorChain, AnchorTx } from "./anchor.js";

const GAS_LIMIT = 200_000n;

/** Read-only: enough for verify-anchor, needs METAL_RPC_URL and no key. */
export function metalReader(): Pick<AnchorChain, "getTx" | "chainId"> {
  return {
    chainId: CHAIN_ID,
    async getTx(hash) {
      const pc = publicClient();
      let tx;
      try { tx = await pc.getTransaction({ hash: hash as Hex }); } catch { return null; }
      const receipt = await pc.getTransactionReceipt({ hash: hash as Hex }).catch(() => null);
      return {
        hash: tx.hash, from: tx.from, to: tx.to ?? null, input: tx.input,
        blockNumber: receipt ? Number(receipt.blockNumber) : null,
        status: receipt ? receipt.status : "pending",
      } satisfies AnchorTx;
    },
  };
}

/** Read and send, signing with the key file's key. */
export function metalChain(keyFile: string): AnchorChain {
  return {
    ...metalReader(),
    async send(calldata) {
      const pc = publicClient();
      const account = privateKeyToAccount(readKeyFile(keyFile).privateKey);
      const walletClient = createWalletClient({ account, chain: pc.chain, transport: custom(pc) });
      const { sendMip20Call } = await import("@metalntwx/metal-ts");
      const hash = await sendMip20Call({ walletClient, publicClient: pc, to: account.address, data: calldata, gasToken: USDZ, gasFallback: GAS_LIMIT, gasLimit: GAS_LIMIT, maxFeePerGas: 1n });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      return { hash, from: account.address, blockNumber: Number(receipt.blockNumber), status: receipt.status };
    },
  };
}
