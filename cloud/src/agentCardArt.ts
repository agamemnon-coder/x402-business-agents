// The agents' payment cards as art (23 Nov, the owner: "give it logos instead of pictograms… cards that you can connect
// with your phone, and the designs like the one I was going to have in Apple Wallet, and give different ones to each, and
// also customizable for companies"). One card per agent, credit-card shaped. Since 26 Nov (the owner: "far too busy") the
// card carries only the agent's name, one small mark, the card's last four (never more) and the network, Visa, in text
// only (review, 21 Nov: no Visa mark on Purser's card art); its status, spend, limit and honesty label sit under it, and
// the real marks for what it runs on (Claude, Alta (formerly Metal), Airwallex as issuer) are in its Details.
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

/** The card's look: the face, the presets, the mark. Used by the console and by the phone's page.
 * 21 Nov (Max: "blue with gold and the Purser logo, sleek"): one family of navy cards with gold. 26 Nov (the owner: "looks
 * fake and amateurish, far too busy; make it cleaner and better", think Apple Card, a metal premium card): restraint. On
 * the card only the agent's name (small, top left), one small mark in gold (Purser's feather, or the company's initials or
 * logo), the last four as "•••• 4002" (bottom left) and the network as text, VISA (bottom right). No chip, no contactless
 * sign, no badge, no meter, no pills: the status, the month's spend against its limit and the honesty label ("Simulated
 * card · test money", or the sandbox's) are under the card, outside it; the model, the issuer and an Alta mandate are in
 * the card's Details. The surface: deep midnight navy with a soft depth, one gold hairline with a lit top edge, and a
 * guilloché so faint it reads as texture (two crossing fields of fine waves at about 5 per cent, no rosette); each
 * agent's design only a slight shift of the navy's hue. An agent with no card of its own: the same card, matte, its
 * number's place saying so. */
