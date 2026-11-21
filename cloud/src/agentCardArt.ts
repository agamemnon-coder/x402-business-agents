// The agents' payment cards as art (23 Nov, the owner: "give it logos instead of pictograms… cards that you can connect
// with your phone, and the designs like the one I was going to have in Apple Wallet, and give different ones to each, and
// also customizable for companies"). One card per agent, credit-card shaped: the company's mark, the agent's name, its
// status, the card's last four (never more), what it spent against its monthly limit, and real marks for what it runs on:
// Claude for its model, Alta (formerly Metal) for an on-chain mandate, Airwallex as issuer; the card network, Visa, in text
// only (review, 21 Nov: no Visa mark on Purser's card art).
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

/** The card's look: the face, the presets, the marks. Used by the console and by the phone's page.
 * 21 Nov (Max: "really beautiful card designs… blue with gold and the Purser logo, sleek"): one family of metal cards,
 * deep midnight navy with a fine guilloché and brushed texture, a soft sheen, a gold foil hairline, a gold chip and gold
 * for the agent's name; each preset is the agent's accent (an edge gem and a glow), not a different card. An agent with
 * no card of its own is the same family in matte, without chip, number or network, and says so in a gold outline. */
/** The feather as a faint gold watermark on a card with no card of its own (a CSS background: a data URL, no fetch). */
const FEATHER_WATERMARK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e9c46a" stroke-opacity=".1" stroke-width=".6" stroke-linecap="round" stroke-linejoin="round">${FEATHER_D.map((d) => `<path d="${d}"/>`).join("")}</svg>`)}")`;
export const CARD_ART_CSS = `
.acard { --brand: #4f46e5; --acc: #e9c46a; --gold: #e9c46a; --gold-hi: #f7e7b4; --gold-lo: #a97b25; --navy: #0c1838;
  position: relative; isolation: isolate; overflow: hidden; width: 100%; aspect-ratio: 1.586; min-height: 190px; border-radius: 16px; padding: 14px 16px 13px 18px; box-sizing: border-box;
  display: grid; grid-template-rows: auto auto 1fr auto auto; gap: 6px; color: #eef2fb; text-align: left; font-variant-numeric: tabular-nums;
  background-color: var(--navy);
  background-image: radial-gradient(80% 100% at 100% 0%, color-mix(in srgb, var(--acc) 36%, transparent), transparent 64%),
    radial-gradient(120% 80% at 0% 120%, rgba(56,96,200,.28), transparent 60%),
    repeating-radial-gradient(circle at 118% 128%, rgba(233,196,106,.075) 0 1px, transparent 1px 6px),
    repeating-radial-gradient(circle at -20% -35%, rgba(160,190,255,.05) 0 1px, transparent 1px 7px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.018) 0 1px, transparent 1px 3px),
    linear-gradient(140deg, #13265a 0%, #0d1c45 38%, #0a1636 68%, #060d24 100%);
  box-shadow: 0 1px 1px rgba(2,6,23,.35), 0 18px 34px -18px rgba(2,8,30,.8), 0 6px 14px -8px rgba(2,8,30,.45);
  transform: perspective(900px) translateY(var(--lift, 0px)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform .35s cubic-bezier(.2,.75,.2,1), box-shadow .3s; }
.acard::before { content: ""; position: absolute; z-index: 1; left: 0; top: 16%; bottom: 16%; width: 4px; border-radius: 0 4px 4px 0; background: linear-gradient(180deg, transparent, var(--acc) 18%, var(--acc) 82%, transparent); box-shadow: 0 0 14px 2px color-mix(in srgb, var(--acc) 60%, transparent); pointer-events: none; }
.acard::after { content: ""; position: absolute; z-index: 2; inset: 0; border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 1px rgba(233,196,106,.55), inset 0 1px 0 1px rgba(255,240,200,.12), inset 0 0 0 6px rgba(233,196,106,.10); }
.acard > * { position: relative; z-index: 1; min-width: 0; }
.acard .ac-shine { position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(60% 50% at var(--mx, 85%) var(--my, 0%), rgba(255,255,255,.16), transparent 70%), linear-gradient(115deg, transparent 38%, rgba(255,246,220,.10) 48%, rgba(255,255,255,.04) 52%, transparent 62%);
  background-size: 100% 100%, 260% 100%; background-position: 0 0, 100% 0; transition: background-position .9s cubic-bezier(.2,.75,.2,1); }
.acard .ac-top { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 9px; align-items: center; }
.acard .ac-mark { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; overflow: hidden; color: #0b1636; background: linear-gradient(145deg, var(--gold-hi), var(--gold) 45%, #d6aa4c 70%, var(--gold-lo)); box-shadow: inset 0 0 0 1px rgba(255,248,220,.55), 0 1px 2px rgba(0,0,0,.45); font-size: 11.5px; font-weight: 800; letter-spacing: .02em; }
.acard .ac-mark svg { width: 17px; height: 17px; display: block; }
.acard .ac-mark .ic { display: grid; place-items: center; }
.acard .ac-mark img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
.acard .ac-who { display: grid; min-width: 0; line-height: 1.2; }
.acard .ac-name { font-size: 15px; font-weight: 650; letter-spacing: -.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--gold-hi); text-shadow: 0 1px 0 rgba(0,0,0,.35); }
.acard .ac-co { font-size: 11px; color: #b9c3da; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acard .ac-plate { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; background: #fff; box-shadow: 0 0 0 1px rgba(233,196,106,.45), 0 1px 2px rgba(0,0,0,.35); }
.acard .ac-plate img { display: block; height: 10px; width: auto; }
.acard .ac-mid { display: flex; align-items: center; gap: 9px; }
.acard .ac-chip { width: 36px; height: 27px; border-radius: 6px; position: relative; flex: none; overflow: hidden;
  background: linear-gradient(rgba(110,74,10,.55), rgba(110,74,10,.55)) 0 34% / 100% 1px no-repeat, linear-gradient(rgba(110,74,10,.55), rgba(110,74,10,.55)) 0 66% / 100% 1px no-repeat,
    linear-gradient(rgba(110,74,10,.5), rgba(110,74,10,.5)) 50% 0 / 1px 34% no-repeat, linear-gradient(rgba(110,74,10,.5), rgba(110,74,10,.5)) 50% 100% / 1px 34% no-repeat,
    linear-gradient(135deg, #fbecb8 0%, #e3bb5c 30%, #f6dc8e 52%, #c99a36 74%, #f1d488 100%);
  box-shadow: inset 0 0 0 1px rgba(120,80,10,.45), inset 0 1px 0 rgba(255,250,225,.7), 0 1px 2px rgba(0,0,0,.4); }
.acard .ac-chip::before { content: ""; position: absolute; inset: 8px 11px; border: 1px solid rgba(110,74,10,.55); border-radius: 3px; background: linear-gradient(135deg, #f8e3a0, #dcb257); }
.acard .ac-nfc { width: 17px; height: 17px; flex: none; color: var(--gold-hi); opacity: .85; }
.acard .ac-st { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 650; color: #eef2fb; background: rgba(4,10,30,.5); box-shadow: inset 0 0 0 1px rgba(233,196,106,.3); white-space: nowrap; }
.acard .ac-st i { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 2px rgba(74,222,128,.25); }
.acard .ac-st.paused i, .acard .ac-st.revoked i { background: #fca5a5; box-shadow: none; } .acard .ac-st.off i { background: #cbd5e1; box-shadow: none; }
.acard .ac-num { align-self: center; font-size: 17px; font-weight: 600; letter-spacing: .14em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e8edf8; text-shadow: 0 1px 0 rgba(0,0,0,.55), 0 -1px 0 rgba(255,255,255,.08); }
.acard .ac-num.none { justify-self: start; align-self: center; max-width: 100%; font-size: 12.5px; letter-spacing: .03em; font-weight: 650; color: var(--gold-hi); padding: 5px 12px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(233,196,106,.7); background: rgba(233,196,106,.06); text-shadow: none; }
.acard .ac-meter { display: grid; gap: 4px; }
.acard .ac-ml { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; white-space: nowrap; overflow: hidden; }
.acard .ac-ml b { font-weight: 700; color: #fff; } .acard .ac-ml span { color: #b9c3da; overflow: hidden; text-overflow: ellipsis; }
.acard .ac-bar { display: block; height: 4px; border-radius: 999px; background: rgba(255,255,255,.14); overflow: hidden; }
.acard .ac-bar > span { display: block; height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, var(--gold-lo), var(--gold) 55%, var(--gold-hi)); transition: width 1.1s cubic-bezier(.2,.75,.2,1); }
.acard .ac-bar.full > span { background: #fecaca; }
.acard .ac-foot { display: flex; align-items: center; gap: 6px; min-height: 22px; }
.acard .ac-model { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px 0 5px; border-radius: 999px; color: #eef2fb; background: rgba(4,10,30,.5); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); font-size: 11px; font-weight: 650; white-space: nowrap; }
.acard .ac-model img { width: 14px; height: 14px; display: block; }
.acard .ac-model.code { padding-left: 8px; }
.acard .ac-alta { display: inline-flex; align-items: center; height: 22px; padding: 0 7px; border-radius: 999px; background: #fff; box-shadow: 0 0 0 1px rgba(233,196,106,.45); }
.acard .ac-alta img { height: 11px; width: auto; display: block; }
.acard .ac-net { margin-left: auto; height: 30px; width: auto; display: block; margin-top: -6px; margin-bottom: -6px; }
.acard .ac-tag { margin-left: auto; font-size: 9.5px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--gold-hi); white-space: nowrap; padding: 2px 6px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(233,196,106,.45); }
.acard .ac-tag + .ac-net { margin-left: 8px; }
.acard .ac-net.txt { height: auto; margin-top: 0; margin-bottom: 0; font-size: 15px; font-weight: 800; font-style: italic; letter-spacing: .01em; color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,.4); }
.acard.bare { background-image: ${FEATHER_WATERMARK}, radial-gradient(75% 95% at 100% 0%, color-mix(in srgb, var(--acc) 14%, transparent), transparent 62%),
    radial-gradient(rgba(255,255,255,.035) 1px, transparent 1.2px), linear-gradient(150deg, #0d1a3d 0%, #091331 55%, #050b1f 100%);
  background-size: 40% auto, auto, 4px 4px, auto; background-repeat: no-repeat, no-repeat, repeat, no-repeat; background-position: 104% 128%, 0 0, 0 0, 0 0; }
.acard.bare::after { box-shadow: inset 0 0 0 1px rgba(233,196,106,.32), inset 0 0 0 6px rgba(233,196,106,.05); }
.acard.bare::before { opacity: .7; }
.acard.frozen { filter: grayscale(.8) brightness(.92); }
.acard.dim::before { opacity: .45; } .acard.dim .ac-mark { filter: saturate(.8); }
.acard.ink { color: #111827; } .acard.ink .ac-name { color: #111827; text-shadow: none; } .acard.ink .ac-co, .acard.ink .ac-ml span { color: #374151; } .acard.ink .ac-bar { background: rgba(0,0,0,.15); } .acard.ink .ac-bar > span { background: #111827; }
.acard.ink .ac-st, .acard.ink .ac-model { background: rgba(255,255,255,.55); color: #111827; } .acard.ink .ac-num { color: #111827; text-shadow: none; } .acard.ink .ac-tag { color: #111827; box-shadow: inset 0 0 0 1px rgba(0,0,0,.35); } .acard.ink .ac-net.txt { color: #111827; text-shadow: none; } .acard.ink .ac-nfc { color: #111827; }
.acard.p-aurora { --acc: #a78bfa; }
.acard.p-lagoon { --acc: #2dd4bf; }
.acard.p-midnight { --acc: #60a5fa; }
.acard.p-ember { --acc: #fb923c; }
.acard.p-graphite { --acc: #cbd5e1; }
.acard.p-rose { --acc: #fb7185; }
.acard.p-citrus { --acc: #a3e635; }
.acard.p-sky { --acc: #38bdf8; }
.acard.p-bullion { --acc: #e9c46a; }
.acard.p-brand { --acc: var(--brand); background-image: radial-gradient(90% 80% at 100% 0%, rgba(255,255,255,.2), transparent 60%), repeating-radial-gradient(circle at 118% 128%, rgba(255,255,255,.06) 0 1px, transparent 1px 6px), linear-gradient(135deg, color-mix(in srgb, var(--brand) 45%, #000), var(--brand)); }
@media (hover: hover) { button:hover > .acard, .acard:hover { --lift: -4px; } button:hover > .acard .ac-shine, .acard:hover .ac-shine { background-position: 0 0, 0 0; } }
@media (prefers-reduced-motion: reduce) { .acard, .acard .ac-bar > span { transition: none; } .acard { transform: none; } }
@media (prefers-reduced-motion: reduce) { .acard .ac-shine { transition: none; } }
@media print { .acard { box-shadow: none; } }
`;
