// The jury's technical QA (6 Nov), items Q3, Q5, Q6, Q7 and Q8: every page carries the same link-preview tags with an
// absolute image and (where its CSP allows an image) the favicon; one tagline everywhere; /film labelled as the earlier
// animation, the walkthrough (4:58, FILM_URL) linked from Home and Proof; the deck's stated slide count is the PDF's; the claims' site
// section is the main run's. Q1 and Q2 (no sideways scroll at 360 and 768 px) are checked in a browser:
// test/browser/pages.check.ts and root.check.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILM_URL, HERO } from "../src/config/brand.js";
import { buildPages } from "../src/relay/assets.js";
import { OG_DESCRIPTION, OG_IMAGE, OG_IMAGE_SIZE, OG_ALT, OG_TITLE, previewTags, withMeta } from "../src/ui/meta.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { consolePage } from "../cloud/src/console.js";
import { SOCIAL_BUILT_ON } from "../src/visuals/svg.js";
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
    expect(OG_IMAGE).toBe("https://kit11.max-31b.workers.dev/assets/og-1128.png"); // 21 Nov (Max): the new banner, a new address
  });

  // The owner, 13 Nov: the preview in a chat looked messy (a cropped image, a long description). Every page of the site
  // and Purser Cloud's shareable pages now say the same: one title, one short sentence, one clean image.
  it("is one clean preview on every page of the site and of Purser Cloud: the title, one short sentence, the 1200×630 image", () => {
    expect(OG_TITLE).toBe("Purser · AI agents spend. You sign off. Built on Airwallex.");
    expect(OG_DESCRIPTION.length).toBeLessThanOrEqual(110);
    expect(OG_DESCRIPTION.split(/[.!?](?:\s|$)/).filter(Boolean).length).toBeLessThanOrEqual(2);
    const n = "bm9uY2U=";
    const cloud = [["cloud /try", tryPage(n, { origin: "https://x.test", rpId: "x.test" })], ["cloud console", consolePage(n, { origin: "https://x.test", rpId: "x.test", mailDomain: "x.test" })]] as const;
    for (const [name, page] of [...html, ...cloud]) {
      const h = head(page);
      for (const tag of previewTags()) expect({ name, tag, has: h.includes(tag) }).toEqual({ name, tag, has: true });
      expect({ name, ogTitles: (h.match(/property="og:title"/g) ?? []).length, ogDescs: (h.match(/property="og:description"/g) ?? []).length }).toEqual({ name, ogTitles: 1, ogDescs: 1 });
    }
    // The image: a PNG of 1200×630, the same file as the repository's social preview.
    const og = readFileSync(new URL("../src/ui/brand/og.png", import.meta.url));
    expect([og.readUInt32BE(16), og.readUInt32BE(20)]).toEqual([OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height]);
    expect(og.equals(readFileSync(new URL("../docs/assets/social-preview.png", import.meta.url)))).toBe(true);
  });

  // The owner, 13 Nov: the dark square with the logo and a tiny tagline looked poor in chat apps. One readable card.
  it("pins the preview's tags, in order, absolute, and an image a chat app can fetch quickly (a PNG under 300 KB)", () => {
    expect(previewTags()).toEqual([
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="Purser">',
      '<meta property="og:title" content="Purser · AI agents spend. You sign off. Built on Airwallex.">',
      '<meta property="og:description" content="Your AI agents pay suppliers; above their limit, each payment needs your Face ID. Built on Airwallex.">',
      '<meta property="og:image" content="https://kit11.max-31b.workers.dev/assets/og-1128.png">',
      '<meta property="og:image:type" content="image/png">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta property="og:image:alt" content="Purser. Payment operations for AI agents. Agents pay suppliers within your rules. The CFO signs with Face ID. Built on Airwallex. Test money only.">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="Purser · AI agents spend. You sign off. Built on Airwallex.">',
      '<meta name="twitter:description" content="Your AI agents pay suppliers; above their limit, each payment needs your Face ID. Built on Airwallex.">',
      '<meta name="twitter:image" content="https://kit11.max-31b.workers.dev/assets/og-1128.png">',
      '<meta name="twitter:image:alt" content="Purser. Payment operations for AI agents. Agents pay suppliers within your rules. The CFO signs with Face ID. Built on Airwallex. Test money only.">',
    ]);
    expect(previewTags({ url: "https://kit11.max-31b.workers.dev/home" })).toContain('<meta property="og:url" content="https://kit11.max-31b.workers.dev/home">');
    for (const t of previewTags()) { const c = /content="([^"]*)"/.exec(t)![1]!; if (/\.png|assets\//.test(c)) expect({ t, absolute: c.startsWith("https://") }).toEqual({ t, absolute: true }); }
    const og = readFileSync(new URL("../src/ui/brand/og.png", import.meta.url));
    expect(og.subarray(1, 4).toString()).toBe("PNG");
    expect(og.length).toBeLessThan(300 * 1024);
    // What the card says, in the site's words: the one line large, the small line, the payment's path and the row.
    const svg = readFileSync(new URL("../docs/assets/social-preview.svg", import.meta.url), "utf8");
    // 21 Nov (Max: "the banner looks dated"): the new design's line, its small line, the badge and the quiet tag.
    for (const words of ["Purser", "Payment operations", "for AI agents.", "Agents pay suppliers within your rules.", "The CFO signs with Face ID.", "Built on", "Test money only"]) expect({ words, in: svg.includes(`>${words}<`) }).toEqual({ words, in: true });
    // The alt text says what the image says.
    for (const words of ["Payment operations for AI agents.", "Agents pay suppliers within your rules.", "The CFO signs with Face ID.", "Built on Airwallex.", "Test money only."]) expect(OG_ALT).toContain(words);
    // 14 Nov (owner): "Built on" and the official Airwallex logo, the file's own bytes (no recolour, no crop), smaller
    // than Purser's 60 px mark; no other partner on the card.
    const logo = readFileSync(new URL(`../${SOCIAL_BUILT_ON.logo}`, import.meta.url)).toString("base64");
    expect(svg.match(/<image\b/g)).toHaveLength(1);
    expect(svg).toContain(`href="data:image/png;base64,${logo}"`);
    expect(SOCIAL_BUILT_ON.height).toBeLessThan(60);
    const words = [...svg.matchAll(/<(?:text|tspan|title|desc)\b[^>]*>([^<]*)</g)].map((m) => m[1]).join(" ");
    expect(words).not.toMatch(/\b(?:Alta|Visa|Claude|partner|endorse|certified)\b/i);
    expect(words).toContain("Built on Airwallex.");
    // docs/security.md is what the small line says: nothing above the limits is paid until it is signed.
    expect(readFileSync(new URL("../docs/security.md", import.meta.url), "utf8")).toContain("nothing above the limits is paid");
  });

  it("links the favicon wherever the page's CSP allows an image, and never where it refuses one (img-src 'none')", () => {
    for (const [name, page] of html) {
      const none = /img-src 'none'/.test(csp[name] ?? "");
      expect({ name, icon: /<link rel="icon" href="[^"]*assets\/favicon\.svg\?v=1113b"/.test(head(page)) }).toEqual({ name, icon: !none });
    }
  });

  it("adds only what a page lacks, and leaves scripts and styles (and so the CSP hashes) as they were", () => {
    const page = "<!doctype html><html><head><title>X</title><meta name=\"description\" content=\"own\"><style>a{}</style></head><body><script>1</script></body></html>";
    const out = withMeta(page);
    expect(out.match(/name="description"/g)).toHaveLength(1);
    expect(out).toContain('content="own"');
    expect(out).toContain(`<meta property="og:title" content="${OG_TITLE}">`);
    expect(out.replace(/<meta[^>]*>\n?|<link[^>]*>\n?/g, "").replace("</title>\n", "</title>")).toBe(page.replace(/<meta[^>]*>/, ""));
    expect(withMeta(out)).toBe(out);
  });
});

