// "Built on Airwallex" (the owner, 14 Nov: the product is built on Airwallex, and that should show everywhere). One
// small badge, one style, on every page that carries the site's header (Home, /try, /proof, /docs and Purser Cloud)
// and in the console's footer. Airwallex is the platform; the other partners stay on the "Works with" line.
//
// The logo is the official file, unaltered (src/ui/logos/airwallex.png, docs/assets/logos/SOURCES.md), shown at a
// fixed height smaller than Purser's own mark, on a white ground in both themes (the file is a dark wordmark with no
// light version). "Built on" only: never "partner", "endorsed" or "certified".

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
/** The file's own size (2435 × 334): the badge shows it at LOGO_HEIGHT px high, the width kept in proportion. */
export const AIRWALLEX_LOGO_SIZE = { width: 2435, height: 334 } as const;
/** Smaller than Purser's mark in the header (a 30 px tile). */
export const LOGO_HEIGHT = 14;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * AIRWALLEX_LOGO_SIZE.width) / AIRWALLEX_LOGO_SIZE.height);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The badge: "Built on" and the Airwallex logo on a white pill. `href` makes it a link (the site's Airwallex page, which
 * says what Purser uses); `cls` adds a class for where it sits; `src` the logo's address (absolute off the site).
 */
export function builtOnBadge(o: { href?: string; cls?: string; src?: string } = {}): string {
  const cls = `awx-badge${o.cls ? ` ${o.cls}` : ""}`;
  const inner = `<span class="awx-l">${esc(BUILT_ON_LABEL)}</span><img src="${esc(o.src ?? AIRWALLEX_LOGO_PATH)}" alt="${esc(BUILT_ON_ALT)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}">`;
  return o.href
    ? `<a class="${cls}" href="${esc(o.href)}" title="${esc(`${BUILT_ON_LABEL} ${BUILT_ON_ALT}`)}">${inner}</a>`
    : `<span class="${cls}">${inner}</span>`;
}

/**
 * The badge's style, the same in light and dark: a white pill (the logo has no light version), dark words, a hairline.
 * Self-contained (no page token), so the site and Purser Cloud draw it alike.
 */
export const BUILT_ON_CSS = `.awx-badge { display: inline-flex; align-items: center; gap: 7px; flex: none; padding: 5px 11px; border-radius: 999px; background: #ffffff; border: 1px solid #e3e6ec; color: #3b4456; font: 600 12px/1 Inter, system-ui, -apple-system, sans-serif; letter-spacing: 0; text-decoration: none; white-space: nowrap; }
.awx-badge img { display: block; height: ${LOGO_HEIGHT}px; width: auto; }
a.awx-badge:hover { border-color: #c9cfda; }
a.awx-badge:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }`;
