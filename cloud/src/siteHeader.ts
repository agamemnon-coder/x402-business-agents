// The site's header on Purser Cloud's pages (12 Nov, owner: "/try still shows its own logo and has no menu"): /try and
// the console draw the very header of the site (package.json's homepage), its brand, its four tabs and "More", from
// the site's own function and style (src/redesign/ui.ts header and HEADER_CSS, src/ui/more.ts), not a copy. Its links
// go to the site, absolute, except Try (/try here) and, on the console, Purser Cloud (/ here; absolute on /try). "More" is a <details>: no script, so the
// pages' nonce policy (cloud/src/console.ts consoleCsp) stays as it was.

import { HEADER_CSS, header, type HeaderLinks } from "../../src/redesign/ui.js";
import type { PageKey } from "../../src/ui/more.js";

/** The site's origin: package.json's homepage (test/site-header-shared.test.ts holds the two equal). */
export const SITE_ORIGIN = "https://kit11.max-31b.workers.dev";

/** Every link to the site, except the two pages this Worker serves itself. */
export const SITE_HEADER_LINKS: HeaderLinks = { base: SITE_ORIGIN, here: { try: "/try", cloud: "/" } };

/**
 * /try's: the same, except Purser Cloud, which is absolute, always (src/ui/more.ts's address): /try is served on the
 * site's own host too (kit11's TRY_ENGINE binding, worker/src/index.ts), where "/" is the site's home. Try stays "/try",
 * which is this page on either host. The console is never served on the site's host and keeps "/".
 */
export const TRY_HEADER_LINKS: HeaderLinks = { base: SITE_ORIGIN, here: { try: "/try" } };

/** The site's header, `current` marked as the site marks it ("try" on /try, "cloud", under "More", on the console). */
export const siteHeader = (current: PageKey | null): string => header(current, current === "try" ? TRY_HEADER_LINKS : SITE_HEADER_LINKS);

/**
 * The header's style: what the site's page gives its header (the 1200 px wrap and its gutter, the icon's alignment, the
 * brand in the text colour), scoped to the header so the cloud page keeps its own; then the site's own HEADER_CSS; then
 * one correction for a rule of the console's shared kit (src/ui/payablesKit.ts hides a brand's name under 640 px; the
 * site does that only under 420 px). Put it after the page's own style: at equal weight the site's rules win.
 */
export const SITE_HEADER_CSS = `
header.top { --gut: 16px; }
@media (min-width: 720px) { header.top { --gut: 32px; } }
header.top > .wrap { max-width: 1200px; margin: 0 auto; padding: 0 var(--gut); }
header.top .i { flex: none; vertical-align: -3px; }
header.top a.brand { color: inherit; }
${HEADER_CSS}
@media (min-width: 421px) and (max-width: 640px) { header.top .brand > span.nm { display: inline; } }
`;
