// The judge tour (Max, 21 Nov: "Purser Cloud and the demo are disconnected. We need a nice guide, e.g. a judge tour on
// the homepage where you really go from tab to tab: exactly what we want to show them"). Seven stops in one order: the
// film, the hands-on demo, Purser Cloud as a guest, then the site's own pages for Alta, Visa, T:0 and the proof.
//
// How it moves: "Start the judge tour" (Home's first button) opens Home with ?tour=1. While a tour runs, the stop's number
// is kept in sessionStorage (this tab only), and a small bar sits at the foot of every page of the tour: "Judge tour ·
// 3 of 7", the stop's name, one sentence on what to look at, Back and Next, and a close button that ends it. A stop on
// the site (Alta, Visa, T:0, Proof) is its page; a stop elsewhere (the film on YouTube, /try, which Purser Cloud serves,
// and the console) opens in a new tab from Home's tour map, so this tab keeps the bar. Without a tour nothing shows and
// every page is as it was; without script the map's stops are plain links.

// Imports leaf modules only: src/redesign/ui.ts's page() puts the bar on the tour's pages, so this file cannot import it.
import { FILM_URL } from "../config/brand.js";
import { PURSER_CLOUD_URL, type PageKey } from "../ui/more.js";
import { ICONS, type Icon } from "../ui/icons.js";

/** The hands-on demo at the site's own /try (src/redesign/ui.ts TRY_URL; test/judge-tour.test.ts holds the two equal). */
const TRY_URL = "/try";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Lucide icons (src/ui/icons.ts), and three more in the same style, drawn as ui.ts icon() draws them. */
const MORE_ICONS: Record<string, Icon> = {
  route: [["circle", { cx: "6", cy: "19", r: "3" }], ["path", { d: "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" }], ["circle", { cx: "18", cy: "5", r: "3" }]],
  "arrow-left": [["path", { d: "m12 19-7-7 7-7" }], ["path", { d: "M19 12H5" }]],
  x: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
};
export function tourIcon(name: string, size = 20): string {
  const shapes = ICONS[name] ?? MORE_ICONS[name];
  if (!shapes) throw new Error(`no icon ${name}`);
  return `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes.map(([t, a]) => `<${t} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("")}</svg>`;
}
const icon = tourIcon;

export interface TourStop {
  /** The stop's name on the map and in the bar. */ title: string;
  /** Under the name on the map: a few words. */ sub: string;
  /** In the bar: what to look at there, one sentence. */ look: string;
  icon: string;
  /** A page of the site (its path, relative) or, for a stop elsewhere, the address it opens in a new tab. */
  href: string; external?: boolean;
  /** The site's page key, for a stop on the site: the bar shows on that page. */ key?: PageKey;
}

/** Purser Cloud's console as a guest: the demo company, read only, no sign-up (cloud/src/console.ts #/guest). */
export const TOUR_CLOUD_URL = `${PURSER_CLOUD_URL}#/guest`;
export const TOUR_STOPS: readonly TourStop[] = [
  { title: "Watch the demo", sub: "3:15, on YouTube", look: "The whole loop in three minutes: agents propose, the CFO signs, the rails enforce.", icon: "play", href: FILM_URL, external: true },
  { title: "Try it", sub: "Your own test company", look: "Approve a payment with a passkey, then change one cent and see the signature break.", icon: "zap", href: TRY_URL, external: true },
  { title: "Purser Cloud", sub: "The console, as a guest", look: "The product a company runs: invoices, agents, approvals and connections, read only.", icon: "layout-dashboard", href: TOUR_CLOUD_URL, external: true },
  { title: "Agents on Alta", sub: "Mandates on chain", look: "Each agent pays over x402 under its own mandate; over its cap, Alta refuses on chain.", icon: "link-2", href: "alta", key: "metal" },
  { title: "Cards via Visa", sub: "One credential, one purchase", look: "Visa Intelligent Commerce through Airwallex Airi (sandbox): a reused credential is refused.", icon: "credit-card", href: "visa", key: "visa" },
  { title: "Books on T:0", sub: "A real ledger, read back", look: "The balance sheet, T:0 booking each payment, and the one-cent demo.", icon: "database", href: "books", key: "books" },
  { title: "Proof", sub: "Every run, with its record", look: "Every figure on the site, each one tap from the run record it is read from.", icon: "file-check", href: "proof", key: "proof" },
];
export const TOUR_LABEL = "Judge tour";
export const TOUR_ID = "tour";
/** The pages that carry the bar: Home (the map) and each stop on the site. */
export const TOUR_PAGES: ReadonlySet<PageKey> = new Set<PageKey>(["home", ...TOUR_STOPS.flatMap((s) => (s.key ? [s.key] : []))]);
/** Where the tour starts: Home, stop 1, at the map. */
export const TOUR_START_HREF = `home?${TOUR_ID}=1#${TOUR_ID}`;

