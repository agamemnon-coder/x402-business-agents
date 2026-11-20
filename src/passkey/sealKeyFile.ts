// The runner's enrolment seal key (src/passkey/seal.ts), kept with its other keys outside the code repo and outside the
// ledger: PURSER_ENROLMENT_SEAL_KEY when set, else the file passkey-seal.key in KIT11_KEYS_DIR (mode 600, 32 random
// bytes as hex, made on first use). npm run relay, npm run passkey and npm run verify load it; whoever only writes the
// ledger file does not have it.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { keyPath } from "../metal/agentCli.js";
import { enrolmentSealKey, SEAL_KEY_ENV, useEnrolmentSealKey } from "./seal.js";

export const SEAL_KEY_FILE = "passkey-seal.key";

/** Loads (or makes) the runner's seal key and sets it for this process; answers where it came from. */
export function loadRunnerSealKey(env: NodeJS.ProcessEnv = process.env, path = keyPath(SEAL_KEY_FILE)): string {
  if (env[SEAL_KEY_ENV]) {
    useEnrolmentSealKey(env[SEAL_KEY_ENV]);
    return SEAL_KEY_ENV;
  }
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
  useEnrolmentSealKey(readFileSync(path, "utf8").trim());
  return path;
}

export { enrolmentSealKey };
