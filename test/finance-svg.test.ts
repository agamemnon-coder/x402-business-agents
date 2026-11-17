// The picture at the top of docs/finance-value.md (scripts/finance-svg.ts): drawn from the records, never typed. It is
// redrawn here and must equal the committed SVG; each figure it shows must be the one the page states; and, as GitHub
// shows it in an <img>, it carries no script and no external link, animates once, and reduced motion stops it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FINANCE_SVG, financeFigures, financeSvg } from "../scripts/finance-svg.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Purser for the finance team, at a glance", () => {
  it("is the committed SVG, redrawn from the records, and shown under the page's summary", () => {
    expect(read(FINANCE_SVG) === financeSvg()).toBe(true);
    const page = read("docs/finance-value.md");
    const img = page.indexOf("](assets/finance/at-a-glance.svg)");
    expect(img).toBeGreaterThan(page.indexOf("> without a rule in code"));
    expect(img).toBeLessThan(page.indexOf("**Who:**"));
  });

  it("reads the records' figures", () => {
    // Fails if: a record changes and `npm run finance:svg` was not run, or the picture reads another row.
    expect(financeFigures()).toEqual({
      cases: 50, wrongPurser: 0, wrongNoRules: 35, centRefused: true,
      monthInvoices: 20, monthPaid: 16, monthUsd: "1.02", perInvoiceUsd: "0.05",
      t0Entries: 95, t0Accounts: 9, t0Differences: 0,
      faceIdToPaid: ["6.3", "6.4"], feesAwx: ["13.50", "13.50"], feeMain: "13.42", feeCeiling: "20.00",
    });
  });

  it("shows only figures the page states", () => {
    const page = read("docs/finance-value.md"), svg = read(FINANCE_SVG);
    const pairs: [string, string][] = [
      ["vs 35 for a payer with no rules", "| Wrong payments | 35 | 0 |"],
      ["50 test cases", "50 cases"],
      ["USD</tspan><tspan dx=\"6\">0.05", "about USD 0.05 an invoice"],
      ["USD 1.02 in all", "USD 1.02 in all"],
      ["16 paid, 4 sent to a person", "16 paid, 4 sent to a person, books balanced"],
      [">95<", "95 journal entries"],
      ["9 accounts", "9 accounts, 0 differences"],
      ["0 differences", "9 accounts, 0 differences"],
      ["6.3 s and 6.4 s", "6.3 s and 6.4 s"],
      ["settlement simulated", "CFO's Face ID to PAID (settlement simulated)"],
      ["refused", "one cent changed is refused"],
      ["EUR 13.42 on 3 Nov, 13.50 twice on 7 Nov", "EUR 13.42 on EUR 240.00 (3 Nov); EUR 13.50 twice (7 Nov)"],
      ["EUR 20.00 reserved", "known only after sending, so EUR 20.00 is reserved"],
    ];
    for (const [inSvg, inPage] of pairs) expect({ inSvg, inPage, svg: svg.includes(inSvg), page: page.includes(inPage) }).toEqual({ inSvg, inPage, svg: true, page: true });
    expect(svg).toContain("Test money · sandbox");
  });

  it("has a title and description, no script or external link, one short animation that reduced motion stops, both themes", () => {
    const svg = read(FINANCE_SVG);
    expect(svg).toContain('<title id="t">Purser for the finance team, at a glance</title>');
    expect(svg).toMatch(/<desc id="d">[^<]{200,}<\/desc>/);
    expect(/<script|on[a-z]+=|<foreignObject|javascript:/i.test(svg)).toBe(false);
    expect(/(?:xlink:)?href="(?!#)|src="|url\((?!#)|@import|="https?:\/\/(?!www\.w3\.org\/2000\/svg")/.test(svg)).toBe(false);
    expect(Buffer.byteLength(svg)).toBeLessThan(40 * 1024);
    expect(svg).toMatch(/@media \(prefers-color-scheme:dark\)/);
    expect(svg).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
    // Played once: nothing loops, and every animation ends by 2 s (delay + duration).
    expect(svg).not.toMatch(/infinite/);
    const timed = [...svg.matchAll(/animation:\w+ ([\d.]+)s [^;}]*?(?: ([\d.]+)s)?[ ;}]/g)].map((m) => Number(m[1]) + Number(m[2] ?? 0));
    const delays = [...svg.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => Number(m[1]));
    expect(timed.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...timed)).toBeLessThanOrEqual(2);
    expect(Math.max(...delays) + 0.55).toBeLessThanOrEqual(2);
  });
});
