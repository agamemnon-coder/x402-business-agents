// One shared set of motion for the site (master list 354): the Face ID tick that draws itself in, the shake on a refusal,
// and a count-up on amounts. One module, so every page moves the same way; exported for the approve pages and for /try
// (the try-extras stream uses it there). The rules:
// - Each animation runs 150 to 400 ms and holds nothing up: nothing waits for it.
// - prefers-reduced-motion turns all of it off: the end state shows at once and the script counts nothing.
// - Count-up never changes what a page says: the element's text is the final figure from the start (a reader without
//   script, a screen reader and every test read it). While it counts, that text is see-through and the counting figure
//   is drawn over it from a data attribute (::after), the way /try/sign has done since 7 November.
// - Only the site's tokens: --ok for a tick, --bad for a refusal. No new colour.

/** Class names, so a page writes them once. */
export const MOTION_CLASS = { tick: "mo-tick", shake: "mo-shake", count: "mo-count", rise: "mo-rise" } as const;

/** The CSS: keyframes and the classes that use them, off under prefers-reduced-motion. */
export const MOTION_CSS = `
.mo-tick { color: var(--ok); }
.mo-tick > * { stroke-dasharray: 100; stroke-dashoffset: 0; animation: mo-draw .32s cubic-bezier(.65, 0, .35, 1) both; }
.mo-tick > :last-child { animation-duration: .24s; animation-delay: .16s; }
.mo-shake { animation: mo-shake .34s cubic-bezier(.36, .07, .19, .97) both; }
.mo-rise { animation: mo-rise .3s ease-out both; }
.mo-count { font-variant-numeric: tabular-nums; }
.mo-count.counting { position: relative; -webkit-text-fill-color: transparent; }
.mo-count.counting::after { content: attr(data-count); position: absolute; inset: 0; -webkit-text-fill-color: currentColor; white-space: nowrap; overflow: hidden; }
@keyframes mo-draw { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes mo-shake { 15%, 85% { transform: translateX(-2px); } 30%, 70% { transform: translateX(4px); } 45% { transform: translateX(-4px); } 60% { transform: translateX(3px); } }
@keyframes mo-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .mo-tick > *, .mo-shake, .mo-rise { animation: none !important; }
  .mo-count.counting { -webkit-text-fill-color: currentColor; } .mo-count.counting::after { content: none; }
}`;

/**
 * Site-wide motion (owner, 12 Nov: "more visuals and animations"), in every page's one stylesheet: sections lift into
 * place as they scroll in (a scroll-driven animation: transform only, so nothing is ever hidden or shifted, and a
 * browser without view timelines shows the page as it is); cards lift a little under a pointer; a run that is live has a
 * pulsing dot. All of it is off under prefers-reduced-motion.
 */
export const SITE_MOTION_CSS = `
.live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); margin-right: 6px; vertical-align: middle; position: relative; flex: none; }
.live-dot::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--ok); opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .live-dot::after { animation: mo-pulse 2s ease-out infinite; }
  @media (hover: hover) {
    a.card, .card.lift, .nums .card, .pcard { transition: transform .18s ease-out, box-shadow .18s ease-out; }
    a.card:hover, .card.lift:hover, .nums .card:hover, .pcard:hover { transform: translateY(-2px); box-shadow: 0 6px 18px color-mix(in srgb, var(--text) 10%, transparent); }
  }
  @supports (animation-timeline: view()) {
    main section, main .nums, main .reveal, main details.deep, main ol.tl > li { animation: mo-lift linear both; animation-timeline: view(); animation-range: entry 0% entry 60%; }
  }
}
@keyframes mo-pulse { 0% { transform: scale(1); opacity: .55; } 100% { transform: scale(2.6); opacity: 0; } }
@keyframes mo-lift { from { transform: translateY(18px); } to { transform: none; } }`;

/** The Face ID tick: a circle and a check that draw themselves in (lucide's circle-check paths, stroke only). */
export function faceIdTick(size = 20, label = "Signed with Face ID"): string {
  return `<svg class="mo-tick" role="img" aria-label="${label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" pathLength="100"/><path d="m9 12 2 2 4-4" pathLength="100"/></svg>`;
}

/**
 * The figure a count-up runs to, split as it is written: what comes before it, the number, its decimals, whether it has
 * thousands commas, and what follows. Null when the text holds no number.
 */
export function countParts(text: string): { pre: string; value: number; decimals: number; commas: boolean; post: string } | null {
  const m = /(-?\d{1,3}(?:,\d{3})+|-?\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  const int = m[1]!, dec = m[2] ?? "";
  return { pre: text.slice(0, m.index), value: Number(`${int.replace(/,/g, "")}${dec ? `.${dec}` : ""}`), decimals: dec.length, commas: int.includes(","), post: text.slice(m.index + m[0].length) };
}

/** The text at a fraction p (0 to 1) of the way to the figure, written as the figure is written. */
export function countText(text: string, p: number): string {
  const c = countParts(text);
  if (!c) return text;
  const v = c.value * Math.min(1, Math.max(0, p));
  let s = v.toFixed(c.decimals);
  if (c.commas) { const [i, d] = s.split("."); s = `${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${d === undefined ? "" : `.${d}`}`; }
  return `${c.pre}${s}${c.post}`;
}

/**
 * The script (plain ES5 in a template string: no backticks, no "\${"). It counts up every .mo-count once, when it first
 * comes into view, in 400 ms with an ease-out; under reduced motion, or without IntersectionObserver, it does nothing.
 */
export const MOTION_JS = `(function () {
  if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  var RX = /(-?\\d{1,3}(?:,\\d{3})+|-?\\d+)(?:\\.(\\d+))?/;
  function at(t, p) {
    var m = RX.exec(t); if (!m) return t;
    var dec = m[2] || "", v = Number(m[1].replace(/,/g, "") + (dec ? "." + dec : "")) * p, s = v.toFixed(dec.length);
    if (m[1].indexOf(",") >= 0) { var q = s.split("."); s = q[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",") + (q.length > 1 ? "." + q[1] : ""); }
    return t.slice(0, m.index) + s + t.slice(m.index + m[0].length);
  }
  function run(n) {
    var t = n.textContent, t0 = 0;
    n.classList.add("counting"); n.setAttribute("data-count", at(t, 0));
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / 400);
      n.setAttribute("data-count", at(t, 1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step); else { n.classList.remove("counting"); n.removeAttribute("data-count"); }
    }
    requestAnimationFrame(step);
  }
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); run(e.target); } }); }, { threshold: 0.6 });
  document.querySelectorAll(".mo-count").forEach(function (n) { io.observe(n); });
})();`;

/** A figure that counts up: the final text is the element's text. */
export const countUp = (text: string, escape: (s: string) => string) => `<span class="mo-count">${escape(text)}</span>`;
