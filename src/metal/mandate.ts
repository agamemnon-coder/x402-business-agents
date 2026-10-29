// Loads an agent's mandate from the keys directory: the credential, the reference it binds, and a
// signer over the agent's own P-256 mandate key. After a replace the agent picks up the new credential.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractTerms, hashCredential, mandateReference, p256DigestSigner, parseCredential, privateKeyHex, readMandateState,
  type SignDigest,
} from "@metalntwx/metal-pay/mandates";
import type { Address, Hex } from "viem";
import { keysDir } from "./agentCli.js";
import { publicClient } from "./chain.js";

export type MandateAgent = "sourcing" | "support" | "treasury" | "customer";

export interface LoadedMandate {
  agent: MandateAgent;
  credentialPath: string;
  credential: ReturnType<typeof parseCredential>;
  credentialHash: Hex;
  principal: Address;
  reference: Hex;
  signDigest: SignDigest;
}

export function loadCredentialFile(agent: MandateAgent, credentialPath: string): LoadedMandate {
  const credential = parseCredential(JSON.parse(readFileSync(credentialPath, "utf8")));
  const terms = extractTerms(credential);
  const key = JSON.parse(readFileSync(credentialPath.replace(/\.json$/, ".key.json"), "utf8")) as Parameters<typeof privateKeyHex>[0];
  const credentialHash = hashCredential(credential);
  return {
    agent, credentialPath, credential, credentialHash,
    principal: terms.principal,
    reference: mandateReference(terms.principal, terms.agentKey, credentialHash),
    signDigest: p256DigestSigner(privateKeyHex(key)),
  };
}

/** Credential files for an agent: `<agent>.credential.json`, then `<agent>.<proposal>.credential.json` after replaces. */
export function credentialFiles(agent: MandateAgent): string[] {
  const dir = keysDir();
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${agent}.`) && f.endsWith(".credential.json"))
    .map((f) => join(dir, f));
}

/** The one credential the chain has bound and not revoked. Throws if there is none or more than one. */
export async function activeMandate(agent: MandateAgent): Promise<LoadedMandate> {
  const live: LoadedMandate[] = [];
  for (const path of credentialFiles(agent)) {
    const m = loadCredentialFile(agent, path);
    const state = await readMandateState(publicClient(), m.principal, m.reference);
    if (state.boundBlock > 0n && !state.revoked) live.push(m);
  }
  if (live.length !== 1) throw new Error(`${agent}: expected one bound mandate, found ${live.length}`);
  return live[0]!;
}

export async function mandateSpent(m: LoadedMandate): Promise<bigint> {
  return (await readMandateState(publicClient(), m.principal, m.reference)).spent;
}
