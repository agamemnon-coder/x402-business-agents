// The numbers of the payables checks (src/ap/checkerCore.ts) that people read: in a module of their own, with no
// imports, so the hands-on page's words (cloud/src/tryCopy.ts WHY) quote the code's own values without bundling the checks.

/** An invoice this many times its supplier's usual (the median of its earlier ones) is flagged. */
export const UNUSUAL_FACTOR = 2;
/** Invoices from one supplier for the same total dated this close together are a possible duplicate under another number (past a month). */
export const TWIN_DAYS = 45;
