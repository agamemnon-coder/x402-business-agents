// Home: the whole story in three screens, picture first. 1. The heading, the core sentence, the Kit line and the stage
// playing the run's Metal moment (the price rise refused on chain, Treasury replans, two signatures, the mandate
// replaced); 2. the three moments as cards with a short loop each; 3. five numbers from the run, each explained, and the
// partners. Everything from the recorded run (src/redesign/run.ts).

import { CORE_SENTENCE, HERO, KIT_LINE, VISA_AWARD_ON, VISA_AWARD_STATUS } from "../config/brand.js";
import { agentRun, separateRowHtml, type AgentRun, type Mini, type Scene, type Tile } from "./run.js";
import { esc, icon, page, stageHtml } from "./ui.js";

const CSS = `.hero { padding: 24px 0 44px; }
.hero .wrap { display: grid; gap: 20px; grid-template-areas: "copy" "stage" "act"; }
.hero .copy { grid-area: copy; } .hero .show { grid-area: stage; min-width: 0; } .hero .act { grid-area: act; }
@media (min-width: 980px) { .hero { padding: 60px 0 76px; } .hero .wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 600px); grid-template-areas: "copy stage" "act stage"; gap: 0 52px; align-items: center; } .hero .copy { align-self: end; } .hero .act { align-self: start; } }
.badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.badges .pill.kit { background: var(--text); color: var(--bg); white-space: nowrap; }
.badges .pill.kit.award { background: var(--accent-soft); color: var(--accent); }
.swipe { display: none; font-size: 15px; color: var(--muted); margin: -12px 0 14px; align-items: center; gap: 6px; }
@media (max-width: 899px) { .swipe { display: flex; } }
.hero .lead { margin-top: 16px; max-width: 34em; }
.ctas { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.ctas .btn { height: 52px; }
@media (max-width: 979px) { .ctas { margin-top: 0; } .ctas .btn { flex: 1 1 40%; justify-content: center; } .ctas .btn.primary { flex-basis: 100%; } }
.built { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 22px; color: var(--faint); font-size: 14px; font-weight: 600; }
.logo { display: inline-flex; align-items: center; height: 34px; padding: 0 12px; border-radius: 10px; background: #fff; border: 1px solid var(--border); }
.logo.dark { background: #191919; border-color: #191919; }
.logo img { display: block; height: 15px; width: auto; }
.logo.txt { background: var(--surface); color: var(--text); font-weight: 750; font-size: 14px; white-space: nowrap; flex: none; }
.runlabel { margin-top: 10px; font-size: 14px; color: var(--faint); display: flex; align-items: center; gap: 6px; }
section.band { padding: 60px 0; border-top: 1px solid var(--border); }
.sechead { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 26px; }
.sechead .pill { white-space: normal; }
.scenes { display: grid; gap: 18px; }
@media (min-width: 900px) { .scenes { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.scene { padding: 22px; display: flex; flex-direction: column; gap: 16px; text-decoration: none; transition: transform .2s, border-color .2s; }
.scene:hover { transform: translateY(-2px); border-color: var(--accent); }
.scene .n { display: flex; align-items: center; gap: 10px; font-weight: 750; font-size: 22px; letter-spacing: -.015em; }
.scene .n b { width: 32px; height: 32px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 15px; flex: none; }
.scene p { margin: 0; font-size: 17px; line-height: 1.45; }
.scene .go { margin-top: auto; font-size: 15px; font-weight: 650; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }
.mini { height: 236px; border-radius: 16px; background: var(--sunken); position: relative; overflow: hidden; }
/* 1: the price goes through the cap and is refused on chain; two signatures move the cap; the purchase goes through. */
.m-price .plot { position: absolute; left: 14px; width: 118px; top: 40px; bottom: 36px; }
.m-price .cap { position: absolute; left: 0; right: -8px; border-top: 2px dashed var(--text); opacity: .7; bottom: calc(var(--c0) * 1%); animation: cap 6s infinite; }
.m-price .cap span { position: absolute; left: 0; top: -26px; font-size: 14px; font-weight: 750; background: var(--surface); border-radius: 6px; padding: 1px 7px; white-space: nowrap; }
.m-price .cap span::after { content: attr(data-a); animation: capt 6s infinite; }
@keyframes cap { 0%, 62% { bottom: calc(var(--c0) * 1%); } 74%, 100% { bottom: calc(var(--c1) * 1%); } }
@keyframes capt { 0%, 62% { content: attr(data-a); } 74%, 100% { content: attr(data-b); } }
.m-price .bar { position: absolute; right: 0; bottom: 0; width: 46px; border-radius: 10px 10px 4px 4px; background: var(--ok); animation: bar 6s infinite; height: calc(var(--h1) * 1%); }
@keyframes bar { 0%, 10% { height: calc(var(--h0) * 1%); background: var(--ok); } 26%, 70% { height: calc(var(--h1) * 1%); background: var(--bad); } 80%, 100% { height: calc(var(--h1) * 1%); background: var(--ok); } }
.m-price .bar em { position: absolute; bottom: -26px; left: 50%; transform: translateX(-50%); font-style: normal; font-size: 14px; font-weight: 650; color: var(--muted); white-space: nowrap; }
.m-price .bar b { position: absolute; top: 6px; left: 0; right: 0; text-align: center; font-size: 14px; color: #fff; }
/* The tags stack in one column, so a tag that wraps on a phone pushes the next one down instead of overlapping it. */
.m-price .tags { position: absolute; right: 12px; top: 34px; left: 160px; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
/* On a phone the card is too narrow for a column beside the chart: the tags go under it, one per line. */
@media (max-width: 899px) {
  .mini.m-price { height: 340px; }
  .m-price .plot { bottom: 150px; }
  .m-price .tags { left: 12px; right: 12px; top: auto; bottom: 12px; align-items: flex-start; gap: 8px; }
  .m-price .tag { white-space: nowrap; }
}
.m-price .tag { display: inline-flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 750; border-radius: 999px; padding: 4px 10px; opacity: 0; white-space: normal; max-width: 100%; }
.m-price .t1 { color: var(--bad); background: var(--bad-soft); animation: t1 6s infinite; }
.m-price .t2 { color: var(--accent); background: var(--accent-soft); animation: t2 6s infinite; }
.m-price .t3 { color: var(--ok); background: var(--ok-soft); animation: t3 6s infinite; }
@keyframes t1 { 0%, 24% { opacity: 0; } 30%, 100% { opacity: 1; } }
@keyframes t2 { 0%, 44% { opacity: 0; } 50%, 100% { opacity: 1; } }
@keyframes t3 { 0%, 76% { opacity: 0; } 82%, 100% { opacity: 1; } }
.m-price .t2 .one { animation: one 6s infinite; } .m-price .t2 .two { display: none; }
/* 2: every order checked; the wrong ones refunded. */
.m-orders { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; padding: 16px; align-content: center; }
.m-orders span { height: 44px; border-radius: 11px; background: var(--surface); border: 1px solid var(--border); display: grid; place-items: center; font-size: 14px; font-weight: 700; color: var(--muted); animation: ok 6s infinite; animation-delay: calc(var(--d) * 1ms); }
.m-orders span.wrong { animation-name: wrong; }
@keyframes ok { 0%, 6% { background: var(--surface); color: var(--muted); } 14%, 100% { background: var(--ok-soft); color: var(--ok); border-color: transparent; } }
@keyframes wrong { 0%, 6% { background: var(--surface); color: var(--muted); } 14%, 50% { background: var(--bad-soft); color: var(--bad); border-color: transparent; } 62%, 100% { background: var(--accent-soft); color: var(--accent); border-color: transparent; } }
.m-orders .legend { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--muted); margin-top: 4px; }
.m-orders .legend i { width: 11px; height: 11px; border-radius: 3px; background: var(--ok); } .m-orders .legend i.rf { background: var(--accent); margin-left: 8px; }
/* 3: four moves, one after another. */
.m-flow { display: grid; gap: 6px; padding: 10px 12px; align-content: center; }
.m-flow div { display: flex; align-items: center; gap: 8px; background: var(--surface); border-radius: 12px; padding: 7px 11px; font-size: 14px; line-height: 1.3; font-weight: 600; opacity: 0; animation: step 6s infinite; animation-delay: calc(var(--d) * 1ms); }
.m-flow div.ok .i { color: var(--ok); } .m-flow div.bad { color: var(--bad); } .m-flow div.bad .i { color: var(--bad); } .m-flow div.face .i { color: var(--accent); }
@keyframes step { 0% { opacity: 0; transform: translateY(6px); } 8%, 92% { opacity: 1; transform: none; } 100% { opacity: 0; } }
.tiles { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
@media (min-width: 640px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1000px) { .tiles { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; } }
.tile .v { font-size: clamp(32px, 2.8vw, 42px) !important; }
.partners { display: grid; gap: 12px; margin-top: 18px; }
@media (min-width: 640px) { .partners { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1100px) { .partners { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.award-note { margin: 12px 0 0; font-size: 15px; color: var(--muted); }
.partner { display: flex; align-items: center; gap: 14px; padding: 16px 18px; text-decoration: none; font-size: 16px; color: var(--muted); }
@media (max-width: 899px) {
  .scenes { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; gap: 12px; margin: 0 calc(-1 * var(--gut)); padding: 0 var(--gut) 8px; scrollbar-width: none; }
  .scenes::-webkit-scrollbar { display: none; }
  .scene { flex: 0 0 86%; scroll-snap-align: center; }
  section.band { padding: 44px 0; }
  .tile { padding: 18px; }
}
@media (prefers-reduced-motion: reduce) { .m-price .bar { height: calc(var(--h1) * 1%); background: var(--ok); } .m-price .cap { bottom: calc(var(--c1) * 1%); } .m-price .tag { opacity: 1; } .m-orders span { background: var(--ok-soft); color: var(--ok); } .m-orders span.wrong { background: var(--accent-soft); color: var(--accent); } .m-flow div { opacity: 1; } }`;

