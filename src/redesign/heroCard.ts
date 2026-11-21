// Home's signature visual (the owner, 21 Nov: "an extreme, premium visual upgrade"; "that gorgeous Purser Apple Wallet
// card design"): the agents' cards as metal passes, floating in perspective over a tiled floor that runs into the
// distance. The look is the console's Wallet pass (cloud/src/agentWallet.ts: a rounded card in the agent's own
// gradient, a highlight from the top right, small uppercase labels, the card's last four digits), cast in metal: a
// brushed, anodised face, an engraved silver type, a gold chip, a light that sweeps across it and a glare that follows
// the pointer.
//
// Every value on a card is a record's: each agent's name (the main run's snapshot) and its card's last four digits and
// limits as Airwallex read them back in the sandbox (docs/demo/airwallex-run.json, through agentRoster in home.ts); each
// card says "Sandbox". No card read back: the front card shows the brand alone and no figure. The picture is decorative
// (aria-hidden): the agents' part of Home says the same in words, with the same records.
//
// Motion: a slow float and a sweep of light, both transform and opacity only; the pointer tilts the scene through two
// custom properties set in one animation frame (no layout read while moving, the box is measured on entry and resize).
// With prefers-reduced-motion the scene stands still in its pose and the pointer moves nothing. Off screen it pauses.

import type { RosterAgent } from "./home.js";
import { esc, icon } from "./ui.js";

/** The records the cards' values are read from (as home.ts ROSTER_RECORDS). */
export const HERO_CARD_RECORDS = "docs/demo/airwallex-run.json docs/demo/main-run.json";
/** Each card's own word for what it is: an Airwallex sandbox card, never a real one. */
export const HERO_CARD_LABEL = "SANDBOX";

const W = 856, H = 540;
const money = (a: RosterAgent, v: string) => `${a.currency} ${v}`;

/** The front card's face: the mark and the wordmark, the sandbox label, the chip, the number's last four, three fields. */
function frontArt(a: RosterAgent | undefined): string {
  const fields = a ? [["AGENT", a.name, 60], ["PER PURCHASE", money(a, a.perTx), 404], ["PER MONTH", money(a, a.monthly), 616]] as const : [["AGENT CARD", "Purser", 60]] as const;
  return `<svg class="pc-art" viewBox="0 0 ${W} ${H}" focusable="false">
<defs>
<linearGradient id="pc-silver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e3e5f5"/><stop offset="1" stop-color="#b8bde3"/></linearGradient>
<linearGradient id="pc-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbeab0"/><stop offset=".38" stop-color="#d6a64a"/><stop offset=".62" stop-color="#f5d78e"/><stop offset="1" stop-color="#9c6f25"/></linearGradient>
<linearGradient id="pc-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".22" stop-color="#f5d78e" stop-opacity=".05"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#f5d78e" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/></linearGradient>
<linearGradient id="pc-holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c7d2fe"/><stop offset=".3" stop-color="#f5d0fe"/><stop offset=".55" stop-color="#a5f3fc"/><stop offset=".8" stop-color="#fde68a"/><stop offset="1" stop-color="#c7d2fe"/></linearGradient>
<filter id="pc-eng" x="-5%" y="-20%" width="110%" height="150%"><feDropShadow dx="0" dy="1.6" stdDeviation=".9" flood-color="#05030f" flood-opacity=".55"/></filter>
</defs>
<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="44" fill="none" stroke="url(#pc-rim)" stroke-width="3"/>
<g filter="url(#pc-eng)">
<rect x="56" y="48" width="64" height="64" rx="18" fill="url(#pc-holo)"/>
<g transform="translate(68 60) scale(1.67)" color="#1e1b4b">${icon("feather", 24)}</g>
<text class="pc-wm" x="138" y="93">Purser</text>
<rect x="${W - 56 - 172}" y="56" width="172" height="44" rx="22" fill="#ffffff" fill-opacity=".1" stroke="#ffffff" stroke-opacity=".38" stroke-width="2"/>
<text class="pc-mono pc-pill" x="${W - 56 - 86}" y="85" text-anchor="middle">${esc(HERO_CARD_LABEL)}</text>
</g>
<g transform="translate(60 178)">
<rect width="112" height="86" rx="16" fill="url(#pc-gold)"/>
<path d="M0 30H38M0 56H38M74 30H112M74 56H112M38 0V86M74 0V86M38 22H74M38 64H74" fill="none" stroke="#6b4a12" stroke-opacity=".5" stroke-width="2.4"/>
<rect x=".8" y=".8" width="110.4" height="84.4" rx="15.2" fill="none" stroke="#fff6d6" stroke-opacity=".6" stroke-width="1.6"/>
</g>
<g transform="translate(206 194)" fill="none" stroke="#ffffff" stroke-opacity=".78" stroke-width="5" stroke-linecap="round"><path d="M2 14a40 40 0 0 1 0 28"/><path d="M16 4a58 58 0 0 1 0 48"/><path d="M30-6a76 76 0 0 1 0 68"/></g>
<g filter="url(#pc-eng)">
${a ? `<text class="pc-mono pc-num" x="60" y="362">•••• •••• •••• ${esc(a.last4)}</text>` : ""}
${fields.map(([k, v, x]) => `<text class="pc-mono pc-k" x="${x}" y="432">${esc(k)}</text><text class="pc-v" x="${x}" y="476">${esc(v)}</text>`).join("")}
</g>
</svg>`;
}

