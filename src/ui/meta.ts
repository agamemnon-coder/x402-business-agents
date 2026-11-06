// One set of link-preview tags for every page the relay serves (jury QA, 6 Nov, Q5 and Q8): a description, Open Graph
// title, description and an absolute image (a relative "assets/og.png" was a 404 from /try/sign and is not read by
// every link preview), the Twitter card, and the favicon. The redesigned pages write their own (src/redesign/ui.ts,
// from the same constants); every other page gets them here, put into its <head> when the bundle is built
// (src/relay/assets.ts). Tags only, no script or style, so no page's CSP hash changes.

import { CORE_SENTENCE, HERO } from "../config/brand.js";

/** The hosted site. */
export const SITE_URL = "https://kit11.max-31b.workers.dev";
/** The link preview's image, absolute (the Worker serves it at /assets/og.png). */
export const OG_IMAGE = `${SITE_URL}/assets/og.png`;
/** The one tagline (Q8): the film's line and Home's heading. */
export const TAGLINE_LINE = HERO;
/** What a page says about itself when it says nothing of its own. */
export const SITE_DESCRIPTION = `${HERO} ${CORE_SENTENCE}`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The Open Graph title for a page: Home's carries the tagline, every other page its own title and the name. */
export const ogTitle = (title: string) => (title === "Purser" ? `Purser · ${TAGLINE_LINE}` : /\bPurser\b/.test(title) ? title : `${title} · Purser`);

/**
 * Puts the shared tags into a page's <head>, each only where the page has none of its own. `icon: false` for a page
 * whose CSP allows no image at all (img-src 'none': the CFO's private pages and the dispute report), where a favicon
 * link would only be refused.
 */
export function withMeta(html: string, o: { description?: string; icon?: boolean } = {}): string {
  const head = /<head>[\s\S]*?<\/head>/i.exec(html)?.[0];
  if (!head) return html;
  const title = (/<title>([^<]*)<\/title>/.exec(head)?.[1] ?? "Purser").replace(/&amp;/g, "&");
  const description = o.description ?? SITE_DESCRIPTION;
  const tags = [
    /<meta name="description"/.test(head) ? "" : `<meta name="description" content="${esc(description)}">`,
    /og:type/.test(head) ? "" : '<meta property="og:type" content="website">',
    /og:site_name/.test(head) ? "" : '<meta property="og:site_name" content="Purser">',
    /og:title/.test(head) ? "" : `<meta property="og:title" content="${esc(ogTitle(title))}">`,
    /og:description/.test(head) ? "" : `<meta property="og:description" content="${esc(description)}">`,
    /og:image/.test(head) ? "" : `<meta property="og:image" content="${OG_IMAGE}">`,
    /twitter:card/.test(head) ? "" : '<meta name="twitter:card" content="summary_large_image">',
    o.icon === false || /rel="icon"/.test(head) ? "" : '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">',
  ].filter(Boolean);
  if (!tags.length) return html;
  return html.replace(/<\/title>/, () => `</title>\n${tags.join("\n")}`);
}