/**
 * What the hero plays: the Metal moment first (from the first refusal on chain to the first purchase under the replaced
 * mandate), then the other two moments' key steps. Purchases refused by Purser before signing are left to Watch.
 */
export function heroMoments(run: AgentRun): number[] {
  const ev = run.events;
  const s1 = run.scenes.find((s) => s.n === 1);
  const out: number[] = [];
  const add = (i: number) => { if (i >= 0 && !out.includes(i)) out.push(i); };
  if (s1) {
    const chain = ev.findIndex((e, i) => i >= s1.start && e.k === "money" && (e.refused?.by === "recorded" || e.refused?.by === "metal") && !!e.proof.href);
    add(chain);
    add(ev.findIndex((e, i) => i > chain && e.k === "world" && /asks \d/.test(e.text)));
    add(ev.findIndex((e, i) => i > chain && e.k === "msg" && e.agent === "sourcing"));
    add(ev.findIndex((e, i) => i > chain && e.k === "say" && e.agent === "treasury" && e.tools.some((t) => /rebalance/.test(t))));
    // Four eyes as it happened: the first signature (1 of 2), the second (2 of 2), then the mandates replaced on chain.
    add(ev.findIndex((e, i) => i > chain && e.k === "face" && e.status === "COSIGNED"));
    const sig = ev.findIndex((e, i) => i > chain && e.k === "face" && e.signers.length > 1);
    add(sig);
    const rep = ev.findIndex((e, i) => i > sig && e.k === "mandate" && e.agent === "sourcing");
    add(rep >= 0 ? rep : ev.findIndex((e, i) => i > sig && e.k === "world" && /replaced/.test(e.text)));
    add(ev.findIndex((e, i) => i > sig && e.k === "money" && e.agent === "sourcing" && !e.refused));
  }
  for (const s of run.scenes.filter((x) => x.n !== 1)) {
    const end = run.scenes.find((x) => x.n === s.n + 1)?.start ?? ev.length;
    ev.forEach((e, i) => {
      if (i < s.start || i >= end) return;
      const key = e.k === "world" || e.k === "face" || e.k === "shield" || e.k === "mandate" || (e.k === "say" && e.tools.some((t) => /settle|sweep|plan_invoice/.test(t))) || (e.k === "money" && e.agent !== null);
      if (key && !(e.k === "money" && e.agent === "support" && out.some((j) => { const p = ev[j]!; return p.k === "money" && p.agent === "support"; }))) add(i);
    });
  }
  return out.filter((i) => i >= 0);
}

