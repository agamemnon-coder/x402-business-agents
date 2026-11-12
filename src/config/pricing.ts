// Pilot pricing (12 Nov), in one place: /pricing (src/redesign/pricing.ts) and test/saas-pages.test.ts read every figure
// from here, so no price is typed into page text. These are pilot prices for design partners; nothing is on sale yet.
// Amounts are whole euro cents, never floats.

export const PRICING = {
  /** Starter: a monthly price with a number of invoices included, then a price per extra invoice. */
  starter: { name: "Starter", monthlyCents: 4900, invoicesIncluded: 100, extraInvoiceCents: 25 },
  /** Business: a starting price a month; what it adds is listed, not priced one by one. */
  business: { name: "Business", fromMonthlyCents: 24900, includes: ["Several companies", "Four-eyes approval", "Bookkeeping connectors"] },
  /**
   * The platform fee: a small fee per payout, collected through Airwallex connected accounts. No amount is set here.
   * What ran is in the run record; the page reads the test fee and the test payout from it and labels them test values.
   */
  platformFee: { name: "Platform fee", runRecord: "docs/runs/2026-11-10-connected-accounts-sandbox.md" },
} as const;

/** Whole cents as a euro price: "€49" when the cents are zero, else "€0.25". */
export function euro(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`not a whole, positive number of cents: ${cents}`);
  const whole = Math.floor(cents / 100), rest = cents % 100;
  return `€${whole.toLocaleString("en-US")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}
