// "Built on Airwallex" (the owner, 14 Nov: the product is built on Airwallex, and that should show everywhere). One
// badge (src/ui/builtOn.ts) in the header of every page that carries the site's header (Home, /proof, /docs, /try on
// both of its screens, Purser Cloud's console and landing) and in the console's footer; the official logo file,
// unaltered, smaller than Purser's mark; "Built on" only, never a word that implies a partnership or an endorsement.
// The link preview says it too (test/site-meta.test.ts holds the card and the tags).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { AIRWALLEX_LOGO_PATH, BUILT_ON_CSS, LOGO_HEIGHT, builtOnBadge } from "../src/ui/builtOn.js";
import { HEADER_CSS, header } from "../src/redesign/ui.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { consoleCsp, consolePage } from "../cloud/src/console.js";
import { SITE_ORIGIN } from "../cloud/src/siteHeader.js";
import * as COPY from "../cloud/src/tryCopy.js";
import { t } from "../src/ui/i18n.js";
import { OG_DESCRIPTION, OG_IMAGE, OG_TITLE } from "../src/ui/meta.js";
import { pageResponse, type Pages } from "../worker/src/core.js";

const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const n = "bm9uY2U=";
const cloudTry = tryPage(n, { origin: "https://x.test", rpId: "x.test" });
const cloudConsole = consolePage(n, { origin: "https://x.test", rpId: "x.test", mailDomain: "x.test" });
const badges = (html: string) => [...html.matchAll(/<a class="awx-badge[^"]*"[\s\S]*?<\/a>/g)].map((m) => m[0]);
const headerOf = (html: string) => /<header class="top">[\s\S]*?<\/header>\n<div class="awx-row">[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";

describe("the Built on Airwallex badge", () => {
  it("is one component: the words, the official logo at a fixed height below Purser's 30 px mark, no endorsement words", () => {
    const b = builtOnBadge({ href: "airwallex" });
    expect(b).toBe(`<a class="awx-badge" href="airwallex" title="Built on Airwallex"><span class="awx-l">Built on</span><img src="${AIRWALLEX_LOGO_PATH}" alt="Airwallex" width="102" height="14"></a>`);
    expect(LOGO_HEIGHT).toBeLessThan(30);
    expect(b).not.toMatch(/partner|endorse|certified|official|approved|powered/i);
    // The same look in light and dark: a white pill (the file is a dark wordmark with no light version), never a filter.
    expect(BUILT_ON_CSS).toContain("background: #ffffff");
    expect(BUILT_ON_CSS).not.toMatch(/filter|opacity|invert|mix-blend/);
    expect(HEADER_CSS).toContain(BUILT_ON_CSS);
  });

  it("is in the header of Home, /proof and /docs (beside the brand, and on a phone on its own line), linking the site's Airwallex page", () => {
    for (const name of ["home", "proof", "docs"] as const) {
      const html = pages[name] as string;
      const h = headerOf(html);
      expect({ name, inHeader: badges(h).length }).toEqual({ name, inHeader: 2 });
      for (const b of badges(h)) expect(b).toContain('href="airwallex"');
      expect(h).toMatch(/<span class="nm">Purser<\/span><\/a><a class="awx-badge awx-h"/);
      expect(h).toContain('<div class="awx-row"><a class="awx-badge awx-m"');
    }
  });

  it("is in /try's header (both screens: the header stays) and in Purser Cloud's header and console footer, the logo from the site", () => {
    for (const [name, html] of [["/try", cloudTry], ["console", cloudConsole]] as const) {
      const h = headerOf(html);
      expect({ name, inHeader: badges(h).length }).toEqual({ name, inHeader: 2 });
      for (const b of badges(h)) {
        expect(b).toContain(`href="${SITE_ORIGIN}/airwallex"`);
        expect(b).toContain(`src="${SITE_ORIGIN}${AIRWALLEX_LOGO_PATH}"`);
      }
    }
    expect(cloudConsole).toMatch(/<p class="foot-awx wrap"><a class="awx-badge" href="https:\/\/kit11\.max-31b\.workers\.dev\/airwallex"/);
    // On a phone, signed out (the landing), in the app bar's empty left, so the sign-in card keeps the first screen;
    // /try's start lays its line over the band's empty top for the same reason (test/browser/console.check.ts, try.check.ts).
    expect(cloudConsole).toMatch(/<span class="awx-app"><a class="awx-badge" href="https:\/\/kit11\.max-31b\.workers\.dev\/airwallex"/);
    expect(cloudConsole).toContain(".signed-out .awx-app { display: inline-flex; }");
    expect(cloudTry).toContain("body:has(.screen.start) .awx-row { position: absolute; top: 65px;");
    // The cloud's pages may load images from the site, for this logo; nothing else in the policy moved.
    expect(consoleCsp("N")).toContain(`img-src 'self' data: blob: ${SITE_ORIGIN};`);
    // The header is the site's own function, so every page draws it alike.
    expect(header("try", { base: SITE_ORIGIN, here: { try: "/try" } })).toContain(`src="${SITE_ORIGIN}${AIRWALLEX_LOGO_PATH}"`);
  });

  it("shows the logo file the site serves, byte for byte (src/ui/logos/airwallex.png, docs/assets/logos/SOURCES.md)", () => {
    const file = readFileSync(new URL("../src/ui/logos/airwallex.png", import.meta.url));
    const sources = readFileSync(new URL("../docs/assets/logos/SOURCES.md", import.meta.url), "utf8");
    expect(sources).toContain("`58f3984f584548271144122c7d139e9a6a8a1ad37d683263e74104ac65cd390e`");
    expect(createHash("sha256").update(file).digest("hex")).toBe("58f3984f584548271144122c7d139e9a6a8a1ad37d683263e74104ac65cd390e");
    const res = pageResponse(new Request(`https://x.test${AIRWALLEX_LOGO_PATH}`), pages as Pages);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("image/png");
  });

  it("leaves the others on the \"Works with\" line: Airwallex is the platform", () => {
    expect(COPY.START.trust.startsWith("Works with Alta")).toBe(true);
    expect(t("en", "cs.trust_works").startsWith("Works with Alta")).toBe(true);
    expect(t("nl", "cs.trust_works").startsWith("Werkt met Alta")).toBe(true);
  });

  it("is in the link preview: the title, the description, the alt text and a new image address", () => {
    expect(OG_TITLE).toBe("Purser · AI agents spend. You sign off. Built on Airwallex.");
    expect(OG_DESCRIPTION).toMatch(/Built on Airwallex\.$/);
    expect(OG_IMAGE).toMatch(/\/assets\/og-\d{4}\.png$/);
    const res = pageResponse(new Request(OG_IMAGE.replace(/^https:\/\/[^/]+/, "https://x.test")), pages as Pages);
    expect(res?.status).toBe(200);
  });
});
