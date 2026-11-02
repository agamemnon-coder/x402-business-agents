// The redesign's design system (design pass, 2 Nov): one set of tokens and components for every public page (agent
// card, rail card, proof card, number tile), in light and dark, base text 17 px. One inline <style> and one inline
// <script> per page, so the pages keep the dashboard's hash-based CSP. Icons are Lucide (src/ui/icons.ts) plus a few
// drawn here in the same style.

import { ICONS, type Icon } from "../ui/icons.js";
import { NORTHWIND_LINE, SECOND_APPROVER, WORLD_SETUP } from "../config/brand.js";

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
const TABS: [Tab, string, string][] = [["home", "Home", "home"], ["watch", "Watch", "watch"], ["try", "Try", "try"], ["proof", "Proof", "proof"]];

/** The design tokens, light and dark: the same on every page. */
export const TOKENS = `@font-face { font-family: Inter; src: url(assets/inter.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
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
`;

export const CSS = `${TOKENS}
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
.model { display: inline-flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 700; color: var(--claude); background: var(--claude-soft); border-radius: 999px; padding: 2px 8px; }
.model::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--claude); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); }
/* Agent avatar. */
.av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 750; font-size: 15px; flex: none; }
.av.sourcing { background: var(--a-sourcing); } .av.support { background: var(--a-support); } .av.treasury { background: var(--a-treasury); }
/* The stage: three agents, two rails, the CFO's phone. Text at least 14 px, so it reads in a 1080p video. */
.stage { position: relative; padding: 18px; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr) 128px; grid-template-areas: "world world" "agents agents" "bubble bubble" "rails phone"; overflow: hidden; }
.st-world { grid-area: world; display: flex; align-items: center; gap: 8px; min-height: 34px; font-size: 15.5px; font-weight: 600; color: var(--muted); min-width: 0; }
.st-world .tag { font-size: 14px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; background: var(--sunken); color: var(--faint); border-radius: 6px; padding: 3px 8px; flex: none; }
.st-world .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-world.shield .tag { background: var(--ok-soft); color: var(--ok); }
.st-agents { grid-area: agents; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ag { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 10px 4px; border-radius: 16px; transition: background .3s, transform .3s; }
.ag .nm { font-weight: 700; font-size: 15.5px; line-height: 1.2; }
.ag.on { background: var(--sunken); transform: translateY(-2px); }
.ag.on .av { box-shadow: 0 0 0 4px var(--surface), 0 0 0 7px color-mix(in srgb, var(--claude) 55%, transparent); }
.st-bubble { grid-area: bubble; position: relative; min-height: 104px; background: var(--sunken); border-radius: 16px; padding: 12px 14px; font-size: 16.5px; line-height: 1.45; --cx: 50%; }
.st-bubble::before { content: ""; position: absolute; top: -8px; left: calc(var(--cx) - 8px); border: 8px solid transparent; border-top: 0; border-bottom-color: var(--sunken); transition: left .35s; }
.st-bubble .who { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--muted); margin-bottom: 4px; }
.tool { font: 600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0 6px; }
.st-bubble .say { margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.st-bubble .say::before { content: "“"; } .st-bubble .say::after { content: "”"; }
.st-bubble.idle .say::before, .st-bubble.idle .say::after { content: none; }
.st-bubble.idle { color: var(--faint); }
.dots { display: inline-flex; gap: 4px; } .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); animation: blink 1s infinite; } .dots i:nth-child(2) { animation-delay: .15s; } .dots i:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
.st-rails { grid-area: rails; display: grid; gap: 14px; align-content: center; min-width: 0; }
.lane { display: grid; gap: 6px; }
.lane .ln { display: flex; align-items: baseline; gap: 8px; font-size: 15px; font-weight: 750; min-height: 22px; }
.lane .ln small { font-weight: 550; color: var(--faint); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lane.metal .ln { color: var(--metal); } .lane.awx .ln { color: var(--awx); }
.track { position: relative; height: 40px; border-radius: 999px; background: var(--sunken); }
.track::before { content: ""; position: absolute; left: 14px; right: 14px; top: 50%; height: 2px; margin-top: -1px; background-image: linear-gradient(90deg, color-mix(in srgb, var(--text) 18%, transparent) 50%, transparent 0); background-size: 10px 2px; }
.lane.metal .track { background: var(--metal-soft); } .lane.awx .track { background: var(--awx-soft); }
.coin { position: absolute; top: 6px; left: 6px; height: 28px; min-width: 28px; padding: 0 11px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font: 750 14px/1 Inter, system-ui, sans-serif; color: #fff; white-space: nowrap; box-shadow: 0 4px 10px -2px rgba(0,0,0,.25); }
.lane.metal .coin { background: var(--metal); } .lane.awx .coin { background: var(--awx); }
.lane.metal .coin { color: #fff; } :root[data-theme="dark"] .lane .coin, .dk .lane .coin { color: #0b1220; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .lane .coin { color: #04130f; } }
.coin.bad { background: var(--bad) !important; color: #fff !important; }
.coin.ghost { opacity: .55; }
.wall { position: absolute; top: -5px; bottom: -5px; left: 50%; width: 5px; border-radius: 4px; background: var(--bad); opacity: 0; transition: opacity .2s; }
.wall.on { opacity: 1; box-shadow: 0 0 0 4px color-mix(in srgb, var(--bad) 22%, transparent); }
.verdict { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 14px; font-weight: 750; padding: 3px 10px; border-radius: 999px; opacity: 0; transition: opacity .25s; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.verdict.ok { background: var(--ok-soft); color: var(--ok); opacity: 1; }
.verdict.bad { background: var(--bad-soft); color: var(--bad); opacity: 1; left: calc(50% + 12px); right: auto; max-width: calc(50% - 18px); }
.verdict.next { background: var(--surface); color: var(--faint); opacity: 1; }
a.verdict:hover { text-decoration: underline; }
.st-phone { grid-area: phone; align-self: end; justify-self: end; width: 124px; height: auto; min-height: 210px; border-radius: 24px; border: 3px solid var(--text); background: var(--surface); position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; text-align: center; padding: 18px 7px 10px; transition: box-shadow .3s; }
.st-phone::before { content: ""; position: absolute; top: 7px; width: 30px; height: 5px; border-radius: 5px; background: var(--text); opacity: .8; }
.st-phone .fid { color: var(--faint); transition: color .3s, transform .3s; }
.st-phone b { font-size: 14.5px; line-height: 1.2; }
.st-phone small { font-size: 14px; color: var(--muted); line-height: 1.25; }
.st-phone .sig { display: none; font-size: 14px; font-weight: 750; color: var(--accent); background: var(--accent-soft); border-radius: 999px; padding: 2px 8px; }
.st-phone .sig.on { display: inline-block; }
.st-phone .who2 { display: none; font-size: 14px; color: var(--faint); line-height: 1.2; }
.st-phone .who2.on { display: block; }
.st-phone.lit { box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 35%, transparent), 0 10px 30px -6px color-mix(in srgb, var(--accent) 60%, transparent); }
.st-phone.lit .fid { color: var(--accent); transform: scale(1.12); }
.st-phone.lit.no .fid { color: var(--bad); }
.stage .note4 { grid-column: 1 / -1; font-size: 14px; color: var(--faint); margin: -4px 0 0; }
@media (max-width: 640px) {
  .stage { padding: 14px; gap: 12px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "world" "agents" "bubble" "rails" "phone"; }
  .st-phone { width: 100%; min-height: 0; height: auto; flex-direction: row; flex-wrap: wrap; justify-content: flex-start; align-items: center; gap: 6px 10px; padding: 10px 14px; border-radius: 16px; border-width: 2px; text-align: left; }
  .st-phone::before { display: none; }
  .st-phone .fid { width: 26px; height: 26px; }
  .ag { padding: 8px 2px; } .ag .nm { font-size: 14.5px; } .av { width: 40px; height: 40px; font-size: 14px; }
  .st-bubble { font-size: 15.5px; min-height: 112px; }
  .lane .ln small { display: none; }
  .verdict.bad { top: -27px; left: auto; right: 0; transform: none; max-width: 70%; }
}
/* Number tile. */
.tile { display: flex; flex-direction: column; gap: 4px; padding: 22px; text-decoration: none; transition: transform .2s, border-color .2s; }
.tile:hover { transform: translateY(-2px); border-color: var(--accent); }
.tile .v { font-size: clamp(34px, 3.6vw, 46px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.tile .l { color: var(--text); font-size: 16px; font-weight: 650; line-height: 1.3; }
.tile .x { color: var(--muted); font-size: 15px; line-height: 1.45; margin: 4px 0 0; }
.tile .parts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.tile .parts span { font-size: 14px; font-weight: 650; background: var(--sunken); border-radius: 999px; padding: 3px 10px; color: var(--muted); }
.tile .parts b { color: var(--text); }
.tile .go { margin-top: auto; padding-top: 10px; font-size: 15px; font-weight: 650; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }
footer.foot { padding: 40px 0 56px; color: var(--faint); font-size: 14.5px; }
footer.foot .wrap { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; }
details.real { position: relative; }
details.real > summary { list-style: none; cursor: pointer; } details.real > summary::-webkit-details-marker { display: none; }
details.real .pop { position: absolute; bottom: calc(100% + 10px); left: 0; width: min(420px, calc(100vw - 32px)); padding: 16px 18px; font-size: 15px; color: var(--text); z-index: 30; }
details.real .pop ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`;