describe("one tagline (Q8)", () => {
  it("is \"AI agents spend. You sign off.\": Home's og:title, the README's title, the form's title, the deck's first slide, /film", () => {
    expect(HERO).toBe("AI agents spend. You sign off.");
    expect(head(pages.home!)).toContain(`<meta property="og:title" content="Purser · ${HERO} Built on Airwallex.">`);
    // The README's title, under the Purser mark in the owner's centred top (13 Nov): the first heading.
    expect(read("README.md").split("\n").find((l) => l.startsWith("# "))).toBe(`# Purser · ${HERO}`);
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
  it("/film says it is the earlier animation of 30 October, and points to the walkthrough (no duration since 14 Nov, owner)", () => {
    expect(pages.film).toContain("<title>Purser: the earlier animation (30 October)</title>");
    expect(pages.film).toContain("The earlier animation of 30 October, not the demo (youtu.be/gEUm8RlhZac)");
    expect(FILM_URL).toBe("https://youtu.be/gEUm8RlhZac");
  });

  it("the replay and Proof link the film of the main run; Proof's archive names /film for what it is", () => {
    for (const name of ["replay", "proof"] as const) expect({ name, link: pages[name]!.includes(`href="${FILM_URL}"`) }).toEqual({ name, link: true });
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

  it("the claims' section on the tabs is the main run's, checked on 7 November (and on 6 November before); its heading names the menu as it is since 12 November", () => {
    const claims = read("docs/claims.md");
    // The opening (the main run and the site as they stand) was checked on 14 November (with /visa as one story and
    // vic-5), its Alta rows again on 15 November (the Metal Award: /alta's facts); the sections below it on 7 November.
    // 20 Nov: the row on roles and the approval key's life (review findings 2 and 5) and the sigcheck row, checked by their
    // tests; the soaks' row and every figure on /proof traced (test/proof-trace.test.ts). The inner quotes are escaped:
    // unescaped, they ended the string and the file failed to load (the file-level FAIL after the sigcheck merge).
    // 21 Nov: the /business row (the Founding Partner Pilot) checked first; the 20 Nov rows follow it unchanged.
    expect(claims).toContain("Last checked on 26 November 2026 (the emergency-stop row, against `docs/runs/2026-11-26-stop-at-rail-live.md`");
    expect(claims).toContain("on 22 November the row on /business and /one-pager and /pricing's redirect");
    expect(claims).toContain("on 20 November the red-team rows, against the full re-run of 20 Nov");
    expect(claims).toContain("the rows on roles and the approval key's life, and \"Execution re-checks the passkey signature\", against their tests; the Airwallex soaks' row, against both soak records, by their tests; every figure on /proof against the record the page names, by `test/proof-trace.test.ts`, listed in `docs/evidence/proof-index.md`; on 19 November the rows of the fourth round of fixes and the red-team re-run, against their records, by their tests; on 18 November every figure by `npm run verify-all`, 188 checks pass; before that the Alta rows on 15 November, against their run records, and the rest on 14 November)"); // 19 Nov: the fourth round of fixes and the red-team re-run; 18 Nov: re-checked by verify-all during judging
    expect(claims).toContain("The sections below were checked on 7 November 2026");
    // The menu is Home, Try, Proof since Watch left it (12 Nov): the section's heading says so, and no "four tabs" heading is left.
    const from = claims.indexOf("## The tabs (Home, Try, Proof;");
    expect(from).toBeGreaterThan(0);
    expect(claims).not.toMatch(/^## The four tabs/m);
    const tabs = claims.slice(from, claims.indexOf("## The video"));
    for (const want of ["24 of 24 by Claude", "0.69 swept", "P-0005", "fee EUR 13.42", "P-0001, P-0002, P-0004, P-0005, P-0006", "412 audit rows"]) expect({ want, has: tabs.includes(want) }).toEqual({ want, has: true });
    // Agent run 1's figures only as what the section said before.
    expect(tabs.replace(/this\s+section still had agent run 1's figures[^)]*\)/, "")).not.toMatch(/38\/38|38 of 38|1\.97|P-0007/);
  });
});