/** Home's tour map: the seven stops in order, each a link (a new tab for a stop elsewhere), with ?tour=<n> on the site's own. */
export function tourMapHtml(): string {
  const stop = (s: TourStop, i: number) => {
    const href = s.external ? s.href : `${s.href}?${TOUR_ID}=${i + 1}`;
    return `<li data-stop="${i + 1}"><a href="${esc(href)}"${s.external ? ' target="_blank" rel="noopener"' : ""}><span class="tm-n"><span class="tm-i">${icon(s.icon, 18)}</span><em>${i + 1}</em></span><span class="tm-t"><b>${esc(s.title)}</b><small>${esc(s.sub)}</small></span>${icon(s.external ? "external-link" : "arrow-right", 16)}</a></li>`;
  };
  return `<ol class="tmap">${TOUR_STOPS.map(stop).join("")}</ol>`;
}

export const TOUR_MAP_CSS = `
/* The tour map: seven stops on one rail; the one the tour is at is marked, the ones behind it ticked. */
ol.tmap { list-style: none; margin: 40px 0 0; padding: 0; display: grid; gap: 10px; counter-reset: tm; }
@media (min-width: 720px) { ol.tmap { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } }
@media (min-width: 1100px) { ol.tmap { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0; position: relative; } ol.tmap::before { content: ""; position: absolute; left: 7%; right: 7%; top: 39px; height: 2px; background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 20%, var(--border))); border-radius: 2px; } }
ol.tmap a { position: relative; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 14px; min-height: 72px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); color: var(--text); text-decoration: none; transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease; }
ol.tmap a > .i { color: var(--faint); }
ol.tmap a:hover, ol.tmap a:focus-visible { border-color: var(--accent); box-shadow: 0 10px 28px -18px rgba(79, 70, 229, .55); }
ol.tmap .tm-n { position: relative; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
ol.tmap .tm-n em { position: absolute; right: -6px; top: -6px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; display: grid; place-items: center; background: var(--text); color: var(--bg); font: 700 11.5px/1 Inter, system-ui, sans-serif; font-style: normal; }
ol.tmap b { display: block; font-size: 16px; font-weight: 720; letter-spacing: -.01em; }
ol.tmap small { display: block; margin-top: 2px; font-size: 13.5px; line-height: 1.35; color: var(--muted); }
@media (min-width: 1100px) {
  ol.tmap a { grid-template-columns: 1fr; justify-items: center; text-align: center; gap: 12px; padding: 16px 8px 18px; margin: 0 5px; border-color: transparent; background: transparent; min-height: 0; }
  ol.tmap a > .i { display: none; }
  ol.tmap .tm-n { width: 52px; height: 52px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); box-shadow: 0 6px 18px -12px rgba(16, 24, 40, .35); }
  ol.tmap a:hover, ol.tmap a:focus-visible { background: var(--surface); }
  ol.tmap b { font-size: 15px; }
}
ol.tmap li.on a { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 14px 32px -18px rgba(79, 70, 229, .6); background: var(--surface); }
ol.tmap li.on .tm-n { background: var(--accent); color: var(--surface); border-color: var(--accent); }
ol.tmap li.done .tm-n { background: color-mix(in srgb, var(--ok) 14%, var(--surface)); color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
@media (prefers-reduced-motion: no-preference) {
  ol.tmap a:hover { transform: translateY(-2px); }
  ol.tmap li.on .tm-n { animation: tm-pulse 2.4s ease-in-out infinite; }
}
@keyframes tm-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(79, 70, 229, .45); } 50% { box-shadow: 0 0 0 8px rgba(79, 70, 229, 0); } }
`;

