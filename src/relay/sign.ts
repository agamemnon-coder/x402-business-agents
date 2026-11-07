// The runner signs what the phone decides on (security review M3): each waiting proposal's exact terms, the names
// shown beside addresses, the passkey list and the CFO policy. The phone pins the runner's public key from the
// viewer link (out of band, never from the relay) and refuses anything the relay changed. A relay that serves a
// different script could still lie on screen; that residual risk is in docs/security.md.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import type { RelayState } from "./state.js";

export interface DisplayKey {
  /** base64url SPKI DER of the public key: what the viewer link pins on the phone. */
  publicSpki: string;
  /** ES256 (P-256, SHA-256) signature in the IEEE P1363 form WebCrypto verifies, base64url. */
  sign: (text: string) => string;
}

/** Loads the runner's display key from `path` (PKCS#8 PEM, mode 600), creating it on first use. */
export function displayKey(path: string): DisplayKey {
  if (!existsSync(path)) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  }
  const key = createPrivateKey(readFileSync(path, "utf8"));
  const publicSpki = createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64url");
  return { publicSpki, sign: (text) => sign("sha256", Buffer.from(text, "utf8"), { key, dsaEncoding: "ieee-p1363" }).toString("base64url") };
}

/**
 * The runner key's fingerprint: SHA-256 of the SPKI, first 16 hex in groups of four, as the phone shows it when a new
 * run's link brings a new key (src/approve/client.ts runnerKeyFingerprint), so the two can be compared.
 */
export function displayKeyFingerprint(publicSpki: string): string {
  return createHash("sha256").update(Buffer.from(publicSpki, "base64url")).digest("hex").slice(0, 16).toUpperCase().match(/.{4}/g)!.join("-");
}

/** Exactly the part of the approvals the phone verifies, as canonical JSON (RFC 8785). */
export function signedPart(a: { proposals: unknown; names: unknown; passkey: unknown; policy: unknown; ledger_seq: unknown }): string {
  return jcs({ proposals: a.proposals, names: a.names, passkey: a.passkey, policy: a.policy, ledger_seq: a.ledger_seq } as unknown as Json);
}

export type SignedApprovals = RelayState["approvals"] & { signature: { alg: "ES256"; sig: string } };

export function signApprovals(a: RelayState["approvals"], key: DisplayKey): SignedApprovals {
  return { ...a, signature: { alg: "ES256", sig: key.sign(signedPart(a)) } };
}
