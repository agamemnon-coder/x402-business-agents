// Home's hero in the owner's concept (21 Nov: "dark violet premium enterprise fintech"): an obsidian ground with a slow
// wave of violet light points flowing from the bottom left to the top right, three layers at three speeds, that only
// leans aside a little where the pointer is; three figures from the records under the idea; and, on the right, a glass
// card "Workflow" whose four steps light up one after another.
//
// Honesty: the three figures are read from the evidence wall (docs/evidence/evidence-wall.json, each tile's own records
// in data-rec); a figure the wall lacks is left out, never typed in. The Workflow card is a schematic of how a payment
// runs, labelled "Sample flow · sandbox": its lights are an illustration on a loop, no activity, no amount, no time.
//
// Motion: the wave is one Canvas 2D in the page's one hashed script, its pixel ratio that of the screen, capped at 2,, with
// fewer points on a phone, paused off screen (IntersectionObserver) and in a hidden tab; under prefers-reduced-motion
// the canvas is not drawn at all and a still violet gradient stands in. The card's lights are CSS (opacity and
// transform), still and all lit under reduced motion.

import { committedWall, type EvidenceWall } from "./evidenceWall.js";
import { esc, icon } from "./ui.js";

/** The hero's three figures (Max: tests passing, sandbox and testnet runs, policy blocks), each a wall tile by key. */
export const HERO_STATS: readonly { key: string; words: string }[] = [
  { key: "verify-all", words: "verification checks passed" },
  { key: "try-transfers", words: "sandbox transfers on Airwallex" },
  { key: "red-team", words: "attacks stopped before money moved" },
];
export interface HeroStat { value: string; words: string; rec: string }
/** The figures as the wall holds them ("All 48" reads "48"); a tile the wall lacks drops out. */
export function heroStats(w: EvidenceWall | null = committedWall()): HeroStat[] {
  const tiles = new Map((w?.groups ?? []).flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  return HERO_STATS.flatMap((s) => {
    const t = tiles.get(s.key);
    const value = t?.fig.replace(/^All\s+/, "").trim();
    return t && value && /^\d[\d,]*$/.test(value) ? [{ value, words: s.words, rec: t.rec }] : [];
  });
}
export function heroStatsHtml(stats: HeroStat[] = heroStats()): string {
  return stats.length ? `<ul class="hstats">${stats.map((s) => `<li data-rec="${esc(s.rec)}"><b>${esc(s.value)}</b><span>${esc(s.words)}</span></li>`).join("")}</ul>` : "";
}

/** The Workflow card's four steps, in the owner's words. */
export const WORKFLOW_HEAD = "Workflow";
export const WORKFLOW_TAG = "Sample flow · sandbox";
export const WORKFLOW_STEPS: readonly { icon: string; title: string }[] = [
  { icon: "bot", title: "Agent proposes a payment" },
  { icon: "shield-check", title: "Purser checks policy & risk" },
  { icon: "scan-face", title: "CFO authorizes with Face ID" },
  { icon: "landmark", title: "Payment executed via Airwallex" },
];
export function workflowHtml(): string {
  return `<div class="wf" role="group" aria-labelledby="wf-k">
  <div class="wf-head"><p class="wf-k" id="wf-k">${esc(WORKFLOW_HEAD)}</p><span class="wf-tag">${esc(WORKFLOW_TAG)}</span></div>
  <ol class="wf-steps">${WORKFLOW_STEPS.map((s, i) => `<li class="wf-s wf-s${i}"><span class="wf-i">${icon(s.icon, 18)}</span><span class="wf-t"><b>${esc(s.title)}</b></span><span class="wf-ok">${icon("check", 14)}</span></li>`).join("")}</ol>
</div>`;
}

export const HERO_WAVE_HTML = `<canvas class="h-wave" aria-hidden="true"></canvas>`;

const LOOP = 8;
export const HERO_WAVE_CSS = `
/* The hero's ground (src/redesign/heroWave.ts): a still violet light, the wave drawn over it where motion is allowed. */
main.ent section.e-hero { isolation: isolate; }
.e-hero::before { content: ""; position: absolute; inset: 0; z-index: -2; pointer-events: none; background:
  radial-gradient(60% 55% at 78% 30%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%),
  radial-gradient(45% 40% at 18% 92%, color-mix(in srgb, var(--accent-ink) 22%, transparent), transparent 70%),
  radial-gradient(30% 30% at 95% 0%, color-mix(in srgb, #e879f9 14%, transparent), transparent 70%); }
canvas.h-wave { position: absolute; left: 0; top: 0; z-index: -1; width: 100%; height: min(100%, 900px); pointer-events: none;
  -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent), linear-gradient(90deg, rgba(0,0,0,.45), #000 55%); mask-image: linear-gradient(180deg, #000 70%, transparent), linear-gradient(90deg, rgba(0,0,0,.45), #000 55%);
  -webkit-mask-composite: source-in; mask-composite: intersect; }
@media (max-width: 1039px) { canvas.h-wave { height: min(100%, 760px); } }
/* A phone: the wave runs below the words, behind the buttons and the card, never through the figures. */
@media (max-width: 640px) { canvas.h-wave { top: 420px; height: 620px; -webkit-mask-image: linear-gradient(180deg, transparent, #000 22%, #000 70%, transparent); mask-image: linear-gradient(180deg, transparent, #000 22%, #000 70%, transparent); } }
@media (prefers-reduced-motion: reduce) { canvas.h-wave { display: none; } }

/* Three figures from the records. */
ul.hstats { list-style: none; margin: 28px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; max-width: 34em; }
ul.hstats li { display: grid; gap: 4px; align-content: start; padding: 2px 18px; border-left: 1px solid var(--glass-line); }
ul.hstats li:first-child { padding-left: 0; border-left: 0; }
ul.hstats b { font-size: clamp(26px, 2.6vw, 34px); line-height: 1.05; font-weight: 760; letter-spacing: -.03em; font-variant-numeric: tabular-nums; background: var(--grad-text); -webkit-background-clip: text; background-clip: text; color: transparent; }
ul.hstats span { font-size: 13.5px; line-height: 1.35; color: var(--muted); }
@media (max-width: 420px) { ul.hstats li { padding: 2px 10px; } ul.hstats span { font-size: 12.5px; } }

/* The Workflow card: glass, four steps, each lit in turn. */
.wf { position: relative; padding: 22px 22px 18px; border-radius: var(--r-lg); background: var(--glass); border: 1px solid var(--glass-line); box-shadow: var(--hi), 0 40px 90px -40px var(--glow), 0 20px 50px -30px rgba(0, 0, 0, .55); }
.wf::before { content: ""; position: absolute; left: 14%; right: 14%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
@media (min-width: 1040px) { .wf { -webkit-backdrop-filter: blur(16px) saturate(1.3); backdrop-filter: blur(16px) saturate(1.3); } }
.wf-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.wf-k { margin: 0; font: 600 12.5px/1.3 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
.wf-tag { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--glass-line); font-size: 12.5px; font-weight: 600; color: var(--muted); white-space: nowrap; }
ol.wf-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.wf-s { position: relative; display: grid; grid-template-columns: 42px minmax(0, 1fr) 22px; gap: 14px; align-items: center; padding: 14px 16px; border-radius: 16px; border: 1px solid var(--glass-line); background: color-mix(in srgb, var(--surface) 55%, transparent); }
.wf-s + .wf-s::before { content: ""; position: absolute; left: 36px; top: -15px; width: 2px; height: 16px; border-radius: 2px; background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 40%, transparent)); box-shadow: 0 0 10px var(--accent); }
.wf-i { position: relative; width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: #fff; background: var(--grad); box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 8px 22px -8px var(--glow); }
.wf-t { display: grid; gap: 1px; min-width: 0; }
.wf-t b { font-size: 15px; font-weight: 650; letter-spacing: -.01em; line-height: 1.3; }
.wf-t small { font-size: 13px; color: var(--muted); line-height: 1.3; }
.wf-ok { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--ok); }
@media (prefers-reduced-motion: no-preference) {
${[0, 1, 2, 3].map((i) => `  .wf-s${i} .wf-i, .wf-s${i}::before { animation: wf-lit${i} ${LOOP}s ease-in-out infinite; } .wf-s${i} .wf-ok { animation: wf-ok${i} ${LOOP}s ease-in-out infinite; }`).join("\n")}
}
${[0, 1, 2, 3].map((i) => { const a = 6 + i * 20; return `@keyframes wf-lit${i} { 0%, ${a}% { opacity: .35; filter: saturate(.2); } ${a + 6}%, 92% { opacity: 1; filter: none; } 100% { opacity: .35; filter: saturate(.2); } }
@keyframes wf-ok${i} { 0%, ${a + 4}% { opacity: 0; transform: scale(.6); } ${a + 10}%, 92% { opacity: 1; transform: none; } 100% { opacity: 0; transform: scale(.6); } }`; }).join("\n")}
`;

/** The wave: points on three layers along a ribbon that rises from the bottom left to the top right. */
export const HERO_WAVE_JS = `
(function () {
  var c = document.querySelector("canvas.h-wave"), mm = window.matchMedia;
  if (!c || !c.getContext || !mm || mm("(prefers-reduced-motion: reduce)").matches) return;
  var g = c.getContext("2d");
  if (!g) return;
  var host = c.parentElement, W = 0, H = 0, dpr = 1, layers = [], raf = 0, seen = true, t0 = performance.now();
  var mx = -1e4, my = -1e4, px = -1e4, py = -1e4, box = null;
  var darkQ = mm("(prefers-color-scheme: dark)");
  function dark() { var a = document.documentElement.getAttribute("data-theme"); return a ? a === "dark" : darkQ.matches; }
  // The canvas's own scale on screen (a page zoomed for a very wide screen draws it larger), so its pixels stay sharp.
  function scale() { var r = c.getBoundingClientRect(); return c.clientWidth ? r.width / c.clientWidth : 1; }
  function build() {
    W = c.clientWidth; H = c.clientHeight;
    var phone = W < 700, z = scale();
    dpr = Math.min((window.devicePixelRatio || 1) * z, 2 * Math.max(1, z));
    c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr));
    var k = phone ? 0.45 : 1;
    layers = [
      { rows: 16, cols: Math.round(150 * k), amp: 0.06, speed: 0.007, size: 1.1, a: 0.5, ph: 0, z: 0.75, dark: "#8b5cf6", light: "#a78bfa" },
      { rows: 12, cols: Math.round(120 * k), amp: 0.08, speed: 0.012, size: 1.5, a: 0.75, ph: 1.7, z: 0.9, dark: "#c4b5fd", light: "#8b5cf6" },
      { rows: 7, cols: Math.round(90 * k), amp: 0.1, speed: 0.018, size: 2, a: 0.95, ph: 3.1, z: 1, dark: "#f5f3ff", light: "#6d28d9" }
    ];
  }
  function frame(now) {
    raf = 0;
    var t = (now - t0) / 1000, d = dark();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = d ? "lighter" : "source-over";
    px += (mx - px) * 0.08; py += (my - py) * 0.08;
    for (var l = 0; l < layers.length; l++) {
      var L = layers[l];
      g.fillStyle = d ? L.dark : L.light;
      for (var r = 0; r < L.rows; r++) {
        var v = r / (L.rows - 1) - 0.5;
        for (var i = 0; i < L.cols; i++) {
          var u = (i / L.cols + t * L.speed + r * 0.013) % 1;
          var X = (-0.08 + u * 1.16) * W;
          var Y = H * (1.02 - 0.8 * u) + H * L.amp * (Math.sin(u * 6.2 + t * 0.45 + L.ph) + 0.3 * Math.sin(u * 13 - t * 0.3 + L.ph))
            + v * H * 0.3 * L.z * (0.5 + 0.5 * Math.sin(u * 4.1 + t * 0.28 + L.ph)) * Math.cos(u * 3 + t * 0.35 + r * 0.15);
          var dx = X - px, dy = Y - py, dd = dx * dx + dy * dy;
          if (dd < 19600) { var q = Math.sqrt(dd) + 1, f = 1 - q / 140; f = f * f * 12 * L.z; X += dx / q * f; Y += dy / q * f; }
          var a = L.a * Math.min(1, u * 6, (1 - u) * 6) * (0.35 + 0.65 * Math.abs(Math.sin(u * 14 - t * 0.9 + r * 1.3 + L.ph))) * (1 - Math.abs(v) * 1.2) * (d ? 1 : 0.7);
          if (a < 0.03) continue;
          g.globalAlpha = a;
          g.fillRect(X, Y, L.size, L.size);
        }
      }
    }
    g.globalAlpha = 1;
    go();
  }
  function go() { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  build(); go();
  if ("ResizeObserver" in window) new ResizeObserver(function () { build(); }).observe(c); else addEventListener("resize", build);
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; if (seen) go(); else stop(); }).observe(c);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else go(); });
  if (mm("(hover: hover) and (pointer: fine)").matches && host) {
    host.addEventListener("pointerenter", function () { box = c.getBoundingClientRect(); });
    host.addEventListener("pointermove", function (e) { if (!box) box = c.getBoundingClientRect(); var z = box.width / (c.clientWidth || 1) || 1; mx = (e.clientX - box.left) / z; my = (e.clientY - box.top) / z; if (px < -1e3) { px = mx; py = my; } }, { passive: true });
    host.addEventListener("pointerleave", function () { mx = -1e4; my = -1e4; px = -1e4; py = -1e4; });
    addEventListener("scroll", function () { box = null; }, { passive: true });
  }
})();`;
