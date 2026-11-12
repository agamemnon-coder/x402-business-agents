// Pilot pricing (12 Nov), in one place. One model, said the same everywhere: a monthly plan by the number of supplier
// invoices, plus a small fee per payout. /pricing (src/redesign/pricing.ts), the business lines (PRICE_LINE in
// src/config/brand.ts: the README, /proof, the deck, the form), the unit economics (src/business/unitEconomics.ts) and
// the tests read every figure from here, so no price is typed into a page or a doc by hand. These are pilot prices for
// design partners; nothing is on sale yet and no customer has seen a price. Amounts are whole euro cents, never floats.

import { FEE_BPS_CAP } from "../airwallex/platform.js";

export const PRICING = {
  /** Starter: a monthly price with a number of invoices included, then a price per extra invoice. */
  starter: { name: "Starter", monthlyCents: 4900, invoicesIncluded: 100, extraInvoiceCents: 25 },
  /** Business: a starting price a month; what it adds is listed, not priced one by one. */
  business: { name: "Business", fromMonthlyCents: 24900, includes: ["Several companies", "Four-eyes approval", "Bookkeeping connectors"] },
  /**
   * The platform fee: a small fee per payout, collected through Airwallex connected accounts. Its rate is not a price
   * set here: it is a percentage in the policy the CFO signs (platform.fee_bps, src/policy/rules.ts), and code never
   * lets it pass `capBps` (FEE_BPS_CAP, src/airwallex/platform.ts). What ran is in the two run records of 10 November;
   * the pages and docs read the test fees and the test payouts from them and label them test values.
   */
  platformFee: {
    name: "Platform fee",
    /** The first sandbox payout with a fee: a fixed test fee passed straight to the payout code. */
    runRecord: "docs/runs/2026-11-10-connected-accounts-sandbox.md",
    /** The end-to-end sandbox run later that day: the fee came from the test policy's rate. */
    e2eRecord: "docs/runs/2026-11-10-platform-e2e.md",
    /** The most the fee can be, in basis points of the payout: the ceiling the paying code enforces. */
    capBps: FEE_BPS_CAP,
    /** The rate in the test policy of the end-to-end run (src/e2e/setup.ts sets it from here). A test value, not a price. */
    testPolicyBps: 50,
  },
} as const;

/** Whole cents as a euro price: "€49" when the cents are zero, else "€0.25". */
export function euro(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`not a whole, positive number of cents: ${cents}`);
  const whole = Math.floor(cents / 100), rest = cents % 100;
  return `€${whole.toLocaleString("en-US")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** Basis points as a percentage with two decimals: 50 is "0.50%". */
export function percentOfBps(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) throw new Error(`not a rate in basis points: ${bps}`);
  return `${(bps / 100).toFixed(2)}%`;
}

/** What the prices are called wherever they are said: pilot prices, not a price list. */
export const PRICING_LABEL = "Pilot pricing";
/** The one model in one sentence, built from the figures above. Said word for word wherever a price is given. */
export const PRICING_LINE = `${PRICING.starter.name} ${euro(PRICING.starter.monthlyCents)} a month (${PRICING.starter.invoicesIncluded} invoices, then ${euro(PRICING.starter.extraInvoiceCents)} each); ${PRICING.business.name} from ${euro(PRICING.business.fromMonthlyCents)} a month; a small fee per payout.`;
/** The sentence with its label, as the README, docs/business/model.md and docs/after-the-kit.md state it. */
export const PRICING_STATEMENT = `${PRICING_LABEL}: ${PRICING_LINE}`;
