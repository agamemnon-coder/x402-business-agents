// Purser Cloud's signed-out screens (sign-in, first run, a passkey's enrolment). 21 Nov, Max, from his mockup: "upgrade
// purser cloud login page to exactly this, only not with all the text left: just Purser Cloud and some small USP, and
// animating". On the left: a large globe of the Earth (its land as dots, a graticule), swaying slowly; the site's wave at the bottom
// (src/ui/wave.ts); over them the Purser mark, "Purser Cloud", one short line and three small points with icons. On the
// right: the card as glass, with the heading, the company address, the passkey as the one large action, "New company?
// Set it up", then "or" and the guest way. No paragraph. Only the look and two canvases: authentication is unchanged
// (cloud/src/console.ts signInView). Scoped to .signed-out and written in the theme's own variables, light and dark.
// Under prefers-reduced-motion the globe and the wave are drawn once and stand still.

import { waveScript } from "../../src/ui/wave.js";
import { globeScript, type GlobePlace } from "../../src/ui/globe.js";

export const SIGNIN_CSS = `
/* The left panel: a deep ground, the globe and the wave behind the words. */
.signed-out .hero { position: relative; overflow: hidden; isolation: isolate; border-right: 0; align-content: center; justify-items: start;
  background: radial-gradient(70% 60% at 40% 30%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
    radial-gradient(60% 50% at 0% 100%, color-mix(in srgb, var(--accent-ink, var(--accent)) 18%, transparent), transparent 70%), var(--bg); }
.signed-out .hero::before { content: none; }
/* The console's own page-wide wave waits for the signed-in pages: here the panel has its own. */
.signed-out canvas.pw-wave { display: none; }
.signed-out .hero canvas { position: absolute; pointer-events: none; }
/* 26 Nov (Max: "make the globe a deliberate hero object, not behind the copy"): the globe (src/ui/globe.ts) is the
   largest circle beside or under the words, never behind them, whole in the panel, above a quiet wave; its labels clear
   of the words and of each other. */
.signed-out .hero canvas.si-globe { inset: 0; width: 100%; height: 100%; z-index: -2; }
.signed-out .hero canvas.si-wave { left: 0; right: 0; bottom: 0; width: 100%; height: 22%; z-index: -3; opacity: .4;
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 55%); mask-image: linear-gradient(180deg, transparent, #000 55%); }
/* Signed out, no "test money" chip in the header (Max: "remove the old pill"): the panel's status line says it, quietly,
   and the trust line under the card; on a wide screen the empty app bar goes too. */
.signed-out .appbar .test { display: none; }
@media (min-width: 760px) { .signed-out .appbar { display: none; } }
/* The panel's status line: a small dot and "Sandbox · test money", under the line. */
.signed-out .side p.si-st { order: 0; display: inline-flex; align-items: center; gap: 8px; margin: 0 0 22px; padding: 4px 11px 4px 9px; border-radius: 999px; border: 1px solid var(--glass-line, var(--border)); font: 600 12.5px/1.3 var(--mono, ui-monospace, monospace); letter-spacing: .02em; color: var(--muted); }
.signed-out .side p.si-st i { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 20%, transparent); }
/* The trust line under the card: two calm lines with air, never cramped. */
.signed-out p.trust { gap: 4px; font-size: 12.5px; line-height: 1.55; color: var(--faint); max-width: 560px; justify-self: center; margin-left: auto; margin-right: auto; text-wrap: balance; }
.signed-out p.trust span:last-child { display: inline-flex; justify-self: center; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); font-weight: 600; font-size: 12px; }
.signed-out .side { position: relative; display: flex; flex-direction: column; align-items: flex-start; max-width: 460px; margin: 0; padding: 0 0 0 clamp(8px, 2vw, 40px); }

.signed-out .side .side-mk { order: -1; display: grid; place-items: center; width: 64px; height: 64px; margin: 0 0 22px; border-radius: 18px; color: var(--text);
  border: 1px solid var(--glass-line, color-mix(in srgb, var(--accent) 30%, var(--border))); background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 34%, var(--surface)), color-mix(in srgb, var(--accent) 12%, var(--surface)));
  box-shadow: 0 12px 34px -14px color-mix(in srgb, var(--accent) 70%, transparent), inset 0 1px 0 rgba(255, 255, 255, .12); }
.signed-out .side .side-mk svg { width: 30px; height: 30px; }
.signed-out .side h2 { margin: 0; font-size: clamp(38px, 3.6vw, 60px); line-height: 1.02; font-weight: 780; letter-spacing: -.035em; color: var(--text); }
.signed-out .side > p { margin: 12px 0 30px; font-size: clamp(17px, 1.35vw, 21px); line-height: 1.4; color: color-mix(in srgb, var(--accent) 35%, var(--muted)); }
.signed-out .side ul { gap: 14px; }
.signed-out .side li { align-items: center; gap: 14px; font-size: 16.5px; font-weight: 550; color: var(--text); }
.signed-out .side .si { flex: none; display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: color-mix(in srgb, var(--accent) 70%, var(--text));
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); background: color-mix(in srgb, var(--accent) 14%, var(--surface)); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.signed-out .side .si .i { margin: 0; color: inherit; }
/* The right: a soft light behind the card, the card as glass. */
.signed-out main { isolation: isolate; }
.signed-out main::before { content: ""; position: absolute; z-index: -1; inset: 0; pointer-events: none; background: radial-gradient(50% 50% at 50% 50%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 70%); }
.signed-out .auth { position: relative; border-radius: 26px; padding: 40px 40px 30px; border: 1px solid var(--glass-line, color-mix(in srgb, var(--accent) 20%, var(--border)));
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 78%, transparent), color-mix(in srgb, var(--surface) 60%, transparent));
  -webkit-backdrop-filter: blur(22px) saturate(1.25); backdrop-filter: blur(22px) saturate(1.25);
  box-shadow: 0 40px 90px -40px rgba(8, 6, 28, .55), 0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent), inset 0 1px 0 rgba(255, 255, 255, .07); }
.signed-out .auth::before { content: ""; position: absolute; left: 18%; right: 18%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 75%, #fff), transparent); }
.signed-out .auth h1 { margin: 0 0 22px; font-size: clamp(32px, 2.6vw, 42px); font-weight: 780; letter-spacing: -.03em; }
.signed-out .auth label { font-weight: 650; font-size: 15px; }
.signed-out .auth .addr { min-height: 56px; border-radius: 14px; border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); background: color-mix(in srgb, var(--bg) 55%, var(--surface)); }
.signed-out .auth .addr .field { min-height: 54px; font-size: 16.5px; background: transparent; }
.signed-out .auth .addr span { align-self: stretch; display: grid; place-items: center; padding: 0 16px; border-left: 1px solid var(--border); font-size: 16px; color: var(--text); }
.signed-out .auth .btn.primary.big { width: 100%; min-height: 58px; margin-top: 18px; border-radius: 15px; font-size: 17px; font-weight: 700; border: 0;
  background: var(--btn-bg, var(--accent)); color: var(--btn-ink, #fff); box-shadow: 0 16px 34px -14px color-mix(in srgb, var(--accent) 80%, transparent); transition: transform .15s ease, box-shadow .15s ease, filter .15s ease; }
.signed-out .auth .btn.primary.big:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 20px 40px -14px color-mix(in srgb, var(--accent) 90%, transparent); }
.signed-out .auth .btn.primary.big:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 3px; }
.signed-out .auth .alt { margin: 16px 0 0; text-align: center; font-size: 15px; color: var(--muted); }
.signed-out .auth .alt a { font-weight: 700; }
.signed-out .auth .guest { margin-top: 16px; gap: 12px; }
.signed-out .auth .guest .btn.ghost { min-height: 52px; border-radius: 999px; font-size: 16px; font-weight: 650; background: transparent; border-color: color-mix(in srgb, var(--text) 22%, var(--border)); }
.signed-out .auth .guest .btn.ghost:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.signed-out .auth .guest .gsub { font-size: 13px; }
.signed-out .trust { font-size: 12px; color: var(--faint); }
/* A laptop or wider: the card's own width, a little more air. */
@media (min-width: 1024px) { .signed-out .auth { max-width: 480px; } .signed-out .hero { align-content: start; padding-top: clamp(40px, 7vh, 72px); }
  .signed-out .side h2 { font-size: clamp(38px, 3.3vw, 56px); } .signed-out .side > p:not(.si-st) { margin-bottom: 16px; }
  .signed-out .side ul { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; width: 100%; padding-top: 18px; border-top: 1px solid var(--glass-line, var(--border)); }
  .signed-out .side li { display: grid; align-items: start; align-content: start; justify-items: start; gap: 8px; font-size: 14px; font-weight: 550; line-height: 1.35; color: var(--muted); }
  .signed-out .side .si { width: 30px; height: 30px; border-radius: 9px; } .signed-out .side .si svg { width: 16px; height: 16px; } }
/* Ask Purser floats at the bottom right: signed out it is the round mark only (its words kept for screen readers and in
   its title), and the trust line keeps clear of it (it covered "Works with ..." at 1024 and 390). */
.signed-out #pask-fab { padding: 0 7px; }
.signed-out #pask-fab .pask-t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.signed-out p.trust { padding-left: 76px; padding-right: 76px; }
@media (max-width: 1023px) {
  .signed-out .hero { padding: 22px 20px; justify-items: start; border-bottom: 1px solid var(--border); }
  .signed-out .side { padding: 0; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px 14px; max-width: min(560px, 66%); }
  .signed-out .side .side-mk { width: 46px; height: 46px; margin: 0; border-radius: 14px; } .signed-out .side .side-mk svg { width: 22px; height: 22px; }
  .signed-out .side h2 { font-size: 30px; }
  .signed-out .side > p { flex-basis: 100%; margin: 6px 0 12px; font-size: 16px; }
  .signed-out .side ul { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .signed-out .side li { font-size: 14px; gap: 8px; } .signed-out .side .si { width: 30px; height: 30px; border-radius: 9px; } .signed-out .side .si svg { width: 15px; height: 15px; }
  .signed-out .hero { padding-bottom: 50px; }
  .signed-out .hero canvas.si-wave { height: 46px; }
}
@media (max-width: 1023px) { .signed-out .side p.si-st { flex-basis: auto; margin: 4px 0 6px; } }
@media (max-width: 640px) {
  .signed-out .side p.si-st { display: none; }
  .signed-out .hero { padding: 18px 16px 20px; }
  .signed-out .side h2 { font-size: 26px; }
  .signed-out .side > p { display: block; margin: 4px 0 0; font-size: 14.5px; }
  .signed-out .side ul { display: none; }
  .signed-out .hero { padding-bottom: 36px; }
  .signed-out .hero canvas.si-wave { height: 34px; opacity: .8; }
  .signed-out p.trust { padding-left: 12px; padding-right: 68px; }
  .signed-out .side > p { text-shadow: 0 1px 8px var(--bg); }
  .signed-out .auth { padding: 20px 18px 16px; border-radius: 20px; }
  .signed-out .auth h1 { font-size: 26px; margin-bottom: 10px; }
  .signed-out .auth .addr, .signed-out .auth .addr .field { min-height: 50px; }
  .signed-out .auth .btn.primary.big { min-height: 52px; margin-top: 12px; font-size: 16px; }
  .signed-out .auth .alt { margin-top: 10px; font-size: 14px; } .signed-out .auth .guest { margin-top: 10px; gap: 8px; }
  .signed-out .auth .guest .btn.ghost { min-height: 46px; }
}
/* 4K (Max, 21 Nov: "razor-sharp at 4K"): a larger measure on very wide screens, never a narrow column. */
@media (min-width: 1920px) { .signed-out .side { max-width: 640px; } .signed-out .side li { font-size: 18px; } .signed-out .auth { max-width: 580px; padding: 48px 48px 36px; } }
@media (min-width: 2400px) { .signed-out .side, .signed-out .auth, .signed-out .trust { zoom: 1.3; } }
@media (min-width: 3200px) { .signed-out .side, .signed-out .auth, .signed-out .trust { zoom: 1.65; } }
@media (prefers-reduced-motion: reduce) { .signed-out .auth .btn.primary.big, .signed-out .auth .guest .btn.ghost { transition: none; } }
`;

