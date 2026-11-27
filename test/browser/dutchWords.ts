// English left on a Dutch page (27 Nov, the owner: Purser Cloud is English first and Dutch second; with Nederlands
// chosen, the console shows no English). Used by console.check.ts: what a person sees on a page (its visible text, and
// the labels a screen reader or a hover reads), with names, codes, ids and amounts taken out first, then searched for
// English words that are not also Dutch ("in", "is", "of", "op", "per" and "over" are both, so they are not in the list).
import type { Frame, Page } from "playwright";

/** English words a Dutch sentence never holds. */
export const ENGLISH_WORDS = /\b(the|and|for|with|to|not|from|this|that|these|those|its|it|are|be|been|by|at|on|or|an|you|your|our|their|has|have|will|would|can|could|should|when|which|what|who|how|why|waiting|waits|paid|pays|invoice|invoices|payment|payments|recorded|supplier|suppliers|approve|approved|approval|money|card|cards|limit|limits|own|only|each|every|none|after|before|here|there|into|than|then|but|if|new|yet|still|already|never|always|just|also|simulated|spent|month|year|today|days|nothing|says|shows|made|goes|sent|read|written|policy|purchase|purchases|customer|customers|refund|refunds|warehouse|earnings|ledger|settled|matched|overpaid|partial|review|declined|proposed|filed|received|stopped|duplicate|seller|formerly|active|other|single|use|any|all|one|two|three|first|next)\b/i;

/**
 * What stays as it is in Dutch: proper names (products, companies, the partners' own badges and product names) and
 * codes (ids, keys, settings, error codes, file paths, addresses, hashes, amounts with a code).
 */
const ALLOWED: RegExp[] = [
  // Names: the partners' own badge and product names, the demo company and its test shop.
  /\bBuilt on(?: Airwallex)?\b/g, /Hosted Payment Page/g, /A2A Agent Card/g, /Teams Adaptive Card/g, /Airwallex Global Accounts?/g, /Northwind Outdoor/g, /Agent2Agent/g,
  // The buttons of another product, named as that product shows them.
  /\bAdd to (?:Cursor|VS Code)\b/g, /\bMCP: Add Server\b/g,
  // Codes: an address or a path, a setting (NAME=on), an all-capital code, a dotted key, an id with a digit or an underscore, a hash.
  /\bhttps?:\/\/\S+/g, /(?:^|\s)\S*\/\S*/g, /\b\w+=\w+\b/g, /\b[A-Z][A-Z0-9_]{2,}\b/g, /\b[a-z][\w-]*(?:\.[\w-]+)+\b/g, /\b[\w-]*(?:\d|_)[\w-]*\b/g, /\b0x[0-9a-f…]+/gi,
];

/** The text with its names and codes taken out. */
export const withoutNames = (s: string): string => ALLOWED.reduce((t, re) => t.replace(re, " "), s);

/** Every string on the page a person sees or hears: visible text nodes, and the labels of visible elements. */
export async function visibleTexts(where: Page | Frame): Promise<string[]> {
  // As a string: tsx would wrap named functions in a helper the page does not have.
  return await where.evaluate(`(() => {
    const out = [], vis = (e) => (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : true);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { const p = n.parentElement; if (!p || p.closest("script,style,template,code,pre,kbd") || !vis(p)) continue; const t = (n.textContent || "").replace(/\\s+/g, " ").trim(); if (t) out.push(t); }
    for (const e of document.querySelectorAll("[title],[aria-label],[placeholder],[alt]")) { if (!vis(e) || e.closest("code,pre")) continue; for (const a of ["title", "aria-label", "placeholder", "alt"]) { const v = e.getAttribute(a); if (v) out.push(v.replace(/\\s+/g, " ").trim()); } }
    out.push(document.title);
    return [...new Set(out)];
  })()`) as string[];
}

/** The strings that still hold an English word once names and codes are out. */
export const englishIn = (texts: readonly string[]): string[] => texts.filter((s) => ENGLISH_WORDS.test(withoutNames(s)));
