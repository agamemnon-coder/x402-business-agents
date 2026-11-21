// Purser Cloud's signed-out screens (sign-in, first run, a passkey's enrolment). 21 Nov, Max, from his mockup: "upgrade
// purser cloud login page to exactly this, only not with all the text left: just Purser Cloud and some small USP, and
// animating". On the left: a large globe of particles, its land as dots, turning slowly; the site's wave at the bottom
// (src/ui/wave.ts); over them the Purser mark, "Purser Cloud", one short line and three small points with icons. On the
// right: the card as glass, with the heading, the company address, the passkey as the one large action, "New company?
// Set it up", then "or" and the guest way. No paragraph. Only the look and two canvases: authentication is unchanged
// (cloud/src/console.ts signInView). Scoped to .signed-out and written in the theme's own variables, light and dark.
// Under prefers-reduced-motion the globe and the wave are drawn once and stand still.

import { waveScript } from "../../src/ui/wave.js";

export const SIGNIN_CSS = `
/* The left panel: a deep ground, the globe and the wave behind the words. */
.signed-out .hero { position: relative; overflow: hidden; isolation: isolate; border-right: 0; align-content: center; justify-items: start;
  background: radial-gradient(70% 60% at 40% 30%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
    radial-gradient(60% 50% at 0% 100%, color-mix(in srgb, var(--accent-ink, var(--accent)) 18%, transparent), transparent 70%), var(--bg); }
.signed-out .hero::before { content: none; }
/* The console's own page-wide wave waits for the signed-in pages: here the panel has its own. */
.signed-out canvas.pw-wave { display: none; }
.signed-out .hero canvas { position: absolute; pointer-events: none; }
/* 21 Nov (Max: "it looks really on each other"): the words keep a clean area. The globe is placed by its script in the
   largest space clear of them, above the wave (its body hides the wave behind it); the wave runs low, under the words. */
.signed-out .hero canvas.si-globe { inset: 0; width: 100%; height: 100%; z-index: -1; }
.signed-out .hero canvas.si-wave { left: 0; right: 0; bottom: 0; width: 100%; height: 28%; z-index: -2;
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 45%); mask-image: linear-gradient(180deg, transparent, #000 45%); }
.signed-out .side { position: relative; display: flex; flex-direction: column; align-items: flex-start; max-width: 520px; margin: 0; padding: 0 0 0 clamp(8px, 3vw, 56px); }
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
@media (min-width: 1024px) { .signed-out .auth { max-width: 520px; } .signed-out .hero { align-content: start; padding-top: 36px; } }
/* Ask Purser floats at the bottom right: signed out it is the round mark only (its words kept for screen readers and in
   its title), and the trust line keeps clear of it (it covered "Works with ..." at 1024 and 390). */
.signed-out #pask-fab { padding: 0 7px; }
.signed-out #pask-fab .pask-t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.signed-out p.trust { padding-left: 76px; padding-right: 76px; }
@media (max-width: 1023px) { .signed-out p.trust { padding-bottom: 76px; } }
@media (max-width: 1023px) {
  .signed-out .hero { padding: 22px 20px; justify-items: start; border-bottom: 1px solid var(--border); }
  .signed-out .side { padding: 0; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
  .signed-out .side .side-mk { width: 46px; height: 46px; margin: 0; border-radius: 14px; } .signed-out .side .side-mk svg { width: 22px; height: 22px; }
  .signed-out .side h2 { font-size: 30px; }
  .signed-out .side > p { flex-basis: 100%; margin: 6px 0 12px; font-size: 16px; }
  .signed-out .side ul { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .signed-out .side li { font-size: 14px; gap: 8px; } .signed-out .side .si { width: 30px; height: 30px; border-radius: 9px; } .signed-out .side .si svg { width: 15px; height: 15px; }
  .signed-out .hero { padding-bottom: 50px; }
  .signed-out .hero canvas.si-wave { height: 46px; }
}
@media (max-width: 640px) {
  .signed-out .hero { padding: 18px 16px 20px; }
  .signed-out .side h2 { font-size: 26px; }
  .signed-out .side > p { display: block; margin: 4px 0 0; font-size: 14.5px; }
  .signed-out .side ul { display: none; }
  .signed-out .hero { padding-bottom: 44px; }
  .signed-out .hero canvas.si-wave { height: 40px; opacity: .8; }
  .signed-out p.trust { padding-left: 16px; padding-right: 16px; }
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
 * The land, roughly (longitude, latitude), for the globe's dotted continents: hand-drawn outlines, coarse on purpose
 * (a picture, not a map); a dot on the sphere is land when it falls inside one of them.
 */
const LAND: number[][][] = [
  // North America
  [[-168, 66], [-162, 70], [-156, 71], [-140, 70], [-128, 70], [-115, 68], [-100, 68], [-95, 72], [-85, 70], [-80, 66], [-75, 62], [-65, 60], [-60, 55], [-56, 52], [-60, 47], [-66, 44], [-70, 42], [-74, 40], [-76, 35], [-81, 31], [-80, 25], [-82, 27], [-84, 30], [-90, 29], [-97, 27], [-97, 22], [-95, 19], [-90, 21], [-87, 21], [-88, 16], [-84, 15], [-83, 10], [-79, 9], [-80, 7], [-85, 10], [-92, 14], [-100, 17], [-105, 20], [-110, 24], [-112, 29], [-115, 31], [-117, 32], [-120, 34], [-124, 40], [-124, 47], [-127, 51], [-133, 56], [-140, 60], [-150, 60], [-158, 57], [-165, 60]],
  // Arctic islands of Canada
  [[-120, 72], [-100, 74], [-85, 74], [-75, 78], [-90, 81], [-110, 78], [-122, 76]],
  // Greenland
  [[-73, 78], [-60, 82], [-35, 83], [-20, 80], [-20, 72], [-30, 68], [-42, 60], [-50, 62], [-55, 68], [-60, 75]],
  // South America
  [[-80, 9], [-75, 11], [-70, 12], [-62, 10], [-55, 6], [-50, 2], [-48, -1], [-40, -3], [-35, -6], [-35, -10], [-39, -15], [-40, -22], [-48, -26], [-53, -34], [-58, -38], [-62, -40], [-65, -45], [-68, -50], [-69, -55], [-73, -53], [-75, -46], [-73, -37], [-71, -30], [-71, -18], [-76, -14], [-81, -6], [-80, -2], [-78, 2], [-77, 7]],
  // Europe
  [[-10, 36], [-9, 43], [-2, 44], [-1, 46], [-5, 48], [2, 51], [5, 53], [8, 54], [8, 57], [10, 58], [5, 59], [5, 62], [12, 66], [18, 70], [26, 71], [31, 70], [40, 67], [44, 68], [50, 68], [60, 69], [60, 55], [50, 47], [40, 46], [37, 45], [30, 45], [28, 41], [26, 40], [23, 38], [20, 40], [19, 42], [13, 45], [16, 41], [16, 38], [12, 38], [10, 44], [7, 44], [3, 43], [0, 39], [-2, 37], [-6, 36]],
  // Great Britain, Ireland, Iceland
  [[-6, 50], [1, 51], [2, 53], [-1, 55], [-2, 58], [-5, 59], [-6, 56], [-5, 54], [-3, 52]],
  [[-10, 52], [-6, 52], [-6, 55], [-8, 55], [-10, 54]],
  [[-24, 64], [-14, 64], [-14, 66], [-22, 67]],
  // Africa, Madagascar
  [[-17, 21], [-16, 28], [-10, 30], [-6, 36], [0, 36], [10, 37], [11, 33], [20, 31], [25, 32], [32, 31], [34, 28], [38, 22], [43, 12], [51, 12], [50, 8], [45, 2], [40, -3], [40, -10], [35, -17], [35, -24], [32, -28], [27, -34], [20, -35], [18, -32], [15, -26], [12, -18], [13, -10], [12, -5], [9, -1], [9, 4], [5, 5], [0, 5], [-5, 5], [-8, 4], [-13, 8], [-17, 13]],
  [[44, -13], [50, -15], [50, -17], [47, -25], [44, -24], [43, -18]],
  // Asia, with Arabia and India
  [[26, 40], [28, 41], [30, 45], [37, 45], [40, 46], [50, 47], [60, 55], [60, 69], [70, 73], [80, 73], [90, 76], [100, 78], [110, 77], [120, 73], [130, 71], [140, 72], [150, 71], [160, 70], [170, 70], [180, 69], [180, 65], [175, 62], [165, 60], [160, 55], [157, 51], [155, 57], [150, 59], [142, 59], [136, 55], [140, 48], [135, 43], [130, 42], [128, 39], [126, 35], [126, 38], [122, 40], [121, 37], [119, 35], [122, 31], [120, 26], [117, 23], [110, 21], [108, 18], [106, 10], [104, 9], [101, 13], [100, 7], [104, 1], [101, 3], [98, 8], [98, 16], [94, 17], [92, 22], [88, 22], [85, 20], [80, 15], [80, 10], [77, 8], [73, 17], [72, 21], [67, 24], [62, 25], [57, 25], [56, 27], [52, 28], [48, 30], [50, 26], [52, 24], [56, 24], [59, 22], [55, 17], [52, 16], [45, 13], [43, 15], [40, 20], [36, 26], [34, 28], [35, 32], [36, 36], [30, 37]],
  // Japan, Sumatra, Borneo, Java, New Guinea, Sri Lanka, the Philippines
  [[130, 31], [132, 34], [135, 34], [140, 35], [141, 38], [142, 42], [145, 44], [141, 45], [140, 41], [136, 37], [133, 35], [130, 33]],
  [[95, 5], [98, 4], [104, -2], [106, -6], [102, -4], [96, 2]],
  [[109, 2], [111, -3], [116, -4], [118, 1], [117, 7], [113, 4]],
  [[105, -6], [114, -7], [114, -8], [106, -7]],
  [[131, -1], [138, -2], [146, -6], [150, -10], [142, -9], [138, -8], [132, -4]],
  [[80, 6], [82, 7], [81, 10], [79, 9]],
  [[120, 18], [122, 18], [124, 13], [126, 7], [122, 7], [121, 13]],
  // Australia, New Zealand
  [[114, -22], [114, -26], [115, -34], [118, -35], [124, -33], [129, -32], [134, -32], [138, -35], [140, -38], [146, -39], [150, -37], [153, -32], [153, -25], [150, -22], [146, -19], [143, -11], [141, -13], [141, -17], [137, -15], [136, -12], [132, -11], [129, -15], [125, -14], [122, -17], [118, -20]],
  [[172, -34], [178, -38], [175, -41], [172, -44], [167, -46], [170, -43], [174, -39]],
  // Antarctica's coast
  [[-180, -72], [-120, -73], [-60, -64], [-40, -78], [0, -70], [60, -67], [120, -66], [180, -72], [180, -90], [-180, -90]],
];

/**
 * Places on the globe, each a small glowing ping with a label (21 Nov, Max). Only places the repository or the owner
 * states: Purser in the Netherlands; Airwallex (its San Francisco office), Anthropic (Claude) and Visa in San Francisco.
 * Moneybird and Alta are left off: the repository states no location for either company. [longitude, latitude, label, green]
 */
const PLACES: readonly (readonly [number, number, string, boolean])[] = [
  [5.3, 52.1, "Purser", true],
  [-122.42, 37.77, "Airwallex · Claude · Visa", false],
];

/**
 * The globe: dots on a sphere (land bright, sea faint), rocking slowly round the Atlantic so both pings stay in view, a
 * glow at its rim. It is placed where the words are not: the largest circle that keeps clear of the panel's text (the
 * mark, the heading, the line and the three points), measured on every resize. 30 frames a second at most, gradients
 * made once per size, paused off screen and in a hidden tab; still under reduced motion or on a device too slow for it.
 */
const GLOBE_JS = `
(function () {
  var c = document.querySelector("canvas.si-globe"); if (!c || !c.getContext || !window.matchMedia) return;
  var g = c.getContext("2d"); if (!g) return;
  var LAND = ${JSON.stringify(LAND)}, PLACES = ${JSON.stringify(PLACES)};
  var boxes = LAND.map(function (p) { var b = [999, 999, -999, -999]; p.forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); }); return b; });
  function inside(p, x, y) { var o = false; for (var i = 0, j = p.length - 1; i < p.length; j = i++) { var a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) o = !o; } return o; }
  function land(lon, lat) { for (var k = 0; k < LAND.length; k++) { var b = boxes[k]; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue; if (inside(LAND[k], lon, lat)) return true; } return false; }
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches, dark = matchMedia("(prefers-color-scheme: dark)");
  var pts = [], W = 0, H = 0, dpr = 1, raf = 0, seen = true, t0 = 0, lastF = 0, emaF = 0, nF = 0, lastD = 0, ink = [180, 168, 255], acc = "#a398ff";
  var cx = 0, cy = 0, R = 0, lite = false, at = null, body = null, rim = null, col = "", sampled = 0;
  function theme() { var cs = getComputedStyle(document.documentElement), a = (cs.getPropertyValue("--accent") || "").trim(); acc = a || acc;
    var m = /^#([0-9a-f]{6})$/i.exec(acc); if (m) { var n = parseInt(m[1], 16); ink = [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    lite = !dark.matches && document.documentElement.getAttribute("data-theme") !== "dark"; if (document.documentElement.getAttribute("data-theme") === "light") lite = true; }
  function sample(n) {
    pts = []; sampled = n; var gold = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < n; i++) { var y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), th = i * gold, x = Math.cos(th) * r, z = Math.sin(th) * r;
      var lat = Math.asin(y) * 180 / Math.PI, lon = Math.atan2(z, x) * 180 / Math.PI, l = land(lon, lat);
      if (l || i % 4 === 0) pts.push([x, y, z, l ? 1 : 0, (i * 9301 + 49297) % 233280 / 233280]); }
  }
  // The largest circle (with its glow) clear of the words: a coarse grid of centres, each as large as its nearest word allows.
  function place() {
    var cr = c.getBoundingClientRect(), side = c.parentElement, rs = [], mg = W >= 700 ? 14 : 6;
    if (side) side.querySelectorAll(".side-mk, .side h2, .side > p, .side li").forEach(function (e) { var r = e.getBoundingClientRect(); if (r.width && r.height) rs.push([r.left - cr.left - mg, r.top - cr.top - mg, r.right - cr.left + mg, r.bottom - cr.top + mg]); });
    var best = [W * 0.7, H * 0.5, 0], gap = W >= 700 ? 10 : 4, k = W >= 700 ? 1.16 : 1.08;
    for (var i = 1; i < 40; i++) for (var j = 1; j < 30; j++) {
      var x = W * i / 40, y = H * j / 30, m = Math.min(x - gap, W - gap - x, y - gap, H - gap - y);
      for (var q = 0; q < rs.length && m > best[2] * k; q++) { var b = rs[q], dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]); m = Math.min(m, Math.sqrt(dx * dx + dy * dy)); }
      var r = Math.min(m / k, W >= 700 ? 280 : 200); if (r + x * 0.004 > best[2] + best[0] * 0.004) best = [x, y, r];
    }
    cx = best[0]; cy = best[1]; R = Math.max(0, best[2]);
  }
  function size() { var r = c.getBoundingClientRect(); dpr = Math.min(1.5, window.devicePixelRatio || 1); W = Math.max(1, r.width); H = Math.max(1, r.height);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); theme(); place();
    var n = Math.max(2500, Math.min(26000, Math.round(4 * Math.PI * R * R / 6))); if (Math.abs(n - sampled) > sampled * 0.15) sample(n);
    col = "rgba(" + ink[0] + "," + ink[1] + "," + ink[2] + ",";
    at = g.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.16); at.addColorStop(0, col + (lite ? ".22)" : ".38)")); at.addColorStop(1, col + "0)");
    body = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R); body.addColorStop(0, lite ? "rgba(255,255,255,.75)" : "rgba(30,26,72,.92)"); body.addColorStop(1, lite ? "rgba(236,232,252,.92)" : "rgba(10,10,28,.96)");
    rim = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R); rim.addColorStop(0, col + (lite ? ".7)" : ".95)")); rim.addColorStop(0.55, col + ".05)"); rim.addColorStop(1, col + ".25)");
    lastD = 0; }
  function frame(now) {
    raf = 0;
    if (lastF && now - lastF < 1000) { var dtF = now - lastF; emaF = emaF ? emaF * 0.9 + dtF * 0.1 : dtF; if (dtF > 400 || (++nF > 12 && emaF > 70)) still = true; } lastF = now;
    if (!still && lastD && now - lastD < 33) { go(); return; } lastD = now;
    if (!t0) t0 = now; var el = still ? 0 : now - t0;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (R < 16) return;
    var wide = R >= 90, rot = -2.85 + 0.5 * Math.sin(el * 0.00009);
    // The atmosphere, then the sphere's body (it covers the wave behind it), the dots, then a lit rim.
    g.fillStyle = at; g.beginPath(); g.arc(cx, cy, R * 1.16, 0, Math.PI * 2); g.fill();
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    var cr = Math.cos(rot), sr = Math.sin(rot), tl = 0.42, ct = Math.cos(tl), st = Math.sin(tl), hi = "rgba(236,232,255,";
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], x = p[0] * cr + p[2] * sr, z0 = -p[0] * sr + p[2] * cr, y = p[1] * ct - z0 * st, z = p[1] * st + z0 * ct;
      if (z <= 0.02) continue;
      var sx = cx - x * R, sy = cy - y * R;
      var lim = 1 - z, a = p[3] ? (lite ? 0.35 + 0.5 * z : 0.4 + 0.6 * z) * (0.75 + 0.25 * p[4]) : (lite ? 0.1 : 0.12) * z;
      a *= 1 + lim * lim * (p[3] ? 0.9 : 1.6);
      var s = p[3] ? (wide ? 0.95 : 0.8) * (0.6 + 0.5 * z) : 0.6;
      g.fillStyle = (p[3] && z > 0.55 && !lite ? hi : col) + (a > 1 ? 1 : a).toFixed(2) + ")";
      g.fillRect(sx - s, sy - s, s * 2, s * 2);
    }
    g.strokeStyle = rim; g.lineWidth = wide ? 2 : 1.4; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    // The pings: pinned to the turning globe, a soft pulse, a small label on a dark plate (none on a very small globe).
    var pulse = still ? 0.5 : (el % 2400) / 2400;
    g.font = "600 " + (R >= 140 ? 12 : 11) + "px Inter, system-ui, sans-serif"; g.textBaseline = "middle"; var placed = [];
    for (var k = 0; k < PLACES.length; k++) {
      var P = PLACES[k], la = P[1] * Math.PI / 180, lo = P[0] * Math.PI / 180, px = Math.cos(lo) * Math.cos(la), py = Math.sin(la), pz = Math.sin(lo) * Math.cos(la);
      var X = px * cr + pz * sr, Z0 = -px * sr + pz * cr, Y = py * ct - Z0 * st, Zf = py * st + Z0 * ct;
      if (Zf <= 0.08) continue;
      var vx = cx - X * R, vy = cy - Y * R, fade = Math.min(1, (Zf - 0.08) / 0.25), rgb = P[3] ? "74,222,128" : (lite ? "109,84,232" : "196,181,253");
      g.globalAlpha = fade * (1 - pulse); g.strokeStyle = "rgba(" + rgb + ",.9)"; g.lineWidth = 1.2; g.beginPath(); g.arc(vx, vy, 3 + pulse * Math.min(11, R * 0.2), 0, Math.PI * 2); g.stroke();
      g.globalAlpha = fade; var glow = 8; g.fillStyle = "rgba(" + rgb + ",.25)"; g.beginPath(); g.arc(vx, vy, glow * 0.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgb(" + rgb + ")"; g.beginPath(); g.arc(vx, vy, 3, 0, Math.PI * 2); g.fill();
      if (R >= 70) {
        // Beside the dot (away from the rim), else below or above it: never on another label.
        var w = g.measureText(P[2]).width + 14, left = vx > cx + R * 0.2, tries = [[left ? vx - 12 - w : vx + 12, vy], [vx - w / 2, vy + 20], [vx - w / 2, vy - 20]], lx = 0, ly = 0;
        for (var u = 0; u < tries.length; u++) { lx = Math.max(4, Math.min(W - w - 4, tries[u][0])); ly = tries[u][1]; var hit = false;
          for (var v = 0; v < placed.length; v++) { var o = placed[v]; if (lx < o[0] + o[2] + 4 && lx + w + 4 > o[0] && Math.abs(ly - o[1]) < 24) hit = true; } if (!hit) break; }
        placed.push([lx, ly, w]); w -= 14;
        g.fillStyle = lite ? "rgba(255,255,255,.85)" : "rgba(12,10,32,.72)"; g.beginPath();
        if (g.roundRect) g.roundRect(lx, ly - 10, w + 14, 20, 10); else g.rect(lx, ly - 10, w + 14, 20); g.fill();
        g.fillStyle = lite ? "#2a2250" : "rgba(240,236,255,.95)"; g.fillText(P[2], lx + 7, ly + 0.5);
      }
      g.globalAlpha = 1;
    }
    if (!still) go();
  }
  function go() { if (!raf && seen && !document.hidden && c.getClientRects().length) raf = requestAnimationFrame(frame); }
  size();
  if (still) { frame(performance.now()); if ("ResizeObserver" in window) new ResizeObserver(function () { size(); frame(performance.now()); }).observe(c); return; }
  go();
  // The fonts change the words' size: place the globe again once they are in.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { size(); go(); });
  if ("ResizeObserver" in window) new ResizeObserver(function () { size(); if (still) frame(performance.now()); else go(); }).observe(c); else addEventListener("resize", function () { size(); go(); });
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; lastF = 0; if (seen) go(); }).observe(c);
  document.addEventListener("visibilitychange", function () { lastF = 0; go(); });
  dark.addEventListener && dark.addEventListener("change", function () { size(); go(); });
})();`;

/** The sign-in's script: the globe and the wave at the bottom of the left panel. */
export const SIGNIN_JS = `${GLOBE_JS}
${waveScript({ selector: "canvas.si-wave", placement: "hero", density: 0.7, intensity: 1.15 })}`;
