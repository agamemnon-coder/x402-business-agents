/** An invoice number as a duplicate check compares it: Unicode-normalised, upper case, any dash as "-", no spaces around it. */
export function invoiceKey(invoiceNo: string): string {
  return invoiceNo.normalize("NFKC").toUpperCase().replace(/\s*[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]\s*/g, "-").replace(/\s+/g, "");
}
