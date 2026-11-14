// Every number that limits money lives here. Claude never sets one of these; code does.
// Amounts are integer cents (*USDZ cents on Alta, EUR/USD cents on Airwallex).

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

/**
 * Kit 11: the treasury (Finance) agent pays a monthly licence fee invoiced in euros, kept in code. Stockline's data
 * licence: the right to resell its stock checks. An invoice from the licensor for any other amount waits for a person.
 */
export const LICENCE_FEE_EUR_CENTS = 24_000;
export const LICENSOR_NAME = "Stockline Data GmbH";
/** The licence invoice `npm run licence` and the Treasury agent's plan_invoice plan (in fixtures/). */
export const LICENCE_INVOICE_FIXTURE = "stockline-licence-SLL-2026-11.txt";
/** Payees whose invoices must match a contracted amount in code exactly. */
export const CONTRACTED_EUR_CENTS: Record<string, number> = { [LICENSOR_NAME]: LICENCE_FEE_EUR_CENTS };

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
 * An invoice payment (the licence) waits 20 minutes for the CFO's Face ID (Max, 2 Nov: P-0006 expired at 10). An FX
 * quote still caps it at the quote's expiry minus 30 seconds; other proposals keep PROPOSAL_TTL_MS.
 */
export const INVOICE_PROPOSAL_TTL_MS = 20 * 60 * 1000;

/**
 * Ceiling for the Airwallex SWIFT payout fee, reserved before converting. Airwallex does not quote the fee
 * in advance (transfers/validate only answers "OK"); the sandbox charged EUR 13.47 on 2026-10-29 and EUR 13.36 to 13.40
 * on 2026-11-02 (the stand-in charges SANDBOX_SWIFT_FEE_CENTS, src/redteam/airwallex.ts).
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
 * (rehearsal 3: the sourcing agent peaked at 18 payments in a minute and 52 in an hour). Alta amounts are *USDZ
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
 * Merchants are fictional, and so are their prices, chosen to fit each agent's Kit 11 job: warehouse and data
 * software for sourcing, helpdesk software for support, bookkeeping for treasury.
 */
export const CARDS: Record<Agent, { firstName: string; email: string; nickname: string; perTxCents: number; monthlyCents: number; buys: string }> = {
  sourcing: { firstName: "Sourcing", email: "agents+sourcing@northwind-outdoor.example", nickname: "sourcing agent: warehouse and data software", perTxCents: 3000, monthlyCents: 10000, buys: "warehouse and data software" },
  support: { firstName: "Support", email: "agents+support@northwind-outdoor.example", nickname: "support agent: helpdesk software", perTxCents: 6000, monthlyCents: 15000, buys: "helpdesk software" },
  treasury: { firstName: "Treasury", email: "agents+treasury@northwind-outdoor.example", nickname: "treasury agent: bookkeeping", perTxCents: 2500, monthlyCents: 5000, buys: "bookkeeping software" },
};

/** A locked FX quote may cost at most this much (basis points) above the market's current rate; dearer, it escalates. */
export const FX_QUOTE_MAX_MARKUP_BPS = 50;

/** A card works this many days from issue; Airwallex declines everything after (its end date, `active_to`). */
export const CARD_ACTIVE_DAYS = 90;

/** Merchant categories (MCC) in words, as the pages show them. */
export const MCC_WORDS: Record<string, string> = { "5734": "Software", "7372": "Software services", "7311": "Advertising", "5192": "Books and reports", "4511": "Airlines", "7011": "Hotels", "4112": "Railways" };

/** What an outside agent's card may pay (merchant category 5734); the CFO approves anything else as a policy change. */
export const OUTSIDE_AGENT_MCCS = ["5734"];

/** An agent's request for a higher card limit waits up to an hour for the CFO; it carries no quote that could expire. */
export const CARD_RAISE_TTL_MS = 60 * 60 * 1000;

/**
 * What each agent may buy on its card: warehouse and bookkeeping software (merchant category 5734, computer software
 * stores) and helpdesk software (7372, computer programming and data processing services). Advertising (7311) stays
 * in MCC_WORDS and the GL map only for the 30 October recording, when the Support agent's card bought ads.
 */
