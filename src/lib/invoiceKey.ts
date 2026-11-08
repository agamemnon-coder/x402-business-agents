/**
 * An invoice number as a duplicate check compares it: Unicode-normalised, invisible format characters (zero-width
 * spaces, soft hyphens) removed, upper case, any dash as "-", no spaces around it.
 */
export function invoiceKey(invoiceNo: string): string {
  return invoiceNo.normalize("NFKC").replace(/\p{Cf}/gu, "").toUpperCase().replace(/\s*[‐-―−﹘﹣－-]\s*/g, "-").replace(/\s+/g, "");
}

/**
 * The same number however it is punctuated (red team, 8 November: "BTX-2026-021", "BTX/2026/21", "BTX.2026.21" and
 * "BTX202621" are one invoice): letters and digits only, leading zeros dropped from each group of digits. Coarser than
 * invoiceKey, so a match on this alone is a possible duplicate for a person, never proof of one.
 */
export function invoiceKeyLoose(invoiceNo: string): string {
  const groups = invoiceKey(invoiceNo).match(/[\p{L}]+|\d+/gu) ?? [];
  return groups.map((g) => (/^\d+$/.test(g) ? g.replace(/^0+(?=\d)/, "") : g)).join("");
}

/** Whether two invoice numbers are the same invoice however punctuated (the guard before any money moves). */
export function sameInvoiceNo(a: string, b: string): boolean {
  return invoiceKeyLoose(a) === invoiceKeyLoose(b);
}
