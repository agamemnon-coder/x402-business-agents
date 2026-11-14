// One set of link-preview tags for every page the relay serves (jury QA, 6 Nov, Q5 and Q8): a description, Open Graph
// title, description and an absolute image (a relative "assets/og.png" was a 404 from /try/sign and is not read by
// every link preview), the Twitter card, and the favicon. The redesigned pages write their own (src/redesign/ui.ts,
// from the same constants); every other page gets them here, put into its <head> when the bundle is built
// (src/relay/assets.ts). Tags only, no script or style, so no page's CSP hash changes.

import { formerlyMetal } from "./formerly.js";
import { CORE_SENTENCE, HERO } from "../config/brand.js";
import { ICON_VERSION } from "./brand/mark.js";

/** The hosted site. */
export const SITE_URL = "https://kit11.max-31b.workers.dev";
/**
 * The link preview's image, absolute (the Worker serves it at /assets/og.png): 1200×630, the same file as
 * docs/assets/social-preview.png (`npm run visuals`, src/visuals/svg.ts socialSvg). Since 13 Nov (the owner: the dark
 * square with a tiny line read poorly in chats) the one line large, one small line, the payment's path to Face ID and
 * the "Built with" line in words (no partner marks, the final partner review). The query only gives the new image a new address, so the previews that cached the old one
 * fetch it again. No square version: the tags name this one image.
 */
export const OG_IMAGE = `${SITE_URL}/assets/og.png?v=1113c`;
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/** Every page's preview says the same (the owner, 13 Nov: a long, page-by-page description looked messy in a chat). */
export const OG_TITLE = `Purser — ${HERO}`;
export const OG_DESCRIPTION = "Your AI agents pay suppliers. Every payment above their limit needs your Face ID.";
export const OG_ALT = `Purser. ${HERO} Every payment above its limit waits for your Face ID or a passkey.`;
/** The one tagline (Q8): the film's line and Home's heading. */
export const TAGLINE_LINE = HERO;
/** What a page says about itself when it says nothing of its own. */
export const SITE_DESCRIPTION = `${HERO} ${CORE_SENTENCE}`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The link-preview tags, the same on every page of the site and of Purser Cloud (src/redesign/ui.ts `page`, `withMeta`
 * below, cloud/src/brand.ts): Open Graph and the Twitter card, the one title, the one short sentence, the image with its
 * size and its alt text. Tags only: no page's CSP changes.
 */
export function previewTags(o: { url?: string } = {}): string[] {
  return [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Purser">',
    `<meta property="og:title" content="${esc(OG_TITLE)}">`,
    `<meta property="og:description" content="${esc(OG_DESCRIPTION)}">`,
    ...(o.url ? [`<meta property="og:url" content="${esc(o.url)}">`] : []),
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta property="og:image:type" content="image/png">',
    `<meta property="og:image:width" content="${OG_IMAGE_SIZE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE_SIZE.height}">`,
    `<meta property="og:image:alt" content="${esc(OG_ALT)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(OG_TITLE)}">`,
    `<meta name="twitter:description" content="${esc(OG_DESCRIPTION)}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
    `<meta name="twitter:image:alt" content="${esc(OG_ALT)}">`,
  ];
}


/**
 * Puts the shared tags into a page's <head>, each only where the page has none of its own. `icon: false` for a page
 * whose CSP allows no image at all (img-src 'none': the CFO's private pages and the system health page), where a favicon
 * link would only be refused.
 */
export function withMeta(html: string, o: { description?: string; icon?: boolean } = {}): string {
  const head = /<head>[\s\S]*?<\/head>/i.exec(html)?.[0];
  if (!head) return formerlyMetal(html);
  const description = o.description ?? SITE_DESCRIPTION;
  const tags = [
    /<meta name="description"/.test(head) ? "" : `<meta name="description" content="${esc(description)}">`,
    ...(/property="og:|name="twitter:/.test(head) ? [] : previewTags()),
    o.icon === false || /rel="icon"/.test(head) ? "" : `<link rel="icon" href="/assets/favicon.svg?v=${ICON_VERSION}" type="image/svg+xml">\n<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=${ICON_VERSION}">`,
  ].filter(Boolean);
  if (!tags.length) return formerlyMetal(html);
  return formerlyMetal(html.replace(/<\/title>/, () => `</title>\n${tags.join("\n")}`));
}
