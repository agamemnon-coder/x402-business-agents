// Purser's mark, once: docs/assets/brand/purser-mark.svg (#254, the header's mark: a white feather 16 of 30 units wide,
// centred on a dark square with corners of 9 of 30), drawn here on a 64 grid. Every icon is drawn from this (owner,
// 13 Nov: the browser tab showed a cyan feather, the header a white one): the site's favicon.svg, and the PNGs and the
// ICO that `npm run cloud:icons` renders into src/ui/brand/icons.gen.ts for both Workers (kit11 and Purser Cloud) and
// the MCP server. test/brand-icons.test.ts holds the two the same.

import { ICONS } from "../icons.js";

/** The header's ink (`--text` in light mode) and purser-mark.svg's proportions: square 30, corners 9, feather 16. */
export const MARK_INK = "#0b1220";
const SQUARE = 30, CORNER = 9, FEATHER = 16;

/** The query on every icon link, so a browser that kept the old icon fetches this one (13 Nov). */
export const ICON_VERSION = "1113b";

const paths = ICONS.feather!.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");

/** The mark on a 64 grid. `bleed`: no rounded corners (an iOS home-screen icon, which iOS rounds itself). */
export function markSvg(o: { bleed?: boolean } = {}): string {
  const k = 64 / SQUARE, size = FEATHER * k, at = (64 - size) / 2, scale = size / 24;
  const r = o.bleed ? 0 : CORNER * k;
  const n = (x: number) => Number(x.toFixed(4)).toString();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${n(r)}" fill="${MARK_INK}"/><g transform="translate(${n(at)} ${n(at)}) scale(${n(scale)})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}
