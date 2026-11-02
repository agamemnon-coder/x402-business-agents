// Watch: the whole recorded agent run as an animation, event by event, from its record: each agent's decision in its
// own words with its model and tools, the money on its rail with the result and its proof (a testnet tx or an
// Airwallex id), the CFO's Face ID on the phone (both signatures when four eyes applies). Play/pause, speed and jumps
// to the three moments; labelled with the run's own name.

import { WORLD_SETUP } from "../config/brand.js";
import { agentRun, type AgentRun } from "./run.js";
import { esc, icon, iconSet, page, stageHtml } from "./ui.js";

const CSS = `.watch { padding: 26px 0 24px; }
.whead { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 8px; }
.whead h1 { font-size: clamp(30px, 3.2vw, 40px); font-weight: 760; margin-right: auto; }
.setup { font-size: 15px; color: var(--muted); margin: 0 0 16px; max-width: 60em; }
.wgrid { display: grid; gap: 16px; }
@media (min-width: 1000px) { .wgrid { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); align-items: start; } }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
.ibtn { width: 52px; height: 52px; border-radius: 50%; border: 0; background: var(--text); color: var(--bg); display: grid; place-items: center; cursor: pointer; flex: none; }
.seg { display: inline-flex; background: var(--sunken); border-radius: 999px; padding: 4px; }
.seg button { border: 0; background: none; font: 650 15px/1 Inter, system-ui, sans-serif; color: var(--muted); padding: 11px 14px; border-radius: 999px; cursor: pointer; min-width: 44px; }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips button { border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 600 15px/1 Inter, system-ui, sans-serif; padding: 11px 14px; border-radius: 999px; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; min-height: 44px; }
.chips button b { width: 22px; height: 22px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 13px; }
.chips button.on { border-color: var(--accent); color: var(--accent); }
.progress { position: relative; height: 6px; border-radius: 6px; background: var(--sunken); margin-top: 14px; }
.progress i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; background: var(--accent); width: 0; transition: width .4s; }
.progress em { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--text); opacity: .5; }
.count { font-size: 15px; color: var(--faint); font-variant-numeric: tabular-nums; margin-left: auto; }
.logp { padding: 6px 0; max-height: 700px; overflow: auto; }
.logp h2 { font-size: 15px; font-weight: 750; letter-spacing: .04em; color: var(--faint); text-transform: uppercase; padding: 12px 18px 6px; }
ol.log { list-style: none; margin: 0; padding: 0 10px 10px; display: grid; gap: 4px; }
ol.log li { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 10px; padding: 10px 8px; border-radius: 14px; animation: in .35s ease-out; }
ol.log li:first-child { background: var(--sunken); }
@keyframes in { from { opacity: 0; transform: translateY(-6px); } }
ol.log .av { width: 36px; height: 36px; font-size: 14px; }
ol.log .ic { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--sunken); color: var(--muted); }
ol.log li:first-child .ic { background: var(--surface); }
ol.log .ic.metal { background: var(--metal-soft); color: var(--metal); } ol.log .ic.airwallex { background: var(--awx-soft); color: var(--awx); }
ol.log .ic.face { background: var(--accent-soft); color: var(--accent); } ol.log .ic.bad { background: var(--bad-soft); color: var(--bad); } ol.log .ic.shield { background: var(--ok-soft); color: var(--ok); }
ol.log .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; color: var(--faint); }
ol.log .meta b { color: var(--text); font-size: 15.5px; }
ol.log p { margin: 4px 0 0; font-size: 16px; line-height: 1.45; overflow-wrap: anywhere; }
ol.log p.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
ol.log button.more { border: 0; background: none; padding: 2px 0; font: 650 14px/1.4 Inter, system-ui, sans-serif; color: var(--accent); cursor: pointer; }
ol.log .res { display: inline-flex; font-size: 14px; font-weight: 750; border-radius: 999px; padding: 2px 9px; }
ol.log .res.ok { background: var(--ok-soft); color: var(--ok); } ol.log .res.bad { background: var(--bad-soft); color: var(--bad); } ol.log .res.face { background: var(--accent-soft); color: var(--accent); }
ol.log .pf { font-size: 14px; font-weight: 600; color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
ol.log span.pf { color: var(--muted); }
@media (max-width: 999px) { .logp { max-height: 560px; } }`;

