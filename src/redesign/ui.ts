// The redesign's design system (design pass, 2 Nov): one set of tokens and components for every public page (agent
// card, rail card, proof card, number tile), in light and dark, base text 17 px. One inline <style> and one inline
// <script> per page, so the pages keep the dashboard's hash-based CSP. Icons are Lucide (src/ui/icons.ts) plus a few
// drawn here in the same style.

import { ICONS, type Icon } from "../ui/icons.js";

const EXTRA: Record<string, Icon> = {
  "trending-up": [["polyline", { points: "22 7 13.5 15.5 8.5 10.5 2 17" }], ["polyline", { points: "16 7 22 7 22 13" }]],
  mail: [["rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }], ["path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" }]],
  coins: [["circle", { cx: "8", cy: "8", r: "6" }], ["path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18" }], ["path", { d: "M7 6h1v4" }]],
  pause: [["rect", { x: "14", y: "4", width: "4", height: "16", rx: "1" }], ["rect", { x: "6", y: "4", width: "4", height: "16", rx: "1" }]],
  "rotate-ccw": [["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }], ["path", { d: "M3 3v5h5" }]],
};

const attr = (a: Record<string, string>) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ");
/** An inline icon, drawn with currentColor. */
export function icon(name: string, size = 20): string {
  const shapes = ICONS[name] ?? EXTRA[name];
  if (!shapes) throw new Error(`no icon ${name}`);
  return `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes.map(([s, a]) => `<${s} ${attr(a)}/>`).join("")}</svg>`;
}
/** The icons a page's script draws, by name, as markup strings (built here, never from data). */
export const iconSet = (names: string[]) => Object.fromEntries(names.map((n) => [n, icon(n, 16)]));

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type Tab = "home" | "watch" | "try" | "proof";
const TABS: [Tab, string, string][] = [["home", "Home", "./"], ["watch", "Watch", "watch"], ["try", "Try", "try"], ["proof", "Proof", "proof"]];

export const CSS = `@font-face { font-family: Inter; src: url(assets/inter.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
:root {
  --bg: #f7f8fa; --surface: #ffffff; --sunken: #f1f3f7; --border: #e3e6ec; --text: #0b1220; --muted: #586174; --faint: #8a93a4;
  --accent: #4f46e5; --accent-soft: #eef0ff; --ok: #0f9f55; --ok-soft: #e6f6ee; --bad: #e0464c; --bad-soft: #fdecec;
  --metal: #0d9488; --metal-soft: #e3f5f2; --awx: #ea6a1f; --awx-soft: #fdf0e7; --claude: #d97757; --claude-soft: #fbefe9;
  --a-sourcing: #2563eb; --a-support: #9333ea; --a-treasury: #0e7490;
  --shadow: 0 1px 2px rgba(16,24,40,.05), 0 12px 32px -12px rgba(16,24,40,.12);
  --r: 22px; --gut: 16px; color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0a0c11; --surface: #12151d; --sunken: #191d27; --border: #262b37; --text: #eef1f6; --muted: #a4adbd; --faint: #737d8f;
  --accent: #8b85ff; --accent-soft: #23224a; --ok: #3ccf82; --ok-soft: #12291e; --bad: #ff6b70; --bad-soft: #341a1c;
  --metal: #2dd4bf; --metal-soft: #0f2a28; --awx: #ff8a4c; --awx-soft: #33200f; --claude: #ef9a76; --claude-soft: #33221b;
  --a-sourcing: #60a5fa; --a-support: #c084fc; --a-treasury: #22d3ee; --shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 32px -12px rgba(0,0,0,.6); color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #0a0c11; --surface: #12151d; --sunken: #191d27; --border: #262b37; --text: #eef1f6; --muted: #a4adbd; --faint: #737d8f;
  --accent: #8b85ff; --accent-soft: #23224a; --ok: #3ccf82; --ok-soft: #12291e; --bad: #ff6b70; --bad-soft: #341a1c;
  --metal: #2dd4bf; --metal-soft: #0f2a28; --awx: #ff8a4c; --awx-soft: #33200f; --claude: #ef9a76; --claude-soft: #33221b;
  --a-sourcing: #60a5fa; --a-support: #c084fc; --a-treasury: #22d3ee; --shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 32px -12px rgba(0,0,0,.6); color-scheme: dark;
}
@media (min-width: 720px) { :root { --gut: 32px; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 17px/1.55 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
a { color: inherit; }
.i { flex: none; vertical-align: -3px; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 var(--gut); }
/* Header: brand, four tabs, nothing else. */
header.top { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px); border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }
header.top .wrap { display: flex; align-items: center; gap: 12px; height: 64px; }
.brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 750; font-size: 18px; letter-spacing: -.02em; text-decoration: none; }
.brand .mk { width: 30px; height: 30px; border-radius: 9px; background: var(--text); color: var(--bg); display: grid; place-items: center; }
nav.tabs { margin-left: auto; display: flex; gap: 2px; background: var(--sunken); border-radius: 999px; padding: 4px; }
nav.tabs a { text-decoration: none; font-weight: 600; font-size: 15px; color: var(--muted); padding: 7px 14px; border-radius: 999px; }
nav.tabs a.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
@media (max-width: 420px) { .brand span.nm { display: none; } nav.tabs a { padding: 7px 12px; } }
/* Type. */
h1, h2, h3 { margin: 0; letter-spacing: -.025em; line-height: 1.08; }
.h-hero { font-size: clamp(38px, 5.4vw, 64px); font-weight: 780; }
.h-sec { font-size: clamp(28px, 3.4vw, 40px); font-weight: 750; }
.lead { font-size: clamp(18px, 1.6vw, 21px); color: var(--muted); line-height: 1.5; margin: 0; }
.eyebrow { font-size: 14px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); margin: 0 0 10px; }
/* Buttons and pills. */
.btn { display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 20px; border-radius: 999px; font: 650 16px/1 Inter, system-ui, sans-serif; text-decoration: none; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; white-space: nowrap; }
.btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn:focus-visible, a:focus-visible, button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 650; padding: 5px 11px; border-radius: 999px; background: var(--sunken); color: var(--muted); white-space: nowrap; }
.pill.run { background: var(--accent-soft); color: var(--accent); white-space: normal; }
.model { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 700; color: var(--claude); background: var(--claude-soft); border-radius: 999px; padding: 2px 8px; }
.model::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--claude); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); }
/* Agent avatar. */
.av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 750; font-size: 15px; flex: none; }
.av.sourcing { background: var(--a-sourcing); } .av.support { background: var(--a-support); } .av.treasury { background: var(--a-treasury); }
/* The stage: three agents, two rails, the CFO's phone. */
.stage { position: relative; padding: 18px; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr) 92px; grid-template-areas: "world world" "agents agents" "bubble bubble" "rails phone"; overflow: hidden; }
.st-world { grid-area: world; display: flex; align-items: center; gap: 8px; min-height: 34px; font-size: 14.5px; font-weight: 600; color: var(--muted); }
.st-world .tag { font-size: 11.5px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; background: var(--sunken); color: var(--faint); border-radius: 6px; padding: 3px 7px; }
.st-world .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: opacity .3s; }
.st-world.shield .tag { background: var(--ok-soft); color: var(--ok); }
.st-agents { grid-area: agents; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ag { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 10px 4px; border-radius: 16px; transition: background .3s, transform .3s; }
.ag .nm { font-weight: 700; font-size: 14.5px; line-height: 1.2; }
.ag.on { background: var(--sunken); transform: translateY(-2px); }
.ag.on .av { box-shadow: 0 0 0 4px var(--surface), 0 0 0 7px color-mix(in srgb, var(--claude) 55%, transparent); }
.st-bubble { grid-area: bubble; position: relative; min-height: 96px; background: var(--sunken); border-radius: 16px; padding: 12px 14px; font-size: 15.5px; line-height: 1.45; --cx: 50%; transition: opacity .25s; }
.st-bubble::before { content: ""; position: absolute; top: -8px; left: calc(var(--cx) - 8px); border: 8px solid transparent; border-top: 0; border-bottom-color: var(--sunken); transition: left .35s; }
.st-bubble .who { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--muted); margin-bottom: 4px; }
.st-bubble .tool { font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1px 6px; }
.st-bubble .say { margin: 0; }
.st-bubble .say::before { content: "“"; } .st-bubble .say::after { content: "”"; }
.st-bubble.idle .say::before, .st-bubble.idle .say::after { content: none; }
.st-bubble.idle { color: var(--faint); }
.dots { display: inline-flex; gap: 4px; } .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); animation: blink 1s infinite; } .dots i:nth-child(2) { animation-delay: .15s; } .dots i:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
.st-rails { grid-area: rails; display: grid; gap: 12px; align-content: center; min-width: 0; }
.lane { display: grid; gap: 6px; }
.lane .ln { display: flex; align-items: baseline; gap: 8px; font-size: 13.5px; font-weight: 750; }
.lane .ln small { font-weight: 550; color: var(--faint); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lane.metal .ln { color: var(--metal); } .lane.awx .ln { color: var(--awx); }
.track { position: relative; height: 34px; border-radius: 999px; background: var(--sunken); }
.track::before { content: ""; position: absolute; left: 14px; right: 14px; top: 50%; height: 2px; margin-top: -1px; background-image: linear-gradient(90deg, var(--border) 50%, transparent 0); background-size: 10px 2px; }
.lane.metal .track { background: var(--metal-soft); } .lane.awx .track { background: var(--awx-soft); }
.coin { position: absolute; top: 5px; left: 5px; height: 24px; min-width: 24px; padding: 0 9px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font: 750 12.5px/1 Inter, system-ui, sans-serif; color: #fff; white-space: nowrap; box-shadow: 0 4px 10px -2px rgba(0,0,0,.25); }
.lane.metal .coin { background: var(--metal); } .lane.awx .coin { background: var(--awx); }
.coin.bad { background: var(--bad) !important; }
.wall { position: absolute; top: -4px; bottom: -4px; left: 62%; width: 4px; border-radius: 4px; background: var(--bad); opacity: 0; transition: opacity .2s; }
.wall.on { opacity: 1; }
.verdict { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 12.5px; font-weight: 750; padding: 3px 9px; border-radius: 999px; opacity: 0; transition: opacity .25s; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.verdict.ok { background: var(--ok-soft); color: var(--ok); opacity: 1; }
.verdict.bad { background: var(--bad-soft); color: var(--bad); opacity: 1; left: calc(62% + 10px); right: auto; }
@media (max-width: 520px) { .verdict.bad { top: -24px; left: auto; right: 0; transform: none; max-width: 100%; } }
.st-phone { grid-area: phone; align-self: end; justify-self: end; width: 86px; height: 150px; border-radius: 20px; border: 3px solid var(--text); background: var(--surface); position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; text-align: center; padding: 8px 5px; transition: box-shadow .3s; }
.st-phone::before { content: ""; position: absolute; top: 6px; width: 26px; height: 5px; border-radius: 5px; background: var(--text); opacity: .8; }
.st-phone .fid { color: var(--faint); transition: color .3s, transform .3s; }
.st-phone b { font-size: 12px; line-height: 1.2; }
.st-phone small { font-size: 11px; color: var(--muted); line-height: 1.25; }
.st-phone.lit { box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 35%, transparent), 0 10px 30px -6px color-mix(in srgb, var(--accent) 60%, transparent); }
.st-phone.lit .fid { color: var(--accent); transform: scale(1.12); }
.st-phone.lit.no .fid { color: var(--bad); }
@media (max-width: 520px) {
  .stage { padding: 14px; gap: 12px; grid-template-columns: minmax(0, 1fr) 74px; }
  .st-phone { width: 72px; height: 128px; border-radius: 17px; }
  .ag { padding: 8px 2px; } .ag .nm { font-size: 13.5px; } .av { width: 38px; height: 38px; font-size: 13.5px; }
  .st-bubble { font-size: 15px; min-height: 104px; }
  .lane .ln small { display: none; }
}
/* Number tile. */
.tile { display: flex; flex-direction: column; gap: 4px; padding: 22px; text-decoration: none; transition: transform .2s, border-color .2s; }
.tile:hover { transform: translateY(-2px); border-color: var(--accent); }
.tile .v { font-size: clamp(34px, 3.6vw, 46px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.tile .l { color: var(--muted); font-size: 15.5px; line-height: 1.35; }
.tile .go { margin-top: auto; padding-top: 8px; font-size: 13.5px; font-weight: 650; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }
footer.foot { padding: 40px 0 56px; color: var(--faint); font-size: 14.5px; }
footer.foot .wrap { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; }
details.real { position: relative; }
details.real > summary { list-style: none; cursor: pointer; } details.real > summary::-webkit-details-marker { display: none; }
details.real .pop { position: absolute; bottom: calc(100% + 10px); left: 0; width: min(420px, calc(100vw - 32px)); padding: 16px 18px; font-size: 15px; color: var(--text); z-index: 30; }
details.real .pop ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`;

export function header(current: Tab): string {
  return `<header class="top"><div class="wrap"><a class="brand" href="./" aria-label="Purser, home"><span class="mk">${icon("feather", 17)}</span><span class="nm">Purser</span></a>
<nav class="tabs" aria-label="Main">${TABS.map(([k, label, href]) => `<a href="${href}"${k === current ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("")}</nav></div></header>`;
}

/** "What's real?": test money, sandbox, what is simulated; opens from the footer. */
export function footer(source: string): string {
  return `<footer class="foot"><div class="wrap"><details class="real"><summary class="pill">${icon("info", 15)} What's real?</summary><div class="pop card"><ul>
<li>Real Claude decisions, real Metal testnet and Airwallex sandbox calls.</li>
<li>Test money only. Merchants and customers are simulated.</li>
<li>${esc(source)}</li></ul></div></details><span>Built for the Airwallex Agentic Banking Hackathon</span></div></footer>`;
}

/** The stage's markup; the script below plays events on it. */
export function stageHtml(agents: { id: string; short: string; family: string }[], cls = ""): string {
  const initials = (s: string) => s.slice(0, 2);
  return `<div class="stage card ${cls}" data-stage aria-label="The agents at work, replayed from the recorded run">
<div class="st-world" aria-live="polite"><span class="tag">World</span><span class="txt">Northwind Outdoor sells live stock data per query</span></div>
<div class="st-agents">${agents.map((a) => `<div class="ag" data-agent="${esc(a.id)}"><span class="av ${esc(a.id)}">${esc(initials(a.short))}</span><span class="nm">${esc(a.short)}</span><span class="model">${esc(a.family)}</span></div>`).join("")}</div>
<div class="st-bubble idle"><div class="who"></div><p class="say">Waiting for the world to change.</p></div>
<div class="st-rails">
  <div class="lane metal"><div class="ln">Metal <small>stablecoin per query (x402)</small></div><div class="track"><i class="wall"></i><span class="verdict"></span></div></div>
  <div class="lane awx"><div class="ln">Airwallex <small>card · FX · SWIFT</small></div><div class="track"><i class="wall"></i><span class="verdict"></span></div></div>
</div>
<div class="st-phone" aria-label="The CFO's phone">${icon("scan-face", 30).replace('class="i"', 'class="i fid"')}<b>CFO</b><small>Face ID</small></div>
</div>`;
}

/**
 * The stage player, shared by Home (a loop of the key moments) and Watch (the whole run with controls). It reads the
 * run from the page's data block and only ever sets textContent, so nothing from the record is parsed as markup.
 */
export const STAGE_JS = `
function Stage(root, run) {
  var q = function (s) { return root.querySelector(s); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var names = {}; run.agents.forEach(function (a, i) { names[a.id] = { short: a.short, family: a.family, i: i }; });
  var world = q(".st-world"), bubble = q(".st-bubble"), phone = q(".st-phone");
  var lanes = { metal: q(".lane.metal"), airwallex: q(".lane.awx") };
  var timers = [];
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clear() { timers.forEach(clearTimeout); timers = []; }
  function first(t, n) { var s = String(t).replace(/\\s+/g, " ").trim().split(/(?<=[.!?])\\s+(?=[A-Z"(])/); var o = s.slice(0, n).join(" "); return o.length > 190 ? o.slice(0, 186).replace(/\\s+\\S*$/, "") + " …" : o; }
  function setWorld(text, shield) { world.classList.toggle("shield", !!shield); world.querySelector(".tag").textContent = shield ? "Blocked" : "World"; world.querySelector(".txt").textContent = text; }
  function focus(agent) {
    root.querySelectorAll(".ag").forEach(function (el) { el.classList.toggle("on", el.getAttribute("data-agent") === agent); });
    if (agent && names[agent]) bubble.style.setProperty("--cx", (names[agent].i * 2 + 1) / 6 * 100 + "%");
  }
  function speak(ev, sentences, instant) {
    focus(ev.agent);
    var who = bubble.querySelector(".who"), say = bubble.querySelector(".say");
    who.textContent = "";
    var n = names[ev.agent] || { short: ev.agent };
    var b = document.createElement("span"); b.textContent = n.short + (ev.k === "msg" ? " · message" : ev.by === "claude" ? " · decided by Claude" : " · fallback (code)"); who.appendChild(b);
    (ev.tools || []).slice(0, 3).forEach(function (t) { var c = document.createElement("span"); c.className = "tool"; c.textContent = t; who.appendChild(c); });
    bubble.classList.remove("idle");
    var text = first(ev.text, sentences);
    if (instant || reduce) { say.textContent = text; return; }
    say.textContent = ""; var d = document.createElement("span"); d.className = "dots"; d.innerHTML = "<i></i><i></i><i></i>"; say.appendChild(d);
    later(function () { say.textContent = text; }, 650);
  }
  function amountText(ev) { return (ev.unit === "EUR" ? "€" : ev.unit === "USD" ? "USD " : "") + ev.amount; }
  function verdictText(ev) {
    if (!ev.refused) return "✓ " + (ev.dir === "in" ? "received" : /refund/i.test(ev.what) ? "refunded" : "paid");
    return ev.refused.by === "metal" ? "✕ Refused on chain" : ev.refused.by === "airwallex" ? "✕ Declined by Airwallex" : "✕ Refused before signing";
  }
  function move(ev, instant) {
    var lane = lanes[ev.rail]; if (!lane) return;
    var track = lane.querySelector(".track"), wall = lane.querySelector(".wall"), verdict = lane.querySelector(".verdict");
    track.querySelectorAll(".coin").forEach(function (c) { c.remove(); });
    wall.classList.remove("on"); verdict.className = "verdict"; verdict.textContent = "";
    var coin = document.createElement("span"); coin.className = "coin"; coin.textContent = amountText(ev) + (ev.count > 1 ? " ×" + ev.count : "");
    track.appendChild(coin);
    var w = track.clientWidth - coin.offsetWidth - 10;
    var stop = ev.refused ? Math.max(0, track.clientWidth * 0.62 - coin.offsetWidth - 8) : w;
    var from = ev.dir === "in" ? w : 0, to = ev.dir === "in" ? 0 : stop;
    function done() {
      coin.style.transform = "translateX(" + to + "px)";
      if (ev.refused) { wall.classList.add("on"); coin.classList.add("bad"); verdict.className = "verdict bad"; }
      else verdict.className = "verdict ok";
      verdict.textContent = verdictText(ev);
      // Beside the coin, never under it: right of a coin that came in, left of one that was paid out.
      if (ev.refused) verdict.style.cssText = "";
      else if (ev.dir === "in") verdict.style.cssText = "right:auto;left:" + (coin.offsetWidth + 14) + "px";
      else verdict.style.cssText = "right:" + (coin.offsetWidth + 14) + "px";
    }
    if (instant || reduce || !coin.animate) { done(); return; }
    var a = coin.animate([{ transform: "translateX(" + from + "px)" }, { transform: "translateX(" + to + "px)" }], { duration: 1100, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
    a.onfinish = done;
    if (ev.refused) later(function () { coin.animate([{ transform: "translateX(" + to + "px)" }, { transform: "translateX(" + (to - 6) + "px)" }, { transform: "translateX(" + to + "px)" }], { duration: 240 }); }, 1150);
  }
  function face(ev, instant) {
    phone.classList.add("lit"); phone.classList.toggle("no", !ev.approved);
    phone.querySelector("b").textContent = ev.approved ? "Approved" : "Rejected";
    phone.querySelector("small").textContent = ev.id + " · " + ev.title;
    if (!instant) later(function () { phone.classList.remove("lit"); }, 2400);
  }
  function resetPhone() { phone.classList.remove("lit", "no"); phone.querySelector("b").textContent = "CFO"; phone.querySelector("small").textContent = "Face ID"; }
  /** Shows one event; returns how long it should stay, at 1x. */
  function show(ev, opts) {
    var instant = opts && opts.instant, sentences = (opts && opts.sentences) || 1;
    if (ev.k === "world") { setWorld(ev.text); return 2400; }
    if (ev.k === "shield") { setWorld(ev.text, true); return 2400; }
    if (ev.k === "say" || ev.k === "msg") { speak(ev, sentences, instant); return Math.min(6500, 2400 + first(ev.text, sentences).length * 22); }
    if (ev.k === "money") { move(ev, instant); return ev.refused ? 2800 : 2000; }
    if (ev.k === "face") { face(ev, instant); return 2800; }
    return 1000;
  }
  function reset() { clear(); focus(null); resetPhone(); setWorld(world.getAttribute("data-start") || world.querySelector(".txt").textContent); bubble.classList.add("idle"); bubble.querySelector(".who").textContent = ""; bubble.querySelector(".say").textContent = "Waiting for the world to change."; ["metal", "airwallex"].forEach(function (k) { var l = lanes[k]; l.querySelectorAll(".coin").forEach(function (c) { c.remove(); }); l.querySelector(".wall").classList.remove("on"); var v = l.querySelector(".verdict"); v.className = "verdict"; v.textContent = ""; v.style.cssText = ""; }); }
  world.setAttribute("data-start", world.querySelector(".txt").textContent);
  return { show: show, reset: reset, clear: clear, reduce: reduce };
}`;

/** A page around a body: one style, one script, the run's data in a data block ("<" escaped). */
export function page(o: { title: string; description: string; tab: Tab; css: string; body: string; data: unknown; js: string; source: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(o.description)}">
<title>${esc(o.title)}</title>
<style>${CSS}
${o.css}</style>
</head>
<body>
${header(o.tab)}
${o.body}
${footer(o.source)}
<script type="application/json" id="run-data">${JSON.stringify(o.data).replace(/</g, "\\u003c")}</script>
<script>${STAGE_JS}
${o.js}</script>
</body>
</html>`;
}
