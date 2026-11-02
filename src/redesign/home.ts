// Home (mega-prompt v4, C2; Max's concept artifact of 2 Nov): a four-word headline, the badges, and ONE continuous
// animation of about 26 seconds in four scenes, all from the recorded run (src/redesign/run.ts homeFilm):
//   1. the supplier's price rise, refused on chain (with its tx);  2. Treasury replans, Face ID 1 of 2 → 2 of 2;
//   3. the dispute: every order checked, the wrong ones refunded;  4. the sweep, the licence paid by SWIFT after Face ID,
//      and the TAP run's card buy (Visa TAP as text).
// One subtitle line per scene, the Claude call behind its decision (D2), scene buttons and pause. SVG and CSS only, no
// library; two drawings of the same scene (wide and phone), so text stays at least 14 px; prefers-reduced-motion shows
// each scene's end state, still. Then three buttons. About 60 words besides the header and footer.

import { HOME_BADGE, VISA_AWARD_ON, VISA_AWARD_STATUS } from "../config/brand.js";
import { agentRun, callBadge, callTip, homeFilm, type AgentRun, type HomeFilm } from "./run.js";
import { HEADLINE, esc, icon, page } from "./ui.js";

/** The animation's clock: the loop and where each scene starts, in seconds (Max's concept). */
export const LOOP = 26;
export const STARTS = [0, 8, 13, 19];

/** Where everything sits, in the drawing's own units: one layout for wide screens and one for phones. */
interface Box { x: number; y: number; w: number; h: number }
export interface Layout {
  w: number; h: number; r: number; agents: [number, number][];
  metal: { x1: number; x2: number; y: number; ly: number }; awx: { x1: number; x2: number; y: number; ly: number };
  supplier: Box; licence: Box; gate: { x: number; y1: number; y2: number; ty: number }; refused: Box;
  tiles: { x: number; y: number; dx: number; dy: number; w: number; h: number; ly: number }; bubble: Box; tap: Box; sweepX: number; awxLabel?: string;
  phone: Box & { ring: [number, number]; t1: [number, number]; t2: [number, number]; anchor: "middle" | "start" };
}
export const WIDE: Layout = {
  w: 1000, h: 440, r: 28, agents: [[78, 96], [78, 216], [78, 336]],
  metal: { x1: 176, x2: 742, y: 152, ly: 118 }, awx: { x1: 176, x2: 742, y: 322, ly: 288 },
  supplier: { x: 756, y: 112, w: 120, h: 80 }, licence: { x: 756, y: 282, w: 120, h: 80 },
  gate: { x: 540, y1: 128, y2: 176, ty: 204 }, refused: { x: 440, y: 58, w: 200, h: 36 },
  tiles: { x: 300, y: 36, dx: 46, dy: 32, w: 38, h: 24, ly: 24 }, bubble: { x: 140, y: 380, w: 280, h: 40 }, tap: { x: 500, y: 350, w: 240, h: 36 }, sweepX: 700,
  phone: { x: 886, y: 132, w: 108, h: 196, ring: [940, 200], t1: [940, 256], t2: [940, 282], anchor: "middle" },
};
export const PHONE: Layout = {
  w: 360, h: 540, r: 24, agents: [[60, 34], [180, 34], [300, 34]],
  metal: { x1: 16, x2: 244, y: 170, ly: 138 }, awx: { x1: 16, x2: 244, y: 378, ly: 346 },
  supplier: { x: 254, y: 134, w: 98, h: 72 }, licence: { x: 254, y: 342, w: 98, h: 72 },
  gate: { x: 170, y1: 150, y2: 190, ty: 210 }, refused: { x: 40, y: 222, w: 190, h: 34 },
  tiles: { x: 26, y: 248, dx: 50, dy: 34, w: 42, h: 26, ly: 238 }, bubble: { x: 16, y: 270, w: 228, h: 36 }, tap: { x: 30, y: 394, w: 214, h: 32 }, sweepX: 222, awxLabel: "Airwallex · FX · SWIFT",
  phone: { x: 16, y: 444, w: 328, h: 84, ring: [56, 486], t1: [92, 478], t2: [92, 504], anchor: "start" },
};

const AG = ["sourcing", "support", "treasury"] as const;
const inner = (svg: string) => svg.replace(/^<svg[^>]*>|<\/svg>$/g, "");

