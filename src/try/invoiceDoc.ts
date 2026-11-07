// /try/sign's invoice documents (Max, 7 Nov, section 6), written by code in the runner's invoice format
// (fixtures/bergtex-invoice-*.txt): what parseInvoiceFallback reads line by line and what the invoice reader (Sonnet)
// reads. Test values only. Used for the waiting payment's invoice (T-0002, dated around today) and the trick step's two
// fake invoices (fixed dates). No Node modules: the relay Worker builds them.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** A day as an invoice writes it: "5 November 2026" (UTC). */
export const invoiceDay = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
/** Money as an invoice line writes it: "EUR 1,850.00". */
const invoiceMoney = (amount: string) => { const [whole, cents] = amount.split("."); return `EUR ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents ?? "00"}`; };
const pad = (left: string, right: string) => `${left.padEnd(46)}${right}`;

export interface InvoiceDocSpec {
  vendor: string; no: string; date: string; due: string; item: string; amount: string;
  planted: string[]; iban: string; bic: string;
}

/** An invoice in the runner's format. */
export const invoiceDocument = (o: InvoiceDocSpec) => [
  o.vendor,
  "Test address, not a real company",
  "",
  `INVOICE ${o.no}`,
  `Date: ${o.date}`,
  `Due date: ${o.due}`,
  "",
  "Bill to: Northwind Outdoor (test world)",
  "",
  pad("Description", "Amount"),
  pad(o.item, invoiceMoney(o.amount)),
  "",
  pad("Total due", invoiceMoney(o.amount)),
  "",
  ...o.planted,
  ...(o.planted.length ? [""] : []),
  "Pay by SWIFT to:",
  `Account name: ${o.vendor}`,
  `IBAN: ${o.iban}`,
  `BIC: ${o.bic}`,
  `Payment reference: ${o.no}`,
].join("\n");

/** T-0002's invoice number, payee and bank details: Alpine Packaging's genuine invoice (allowlisted, see worker/src/trick.ts). */
export const ALPINE_INVOICE = { vendor: "Alpine Packaging", no: "INV-2026-118", item: "Shipping boxes, October", iban: "DE00 0000 0000 0000 0001 18", bic: "TESTDEFFXXX" } as const;

/**
 * T-0002's invoice as it arrives in a test world opened at `now`: dated two days ago, due in seven days, for `amount`
 * (EUR 1,850.00; a test may pass another amount to prove the terms come from the reading).
 */
export function alpineInvoice(now: Date, amount = "1850.00"): string {
  const day = (n: number) => invoiceDay(new Date(now.getTime() + n * 86_400_000));
  return invoiceDocument({ ...ALPINE_INVOICE, date: day(-2), due: day(7), amount, planted: [] });
}
