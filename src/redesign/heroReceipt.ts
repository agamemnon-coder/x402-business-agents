// The receipt Home's hero checks in the visitor's browser (step 4): a file in the repository's own receipt format
// (purser.try-sign-receipt/v1, src/try/receipt.ts; `npm run verify-receipt -- docs/demo/hero-receipt.json` checks it).
// The hero reads everything step 4 shows from this file: the terms, the hash the passkey signed, the public key.
//
// SWAPPING THE FILE needs no code change: put any valid receipt for the same payment (the invoice number and the amount
// of the Airwallex-only run's record, docs/demo/airwallex-run.json) at HERO_RECEIPT_FILE. When its terms_sha256 is the
// hash that record holds for the invoice, the page says step 4 checks the recorded approval itself; otherwise its note
// must call it a sample signed with a test key, and the page says that. Anything else, a missing file or one that does
// not verify: the hero is not rendered and test/home-story.test.ts fails.
//
// Today no complete record of that approval is public (the run record has its hash and transfer, not its terms nor the
// passkey assertion), so the committed file is a labelled sample, written once by `npm run hero-receipt`
// (src/cli/heroReceipt.ts): the same invoice's terms, built by Purser's own code in an offline test world and signed
// with a software key that lived in memory only.

import { existsSync, readFileSync } from "node:fs";
import { RECEIPT_FORMAT, verifyReceipt, type TryReceipt } from "../try/receipt.js";

export const HERO_RECEIPT_FILE = "docs/demo/hero-receipt.json";
/** The sample's relying party: a name under .test, which no site can ever have. */
export const HERO_SAMPLE_RP = "hero-sample.purser.test";
export const HERO_SAMPLE_ORIGIN = `https://${HERO_SAMPLE_RP}`;

/** What the browser's check needs, and nothing else: the page's data block is exactly this. */
export type HeroReceiptData = Pick<TryReceipt, "receipt" | "terms" | "terms_sha256" | "algorithm" | "public_key" | "rp_id" | "origin" | "assertion">;
export const HERO_DATA_KEYS = ["receipt", "terms", "terms_sha256", "algorithm", "public_key", "rp_id", "origin", "assertion"] as const;

export interface HeroReceipt {
  /** "recorded": the approval the run record holds; "sample": the same terms signed with a test key, and labelled so. */
  kind: "recorded" | "sample";
  data: HeroReceiptData;
  /** The terms step 4 shows and lets the visitor change. */
  shown: { invoice: string; payee: string; amount: string; currency: string; ibanLast4: string };
  /** The receipt's own note: what it is, in the file's words ("What's real?" quotes it). */
  note: string;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * The hero's receipt, from a file of the repository (or an already parsed receipt), held against the run record's
 * facts: null when it is missing, does not verify, is not for that invoice and amount, or is neither the recorded
 * approval nor marked as a sample signed with a test key.
 */
export function heroReceipt(facts: { invoice: string; amount: string; hash: string } | null, source: string | object = HERO_RECEIPT_FILE): HeroReceipt | null {
  if (!facts) return null;
  let r: Partial<TryReceipt>;
  if (typeof source === "string") {
    const url = new URL(`../../${source}`, import.meta.url);
    if (!existsSync(url)) return null;
    try { r = JSON.parse(readFileSync(url, "utf8")) as Partial<TryReceipt>; } catch { return null; }
  } else r = source as Partial<TryReceipt>;
  if (!verifyReceipt(r).ok) return null;
  const R = r as TryReceipt, t = R.terms;
  if (![t.invoice_no, t.beneficiary_name, t.amount, t.currency, t.iban_last4].every(str)) return null;
  if (t.invoice_no !== facts.invoice || t.amount !== facts.amount) return null;
  const note = typeof R.note === "string" ? R.note : "";
  const kind = R.terms_sha256 === facts.hash ? "recorded" : /\bsample\b/i.test(note) && /\btest key\b/i.test(note) ? "sample" : null;
  if (!kind) return null;
  return {
    kind, note,
    data: { receipt: RECEIPT_FORMAT, terms: t, terms_sha256: R.terms_sha256, algorithm: R.algorithm, public_key: { kty: "EC", crv: "P-256", x: R.public_key.x, y: R.public_key.y }, rp_id: R.rp_id, origin: R.origin, assertion: { authenticatorData: R.assertion.authenticatorData, clientDataJSON: R.assertion.clientDataJSON, signature: R.assertion.signature } },
    shown: { invoice: t.invoice_no as string, payee: t.beneficiary_name as string, amount: t.amount as string, currency: t.currency as string, ibanLast4: t.iban_last4 as string },
  };
}