/**
 * Places on the globe, each a small ping with a label (21 Nov, Max). Only places the repository or the owner states.
 * 26 Nov (Max: "a small pulsing green dot at the company's location"): the company is the demo company, Northwind
 * Outdoor; its location is Amsterdam, NL, as its test world's payer address gives it (src/e2e/platformRun.ts withPayer:
 * countryCode NL, city Amsterdam; its country NL also in src/icc/policy.ts). It is the one green dot and the one that
 * pulses. Airwallex (its San Francisco office), Anthropic (Claude) and Visa in San Francisco stay as a quiet violet dot.
 * Moneybird and Alta are left off: the repository states no location for either company. [longitude, latitude, label, green]
 */
const PLACES: readonly GlobePlace[] = [
  [4.9, 52.37, "Northwind Outdoor (demo)", true], // the demo company's location: Amsterdam, NL
  [-122.42, 37.77, "Airwallex · Claude · Visa", false],
];

/** The sign-in's script: the globe and the wave at the bottom of the left panel. */
export const SIGNIN_JS = `${globeScript({ selector: "canvas.si-globe", avoid: ".side-mk, .side h2, .side > p, .side li", maxR: 230, places: PLACES, arcLabel: "AMS → SFO" })}
${waveScript({ selector: "canvas.si-wave", placement: "hero", density: 0.7, intensity: 1.15 })}`;
