import { CONFUSABLES, skeleton } from "../policy/fraudCore.js";

/**
 * An invoice number as a duplicate check compares it: Unicode-normalised, invisible format characters (zero-width
 * spaces, soft hyphens) removed, upper case, any dash as "-", no spaces around it.
 */
export function invoiceKey(invoiceNo: string): string {
  return invoiceNo.normalize("NFKC").replace(/\p{Cf}/gu, "").toUpperCase().replace(/\s*[‐-―−﹘﹣－-]\s*/g, "-").replace(/\s+/g, "");
}

/** A decimal digit of any script ("٢", "२", "２") as its value, or null. Unicode keeps each script's 0-9 in one run of ten. */
function digitValue(ch: string): number | null {
  if (!/^\p{Nd}$/u.test(ch)) return null;
  let cp = ch.codePointAt(0)!;
  let start = cp;
  while (/^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
  cp -= start;
  return cp % 10;
}

/**
 * One character as a reader sees it in a number: any script's digit as its ASCII digit; a lookalike letter as its Latin
 * one (the fraud check's confusables: Cyrillic "В" is "b"); and "O" as zero, "I" and "l" as one, which a number's
 * reader cannot tell apart (red team round 2: "ВTX-2026-21", "BTX-2O26-21", "BTX-2026-2l", "BTX-٢٠٢٦-٢١").
 */
function seen(ch: string): string {
  const d = digitValue(ch);
  if (d !== null) return String(d);
  const lower = ch.toLowerCase();
  const latin = CONFUSABLES[lower] ?? lower;
  return latin === "o" ? "0" : latin === "l" || latin === "i" ? "1" : latin;
}

/**
 * The same number however it is punctuated or written (red team, 8 November: "BTX-2026-021", "BTX/2026/21",
 * "BTX.2026.21" and "BTX202621" are one invoice; round 2: lookalike letters and other scripts' digits too): what a
 * reader sees, letters and digits only, leading zeros dropped from each group of digits. Coarser than invoiceKey, so a
 * match on this alone is a possible duplicate for a person, never proof of one.
 */
export function invoiceKeyLoose(invoiceNo: string): string {
  const shown = [...invoiceKey(invoiceNo).normalize("NFKD").replace(/\p{M}/gu, "")].map(seen).join("");
  const groups = shown.match(/[\p{L}]+|\d+/gu) ?? [];
  return groups.map((g) => (/^\d+$/.test(g) ? g.replace(/^0+(?=\d)/, "") : g)).join("");
}

/** Whether two invoice numbers are the same invoice however punctuated (the guard before any money moves). */
export function sameInvoiceNo(a: string, b: string): boolean {
  return invoiceKeyLoose(a) === invoiceKeyLoose(b);
}

/** The separator the payables inbox puts between a supplier's number and its name in the payment ledger (src/ap/ledgerKey.ts). */
export const LEDGER_SEPARATOR = " · ";

/** Who an invoice in the payment ledger is from, as far as is known: the supplier's name and its account's hash. */
export interface LedgerParty { vendor?: string | null; accountSha256?: string | null }

/** A ledger number split into the supplier's own number and, for the inbox's form "NUM · Supplier", the supplier. */
export function ledgerParts(ledgerNo: string): { no: string; vendor: string | null } {
  const at = ledgerNo.lastIndexOf(LEDGER_SEPARATOR);
  return at < 0 ? { no: ledgerNo, vendor: null } : { no: ledgerNo.slice(0, at), vendor: ledgerNo.slice(at + LEDGER_SEPARATOR.length).trim() || null };
}

/**
 * Whether two payment-ledger numbers are the same invoice (red team round 3: the inbox files "BTX-2026-21 · Bergtex
 * Textil GmbH", Kit 11 the bare "BTX-2026-21", and each guard missed the other): the supplier's numbers are the same
 * however written, and the supplier is the same, by name (its skeleton) or by the account it is paid to (a supplier on
 * file under a second name: round 3). An invoice whose supplier is not known matches any supplier's: before money
 * moves, the guard errs on refusing.
 */
export function sameLedgerInvoice(a: string, aParty: LedgerParty, b: string, bParty: LedgerParty): boolean {
  const x = ledgerParts(a);
  const y = ledgerParts(b);
  if (!sameInvoiceNo(x.no, y.no)) return false;
  const xv = x.vendor ?? aParty.vendor ?? null;
  const yv = y.vendor ?? bParty.vendor ?? null;
  if (!xv || !yv) return true;
  if (skeleton(xv) === skeleton(yv)) return true;
  return !!aParty.accountSha256 && aParty.accountSha256 === bParty.accountSha256;
}
