// The integrations band (Max, 21 Nov: "Logos of the companies you can integrate with, as a moving band, on the homepage
// (and on /docs), showing that you can work with them"). One row of marks, each on its own white tile in both themes, the
// file as it is on record (src/ui/logos/README.md, docs/evidence/logo-permissions.md): never filtered or recoloured. It
// drifts sideways on a loop; for a reader who prefers less motion it stands still and wraps. Every name here is a
// connection Purser Cloud's hub lists (cloud/src/connections.ts, docs/integrations/README.md), and the line under the
// band says that each one carries its own label there (live, sandbox, testnet, a format export or built): the band
// shows who Purser connects to, the hub how far each connection goes. Visa and T:0 stay as text (no mark on file for
// T:0; Visa's mark is shown nowhere on Purser's own art, the decision of 14 Nov, since 21 Nov on Connections too).
// 21 Nov (Max): the connections' marks are back; Visa and T:0 stay text.

import { BRAND_LOGOS } from "../../cloud/src/brandLogos.gen.js";
import { ASSET_VERSIONS, versioned, type VersionedAsset } from "../ui/assetVersions.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

/** One mark in the band: a file served at /assets/<file>, or a name as text (no mark on file, or text by decision). */
export interface BandItem { name: string; file?: string; /** A wordmark: it says the name itself, so no text beside it. */ wordmark?: boolean; w?: number; h?: number }

/** The brand files the band serves at /assets/brand-<key>.svg: the very drawings of Purser Cloud's Connections page. */
const BRAND_KEYS = ["chatgpt", "claude", "cursor", "vscode", "gemini", "mcp", "xero", "quickbooks", "exact", "moneybird", "odoo", "slack", "teams", "whatsapp", "gmail", "zapier", "make", "python", "typescript"] as const;
type BrandKey = (typeof BRAND_KEYS)[number];
const brandFile = (k: BrandKey) => `brand-${k}.svg`;

/**
 * The band's files, by the name the site serves them at: each the drawing in cloud/src/brandLogos.gen.ts (made by
 * npm run cloud:logos from src/ui/logos/brands/, a Simple Icons file drawn in its brand's colour), as SVG bytes. The
 * page's policy allows images from its own origin only (img-src 'self'), so no data URL.
 */
export function bandLogoFiles(): Record<string, { type: string; body: Buffer }> {
  return Object.fromEntries(BRAND_KEYS.map((k) => {
    const uri = BRAND_LOGOS[k]?.uri ?? "";
    const comma = uri.indexOf(",");
    if (!uri.startsWith("data:image/svg+xml,") || comma < 0) throw new Error(`integrations: no SVG drawing for ${k} in cloud/src/brandLogos.gen.ts`);
    return [brandFile(k), { type: "image/svg+xml", body: Buffer.from(decodeURIComponent(uri.slice(comma + 1)), "utf8") }];
  }));
}

const asset = (f: string) => `assets/${f in ASSET_VERSIONS ? versioned(f as VersionedAsset) : f}`;
/**
 * In the order a reader meets them: the rails, the AI clients, the books, the messages, the automations, the SDKs.
 * 21 Nov (Max): the connections' own marks are back, each named and labelled on the hub (nominative use, no endorsement
 * implied); Visa and T:0 stay text (no mark cleared for Purser's own art).
 */
export const BAND: readonly BandItem[] = [
  { name: "Airwallex", file: "logo-airwallex.png", wordmark: true, w: 306, h: 42 },
  { name: "Alta (formerly Metal)", file: "logo-alta.svg", wordmark: true, w: 475, h: 250 },
  { name: "Visa · Airwallex Airi" },
  { name: "Claude", file: "logo-claude-slate.svg", wordmark: true, w: 184, h: 40 },
  { name: "T:0" },
  { name: "ChatGPT", file: brandFile("chatgpt") },
  { name: "Cursor", file: brandFile("cursor") },
  { name: "VS Code", file: brandFile("vscode") },
  { name: "Gemini", file: brandFile("gemini") },
  { name: "MCP", file: brandFile("mcp") },
  { name: "QuickBooks", file: brandFile("quickbooks") },
  { name: "Exact", file: brandFile("exact") },
  { name: "Moneybird", file: brandFile("moneybird") },
  { name: "Microsoft Teams", file: brandFile("teams") },
  { name: "WhatsApp", file: brandFile("whatsapp") },
  { name: "Gmail", file: brandFile("gmail") },
  { name: "Zapier", file: brandFile("zapier") },
  { name: "Make", file: brandFile("make") },
  { name: "Python", file: brandFile("python") },
  { name: "TypeScript", file: brandFile("typescript") },
];
/** The hub of every connection, each with its label (docs/integrations/README.md). */
export const BAND_HUB = "docs/integrations/README.md";
// Review, 21 Nov: "Connects to (each labelled)", not "Works with" (no partnership read into a mark).
export const BAND_LABEL = "Connects to (each labelled)";
export const BAND_NOTE = "Each connection carries its label: live, sandbox, testnet, export or built.";
export const BAND_LINK = "See every connection";

