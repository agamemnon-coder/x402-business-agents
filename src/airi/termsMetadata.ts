// The CFO-signed terms hash in Airwallex's PaymentIntent record, and its read-back (vic-3). Above the limit the CFO
// signs the terms of one purchase with Face ID; their SHA-256 and the proposal's id go on the PaymentIntent create as
// metadata {purser_terms_sha256, purser_proposal} (src/airi/checkout.ts), and nothing else does: a purchase within the
// limit has no signed terms and sends no metadata. After the create, one GET reads the PaymentIntent back
// (GET /api/v1/pa/payment_intents/{id}, https://www.airwallex.com/docs/api/payments/payment_intents/retrieve) and a
// pure comparison marks what came back equal or not equal to the hash that was signed. What Airwallex keeps here is
// Airwallex's PaymentIntent record of the order; the binding of the credential to the terms is Purser's own check.

import type { Airwallex } from "../airwallex/client.js";
import { AirwallexAmbiguous, AirwallexError } from "../airwallex/client.js";
import { AirwallexBudgetSpent } from "../airwallex/callBudget.js";
import { scrubText } from "./client.js";

/** The metadata keys on the PaymentIntent. */
export const TERMS_METADATA_KEYS = { sha: "purser_terms_sha256", proposal: "purser_proposal" } as const;

/** The terms the CFO signed for one purchase: their full SHA-256 and the proposal's id. */
export interface SignedTerms { termsSha256: string; proposalId: string }

const SHA256 = /^[0-9a-f]{64}$/;
const PROPOSAL = /^[A-Za-z0-9._-]{1,64}$/;

/** The metadata for a PaymentIntent create. Throws on a hash that is not a full SHA-256 or an id that is not plain. */
export function termsMetadata(s: SignedTerms): { purser_terms_sha256: string; purser_proposal: string } {
  if (!SHA256.test(s.termsSha256)) throw new Error("the signed terms hash must be a full SHA-256 (64 lowercase hex characters)");
  if (!PROPOSAL.test(s.proposalId)) throw new Error("the proposal id must be 1 to 64 plain characters");
  return { [TERMS_METADATA_KEYS.sha]: s.termsSha256, [TERMS_METADATA_KEYS.proposal]: s.proposalId } as { purser_terms_sha256: string; purser_proposal: string };
}

/** Reads a PaymentIntent's metadata back: what a dry run's stand-in or Airwallex holds for the order. */
export interface IntentMetadataReader {
  readMetadata(reference: string): Promise<Record<string, string> | null>;
}

/** The string values of a metadata object (Airwallex keeps strings); null when there is none. */
function stringsOf(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, (v as string).slice(0, 500)]));
  return Object.keys(out).length ? out : null;
}

/** One GET of the PaymentIntent; its metadata (string values only), or null when it has none. Nothing is changed. */
export async function readIntentMetadata(api: Pick<Airwallex, "call">, id: string): Promise<Record<string, string> | null> {
  const raw = await api.call<unknown>("GET", `/pa/payment_intents/${encodeURIComponent(id)}`);
  return stringsOf((raw as { metadata?: unknown } | null)?.metadata);
}

export interface TermsComparison {
  key: typeof TERMS_METADATA_KEYS.sha;
  expected: string;
  read_back: string | null;
  proposal_expected: string;
  proposal_read_back: string | null;
  /** True only when both the hash and the proposal id read back exactly as signed. */
  equal: boolean;
}

/** Pure: the read-back metadata against the signed terms. */
export function compareTermsMetadata(signed: SignedTerms, metadata: unknown): TermsComparison {
  const m = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const readBack = str(m[TERMS_METADATA_KEYS.sha]);
  const proposal = str(m[TERMS_METADATA_KEYS.proposal]);
  return {
    key: TERMS_METADATA_KEYS.sha, expected: signed.termsSha256, read_back: readBack,
    proposal_expected: signed.proposalId, proposal_read_back: proposal,
    equal: readBack === signed.termsSha256 && proposal === signed.proposalId,
  };
}

export type TermsReadBack = TermsComparison & { payment_intent_id: string; error?: string };

/** The record of one read-back: the PaymentIntent, the comparison and, when the read failed, its code (not equal). */
export async function readBackTerms(reader: IntentMetadataReader, reference: string, signed: SignedTerms): Promise<TermsReadBack> {
  try {
    return { payment_intent_id: reference, ...compareTermsMetadata(signed, await reader.readMetadata(reference)) };
  } catch (e) {
    const error = e instanceof AirwallexError ? scrubText(e.code ?? `HTTP_${e.status}`).slice(0, 100)
      : e instanceof AirwallexBudgetSpent ? "CALL_BUDGET_SPENT" : e instanceof AirwallexAmbiguous ? "AIRWALLEX_NO_ANSWER" : "READ_BACK_FAILED";
    return { payment_intent_id: reference, ...compareTermsMetadata(signed, null), error };
  }
}