/** A card behind the front one: only its top shows, the agent's name and its card's last four. */
function backArt(a: RosterAgent): string {
  return `<svg class="pc-art" viewBox="0 0 ${W} ${H}" focusable="false"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="44" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="3"/><text x="${W - 56}" y="58" text-anchor="end"><tspan class="pc-v pc-bn">${esc(a.name)}</tspan><tspan class="pc-mono pc-bl" dx="22">•••• ${esc(a.last4)}</tspan></text></svg>`;
}

/**
 * The scene: a tiled floor running into the distance and two beams of light, and over them the stack of cards, the
 * front one the first agent's (Sourcing), the two behind it the others', each in its pass colour (agentWallet.ts PASS_HUE).
 */
export function heroCardHtml(roster: readonly RosterAgent[]): string {
  const [front, ...rest] = roster;
  const hue = (id: string) => ({ sourcing: "h0", support: "h1", treasury: "h2" } as Record<string, string>)[id] ?? "h2";
  const backs = rest.slice(0, 2).map((a, i) => `<div class="pc pc-b pc-b${i + 1} ${hue(a.id)}">${backArt(a)}</div>`).reverse().join("");
  return `<div class="hx" aria-hidden="true"${roster.length ? ` data-rec="${HERO_CARD_RECORDS}"` : ""}>
  <div class="h-beams"></div><div class="h-floor"><div class="h-tiles"></div></div>
  <div class="hx-glow"></div>
  <div class="hx-tilt"><div class="hx-pose"><div class="hx-float">${backs}<div class="pc pc-front ${front ? hue(front.id) : "h0"}"><span class="pc-glare"></span><span class="pc-sweep"></span>${frontArt(front)}</div></div></div></div>
  <div class="hx-shadow"></div>
</div>`;
}