const JS = `
(function () {
  var run = JSON.parse(document.getElementById("run-data").textContent);
  var ev = run.events, IC = run.icons;
  var st = Stage(document.querySelector("[data-stage]"), run);
  var log = document.getElementById("log"), bar = document.querySelector(".progress i"), count = document.getElementById("count"), playBtn = document.getElementById("play");
  var names = {}; run.agents.forEach(function (a) { names[a.id] = a; });
  var i = 0, playing = false, speed = 1, timer = null;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svg(name) { var t = document.createElement("template"); t.innerHTML = IC[name]; return t.content.firstChild; }
  function time(at) { return at.slice(11, 19) + " UTC"; }
  function said(body, text) {
    var p = el("p", "clamp", text); body.appendChild(p);
    var m = el("button", "more", "more"); m.type = "button"; m.hidden = true; body.appendChild(m);
    requestAnimationFrame(function () { if (p.scrollHeight > p.clientHeight + 2) m.hidden = false; });
    m.addEventListener("click", function () { var open = p.classList.toggle("clamp"); m.textContent = open ? "more" : "less"; });
  }
  function proofEl(pr) {
    if (!pr) return null;
    if (pr.href) { var a = el("a", "pf", pr.label + " ↗"); a.href = pr.href; a.target = "_blank"; a.rel = "noopener"; return a; }
    return el("span", "pf", pr.label);
  }
  function entry(e) {
    var li = el("li"), head, body = el("div"), meta = el("div", "meta");
    if (e.k === "say" || e.k === "msg") {
      var a = names[e.agent] || { short: e.agent, family: "" };
      head = el("span", "av " + e.agent, a.short.slice(0, 2));
      meta.appendChild(el("b", "", a.short));
      if (e.k === "say" && e.model) meta.appendChild(el("span", "model", a.family));
      meta.appendChild(el("span", "", e.k === "msg" ? "message" : e.by === "claude" ? "decided by Claude" : "fallback (code)"));
      (e.tools || []).forEach(function (t) { meta.appendChild(el("span", "tool", t)); });
      meta.appendChild(el("span", "", time(e.at)));
      body.appendChild(meta); said(body, e.text);
    } else if (e.k === "money") {
      head = el("span", "ic " + (e.refused ? "bad" : e.rail)); head.appendChild(svg(e.refused ? "ban" : e.rail === "metal" ? "zap" : e.via === "card" ? "credit-card" : "landmark"));
      meta.appendChild(el("b", "", (e.rail === "metal" ? "Metal" : "Airwallex") + " · " + e.via));
      var res = e.refused ? (e.refused.by === "metal" ? "✕ refused on chain" : e.refused.by === "airwallex" ? "✕ refused by Airwallex: " + e.refused.reason : "✕ refused before signing (Purser)") : e.dir === "in" ? "✓ received" : /refund/i.test(e.what) ? "✓ refunded" : "✓ paid";
      meta.appendChild(el("span", "res " + (e.refused ? "bad" : "ok"), res));
      meta.appendChild(el("span", "", time(e.at)));
      body.appendChild(meta);
      var amt = e.amount ? (e.unit === "EUR" ? "EUR " + e.amount : e.unit === "USD" ? "USD " + e.amount : e.amount + " test USD") + " · " : "";
      var p = el("p", "", amt + e.what + (e.count > 1 ? " (" + e.count + ")" : "") + " ");
      var pe = proofEl(e.proof); if (pe) p.appendChild(pe);
      body.appendChild(p);
    } else if (e.k === "face") {
      var ok = e.status !== "REJECTED";
      head = el("span", "ic " + (ok ? "face" : "bad")); head.appendChild(svg("scan-face"));
      meta.appendChild(el("b", "", "CFO · Face ID"));
      if (e.signers.length > 1) meta.appendChild(el("span", "res face", "1 of " + e.signers.length + " → " + e.signers.length + " of " + e.signers.length + " signatures"));
      meta.appendChild(el("span", "", time(e.at)));
      body.appendChild(meta);
      body.appendChild(el("p", "", (ok ? "Approved " : "Rejected ") + e.id + " · " + e.title + " · signed by " + e.signers.join(" and ") + (e.signers.length > 1 ? " (second approver: labelled test passkey)" : "")));
    } else {
      head = el("span", "ic " + (e.k === "shield" ? "shield" : "")); head.appendChild(svg(e.k === "shield" ? "shield-check" : "sparkles"));
      meta.appendChild(el("b", "", e.k === "shield" ? "Blocked" : "The world changes")); meta.appendChild(el("span", "", time(e.at))); body.appendChild(meta);
      body.appendChild(el("p", "", e.text));
    }
    li.appendChild(head); li.appendChild(body);
    return li;
  }
  function sceneOf(k) { var s = 0; run.scenes.forEach(function (x) { if (k >= x.start) s = x.n; }); return s; }
  function mark() {
    bar.style.width = (i / ev.length * 100) + "%";
    count.textContent = "step " + i + " of " + ev.length;
    var s = sceneOf(Math.max(0, i - 1));
    document.querySelectorAll("#scenes button").forEach(function (b) { b.classList.toggle("on", +b.getAttribute("data-scene") === s); });
  }
  function setPlay(on) {
    playing = on; playBtn.textContent = ""; playBtn.appendChild(svg(on ? "pause" : i >= ev.length ? "rotate-ccw" : "play"));
    playBtn.setAttribute("aria-label", on ? "Pause" : i >= ev.length ? "Replay from the start" : "Play");
    clearTimeout(timer); if (on) tick();
  }
  function tick() {
    if (i >= ev.length) { setPlay(false); return; }
    var e = ev[i++]; log.insertBefore(entry(e), log.firstChild); var ms = st.show(e, { sentences: 2 }); mark();
    timer = setTimeout(function () { if (playing) tick(); }, ms / speed);
  }
  function jump(k) {
    clearTimeout(timer); st.reset(); log.textContent = "";
    st.prime(ev, k);
    for (i = 0; i < k; i++) { var e = ev[i]; if (e.k !== "money") st.show(e, { instant: true, sentences: 2 }); log.insertBefore(entry(e), log.firstChild); }
    st.clear(); mark();
  }
  playBtn.addEventListener("click", function () { if (!playing && i >= ev.length) jump(0); setPlay(!playing); });
  document.querySelectorAll("#speed button").forEach(function (b) { b.addEventListener("click", function () { speed = +b.getAttribute("data-speed"); document.querySelectorAll("#speed button").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }); }); });
  document.querySelectorAll("#scenes button").forEach(function (b) { b.addEventListener("click", function () { var n = +b.getAttribute("data-scene"); var sc = run.scenes.filter(function (x) { return x.n === n; })[0]; jump(sc ? sc.start : 0); setPlay(true); }); });
  run.scenes.forEach(function (s) { var m = el("em"); m.style.left = (s.start / ev.length * 100) + "%"; document.querySelector(".progress").appendChild(m); });
  var sc = /[?&]scene=(\\d)/.exec(location.search), at = /[?&]at=(\\d+)/.exec(location.search), still = /[?&]autoplay=0/.test(location.search);
  var startAt = at ? Math.min(ev.length, +at[1]) : sc ? ((run.scenes.filter(function (x) { return x.n === +sc[1]; })[0] || { start: 0 }).start) : 0;
  jump(startAt);
  if (still || st.reduce) { setPlay(false); if (startAt < ev.length) { var e0 = ev[startAt]; if (e0) { st.show(e0, { instant: true, sentences: 2 }); log.insertBefore(entry(e0), log.firstChild); i = startAt + 1; mark(); } } } else setPlay(true);
})();`;

