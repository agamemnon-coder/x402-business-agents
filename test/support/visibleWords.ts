// The words a person reads on a page without opening anything: <main> only, no script, style or drawing, and no folded
// details (a fold's summary stays). The same count as test/site-v4.test.ts's page budgets, shared so that /runs and
// /proof can pin their own, lower numbers in their own tests (12 Nov). Note: a fold is cut at the FIRST </details>, so
// the words after a fold nested inside another fold still count.

import { withoutBlocks } from "./scriptBlocks.js";

// "&amp;" last, so that an escaped entity ("&amp;lt;") is not unescaped twice.
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function visibleWords(html: string): number {
  let main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? html;
  // Drawings nest (an icon inside the stage): remove the innermost first, until none is left.
  for (let prev = ""; prev !== main;) { prev = main; main = main.replace(/<svg\b[^>]*>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, " "); }
  // Script and style blocks found by position, in any case (test/support/scriptBlocks.ts), not by a regular expression.
  const text = withoutBlocks(main, ["script", "style"], " ")
    .replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<[^>]+>/g, " ");
  return decode(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
