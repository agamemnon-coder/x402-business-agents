// The agents' payment cards as art (23 Nov, the owner: "give it logos instead of pictograms… cards that you can connect
// with your phone, and the designs like the one I was going to have in Apple Wallet, and give different ones to each, and
// also customizable for companies"). One card per agent, credit-card shaped. Since 27 Nov the Obsidian design (Max chose it):
// near-black, the agent's own relief in greys under one band of light, a champagne medallion with the engraved quill, the
// chip, the agent's name and the last four (never more) in silver and Visa in text only (review, 21 Nov: no Visa mark);
// its status, spend, limit and honesty label sit under it, and the marks for what it runs on are in its Details.
//
// Shared by the console's Agents page (cloud/src/agentWallet.ts draws it with el()) and the phone's read-only card view
// (cloud/src/agentPhoneCard.ts draws it on the server, every value escaped). The design is cosmetic only: a preset per
// agent, the company's colour, its initials or a small logo. Nothing here touches money.

import { ICONS } from "../../src/ui/icons.js";

/** The designed presets a company picks from, per agent. "brand" is painted in the company's own colour. */
export const CARD_PRESETS = ["aurora", "lagoon", "midnight", "ember", "graphite", "rose", "citrus", "sky", "bullion", "brand"] as const;
export type CardPreset = (typeof CARD_PRESETS)[number];
export const PRESET_NAMES: Record<CardPreset, { en: string; nl: string }> = {
  aurora: { en: "Aurora", nl: "Aurora" }, lagoon: { en: "Lagoon", nl: "Lagune" }, midnight: { en: "Midnight", nl: "Middernacht" },
  ember: { en: "Ember", nl: "Gloed" }, graphite: { en: "Graphite", nl: "Grafiet" }, rose: { en: "Rose", nl: "Roos" },
  citrus: { en: "Citrus", nl: "Citrus" }, sky: { en: "Sky", nl: "Lucht" }, bullion: { en: "Bullion", nl: "Goud" }, brand: { en: "Company colour", nl: "Bedrijfskleur" },
};
/** Each agent its own design until the company picks another (cloud/src/agentRoster.ts ids). */
export const DEFAULT_STYLE: Record<string, CardPreset> = {
  sourcing: "aurora", checker: "graphite", payer: "ember", treasury: "midnight", support: "lagoon",
  dispute_desk: "rose", x402_desk: "citrus", controller: "sky", books: "bullion",
};
/** The agents whose money moves on chain under an Alta mandate (the roster's own words say so). */
export const ALTA_AGENTS = ["sourcing", "x402_desk"] as const;

/** The company's card design, as stored and as sent. */
export interface CardDesign { v: 1; color: string | null; initials: string | null; logo: string | null; styles: Record<string, CardPreset> }
export const EMPTY_DESIGN: CardDesign = { v: 1, color: null, initials: null, logo: null, styles: {} };

