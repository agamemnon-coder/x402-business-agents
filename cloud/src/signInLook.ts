// Purser Cloud's signed-out screens (sign-in, first run, a passkey's enrolment). 21 Nov, Max, from his mockup: "upgrade
// purser cloud login page to exactly this, only not with all the text left: just Purser Cloud and some small USP, and
// animating". 26 Nov, later (Max: "the big one in the cloud sign in page its in front of the glow looks a bit weird and
// the page looks simple and amateur"): one scene, not a globe pasted on a glow. The Earth is a horizon across the bottom
// of the page (src/ui/globe.ts, horizon mode), dim and in the page's own ground, its lit limb the brightest line; the
// purple glow rises from behind that limb, so it reads as light from beyond the Earth; the arc from the demo company
// (Amsterdam) leaps over it. Above: the Purser mark, "Purser Cloud", one line, a quiet status strip (only what is true of
// this page: the sandbox's test money, sign-in by passkey) and three points. Near the arc floats one small card from the
// demo company's own records: its invoice that waits for the CFO's Face ID (the guest seed, not typed here), labelled
// demo and test money. On the right the card as glass. Only the look and one canvas: authentication is unchanged
// (cloud/src/console.ts signInView). Scoped to .signed-out and written in the theme's own variables, light and dark.
// Under prefers-reduced-motion the Earth is drawn once and nothing floats.

import { globeScript, type GlobePlace } from "../../src/ui/globe.js";
import { t as tr } from "../../src/ui/i18n.js";
import { escAttr, svg } from "../../src/ui/payablesKit.js";
import { SEED_BATCHES } from "./guest/seed.gen.js";

/** The demo company's invoice that waits for the CFO's Face ID, from the guest seed (what "Try as guest" opens). */
const WAITS = (() => {
  type Inv = { vendor: string; invoice_no: string; currency: string; total: string; status: string };
  const all = SEED_BATCHES.flatMap((b) => (b.invoices as Inv[] | undefined) ?? []);
  const w = all.find((i) => i.status === "waiting_cfo");
  if (!w) throw new Error("sign-in: the guest seed has no invoice waiting for the CFO");
  const [whole, frac] = Number(w.total).toFixed(2).split(".");
  return { vendor: w.vendor, no: w.invoice_no, amount: `${w.currency} ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}` };
})();
export const SIGNIN_DEMO_INVOICE = WAITS;

/** The left panel's words, the status strip, the three points, the floating demo card and the Earth's canvas. */
export const SIGNIN_HERO = `<div class="hero"><div class="side"><h2 data-t="cs.side.title">${tr("en", "cs.side.title")}</h2><span class="side-mk" aria-hidden="true">${svg("feather", 30)}</span><p data-t="cs.side.sub">${tr("en", "cs.side.sub")}</p><p class="si-st"><span><i aria-hidden="true"></i><span data-t="cs.side.status">${tr("en", "cs.side.status")}</span></span><span class="si-pk">${svg("lock", 13)}<span data-t="cs.side.passkey">${tr("en", "cs.side.passkey")}</span></span></p><ul>${([["cs.side.1", "file-check"], ["cs.side.2", "scan-face"], ["cs.side.3", "database"]] as const).map(([k, i]) => `<li><span class="si">${svg(i, 18)}</span><span data-t="${k}">${tr("en", k)}</span></li>`).join("")}</ul></div>
<div class="si-float" role="note" aria-label="${escAttr(tr("en", "cs.side.demo"))}"><span class="sf-i" aria-hidden="true">${svg("scan-face", 18)}</span><span class="sf-b"><span class="sf-w"><i aria-hidden="true"></i><span data-t="cs.side.waits">${tr("en", "cs.side.waits")}</span></span><span class="sf-r"><b>${escAttr(WAITS.vendor)}</b><b class="num">${WAITS.amount}</b></span><span class="sf-t"><small class="mono">${escAttr(WAITS.no)}</small><span class="sf-d" data-t="cs.side.demo">${tr("en", "cs.side.demo")}</span></span></span></div>
<canvas class="si-globe" aria-hidden="true"></canvas></div>`;

