// Home (design pass, 2 Nov): the whole story in three screens, picture first, at most about 40 words a screen.
// 1. The heading, the core sentence, the Kit line and the stage playing the run's key moments; 2. the three scenes as
// cards with a short loop each; 3. five numbers from the run and the partners. Everything from src/redesign/run.ts.

import { CORE_SENTENCE, KIT_LINE } from "../config/brand.js";
import { agentRun, type AgentRun, type Ev, type Mini, type Scene } from "./run.js";
import { esc, icon, page, stageHtml } from "./ui.js";

const CSS = `.hero { padding: 40px 0 56px; }
.hero { padding: 28px 0 44px; }
.hero .wrap { display: grid; gap: 22px; grid-template-areas: "copy" "stage" "act"; }
.hero .copy { grid-area: copy; } .hero .show { grid-area: stage; } .hero .act { grid-area: act; }
@media (min-width: 980px) { .hero { padding: 64px 0 80px; } .hero .wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 560px); grid-template-areas: "copy stage" "act stage"; gap: 0 56px; align-items: center; } .hero .copy { align-self: end; } .hero .act { align-self: start; } }
.badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.badges .pill.kit { background: var(--text); color: var(--bg); }
.hero .lead { margin-top: 18px; max-width: 34em; }
.ctas { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
@media (max-width: 979px) { .ctas { margin-top: 0; } .ctas .btn { flex: 1 1 auto; justify-content: center; } .built { margin-top: 16px; } }
.built { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 26px; color: var(--faint); font-size: 14px; font-weight: 600; }
.logo { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border-radius: 10px; background: #fff; border: 1px solid var(--border); }
.logo.dark { background: #191919; border-color: #191919; }
.logo img { display: block; height: 15px; width: auto; }
.runlabel { margin-top: 10px; font-size: 13.5px; color: var(--faint); display: flex; align-items: center; gap: 6px; }
section.band { padding: 64px 0; border-top: 1px solid var(--border); }
.sechead { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
.scenes { display: grid; gap: 16px; }
@media (min-width: 900px) { .scenes { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.scene { padding: 20px; display: flex; flex-direction: column; gap: 14px; text-decoration: none; transition: transform .2s, border-color .2s; }
.scene:hover { transform: translateY(-2px); border-color: var(--accent); }
.scene .n { display: flex; align-items: center; gap: 10px; font-weight: 750; font-size: 19px; letter-spacing: -.01em; }
.scene .n b { width: 30px; height: 30px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 14px; }
.scene p { margin: 0; color: var(--muted); font-size: 16.5px; line-height: 1.45; }
.scene .go { margin-top: auto; font-size: 14px; font-weight: 650; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }
.mini { height: 176px; border-radius: 16px; background: var(--sunken); position: relative; overflow: hidden; }
/* Scene 1: the supplier's price rises through the cap; the agent moves to the one inside it. */
.m-price .plot { position: absolute; left: 28px; right: 28px; top: 34px; bottom: 32px; display: flex; gap: 22px; align-items: end; }
.m-price .cap { position: absolute; left: -12px; right: -12px; bottom: calc(var(--capy) * 1%); border-top: 2px dashed var(--text); opacity: .6; z-index: 1; }
.m-price .cap span { position: absolute; left: 0; top: -24px; font-size: 12px; font-weight: 750; background: var(--surface); border-radius: 6px; padding: 1px 6px; }
.m-price .bar { position: relative; flex: 1; height: 100%; display: flex; justify-content: center; align-items: end; }
.m-price .bar i { display: block; width: 48px; border-radius: 10px 10px 4px 4px; background: var(--ok); height: calc(var(--h1) * 1%); }
.m-price .bar.up i { background: var(--bad); animation: rise 6s infinite; }
@keyframes rise { 0%, 15% { height: calc(var(--h0) * 1%); background: var(--ok); } 40%, 100% { height: calc(var(--h1) * 1%); background: var(--bad); } }
.m-price .bar b { position: absolute; bottom: calc(var(--h1) * 1% - 22px); font-size: 13px; color: #fff; z-index: 2; }
.m-price .bar.up b { animation: pick 6s infinite; }
.m-price .bar em { position: absolute; bottom: -24px; font-style: normal; font-size: 12.5px; font-weight: 650; color: var(--muted); white-space: nowrap; }
.m-price .pick { position: absolute; top: 8px; right: 8px; font-size: 12px; font-weight: 750; color: var(--ok); background: var(--ok-soft); border-radius: 999px; padding: 3px 9px; opacity: 0; animation: pick 6s infinite; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
@keyframes pick { 0%, 50% { opacity: 0; } 62%, 100% { opacity: 1; } }
/* Scene 2: every order checked; the wrong ones refunded. */
.m-orders { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; padding: 18px; align-content: center; }
.m-orders span { height: 44px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); display: grid; place-items: center; font-size: 13px; font-weight: 700; color: var(--muted); animation: ok 6s infinite; animation-delay: calc(var(--d) * 1ms); }
.m-orders span.wrong { animation-name: wrong; }
@keyframes ok { 0%, 8% { background: var(--surface); color: var(--muted); } 18%, 100% { background: var(--ok-soft); color: var(--ok); border-color: transparent; } }
@keyframes wrong { 0%, 8% { background: var(--surface); color: var(--muted); } 18%, 55% { background: var(--bad-soft); color: var(--bad); border-color: transparent; } 70%, 100% { background: var(--accent-soft); color: var(--accent); border-color: transparent; } }
.m-orders .legend { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); margin-top: 2px; }
.m-orders .legend i { width: 10px; height: 10px; border-radius: 3px; background: var(--ok); } .m-orders .legend i.rf { background: var(--accent); margin-left: 8px; }
/* Scene 3: three moves, one after another. */
.m-flow { display: grid; gap: 8px; padding: 16px; align-content: center; }
.m-flow div { display: flex; align-items: center; gap: 8px; background: var(--surface); border-radius: 12px; padding: 9px 12px; font-size: 14px; font-weight: 600; opacity: 0; animation: step 6s infinite; animation-delay: calc(var(--d) * 1ms); }
.m-flow div.ok .i { color: var(--ok); } .m-flow div.bad .i { color: var(--bad); } .m-flow div.face .i { color: var(--accent); }
@keyframes step { 0% { opacity: 0; transform: translateY(6px); } 10%, 88% { opacity: 1; transform: none; } 100% { opacity: 0; } }
.tile .v { font-size: clamp(30px, 2.9vw, 42px) !important; }
@media (max-width: 899px) {
  .scenes { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; gap: 12px; margin: 0 calc(-1 * var(--gut)); padding: 0 var(--gut) 8px; scrollbar-width: none; }
  .scenes::-webkit-scrollbar { display: none; }
  .scene { flex: 0 0 84%; scroll-snap-align: center; }
  section.band { padding: 44px 0; }
  .sechead { margin-bottom: 18px; }
  .tile { padding: 16px; } .tile .go { display: none; }
  .partner { padding: 12px 14px; font-size: 15px; }
}
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.tiles .tile:last-child { grid-column: span 2; }
@media (min-width: 900px) { .tiles { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; } .tiles .tile:last-child { grid-column: auto; } }
.partners { display: grid; gap: 12px; margin-top: 16px; }
@media (min-width: 760px) { .partners { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.partner { display: flex; align-items: center; gap: 14px; padding: 16px 18px; text-decoration: none; font-size: 15.5px; color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .m-price .bar.up i { height: calc(var(--h1) * 1%); } .m-price .bar.up b { opacity: 1; } .m-orders span { background: var(--ok-soft); color: var(--ok); } .m-orders span.wrong { background: var(--accent-soft); color: var(--accent); } .m-flow div { opacity: 1; } .m-price .pick { opacity: 1; transform: translate(-20%, 0); } }`;

