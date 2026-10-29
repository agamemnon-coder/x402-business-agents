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

/**
 * Ceiling for the Airwallex SWIFT payout fee, reserved before converting. Airwallex does not quote the fee
 * in advance (transfers/validate only answers "OK"); the sandbox charged EUR 13.47 on 2026-10-29.
 */
export const SWIFT_FEE_MAX_EUR_CENTS = 2000;
export const EUR_FLOOR_CENTS = 50_000;
/** The seed step sets committed EUR obligations so free EUR is exactly this, whatever the sandbox starts with. */
export const TARGET_FREE_EUR_CENTS = 150_000;

/** A mandate change waits up to an hour for its approver; it carries no quote that could expire sooner. */
export const MANDATE_PROPOSAL_TTL_MS = 60 * 60 * 1000;

/** A delivered price that differs from the supplier's correction by more than this (0.00005) is refunded. */
export const DATA_TOLERANCE_UNITS = 5;

/**
 * Each agent's company card (K2): a virtual Visa card from Airwallex Issuing, in EUR. The limits are the CFO
 * policy's starting values; the policy (card.<agent>.per_tx / .monthly) is what the card is synced to.
 * Merchants are fictional (Microsoft's sample company names), and so are their prices, chosen to look like
 * ordinary small-business software plans.
 */
export const CARDS: Record<Agent, { firstName: string; email: string; nickname: string; perTxCents: number; monthlyCents: number; buys: string }> = {
  sourcing: { firstName: "Sourcing", email: "agents+sourcing@tidemark-data.example", nickname: "sourcing agent: market data", perTxCents: 3000, monthlyCents: 10000, buys: "market data" },
  support: { firstName: "Support", email: "agents+support@tidemark-data.example", nickname: "support agent: helpdesk tools", perTxCents: 6000, monthlyCents: 15000, buys: "helpdesk seats" },
  treasury: { firstName: "Treasury", email: "agents+treasury@tidemark-data.example", nickname: "treasury agent: finance tools", perTxCents: 2500, monthlyCents: 5000, buys: "bookkeeping software" },
};

/** An agent's request for a higher card limit waits up to an hour for the CFO; it carries no quote that could expire. */
export const CARD_RAISE_TTL_MS = 60 * 60 * 1000;

/** What each agent may buy on its card: software plans (merchant category 5734, computer software stores). */
export const PLANS: Record<string, { agent: Agent; merchant: string; label: string; amountCents: number; mcc: string }> = {
  "market-data-starter": { agent: "sourcing", merchant: "Northwind Market Data", label: "Starter plan, monthly", amountCents: 1999, mcc: "5734" },
  "market-data-pro": { agent: "sourcing", merchant: "Northwind Market Data", label: "Pro plan, monthly (more symbols, faster prices)", amountCents: 4500, mcc: "5734" },
  "helpdesk-2-seats": { agent: "support", merchant: "Tailspin Helpdesk", label: "2 seats, monthly", amountCents: 3800, mcc: "5734" },
  "helpdesk-5-seats": { agent: "support", merchant: "Tailspin Helpdesk", label: "5 seats, monthly", amountCents: 9500, mcc: "5734" },
  "books-starter": { agent: "treasury", merchant: "Contoso Books", label: "Bookkeeping, starter, monthly", amountCents: 1500, mcc: "5734" },
};