const HEX = /^#[0-9a-f]{6}$/i;
const INITIALS = /^[A-Z0-9]{1,3}$/;
/** A logo as a data URL: PNG, JPEG or WebP only (never SVG), base64, at most LOGO_MAX bytes decoded. */
export const LOGO_MAX = 48 * 1024;
const LOGO = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAGIC: Record<string, (b: string) => boolean> = {
  png: (b) => b.startsWith("\x89PNG\r\n\x1a\n"), jpeg: (b) => b.startsWith("\xff\xd8\xff"), webp: (b) => b.startsWith("RIFF") && b.slice(8, 12) === "WEBP",
};
export function validLogo(s: unknown): string | null {
  if (typeof s !== "string" || s.length > Math.ceil((LOGO_MAX * 4) / 3) + 40) return null;
  const m = LOGO.exec(s);
  if (!m) return null;
  let head: string;
  try { head = atob(m[2]!.slice(0, 24)); } catch { return null; }
  const bytes = Math.floor((m[2]!.length * 3) / 4) - (m[2]!.endsWith("==") ? 2 : m[2]!.endsWith("=") ? 1 : 0);
  return bytes <= LOGO_MAX && MAGIC[m[1]!]!(head) ? s : null;
}
/** A design from anything (a stored row, a request): what is not valid is dropped, never kept. */
export function cleanDesign(x: unknown): CardDesign {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const styles: Record<string, CardPreset> = {};
  if (o.styles && typeof o.styles === "object") {
    for (const [k, v] of Object.entries(o.styles as Record<string, unknown>).slice(0, 40)) {
      if (/^[a-z0-9_]{1,40}$/.test(k) && typeof v === "string" && (CARD_PRESETS as readonly string[]).includes(v)) styles[k] = v as CardPreset;
    }
  }
  return {
    v: 1,
    color: typeof o.color === "string" && HEX.test(o.color) ? o.color.toLowerCase() : null,
    initials: typeof o.initials === "string" && INITIALS.test(o.initials) ? o.initials : null,
    logo: validLogo(o.logo),
    styles,
  };
}
/** The company's mark until it sets its own: its name's first letter, as the console's company chip shows it. */
export function initialsOf(name: string): string {
  const m = /[A-Za-z0-9]/.exec(name);
  return (m ? m[0]! : "P").toUpperCase();
}
/** A colour light enough that the card's words go dark on it. */
export function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.45;
}
export const styleOf = (d: CardDesign, agent: string): CardPreset => d.styles[agent] ?? DEFAULT_STYLE[agent] ?? "graphite";
/** "claude-haiku-5-5" → "Haiku 5.5". */
export const modelShort = (m: string): string => m.replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/, (_, n: string, a: string, b: string) => `${n.charAt(0).toUpperCase()}${n.slice(1)} ${a}.${b}`);

/** Purser's mark, the feather (src/ui/icons.ts, as the console's header draws it): on every card until the company sets
 * its own initials or logo (21 Nov, Max: "blue with gold and the Purser logo, sleek"). Paths only, drawn as DOM or SVG. */
export const FEATHER_D: readonly string[] = (ICONS.feather ?? []).map(([, a]) => a.d).filter((d): d is string => typeof d === "string");
export const FEATHER_SVG = `<svg class="ac-pf" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FEATHER_D.map((d) => `<path d="${d}"/>`).join("")}</svg>`;

/** The card's look: Obsidian (27 Nov, Max chose it from the concepts: "darker and sleeker"). Near-black on black. Each
 * agent's own relief (Sourcing's leaves, Treasury's sea, Support's night sky; an engraved line field for any other),
 * drawn in greys, faint over the whole card and brighter where one diagonal band of light crosses it. A champagne
 * medallion at the centre holds Purser's engraved quill (or the company's own initials or logo); champagne only there, on
 * the small flat chip and the tracked wordmark; the agent's name and the last four in silver, VISA in text only
 * (review, 21 Nov: no Visa mark). Every shape is drawn once per page (CARD_ART_DEFS, generated with fixed seeds by
 * cloud/src/cardArtBuild.ts) and a card is a few <use> of them and its own words. The status, the month against its
 * limit and the honesty label stay under the card, never on it. A preset is the agent's accent: a faint tint in the
 * medallion. An agent with no card of its own: no chip, no network, its number's place saying so. */
export { CARD_ART_DEFS } from "./agentCardArt.gen.js";
/** Each agent's relief; any other agent the engraved line field. */
export const RELIEF: Readonly<Record<string, "leaves" | "sea" | "night">> = { sourcing: "leaves", treasury: "sea", support: "night" };
export const reliefOf = (agent: string): string => RELIEF[agent] ?? "lines";
const FONT = "Inter,Helvetica Neue,Arial,sans-serif";
/** The card's art as markup (the phone's page; the console draws the same with DOM nodes): every value escaped by the
 *  caller's esc. mark: the company's logo (a data URL, checked by validLogo) or initials, else Purser's quill. */