export const HERO_CARD_CSS = `
/* The hero's scene (src/redesign/heroCard.ts): a tiled floor into the distance, beams of light, the cards above it. */
.hx { position: relative; width: 100%; max-width: 560px; justify-self: center; aspect-ratio: 1.18; perspective: 1500px; --px: 0; --py: 0; --hxg: .75;
  --tile: color-mix(in srgb, var(--text) 8%, transparent); --tile-hi: color-mix(in srgb, var(--accent) 30%, transparent); }
.h-floor { position: absolute; left: -90%; right: -90%; top: 46%; bottom: -55%; perspective: 420px; perspective-origin: 50% 0%; pointer-events: none;
  -webkit-mask-image: radial-gradient(48% 70% at 50% 62%, #000 20%, transparent 70%); mask-image: radial-gradient(48% 70% at 50% 62%, #000 20%, transparent 70%); }
.h-tiles { position: absolute; left: 0; right: 0; top: -40%; bottom: 0; transform-origin: 50% 100%; transform: rotateX(72deg); overflow: hidden; }
.h-tiles::before { content: ""; position: absolute; left: 0; right: 0; top: -88px; bottom: 0; background:
  linear-gradient(90deg, transparent calc(50% - 44px), color-mix(in srgb, var(--accent) 9%, transparent) calc(50% - 44px) calc(50% + 44px), transparent calc(50% + 44px)),
  repeating-linear-gradient(90deg, var(--tile) 0 1.5px, transparent 1.5px 88px),
  repeating-linear-gradient(0deg, var(--tile) 0 1.5px, transparent 1.5px 88px);
  background-position: 0 0, calc(50% - 44px) 0, 0 0; }
.h-beams { position: absolute; left: -10%; right: -40%; top: -45%; bottom: 10%; pointer-events: none; background:
  linear-gradient(118deg, transparent 40%, color-mix(in srgb, var(--accent) 20%, transparent) 47%, transparent 55%),
  linear-gradient(128deg, transparent 54%, rgba(245, 200, 120, .13) 59%, transparent 65%),
  linear-gradient(108deg, transparent 26%, color-mix(in srgb, var(--accent) 10%, transparent) 31%, transparent 36%);
  -webkit-mask-image: radial-gradient(60% 60% at 62% 38%, #000, transparent 75%); mask-image: radial-gradient(60% 60% at 62% 38%, #000, transparent 75%); opacity: var(--hxg); }
@media (prefers-reduced-motion: no-preference) {
  .h-tiles::before { animation: h-drift 5s linear infinite; }
  .h-beams { animation: h-beam 9s ease-in-out infinite alternate; }
  .hx.off .h-tiles::before, .hx.off .h-beams { animation-play-state: paused; }
}
@keyframes h-drift { from { transform: translateY(0); } to { transform: translateY(88px); } }
@keyframes h-beam { from { opacity: calc(var(--hxg) * .6); transform: translateX(-3%); } to { opacity: var(--hxg); transform: translateX(3%); } }

/* The cards. */
.hx-glow { position: absolute; inset: 8% 4% 4%; opacity: var(--hxg); background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 42%, transparent), transparent), radial-gradient(40% 36% at 74% 30%, rgba(245, 196, 110, .22), transparent 70%); }
.hx-tilt { position: absolute; inset: 0; display: grid; place-items: center; transform-style: preserve-3d; transform: rotateX(calc(var(--py) * -10deg)) rotateY(calc(var(--px) * 14deg)); transition: transform .6s cubic-bezier(.2, .7, .2, 1); }
.hx-pose { width: 80%; aspect-ratio: ${W} / ${H}; transform-style: preserve-3d; transform: translateY(4%) rotateX(24deg) rotateY(-18deg) rotateZ(9deg); }
.hx-float { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; }
.pc { position: absolute; inset: 0; border-radius: 5.2% / 8.2%; overflow: hidden; color: #fff; }
.pc.h0 { background: radial-gradient(120% 90% at 100% 0%, rgba(255,255,255,.24), transparent 52%), linear-gradient(118deg, #15123a 0%, #2a2575 16%, #5a52e6 31%, #362f9c 44%, #4b43d6 56%, #7467f2 66%, #3b2a9c 80%, #7c3aed 100%); }
.pc.h1 { background: radial-gradient(120% 90% at 100% 0%, rgba(255,255,255,.22), transparent 52%), linear-gradient(140deg, #022c22 0%, #064e3b 35%, #0f766e 70%, #0e9488 100%); }
.pc.h2 { background: radial-gradient(120% 90% at 100% 0%, rgba(255,255,255,.22), transparent 52%), linear-gradient(140deg, #08122e 0%, #0b1b45 35%, #1e3a8a 70%, #2563eb 100%); }
/* Metal: hairline brushing and an anisotropic sheen over the pass's gradient. */
.pc::before, .pc::after { content: ""; position: absolute; inset: 0; pointer-events: none; }
.pc::before { background: repeating-linear-gradient(90deg, rgba(255,255,255,.06) 0 1px, rgba(0,0,0,.07) 1px 2px, transparent 2px 3px); mix-blend-mode: overlay; }
.pc::after { inset: -40%; background: conic-gradient(from 200deg at 18% 82%, rgba(255,255,255,0) 0deg, rgba(255,255,255,.3) 24deg, rgba(0,0,0,.22) 60deg, rgba(255,255,255,.22) 104deg, rgba(0,0,0,.16) 150deg, rgba(255,255,255,.26) 200deg, rgba(0,0,0,.2) 250deg, rgba(255,255,255,.16) 300deg, rgba(255,255,255,0) 360deg); mix-blend-mode: soft-light; transform: rotate(calc(var(--px) * 24deg - var(--py) * 12deg)); transition: transform .6s cubic-bezier(.2, .7, .2, 1); }
.pc-front { box-shadow: inset 0 1.5px 0 rgba(255,255,255,.4), inset 0 -2px 6px rgba(0,0,0,.35), 0 50px 90px -36px rgba(8, 6, 36, .9), 0 22px 44px -22px color-mix(in srgb, var(--accent) 80%, transparent); transform: translateZ(0); }
.pc-b { box-shadow: inset 0 1px 0 rgba(255,255,255,.3), 0 30px 60px -30px rgba(0,0,0,.7); }
.pc-b1 { transform: translate3d(-1%, -26%, -60px) rotateZ(-2deg); }
.pc-b2 { transform: translate3d(-2%, -50%, -120px) rotateZ(-4deg); filter: brightness(.8); }
.pc-art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 1; }
.pc-art .i { vertical-align: 0; }
.pc-art text { font-family: Inter, system-ui, -apple-system, sans-serif; fill: url(#pc-silver); }
.pc-art .pc-mono { font-family: var(--mono); }
.pc-wm { font-size: 44px; font-weight: 760; letter-spacing: -1px; }
.pc-pill { font-size: 19px; font-weight: 600; letter-spacing: 4px; fill: #fff; }
.pc-num { font-size: 46px; letter-spacing: 1px; font-weight: 500; word-spacing: 10px; }
.pc-k { font-size: 17px; letter-spacing: 3.5px; fill: #fff; fill-opacity: .66; }
.pc-v { font-size: 31px; font-weight: 650; letter-spacing: -.3px; }
.pc-b .pc-art text { fill: #fff; } .pc-bn { font-size: 30px; } .pc-bl { font-size: 28px; letter-spacing: 3px; fill-opacity: .8; }
/* Light: a glare that follows the pointer and a sweep that crosses the card now and then. */
.pc-glare { position: absolute; inset: -60%; z-index: 2; pointer-events: none; background: radial-gradient(closest-side, rgba(255,255,255,.5), rgba(255,255,255,.12) 45%, transparent 70%); mix-blend-mode: overlay; opacity: .55; transform: translate(calc(var(--px) * 22% + 14%), calc(var(--py) * 22% - 16%)); transition: transform .6s cubic-bezier(.2, .7, .2, 1), opacity .6s ease; }
.hx.on .pc-glare { opacity: 1; }
.pc-sweep { position: absolute; inset: 0; z-index: 2; pointer-events: none; background: linear-gradient(112deg, transparent 36%, rgba(255,255,255,.05) 44%, rgba(255,255,255,.42) 50%, rgba(255,255,255,.05) 56%, transparent 64%); mix-blend-mode: overlay; transform: translateX(-110%); }
.hx-shadow { position: absolute; left: 18%; right: 14%; bottom: 3%; height: 14%; background: radial-gradient(closest-side, rgba(4, 3, 20, .55), transparent), radial-gradient(closest-side, color-mix(in srgb, var(--accent) 30%, transparent), transparent); transform: rotateZ(-4deg); }
@media (prefers-reduced-motion: no-preference) {
  .hx-float { animation: hx-float 8s ease-in-out infinite; will-change: transform; }
  .hx-shadow { animation: hx-shadow 8s ease-in-out infinite; }
  .pc-sweep { animation: hx-sweep 7s cubic-bezier(.45, 0, .2, 1) 1.4s infinite; }
  .hx-glow { animation: hx-glow 8s ease-in-out infinite; }
  .hx.off .hx-float, .hx.off .hx-shadow, .hx.off .pc-sweep, .hx.off .hx-glow { animation-play-state: paused; }
}
@keyframes hx-float { 0%, 100% { transform: translate3d(0, 0, 0) rotateZ(0); } 50% { transform: translate3d(0, -4.5%, 18px) rotateZ(-1.2deg); } }
@keyframes hx-shadow { 0%, 100% { transform: rotateZ(-4deg) scale(1); opacity: 1; } 50% { transform: rotateZ(-4deg) scale(.9); opacity: .75; } }
@keyframes hx-sweep { 0% { transform: translateX(-110%); } 38%, 100% { transform: translateX(110%); } }
@keyframes hx-glow { 0%, 100% { transform: scale(.96); } 50% { transform: scale(1.04); } }
@media (max-width: 1039px) { .hx { aspect-ratio: 1.5; max-width: 600px; } .hx-pose { width: 74%; transform: translateY(9%) rotateX(24deg) rotateY(-18deg) rotateZ(9deg); } }
@media (max-width: 640px) { .hx { aspect-ratio: 1.32; margin-top: 4px; } .hx-pose { width: 84%; transform: translateY(8%) rotateX(22deg) rotateY(-14deg) rotateZ(7deg); } }
/* Dark pages: a brighter floor and fuller light (light pages keep the paler defaults); the cards stay metal. */
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .hx { --hxg: 1; --tile: color-mix(in srgb, var(--text) 11%, transparent); } }
:root[data-theme="dark"] .hx { --hxg: 1; --tile: color-mix(in srgb, var(--text) 11%, transparent); }
`;

