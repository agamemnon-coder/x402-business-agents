// The only code that uses the business owner's key. It issues credentials (off-chain, no gas) and runs
// `mandate replace` on chain, and it only ever replaces what an approved proposal names.

import { existsSync } from "node:fs";
import type { Address } from "viem";
import { MANDATE_EXPIRES_IN_SECONDS } from "../config/policy.js";
import { credentialCreateArgs } from "../metal/credentialArgs.js";
import { keyPath, metalAgent } from "../metal/agentCli.js";
import type { MandateAgent } from "../metal/mandate.js";

const OWNER = "owner-business.key.json";

export interface CredentialSpec {
  agent: MandateAgent;
  principal: Address;
  capCents: number;
  budgetCents: number;
  payees: { address: Address; name: string }[];
  description: string;
}

/**
 * Writes `<agent>.<tag>.credential.json`, signed by the owner's issuer key, reusing the agent's existing
 * mandate key (so the agent keeps signing with the key it has). Idempotent: an existing file is kept.
 */
export function issueReplacementCredential(spec: CredentialSpec, tag: string, mandateKeyFile: string): string {
  const out = keyPath(`${spec.agent}.${tag}.credential.json`);
  if (existsSync(out)) return out;
  metalAgent([
    ...credentialCreateArgs({ ...spec, expiresInSeconds: MANDATE_EXPIRES_IN_SECONDS }),
    "--mandate-key-file", mandateKeyFile,
    "--key", keyPath(OWNER), "--out", out,
  ]);
  return out;
}

/** Binds `newCredential` in place of `oldCredential` in one transaction; spend carries over. */
export function replaceMandate(newCredential: string, oldCredential: string): { tx: string | null; out: string } {
  const r = metalAgent(["mandate", "replace", "--credential", newCredential, "--replaces", oldCredential, "--key", keyPath(OWNER)]);
  return { tx: r.fields.get("transaction")?.[0] ?? null, out: r.out };
}
