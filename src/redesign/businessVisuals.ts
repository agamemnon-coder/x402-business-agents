// /business's words and its one visual. 26 Nov, evening (Max: "/business still looks ugly and the homepage is still
// the same as the /business; it needs to be something that speaks for itself with a pilot registration, like: Ready for
// the next step? and something with the AI and fintech"): the page is the registration, and "AI and fintech" is the
// atmosphere behind it, not content. Earlier: 21 and 22 Nov the question and its line; 26 Nov the globe (now Purser
// Cloud's sign-in's own), then one screen with the form, then a long landing page that repeated Home.
//
// The visual (BUSINESS_SKY_HTML, BUSINESS_SKY_CSS): a deep ground, a far violet glow, a slow field of stars, a planet's
// horizon glowing at the foot of the screen, and a few thin routes over it along which a light travels now and then, as
// payments do. It explains nothing and names nothing: no figure, no place, no logo. CSS and one inline drawing only, no
// script, no picture; under prefers-reduced-motion it stands still (the routes keep their lights where they stopped).
//
// The colours mean what they mean in Purser Cloud's console (cloud/src/consoleColor.ts, Max: "use the colour system on
// the sign-up page too"): violet Purser and the CFO's approval (--accent), emerald paid (--ok), amber test money
// (--amb, the console's --warn), sky cash and money moving (--sky), and the agents' own hues (Sourcing indigo, Support
// teal, Treasury blue: --g0 to --g2). BUSINESS_TONES sets them on the page, light and dark, at the console's values.

/** The headline (Max, 26 Nov: "Ready for the next step?"), and the one line under it: what the pilot is. */
export const BUSINESS_HEAD = "Ready for the next step?";
export const BUSINESS_LINE = "A 30-day pilot on test money: AI agents pay the routine, your CFO signs the rest with Face ID.";
/** The question the page asked from 21 Nov; now only in the page's description for search and link previews. */
export const BUSINESS_QUESTION = "Would you trust an AI agent with your company's money?";

/**
 * The routes over the horizon, in the drawing's own units (1440 by 360, its foot on the horizon): each rises from one
 * point of the horizon to another. Each carries a light (a short dash) that runs along it once per loop, the loops of
 * different lengths so they never fall into step.
 */
export const ROUTES: readonly { a: number; b: number; h: number; s: number; delay: number; tone: string }[] = [
  { a: 330, b: 545, h: 22, s: 9, delay: 0, tone: "accent" },
  { a: 450, b: 670, h: 24, s: 11, delay: 3.5, tone: "ok" },
  { a: 530, b: 620, h: 12, s: 7.5, delay: 1.8, tone: "sky" },
  { a: 270, b: 390, h: 14, s: 10, delay: 5.2, tone: "g0" },
  { a: 620, b: 735, h: 14, s: 12, delay: 7, tone: "g1" },
  { a: 395, b: 470, h: 9, s: 13, delay: 9, tone: "g2" },
];

/** 26 Nov (Max: "the lines don't land on the planet"): the routes are drawn in the planet's own units (a circle of
 * radius 500 in a 1000-unit square, the same box as .hz), from one point of its rim to another, so both ends sit on the
 * horizon at every width. a and b are x on the rim; h is how high the route arcs above the higher end. */
