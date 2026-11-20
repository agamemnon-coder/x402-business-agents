// Which pages search engines may index (the owner, 20 Nov: the public marketing pages are findable). The public pages
// are sent without noindex, each with its canonical address; every private or per-visitor answer, every JSON, asset
// and redirect keeps `x-robots-tag: noindex, nofollow`. /robots.txt and /sitemap.xml list only the public pages.
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { INDEXABLE_PATHS, ROBOTS_TXT, SITEMAP_URLS, SITEMAP_XML, canonicalUrl, isIndexable } from "../src/lib/siteIndex.js";
import { SITE_URL } from "../src/ui/meta.js";
import { pageResponse } from "../worker/src/core.js";
import { TRY_CANONICAL_LINK } from "../cloud/src/tryPage.js";

const BASE = "https://relay.example.test";
const pages = buildPages();
const get = (path: string) => pageResponse(new Request(`${BASE}${path}`), pages);

describe("the site's index", () => {
  it("serves every public page without noindex, with its canonical address", () => {
    for (const path of ["/", "/home", "/proof", "/verify", "/airwallex", "/alta", "/visa", "/claude", "/security", "/docs", "/books", "/status", "/t0", "/runs", "/trace", "/watch", "/airwallex/calls", "/agents/sourcing"]) {
      const res = get(path)!;
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toMatch(/^text\/html/);
      expect(res.headers.get("x-robots-tag"), path).toBeNull();
      expect(res.headers.get("link"), path).toBe(`<${canonicalUrl(path)}>; rel="canonical"`);
    }
    // Home's canonical is /home, as its own <link rel="canonical">.
    expect(get("/")!.headers.get("link")).toBe(`<${SITE_URL}/home>; rel="canonical"`);
    expect(pages.home).toContain(`<link rel="canonical" href="${SITE_URL}/home">`);
  });

  it("keeps noindex on every private or per-visitor page, the dashboard, the APIs, the assets, the redirects and the 404", () => {
    for (const path of ["/?dashboard", "/?recorded", "/approve/P-0001", "/enrol", "/policy", "/month", "/lab", "/film", "/replay", "/metal/report", "/offline", "/app",
      "/proof.json", "/receipt-sample.json", "/llms.txt", "/assets/inter.woff2", "/assets/logo-airwallex.png", "/assets/approve.js", "/favicon.ico",
      "/robots.txt", "/sitemap.xml", "/.well-known/security.txt", "/live", "/tour", "/mcp"]) {
      const res = get(path);
      expect(res, path).not.toBeNull();
      expect(res!.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
      expect(res!.headers.get("link"), path).toBeNull();
    }
    expect(isIndexable("/", "?dashboard")).toBe(false);
    expect(isIndexable("/try/sign")).toBe(false);
    expect(isIndexable("/approve/P-0001")).toBe(false);
  });

  it("/try, Purser Cloud's page passed on by the site, names the site's /try as canonical", () => {
    expect(INDEXABLE_PATHS).toContain("/try");
    expect(TRY_CANONICAL_LINK).toBe(`<${SITE_URL}/try>; rel="canonical"`);
  });

  it("answers /robots.txt and /sitemap.xml: the public pages only, each canonical address once", async () => {
    const robots = get("/robots.txt")!;
    expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await robots.text()).toBe(ROBOTS_TXT);
    expect(ROBOTS_TXT).toMatch(/^User-agent: \*\n/);
    expect(ROBOTS_TXT).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    for (const p of ["/api/", "/approve/", "/enrol", "/policy", "/try/sign"]) expect(ROBOTS_TXT).toContain(`Disallow: ${p}\n`);
    for (const p of INDEXABLE_PATHS) expect(ROBOTS_TXT.split("\n").filter((l) => l.startsWith("Disallow: ")).some((l) => p.startsWith(l.slice("Disallow: ".length))), p).toBe(false);
    const map = get("/sitemap.xml")!;
    expect(map.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const xml = await map.text();
    expect(xml).toBe(SITEMAP_XML);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs).toEqual([...SITEMAP_URLS]);
    expect(new Set(locs).size).toBe(locs.length);
    expect(locs).toContain(`${SITE_URL}/home`);
    expect(locs).toContain(`${SITE_URL}/try`);
    expect(locs).not.toContain(`${SITE_URL}/`);
    for (const l of locs) expect(l).not.toMatch(/approve|enrol|policy|try\/sign|\/api\/|\?/);
  });
});
