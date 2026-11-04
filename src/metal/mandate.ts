// Loads an agent's mandate from the keys directory: the credential, the reference it binds, and a
// signer over the agent's own P-256 mandate key. After a replace the agent picks up the new credential.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentKeyOfJwk, sameAgentKey, extractTerms, hashCredential, mandateReference, p256DigestSigner, parseCredential, privateKeyHex, readMandateState,
  type SignDigest,
} from "@metalntwx/metal-pay/mandates";
import type { Address, Hex } from "viem";
import { keysDir } from "./agentCli.js";
import { publicClient } from "./chain.js";

export type MandateAgent = "sourcing" | "support" | "treasury" | "customer";

export interface LoadedMandate {
  agent: MandateAgent;
  credentialPath: string;
  /** The P-256 mandate key file the agent signs with. */
  keyFile: string;
  credential: ReturnType<typeof parseCredential>;
  credentialHash: Hex;
  principal: Address;
  reference: Hex;
  signDigest: SignDigest;
}

export function loadCredentialFile(agent: MandateAgent, credentialPath: string): LoadedMandate {
  const credential = parseCredential(JSON.parse(readFileSync(credentialPath, "utf8")));
  const terms = extractTerms(credential);
  const { key, file: keyFile } = mandateKeyFor(agent, terms.agentKey);
  const credentialHash = hashCredential(credential);
  return {
    agent, credentialPath, keyFile, credential, credentialHash,
    principal: terms.principal,
    reference: mandateReference(terms.principal, terms.agentKey, credentialHash),
    signDigest: p256DigestSigner(privateKeyHex(key)),
  };
}

type P256Key = Parameters<typeof privateKeyHex>[0] & { publicJwk: Parameters<typeof agentKeyOfJwk>[0] };

/**
 * The agent's P-256 mandate key whose public half the credential names. A replacement credential is
 * issued with --mandate-key-file, so it reuses the key that sits beside the agent's first credential.
 */
function mandateKeyFor(agent: MandateAgent, agentKey: ReturnType<typeof extractTerms>["agentKey"]): { key: P256Key; file: string } {
  const dir = keysDir();
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${agent}.`) && f.endsWith(".key.json"))) {
    const key = JSON.parse(readFileSync(join(dir, f), "utf8")) as P256Key;
    if (key.publicJwk && sameAgentKey(agentKeyOfJwk(key.publicJwk), agentKey)) return { key, file: join(dir, f) };
  }
  throw new Error(`no mandate key for ${agent} matches its credential`);
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

/** The per-payment cap written in the mandate's credential, in *USDZ base units. The credential's hash is what the chain
 *  bound (its reference), so this is the cap Metal's Mandate Binding checks every payment against. */
export function boundCapUnits(m: LoadedMandate): bigint {
  return extractTerms(m.credential).constraints.perPaymentCap;
}
