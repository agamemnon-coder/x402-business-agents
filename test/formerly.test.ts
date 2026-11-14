// Metal renamed itself Alta (14 Nov 2026; its team in the hackathon's Slack). The site says Alta; each page's first
// mention reads "Alta (formerly Metal)"; /alta serves the same page as /metal, which keeps working; the hackathon's own
// "Metal Award" keeps its name; run records keep the name they were written with; no Alta logo is shown.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALTA_FIRST, formerlyMetal } from "../src/ui/formerly.js";
import { buildPages } from "../src/relay/assets.js";
import { BUILT_WITH, LEFT_OUT } from "../src/visuals/logos.js";

const pages = buildPages() as unknown as Record<string, unknown>;
const html = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "page" in v ? String((v as { page: unknown }).page) : "");
// What a reader sees: no scripts, styles, drawings or menus (an SVG tooltip or a filter is not where the first mention goes).
const visible = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<nav[\s\S]*?<\/nav>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("formerlyMetal", () => {
  it("writes the first visible Alta in <main> once, skips code, drawings and the nav, and is idempotent", () => {
    const page = '<nav>Alta</nav><main><svg><text>Alta</text></svg><code>Alta</code><p>Paid on Alta; Alta again.</p></main><footer>Alta</footer>';
    const out = formerlyMetal(page);
    expect(out).toBe('<nav>Alta</nav><main><svg><text>Alta</text></svg><code>Alta</code><p>Paid on Alta (formerly Metal); Alta again.</p></main><footer>Alta</footer>');
    expect(formerlyMetal(out)).toBe(out);
    expect(formerlyMetal("<main><p>No partner here.</p></main>")).toBe("<main><p>No partner here.</p></main>");
  });
});

describe("the site after the rename", () => {
  const served = Object.entries(pages).map(([k, v]) => [k, html(v)] as const).filter(([, h]) => /<main\b/.test(h));

  it("says Alta, never Metal, in what a visitor reads on the pages built from code (records quoted as recorded aside)", () => {
    // (/runs is left out here: its rows quote the runs' own records, which keep the name Metal had.)
    for (const k of ["home", "proof", "metal", "security", "claude", "docs", "airwallex"]) {
      const h = html(pages[k]);
      // Two proof labels (on /proof and /metal) are the main run's record's own words (docs/demo/main-run.json), quoted as recorded.
      const main = visible(/<main[\s\S]*<\/main>/.exec(h)![0]).replace(ALTA_FIRST, "").replace("Metal earnings booked at Airwallex", "").replace("settled by Metal's facilitator", "")
        // Claude's own words in the main run's record, on /claude, quoted as it wrote them.
        .replace("so Metal refused the last purchase", "");
      expect({ k, metal: main.match(/\bMetal\b(?! Award)/g) ?? [] }).toEqual({ k, metal: [] });
    }
  });

  it("names Alta (formerly Metal) once per page, the first time, on every page that names Alta", () => {
    for (const [k, h] of served) {
      // A name on a logo tile is a mark, not a mention: the first mention is the first one in the text.
      const main = /<main[\s\S]*<\/main>/.exec(h)![0].replace(/<span class="(?:logo tname|tile tname[^"]*)">Alta<\/span>/g, "");
      // /try names Alta only on its rail tile, which the first mention skips (a fixed-size label).
      if (k === "try" || !/\bAlta\b/.test(visible(main))) continue;
      const v = visible(main);
      expect({ k, n: v.split(ALTA_FIRST).length - 1 }).toEqual({ k, n: 1 });
      expect({ k, first: v.indexOf(ALTA_FIRST) <= v.search(/\bAlta\b/) }).toEqual({ k, first: true });
    }
  });

  it("serves the page at /alta, and /metal answers 301 to it, on the Worker and on the judge's server; the nav says Alta", () => {
    expect(read("worker/src/core.ts")).toContain('if (path === "/alta") return page(pages.metal, pages.csp.metal);');
    expect((pages as { moved: Record<string, string> }).moved["/metal"]).toBe("/alta");
    expect(read("src/cli/judge.ts")).toContain('app.get("/alta", page(METAL_CSP, () => METAL_PAGE));');
    expect(read("src/servers/dashboard.ts")).toContain('app.get("/metal", (_req, res) => { res.redirect(301, "/alta"); });');
    expect(/<nav[\s\S]*?<\/nav>/.exec(html(pages.home))![0]).toMatch(/>Alta</);
  });

  it("keeps the hackathon's own name for the award, and Metal's old mark is shown nowhere", () => {
    expect(read("docs/submission/README.md")).toContain("entered for the Metal Award and the Visa Award");
    for (const [k, h] of served) expect({ k, mark: h.includes("logo-metal.svg") }).toEqual({ k, mark: false });
    expect(BUILT_WITH.map((l) => l.name)).not.toContain("Metal");
    expect(BUILT_WITH.find((l) => l.name === "Alta")?.file).toBe("src/ui/logos/alta.svg");
    expect(LEFT_OUT.map((l) => l.name)).not.toContain("Alta (formerly Metal)");
    expect(read("docs/evidence/logo-permissions.md")).toContain("Alta logo shown with the Alta team's OK in the Airwallex hackathon Slack, 14 Nov 2026");
  });

  it("leaves the run records as they were written", () => {
    expect(read("docs/runs/2026-11-03-main-run-metal-transactions.md")).toMatch(/^# The main run's \d+ Metal transactions/);
  });
});
