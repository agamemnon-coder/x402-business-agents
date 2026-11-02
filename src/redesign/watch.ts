// Watch (design pass, 2 Nov): the whole recorded agent run as an animation, event by event, from its record: each
// agent's decision in its own words with its model and tools, the money on its rail with the result and its proof,
// the CFO's Face ID on the phone. Play/pause, speed and jumps to the three scenes; labelled with the run's own name.

import { agentRun, type AgentRun } from "./run.js";
import { esc, icon, iconSet, page, stageHtml } from "./ui.js";

const CSS = `.watch { padding: 28px 0 24px; }
.whead { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 18px; }
.whead h1 { font-size: clamp(28px, 3.2vw, 38px); font-weight: 760; margin-right: auto; }
.wgrid { display: grid; gap: 16px; }
@media (min-width: 1000px) { .wgrid { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); align-items: start; } }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
.ibtn { width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--text); color: var(--bg); display: grid; place-items: center; cursor: pointer; flex: none; }
.seg { display: inline-flex; background: var(--sunken); border-radius: 999px; padding: 4px; }
.seg button { border: 0; background: none; font: 650 14px/1 Inter, system-ui, sans-serif; color: var(--muted); padding: 9px 12px; border-radius: 999px; cursor: pointer; }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button { border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 600 14px/1 Inter, system-ui, sans-serif; padding: 9px 13px; border-radius: 999px; cursor: pointer; display: inline-flex; gap: 7px; align-items: center; }
.chips button b { width: 20px; height: 20px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 11.5px; }
.chips button.on { border-color: var(--accent); color: var(--accent); }
.progress { position: relative; height: 6px; border-radius: 6px; background: var(--sunken); margin-top: 14px; }
.progress i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; background: var(--accent); width: 0; transition: width .4s; }
.progress em { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--text); opacity: .5; }
.count { font-size: 13.5px; color: var(--faint); font-variant-numeric: tabular-nums; margin-left: auto; }
.logp { padding: 6px 0; max-height: 640px; overflow: auto; }
.logp h2 { font-size: 15px; font-weight: 750; letter-spacing: .02em; color: var(--faint); text-transform: uppercase; padding: 12px 18px 6px; }
ol.log { list-style: none; margin: 0; padding: 0 10px 10px; display: grid; gap: 4px; }
ol.log li { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; padding: 10px 8px; border-radius: 14px; animation: in .35s ease-out; }
ol.log li:first-child { background: var(--sunken); }
@keyframes in { from { opacity: 0; transform: translateY(-6px); } }
ol.log .av { width: 34px; height: 34px; font-size: 12.5px; }
ol.log .ic { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--sunken); color: var(--muted); }
ol.log li:first-child .ic { background: var(--surface); }
ol.log .ic.metal { background: var(--metal-soft); color: var(--metal); } ol.log .ic.airwallex { background: var(--awx-soft); color: var(--awx); }
ol.log .ic.face { background: var(--accent-soft); color: var(--accent); } ol.log .ic.bad { background: var(--bad-soft); color: var(--bad); } ol.log .ic.shield { background: var(--ok-soft); color: var(--ok); }
ol.log .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--faint); }
ol.log .meta b { color: var(--text); font-size: 14.5px; }
ol.log .tool { font: 600 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; padding: 0 5px; }
ol.log p { margin: 3px 0 0; font-size: 15.5px; line-height: 1.45; overflow-wrap: anywhere; }
ol.log .res { display: inline-flex; font-size: 12.5px; font-weight: 750; border-radius: 999px; padding: 2px 8px; }
ol.log .res.ok { background: var(--ok-soft); color: var(--ok); } ol.log .res.bad { background: var(--bad-soft); color: var(--bad); }
ol.log a.pf { font-size: 13px; font-weight: 600; color: var(--accent); text-decoration: none; }
.stand { font-size: 13.5px; color: var(--faint); }
@media (max-width: 999px) { .logp { max-height: 520px; } }`;