export const SIGNIN_CSS = `
/* The left panel: words above, the Earth's horizon below, the glow rising from behind its limb (one scene). */
.signed-out .hero { position: relative; isolation: isolate; border-right: 0; border-bottom: 0; align-content: start; justify-items: start; background: transparent; }
.signed-out .hero::before { content: ""; position: absolute; z-index: -3; left: 0; right: 0; top: 0; bottom: 0; pointer-events: none;
  background: radial-gradient(50% 30% at var(--si-gx, 30%) var(--si-gy, 74%), color-mix(in srgb, var(--accent) var(--si-ga, 42%), transparent), color-mix(in srgb, var(--accent) 9%, transparent) 55%, transparent 82%),
    radial-gradient(22% 20% at calc(var(--si-gx, 30%) + 12%) calc(var(--si-gy, 74%) - 2%), color-mix(in srgb, #e879f9 16%, transparent), transparent 75%),
    radial-gradient(95% 70% at calc(var(--si-gx, 30%) + 26%) -6%, color-mix(in srgb, #4f46e5 var(--si-nb, 11%), transparent), transparent 75%),
    radial-gradient(55% 45% at calc(var(--si-gx, 30%) - 6%) 4%, color-mix(in srgb, var(--accent) var(--si-nb2, 7%), transparent), transparent 72%); }
/* 26 Nov, later (Max: "the glow like really far or the stars like space"): depth, back to front: the stars (the
   canvas, dark only), a far violet and indigo haze high in the sky, the glow at the limb, the Earth. */
.signed-out main { background: transparent; }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .signed-out .hero { --si-ga: 30%; --si-nb: 6%; --si-nb2: 4%; } }
:root[data-theme="light"] .signed-out .hero { --si-ga: 30%; --si-nb: 6%; --si-nb2: 4%; }
.signed-out canvas.pw-wave { display: none; }
.signed-out .hero canvas.si-globe { position: absolute; z-index: -2; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.signed-out .trust { position: relative; z-index: 1; }
/* Signed out, no "test money" chip in the header: the status strip says it, quietly, and the trust line under the card. */
.signed-out .appbar .test { display: none; }
@media (min-width: 760px) { .signed-out .appbar { display: none; } }
.signed-out .side { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: flex-start; max-width: 520px; margin: 0; padding: 0 0 0 clamp(8px, 2vw, 40px); }
.signed-out .side .side-mk { order: -1; display: grid; place-items: center; width: 52px; height: 52px; margin: 0 0 26px; border-radius: 15px; color: var(--text);
  border: 1px solid var(--glass-line, color-mix(in srgb, var(--accent) 30%, var(--border))); background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 34%, var(--surface)), color-mix(in srgb, var(--accent) 10%, var(--surface)));
  box-shadow: 0 14px 36px -16px color-mix(in srgb, var(--accent) 75%, transparent), inset 0 1px 0 rgba(255, 255, 255, .14); }
.signed-out .side .side-mk svg { width: 25px; height: 25px; }
.signed-out .side h2 { margin: 0; font-size: clamp(40px, 3.7vw, 60px); line-height: 1; font-weight: 760; letter-spacing: -.04em; color: var(--text);
  background: linear-gradient(180deg, var(--text) 30%, color-mix(in srgb, var(--text) 62%, var(--accent))); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; padding-bottom: .06em; }
.signed-out .side > p:not(.si-st) { margin: 14px 0 0; max-width: 30ch; font-size: clamp(17px, 1.3vw, 20px); line-height: 1.45; color: var(--muted); text-wrap: balance; }
/* The status strip: what is true of this page, in a quiet mono line. */
.signed-out .side p.si-st { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0; margin: 22px 0 0; padding: 0; border: 1px solid var(--glass-line, var(--border)); border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 55%, transparent); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); font: 600 11.5px/1 var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.signed-out .side p.si-st > span { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; }
.signed-out .side p.si-st > span + span { border-left: 1px solid var(--glass-line, var(--border)); }
.signed-out .side p.si-st i { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 22%, transparent); }
.signed-out .side p.si-st svg { width: 12px; height: 12px; color: var(--faint); }
/* Three points: a hairline above, one row of three. */
.signed-out .side ul { list-style: none; margin: 30px 0 0; padding: 20px 0 0; width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; border-top: 1px solid var(--glass-line, var(--border)); }
.signed-out .side li { display: grid; align-content: start; justify-items: start; gap: 10px; font-size: 14px; font-weight: 550; line-height: 1.35; color: var(--muted); }
.signed-out .side .si { flex: none; display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: color-mix(in srgb, var(--accent) 75%, var(--text));
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border)); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.signed-out .side .si svg { width: 15px; height: 15px; } .signed-out .side .si .i { margin: 0; color: inherit; }
/* The floating card: one invoice from the demo company's records, near the arc, labelled demo and test money. */
.signed-out .si-float { display: none; }
@media (min-width: 1024px) {
  .signed-out .si-float { position: absolute; z-index: 1; left: calc(clamp(8px, 2vw, 40px) + 48px); bottom: clamp(48px, 9%, 120px); display: flex; gap: 13px; align-items: flex-start; width: 340px; padding: 13px 15px 12px 13px; border-radius: 16px;
    border: 1px solid var(--glass-line, var(--border)); background: color-mix(in srgb, var(--surface) 72%, transparent); -webkit-backdrop-filter: blur(16px) saturate(1.3); backdrop-filter: blur(16px) saturate(1.3);
    box-shadow: 0 24px 60px -28px rgba(8, 6, 28, .7), 0 0 0 1px color-mix(in srgb, var(--accent) 6%, transparent), inset 0 1px 0 rgba(255, 255, 255, .06); animation: si-bob 7s ease-in-out infinite; }
}
.signed-out .sf-i { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--sunken, var(--surface))); }
.signed-out .sf-b { display: grid; gap: 3px; min-width: 0; flex: 1; }
.signed-out .sf-t { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.signed-out .sf-w { display: inline-flex; align-items: center; gap: 7px; min-width: 0; font-size: 12px; font-weight: 650; color: var(--accent); }
.signed-out .sf-w i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: si-ping 2.4s ease-out infinite; }
.signed-out .sf-d { flex: none; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--glass-line, var(--border)); font: 600 10px/1.3 var(--mono, ui-monospace, monospace); letter-spacing: .05em; text-transform: uppercase; color: var(--faint); }
.signed-out .sf-r { display: flex; justify-content: space-between; gap: 10px; font-size: 14.5px; color: var(--text); } .signed-out .sf-r b:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.signed-out .sf-r .num { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 700; }
.signed-out p.trust > span:first-child { text-shadow: 0 0 10px var(--bg), 0 0 3px var(--bg); }
.signed-out .sf-b small { font-size: 11.5px; color: var(--faint); } .signed-out .sf-b { gap: 5px; }
@keyframes si-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
@keyframes si-ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 7px transparent; } }
/* The trust line under the card: two calm lines with air. */
.signed-out p.trust { gap: 4px; font-size: 12.5px; line-height: 1.55; color: var(--faint); max-width: 560px; justify-self: center; margin-left: auto; margin-right: auto; text-wrap: balance; }
.signed-out p.trust span:last-child { display: inline-flex; justify-self: center; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); font-weight: 600; font-size: 12px; background: color-mix(in srgb, var(--bg) 70%, transparent); }
/* The right: the card as glass over a soft light. */
.signed-out main { isolation: isolate; }
.signed-out main::before { content: ""; position: absolute; z-index: -1; inset: 0; pointer-events: none; background: radial-gradient(46% 46% at 50% 45%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 70%); }
.signed-out .auth { position: relative; border-radius: 24px; padding: 38px 38px 28px; border: 1px solid var(--glass-line, color-mix(in srgb, var(--accent) 20%, var(--border)));
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 82%, transparent), color-mix(in srgb, var(--surface) 66%, transparent));
  -webkit-backdrop-filter: blur(22px) saturate(1.25); backdrop-filter: blur(22px) saturate(1.25);
  box-shadow: 0 40px 90px -40px rgba(8, 6, 28, .55), 0 0 0 1px color-mix(in srgb, var(--accent) 7%, transparent), inset 0 1px 0 rgba(255, 255, 255, .07); }
.signed-out .auth::before { content: ""; position: absolute; left: 18%; right: 18%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 75%, #fff), transparent); }
.signed-out .auth h1 { margin: 0 0 22px; font-size: clamp(30px, 2.4vw, 38px); font-weight: 760; letter-spacing: -.03em; }
.signed-out .auth label { font-weight: 650; font-size: 14.5px; }
.signed-out .auth .addr { min-height: 54px; border-radius: 14px; border-color: color-mix(in srgb, var(--accent) 32%, var(--border)); background: color-mix(in srgb, var(--bg) 55%, var(--surface)); }
.signed-out .auth .addr .field { min-height: 52px; font-size: 16px; background: transparent; }
.signed-out .auth .addr span { align-self: stretch; display: grid; place-items: center; padding: 0 16px; border-left: 1px solid var(--border); font-size: 15.5px; color: var(--muted); }
.signed-out .auth .btn.primary.big { width: 100%; min-height: 54px; margin-top: 16px; border-radius: 14px; font-size: 16.5px; font-weight: 700; border: 0;
  background: var(--btn-bg, var(--accent)); color: var(--btn-ink, #fff); box-shadow: 0 16px 34px -14px color-mix(in srgb, var(--accent) 80%, transparent), inset 0 1px 0 rgba(255, 255, 255, .25); transition: transform .15s ease, box-shadow .15s ease, filter .15s ease; }
.signed-out .auth .btn.primary.big:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 20px 40px -14px color-mix(in srgb, var(--accent) 90%, transparent); }
.signed-out .auth .btn.primary.big:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 3px; }
.signed-out .auth .alt { margin: 16px 0 0; text-align: center; font-size: 14.5px; color: var(--muted); }
.signed-out .auth .alt a { font-weight: 700; }
.signed-out .auth .guest { margin-top: 16px; gap: 12px; }
.signed-out .auth .guest .btn.ghost { min-height: 50px; border-radius: 14px; font-size: 15.5px; font-weight: 650; background: color-mix(in srgb, var(--surface) 40%, transparent); border-color: color-mix(in srgb, var(--text) 18%, var(--border)); }
.signed-out .auth .guest .btn.ghost:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.signed-out .auth .guest .gsub { font-size: 12.5px; }
.signed-out .trust { font-size: 12px; color: var(--faint); }
/* A laptop or wider: the Earth runs under both columns (the canvas and the glow twice the panel's width), the words at the top. */
@media (min-width: 1024px) {
  .signed-out .hero { overflow: visible; padding-top: clamp(40px, 8vh, 84px); --si-gx: 30%; }
  .signed-out .hero::before, .signed-out .hero canvas.si-globe { width: 200%; right: auto; }
  .signed-out .auth { max-width: 460px; } }
@media (min-width: 1024px) and (max-width: 1279px) { .signed-out .si-float { width: 312px; left: 36px; } }
/* Ask Purser floats at the bottom right: signed out it is the round mark only, and the trust line keeps clear of it. */
.signed-out #pask-fab { padding: 0 7px; }
.signed-out #pask-fab .pask-t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.signed-out p.trust { padding-left: 76px; padding-right: 76px; }
@media (max-width: 1023px) {
  .signed-out .hero { overflow: hidden; padding: 26px 22px 118px; --si-gx: 70%; --si-gy: 72%; --si-ga: 50%; }
  .signed-out .hero::before, .signed-out .hero canvas.si-globe { -webkit-mask-image: linear-gradient(180deg, #000 72%, transparent); mask-image: linear-gradient(180deg, #000 72%, transparent); }
  .signed-out .side { padding: 0; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px 14px; max-width: min(620px, 100%); }
  .signed-out .side .side-mk { width: 44px; height: 44px; margin: 0; border-radius: 13px; } .signed-out .side .side-mk svg { width: 21px; height: 21px; }
  .signed-out .side h2 { font-size: 32px; }
  .signed-out .side > p:not(.si-st) { flex-basis: 100%; margin: 8px 0 0; font-size: 16px; max-width: 40ch; }
  .signed-out .side p.si-st { margin: 14px 0 0; }
  .signed-out .side ul { flex-basis: 100%; margin-top: 18px; padding-top: 14px; }
}
@media (max-width: 640px) {
  .signed-out .hero { padding: 18px 16px 66px; --si-gy: 66%; }
  .signed-out .side h2 { font-size: 27px; }
  .signed-out .side > p:not(.si-st) { display: block; margin: 6px 0 0; font-size: 14.5px; }
  .signed-out .side p.si-st { display: none; }
  .signed-out .side ul { display: none; }
  .signed-out p.trust { padding-left: 12px; padding-right: 68px; }
  .signed-out .auth { padding: 22px 18px 16px; border-radius: 20px; }
  .signed-out .auth h1 { font-size: 26px; margin-bottom: 10px; }
  .signed-out .auth .addr, .signed-out .auth .addr .field { min-height: 50px; }
  .signed-out .auth .btn.primary.big { min-height: 52px; margin-top: 12px; font-size: 16px; }
  .signed-out .auth .alt { margin-top: 10px; font-size: 14px; } .signed-out .auth .guest { margin-top: 10px; gap: 8px; }
  .signed-out .auth .guest .btn.ghost { min-height: 46px; }
}
/* 4K (Max, 21 Nov: "razor-sharp at 4K"): a larger measure on very wide screens, never a narrow column. */
@media (min-width: 1920px) { .signed-out .side { max-width: 680px; } .signed-out .side li { font-size: 16px; } .signed-out .auth { max-width: 580px; padding: 48px 48px 36px; } }
@media (min-width: 2400px) { .signed-out .side, .signed-out .auth, .signed-out .trust, .signed-out .si-float { zoom: 1.3; } }
@media (min-width: 3200px) { .signed-out .side, .signed-out .auth, .signed-out .trust, .signed-out .si-float { zoom: 1.65; } }
@media (prefers-reduced-motion: reduce) { .signed-out .auth .btn.primary.big, .signed-out .auth .guest .btn.ghost { transition: none; } .signed-out .si-float, .signed-out .sf-w i { animation: none; } }
`;

