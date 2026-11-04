// The approval-hash scheme (build plan 2.4). A person approves the SHA-256 of the exact terms,
// canonicalised with RFC 8785 JCS, the same function metal-pay uses for credential hashes.

import { createHash } from "node:crypto";
import { jcs, type Json, type JsonObject } from "@metalntwx/metal-pay/mandates";

export const TERMS_SCHEMA = "kit11.approval-terms/v1";

export type Terms = JsonObject & {
  schema: typeof TERMS_SCHEMA;
  kind: string;
  proposal_id: string;
  expires_at: string;
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/**
 * Terms carry no JSON numbers: money is a two-decimal string, counts are strings too.
 * A number would let 0.1 + 0.2 style drift change a hash, so it is refused outright.
 */
function assertNoNumbers(value: Json, path: string): void {
  if (typeof value === "number") throw new Error(`terms must not contain numbers (at ${path}); use a decimal string`);
  if (Array.isArray(value)) value.forEach((v, i) => assertNoNumbers(v, `${path}[${i}]`));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoNumbers(v, `${path}.${k}`);
  }
}

export function canonicalTerms(terms: Terms): string {
  if (terms.schema !== TERMS_SCHEMA) throw new Error(`unknown terms schema: ${terms.schema}`);
  if (!ISO_UTC.test(terms.expires_at)) throw new Error(`expires_at must be UTC ISO-8601 with Z: ${terms.expires_at}`);
  assertNoNumbers(terms, "terms");
  return jcs(terms);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function termsHash(terms: Terms): string {
  return sha256Hex(canonicalTerms(terms));
}

/**
 * What a passkey signs to reject a proposal: a hash derived from the terms hash, so a rejection is bound to those
 * exact terms but its signature can never pass as an approval (whose challenge is the terms hash itself). The phone
 * (src/approve/client.ts) and the relay (worker/src/core.ts) derive it the same way.
 */
export function rejectionSha256(termsSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(termsSha256)) throw new Error("a terms hash is 64 lowercase hex characters");
  return sha256Hex(`kit11 reject v1 ${termsSha256}`);
}

/** The approver types the first 8 hex characters; the record keeps the full hash. */
export const PREFIX_LENGTH = 8;

export function prefixMatches(fullHash: string, typed: string): boolean {
  const t = typed.trim().toLowerCase();
  return t.length === PREFIX_LENGTH && /^[0-9a-f]+$/.test(t) && fullHash.startsWith(t);
}
