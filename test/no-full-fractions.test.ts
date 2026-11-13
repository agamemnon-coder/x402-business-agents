// Standing rule (13 Nov, judge panel): a count of a whole never reads as a fraction on a page ("24 of 24", "2/2"); it
// says "all 24" or "both" (countOf in src/redesign/ui.ts). A real partial count ("3 of 4") stays. Renders every page the
// relay serves (buildPages) and fails on any N of N or N/N in the text a reader sees (scripts, styles and markup removed).
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { countOf, countWords } from "../src/redesign/ui.js";

const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|\u00a0/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const FULL = [/\b(\d[\d,]*) of \1\b/g, /\b(\d[\d,]*)\/\1\b/g];

describe("no N/N fraction on any page", () => {
  const pages = Object.entries(buildPages() as unknown as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && /<(html|main|body)\b/i.test(e[1]));
  it("renders the pages", () => expect(pages.length).toBeGreaterThan(10));
  for (const [name, html] of pages) {
    it(name, () => {
      const t = visible(html);
      const hits = FULL.flatMap((re) => [...t.matchAll(re)].map((m) => t.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40)));
      expect(hits).toEqual([]);
    });
  }
});

describe("countOf", () => {
  it("says all, both, or the partial count", () => {
    expect([countOf(24, 24), countOf(2, 2), countOf(3, 4), countOf(130, 130, true), countOf(2, 2, true)]).toEqual(["All 24", "Both", "3 of 4", "all 130", "both"]);
    expect([countWords("5 of 5", true), countWords("3 of 4"), countWords("PAID")]).toEqual(["all 5", "3 of 4", "PAID"]);
  });
});