/**
 * Places on the Earth (21 Nov, Max). Only places the repository or the owner states. The company is the demo company,
 * Northwind Outdoor; its location is Amsterdam, NL, as its test world's payer address gives it (src/e2e/platformRun.ts
 * withPayer: countryCode NL, city Amsterdam). It is the one green dot and the one that pulses. Airwallex (its San
 * Francisco office), Anthropic (Claude) and Visa in San Francisco are the arc's far end, beyond the horizon. Moneybird and
 * Alta are left off: the repository states no location for either company. [longitude, latitude, label, green]
 */
const PLACES: readonly GlobePlace[] = [
  [4.9, 52.37, "Northwind Outdoor (demo)", true], // the demo company's location: Amsterdam, NL
  [-122.42, 37.77, "Airwallex · Claude · Visa", false],
];

/** The sign-in's script: the Earth as a horizon, Amsterdam on its limb, the arc to San Francisco over it. Wide: across
 *  the page (the canvas is twice the panel); narrow: under the panel's words. */
export const SIGNIN_JS = `${globeScript({ selector: "canvas.si-globe", avoid: ".side h2, .side > p, .side li, .si-float", places: PLACES, view: [-8, -14, 6], horizon: [[1280, 0.3, 0.74, 0.52, 1500], [1000, 0.36, 0.78, 0.55, 1500], [641, 0.68, 0.76, 0.95, 640, 0.12], [0, 0.7, 0.62, 0.95, 640, 0.07]], dim: 0.8, lift: 0.2, labels: false, stars: [320, ".side, .auth, .si-float, .trust, #pask-fab"] })}`;
