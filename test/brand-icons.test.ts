// One mark everywhere (owner, 13 Nov): the browser tab showed a black and cyan feather while the site header shows a white
// feather on a dark rounded square, and a Purser Cloud page once showed no icon of ours. Every icon is now drawn from the
// header's own mark (src/ui/brand/mark.ts): kit11's and Purser Cloud's favicon.ico, favicon.svg, apple-touch-icon.png
// and icon.png are the same bytes, the MCP server names them, and every page links them with ?v=ICON_VERSION.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICON_VERSION, MARK_INK, markSvg } from "../src/ui/brand/mark.js";
import { ICON_ICO, ICON_PNG_180, ICON_PNG_512, ICON_SVG } from "../src/ui/brand/icons.gen.js";
import { HEADER_CSS, TOKENS, header } from "../src/redesign/ui.js";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse } from "../worker/src/core.js";
import { ICON_LINKS, iconsOf } from "../cloud/src/brand.js";
import { adminPageHtml } from "../cloud/src/try/adminPage.js";
import { testCloud, ORIGIN } from "./support/cloud.js";

const SITE = "https://kit11.max-31b.workers.dev";
const ON = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const OFF = buildPages({} as NodeJS.ProcessEnv);
const bytes = async (r: Response | null) => Buffer.from(await r!.arrayBuffer()).toString("base64");

describe("Purser's mark: the header's, in every icon", () => {
  it("is purser-mark.svg (#254, the header's mark) on a 64 grid: corners 9 of 30, a white feather 16 of 30, on the ink", () => {
    const ref = readFileSync(new URL("../docs/assets/brand/purser-mark.svg", import.meta.url), "utf8");
    const num = (re: RegExp, s: string) => Number(re.exec(s)![1]);
    const k = 64 / 30, svg = markSvg();
    expect(ref).toContain(`fill="${MARK_INK}"`);
    expect(TOKENS).toContain(`--text: ${MARK_INK};`);
    expect(HEADER_CSS).toContain(".brand .mk { width: 30px; height: 30px; border-radius: 9px; background: var(--text); color: var(--bg);");
    expect(header("home")).toContain('<span class="mk"><svg class="i" viewBox="0 0 24 24"');
    // The same geometry, scaled: corner radius, the feather's offset and its scale.
    expect(num(/rx="([\d.]+)"/, svg)).toBeCloseTo(num(/rx="([\d.]+)"/, ref) * k, 3);
    expect(num(/translate\(([\d.]+)/, svg)).toBeCloseTo(num(/translate\(([\d.]+)/, ref) * k, 3);
    expect(num(/scale\(([\d.]+)\)/, svg)).toBeCloseTo(num(/scale\(([\d.]+)\)/, ref) * k, 3);
    // The same three paths, white, at the same stroke.
    for (const d of [...ref.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]!)) expect(svg).toContain(`<path d="${d}"/>`);
    expect(svg).toContain('stroke="#fff" stroke-width="2"');
    expect(markSvg({ bleed: true })).toContain('rx="0"');
    // The generated icons and the site's file are this mark, not an older one (no cyan).
    expect(ICON_SVG).toBe(svg);
    expect(readFileSync(new URL("../src/ui/brand/favicon.svg", import.meta.url), "utf8").trim()).toBe(svg);
    expect(svg).not.toMatch(/2dd4bf/i);
  });

  it("the PNGs and the ICO are what they say: 180 and 512 px PNGs, an ICO of 32 and 48 px", () => {
    const png = (b64: string) => Buffer.from(b64, "base64");
    for (const [b64, size] of [[ICON_PNG_180, 180], [ICON_PNG_512, 512]] as const) {
      expect(png(b64).subarray(1, 4).toString("latin1")).toBe("PNG");
      expect(png(b64).readUInt32BE(16)).toBe(size);
    }
    const ico = png(ICON_ICO);
    expect([ico.readUInt16LE(2), ico.readUInt16LE(4), ico[6], ico[22]]).toEqual([1, 2, 32, 48]);
  });

  it("the site (kit11) serves the same bytes as Purser Cloud, at the root and under /assets, in either bundle", async () => {
    const want: Record<string, [string, string]> = {
      "favicon.ico": ["image/x-icon", ICON_ICO], "favicon.svg": ["image/svg+xml", Buffer.from(`${ICON_SVG}\n`).toString("base64")],
      "apple-touch-icon.png": ["image/png", ICON_PNG_180], "icon.png": ["image/png", ICON_PNG_512],
    };
    const c = testCloud();
    try {
      for (const pages of [ON, OFF]) {
        for (const [name, [type, b64]] of Object.entries(want)) {
          for (const path of [`/${name}`, `/assets/${name}?v=${ICON_VERSION}`]) {
            const r = pageResponse(new Request(`${SITE}${path}`), pages);
            expect({ path, status: r?.status, type: r?.headers.get("content-type") }).toEqual({ path, status: 200, type });
            expect({ path, same: (await bytes(r)) === b64 }).toEqual({ path, same: true });
          }
        }
      }
      for (const name of ["favicon.ico", "apple-touch-icon.png", "icon.png"]) {
        expect({ name, same: (await bytes(await c.fetch(`${ORIGIN}/${name}`))) === want[name]![1] }).toEqual({ name, same: true });
      }
      expect(await (await c.fetch(`${ORIGIN}/favicon.svg`)).text()).toBe(ICON_SVG);
    } finally {
      c.close();
    }
  });

  it("every page links the icon with the version query: the site's pages, and Purser Cloud's console, demo, sign-in and owner's view", async () => {
    expect(ICON_VERSION).toBe("1113b");
    let linked = 0;
    for (const pages of [ON, OFF]) {
      for (const [name, html] of Object.entries(pages)) {
        if (typeof html !== "string" || !/<html/i.test(html)) continue;
        for (const m of html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)) {
          linked++;
          expect({ name, href: m[1], versioned: m[1]!.endsWith(`?v=${ICON_VERSION}`) }).toEqual({ name, href: m[1], versioned: true });
        }
      }
    }
    expect(linked).toBeGreaterThan(20);
    expect(ICON_LINKS).toBe(`<link rel="icon" href="/favicon.svg?v=${ICON_VERSION}" type="image/svg+xml"><link rel="icon" href="/favicon.ico?v=${ICON_VERSION}" sizes="32x32 48x48"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${ICON_VERSION}">`);
    expect(adminPageHtml("n")).toContain(ICON_LINKS);
    const c = testCloud({ engine: true, tryIt: { claude: false } as never });
    try {
      for (const path of ["/", "/try"]) expect({ path, links: (await (await c.fetch(`${ORIGIN}${path}`)).text()).includes(ICON_LINKS) }).toEqual({ path, links: true });
    } finally {
      c.close();
    }
    expect(iconsOf(ORIGIN).map((i) => i.src)).toEqual([`${ORIGIN}/icon.png?v=${ICON_VERSION}`, `${ORIGIN}/favicon.svg?v=${ICON_VERSION}`]);
  });
});
