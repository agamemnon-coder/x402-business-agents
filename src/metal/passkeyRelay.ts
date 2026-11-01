// Block 1: the gas sponsor that relays an owners_execute. Its key (passkey-sponsor.key.json in the world's keys dir)
// pays gas and nothing else: it is no owner of the passkey account, so it cannot move a cent of it.

import { createWalletClient, custom, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync } from "node:fs";
import { keyPath, metalAgent } from "./agentCli.js";
import { publicClient, readKeyFile, usdzBalance } from "./chain.js";
import { centsToBaseUnits } from "../lib/money.js";
import type { Relay } from "../executors/ownersExecute.js";

/** OpenZeppelin 5.6.1 ERC7913WebAuthnVerifier on Metal testnet (deployed 1 November, docs/runs/passkey-owners.json). */
export const PASSKEY_VERIFIER = "0xd4c84c2bea087053691623bc463da61b528755ab" as Address;
export const ACCOUNT_FACTORY = "0x3dbED5DebA965A639bB0Fd40BE96b97922070FA8" as Address;

export function passkeySponsor() {
  const file = keyPath("passkey-sponsor.key.json");
  if (!existsSync(file)) metalAgent(["key", "create", "--out", file]);
  return privateKeyToAccount(readKeyFile(file).privateKey);
}

/** Gas from the faucet when low; a 429 ("retry in N s", the faucet's per-client limit) is waited out, up to 4 times. */
export async function fundSponsor(): Promise<void> {
  const s = passkeySponsor();
  for (let i = 0; (await usdzBalance(s.address)) < centsToBaseUnits(500); i++) {
    try {
      metalAgent(["fund", s.address]);
    } catch (e) {
      const wait = /retry in (\d+) s/.exec((e as Error).message);
      if (!wait || i >= 3) throw e;
      await new Promise((r) => setTimeout(r, (Number(wait[1]) + 3) * 1000));
    }
  }
}

/** Sends from the sponsor with 20 % above the estimate; a call the chain refuses still lands as a reverted tx. */
export function liveRelay(): Relay {
  const pc = publicClient();
  const sponsor = passkeySponsor();
  const wallet = createWalletClient({ account: sponsor, chain: pc.chain, transport: custom(pc) });
  return {
    send: async (to: Address, data: Hex) => {
      await fundSponsor();
      let gas: bigint;
      try { gas = ((await pc.estimateGas({ account: sponsor.address, to, data })) * 6n) / 5n; } catch { gas = 3_000_000n; }
      return wallet.sendTransaction({ to, data, gas, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, chain: pc.chain, account: sponsor });
    },
    wait: async (tx: Hex) => (await pc.waitForTransactionReceipt({ hash: tx, timeout: 180_000 })).status === "success",
  };
}
