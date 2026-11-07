// The jury's technical QA (6 Nov), items Q3, Q5, Q6, Q7 and Q8: every page carries the same link-preview tags with an
// absolute image and (where its CSP allows an image) the favicon; one tagline everywhere; /film labelled as the earlier
// animation, the 2:42 film linked from Home and Proof; the deck's stated slide count is the PDF's; the claims' site
// section is the main run's. Q1 and Q2 (no sideways scroll at 360 and 768 px) are checked in a browser:
// test/browser/pages.check.ts and root.check.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILM_URL, HERO } from "../src/config/brand.js";
import { buildPages } from "../src/relay/assets.js";
import { OG_IMAGE, withMeta } from "../src/ui/meta.js";
/** Escapes every regular-expression metacharacter, backslash included. */
const reEscape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
/** The CFO's private pages (approve, enrol, policy) reference nothing outside the relay (test/relay-assets.test.ts): not shared, no preview tags. */
const PRIVATE = ["approve", "enrol", "policy"];
const html = Object.entries(pages).filter((e): e is [string, string] => typeof e[1] === "string" && /<html/i.test(e[1]) && !PRIVATE.includes(e[0]));
const head = (h: string) => /<head>[\s\S]*?<\/head>/i.exec(h)![0];
const csp = pages.csp as Record<string, string>;

describe("every page's head (Q5)", () => {
  it("has a title, a description, Open Graph title, description and an absolute image, and the Twitter card", () => {
    expect(html.length).toBeGreaterThanOrEqual(16);
    for (const [name, page] of html) {
      const h = head(page);
      const missing = [/<title>[^<]+<\/title>/, /<meta name="description" content="[^"]+">/, /<meta property="og:title" content="[^"]+">/, /<meta property="og:description" content="[^"]+">/,
        new RegExp(`<meta property="og:image" content="${reEscape(OG_IMAGE)}">`), /<meta name="twitter:card" content="summary_large_image">/].filter((re) => !re.test(h)).map(String);
      expect({ name, missing }).toEqual({ name, missing: [] });
      expect({ name, relative: /og:image" content="(?!https:)/.test(h) }).toEqual({ name, relative: false });
    }
    expect(OG_IMAGE).toBe("https://kit11.max-31b.workers.dev/assets/og.png");
  });

  it("links the favicon wherever the page's CSP allows an image, and never where it refuses one (img-src 'none')", () => {
    for (const [name, page] of html) {
      const none = /img-src 'none'/.test(csp[name] ?? "");
      expect({ name, icon: /<link rel="icon" href="[^"]*assets\/favicon\.svg"/.test(head(page)) }).toEqual({ name, icon: !none });
    }
  });

  it("adds only what a page lacks, and leaves scripts and styles (and so the CSP hashes) as they were", () => {
    const page = "<!doctype html><html><head><title>X</title><meta name=\"description\" content=\"own\"><style>a{}</style></head><body><script>1</script></body></html>";
    const out = withMeta(page);
    expect(out.match(/name="description"/g)).toHaveLength(1);
    expect(out).toContain('content="own"');
    expect(out).toContain('<meta property="og:title" content="X · Purser">');
    expect(out.replace(/<meta[^>]*>\n?|<link[^>]*>\n?/g, "").replace("</title>\n", "</title>")).toBe(page.replace(/<meta[^>]*>/, ""));
    expect(withMeta(out)).toBe(out);
  });
});

describe("one tagline (Q8)", () => {
  it("is \"AI agents spend. You sign off.\": Home's og:title, the README's title, the form's title, the deck's first slide, /film", () => {
    expect(HERO).toBe("AI agents spend. You sign off.");
    expect(head(pages.home!)).toContain(`<meta property="og:title" content="Purser · ${HERO}">`);
    expect(read("README.md").split("\n")[0]).toBe(`# Purser · ${HERO}`);
    expect(read("docs/submission/README.md")).toMatch(new RegExp(`## Title\\n\\nPurser · ${reEscape(HERO)}\\n`));
    expect(read("src/submission/deck.ts")).toContain("title: HERO,");
    expect(pages.film).toContain(`"${HERO}"`);
    expect(pages.dashboard).toContain(`<title>Purser · ${HERO}</title>`);
  });

  it("no page says the other taglines any more", () => {
    for (const [name, page] of html) expect({ name, old: /Agents spend\. Limits hold\.|Agents move at machine speed\. The CFO signs off\.|Company cards for AI agents/i.exec(page)?.[0] ?? null }).toEqual({ name, old: null });
  });
});

describe("the film (Q3)", () => {
  it("/film says it is the earlier animation of 30 October, and points to the 2:42 film", () => {
    expect(pages.film).toContain("<title>Purser: the earlier animation (30 October)</title>");
    expect(pages.film).toContain("The earlier animation of 30 October, not the 2:42 film (youtu.be/jaqO2M2V6NY)");
    expect(FILM_URL).toBe("https://youtu.be/jaqO2M2V6NY");
  });

  it("Watch and Proof link the film of the main run; Proof's archive names /film for what it is", () => {
    for (const name of ["watch", "proof"] as const) expect({ name, link: pages[name]!.includes(`href="${FILM_URL}"`) }).toEqual({ name, link: true });
    expect(pages.proof).toContain('<a class="pf" href="film">The earlier animation (30 October)</a>');
    expect(pages.proof).not.toContain('<a class="pf" href="film">The film</a>');
  });
});

describe("the submission pack (Q6, Q7)", () => {
  it("states the deck's slide count as the PDF has it", () => {
    const pdf = readFileSync(new URL("../docs/submission/purser-deck.pdf", import.meta.url)).toString("latin1");
    const n = (pdf.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    expect(n).toBe(12);
    expect(read("docs/submission/README.md")).toContain(`\`purser-deck.pdf\`: ${words[n]} slides`);
  });

  it("the claims' section on the four tabs is the main run's, checked on 6 November", () => {
    const claims = read("docs/claims.md");
    expect(claims).toContain("Last checked on 6 November 2026");
    const tabs = claims.slice(claims.indexOf("## The four tabs"), claims.indexOf("## The video"));
    for (const want of ["24 of 24 by Claude", "0.69 swept", "P-0005", "fee EUR 13.42", "P-0001, P-0002, P-0004, P-0005, P-0006", "412 audit rows"]) expect({ want, has: tabs.includes(want) }).toEqual({ want, has: true });
    // Agent run 1's figures only as what the section said before.
    expect(tabs.replace(/this\s+section still had agent run 1's figures[^)]*\)/, "")).not.toMatch(/38\/38|38 of 38|1\.97|P-0007/);
  });
});
