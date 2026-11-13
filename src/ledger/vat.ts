// Dutch VAT as data (docs/archive/superpowers/specs/2026-11-08-bookkeeping-core-design.md, decision 3). A VAT code sits on
// the net line of an entry (revenue, expense or stock) with the VAT amount that was posted for it; the quarterly
// overview (src/ledger/reports.ts) adds them up into the rubrics of the Dutch VAT return. An overview, not a filing.

export type VatRubric = "1a" | "1b" | "1e" | "2a" | "3a" | "3b" | "4a" | "4b";

export interface VatCode {
  code: string;
  label: string;
  kind: "sale" | "purchase";
  /** Percent. */
  rate: number;
  /** Where the net amount (and for 1a, 1b, 2a, 4a, 4b the VAT) goes on the return; null: not on the return. */
  rubric: VatRubric | null;
  /** The buyer owes the VAT (reverse charge): VAT is both owed (5a) and reclaimed (5b). */
  reverse?: boolean;
  /** Purchase VAT reclaimed as input tax (5b). */
  deductible?: boolean;
  /** VAT charged in another country (by a supplier registered there): outside the Dutch return, counted on its own row. */
  foreign?: string;
}

export const VAT_CODES: Record<string, VatCode> = {
  S21: { code: "S21", label: "Sale, 21%", kind: "sale", rate: 21, rubric: "1a" },
  S9: { code: "S9", label: "Sale, 9%", kind: "sale", rate: 9, rubric: "1b" },
  S0: { code: "S0", label: "Sale, 0% or not taxed in the Netherlands", kind: "sale", rate: 0, rubric: "1e" },
  SEU: { code: "SEU", label: "Sale to a business in another EU country", kind: "sale", rate: 0, rubric: "3b" },
  SEXP: { code: "SEXP", label: "Export outside the EU", kind: "sale", rate: 0, rubric: "3a" },
  SEXEMPT: { code: "SEXEMPT", label: "Sale exempt from VAT", kind: "sale", rate: 0, rubric: null },
  P21: { code: "P21", label: "Purchase, 21% (reclaimable)", kind: "purchase", rate: 21, rubric: null, deductible: true },
  P9: { code: "P9", label: "Purchase, 9% (reclaimable)", kind: "purchase", rate: 9, rubric: null, deductible: true },
  PRC_NL: { code: "PRC_NL", label: "Purchase, VAT reverse-charged to us (Netherlands)", kind: "purchase", rate: 21, rubric: "2a", reverse: true, deductible: true },
  PRC_EU: { code: "PRC_EU", label: "Purchase from another EU country (reverse charge)", kind: "purchase", rate: 21, rubric: "4b", reverse: true, deductible: true },
  PRC_NONEU: { code: "PRC_NONEU", label: "Purchase from outside the EU (reverse charge)", kind: "purchase", rate: 21, rubric: "4a", reverse: true, deductible: true },
  P0: { code: "P0", label: "Purchase without VAT", kind: "purchase", rate: 0, rubric: null },
  // A supplier registered for VAT in Germany that charged German VAT (13 Nov): that VAT is Germany's, not on the Dutch
  // return (5b does not take it). It sits on its own row of the overview, so the line is coded, never guessed into 5b.
  PF_DE19: { code: "PF_DE19", label: "Foreign VAT (DE 19%), not reclaimable in the Dutch return", kind: "purchase", rate: 19, rubric: null, foreign: "DE" },
};

/** The VAT on a net amount, rounded half away from zero to whole cents. */
export function vatOn(netCents: number, code: string): number {
  const c = VAT_CODES[code];
  if (!c) throw new Error(`unknown VAT code ${code}`);
  const raw = (Math.abs(netCents) * c.rate) / 100;
  return Math.sign(netCents) * Math.round(raw);
}

/** Printed with every VAT overview. */
export const VAT_NOTICE = "An overview for the Dutch VAT return, computed from the ledger. It is not a filing: filing to the tax authority is a later, certified step, and a person checks the overview first.";
