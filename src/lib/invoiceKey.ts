import { CONFUSABLES } from "../policy/fraudCore.js";

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