/** The texture: two fields of fine waves, gold and pale blue, crossing a little out of phase (one inline SVG, no fetch). */
const GUILLOCHE = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 252" preserveAspectRatio="none"><g fill="none" stroke-width=".5"><g stroke="#e9c46a" stroke-opacity=".055">${Array.from({ length: 32 }, (_, k) => `<path d="M-20 ${k * 8}q25-6 50 0t50 0t50 0t50 0t50 0t50 0t50 0t50 0t50 0"/>`).join("")}</g><g stroke="#c7d4ff" stroke-opacity=".045">${Array.from({ length: 32 }, (_, k) => `<path d="M-45 ${k * 8 + 4}q25 6 50 0t50 0t50 0t50 0t50 0t50 0t50 0t50 0t50 0"/>`).join("")}</g></g></svg>`)}")`;
export const CARD_ART_CSS = `
.acard { --brand: #4f46e5; --acc: #1e3a8a; --gold: #d9b768; --gold-hi: #f1dfa8;
  position: relative; isolation: isolate; overflow: hidden; width: 100%; aspect-ratio: 1.586; border-radius: 16px; padding: 18px 20px 17px; box-sizing: border-box;
  display: grid; grid-template-rows: auto 1fr auto; color: #e8ecf5; text-align: left; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
  background-color: #0b1530;
  background-image: radial-gradient(120% 85% at 15% -10%, rgba(255,255,255,.075), transparent 55%),
    radial-gradient(90% 110% at 105% 115%, rgba(0,0,0,.34), transparent 62%),
    ${GUILLOCHE},
    linear-gradient(150deg, color-mix(in srgb, var(--acc) 11%, #14244e) 0%, color-mix(in srgb, var(--acc) 7%, #0d1a3c) 48%, #070f26 100%);
  background-size: auto, auto, 100% 100%, auto;
  box-shadow: 0 1px 2px rgba(2,6,23,.28), 0 14px 30px -14px rgba(2,8,30,.6);
  transform: perspective(900px) translateY(var(--lift, 0px)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform .35s cubic-bezier(.2,.75,.2,1), box-shadow .3s; }
/* One gold hairline round the card, its top edge a little lit. */
.acard::after { content: ""; position: absolute; z-index: 2; inset: 0; border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 1px rgba(217,183,104,.34), inset 0 1px 0 rgba(255,244,214,.14); }
.acard > * { position: relative; z-index: 1; min-width: 0; }
.acard .ac-shine { position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: linear-gradient(115deg, transparent 38%, rgba(255,246,220,.06) 48%, rgba(255,255,255,.02) 52%, transparent 62%);
  background-size: 260% 100%; background-position: 100% 0; transition: background-position .9s cubic-bezier(.2,.75,.2,1); }
.acard .ac-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.acard .ac-name { font-size: 13.5px; font-weight: 550; letter-spacing: .01em; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #eef1f8; }
.acard .ac-mark { flex: none; display: grid; place-items: center; height: 20px; min-width: 20px; color: var(--gold); font-size: 11px; font-weight: 650; letter-spacing: .08em; }
.acard .ac-mark svg { width: 18px; height: 18px; display: block; }
.acard .ac-mark .ic { display: grid; place-items: center; }
.acard .ac-mark img { height: 20px; width: auto; max-width: 64px; object-fit: contain; border-radius: 4px; }
.acard .ac-bot { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.acard .ac-num { font-size: 15px; font-weight: 500; letter-spacing: .14em; white-space: nowrap; color: #dfe5f2; font-feature-settings: "tnum" 1; }
.acard .ac-num.none { font-size: 12.5px; font-weight: 500; letter-spacing: .02em; color: #a7b2cc; }
.acard .ac-net.txt { flex: none; font-size: 16px; font-weight: 800; font-style: italic; letter-spacing: .03em; line-height: 1; color: #f2f4f9; }
.acard.bare { background-image: radial-gradient(120% 85% at 15% -10%, rgba(255,255,255,.04), transparent 55%), ${GUILLOCHE}, linear-gradient(150deg, color-mix(in srgb, var(--acc) 12%, #111d3f) 0%, #0a1430 55%, #070e24 100%); background-size: auto, 100% 100%, auto; }
.acard.bare::after { box-shadow: inset 0 0 0 1px rgba(217,183,104,.2); }
.acard.frozen { filter: grayscale(.8) brightness(.92); }
.acard.dim .ac-mark { opacity: .7; }
.acard.ink { color: #111827; } .acard.ink .ac-name, .acard.ink .ac-num, .acard.ink .ac-net.txt, .acard.ink .ac-mark { color: #111827; } .acard.ink .ac-num.none { color: #374151; }
.acard.p-aurora { --acc: #6d28d9; }
.acard.p-lagoon { --acc: #0f766e; }
.acard.p-midnight { --acc: #1e3a8a; }
.acard.p-ember { --acc: #9a3412; }
.acard.p-graphite { --acc: #334155; }
.acard.p-rose { --acc: #9f1239; }
.acard.p-citrus { --acc: #3f6212; }
.acard.p-sky { --acc: #0369a1; }
.acard.p-bullion { --acc: #a16207; }
.acard.p-brand { --acc: var(--brand); background-image: radial-gradient(120% 85% at 15% -10%, rgba(255,255,255,.14), transparent 55%), ${GUILLOCHE}, linear-gradient(150deg, var(--brand), color-mix(in srgb, var(--brand) 55%, #000)); background-size: auto, 100% 100%, auto; }
@media (hover: hover) { button:hover > .acard, .acard:hover { --lift: -3px; } button:hover > .acard .ac-shine, .acard:hover .ac-shine { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .acard, .acard .ac-bar > span { transition: none; } .acard { transform: none; } }
@media (prefers-reduced-motion: reduce) { .acard .ac-shine { transition: none; } }
@media print { .acard { box-shadow: none; } }
`;
