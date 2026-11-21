// The outside site audit of 19 Nov (docs/evidence/site-quality.md) and its fixes of 20 Nov, on the built pages and the
// Worker's answers: the sandbox disclosure beside the primary buttons (6.3), the hero's text at full contrast in every
// frame and the phone's badge line inside a landmark (6.5), the /try logo chip's width and height, the Airwallex logo
// served at its shown size, and a year's immutable cache only for versioned static files (6.6). Also the owner's
// pilot and partnership address in the footer (20 Nov).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, CONTACT_LINE, DESIGN_PARTNER_LABEL, DESIGN_PARTNER_URL } from "../src/config/brand.js";
import { HERO_FLOW_CSS } from "../src/redesign/heroFlow.js";
import { REASSURE, SANDBOX_NOTE, homePage } from "../src/redesign/home.js";
import { AWX_ROW_LABEL, TOKENS, header } from "../src/redesign/ui.js";
import { buildPages } from "../src/relay/assets.js";
import { ASSET_VERSIONS, DAY_CACHE, IMMUTABLE_CACHE } from "../src/ui/assetVersions.js";
import { AIRWALLEX_LOGO_FILE, AIRWALLEX_LOGO_ORIGINAL, AIRWALLEX_LOGO_PATH, AIRWALLEX_LOGO_SIZE, AIRWALLEX_LOGO_SRC, builtOnBadge } from "../src/ui/builtOn.js";
import { LOGOS as SITE_LOGOS } from "../src/servers/dashboard.js";
import { AIRWALLEX_LOGO_DATA_URL } from "../cloud/src/awxLogo.gen.js";
import { LOGOS as TRY_LOGOS, presentExtra } from "../cloud/src/try/presentMode.js";
import { START } from "../cloud/src/tryCopy.js";
import { pageResponse } from "../worker/src/core.js";

const BASE = "https://relay.example.test";
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

describe("6.3: a short sandbox disclosure beside the primary demo button", () => {
  // Max, 21 Nov: "drop the line under the CTAs": the disclosure moved into the Workflow card beside the buttons.
  it("Home: the Workflow card beside the hero's buttons says sandbox and test money; the line under them is gone", () => {
    expect(SANDBOX_NOTE).toBe("Sandbox demo: test money, no real settlement.");
    for (const html of [homePage(), homePage(undefined, { trySign: true })]) {
      const m = mainOf(html);
      // 21 Nov: the hero's primary button starts the judge tour; the sandbox line, after its shield icon, is right under both.
      // 21 Nov, later (owner: say what competitors advertise): the Workflow label says "Sandbox · no account needed".
      expect(m).not.toContain(SANDBOX_NOTE);
      expect(m).toMatch(/<div class="ctas"><a class="btn primary big start"[\s\S]*?<\/div>\s*<\/div>\s*<div class="wf"[\s\S]*?Sandbox · no account needed[\s\S]*?Paid · Airwallex sandbox, test money/);
      expect(REASSURE).toEqual({ sign: SANDBOX_NOTE, world: SANDBOX_NOTE });
    }
  });

  it("/try's first screen: the fine line under its card says it first", () => {
    // 21 Nov (Max, mockup 175): one start for every /try; its tiny line under the card.
    expect(START.fine.startsWith("Sandbox · test money")).toBe(true);
  });

  it("names no partner as endorsing, and says no banned word", () => {
    for (const s of [SANDBOX_NOTE, START.fine]) expect(s).not.toMatch(/endorse|certified|approved by|partner of|stand-in/i);
  });
});

