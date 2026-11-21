// The agents' payment cards as art (23 Nov, the owner: "give it logos instead of pictograms… cards that you can connect
// with your phone, and the designs like the one I was going to have in Apple Wallet, and give different ones to each, and
// also customizable for companies"). One card per agent, credit-card shaped: the company's mark, the agent's name, its
// status, the card's last four (never more), what it spent against its monthly limit, and real marks for what it runs on:
// Claude for its model, Alta (formerly Metal) for an on-chain mandate, Visa for the card network, Airwallex as issuer.
//
// Shared by the console's Agents page (cloud/src/agentWallet.ts draws it with el()) and the phone's read-only card view
// (cloud/src/agentPhoneCard.ts draws it on the server, every value escaped). The design is cosmetic only: a preset per
// agent, the company's colour, its initials or a small logo. Nothing here touches money.

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

/** The card's look: the face, the presets, the marks. Used by the console and by the phone's page. */
export const CARD_ART_CSS = `
.acard { --brand: #4f46e5; position: relative; isolation: isolate; overflow: hidden; width: 100%; aspect-ratio: 1.586; min-height: 190px; border-radius: 16px; padding: 14px 16px 13px; box-sizing: border-box;
  display: grid; grid-template-rows: auto auto 1fr auto auto; gap: 6px; color: #fff; text-align: left; font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 2px rgba(16,24,40,.16), 0 14px 30px -14px rgba(16,24,40,.55); transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform .35s cubic-bezier(.2,.75,.2,1), box-shadow .3s; }
.acard > * { position: relative; z-index: 1; min-width: 0; }
.acard .ac-shine { position: absolute; inset: 0; z-index: 0; pointer-events: none; background: radial-gradient(60% 50% at var(--mx, 85%) var(--my, 0%), rgba(255,255,255,.26), transparent 70%); transition: background-position .2s; }
.acard .ac-top { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 9px; align-items: center; }
.acard .ac-mark { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; overflow: hidden; background: rgba(255,255,255,.18); box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); font-size: 11.5px; font-weight: 800; letter-spacing: .02em; }
.acard .ac-mark img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
.acard .ac-who { display: grid; min-width: 0; line-height: 1.2; }
.acard .ac-name { font-size: 15px; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acard .ac-co { font-size: 11px; opacity: .78; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acard .ac-plate { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; background: #fff; }
.acard .ac-plate img { display: block; height: 10px; width: auto; }
.acard .ac-mid { display: flex; align-items: center; gap: 8px; }
.acard .ac-chip { width: 32px; height: 24px; border-radius: 5px; background: linear-gradient(135deg, #f8e7a1, #d4a72c 45%, #f3d77a 70%, #b98b1c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.18); position: relative; flex: none; }
.acard .ac-chip::before { content: ""; position: absolute; inset: 6px 9px; border: 1px solid rgba(90,60,0,.35); border-radius: 3px; }
.acard .ac-nfc { width: 16px; height: 16px; opacity: .85; flex: none; }
.acard .ac-st { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 650; background: rgba(0,0,0,.22); white-space: nowrap; }
.acard .ac-st i { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 2px rgba(74,222,128,.25); }
.acard .ac-st.paused i, .acard .ac-st.revoked i { background: #fca5a5; box-shadow: none; } .acard .ac-st.off i { background: #cbd5e1; box-shadow: none; }
.acard .ac-num { align-self: center; font-size: 17px; font-weight: 600; letter-spacing: .12em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 1px rgba(0,0,0,.25); }
.acard .ac-num.none { font-size: 13px; letter-spacing: .02em; font-weight: 600; opacity: .85; }
.acard .ac-meter { display: grid; gap: 4px; }
.acard .ac-ml { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; white-space: nowrap; overflow: hidden; }
.acard .ac-ml b { font-weight: 700; } .acard .ac-ml span { opacity: .8; overflow: hidden; text-overflow: ellipsis; }
.acard .ac-bar { display: block; height: 5px; border-radius: 999px; background: rgba(255,255,255,.22); overflow: hidden; }
.acard .ac-bar > span { display: block; height: 100%; width: 0; border-radius: 999px; background: #fff; transition: width 1.1s cubic-bezier(.2,.75,.2,1); }
.acard .ac-bar.full > span { background: #fecaca; }
.acard .ac-foot { display: flex; align-items: center; gap: 6px; min-height: 22px; }
.acard .ac-model { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px 0 5px; border-radius: 999px; background: rgba(0,0,0,.24); font-size: 11px; font-weight: 650; white-space: nowrap; }
.acard .ac-model img { width: 14px; height: 14px; display: block; }
.acard .ac-model.code { padding-left: 8px; }
.acard .ac-alta { display: inline-flex; align-items: center; height: 22px; padding: 0 7px; border-radius: 999px; background: #fff; }
.acard .ac-alta img { height: 11px; width: auto; display: block; }
.acard .ac-net { margin-left: auto; height: 30px; width: auto; display: block; margin-top: -6px; margin-bottom: -6px; }
.acard .ac-tag { margin-left: auto; font-size: 9.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; opacity: .72; white-space: nowrap; }
.acard .ac-tag + .ac-net { margin-left: 6px; }
.acard.frozen { filter: grayscale(.8) brightness(.92); }
.acard.dim { filter: saturate(.55) brightness(.9); }
.acard.ink { color: #111827; } .acard.ink .ac-mark { background: rgba(0,0,0,.08); box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); } .acard.ink .ac-bar { background: rgba(0,0,0,.15); } .acard.ink .ac-bar > span { background: #111827; }
.acard.ink .ac-st, .acard.ink .ac-model { background: rgba(255,255,255,.45); } .acard.ink .ac-num { text-shadow: none; }
.acard.p-aurora { background: radial-gradient(120% 90% at 0% 0%, #7c3aed 0, transparent 55%), radial-gradient(90% 80% at 100% 100%, #0891b2 0, transparent 60%), linear-gradient(135deg, #1e1b4b, #312e81); }
.acard.p-lagoon { background: repeating-radial-gradient(circle at 115% 125%, rgba(255,255,255,.07) 0 2px, transparent 2px 15px), linear-gradient(135deg, #022c22, #0f766e 60%, #0d9488); }
.acard.p-midnight { background: repeating-linear-gradient(45deg, rgba(255,255,255,.045) 0 1px, transparent 1px 9px), repeating-linear-gradient(-45deg, rgba(255,255,255,.03) 0 1px, transparent 1px 9px), linear-gradient(135deg, #0b1020, #1e3a8a); }
.acard.p-ember { background: radial-gradient(80% 70% at 100% 0%, rgba(253,224,71,.35), transparent 60%), linear-gradient(135deg, #431407, #c2410c 58%, #d97706); }
.acard.p-graphite { background: repeating-linear-gradient(90deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px), linear-gradient(135deg, #09090b, #3f3f46); }
.acard.p-rose { background: radial-gradient(90% 80% at 0% 100%, rgba(251,113,133,.45), transparent 60%), linear-gradient(135deg, #500724, #9d174d 60%, #be185d); }
.acard.p-citrus { background: repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 6px, transparent 6px 14px), linear-gradient(135deg, #1a2e05, #3f6212 55%, #4d7c0f); }
.acard.p-sky { background: radial-gradient(100% 80% at 100% 0%, rgba(125,211,252,.45), transparent 60%), linear-gradient(135deg, #082f49, #0369a1 60%, #0284c7); }
.acard.p-bullion { background: radial-gradient(70% 60% at 85% 15%, rgba(250,204,21,.32), transparent 65%), linear-gradient(135deg, #1c1917, #44403c 70%, #57534e); }
.acard.p-brand { background: radial-gradient(90% 80% at 100% 0%, rgba(255,255,255,.22), transparent 60%), linear-gradient(135deg, color-mix(in srgb, var(--brand) 45%, #000), var(--brand)); }
@media (prefers-reduced-motion: reduce) { .acard, .acard .ac-bar > span { transition: none; } .acard { transform: none; } }
@media print { .acard { box-shadow: none; } }
`;