export function header(current: Tab): string {
  return `<header class="top"><div class="wrap"><a class="brand" href="home" aria-label="Purser, home"><span class="mk">${icon("feather", 17)}</span><span class="nm">Purser</span></a>
<nav class="tabs" aria-label="Main">${TABS.map(([k, label, href]) => `<a href="${href}"${k === current ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("")}</nav></div></header>`;
}

/** "What's real?": test money, sandbox, what is simulated, the world set-up, the second approver; opens from the footer. */
export function footer(source: string): string {
  return `<footer class="foot"><div class="wrap"><details class="real"><summary class="pill">${icon("info", 15)} What's real?</summary><div class="pop card"><ul>
<li>Northwind Outdoor is ${esc(NORTHWIND_LINE)}: the example company.</li>
<li>Real Claude decisions, real Metal testnet and Airwallex sandbox calls. Test money only; customers and merchants are simulated.</li>
<li>${esc(WORLD_SETUP)}</li>
<li>${esc(SECOND_APPROVER)}</li>
<li>${esc(source)}</li></ul></div></details><span>Built for the Airwallex Agentic Banking Hackathon</span></div></footer>`;
}

/** The stage's markup; the script below plays events on it. */
export function stageHtml(agents: { id: string; short: string; family: string }[], start: string): string {
  const initials = (s: string) => s.slice(0, 2);
  return `<div class="stage card" data-stage role="group" aria-label="The agents at work, replayed from the recorded run">
<div class="st-world" aria-live="polite"><span class="tag">World</span><span class="txt">${esc(start)}</span></div>
<div class="st-agents">${agents.map((a) => `<div class="ag" data-agent="${esc(a.id)}"><span class="av ${esc(a.id)}" aria-hidden="true">${esc(initials(a.short))}</span><span class="nm">${esc(a.short)}</span><span class="model">${esc(a.family)}</span></div>`).join("")}</div>
<div class="st-bubble idle" aria-live="polite"><div class="who"></div><p class="say">The agents wait for the world to change.</p></div>
<div class="st-rails">
  <div class="lane metal"><div class="ln">Metal <small>stablecoin per query · x402</small></div><div class="track"><i class="wall"></i><span class="verdict"></span></div></div>
  <div class="lane awx"><div class="ln">Airwallex <small>card · FX · SWIFT</small></div><div class="track"><i class="wall"></i><span class="verdict"></span></div></div>
</div>
<div class="st-phone" role="img" aria-label="The CFO's phone">${icon("scan-face", 32).replace('class="i"', 'class="i fid"')}<b>CFO</b><small>Face ID</small><span class="sig"></span><span class="who2">second approver: labelled test passkey</span></div>
</div>`;
}

/**
 * The stage player, shared by Home (the key moments on a loop) and Watch (the whole run with controls). It reads the
 * run from the page's data block and sets only textContent and attributes, so nothing from the record becomes markup.
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
  function first(t, n) { var s = String(t).replace(/\\s+/g, " ").trim().split(/(?<=[.!?])\\s+(?=[A-Z"(])/); return s.slice(0, n).join(" "); }
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
    say.textContent = ""; var d = document.createElement("span"); d.className = "dots"; d.appendChild(document.createElement("i")); d.appendChild(document.createElement("i")); d.appendChild(document.createElement("i")); say.appendChild(d);
    later(function () { say.textContent = text; }, 650);
  }
  function verdictText(ev) {
    if (!ev.refused) return "✓ " + (ev.dir === "in" ? "received" : /refund/i.test(ev.what) ? "refunded" : "paid");
    if (ev.refused.by === "metal") return "✕ Refused on chain" + (ev.proof && ev.proof.href ? " ↗" : "");
    if (ev.refused.by === "airwallex") return "✕ Airwallex: " + ev.refused.reason.split(":")[0];
    return "✕ Refused before signing";
  }
  function setVerdict(lane, ev, cls, coinW) {
    var old = lane.querySelector(".verdict"), v = document.createElement(ev && ev.refused && ev.proof && ev.proof.href ? "a" : "span");
    v.className = "verdict" + (cls ? " " + cls : "");
    if (v.tagName === "A") { v.href = ev.proof.href; v.target = "_blank"; v.rel = "noopener"; v.title = "The refusal, recorded on Metal testnet"; }
    old.replaceWith(v);
    if (!ev) return v;
    v.textContent = cls === "next" ? "next in the run" : verdictText(ev);
    if (cls === "ok" || cls === "next") v.style.cssText = ev.dir === "in" ? "right:auto;left:" + (coinW + 16) + "px" : "right:" + (coinW + 16) + "px";
    return v;
  }
  function move(ev, instant, ghost) {
    var lane = lanes[ev.rail]; if (!lane) return;
    var track = lane.querySelector(".track"), wall = lane.querySelector(".wall");
    track.querySelectorAll(".coin").forEach(function (c) { c.remove(); });
    wall.classList.remove("on"); setVerdict(lane, null, "", 0);
    var coin = document.createElement("span"); coin.className = "coin" + (ghost ? " ghost" : ""); coin.textContent = ev.label;
    track.appendChild(coin);
    var w = Math.max(0, track.clientWidth - coin.offsetWidth - 12);
    var stop = ev.refused ? Math.max(0, track.clientWidth * 0.5 - coin.offsetWidth - 8) : w;
    var from = ev.dir === "in" ? w : 0, to = ev.dir === "in" ? 0 : stop;
    function done() {
      coin.style.transform = "translateX(" + to + "px)";
      if (ghost) { setVerdict(lane, ev, "next", coin.offsetWidth); return; }
      if (ev.refused) { wall.classList.add("on"); coin.classList.add("bad"); setVerdict(lane, ev, "bad", coin.offsetWidth); }
      else setVerdict(lane, ev, "ok", coin.offsetWidth);
    }
    if (instant || ghost || reduce || !coin.animate) { done(); return; }
    var a = coin.animate([{ transform: "translateX(" + from + "px)" }, { transform: "translateX(" + to + "px)" }], { duration: 1150, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
    a.onfinish = done;
    if (ev.refused) later(function () { coin.animate([{ transform: "translateX(" + to + "px)" }, { transform: "translateX(" + (to - 8) + "px)" }, { transform: "translateX(" + to + "px)" }], { duration: 260 }); }, 1200);
  }
  function setPhone(head, sub, sig, two) {
    phone.querySelector("b").textContent = head; phone.querySelector("small").textContent = sub;
    var s = phone.querySelector(".sig"); s.textContent = sig || ""; s.classList.toggle("on", !!sig);
    phone.querySelector(".who2").classList.toggle("on", !!two);
  }
  function face(ev, instant) {
    var ok = ev.status !== "REJECTED", head = ok ? "Approved" : "Rejected", n = ev.signers.length;
    phone.classList.add("lit"); phone.classList.toggle("no", !ok);
    if (n > 1 && !instant && !reduce) {
      setPhone(ev.signers[0], ev.id + " · " + ev.title, "1 of " + n + " signatures", false);
      later(function () { setPhone(head, ev.id + " · " + ev.title, n + " of " + n + " signatures", true); }, 1500);
    } else setPhone(head, ev.id + " · " + ev.title, n > 1 ? n + " of " + n + " signatures" : "", n > 1);
    if (!instant) later(function () { phone.classList.remove("lit"); }, n > 1 ? 3600 : 2400);
  }
  function show(ev, opts) {
    var instant = opts && opts.instant, sentences = (opts && opts.sentences) || 1;
    if (ev.k === "world") { setWorld(ev.text); return 2600; }
    if (ev.k === "shield") { setWorld(ev.text, true); return 2400; }
    if (ev.k === "say" || ev.k === "msg") { speak(ev, sentences, instant); return Math.min(6500, 2600 + first(ev.text, sentences).length * 22); }
    if (ev.k === "money") { move(ev, instant); return ev.refused ? 3200 : 2000; }
    if (ev.k === "face") { face(ev, instant); return ev.signers.length > 1 ? 4200 : 2800; }
    return 1000;
  }
  /** Never an empty rail: each lane shows its latest movement before this point, or else the next one, marked as next. */
  function prime(events, at) {
    ["metal", "airwallex"].forEach(function (rail) {
      var past = null, next = null;
      for (var i = 0; i < events.length; i++) { var e = events[i]; if (e.k !== "money" || e.rail !== rail) continue; if (i < at) past = e; else if (!next) next = e; }
      if (past) move(past, true); else if (next) move(next, true, true);
    });
  }
  function reset() { clear(); focus(null); phone.classList.remove("lit", "no"); setPhone("CFO", "Face ID", "", false); setWorld(world.getAttribute("data-start")); bubble.classList.add("idle"); bubble.querySelector(".who").textContent = ""; bubble.querySelector(".say").textContent = "The agents wait for the world to change."; }
  world.setAttribute("data-start", world.querySelector(".txt").textContent);
  return { show: show, reset: reset, clear: clear, prime: prime, reduce: reduce };
}`;

/** An older page in the redesign's look: its tokens, base text 17 px, small text at least 14 px (before its CSP hash). */
export function restyle(html: string): string {
  return html.replace("</style>", () => `${TOKENS}
body { font-size: 17px; }
.lead { font-size: 19px !important; }
.chip, .count, .meta, .step span.d, .node small, .by, .examples button, .flow h2, .kicker { font-size: 14px !important; }
.step b, .node b { font-size: 16px !important; }
</style>`);
}

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