/** The pointer tilts the scene (a mouse or pen only, never with reduced motion); off screen the motion pauses. */
export const HERO_CARD_JS = `
(function () {
  var hx = document.querySelector(".hx"), mm = window.matchMedia;
  if (!hx || !mm || mm("(prefers-reduced-motion: reduce)").matches) return;
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { hx.classList.toggle("off", !es[0].isIntersecting); }).observe(hx);
  if (!mm("(hover: hover) and (pointer: fine)").matches) return;
  var area = hx.closest("section") || document.body, box = null, raf = 0, x = 0, y = 0;
  function measure() { box = hx.getBoundingClientRect(); }
  function paint() { raf = 0; hx.style.setProperty("--px", x.toFixed(3)); hx.style.setProperty("--py", y.toFixed(3)); }
  var clamp = function (v) { return v < -1 ? -1 : v > 1 ? 1 : v; };
  area.addEventListener("pointerenter", function () { measure(); hx.classList.add("on"); });
  area.addEventListener("pointermove", function (e) {
    if (!box) measure();
    x = clamp((e.clientX - box.left - box.width / 2) / (box.width * 0.75));
    y = clamp((e.clientY - box.top - box.height / 2) / (box.height * 0.75));
    if (!raf) raf = requestAnimationFrame(paint);
  }, { passive: true });
  area.addEventListener("pointerleave", function () { x = 0; y = 0; hx.classList.remove("on"); if (!raf) raf = requestAnimationFrame(paint); });
  addEventListener("scroll", function () { box = null; }, { passive: true });
  addEventListener("resize", function () { box = null; }, { passive: true });
})();`;
