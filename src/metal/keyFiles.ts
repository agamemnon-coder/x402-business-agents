// Key files of a test world, made once in its keys directory (KIT11_KEYS_DIR, never inside this repo) and read from
// there. Making one needs no network and no CLI: a plain key and an agent's P-256 mandate key are written here, in the
// file shapes the pinned metal-agent CLI writes and reads ({ address, privateKey } and { kid, publicJwk, privateJwk }),
// readable by their owner only. Nothing here is ever printed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createEs256Key } from "@metalntwx/metal-pay/mandates";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keyPath } from "./agentCli.js";
import { readKeyFile } from "./chain.js";

/** "wx": never over a key that is there, also when two runs start at once. */
const writeNew = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });

/** A plain (secp256k1) key in the keys directory, made when it is not there yet: its account, for signing. */
export function plainKey(name: string) {
  const file = keyPath(name);
  if (!existsSync(file)) {
    const privateKey = generatePrivateKey();
    writeNew(file, { address: privateKeyToAccount(privateKey).address, privateKey });
  }
  return privateKeyToAccount(readKeyFile(file).privateKey);
}

/** An agent's P-256 mandate key in the keys directory, made when it is not there yet: its file and key id. */
export async function mandateKey(name: string): Promise<{ file: string; kid: string; created: boolean }> {
  const file = keyPath(name);
  const created = !existsSync(file);
  if (created) writeNew(file, await createEs256Key());
  return { file, kid: (JSON.parse(readFileSync(file, "utf8")) as { kid: string }).kid, created };
}