/** The moments the hero plays on a loop: every world change, every decision that acted, the first of each kind of money, every Face ID. */
export function highlights(events: Ev[], from = 0): number[] {
  const seen = new Set<string>();
  const quiet = (tools: string[]) => tools.every((t) => /^(market|position|read_)/.test(t));
  return events.flatMap((e, i) => {
    if (i < from) return [];
    if (e.k === "world" || e.k === "face" || e.k === "shield") return [i];
    if (e.k === "msg") return [i];
    if (e.k === "say") return e.by === "claude" && !quiet(e.tools) ? [i] : [];
    const key = `${e.via}:${e.agent}:${e.dir}:${e.refused ? "x" : ""}:${e.agent === "support" ? "" : e.what}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [i];
  });
}

function mini(m: Mini | null): string {
  if (!m) return "";
  if (m.kind === "price") {
    const top = Math.max(Number(m.price), Number(m.toPrice ?? 0), Number(m.cap)) * 1.25;
    const pct = (v: string | null) => String(Math.round((Number(v ?? 0) / top) * 100));
    return `<div class="mini m-price" aria-hidden="true">${m.to ? `<span class="pick">${icon("check", 12)} Sourcing buys from ${esc(m.to)}</span>` : ""}<div class="plot"><div class="cap" data-vars="--capy:${pct(m.cap)}"><span>cap ${esc(m.cap)}</span></div>
<div class="bar up" data-vars="--h0:${pct(m.old ?? m.cap)};--h1:${pct(m.price)}"><b>${esc(m.price)}</b><i></i><em>${esc(m.from)}</em></div>
${m.to ? `<div class="bar" data-vars="--h1:${pct(m.toPrice)}"><b>${esc(m.toPrice ?? "")}</b><i></i><em>${esc(m.to)}</em></div>` : ""}</div></div>`;
  }
  if (m.kind === "orders") {
    return `<div class="mini m-orders" aria-hidden="true">${m.orders.map((o, i) => `<span class="${m.refunded.includes(o) ? "wrong" : ""}" data-vars="--d:${i * 120}">#${esc(o)}</span>`).join("")}<div class="legend"><i class="ok"></i>signed, valid<i class="rf"></i>wrong data, refunded</div></div>`;
  }
  const icons: Record<string, string> = { coin: "wallet", face: "scan-face", ban: "ban", card: "credit-card" };
  return `<div class="mini m-flow" aria-hidden="true">${m.rows.map((r, i) => `<div class="${r.tone}" data-vars="--d:${i * 900}">${icon(icons[r.icon] ?? "circle-check", 16)}<span>${esc(r.text)}</span></div>`).join("")}</div>`;
}

function sceneCard(s: Scene): string {
  return `<a class="scene card" href="watch?scene=${s.n}"><div class="n"><b>${s.n}</b>${esc(s.title)}</div>${mini(s.mini)}<p>${esc(s.sentence)}</p><span class="go">Watch it ${icon("arrow-right", 15)}</span></a>`;
}

const JS = `
(function () {
  var run = JSON.parse(document.getElementById("run-data").textContent);
  // CSS custom properties from data-vars (set by script: no style attributes under the page's policy).
  document.querySelectorAll("[data-vars]").forEach(function (el) { el.getAttribute("data-vars").split(";").forEach(function (p) { var kv = p.split(":"); if (kv[1] !== undefined) el.style.setProperty(kv[0], kv[1]); }); });
  var st = Stage(document.querySelector("[data-stage]"), run);
  var list = run.highlights.map(function (i) { return run.events[i]; });
  var frame = /[?&]frame=(\\d+)/.exec(location.search);
  if (frame || st.reduce) {
    // A still picture: the moments up to this one, shown at once (for reduced motion, and for screenshots).
    var upto = frame ? Math.min(list.length - 1, +frame[1]) : Math.min(list.length - 1, 1);
    for (var k = 0; k <= upto; k++) st.show(list[k], { instant: true });
    return;
  }
  var i = 0;
  function next() {
    if (i >= list.length) { i = 0; st.reset(); setTimeout(next, 900); return; }
    var ms = st.show(list[i++]);
    setTimeout(next, ms);
  }
  setTimeout(next, 600);
})();`;

export function homePage(run: AgentRun = agentRun()): string {
  // The loop starts where the story does: the first scene.
  const hl = highlights(run.events, run.scenes[0]?.start ?? 0);
  const body = `<main>
<section class="hero"><div class="wrap">
  <div class="copy">
    <div class="badges"><span class="pill kit">${esc(KIT_LINE)}</span></div>
    <h1 class="h-hero">AI agents that run a business. Limits they can't break.</h1>
    <p class="lead">${esc(CORE_SENTENCE)}</p>
  </div>
  <div class="act">
    <div class="ctas"><a class="btn primary" href="watch">${icon("play", 18)}Watch the agents</a><a class="btn" href="try">${icon("sparkles", 18)}Try it</a><a class="btn" href="proof">${icon("shield-check", 18)}Proof</a></div>
    <div class="built">Built on <span class="logo"><img src="assets/logo-airwallex.png" alt="Airwallex" width="109" height="15"></span><span class="logo"><img src="assets/logo-metal.svg" alt="Metal" width="48" height="15"></span><span class="logo dark"><img src="assets/logo-claude.png" alt="Claude" width="69" height="15"></span></div>
  </div>
  <div class="show">${stageHtml(run.agents)}<div class="runlabel">${icon("database", 14)}<span>${esc(run.label)}</span></div></div>
</div></section>
<section class="band" aria-labelledby="h-scenes"><div class="wrap">
  <div class="sechead"><h2 class="h-sec" id="h-scenes">Three moments from the run</h2></div>
  <div class="scenes">${run.scenes.map(sceneCard).join("")}</div>
</div></section>
<section class="band" aria-labelledby="h-proof"><div class="wrap">
  <div class="sechead"><h2 class="h-sec" id="h-proof">Proof, from the run</h2></div>
  <div class="tiles">${run.tiles.map((t) => `<a class="tile card" href="${esc(t.href)}"><span class="v">${esc(t.value)}</span><span class="l">${esc(t.label)}</span><span class="go">Open proof ${icon("arrow-right", 14)}</span></a>`).join("")}</div>
  <div class="partners">
    <a class="partner card" href="proof#metal"><span class="logo"><img src="assets/logo-metal.svg" alt="Metal" width="48" height="15"></span>Mandates and payments on chain</a>
    <a class="partner card" href="proof#airwallex"><span class="logo"><img src="assets/logo-airwallex.png" alt="Airwallex" width="109" height="15"></span>Cards, FX and SWIFT</a>
    <a class="partner card" href="proof#claude"><span class="logo dark"><img src="assets/logo-claude.png" alt="Claude" width="69" height="15"></span>${esc(run.agents.map((a) => a.family).join(" · "))} decide</a>
  </div>
</div></section>
</main>`;
  return page({
    title: "Purser", description: "AI agents that run a business, with limits they can't break.", tab: "home", css: CSS, body, js: JS,
    data: { agents: run.agents, events: run.events, highlights: hl },
    source: `Source: ${run.file} (${run.name})${run.standIn ? ", standing in until agent run 1's record is added" : ""}.`,
  });
}