export const PLANS: Record<string, { agent: Agent; merchant: string; label: string; amountCents: number; mcc: string }> = {
  "packwise-starter": { agent: "sourcing", merchant: "Packwise", label: "Starter plan, monthly", amountCents: 1999, mcc: "5734" },
  "packwise-pro": { agent: "sourcing", merchant: "Packwise", label: "Pro plan, monthly (more warehouses, live sync)", amountCents: 4500, mcc: "5734" },
  "replyhub-starter": { agent: "support", merchant: "Replyhub", label: "Helpdesk, starter, monthly", amountCents: 3800, mcc: "7372" },
  "replyhub-growth": { agent: "support", merchant: "Replyhub", label: "Helpdesk, growth, monthly (more seats, live chat)", amountCents: 9500, mcc: "7372" },
  "ledgerly-starter": { agent: "treasury", merchant: "Ledgerly", label: "Bookkeeping, starter, monthly", amountCents: 1500, mcc: "5734" },
  // Not a plan the agent should buy: warehouse software on the support card, which may pay only helpdesk software (a demo moment).
  "packwise-on-support-card": { agent: "support", merchant: "Packwise", label: "Starter plan, monthly, on the support card", amountCents: 1999, mcc: "5734" },
};

/**
 * Block 5.1: which rail each supplier accepts, as its checkout states it. The Sourcing agent picks the rail per purchase;
 * code refuses a rail the supplier does not accept before anything is paid. Stockline sells stock checks behind an x402
 * paywall on Alta; Packwise sells a monthly subscription through a card checkout, so the agent's own Airwallex card (a
 * single-use card would decline the next month's charge).
 */
export type Rail = "metal_x402" | "airwallex_card";
export const RAIL_WORDS: Record<Rail, string> = { metal_x402: "x402 on Alta", airwallex_card: "a card (Airwallex)" };
export const SUPPLIER_RAILS = {
  stockline: { name: "Stockline", item: "one live stock check for the next customer query", rails: ["metal_x402"] as Rail[], checkout: "an x402 paywall on Alta testnet, paid under your on-chain mandate; no card checkout" },
  packwise: { name: "Packwise", item: "the Starter plan of its warehouse software, 19.99 EUR a month", rails: ["airwallex_card"] as Rail[], checkout: "a card checkout for a monthly subscription, charged to your company card (software only, a limit per purchase); no x402" },
} as const;
export type Supplier = keyof typeof SUPPLIER_RAILS;

/**
 * Ask Purser (G): what a task card may be for. Each kind is a single-use card for its merchant categories only, at
 * most this amount; anything else is refused. Within the CFO's policy (up to the task-card threshold, asked at the
 * runner) a card is issued at once; anything above it, or asked through the relay, waits for the CFO's Face ID.
 */
export const TASK_KINDS = {
  flight: { label: "Flight", mccs: ["4511"], maxCents: 150_000 },
  hotel: { label: "Hotel", mccs: ["7011"], maxCents: 100_000 },
  train: { label: "Train", mccs: ["4112"], maxCents: 50_000 },
  // D22: only the Sourcing agent's one-off data purchase (REPORT_OFFER) uses this kind; the chat readers never produce it.
  data: { label: "Data purchase", mccs: ["5734"], maxCents: 5_000 },
} as const;

/** D22: Ridgeline Data's one-off demand report, on x402 (Alta, under the mandate) or a single-use Airwallex card. */
export const REPORT_OFFER = { supplier: "Ridgeline Data", item: "a one-off regional demand report", x402Cents: 20, cardCents: 1500, mcc: "5734", purpose: "Ridgeline Data, one-off regional demand report" } as const;
/** A task card without a date in the message ends after this many days; a date may be at most TASK_MAX_DAYS ahead. */
export const TASK_DEFAULT_DAYS = 7;
export const TASK_MAX_DAYS = 30;
/** approval.task_card_eur's starting value (src/policy/rules.ts): task cards up to this are issued without Face ID. */
export const TASK_CARD_EUR_FALLBACK = "300.00";
/** Within the CFO policy (no Face ID), at most this many task cards in 24 hours; the next one asks for Face ID. */
export const TASK_WITHIN_PER_DAY = 3;
/** At most this many task card requests from the dashboard link wait for the CFO at once. */
export const TASK_LINK_PENDING_MAX = 3;
/** An outside agent may ask Purser at most this many times an hour. */
export const ASK_AGENT_PER_HOUR = 5;