export function cardSvg(o: { agent: string; name: string; last4: string | null; logo: string | null; initials: string | null }, esc: (s: string) => string): string {
  const rel = reliefOf(o.agent);
  const mark = o.logo ? `<image class="ac-mark" href="${esc(o.logo)}" x="182" y="88" width="64" height="80" preserveAspectRatio="xMidYMid meet" clip-path="url(#pc-mo)"/>`
    : o.initials ? `<text class="ac-mark" x="214" y="136" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="22" letter-spacing="2" fill="url(#pc-ch)">${esc(o.initials)}</text>`
      : `<use class="ac-pf" href="#pc-quill"/>`;
  return `<svg class="ac-art" viewBox="0 0 428 270" aria-hidden="true" focusable="false"><use href="#pc-ground"/>`
    + `<g mask="url(#pc-fade)"><use href="#pc-rel-${rel}" opacity=".2"/><g mask="url(#pc-band)"><use href="#pc-rel-${rel}" opacity=".75"/></g></g>`
    + `<use href="#pc-medal"/>${mark}<use href="#pc-frame"/><use href="#pc-word"/>${o.last4 ? `<use href="#pc-chip" x="34" y="110"/>` : ""}`
    + (o.last4 ? `<text class="ac-num" x="34" y="212" font-family="${FONT}" font-weight="500" font-size="13" letter-spacing="2.4" fill="url(#pc-pw)">•••• ${esc(o.last4)}</text>`
      : `<text class="ac-num none" x="34" y="212" font-family="${FONT}" font-weight="500" font-size="11" letter-spacing=".4" fill="#8e929b">No card of its own</text>`)
    + `<text class="ac-name" x="34" y="233" font-family="${FONT}" font-weight="600" font-size="7.6" letter-spacing="2" fill="url(#pc-pw)">${esc(o.name.toUpperCase())}</text>`
    + (o.last4 ? `<text class="ac-net txt" x="394" y="234" text-anchor="end" transform="skewX(-10)" transform-origin="394 234" font-family="Arial Black,${FONT}" font-weight="900" font-size="17" letter-spacing=".6" fill="url(#pc-vs)">VISA</text>` : "")
    + `<use href="#pc-sheen"/></svg>`;
}
export const CARD_ART_CSS = `
.pc-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.pc-tint { fill: var(--acc, #000); fill-opacity: .16; }
.acard { --brand: #4f46e5; --acc: #8fa3c8;
  position: relative; isolation: isolate; overflow: hidden; display: block; width: 100%; aspect-ratio: 1.586; border-radius: 16px; background: #070708; color: #e8ecf5;
  box-shadow: 0 1px 2px rgba(0,0,0,.35), 0 16px 32px -14px rgba(0,0,0,.72), 0 0 0 .5px rgba(255,255,255,.07);
  transform: perspective(900px) translateY(var(--lift, 0px)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform .35s cubic-bezier(.2,.75,.2,1), box-shadow .3s; }
.acard .ac-art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.acard .ac-shine { position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: linear-gradient(115deg, transparent 38%, rgba(255,246,220,.06) 48%, rgba(255,255,255,.02) 52%, transparent 62%);
  background-size: 260% 100%; background-position: 100% 0; transition: background-position .9s cubic-bezier(.2,.75,.2,1); }
.acard.frozen { filter: grayscale(.8) brightness(.9); }
.acard.dim .ac-art { opacity: .88; }
.acard.p-aurora { --acc: #9a8fc7; }
.acard.p-lagoon { --acc: #7fb5ad; }
.acard.p-midnight { --acc: #8fa3c8; }
.acard.p-ember { --acc: #c49a7a; }
.acard.p-graphite { --acc: #a3a8b0; }
.acard.p-rose { --acc: #c48f9b; }
.acard.p-citrus { --acc: #a9b87f; }
.acard.p-sky { --acc: #86aecb; }
.acard.p-bullion { --acc: #c9b27a; }
.acard.p-brand { --acc: var(--brand); }
@media (hover: hover) { button:hover > .acard, .acard:hover { --lift: -3px; } button:hover > .acard .ac-shine, .acard:hover .ac-shine { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .acard, .acard .ac-bar > span { transition: none; } .acard { transform: none; } }
@media (prefers-reduced-motion: reduce) { .acard .ac-shine { transition: none; } }
@media print { .acard { box-shadow: none; } }
`;