const JS = `
(function () {
  var run = JSON.parse(document.getElementById("run-data").textContent);
  var ev = run.events, IC = run.icons;
  var st = Stage(document.querySelector("[data-stage]"), run);
  var log = document.getElementById("log"), bar = document.querySelector(".progress i"), count = document.getElementById("count"), playBtn = document.getElementById("play");
  var names = {}; run.agents.forEach(function (a) { names[a.id] = a; });
  var i = 0, playing = false, speed = 1, timer = null;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svg(name) { var s = el("span"); s.innerHTML = IC[name]; return s.firstChild; }
  function time(at) { return at.slice(11, 19) + " UTC"; }
  function sentences(t, n) { var s = String(t).replace(/\\s+/g, " ").trim().split(/(?<=[.!?])\\s+(?=[A-Z"(])/); return s.slice(0, n).join(" ") + (s.length > n ? " …" : ""); }
  function entry(e) {
    var li = el("li"), head, body = el("div"), meta = el("div", "meta");
    if (e.k === "say" || e.k === "msg") {
      var a = names[e.agent] || { short: e.agent, family: "" };
      head = el("span", "av " + e.agent, a.short.slice(0, 2));
      meta.appendChild(el("b", "", a.short));
      if (e.k === "say" && e.model) meta.appendChild(el("span", "model", a.family));
      meta.appendChild(el("span", "", e.k === "msg" ? "message" : e.by === "claude" ? "decided by Claude" : "fallback (code)"));
      (e.tools || []).forEach(function (t) { meta.appendChild(el("span", "tool", t)); });
      body.appendChild(meta); body.appendChild(el("p", "", sentences(e.text, 2)));
    } else if (e.k === "money") {
      head = el("span", "ic " + (e.refused ? "bad" : e.rail)); head.appendChild(svg(e.refused ? "ban" : e.rail === "metal" ? "zap" : e.via === "card" ? "credit-card" : "landmark"));
      meta.appendChild(el("b", "", (e.rail === "metal" ? "Metal" : "Airwallex") + " · " + e.via));
      var amt = (e.unit === "EUR" ? "EUR " : e.unit === "USD" ? "USD " : "") + e.amount + (e.unit !== "EUR" && e.unit !== "USD" ? " test USD" : "");
      meta.appendChild(el("span", "res " + (e.refused ? "bad" : "ok"), e.refused ? (e.refused.by === "metal" ? "✕ refused on chain" : e.refused.by === "airwallex" ? "✕ declined by Airwallex" : "✕ refused before signing") : e.dir === "in" ? "✓ received" : "✓ paid"));
      body.appendChild(meta);
      var p = el("p", "", amt + " · " + e.what + (e.count > 1 ? " (" + e.count + ")" : "") + " ");
      if (e.proof && e.proof.href) { var l = el("a", "pf", e.proof.label + " ↗"); l.href = e.proof.href; l.target = "_blank"; l.rel = "noopener"; p.appendChild(l); }
      else if (e.proof) p.appendChild(el("span", "stand", e.proof.label));
      body.appendChild(p);
    } else if (e.k === "face") {
      head = el("span", "ic " + (e.approved ? "face" : "bad")); head.appendChild(svg("scan-face"));
      meta.appendChild(el("b", "", "CFO · Face ID")); body.appendChild(meta);
      body.appendChild(el("p", "", (e.approved ? "Approved " : "Rejected ") + e.id + " · " + e.title));
    } else {
      head = el("span", "ic " + (e.k === "shield" ? "shield" : "")); head.appendChild(svg(e.k === "shield" ? "shield-check" : "sparkles"));
      meta.appendChild(el("b", "", e.k === "shield" ? "Blocked" : "The world changes")); body.appendChild(meta);
      body.appendChild(el("p", "", e.text));
    }
    meta.appendChild(el("span", "", time(e.at)));
    li.appendChild(head); li.appendChild(body);
    return li;
  }
  function sceneOf(k) { var s = 0; run.scenes.forEach(function (x) { if (k >= x.start) s = x.n; }); return s; }
  function mark() {
    bar.style.width = (i / ev.length * 100) + "%";
    count.textContent = i + " / " + ev.length;
    var s = sceneOf(Math.max(0, i - 1));
    document.querySelectorAll("#scenes button").forEach(function (b) { b.classList.toggle("on", +b.getAttribute("data-scene") === s); });
  }
  function setPlay(on) {
    playing = on; playBtn.textContent = ""; playBtn.appendChild(svg(on ? "pause" : i >= ev.length ? "rotate-ccw" : "play"));
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    clearTimeout(timer); if (on) tick();
  }
  function tick() {
    if (i >= ev.length) { setPlay(false); return; }
    var e = ev[i++]; log.insertBefore(entry(e), log.firstChild); var ms = st.show(e, { sentences: 2 }); mark();
    timer = setTimeout(function () { if (playing) tick(); }, ms / speed);
  }
  function jump(k) {
    clearTimeout(timer); st.reset(); log.textContent = "";
    for (i = 0; i < k; i++) { st.show(ev[i], { instant: true, sentences: 2 }); log.insertBefore(entry(ev[i]), log.firstChild); }
    st.clear(); mark();
  }
  playBtn.addEventListener("click", function () { if (!playing && i >= ev.length) jump(0); setPlay(!playing); });
  document.querySelectorAll("#speed button").forEach(function (b) { b.addEventListener("click", function () { speed = +b.getAttribute("data-speed"); document.querySelectorAll("#speed button").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }); }); });
  document.querySelectorAll("#scenes button").forEach(function (b) { b.addEventListener("click", function () { var n = +b.getAttribute("data-scene"); var sc = run.scenes.filter(function (x) { return x.n === n; })[0]; jump(sc ? sc.start : 0); setPlay(true); }); });
  run.scenes.forEach(function (s) { var m = el("em"); m.style.left = (s.start / ev.length * 100) + "%"; document.querySelector(".progress").appendChild(m); });
  var sc = /[?&]scene=(\\d)/.exec(location.search), at = /[?&]at=(\\d+)/.exec(location.search), still = /[?&]autoplay=0/.test(location.search);
  var startAt = at ? Math.min(ev.length, +at[1]) : sc ? ((run.scenes.filter(function (x) { return x.n === +sc[1]; })[0] || { start: 0 }).start) : 0;
  jump(startAt);
  if (still || st.reduce) setPlay(false); else setPlay(true);
})();`;

