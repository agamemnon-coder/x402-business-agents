// The numbers of the payables checks (src/ap/checkerCore.ts) that people read: in a module of their own, with no
// imports, so the hands-on page's words (cloud/src/tryCopy.ts WHY) quote the code's own values without bundling the checks.

/** An invoice this many times its supplier's usual (the median of its earlier ones) is flagged. */
export const UNUSUAL_FACTOR = 2;
/** Invoices from one supplier for the same total dated this close together are a possible duplicate under another number (past a month). */
export const TWIN_DAYS = 45;
/**
 * Invoices from one supplier dated this close together are added up: when the sum passes the agent's limit to pay
 * alone, though each is under it, the CFO decides (a possible split invoice; adversarial eval v2, 19 Nov). Two weeks:
 * an order cut into parts arrives within days, a supplier's monthly invoices a month apart do not add up.
 */
export const SPLIT_DAYS = 14;
/**
 * Within TWIN_DAYS, another number for almost the same total is a possible duplicate too: at most this many cents
 * apart (EUR 1.00) and at most NEAR_TWIN_PERCENT of the larger total, whichever is less (adversarial eval v2: a paid
 * invoice resent under a new number for EUR 0.01 more).
 */
export const NEAR_TWIN_CENTS = 100;
export const NEAR_TWIN_PERCENT = 1;