function mini(m: Mini | null): string {
  if (!m) return "";
  if (m.kind === "price") {
    const top = Math.max(Number(m.price), Number(m.newCap ?? 0), Number(m.cap)) * 1.3;
    const pct = (v: string | null) => String(Math.round((Number(v ?? 0) / top) * 100));
    return `<div class="mini m-price" aria-hidden="true"><div class="plot">
<div class="cap" data-vars="--c0:${pct(m.cap)};--c1:${pct(m.newCap ?? m.cap)}"><span data-a="cap ${esc(m.cap)}" data-b="cap ${esc(m.newCap ?? m.cap)}"></span></div>
<div class="bar" data-vars="--h0:${pct(m.old ?? m.cap)};--h1:${pct(m.price)}"><b>${esc(m.price)}</b><em>${esc(m.from)}</em></div></div>
<div class="tags">${m.tx ? `<span class="tag t1">${icon("ban", 14)} ${m.byMetal ? "Metal refused it · on chain" : "Refused · recorded on chain"}</span>` : ""}
${m.signers > 1 ? `<span class="tag t2">${icon("scan-face", 14)} ${m.signers} of ${m.signers} signatures</span>` : ""}
${m.newCap ? `<span class="tag t3">${icon("circle-check", 14)} Paid at ${esc(m.price)}</span>` : ""}</div></div>`;
  }
  if (m.kind === "orders") {
    return `<div class="mini m-orders" aria-hidden="true">${m.orders.map((o, i) => `<span class="${m.refunded.includes(o) ? "wrong" : ""}" data-vars="--d:${i * 90}">#${esc(o)}</span>`).join("")}<div class="legend"><i></i>signed, valid<i class="rf"></i>wrong data, refunded</div></div>`;
  }
  return `<div class="mini m-flow" aria-hidden="true">${m.rows.map((r, i) => `<div class="${r.tone}" data-vars="--d:${i * 1100}">${icon(r.icon, 16)}<span>${esc(r.text)}</span></div>`).join("")}</div>`;
}

