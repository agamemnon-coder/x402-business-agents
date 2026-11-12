// Invoice token financing in the books (master list 126). A company's own sales invoice, tokenized (docs/tokenize.md),
// is sold to a financier at a discount. On testnet the financier is a test key: the account is named "Simulated
// financier (testnet)" and every report shows that name.
//
// Two treatments, chosen by the flow's terms:
// - "liability" (with recourse, the default): on financing the bank receives the price and the company owes the
//   financier the price (2150); at settlement the debtor pays the face value to the token holder, which clears the
//   receivable (1300) and what is owed to the financier, and the discount is posted as a finance cost (7100).
// - "derecognise" (without recourse): on financing the bank receives the price, the discount is a finance cost at once
//   and the receivable is gone; nothing is posted at settlement.
//
// Each entry carries the CFO's Face ID hash (approval_sha256) and the chain's transaction hash (rail_ref) next to the
// document's hash. Integer cents only: the price is the face value less the discount in basis points, rounded down to
// a whole cent, exactly as the token contract's price (src/tokenize/flow.ts discountedPrice).

import type { DB } from "../db/open.js";
import { FINANCE_COST, FINANCIER, isBank, RECEIVABLES } from "./accounts.js";
import { LedgerRefused, postEntry, type LineInput, type Posted } from "./core.js";
import { openAmount } from "./documents.js";

export const SIMULATED_FINANCIER = "Simulated financier (testnet)";

export type FinancingMode = "liability" | "derecognise";

export interface FinancingTerms { face_cents: number; discount_bps: number; price_cents: number; discount_cents: number }

/** The price and the discount, in whole cents: price rounded down to a cent, so price + discount is the face value. */
export function financingTerms(faceCents: number, discountBps: number): FinancingTerms {
  if (!Number.isSafeInteger(faceCents) || faceCents <= 0) throw new LedgerRefused("the face value is whole cents above zero");
  if (!Number.isInteger(discountBps) || discountBps <= 0 || discountBps >= 10_000) throw new LedgerRefused("the discount is 1 to 9999 basis points");
  const price = Number((BigInt(faceCents) * BigInt(10_000 - discountBps)) / 10_000n);
  return { face_cents: faceCents, discount_bps: discountBps, price_cents: price, discount_cents: faceCents - price };
}

interface Common {
  date: string;
  /** The invoice's number, as on its receivable line (1300). */
  doc_ref: string;
  /** The customer who owes the invoice. */
  party: string;
  currency: string;
  face_cents: number;
  discount_bps: number;
  /** The CFO's Face ID hash of the financing proposal's terms. */
  approval_sha256: string;
  /** The transaction hash on chain (the financier's accept, or the debtor's settle). */
  rail_ref: string;
  doc_sha256?: string;
  created_by: string;
  mode?: FinancingMode;
}

/** A financing step already posted under its key: the replay is that entry (a retried webhook, a re-run). */
function already(db: DB, key: string, c: Common): (Posted & FinancingTerms) | null {
  const had = db.prepare("SELECT entry_id, posting_date FROM ledger_entries WHERE source_key = ?").get(key) as { entry_id: number; posting_date: string } | undefined;
  return had ? { ...had, duplicate: true, ...financingTerms(c.face_cents, c.discount_bps) } : null;
}

function check(db: DB, c: Common): FinancingTerms {
  if (!c.approval_sha256 || !c.rail_ref) throw new LedgerRefused("a financing entry carries the approval hash and the transaction hash");
  const t = financingTerms(c.face_cents, c.discount_bps);
  const open = openAmount(db, "receivables", c.party, c.doc_ref, c.currency);
  if (open === null) throw new LedgerRefused(`no open customer invoice ${c.doc_ref} for ${c.party} in ${c.currency}`);
  if (open < c.face_cents) throw new LedgerRefused(`${c.doc_ref} has ${open} cents open; the token's face value is ${c.face_cents}`);
  return t;
}

/** The financier pays the price: posted on the financier's accept. */
export function postFinancing(db: DB, f: Common & { bank: string }, now = new Date()): Posted & FinancingTerms {
  if (!isBank(f.bank)) throw new LedgerRefused(`${f.bank} is not a bank account`);
  const key = `token-financed:${f.doc_ref}:${f.rail_ref}`;
  const had = already(db, key, f);
  if (had) return had;
  const t = check(db, f);
  const item = { currency: f.currency, doc_ref: f.doc_ref };
  const lines: LineInput[] = (f.mode ?? "liability") === "liability"
    ? [{ account: f.bank, debit: t.price_cents, ...item, memo: `price paid by the ${SIMULATED_FINANCIER.toLowerCase()}` },
      { account: FINANCIER, credit: t.price_cents, ...item, party: SIMULATED_FINANCIER, memo: "owed to the financier until the debtor settles" }]
    : [{ account: f.bank, debit: t.price_cents, ...item, memo: `price paid by the ${SIMULATED_FINANCIER.toLowerCase()}` },
      { account: FINANCE_COST, debit: t.discount_cents, ...item, memo: `discount ${f.discount_bps} bp` },
      { account: RECEIVABLES, credit: t.face_cents, ...item, party: f.party, memo: "sold to the financier without recourse" }];
  const posted = postEntry(db, {
    date: f.date, description: `Invoice ${f.doc_ref} financed by the ${SIMULATED_FINANCIER.toLowerCase()}`, created_by: f.created_by, source_key: key,
    doc_ref: f.doc_ref, doc_sha256: f.doc_sha256, approval_sha256: f.approval_sha256, rail_ref: f.rail_ref, lines,
  }, now);
  return { ...posted, ...t };
}

/** The debtor settles the token: the face value goes to the holder. Only the "liability" treatment posts here. */
export function postFinancingSettlement(db: DB, s: Common, now = new Date()): (Posted & FinancingTerms) | null {
  if ((s.mode ?? "liability") === "derecognise") return null;
  const key = `token-settled:${s.doc_ref}:${s.rail_ref}`;
  const had = already(db, key, s);
  if (had) return had;
  const t = check(db, s);
  const item = { currency: s.currency, doc_ref: s.doc_ref };
  const posted = postEntry(db, {
    date: s.date, description: `Invoice ${s.doc_ref} settled to the token holder; discount as finance cost`, created_by: s.created_by, source_key: key,
    doc_ref: s.doc_ref, doc_sha256: s.doc_sha256, approval_sha256: s.approval_sha256, rail_ref: s.rail_ref,
    lines: [
      { account: FINANCIER, debit: t.price_cents, ...item, party: SIMULATED_FINANCIER, memo: "the financier is paid by the debtor's settlement" },
      { account: FINANCE_COST, debit: t.discount_cents, ...item, memo: `discount ${s.discount_bps} bp` },
      { account: RECEIVABLES, credit: t.face_cents, ...item, party: s.party, memo: "settled to the token holder" },
    ],
  }, now);
  return { ...posted, ...t };
}