/** The bar's style: on every page of the tour, shown only while a tour runs (html.touring). */
export const TOUR_CSS = `
/* The judge tour's bar (src/redesign/tour.ts): fixed at the foot, only while a tour runs. */
aside.tbar { position: fixed; z-index: 50; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(820px, calc(100% - 24px)); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px 18px; padding: 14px 14px 14px 18px; border-radius: 18px; background: var(--surface); color: var(--text); border: 1px solid var(--border); box-shadow: 0 2px 4px rgba(16, 24, 40, .06), 0 24px 48px -16px rgba(16, 24, 40, .35); font: 400 15px/1.4 Inter, system-ui, sans-serif; }
aside.tbar[hidden] { display: none; }
html.touring body { padding-bottom: 132px; }
aside.tbar .tb-prog { position: absolute; left: 18px; right: 18px; top: 0; height: 3px; display: grid; grid-auto-flow: column; gap: 4px; transform: translateY(-1px); }
aside.tbar .tb-prog i { border-radius: 3px; background: var(--border); }
aside.tbar .tb-prog i.on { background: var(--accent); }
aside.tbar .tb-k { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
aside.tbar .tb-k .i { flex: none; }
aside.tbar .tb-k span { color: var(--faint); letter-spacing: .02em; }
aside.tbar .tb-t { margin: 4px 0 0; font-size: 17px; font-weight: 740; letter-spacing: -.01em; }
aside.tbar .tb-l { margin: 2px 0 0; color: var(--muted); font-size: 14.5px; }
aside.tbar .tb-b { display: flex; align-items: center; gap: 8px; }
aside.tbar .tb-b a, aside.tbar .tb-b button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; min-width: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 650 15px/1 Inter, system-ui, sans-serif; text-decoration: none; cursor: pointer; white-space: nowrap; }
aside.tbar .tb-b .tb-next { background: var(--text); color: var(--bg); border-color: var(--text); }
aside.tbar .tb-b .tb-open { background: var(--accent); border-color: var(--accent); color: var(--surface); }
aside.tbar .tb-b .tb-x { padding: 0; border-color: transparent; color: var(--faint); }
aside.tbar .tb-b a:hover, aside.tbar .tb-b button:hover { border-color: var(--text); }
aside.tbar .tb-b .tb-x:hover { color: var(--text); border-color: transparent; }
aside.tbar :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
@media (max-width: 640px) {
  aside.tbar { bottom: 8px; width: calc(100% - 16px); grid-template-columns: 1fr; padding: 14px 12px 12px 14px; gap: 10px; }
  aside.tbar .tb-t { font-size: 16px; } aside.tbar .tb-l { font-size: 14px; }
  aside.tbar .tb-b > a, aside.tbar .tb-b > button:not(.tb-x) { flex: 1 1 0; padding: 0 10px; }
  aside.tbar .tb-b .tb-x { position: absolute; top: 6px; right: 4px; }
  aside.tbar .tb-txt { padding-right: 36px; }
  html.touring body { padding-bottom: 196px; }
}
@media (prefers-reduced-motion: no-preference) { aside.tbar:not([hidden]) { animation: tb-in .45s cubic-bezier(.2, .7, .2, 1) both; } }
@keyframes tb-in { from { opacity: 0; transform: translate(-50%, 16px); } to { opacity: 1; transform: translate(-50%, 0); } }
`;

/**
 * The bar's script: the stops as data (built here, from TOUR_STOPS), the stop from ?tour=<n> or this tab's
 * sessionStorage, the bar built with createElement and textContent (only the icons, drawn here at build time, are markup),
 * Back and Next as links.
 */