const sceneCard = (s: Scene) => `<a class="scene card" href="watch?scene=${s.n}"><div class="n"><b>${s.n}</b>${esc(s.title)}</div>${mini(s.mini)}<p>${esc(s.sentence)}</p><span class="go">Watch it happen ${icon("arrow-right", 15)}</span></a>`;

export const tileHtml = (t: Tile) => `<a class="tile card" href="${esc(t.href)}" title="${esc(t.tip ?? t.explain)}"><span class="v">${esc(t.value)}</span><span class="l">${esc(t.label)}</span>${t.parts ? `<span class="parts">${t.parts.map((p) => `<b>${esc(p.value)}</b>&nbsp;${esc(p.label)}`).join(" · ")}</span>` : ""}${t.note ? `<span class="note">${esc(t.note)}</span>` : ""}<p class="x">${esc(t.explain)}</p><span class="go">Open proof ${icon("arrow-right", 14)}</span></a>`;

/**
 * Home is served at "/" too (worker/src/core.ts). The CFO's viewer link opens "/" with its key after the "#" (never sent
 * to a server), and a device that opened it keeps the key (kit11.view, as src/dashboard/page.html stores it): either
 * goes on to the dashboard, "#" and all, by the same patterns the dashboard reads. The key leaves this page's address at
 * once, as it does on the dashboard. A guest stays on Home, and the Home tab (/home) is always Home.
 */
export const CFO_FORWARD_JS = `
(function () {
  try {
    if (location.pathname.slice(-1) !== "/") return;
    var h = location.hash, kept = "";
    try { kept = localStorage.getItem("kit11.view") || ""; } catch (e) {}
    if (!kept && !/(?:^#|&)(?:view=[0-9a-f]{32}|runner=[A-Za-z0-9_-]{80,200})(?:&|$)/.test(h)) return;
    if (h) try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    location.replace("./?dashboard" + h);
  } catch (e) {}
})();`;

const JS = `${CFO_FORWARD_JS}
(function () {
  var run = JSON.parse(document.getElementById("run-data").textContent);
  document.querySelectorAll("[data-vars]").forEach(function (el) { el.getAttribute("data-vars").split(";").forEach(function (p) { var kv = p.split(":"); if (kv[1] !== undefined) el.style.setProperty(kv[0], kv[1]); }); });
  var st = Stage(document.querySelector("[data-stage]"), run);
  var list = run.moments.map(function (i) { return run.events[i]; });
  var frame = /[?&]frame=(\\d+)/.exec(location.search);
  // The first frame already shows the run: the rails primed, the refusal on chain at the wall.
  st.prime(run.events, run.moments[0] || 0);
  if (frame || st.reduce) {
    var upto = frame ? Math.min(list.length - 1, +frame[1]) : 0;
    st.prime(run.events, run.moments[upto] || 0);
    for (var k = 0; k <= upto; k++) st.show(list[k], { instant: true });
    return;
  }
  // The first frame: the refusal on chain, the notice and the Sourcing agent's own words, at once; then it plays on.
  var i = 0;
  while (i < Math.min(3, list.length)) st.show(list[i++], { instant: true });
  function next() {
    if (i >= list.length) { i = 0; st.reset(); st.prime(run.events, run.moments[0] || 0); }
    var ms = st.show(list[i++]);
    setTimeout(next, ms);
  }
  setTimeout(next, 2600);
})();`;