describe("6.5: accessibility", () => {
  it("the hero's pieces are revealed by a wipe, never by opacity: their words are drawn at full contrast in every frame", () => {
    const frames = [...HERO_FLOW_CSS.matchAll(/@keyframes hf-[^{]+\{([\s\S]*?)\}\s*\}/g)].map((m) => m[1]!);
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) expect(f).not.toMatch(/opacity/);
    expect(HERO_FLOW_CSS).toMatch(/@keyframes hf-hfreader \{[^\n]*clip-path: inset\(0 0 100% 0\)/);
  });

  it("with reduced motion nothing in the hero animates: the final frame stands", () => {
    const motion = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(HERO_FLOW_CSS)![1]!;
    const outside = HERO_FLOW_CSS.replace(motion, "");
    expect(outside).not.toMatch(/^\s*\.hf [^{]*\{[^}]*animation:\s*hf-/m);
    expect(motion).toMatch(/\.hf \.hf-reader \{ animation: hf-hfreader/);
  });

  it("the phone's \"Built on Airwallex\" line is a labelled landmark of its own, outside the sticky header, on every page", () => {
    expect(AWX_ROW_LABEL).toBe("Built on Airwallex");
    const h = header("home");
    expect(h).toMatch(/<\/header>\n<aside class="awx-row" aria-label="Built on Airwallex"><a class="awx-badge awx-m"[^]*<\/aside>$/);
    expect(h).not.toContain('<div class="awx-row">');
    const pages = buildPages();
    for (const html of [pages.home!, pages.proof!, pages.verify!, pages.airwallex!]) expect(html).toContain('<aside class="awx-row" aria-label="Built on Airwallex">');
  });
});

describe("6.6: images and caching", () => {
  it("/try's logo chips set each image's own width and height", () => {
    const { script } = presentExtra("public");
    expect(script).toContain("i.width=PC.logos[k].w;i.height=PC.logos[k].h;");
    expect(TRY_LOGOS.airwallex).toMatchObject({ w: 306, h: 42 });
    for (const l of Object.values(TRY_LOGOS)) expect(l.w > 0 && l.h > 0).toBe(true);
  });

  it("serves the Airwallex wordmark scaled to 3x the badge (306 x 42), the original kept byte for byte", () => {
    const original = readFileSync(AIRWALLEX_LOGO_ORIGINAL), scaled = readFileSync(AIRWALLEX_LOGO_FILE);
    expect(sha(original)).toBe("58f3984f584548271144122c7d139e9a6a8a1ad37d683263e74104ac65cd390e");
    expect(pngSize(original)).toEqual({ width: 2435, height: 334 });
    expect(pngSize(scaled)).toEqual({ width: 306, height: 42 });
    expect(AIRWALLEX_LOGO_SIZE).toEqual({ width: 306, height: 42 });
    expect(scaled.length).toBeLessThan(12_000);
    expect(SITE_LOGOS["logo-airwallex.png"]!.body.equals(scaled)).toBe(true);
    expect(AIRWALLEX_LOGO_DATA_URL).toBe(`data:image/png;base64,${scaled.toString("base64")}`);
    // The badge still shows it 102 x 14 CSS px.
    expect(builtOnBadge()).toContain(`<img src="${AIRWALLEX_LOGO_SRC}" alt="Airwallex" width="102" height="14">`);
  });

  it("each linked version is the content of the file served at that address", () => {
    const pages = buildPages();
    const files: Record<string, Buffer> = {
      "inter.woff2": readFileSync("src/ui/inter.woff2"),
      "logo-airwallex.png": readFileSync(AIRWALLEX_LOGO_FILE),
      "logo-claude-slate.svg": readFileSync("docs/assets/logos/claude-logo-slate.svg"),
    };
    for (const [name, v] of Object.entries(ASSET_VERSIONS)) {
      expect(sha(files[name]!).slice(0, 12), name).toBe(v);
      expect(pages.versions![`/assets/${name}`], name).toBe(v);
    }
    expect(AIRWALLEX_LOGO_SRC).toBe(`${AIRWALLEX_LOGO_PATH}?v=${ASSET_VERSIONS["logo-airwallex.png"]}`);
    expect(TOKENS).toContain(`url(assets/inter.woff2?v=${ASSET_VERSIONS["inter.woff2"]})`);
    expect(pages.home).toContain(`src="assets/logo-claude-slate.svg?v=${ASSET_VERSIONS["logo-claude-slate.svg"]}"`);
    expect(pages.home).toContain(`src="${AIRWALLEX_LOGO_SRC}"`);
  });

  it("the Worker caches a versioned static file for a year, immutable; unversioned or stale for a day; pages and JSON never", () => {
    const pages = buildPages();
    const get = (path: string) => pageResponse(new Request(`${BASE}${path}`), pages)!;
    for (const [name, v] of Object.entries(ASSET_VERSIONS)) {
      expect(get(`/assets/${name}?v=${v}`).headers.get("cache-control"), name).toBe(IMMUTABLE_CACHE);
      expect(get(`/assets/${name}`).headers.get("cache-control"), name).toBe(DAY_CACHE);
      expect(get(`/assets/${name}?v=000000000000`).headers.get("cache-control"), name).toBe(DAY_CACHE);
    }
    expect(IMMUTABLE_CACHE).toBe("public, max-age=31536000, immutable");
    for (const path of ["/", "/home", "/proof", "/approve/P-0001", "/proof.json", "/robots.txt", "/sitemap.xml"]) expect(get(path).headers.get("cache-control"), path).toBe("no-store");
  });
});

describe("the pilot and partnership address (the owner, 20 Nov)", () => {
  it("is the last line of the footer on every page that shares it, as a mailto link", () => {
    expect(CONTACT_EMAIL).toBe("max.geurtsen@outlook.com");
    expect(CONTACT_LINE).toBe("Pilot or partnership?");
    const pages = buildPages();
    for (const html of [pages.home!, pages.proof!, pages.verify!, pages.airwallex!, pages.security!, pages.docs!]) {
      const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(html)![0];
      expect(foot).toMatch(/<p class="fcontact">Pilot or partnership\? <a href="mailto:max\.geurtsen@outlook\.com">max\.geurtsen@outlook\.com<\/a><\/p><\/div><\/footer>$/);
    }
  });

  it("is the design-partner link, so Home shows it", () => {
    expect(DESIGN_PARTNER_URL).toBe(`mailto:${CONTACT_EMAIL}`);
    expect(mainOf(homePage())).toContain(`<p class="partner"><a href="mailto:${CONTACT_EMAIL}">${DESIGN_PARTNER_LABEL} →</a></p>`);
  });
});
