// The agents' signing keys on the owner's disk (src/policy/agentIdentity.ts): one PEM file per agent principal, mode
// 0600, in the keys folder (KIT11_KEYS_DIR, outside the repository), next to the principal's bearer key file. The ledger
// keeps the public key only; this file is the private key, handed to the agent that signs with it. Never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { keyPath } from "../metal/agentCli.js";
import { onIdentityKey } from "../policy/agentIdentity.js";

export const identityKeyFile = (principalId: string) => keyPath(`principal-${principalId.replace(/[^a-z0-9-]/gi, "_")}.ed25519.pem`);

export function writeIdentityKey(principalId: string, privatePem: string): string {
  const file = identityKeyFile(principalId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, privatePem, { mode: 0o600 });
  return file;
}

/** The agent's private key as it reads it (its key id follows from it: identityKeyId); null when it has no file. */
export function readIdentityKey(principalId: string): string | null {
  const file = identityKeyFile(principalId);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** Every key pair this process makes (a principal's first, on its creation) goes to its file too. */
export function keepIdentityKeysOnDisk(): void {
  onIdentityKey((id, _keyId, pem) => { writeIdentityKey(id, pem); });
}
