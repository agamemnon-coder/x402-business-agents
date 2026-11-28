// "Built on Airwallex" (the owner, 14 Nov: the product is built on Airwallex, and that should show everywhere). One
// small badge, one style, on every page that carries the site's header (Home, /try, /proof, /docs and Purser Cloud)
// and in the console's footer. Airwallex is the platform; the other partners stay on the "Works with" line.
//
// The logo is the official file (src/ui/logos/airwallex.png, docs/assets/logos/SOURCES.md), kept unaltered in the
// repository; the pages are served a copy of the same artwork scaled to 306 x 42, three times the badge's 102 x 14
// (src/ui/logos/airwallex-306x42.png: resized only, not redrawn or recoloured; site audit, 19 Nov: the 2435 x 334 file
// was 36 KB for a 14 px badge). Shown at a fixed height smaller than Purser's own mark, on a white ground in both themes
// (the file is a dark wordmark with no light version). "Built on" only: never "partner", "endorsed" or "certified".

import { ASSET_VERSIONS } from "./assetVersions.js";

/** The words beside the logo. Factual: the product runs on Airwallex's APIs. */
export const BUILT_ON_LABEL = "Built on";
export const BUILT_ON_ALT = "Airwallex";
/** The one sentence for prose (README, the long description): no partnership or endorsement implied. */
export const BUILT_ON_LINE = "Built on Airwallex.";
/**
 * The site serves the file here (src/servers/dashboard.ts LOGOS). Purser Cloud's pages load it from the site, absolute
 * (their CSP allows the site's origin for images: cloud/src/console.ts consoleCsp): one copy, no bytes in the Worker.
 */
export const AIRWALLEX_LOGO_PATH = "/assets/logo-airwallex.png";
/** The address the pages use: the path with the file's content version, so the Worker may cache it for a year. */
export const AIRWALLEX_LOGO_SRC = `${AIRWALLEX_LOGO_PATH}?v=${ASSET_VERSIONS["logo-airwallex.png"]}`;
/** The scaled copy the site serves, and the official file it is scaled from (kept byte for byte). */
export const AIRWALLEX_LOGO_FILE = "src/ui/logos/airwallex-306x42.png";
export const AIRWALLEX_LOGO_ORIGINAL = "src/ui/logos/airwallex.png";
/** The served file's own size (306 × 42; the original is 2435 × 334): the badge shows it at LOGO_HEIGHT px high, the width kept in proportion. */
export const AIRWALLEX_LOGO_SIZE = { width: 306, height: 42 } as const;
/** Smaller than Purser's mark in the header (a 30 px tile); 21 Nov (Max): 12 px, the badge read too large beside the brand. */
export const LOGO_HEIGHT = 12;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * AIRWALLEX_LOGO_SIZE.width) / AIRWALLEX_LOGO_SIZE.height);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The badge: "Built on" and the Airwallex logo on a white pill. `href` makes it a link (the site's Airwallex page, which
 * says what Purser uses); `cls` adds a class for where it sits; `src` the logo's address (absolute off the site).
 */
export function builtOnBadge(o: { href?: string; cls?: string; src?: string } = {}): string {
  const cls = `awx-badge${o.cls ? ` ${o.cls}` : ""}`;
  const inner = `<span class="awx-l">${esc(BUILT_ON_LABEL)}</span><img src="${esc(o.src ?? AIRWALLEX_LOGO_SRC)}" alt="${esc(BUILT_ON_ALT)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}">`;
  return o.href
    ? `<a class="${cls}" href="${esc(o.href)}" title="${esc(`${BUILT_ON_LABEL} ${BUILT_ON_ALT}`)}">${inner}</a>`
    : `<span class="${cls}">${inner}</span>`;
}

/**
 * The badge's style, the same in light and dark: a white pill (the logo has no light version), dark words, a hairline.
 * Self-contained (no page token), so the site and Purser Cloud draw it alike.
 */
export const BUILT_ON_CSS = `.awx-badge { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 4px 9px; border-radius: 999px; background: #ffffff; border: 1px solid #e3e6ec; color: #3b4456; font: 600 11px/1 Inter, system-ui, -apple-system, sans-serif; letter-spacing: 0; text-decoration: none; white-space: nowrap; }
.awx-badge img { display: block; height: ${LOGO_HEIGHT}px; width: auto; min-width: ${LOGO_WIDTH}px; overflow: hidden; font: 800 12px/12px Inter, system-ui, -apple-system, sans-serif; letter-spacing: -.02em; color: #f2512f; }
a.awx-badge:hover { border-color: #c9cfda; }
/* 21 Nov (Max: "the big white tag next to Purser is still too much"): in a header the pill goes; "Built on" is quiet text and only the logo, which has no light version, sits on a small white chip. */
header .awx-badge, .awx-app .awx-badge, .awx-row .awx-badge { background: transparent; border: 0; padding: 2px 0; gap: 6px; color: var(--muted, #8b93a7); font-weight: 500; }
header .awx-badge img, .awx-app .awx-badge img, .awx-row .awx-badge img { box-sizing: content-box; height: 10px; min-width: 0; width: auto; padding: 3px 6px; border-radius: 6px; background: #ffffff; }
header a.awx-badge:hover, .awx-app a.awx-badge:hover, .awx-row a.awx-badge:hover { color: var(--text, #e8eaf0); }
a.awx-badge:focus-visible { outline: 2px solid var(--accent, #246bdd); outline-offset: 2px; }`;