/** One drawing of the stage; the script animates whichever is shown. Text from the record only. */
function drawing(run: AgentRun, f: HomeFilm, L: Layout, cls: string): string {
  const t = (x: number, y: number, s: string, c: string, a = "middle") => `<text x="${x}" y="${y}" text-anchor="${a}" class="${c}">${esc(s)}</text>`;
  const rect = (b: Box, c: string, rx = 14) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${rx}" class="${c}"/>`;
  const agents = AG.map((id, i) => {
    const a = run.agents.find((x) => x.id === id)!;
    const [x, y] = L.agents[i]!;
    return `<g class="ag" data-agent="${id}"><circle cx="${x}" cy="${y}" r="${L.r}" class="av-${id}"/><svg x="${x - 12}" y="${y - 12}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="glyph">${inner(icon(id === "sourcing" ? "package" : id === "support" ? "headphones" : "landmark", 24))}</svg>${t(x, y + L.r + 20, a.short, "lbl")}${t(x, y + L.r + 39, a.family, "fam")}</g>`;
  }).join("");
  const tx = (i: number) => L.tiles.x + (i % 6) * L.tiles.dx, ty = (i: number) => L.tiles.y + Math.floor(i / 6) * L.tiles.dy;
  const tiles = f.orders.map((o, i) => `<g class="tile"${f.refunded.includes(o) ? ' data-wrong="1"' : ""}>${rect({ x: tx(i), y: ty(i), w: L.tiles.w, h: L.tiles.h }, "tl", 6)}${t(tx(i) + L.tiles.w / 2, ty(i) + L.tiles.h / 2 + 5, `#${o}`, "tn")}</g>`).join("");
  const P = L.phone;
  return `<svg class="film-svg ${cls}" viewBox="0 0 ${L.w} ${L.h}" role="img" aria-label="${esc(`The four moments of ${run.name}, replayed from its record`)}" data-l='${JSON.stringify(L)}'>
<line x1="${L.metal.x1}" y1="${L.metal.y}" x2="${L.metal.x2}" y2="${L.metal.y}" class="rail metal"/>${t(L.metal.x1, L.metal.ly, "Metal · per query · on chain", "rl metal", "start")}
<line x1="${L.awx.x1}" y1="${L.awx.y}" x2="${L.awx.x2}" y2="${L.awx.y}" class="rail awx"/>${t(L.awx.x1, L.awx.ly, L.awxLabel ?? "Airwallex · cards · FX · SWIFT", "rl awx", "start")}
${agents}
<g class="box">${rect(L.supplier, "bx")}${t(L.supplier.x + L.supplier.w / 2, L.supplier.y + 28, f.supplier, "lbl")}<text x="${L.supplier.x + L.supplier.w / 2}" y="${L.supplier.y + 60}" text-anchor="middle" class="num price">${esc(f.old)}</text></g>
<g class="box">${rect(L.licence, "bx")}${t(L.licence.x + L.licence.w / 2, L.licence.y + 28, "Licence", "lbl")}<text x="${L.licence.x + L.licence.w / 2}" y="${L.licence.y + 60}" text-anchor="middle" class="num eur">${esc(f.licence)}</text></g>
<g class="gate"><line x1="${L.gate.x}" y1="${L.gate.y1}" x2="${L.gate.x}" y2="${L.gate.y2}" class="gl"/><text x="${L.gate.x}" y="${L.gate.ty}" text-anchor="middle" class="gt" data-a="${esc(`cap ${f.cap}`)}" data-b="${esc(`cap ${f.newCap} · new mandate`)}">${esc(`cap ${f.cap}`)}</text></g>
<a class="refused" href="${esc(f.refusedTx.href ?? "proof#metal")}" target="_blank" rel="noopener" aria-label="Refused on chain: the transaction on Metal's testnet explorer">${rect(L.refused, "rf", L.refused.h / 2)}${t(L.refused.x + L.refused.w / 2, L.refused.y + L.refused.h / 2 + 5, "Refused on chain ↗", "rft")}</a>
<g class="tiles">${t(L.tiles.x, L.tiles.ly, `${f.orders.length} orders disputed`, "lbl", "start")}${tiles}</g>
<g class="bubble">${rect(L.bubble, "bb", 12)}${t(L.bubble.x + L.bubble.w / 2, L.bubble.y + L.bubble.h / 2 + 5, "Treasury replans the limits", "bt")}</g>
${f.tapAmount ? `<g class="tap">${rect(L.tap, "tp", L.tap.h / 2)}${t(L.tap.x + L.tap.w / 2, L.tap.y + L.tap.h / 2 + 5, `Visa TAP ✓ ${f.tapAmount} · TAP run`, "tpt")}</g>` : ""}
<g class="phone">${rect(P, "ph", 18)}<circle cx="${P.ring[0]}" cy="${P.ring[1]}" r="20" class="ring"/><svg x="${P.ring[0] - 11}" y="${P.ring[1] - 11}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="fid">${inner(icon("scan-face", 22))}</svg>${t(P.t1[0], P.t1[1], "CFO", "pt1", P.anchor)}${t(P.t2[0], P.t2[1], "Face ID", "pt2", P.anchor)}</g>
<g class="coins"></g>
</svg>`;
}

const CSS = `.hero { padding: 20px 0 36px; }
.hero .wrap { max-width: 1000px; display: grid; gap: 14px; }
@media (min-width: 980px) { .hero { padding: 30px 0 52px; } }
.badges { display: flex; flex-wrap: wrap; gap: 8px; }
.badge { display: inline-flex; align-items: center; gap: 6px; font: 650 14px/1.35 Inter, system-ui, sans-serif; padding: 5px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--text); }
.badge.tap { white-space: nowrap; }
.award-note { margin: 0; font-size: 14px; color: var(--muted); max-width: 60em; }
.h-hero { font-size: clamp(40px, 6.4vw, 72px); font-weight: 800; letter-spacing: -.035em; line-height: 1; }
.h-hero span { color: var(--metal); }
.film { padding: 0; overflow: hidden; }
.film-svg { display: block; width: 100%; height: auto; }
.film-svg.phone-l { display: none; max-width: 520px; margin: 0 auto; }
@media (max-width: 979px) { .film-svg.wide-l { display: none; } .film-svg.phone-l { display: block; } }
.film text { font-family: Inter, system-ui, sans-serif; font-size: 16px; fill: var(--text); }
.film .phone-l text { font-size: 14px; }
.film .lbl { fill: var(--muted); font-weight: 600; } .film .fam { fill: var(--claude); font-weight: 650; }
.film .rl { font-weight: 700; } .film .rl.metal { fill: var(--metal); } .film .rl.awx { fill: var(--awx); }
.film .rail { stroke-width: 10; stroke-linecap: round; opacity: .28; } .film .rail.metal { stroke: var(--metal); } .film .rail.awx { stroke: var(--awx); }
.film .av-sourcing { fill: var(--a-sourcing); } .film .av-support { fill: var(--a-support); } .film .av-treasury { fill: var(--a-treasury); }
.film .glyph { color: #fff; }
.film .ag { transition: opacity .3s; } .film .ag.dim { opacity: .4; }
.film .ag.on circle { stroke: var(--text); stroke-width: 3; }
.film .bx { fill: var(--sunken); stroke: var(--border); }
.film text.num { font-weight: 750; font-size: 22px; font-variant-numeric: tabular-nums; }
.film text.num.up { fill: var(--bad); } .film text.num.paid { fill: var(--ok); }
.film .gl { stroke: var(--text); stroke-width: 4; stroke-linecap: round; }
.film .gt { fill: var(--muted); font-weight: 650; } .film .gt.new { fill: var(--ok); }
.film .rf { fill: var(--bad); } .film .rft { fill: var(--on-bad); font-weight: 700; }
.film .tl { fill: var(--sunken); stroke: var(--border); } .film text.tn { font-size: 14px; font-weight: 700; fill: var(--muted); }
.film .tile.ok .tl { fill: var(--ok-soft); stroke: var(--ok); } .film .tile.ok .tn { fill: var(--ok); }
.film .tile.wrong .tl { fill: var(--accent-soft); stroke: var(--accent); } .film .tile.wrong .tn { fill: var(--accent); }
.film .bb { fill: var(--sunken); stroke: var(--a-treasury); } .film .bt { font-weight: 650; }
.film .tp { fill: var(--surface); stroke: var(--text); stroke-opacity: .5; } .film .tpt { font-weight: 700; }
.film .ph { fill: var(--surface); stroke: var(--border); stroke-width: 2; } .film .ring { fill: none; stroke: var(--faint); stroke-width: 2.5; } .film .fid { color: var(--faint); }
.film .phone.wait .ring { stroke: var(--awx); } .film .phone.wait .fid { color: var(--awx); }
.film .phone.ok .ring { stroke: var(--ok); } .film .phone.ok .fid { color: var(--ok); } .film .phone.ok .pt2 { fill: var(--ok); }
.film .pt1 { fill: var(--muted); font-weight: 600; } .film .pt2 { font-weight: 750; }
.film .refused, .film .tiles, .film .bubble, .film .tap { opacity: 0; transition: opacity .25s; }
.film .show { opacity: 1; }
.film .coin text { font-size: 14px; font-weight: 750; fill: #fff; }
.film .coin.metal circle { fill: var(--metal); } .film .coin.awx circle { fill: var(--awx); } .film .coin.refund circle { fill: var(--accent); }
.film .coin.bad circle { fill: var(--bad); } .film .coin.bad text { fill: var(--on-bad); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .film .coin text { fill: #06121a; } }
:root[data-theme="dark"] .film .coin text { fill: #06121a; }
.sub { min-height: 4.4em; display: grid; gap: 8px; align-content: start; }
.sub .line { margin: 0; font-size: clamp(19px, 2.2vw, 26px); font-weight: 680; letter-spacing: -.01em; line-height: 1.3; }
.sub .line a { color: var(--accent); font-size: 17px; font-weight: 650; text-decoration: none; white-space: nowrap; }
.sub .call { justify-self: start; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bar button { font: 650 15px/1 Inter, system-ui, sans-serif; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 0 14px; min-height: 44px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
.bar button b { width: 22px; height: 22px; border-radius: 50%; background: var(--sunken); display: grid; place-items: center; font-size: 14px; }
.bar button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.bar button[aria-pressed="true"] b { background: var(--accent); color: var(--surface); }
.bar #play { width: 44px; padding: 0; justify-content: center; background: var(--text); color: var(--bg); border-color: var(--text); }
.prog { flex: 1 1 100%; height: 4px; border-radius: 4px; background: var(--sunken); overflow: hidden; }
.prog i { display: block; height: 100%; width: 0; background: var(--accent); }
.ctas { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
.ctas .btn { height: 52px; }
@media (max-width: 640px) { .ctas .btn { flex: 1 1 40%; justify-content: center; } .ctas .btn.primary { flex-basis: 100%; } .bar button { padding: 0 10px; } }
.runlabel { font-size: 14px; color: var(--faint); display: flex; align-items: center; gap: 6px; }`;

const JS = `
(function () {
  var D = JSON.parse(document.getElementById("run-data").textContent);
  var NS = "http://www.w3.org/2000/svg", LOOP = D.loop, SC = D.starts;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var svgs = [].slice.call(document.querySelectorAll(".film-svg"));
  var line = document.getElementById("line"), call = document.getElementById("call"), prog = document.querySelector(".prog i"), play = document.getElementById("play");
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(x) { x = clamp(x); return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function seg(t, a, b) { return clamp((t - a) / (b - a)); }
  // One set of moving coins per drawing; each drawing keeps its own coordinates.
  var V = svgs.map(function (svg) {
    var L = JSON.parse(svg.getAttribute("data-l")), layer = svg.querySelector(".coins");
    function coin(cls, label) { var g = document.createElementNS(NS, "g"); g.setAttribute("class", "coin " + cls); g.setAttribute("opacity", "0"); var c = document.createElementNS(NS, "circle"); c.setAttribute("r", label.length > 4 ? "27" : "21"); g.appendChild(c); var t = document.createElementNS(NS, "text"); t.setAttribute("text-anchor", "middle"); t.setAttribute("y", "5"); t.textContent = label; g.appendChild(t); layer.appendChild(g); return g; }
    var tiles = [].slice.call(svg.querySelectorAll(".tile"));
    return { svg: svg, L: L, q: function (s) { return svg.querySelector(s); }, tiles: tiles,
      flow: [0, 1, 2, 3].map(function () { return coin("metal", D.old); }), hit: coin("metal", D.price), pass: coin("metal", D.price),
      refunds: tiles.filter(function (t) { return t.getAttribute("data-wrong"); }).map(function () { return coin("refund", D.refundEach); }),
      sweep: coin("metal", D.sweep), euro: coin("awx", D.licence) };
  });
  function put(g, x, y, on) { g.setAttribute("transform", "translate(" + x + "," + y + ")"); g.setAttribute("opacity", on ? "1" : "0"); }
  function cls(el, c, on) { if (el) el.classList.toggle(c, !!on); }
  function scene(t) { for (var s = SC.length - 1; s >= 0; s--) if (t >= SC[s]) return s; return 0; }
  var last = -1;
  function subtitle(s) {
    var sc = D.scenes[s]; line.textContent = sc.line;
    if (sc.proof && sc.proof.href) { line.appendChild(document.createTextNode(" ")); var a = document.createElement("a"); a.href = sc.proof.href; a.target = "_blank"; a.rel = "noopener"; a.textContent = sc.proof.label + " ↗"; line.appendChild(a); }
    call.textContent = sc.badge || ""; call.title = sc.tip || ""; call.hidden = !sc.badge;
    document.querySelectorAll("[data-s]").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-s") === s)); });
  }
  function draw(v, t) {
    var L = v.L, s = scene(t), m = L.metal, w = L.awx;
    v.svg.querySelectorAll(".ag").forEach(function (g) { var on = g.getAttribute("data-agent") === D.scenes[s].agent; cls(g, "on", on); cls(g, "dim", !on); });
    // 1. Coins at the old price; the price rises; one at the new price hits the cap and is refused on chain.
    v.flow.forEach(function (c, i) { var p = seg(t, .3 + i * .7, 2.6 + i * .7); put(c, m.x1 + (L.supplier.x - 26 - m.x1) * ease(p), m.y, p > 0 && p < 1); });
    var up = t >= 4.6, price = v.q(".price"); price.textContent = up ? D.price : D.old; cls(price, "up", up && t < 11.4);
    var hp = seg(t, 5, 6.4), shake = t > 6.4 && t < 7.2 ? Math.sin(t * 60) * 4 : 0;
    put(v.hit, m.x1 + (L.gate.x - 26 - m.x1) * ease(hp) + shake, m.y, t >= 5 && t < 8);
    cls(v.hit, "bad", t >= 6.4);
    cls(v.q(".refused"), "show", t >= 6.4 && t < 11.5);
    // 2. Treasury replans; Face ID 1 of 2, then 2 of 2; the cap moves; a coin at the new price goes through.
    cls(v.q(".bubble"), "show", t >= 8 && t < 12.6);
    var ph = v.q(".phone"), p2 = v.q(".pt2"), p1 = v.q(".pt1");
    var f = t >= 9.4 && t < 10.8 ? ["wait", "Face ID", "1 of 2"] : t >= 10.8 && t < 12.8 ? ["ok", "Approved", "2 of 2"] : t >= 20.4 && t < 22.6 ? ["ok", "Approved", D.licence] : t >= 22.6 ? ["ok", "Paid", D.licence] : ["", "CFO", "Face ID"];
    cls(ph, "wait", f[0] === "wait"); cls(ph, "ok", f[0] === "ok"); p1.textContent = f[1]; p2.textContent = f[2];
    var gt = v.q(".gt"), newCap = t >= 11.4; gt.textContent = gt.getAttribute(newCap ? "data-b" : "data-a"); cls(gt, "new", newCap);
    var pp = seg(t, 11.6, 12.9); put(v.pass, m.x1 + (L.supplier.x - 26 - m.x1) * ease(pp), m.y, pp > 0 && pp < 1);
    // 3. Every disputed order checked; the wrong ones refunded to the customer.
    cls(v.q(".tiles"), "show", t >= 13 && t < 19);
    v.tiles.forEach(function (g, i) { var on = t >= 13.6 + i * .12, bad = !!g.getAttribute("data-wrong"); cls(g, "ok", on && !(bad && t >= 15.2)); cls(g, "wrong", on && bad && t >= 15.2); });
    var wrong = v.tiles.filter(function (g) { return g.getAttribute("data-wrong"); }), sup = L.agents[1];
    v.refunds.forEach(function (c, i) { var r = wrong[i].querySelector("rect"), x0 = +r.getAttribute("x") + +r.getAttribute("width") / 2, y0 = +r.getAttribute("y") + +r.getAttribute("height") / 2, p = seg(t, 16 + i * .35, 17.6 + i * .35);
      put(c, x0 + (sup[0] - x0) * ease(p), y0 + (sup[1] - y0) * ease(p), p > 0 && p < 1); });
    // 4. Earnings swept to Airwallex; the licence paid by SWIFT after Face ID; the TAP run's card buy.
    var sp = seg(t, 19, 20.6); put(v.sweep, L.sweepX, m.y + (w.y - m.y) * ease(sp), sp > 0 && sp < 1);
    var ep = seg(t, 21.2, 23.4); put(v.euro, w.x1 + (L.licence.x - 30 - w.x1) * ease(ep), w.y, ep > 0 && ep < 1);
    cls(v.q(".eur"), "paid", t >= 23.4);
    cls(v.q(".tap"), "show", t >= 23.8);
  }
  function render(t) {
    var s = scene(t);
    if (s !== last) { last = s; subtitle(s); }
    prog.style.width = (t / LOOP * 100) + "%";
    V.forEach(function (v) { draw(v, t); });
  }
  // Each scene's end state, for a still picture (reduced motion, ?scene=N): everything the scene shows, visible.
  var STILL = [7, 12.2, 18.2, 25.5];
  var t = 0, playing = !reduce, prev = null;
  var sp = /[?&]scene=([1-4])/.exec(location.search);
  if (sp) { playing = false; t = STILL[+sp[1] - 1]; } else if (reduce) t = STILL[0];
  function setPlay(on) { playing = on; play.setAttribute("aria-label", on ? "Pause" : "Play"); play.innerHTML = on ? D.icons.pause : D.icons.play; prev = null; }
  function frame(ts) { if (playing) { if (prev !== null) { t += (ts - prev) / 1000; if (t >= LOOP) { t = 0; last = -1; } } prev = ts; render(t); } requestAnimationFrame(frame); }
  play.addEventListener("click", function () { setPlay(!playing); });
  document.querySelectorAll("[data-s]").forEach(function (b) { b.addEventListener("click", function () { var s = +b.getAttribute("data-s"); last = -1; t = playing ? SC[s] : STILL[s]; render(t); }); });
  setPlay(playing);
  render(t);
  requestAnimationFrame(frame);
})();`;

export function homePage(run: AgentRun = agentRun()): string {
  const f = homeFilm(run);
  if (!f) throw new Error("the record lacks the four moments Home plays");
  const scenes = f.scenes.map((s) => ({ ...s, badge: s.call ? `${s.agent[0]!.toUpperCase()}${s.agent.slice(1)} · ${callBadge(s.call)}` : "", tip: s.call ? callTip(s.call) : "" }));
  const first = scenes[0]!;
  const words = HEADLINE.split(" ");
  const body = `<main>
<section class="hero"><div class="wrap">
  <div class="badges"><span class="badge">${esc(HOME_BADGE)}</span>${VISA_AWARD_ON ? `<span class="badge tap">${icon("credit-card", 15)}Visa TAP</span>` : ""}</div>
  <h1 class="h-hero">${esc(words.slice(0, 2).join(" "))} <span>${esc(words.slice(2).join(" "))}</span></h1>
  <div class="film card">${drawing(run, f, WIDE, "wide-l")}${drawing(run, f, PHONE, "phone-l")}</div>
  <div class="sub" aria-live="polite"><p class="line" id="line">${esc(first.line)} ${first.proof?.href ? `<a href="${esc(first.proof.href)}" target="_blank" rel="noopener">${esc(first.proof.label)} ↗</a>` : ""}</p><span class="call" id="call" title="${esc(first.tip)}">${esc(first.badge)}</span></div>
  <div class="bar"><button id="play" type="button" aria-label="Pause">${icon("pause", 18)}</button>${scenes.map((s, i) => `<button type="button" data-s="${i}" aria-pressed="${i === 0}"><b>${s.n}</b>${esc(s.title)}</button>`).join("")}<div class="prog" aria-hidden="true"><i></i></div></div>
  <div class="runlabel">${icon("database", 14)}<span>${esc(run.label)}</span></div>
  ${VISA_AWARD_ON ? `<p class="award-note">${esc(VISA_AWARD_STATUS)}</p>` : ""}
  <div class="ctas"><a class="btn primary" href="watch">${icon("play", 18)}Watch the run</a><a class="btn" href="try">${icon("sparkles", 18)}Try it</a><a class="btn" href="proof">${icon("shield-check", 18)}Proof</a></div>
</div></section>
</main>`;
  return page({
    title: "Purser", description: "Three Claude agents run Northwind Outdoor's money on Metal testnet and the Airwallex sandbox; the limits hold, and the CFO approves the rest with Face ID.", tab: "home", css: CSS, body, js: JS, stage: false,
    data: { loop: LOOP, starts: STARTS, scenes, old: f.old, price: f.price, refundEach: f.refundEach, sweep: f.sweep, licence: f.licence, icons: { play: icon("play", 18), pause: icon("pause", 18) } },
    source: `Source: ${run.file} (${run.name}); the card buy from the TAP run of the same day.`,
  });
}