export function watchPage(run: AgentRun = agentRun()): string {
  const s1 = run.scenes.find((s) => s.n === 1);
  const body = `<main class="watch"><div class="wrap">
  <div class="whead"><h1>Watch the agents work</h1><span class="pill run">${icon("database", 14)}${esc(run.label)}</span></div>
  <p class="setup">${esc(WORLD_SETUP)}</p>
  <div class="wgrid">
    <div>
      ${stageHtml(run.agents, s1?.steps[0]?.text ?? "Northwind Outdoor sells live stock data per query")}
      <div class="controls">
        <button class="ibtn" id="play" type="button" aria-label="Play">${icon("play", 20)}</button>
        <div class="seg" id="speed" role="group" aria-label="Speed"><button type="button" data-speed="1" class="on" aria-pressed="true">1×</button><button type="button" data-speed="2" aria-pressed="false">2×</button><button type="button" data-speed="4" aria-pressed="false">4×</button></div>
        <span class="count" id="count"></span>
      </div>
      <div class="controls"><div class="chips" id="scenes" role="group" aria-label="Jump to a moment"><button type="button" data-scene="0">Start</button>${run.scenes.map((s) => `<button type="button" data-scene="${s.n}"><b>${s.n}</b>${esc(s.title)}</button>`).join("")}</div></div>
      <div class="progress" aria-hidden="true"><i></i></div>
    </div>
    <section class="card logp" aria-labelledby="h-log"><h2 id="h-log">Every step, newest first</h2><ol class="log" id="log" aria-live="polite"></ol></section>
  </div>
</div></main>`;
  return page({
    title: "Watch the agents", description: "A replay of a recorded agent run: each decision in the agent's own words, the money on its rail, the CFO's Face ID.", tab: "watch", css: CSS, body, js: JS,
    data: { agents: run.agents, events: run.events, scenes: run.scenes.map(({ n, title, start }) => ({ n, title, start })), icons: iconSet(["ban", "zap", "credit-card", "landmark", "scan-face", "shield-check", "sparkles", "play", "pause", "rotate-ccw"]) },
    source: `Source: ${run.file} (${run.name}).`,
  });
}
