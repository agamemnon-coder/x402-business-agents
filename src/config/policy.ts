// Every number that limits money lives here. Claude never sets one of these; code does.
// Amounts are integer cents (*USDZ cents on Metal, EUR/USD cents on Airwallex).

export type Agent = "sourcing" | "support" | "treasury";
export const AGENTS: readonly Agent[] = ["sourcing", "support", "treasury"];

/** The account caps each mandate, not their sum, so the 20.00 total is held here. */
export const TOTAL_BUDGET_CENTS = 2000;

export const INITIAL_MANDATES: Record<Agent, { capCents: number; budgetCents: number; payee: "supplier" | "customer" | "sweep" }> = {
  sourcing: { capCents: 3, budgetCents: 1000, payee: "supplier" },
  support: { capCents: 10, budgetCents: 400, payee: "customer" },
  treasury: { capCents: 600, budgetCents: 600, payee: "sweep" },
};

/** The simulated customer's own mandate (Kestrel Quant pays us under it). */
export const CUSTOMER_MANDATE = { capCents: 10, budgetCents: 500 };

export const SELL_PRICE_CENTS = 5;
export const ALT_SELL_PRICE_CENTS = 7;
export const UPSTREAM_PRICE_CENTS = 2;
export const RAISED_UPSTREAM_PRICE_CENTS = 4;

/** 40 days, so mandates bound in the build phase still work on Demo Day (Nov 19). */
export const MANDATE_EXPIRES_IN_SECONDS = 40 * 24 * 60 * 60;

/** Refunds at or under these limits run on their own; anything larger waits for a person. */
export const REFUND_AUTO_EACH_CENTS = 10;
export const REFUND_AUTO_PER_DISPUTE_CENTS = 20;

/** A proposal lives 10 minutes, and never past its FX quote's expiry minus 30 seconds. */
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;
export const QUOTE_SAFETY_MS = 30 * 1000;

/** Flat Airwallex SWIFT payout fee, added before converting. */
export const SWIFT_FEE_EUR_CENTS = 1285;
export const EUR_FLOOR_CENTS = 50_000;
/** The seed step sets committed EUR obligations so free EUR is exactly this, whatever the sandbox starts with. */
export const TARGET_FREE_EUR_CENTS = 150_000;

/** A mandate change waits up to an hour for its approver; it carries no quote that could expire sooner. */
export const MANDATE_PROPOSAL_TTL_MS = 60 * 60 * 1000;

/** A delivered price that differs from the supplier's correction by more than this (0.00005) is refunded. */
export const DATA_TOLERANCE_UNITS = 5;
