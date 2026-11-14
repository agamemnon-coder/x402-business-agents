// The site's header, shared with Purser Cloud (12 Nov, owner: "/try still shows its own logo and has no menu"). The
// site's own output must not move by a byte: test/fixtures/site-header-1112.json was taken from origin/main's functions
// before the refactor. The cloud pages (/try and the console) draw the same brand and menu, with absolute links to the
// site except Try (/try) and Purser Cloud (/), under their unchanged nonce policy.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSS, header, page } from "../src/redesign/ui.js";
import { MORE_CSS, moreHtml, moreLinks } from "../src/ui/more.js";
import { NAV_CSS, navHtml } from "../src/ui/nav.js";
import { MOTION_CSS, SITE_MOTION_CSS } from "../src/ui/motion.js";
import { SITE_HEADER_LINKS, SITE_ORIGIN, siteHeader } from "../cloud/src/siteHeader.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { consoleCsp, consolePage } from "../cloud/src/console.js";

const snap = JSON.parse(readFileSync(new URL("./fixtures/site-header-1112.json", import.meta.url), "utf8")) as {
  header: Record<string, string>; more: Record<string, string>; nav: Record<string, string>; cssSha256: string; navCssSha256: string; moreCssSha256: string; pageSha256: string;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
/** The header's markup with every href blanked: the structure, classes and words, nothing else. */
const shape = (html: string) => html.replace(/href="[^"]*"/g, 'href=""');

describe("the site's header, byte for byte as before", () => {
  it("header(key) for every page key, moreHtml, navHtml and their CSS are unchanged", () => {
    for (const [k, html] of Object.entries(snap.header)) expect(header(k === "null" ? null : (k as never))).toBe(html);
    for (const [k, html] of Object.entries(snap.more)) expect(moreHtml(k === "null" ? null : k)).toBe(html);
    for (const [k, html] of Object.entries(snap.nav)) expect(navHtml(k === "null" ? null : (k as never))).toBe(html);
    expect(sha(CSS)).toBe(snap.cssSha256);
    expect(sha(NAV_CSS)).toBe(snap.navCssSha256);
    expect(sha(MORE_CSS)).toBe(snap.moreCssSha256);
    // 14 Nov: pageSha256 renewed: the shared page script names Alta where it said Metal, and the More menu links /alta.
    // 12 Nov (wire-in): every page's stylesheet carries the shared motion (src/ui/motion.ts) after CSS; the rest is unchanged.
    expect(sha(page({ title: "T", description: "D", tab: "home", css: "", body: "<main></main>", source: "s" }).replace(`\n${MOTION_CSS}${SITE_MOTION_CSS}`, ""))).toBe(snap.pageSha256);
  });
});

const CLOUD = "https://purser-try.max-31b.workers.dev/";

describe("the cloud pages carry the site's header", () => {
  it("reads the site's origin from package.json's homepage", () => {
    const home = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { homepage: string }).homepage;
    expect(SITE_ORIGIN).toBe(home);
    expect(SITE_HEADER_LINKS.base).toBe(home);
  });

  it("is the site's markup (same classes, items and words); links absolute to the site except Try and Purser Cloud", () => {
    for (const k of ["try", "cloud", null] as const) {
      const html = siteHeader(k);
      expect(shape(html)).toBe(shape(snap.header[String(k)]!));
      for (const h of hrefs(html)) {
        if (h === "/try" || (h === "/" && k !== "try") || (h === CLOUD && k === "try")) continue;
        expect(h.startsWith(`${SITE_ORIGIN}/`), h).toBe(true);
      }
    }
    const t = siteHeader("try");
    expect(t).toContain('<a href="/try" class="on" aria-current="page">Try</a>');
    expect(t).toContain(`<a class="brand" href="${SITE_ORIGIN}/home"`);
    expect(t).toContain(`<a href="${SITE_ORIGIN}/proof">Proof</a>`);
    // /try is served on the site's host too (kit11's TRY_ENGINE): Purser Cloud is absolute there, never "/".
    expect(t).toContain(`<a href="${CLOUD}">Purser Cloud</a>`);
    expect(hrefs(t)).not.toContain("/");
    expect(t).toContain(`<a href="${SITE_ORIGIN}/security">Security</a>`);
    expect(t).not.toMatch(/\/(pricing|tour)"/);
    const c = siteHeader("cloud");
    expect(c).toContain('<a href="/" aria-current="page">Purser Cloud</a>');
    expect(c).toContain('<summary class="on">More</summary>');
    expect(c).not.toContain('class="on" aria-current="page">Try');
    // Every item of the site's menu is there, in its order.
    expect([...c.matchAll(/<a href="[^"]*"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual([...shape(snap.header.cloud!).matchAll(/<a href="[^"]*"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]));
    expect(moreLinks().length).toBeGreaterThan(4);
  });

  it("/try and the console start with the site's header; the nonce policy is unchanged and nothing inline runs", () => {
    const n = "bm9uY2Vub25jZQ==";
    const pages = [tryPage(n, { origin: "https://x.test", rpId: "x.test" }), consolePage(n, { origin: "https://x.test", rpId: "x.test", mailDomain: "x.test" })];
    for (const html of pages) {
      const body = html.slice(html.indexOf("<body"));
      // The console marks no item since the review of 13 Nov ("More" was marked on every page); /try marks Try.
      expect(body).toContain(siteHeader(html.includes("purser-try") ? "try" : null));
      expect(html).toContain(HEADER_CSS_MARK);
      expect(html).not.toMatch(/\son[a-z]+="/);
      expect(html).not.toMatch(/<script(?![^>]*nonce=)/);
      expect(html).not.toMatch(/<script[^>]*\bsrc=/);
      expect((html.match(/<header class="top">/g) ?? []).length).toBe(1);
    }
    expect(consoleCsp(n)).toBe(CSP_BEFORE.replaceAll("NONCE", n));
  });
});

/** The header's own CSS (src/redesign/ui.ts HEADER_CSS) in the cloud pages: its first line. */
const HEADER_CSS_MARK = '/* Header: brand, four tabs and "More" (a <details>, no script), nothing else. */';
/** The console's policy (cloud/src/console.ts consoleCsp) as it was before the header came (12 Nov), with NONCE for the nonce. */
const CSP_BEFORE = "default-src 'none'; script-src 'nonce-NONCE' 'self'; style-src 'nonce-NONCE'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