const item = (b: BandItem) => b.file
  ? `<li class="lb-i${b.wordmark ? " wm" : ""}"><img src="${asset(b.file)}" alt="${esc(b.name)}"${b.w ? ` width="${b.w}" height="${b.h}"` : ' width="24" height="24"'} decoding="async">${b.wordmark ? "" : `<span>${esc(b.name)}</span>`}</li>`
  : `<li class="lb-i tx"><span>${esc(b.name)}</span></li>`;

/**
 * The band: the list once, as served (without script, or for a reader who prefers less motion, it stands still and
 * wraps). LOGO_BAND_JS adds a second copy, hidden from screen readers, so the loop has no seam, and only then it moves.
 * `note`: the line under it with the link to the hub.
 */
export function logoBandHtml(o: { note?: boolean; label?: string } = {}): string {
  return `<div class="lband" role="group" aria-label="${esc(o.label ?? BAND_LABEL)}">
  <p class="lb-h">${esc(o.label ?? BAND_LABEL)}</p>
  <div class="lb-view"><div class="lb-track"><ul class="lb-row">${BAND.map(item).join("")}</ul></div></div>
  ${o.note === false ? "" : `<p class="lb-note">${esc(BAND_NOTE)} <a href="${esc(`${REPO_BLOB}${BAND_HUB}`)}" target="_blank" rel="noopener">${esc(BAND_LINK)}${icon("external-link", 14)}</a></p>`}
</div>`;
}

export const LOGO_BAND_CSS = `
/* The integrations band: white tiles in both themes (each mark as on file), drifting on a loop. */
.lband { margin: 0; min-width: 0; max-width: 100%; }
.lband .lb-h { margin: 0 0 14px; text-align: center; font-size: 12.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
.lb-view { position: relative; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
.lb-track { display: flex; width: max-content; }
.lb-row { list-style: none; margin: 0; padding: 0 6px; display: flex; gap: 12px; flex: none; }
.lb-i { flex: none; display: inline-flex; align-items: center; gap: 9px; height: 52px; padding: 0 18px; border-radius: 14px; background: #ffffff; border: 1px solid #e4e7ec; color: #111827; font-size: 15px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; box-shadow: 0 1px 2px rgba(16, 24, 40, .05); }
.lb-i img { display: block; height: 22px; width: auto; }
.lb-i.wm img { height: 20px; } .lb-i.wm img[src*="alta"] { height: 26px; }
.lb-i.tx { font-size: 16px; font-weight: 760; }
.lb-note { margin: 16px 0 0; text-align: center; font-size: 14px; color: var(--muted); }
.lb-note a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; min-height: 44px; }
.lb-note a:hover { text-decoration: underline; }
/* As served: one still list, wrapped and centred. With the script's copy (and no wish for less motion) it drifts. */
.lband:not(.loop) .lb-view { -webkit-mask-image: none; mask-image: none; }
.lband:not(.loop) .lb-track { width: auto; } .lband:not(.loop) .lb-row { flex-wrap: wrap; justify-content: center; row-gap: 10px; }
@media (prefers-reduced-motion: no-preference) {
  .lband.loop .lb-track { animation: lb-drift 60s linear infinite; }
  .lband.loop .lb-view:hover .lb-track, .lband.loop .lb-view:focus-within .lb-track { animation-play-state: paused; }
}
@keyframes lb-drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@media (max-width: 640px) { .lb-i { height: 44px; padding: 0 14px; font-size: 14px; border-radius: 12px; } .lb-i img { height: 19px; } .lb-i.wm img { height: 17px; } .lb-row { gap: 10px; } }
`;

/** The band's loop: a second copy of the list, hidden from screen readers and with empty alts, only without a wish for less motion. */
export const LOGO_BAND_JS = `
(function () {
  if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  [].forEach.call(document.querySelectorAll(".lband"), function (band) {
    var row = band.querySelector(".lb-row"); if (!row) return;
    var dup = row.cloneNode(true); dup.classList.add("lb-dup"); dup.setAttribute("aria-hidden", "true");
    [].forEach.call(dup.querySelectorAll("img"), function (i) { i.alt = ""; });
    row.parentNode.appendChild(dup); band.classList.add("loop");
  });
})();`;