/** opts.trySign: the bundle also carries /try/sign (TRY_SIGN_ENABLED), so the landing links to it; never otherwise. */
export function homePage(run: AgentRun = agentRun(), opts: { trySign?: boolean } = {}): string {
  const moments = heroMoments(run);
  const s1 = run.scenes.find((s) => s.n === 1);
  const body = `<main>
<section class="hero"><div class="wrap">
  <div class="copy">
    <div class="badges">${KIT_LINE.split(/ · (?=entered for)/).map((x, i) => `<span class="pill kit${i ? " award" : ""}">${esc(x)}</span>`).join("")}</div>
    <h1 class="h-hero">${esc(HERO)}</h1>
    <p class="lead">${esc(CORE_SENTENCE)}</p>
  </div>
  <div class="show">${stageHtml(run.agents, s1?.steps[0]?.text ?? "Northwind Outdoor sells live stock data per query")}<div class="runlabel">${icon("database", 14)}<span>${esc(run.label)}</span></div></div>
  <div class="act">
    <div class="ctas"><a class="btn primary" href="watch">${icon("play", 18)}Watch the agents</a><a class="btn" href="try">${icon("sparkles", 18)}Try it</a>${opts.trySign ? `<a class="btn" href="try/sign">${icon("scan-face", 18)}Sign with your own Face ID</a>` : ""}<a class="btn" href="proof">${icon("shield-check", 18)}Proof</a></div>
    <div class="built">Built on <span class="logo"><img src="assets/logo-airwallex.png" alt="Airwallex" width="109" height="15"></span><span class="logo"><img src="assets/logo-metal.svg" alt="Metal" width="48" height="15"></span><span class="logo dark"><img src="assets/logo-claude.png" alt="Claude" width="69" height="15"></span>${VISA_AWARD_ON ? '<span class="logo txt">Visa TAP</span>' : ""}</div>
  </div>
</div></section>
<section class="band" aria-labelledby="h-scenes"><div class="wrap">
  <div class="sechead"><h2 class="h-sec" id="h-scenes">Three moments from the run</h2></div>
  <p class="swipe" aria-hidden="true">Swipe for all three ${icon("arrow-right", 15)}</p>
  <div class="scenes">${run.scenes.map(sceneCard).join("")}</div>
</div></section>
<section class="band" aria-labelledby="h-proof"><div class="wrap">
  <div class="sechead"><h2 class="h-sec" id="h-proof">Proof, from ${esc(run.name)}</h2><span class="pill run">${icon("database", 14)}${esc(run.label)}</span></div>
  <div class="tiles">${run.tiles.map(tileHtml).join("")}</div>${run.tiles.map((t) => separateRowHtml(t.separate)).join("")}
  <div class="partners">
    <a class="partner card" href="proof#metal"><span class="logo"><img src="assets/logo-metal.svg" alt="Metal" width="48" height="15"></span>Mandates and refusals on chain</a>
    <a class="partner card" href="proof#airwallex"><span class="logo"><img src="assets/logo-airwallex.png" alt="Airwallex" width="109" height="15"></span>Cards, FX and SWIFT</a>
    <a class="partner card" href="proof#claude"><span class="logo dark"><img src="assets/logo-claude.png" alt="Claude" width="69" height="15"></span>${esc(run.agents.map((a) => a.family).join(" · "))} decide</a>
    ${VISA_AWARD_ON ? '<a class="partner card" href="visa"><span class="logo txt">Visa TAP</span>Card checkouts signed with TAP</a>' : ""}
  </div>
  ${VISA_AWARD_ON ? `<p class="award-note">${esc(VISA_AWARD_STATUS)}</p>` : ""}
</div></section>
</main>`;
  return page({
    title: "Purser", description: `${HERO} ${CORE_SENTENCE}`, tab: "home", css: CSS, body, js: JS,
    data: { agents: run.agents, events: run.events, moments },
    source: `Source: ${run.file} (${run.name}).`,
  });
}
