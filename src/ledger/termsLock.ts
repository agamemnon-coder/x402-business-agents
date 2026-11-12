// The third lock on a signed payment (master list 77): the books. Payment refuses terms that no longer hash to what the
// CFO signed (src/policy/approvals.ts beginExecution); tokenizing refuses them too (src/tokenize/record.ts
// approvedInvoice). Booking does the same before it posts an accrual or a payment that a signed proposal speaks for:
// it recomputes the hash of the stored terms and compares it with the hash in the approval. On a mismatch it refuses
// with a plain sentence that quotes the signed hash, and nothing is posted.

import type { DB } from "../db/open.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { toCents } from "../lib/money.js";
import { LedgerRefused } from "./core.js";

export interface SignedTerms {
  proposal_id: string;
  /** The hash the CFO signed (approvals.approved_sha256). */
  signed_sha256: string;
  terms: Terms & { amount?: string; currency?: string; invoice_no?: string };
}

const hasTables = (db: DB) =>
  (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('proposals', 'approvals')").get() as { n: number }).n === 2;

/**
 * Why booking must refuse what `proposalId` speaks for, or null when it may post. A proposal without an approval, or
 * one that was rejected, has nothing signed to compare with: null (the payment lock refuses to pay it anyway).
 * `expect` is what the booking itself carries: an amount in cents and a currency, compared with the signed terms.
 */
export function signedTermsRefusal(db: DB, proposalId: string, expect?: { amount_cents?: number; currency?: string }): string | null {
  if (!hasTables(db)) return null;
  const p = db.prepare("SELECT terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string; terms_sha256: string } | undefined;
  const a = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(proposalId) as { approved_sha256: string; decision: string } | undefined;
  if (!p || !a || a.decision !== "APPROVED") return null;
  const signed = a.approved_sha256;
  let now: string;
  let terms: SignedTerms["terms"];
  try {
    terms = JSON.parse(p.terms_json) as SignedTerms["terms"];
    now = termsHash(terms);
  } catch {
    return `Not booked: the stored terms of ${proposalId} can no longer be read, so they cannot match the signed hash ${signed}.`;
  }
  if (now !== signed || p.terms_sha256 !== signed) {
    return `Not booked: the stored terms of ${proposalId} hash to ${now}, but the CFO signed ${signed}. Something changed after the approval.`;
  }
  if (expect?.amount_cents !== undefined && terms.amount && /^\d+\.\d{2}$/.test(terms.amount) && toCents(terms.amount) !== expect.amount_cents) {
    return `Not booked: the invoice says ${expect.amount_cents} cents, but the terms the CFO signed (${signed}) say ${toCents(terms.amount)} cents.`;
  }
  if (expect?.currency && terms.currency && terms.currency !== expect.currency) {
    return `Not booked: the invoice is in ${expect.currency}, but the terms the CFO signed (${signed}) are in ${terms.currency}.`;
  }
  return null;
}

/** Throws LedgerRefused with the plain sentence when booking must refuse; nothing is posted. */
export function assertSignedTerms(db: DB, proposalId: string, expect?: { amount_cents?: number; currency?: string }): void {
  const why = signedTermsRefusal(db, proposalId, expect);
  if (why) throw new LedgerRefused(why);
}