export function tourJs(): string {
  const stops = TOUR_STOPS.map((s) => ({ t: s.title, l: s.look, h: s.href, x: !!s.external }));
  const icons = { map: icon("route", 16), back: icon("arrow-left", 16), next: icon("arrow-right", 16), open: icon("external-link", 16), x: icon("x", 18) };
  return `
(function () {
  var S = ${JSON.stringify(stops).replace(/</g, "\\u003c")}, I = ${JSON.stringify(icons).replace(/</g, "\\u003c")}, K = "purser.tour", ID = ${JSON.stringify(TOUR_ID)};
  function store(v) { try { if (v) sessionStorage.setItem(K, String(v)); else sessionStorage.removeItem(K); } catch (e) {} }
  function stored() { try { return +(sessionStorage.getItem(K) || 0); } catch (e) { return 0; } }
  // A stop's address: a page of the site with ?tour=n; a stop elsewhere is shown on Home, at the map.
  function to(i) { var s = S[i - 1]; return (s.x ? "home" : s.h) + "?" + ID + "=" + i + (s.x ? "#" + ID : ""); }
  // Home's first button starts the tour at stop 1 (its link does the same without script).
  [].forEach.call(document.querySelectorAll("a[data-tour-start]"), function (a) { a.addEventListener("click", function () { store(1); }); });
  var m = new RegExp("[?&]" + ID + "=(\\\\d+)").exec(location.search);
  var n = m ? +m[1] : stored();
  if (!(n >= 1 && n <= S.length)) { if (m) store(0); return; }
  store(n);
  function svg(markup) { var t = document.createElement("template"); t.innerHTML = markup; return t.content.firstChild; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function link(cls, href, text, ic, after) { var a = el("a", cls); a.href = href; if (ic && !after) a.appendChild(svg(ic)); a.appendChild(document.createTextNode(text)); if (ic && after) a.appendChild(svg(ic)); return a; }
  var s = S[n - 1];
  var bar = el("aside", "tbar"); bar.setAttribute("aria-label", ${JSON.stringify(TOUR_LABEL)});
  var prog = el("div", "tb-prog"); prog.setAttribute("aria-hidden", "true");
  for (var k = 1; k <= S.length; k++) prog.appendChild(el("i", k <= n ? "on" : ""));
  var txt = el("div", "tb-txt"), key = el("p", "tb-k");
  key.appendChild(svg(I.map)); key.appendChild(document.createTextNode(${JSON.stringify(TOUR_LABEL)} + " ")); key.appendChild(el("span", "", n + " of " + S.length));
  txt.appendChild(key); txt.appendChild(el("p", "tb-t", s.t)); txt.appendChild(el("p", "tb-l", s.l));
  var b = el("div", "tb-b");
  var x = el("button", "tb-x"); x.type = "button"; x.setAttribute("aria-label", "End the tour"); x.appendChild(svg(I.x));
  x.addEventListener("click", function () { store(0); bar.hidden = true; document.documentElement.classList.remove("touring"); try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {} });
  b.appendChild(x);
  if (n > 1) b.appendChild(link("tb-back", to(n - 1), "Back", I.back));
  if (s.x) { var o = link("tb-open", s.h, "Open", I.open, true); o.target = "_blank"; o.rel = "noopener"; b.appendChild(o); }
  if (n < S.length) b.appendChild(link("tb-next", to(n + 1), "Next", I.next, true));
  else { var f = el("button", "tb-next", "Finish"); f.type = "button"; f.addEventListener("click", function () { x.click(); }); b.appendChild(f); }
  if (s.x && n < S.length) b.querySelector(".tb-next").classList.remove("tb-next");
  bar.appendChild(prog); bar.appendChild(txt); bar.appendChild(b);
  document.body.appendChild(bar);
  document.documentElement.classList.add("touring");
  // On Home's map: the stop the tour is at, and the ones behind it.
  [].forEach.call(document.querySelectorAll("ol.tmap li[data-stop]"), function (li) { var i = +li.getAttribute("data-stop"); if (i === n) li.classList.add("on"); else if (i < n) li.classList.add("done"); });
})();`;
}
