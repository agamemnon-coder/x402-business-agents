// Which of the site's pages search engines may index (the owner, 20 Nov: make the public marketing pages findable).
// Until then every answer carried `x-robots-tag: noindex, nofollow` (worker/src/core.ts COMMON_HEADERS, since the relay
// Worker of 29 Oct). Now the public pages below are sent without it, each with its canonical address in a Link header,
// and /robots.txt and /sitemap.xml list them. Everything else keeps noindex: the CFO's dashboard (/ with a query), the
// approval, enrolment and policy pages, /try/sign's test worlds, the installed app, every JSON, script, stylesheet,
// font and image, the redirects and the 404. test/site-index.test.ts holds both lists.

import { SITE_URL } from "../ui/siteUrl.js";

/** The Kit 11 agents, each with a public page at /agents/<id> (src/redesign/agents.ts). */
export const AGENT_PAGE_IDS = ["sourcing", "support", "treasury"] as const;

/**
 * The public pages, by path: Home (/ and /home), the four tabs' pages, the pages under "More" and the footer
 * (src/ui/more.ts), the partner pages, and the record pages they link (/runs, /trace, /verify, /status, /airwallex/calls,
 * /agents/<id>). /try is Purser Cloud's page passed on by the site (worker/src/tryEngine.ts); it sends no noindex.
 */
export const INDEXABLE_PATHS: readonly string[] = [
  "/", "/home", "/try", "/watch", "/proof", "/verify", "/runs", "/trace",
  "/security", "/docs", "/books", "/status",
  "/airwallex", "/airwallex/calls", "/alta", "/visa", "/claude", "/t0",
  ...AGENT_PAGE_IDS.map((id) => `/agents/${id}`),
];
const INDEXABLE = new Set(INDEXABLE_PATHS);

/**
 * May this answer be indexed? Only a public page's own path, and "/" only without a query: "/?…" is the CFO's dashboard
 * (worker/src/core.ts pageResponse). Anything else (a phone page, a test world, an API, an asset) is not.
 */
export function isIndexable(path: string, search = ""): boolean {
  if (!INDEXABLE.has(path)) return false;
  return path !== "/" || !search;
}

/** A public page's one canonical address: Home's is /home (as its <link rel="canonical">, src/redesign/home.ts). */
export function canonicalUrl(path: string): string {
  return `${SITE_URL}${path === "/" ? "/home" : path}`;
}

/** The pages /sitemap.xml lists: each canonical address once (/ and /home are one page). */
export const SITEMAP_URLS: readonly string[] = [...new Set(INDEXABLE_PATHS.map(canonicalUrl))];

/** /sitemap.xml (sitemaps.org 0.9): the canonical addresses, nothing else. */
export const SITEMAP_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...SITEMAP_URLS.map((u) => `  <url><loc>${u}</loc></url>`),
  "</urlset>",
  "",
].join("\n");

/**
 * The paths no crawler should fetch (RFC 9309): the APIs and webhooks, the CFO's phone pages, /try/sign's test worlds,
 * the installed app, and the old addresses that only redirect. noindex on each answer stays the real guard.
 */
export const ROBOTS_DISALLOW: readonly string[] = ["/api/", "/hooks/", "/v1/", "/approve/", "/enrol", "/policy", "/try/sign", "/try/verify", "/app", "/offline", "/go"];

/** /robots.txt: every crawler, the private paths disallowed, the sitemap named. */
export const ROBOTS_TXT = [
  "User-agent: *",
  ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`),
  "Allow: /",
  "",
  `Sitemap: ${SITE_URL}/sitemap.xml`,
  "",
].join("\n");
