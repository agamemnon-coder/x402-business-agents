// A row of figures with icons that count up once they scroll into view (the owner, 12 Nov: "turn numbers into count-up
// stats and icons"). Every figure is passed in by its page, read from a record; the HTML holds the final value, so
// without script, or with reduced motion, the figure simply stands. No style attributes (hash-based CSP).

import { esc, icon } from "./ui.js";

export interface Stat {
  /** The figure itself. */
  n: number;
  /** Decimals shown (an amount: 2). */
  dec?: number;
  /** Text before and after the figure ("EUR ", " of 5"). */
  pre?: string;
  suf?: string;
  /** A few words under it. */
  label: string;
  icon: string;
  /** "ok", "bad" or nothing: the colour of the icon. */
  tone?: "ok" | "bad";
}

const fmt = (n: number, dec = 0) => n.toLocaleString("en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec });

export function statsHtml(stats: Stat[]): string {
  return `<ul class="stats">${stats.map((s) => `<li${s.tone ? ` class="${s.tone}"` : ""}><span class="st-ic">${icon(s.icon, 20)}</span><b>${esc(s.pre ?? "")}<span data-count="${s.n}" data-dec="${s.dec ?? 0}">${esc(fmt(s.n, s.dec))}</span>${esc(s.suf ?? "")}</b><small>${esc(s.label)}</small></li>`).join("")}</ul>`;
}

export const STATS_CSS = `
ul.stats { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
@media (max-width: 420px) { ul.stats { grid-template-columns: 1fr; } }
ul.stats li { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; align-items: center; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
ul.stats .st-ic { grid-row: 1 / span 2; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
ul.stats li.ok .st-ic { background: var(--ok-soft); color: var(--ok); } ul.stats li.bad .st-ic { background: var(--bad-soft); color: var(--bad); }
@media (max-width: 520px) { ul.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } ul.stats li:last-child:nth-child(odd) { grid-column: 1 / -1; } }
ul.stats b { white-space: nowrap; font-size: 24px; line-height: 1.15; font-weight: 750; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
ul.stats small { font-size: 13.5px; line-height: 1.3; color: var(--muted); }
`;

/**
 * Counts a [data-count] up from 0 as it comes into view, and only then (jury, 13 Nov: the final value is in the HTML and
 * stays there for a reader who has not scrolled, a screenshot, a crawler, or no script). Only a figure still below the
 * screen once the reader scrolls takes part, and it is set to 0 the moment its first pixel shows; nothing moves with
 * reduced motion.
 */
export const COUNT_JS = `
(function () {
  var els = [].slice.call(document.querySelectorAll("[data-count]"));
  if (!els.length || !("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  function fmt(n, d) { return n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      var el = e.target, to = Number(el.getAttribute("data-count")), d = Number(el.getAttribute("data-dec")) || 0, t0 = performance.now(), ms = 900;
      (function tick(t) { var k = Math.min(1, (t - t0) / ms), v = to * (1 - Math.pow(1 - k, 3)); el.textContent = fmt(k < 1 ? v : to, d); if (k < 1) requestAnimationFrame(tick); })(t0);
    });
  }, { threshold: 0 });
  function arm() {
    removeEventListener("scroll", arm);
    els.forEach(function (el) { if (el.getBoundingClientRect().top > innerHeight) io.observe(el); });
  }
  addEventListener("scroll", arm, { passive: true });
})();
`;