export function watchPage(run: AgentRun = agentRun()): string {
  const body = `<main class="watch"><div class="wrap">
  <div class="whead"><h1>Watch the agents work</h1><span class="pill run">${icon("database", 14)}${esc(run.label)}</span></div>
  <div class="wgrid">
    <div>
      ${stageHtml(run.agents)}
      <div class="controls">
        <button class="ibtn" id="play" type="button" aria-label="Play">${icon("play", 20)}</button>
        <div class="seg" id="speed" role="group" aria-label="Speed"><button type="button" data-speed="1" class="on" aria-pressed="true">1×</button><button type="button" data-speed="2" aria-pressed="false">2×</button><button type="button" data-speed="4" aria-pressed="false">4×</button></div>
        <span class="count" id="count" aria-live="off"></span>
      </div>
      <div class="controls"><div class="chips" id="scenes" role="group" aria-label="Jump to a scene"><button type="button" data-scene="0">Start</button>${run.scenes.map((s) => `<button type="button" data-scene="${s.n}"><b>${s.n}</b>${esc(s.title)}</button>`).join("")}</div></div>
      <div class="progress" aria-hidden="true"><i></i></div>
      ${run.standIn ? `<p class="stand">Stand-in: ${esc(run.name)}, until agent run 1's record is added.</p>` : ""}
    </div>
    <section class="card logp" aria-labelledby="h-log"><h2 id="h-log">Every step, newest first</h2><ol class="log" id="log"></ol></section>
  </div>
</div></main>`;
  return page({
    title: "Watch the agents", description: "A replay of a recorded agent run: each decision in the agent's own words, the money on its rail, the CFO's Face ID.", tab: "watch", css: CSS, body, js: JS,
    data: { agents: run.agents, events: run.events, scenes: run.scenes.map(({ n, title, start }) => ({ n, title, start })), icons: iconSet(["ban", "zap", "credit-card", "landmark", "scan-face", "shield-check", "sparkles", "play", "pause", "rotate-ccw"]) },
    source: `Source: ${run.file} (${run.name})${run.standIn ? ", standing in until agent run 1's record is added" : ""}.`,
  });
}
