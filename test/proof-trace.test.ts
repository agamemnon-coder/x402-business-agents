// The owner, 20 Nov: "every figure, count, hash, transaction id and claim on /proof must lead to a committed record a
// reader can open and check, and the figure must equal what that record says". The guard: /proof as the Worker builds
// it, Home's proof band and the evidence wall, each rendered by the functions the pages use. A figure (a token with a
// digit in it, src/proof/figureTrace.ts) fails when no element around it names a record (data-rec) or links to one (a
// file of this repository on GitHub, or Airwallex, Alta's explorer, YouTube, GitHub, scorecard.dev, bestpractices.dev);
// a data-rec fails when its file is not in the repository; a hash, an id, an amount or a long number fails when none of
// its records holds it. Before this test, /proof had 214 figures with no record (the partner cards, the four tiles,
// the read-backs, every check, the business lines, the archive): written to fail on them first.
import { describe, expect, it } from "vitest";
import { distinctive, figures, gap, recExists, valueGap, type Figure } from "../src/proof/figureTrace.js";
import { evidenceWallHtml } from "../src/redesign/evidenceWall.js";
import { proofRowHtml } from "../src/redesign/home.js";
import { proofPage } from "../src/redesign/proof.js";

const PAGES: Record<string, string> = {
  "/proof": proofPage(),
  // 21 Nov: Home's proof row (src/redesign/home.ts), in place of the hero's proof line.
  "Home's proof row": proofRowHtml(),
  "the evidence wall": evidenceWallHtml(),
};
/** Every data-rec on a page, whether or not a figure sits under it. */
const dataRecs = (html: string) => [...html.matchAll(/ data-rec="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean));
const say = (f: Figure, why: string) => `${f.where || "top"} · "${f.token}" in "${f.text.slice(0, 90)}": ${why}`;

describe("every figure on /proof, Home's proof row and the evidence wall leads to a committed record", () => {
  for (const [name, html] of Object.entries(PAGES)) {
    const figs = figures(html);

    it(`${name}: shows figures (the walker reads the page)`, () => {
      expect(figs.length).toBeGreaterThanOrEqual(name === "/proof" ? 500 : 3);
    });

    it(`${name}: no figure without a data-rec or a link to a record`, () => {
      expect(figs.flatMap((f) => { const g = gap(f); return g ? [say(f, g)] : []; })).toEqual([]);
    });

    it(`${name}: every data-rec names a file or folder that is in the repository`, () => {
      const recs = [...new Set(dataRecs(html))];
      expect(recs.length).toBeGreaterThan(0);
      expect(recs.filter((r) => !recExists(r))).toEqual([]);
    });

    it(`${name}: every hash, id, amount with cents and long number is in a record it names`, () => {
      const checked = figs.filter((f) => distinctive(f.token));
      if (name !== "Home's proof row") expect(checked.length).toBeGreaterThan(0);
      expect(checked.flatMap((f) => { const g = valueGap(f); return g ? [say(f, g)] : []; })).toEqual([]);
    });
  }

  it("/proof: every full SHA-256 it shows is found in its record, and the page says where to check it", () => {
    const full = figures(PAGES["/proof"]!).filter((f) => /^[0-9a-f]{64}$/.test(f.token));
    expect(full.length).toBeGreaterThan(0);
    for (const f of full) expect({ token: f.token, gap: valueGap(f) }).toEqual({ token: f.token, gap: null });
  });

  // The guard itself: each kind of gap fails, so a green run means the pages have none.
  describe("fails on each kind of gap (controls)", () => {
    const one = (html: string) => figures(html)[0]!;
    it("a figure with no record", () => expect(gap(one('<main><p>16 stops</p></main>'))).toMatch(/no record/));
    it("a figure that only links to another page of the site", () => expect(gap(one('<main><a href="runs">33 runs</a></main>'))).toMatch(/not a record/));
    it("a figure linked to a site that is not on the list", () => expect(gap(one('<main><a href="https://developer.visa.com/x">read 14 Nov</a></main>'))).toMatch(/not a record/));
    it("a data-rec whose file is not in the repository", () => expect(gap(one('<main><p data-rec="docs/runs/no-such-run.json">EUR 1.00</p></main>'))).toMatch(/not in the repository/));
    it("a link to a file of this repository that does not exist", () => expect(gap(one('<main><a href="https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/no-such.md">12 calls</a></main>'))).toMatch(/not a record/));
    it("a hash its record does not hold", () => expect(valueGap(one('<main><p data-rec="docs/demo/main-run.json">deadbeef0123…4567</p></main>'))).toMatch(/in none of its records/));
    it("an amount its record does not hold", () => expect(valueGap(one('<main><p data-rec="docs/runs/airwallex-card-cent-2026-11-15.json">EUR 98,765.43</p></main>'))).toMatch(/in none of its records/));
    it("and passes a figure whose record holds it", () => {
      const f = one('<main><p data-rec="docs/demo/main-run.json">transfer 03360bfa…3985, EUR 240.00</p></main>');
      expect([gap(f), valueGap(f)]).toEqual([null, null]);
      expect(valueGap(figures('<main><p data-rec="docs/demo/main-run.json">EUR 240.00</p></main>')[0]!)).toBeNull();
    });
  });
});