export const RIM = (x: number): number => 500 - Math.sqrt(500 * 500 - (x - 500) ** 2);
export function routePath(r: { a: number; b: number; h: number }): string {
  const ya = RIM(r.a), yb = RIM(r.b), f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(r.a)} ${f(ya)} Q${f((r.a + r.b) / 2)} ${f(Math.min(ya, yb) - 2 * r.h)} ${f(r.b)} ${f(yb)}`;
}

/** The meaning-colours, at Purser Cloud's console values (cloud/src/consoleColor.ts), scoped to the page. */
const TONES_DARK = "--amb: #ffb547; --sky: #38bdf8; --g0: #818cf8; --g1: #2dd4bf; --g2: #60a5fa;";
export const BUSINESS_TONES = `.bzp { --amb: #a15c00; --sky: #0369a1; --g0: #4f46e5; --g1: #0f766e; --g2: #1d4ed8; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .bzp { ${TONES_DARK} } }
:root[data-theme="dark"] .bzp { ${TONES_DARK} }`;

export const BUSINESS_SKY_HTML = `<div class="bz-sky" aria-hidden="true"><span class="st s1"></span><span class="st s2"></span><span class="ha"></span><span class="hz"></span>
<svg class="rt" viewBox="0 0 1000 1000" width="1000" height="1000" focusable="false">
${ROUTES.map((r, i) => { const d = routePath(r); return `<path class="r" d="${d}"/><circle class="e" cx="${r.a}" cy="${Math.round(RIM(r.a) * 10) / 10}" r="1.1"/><circle class="e" cx="${r.b}" cy="${Math.round(RIM(r.b) * 10) / 10}" r="1.1"/><path class="g p${i + 1}" d="${d}" pathLength="100"/><path class="p p${i + 1}" d="${d}" pathLength="100"/>`; }).join("\n")}
</svg></div>`;

const LIGHT_SKY = `.bz-sky .st { --c: color-mix(in srgb, var(--accent) 45%, transparent); opacity: .5; } .bz-sky::before { opacity: .45; }
  .bz-sky .hz { background: radial-gradient(50% 50% at 50% 50%, #ffffff 96%, color-mix(in srgb, var(--accent) 8%, #ffffff) 99.4%, transparent 100%); }`;

export const BUSINESS_SKY_CSS = `
/* The sky: behind everything in main, never in the way of a click. */
.bz-sky { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
/* A far violet glow, high and to the right, and a second, fainter one low on the left. */
.bz-sky::before { content: ""; position: absolute; left: 50%; top: -18%; width: min(1500px, 170vw); height: min(1000px, 130vw); translate: -30% 0; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 26%, transparent), color-mix(in srgb, var(--accent-ink) 10%, transparent) 50%, transparent); opacity: .85; }
.bz-sky::after { content: ""; position: absolute; left: -20%; bottom: 4%; width: min(900px, 120vw); height: min(600px, 90vw); border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent-ink) 18%, transparent), transparent); opacity: .7; }
/* The stars: two fields of fine dots in tiles of different sizes (so no pattern shows), faded out toward the horizon. */
.bz-sky .st { position: absolute; inset: 0 0 0; height: calc(100% + 340px); -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 40%, transparent 78%); mask-image: linear-gradient(180deg, #000 0%, #000 40%, transparent 78%); }
.bz-sky .s1 { --c: color-mix(in srgb, #ffffff 75%, var(--accent)); background-size: 233px 211px; opacity: .55;
  background-image: radial-gradient(1.2px 1.2px at 23px 41px, var(--c), transparent), radial-gradient(1px 1px at 151px 19px, var(--c), transparent), radial-gradient(1.4px 1.4px at 97px 133px, var(--c), transparent),
    radial-gradient(1px 1px at 201px 171px, var(--c), transparent), radial-gradient(1px 1px at 61px 189px, var(--c), transparent), radial-gradient(1.2px 1.2px at 177px 97px, var(--c), transparent); }
.bz-sky .s2 { --c: color-mix(in srgb, #ffffff 55%, var(--accent)); background-size: 371px 329px; opacity: .45;
  background-image: radial-gradient(1.6px 1.6px at 59px 71px, var(--c), transparent), radial-gradient(1px 1px at 283px 41px, var(--c), transparent), radial-gradient(1.2px 1.2px at 331px 251px, var(--c), transparent),
    radial-gradient(1px 1px at 139px 289px, var(--c), transparent), radial-gradient(1.8px 1.8px at 211px 167px, var(--c), transparent); }
/* The horizon: the top of a very large sphere at the foot of the screen, its rim lit violet, its air glowing above it. */
.bz-sky .hz { position: absolute; left: 50%; top: calc(100% - 150px); width: max(2600px, 260vw); aspect-ratio: 1; translate: -50% 0; border-radius: 50%;
  background: radial-gradient(50% 50% at 50% 50%, var(--bg) 96%, color-mix(in srgb, var(--accent) 10%, var(--bg)) 99.4%, transparent 100%);
  box-shadow: inset 0 1.5px 0 0 color-mix(in srgb, var(--accent) 55%, #ffffff), inset 0 26px 70px -30px color-mix(in srgb, var(--accent) 55%, transparent),
    0 -2px 22px 0 color-mix(in srgb, var(--accent) 45%, transparent); }
/* The horizon's air: a wide, low glow rising from the rim (a gradient, no blur filter, so it draws the same everywhere). */
.bz-sky .ha { position: absolute; left: 50%; bottom: 150px; width: max(1800px, 180vw); height: 520px; translate: -50% 50%; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 26%, transparent), color-mix(in srgb, var(--accent) 8%, transparent) 55%, transparent); }
/* The routes: hairlines rising from the horizon, each with a light that runs along it. */
.bz-sky svg.rt { position: absolute; left: 50%; top: calc(100% - 150px); width: max(2600px, 260vw); height: auto; aspect-ratio: 1; translate: -50% 0; overflow: visible; }
.bz-sky .e { fill: color-mix(in srgb, var(--accent) 55%, #ffffff); opacity: .7; }
.bz-sky .r { fill: none; stroke: color-mix(in srgb, var(--accent) 28%, transparent); stroke-width: 1; stroke-dasharray: 2 6; vector-effect: non-scaling-stroke; }
/* Each light: a bright head (a round dot) over a soft halo, both one dash long on a path 100 long. */
.bz-sky .p, .bz-sky .g { fill: none; stroke-linecap: round; stroke-dasharray: .01 100; stroke-dashoffset: 40; vector-effect: non-scaling-stroke; }
.bz-sky .p { stroke: color-mix(in srgb, var(--t, var(--accent)) 45%, #ffffff); stroke-width: 4.5; }
.bz-sky .g { stroke: var(--t, var(--accent)); stroke-width: 16; opacity: .3; }
${ROUTES.map((r, i) => `.bz-sky .p${i + 1} { --t: var(--${r.tone}); stroke-dashoffset: ${[40, 70, 25, 55, 85, 12][i] ?? 40}; }`).join(" ")}
/* Light: dawn rather than night: violet stars, a pale sphere with the same lit rim. */
@media (prefers-color-scheme: light) { ${LIGHT_SKY.replace(/\.bz-sky/g, ':root:not([data-theme="dark"]) .bz-sky')} }
${LIGHT_SKY.replace(/\.bz-sky/g, ':root[data-theme="light"] .bz-sky')}
@keyframes bz-drift { from { translate: -34% 0; scale: 1; } to { translate: -24% 4%; scale: 1.08; } }
@keyframes bz-stars { from { transform: translateY(0); } to { transform: translateY(-211px); } }
@keyframes bz-stars2 { from { transform: translateY(0); } to { transform: translateY(-329px); } }
@keyframes bz-twinkle { 0%, 100% { opacity: .45; } 50% { opacity: .18; } }
@keyframes bz-run { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: no-preference) {
  .bz-sky::before { animation: bz-drift 22s ease-in-out infinite alternate; }
  .bz-sky .s1 { animation: bz-stars 160s linear infinite; }
  .bz-sky .s2 { animation: bz-stars2 260s linear infinite, bz-twinkle 7s ease-in-out infinite; }
  ${ROUTES.map((r, i) => `.bz-sky .p${i + 1} { animation: bz-run ${r.s}s cubic-bezier(.45, 0, .25, 1) ${r.delay}s infinite; }`).join("\n  ")}
}
/* A phone: the horizon alone (the routes would cross the words). */
@media (max-width: 760px) { .bz-sky .hz { top: calc(100% - 80px); } .bz-sky .ha { bottom: 80px; height: 360px; } .bz-sky svg.rt { top: calc(100% - 80px); } }
`;
