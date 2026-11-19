// The numbers of the payables checks (src/ap/checkerCore.ts) that people read: in a module of their own, with no
// imports, so the hands-on page's words (cloud/src/tryCopy.ts WHY) quote the code's own values without bundling the checks.
//
// The three windows (SPLIT_DAYS, TWIN_DAYS, NEAR_TWIN_DAYS) are defaults: a company may set its own (settings ap.split_days,
// ap.twin_days, ap.near_twin_days, each a whole number of days from WINDOW_MIN_DAYS to WINDOW_MAX_DAYS; src/world/settings.ts
// checkWindows), and the checks read them from the case (InvoiceCase.policy.windows). 19 Nov, second round: chosen against
// the held-out adversarial evals' misses and false holds (docs/evals/adversarial-v3.md, v4), as each comment says.

/** An invoice this many times its supplier's usual (the median of its earlier ones) is flagged. */
export const UNUSUAL_FACTOR = 2;
/**
 * Invoices from one supplier for the same total dated this close together are a possible duplicate under another number
 * (past a month). Kept at 45 days (eval v3): 90 would hold a supplier's fixed fee billed every two months, and the copy
 * resent two months later that v3 found (v3-dup-zeeland-60-days) is caught by its printed delivery date instead: the
 * window is also measured from the dates of delivery an invoice prints (src/ap/period.ts). Where both invoices print
 * the months they bill for and those differ, they are no copy of each other.
 */
export const TWIN_DAYS = 45;
/**
 * Invoices from one supplier dated this close together are added up: when the sum passes the agent's limit to pay
 * alone, though each is under it, the CFO decides (a possible split invoice; adversarial eval v2, 19 Nov). Three weeks
 * (was two; eval v3 found an order cut in two parts sixteen days apart, v3-split-bergtex-16-days). Below the shortest
 * month, 28 days, so a supplier's monthly invoices never add up; 31 would send every month's second invoice of a supplier
 * billed monthly to the CFO once the two pass the limit together. Invoices that print different months are never parts.
 */
export const SPLIT_DAYS = 21;
/**
 * Another number for almost the same total is a possible duplicate too: at most this many cents apart (EUR 1.00) and at
 * most NEAR_TWIN_PERCENT of the larger total, whichever is less (adversarial eval v2: a paid invoice resent under a new
 * number for EUR 0.01 more). Kept at EUR 1.00 in the second round (eval v3 found a copy EUR 2.00 dearer on the same day,
 * v3-dup-lagerhaus-plus-two, which the split check sends to the CFO): EUR 5.00 held the two invoices of one supplier
 * that /try's test company composes on each side of its EUR 500.00 limit (one a euro under it, one a cent over), and
 * would hold ordinary price differences of a few euros between real orders ...
 */
export const NEAR_TWIN_CENTS = 100;
export const NEAR_TWIN_PERCENT = 1;
/**
 * ... and dated at most this many days apart (eval v3: a supplier's regular monthly order a month later, EUR 0.50 dearer,
 * was held as a copy, v3-clean-zeeland-monthly-near). An altered copy comes within days of the original; the same total
 * exactly still counts over TWIN_DAYS.
 */
export const NEAR_TWIN_DAYS = 14;
/** The range a company's own window may take, in days: a setting outside it is not used, and the default stands. */
export const WINDOW_MIN_DAYS = 1;
export const WINDOW_MAX_DAYS = 180;
