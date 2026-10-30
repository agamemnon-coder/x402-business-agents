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

/** The simulated customer's own mandate (Summit Outfitters pays us under it). */
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
export const EUR_FLOOR_CENTS = 2_500_000;
/** The seed step sets committed EUR obligations so free EUR is exactly this, whatever the sandbox starts with. */
export const TARGET_FREE_EUR_CENTS = 150_000;

/** A mandate change waits up to an hour for its approver; it carries no quote that could expire sooner. */
export const MANDATE_PROPOSAL_TTL_MS = 60 * 60 * 1000;

/**
 * Velocity limits (security item 2): an agent that pays more often or more in total than this, in a sliding minute or
 * hour, is stopped by code at once; only the CFO's Face ID lifts the stop. Set well above the busiest live run so far
 * (rehearsal 3: the operations agent peaked at 18 payments in a minute and 52 in an hour). Metal amounts are *USDZ
 * cents, card amounts EUR cents; a declined card attempt counts towards the minute, not towards the amount.
 */
export const VELOCITY: Record<Agent | "outside", { perMinute: number; usdzPerHourCents: number; eurPerHourCents: number }> = {
  sourcing: { perMinute: 30, usdzPerHourCents: 400, eurPerHourCents: 10_000 },
  support: { perMinute: 10, usdzPerHourCents: 150, eurPerHourCents: 15_000 },
  treasury: { perMinute: 5, usdzPerHourCents: 800, eurPerHourCents: 5_000 },
  outside: { perMinute: 10, usdzPerHourCents: 0, eurPerHourCents: 10_000 },
};

/** A delivered stock level that differs from the supplier's correction by more than this many units is refunded. */
export const DATA_TOLERANCE_UNITS = 0;

/**
 * Each agent's company card (K2): a virtual Visa card from Airwallex Issuing, in EUR. The limits are the CFO
 * policy's starting values; the policy (card.<agent>.per_tx / .monthly) is what the card is synced to.
 * Merchants are fictional, and so are their prices, chosen to look like an outdoor brand's ordinary tools: warehouse
 * software, ads and bookkeeping.
 */
export const CARDS: Record<Agent, { firstName: string; email: string; nickname: string; perTxCents: number; monthlyCents: number; buys: string }> = {
  sourcing: { firstName: "Operations", email: "agents+sourcing@northwind-outdoor.example", nickname: "operations agent: warehouse software", perTxCents: 3000, monthlyCents: 10000, buys: "warehouse software" },
  support: { firstName: "Sales", email: "agents+support@northwind-outdoor.example", nickname: "sales agent: ads", perTxCents: 6000, monthlyCents: 15000, buys: "ads" },
  treasury: { firstName: "Finance", email: "agents+treasury@northwind-outdoor.example", nickname: "finance agent: bookkeeping", perTxCents: 2500, monthlyCents: 5000, buys: "bookkeeping software" },
};

/** A locked FX quote may cost at most this much (basis points) above the market's current rate; dearer, it escalates. */
export const FX_QUOTE_MAX_MARKUP_BPS = 50;

/** A card works this many days from issue; Airwallex declines everything after (its end date, `active_to`). */
export const CARD_ACTIVE_DAYS = 90;

/** What an outside agent's card may pay (merchant category 5734); the CFO approves anything else as a policy change. */
export const OUTSIDE_AGENT_MCCS = ["5734"];

/** An agent's request for a higher card limit waits up to an hour for the CFO; it carries no quote that could expire. */
export const CARD_RAISE_TTL_MS = 60 * 60 * 1000;

/** What each agent may buy on its card: software plans (merchant category 5734, computer software stores) and ads (7311, advertising services). */
export const PLANS: Record<string, { agent: Agent; merchant: string; label: string; amountCents: number; mcc: string }> = {
  "packwise-starter": { agent: "sourcing", merchant: "Packwise", label: "Starter plan, monthly", amountCents: 1999, mcc: "5734" },
  "packwise-pro": { agent: "sourcing", merchant: "Packwise", label: "Pro plan, monthly (more warehouses, live sync)", amountCents: 4500, mcc: "5734" },
  "adwave-starter": { agent: "support", merchant: "Adwave", label: "Ads credit, starter", amountCents: 3800, mcc: "7311" },
  "adwave-growth": { agent: "support", merchant: "Adwave", label: "Ads credit, growth", amountCents: 9500, mcc: "7311" },
  "ledgerly-starter": { agent: "treasury", merchant: "Ledgerly", label: "Bookkeeping, starter, monthly", amountCents: 1500, mcc: "5734" },
  // Not a plan the agent should buy: warehouse software on the sales card, which may pay only ads (a demo moment).
  "packwise-on-sales-card": { agent: "support", merchant: "Packwise", label: "Starter plan, monthly, on the sales card", amountCents: 1999, mcc: "5734" },
};
