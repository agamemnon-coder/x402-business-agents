// The redesign's design system (design pass, 2 Nov): one set of tokens and components for every public page (agent
// card, rail card, proof card, number tile), in light and dark, base text 17 px. One inline <style> and one inline
// <script> per page, so the pages keep the dashboard's hash-based CSP. Icons are Lucide (src/ui/icons.ts) plus a few
// drawn here in the same style.

import { ICONS, type Icon } from "../ui/icons.js";
import { NORTHWIND_LINE, SECOND_APPROVER, WORLD_SETUP } from "../config/brand.js";
import { OG_IMAGE, TAGLINE_LINE, ogTitle } from "../ui/meta.js";
import { MORE_CSS, footerLinks, menuItemOf, moreHtml, type PageKey } from "../ui/more.js";
import { WATCH_IN_MENU } from "../config/film.js";

const EXTRA: Record<string, Icon> = {
  copy: [["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }], ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]],
  "trending-up": [["polyline", { points: "22 7 13.5 15.5 8.5 10.5 2 17" }], ["polyline", { points: "16 7 22 7 22 13" }]],
  mail: [["rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }], ["path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" }]],
  coins: [["circle", { cx: "8", cy: "8", r: "6" }], ["path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18" }], ["path", { d: "M7 6h1v4" }]],
  pause: [["rect", { x: "14", y: "4", width: "4", height: "16", rx: "1" }], ["rect", { x: "6", y: "4", width: "4", height: "16", rx: "1" }]],
  package: [["path", { d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" }], ["path", { d: "M12 22V12" }], ["path", { d: "m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7" }]],
  headphones: [["path", { d: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" }]],
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
/** The four tabs; the menu's fifth item, "More", and the pages under it are in src/ui/more.ts (shared with src/ui/nav.ts). */
const TABS: [Tab, string, string][] = ([["home", "Home", "home"], ["watch", "Watch", "watch"], ["try", "Try", "try"], ["proof", "Proof", "proof"]] as [Tab, string, string][]).filter(([t]) => t !== "watch" || WATCH_IN_MENU);

/** The design tokens, light and dark: the same on every page. */
export const TOKENS = `@font-face { font-family: Inter; src: url(assets/inter.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
:root {
  --bg: #f7f8fa; --surface: #ffffff; --sunken: #f1f3f7; --border: #e3e6ec; --text: #0b1220; --muted: #586174; --faint: #646d7e;
  --accent: #4f46e5; --accent-soft: #eef0ff; --ok: #0b7d43; --ok-soft: #e6f6ee; --bad: #c5363c; --bad-soft: #fdecec; --on-bad: #ffffff;
  --metal: #0b7a70; --metal-soft: #e3f5f2; --awx: #ad4a0c; --awx-soft: #fdf0e7; --claude: #a84d2b; --claude-soft: #fbefe9;
  --a-sourcing: #2563eb; --a-support: #9333ea; --a-treasury: #0e7490;
  --shadow: 0 1px 2px rgba(16,24,40,.05), 0 12px 32px -12px rgba(16,24,40,.12);
  --r: 22px; --gut: 16px; color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0a0c11; --surface: #12151d; --sunken: #191d27; --border: #262b37; --text: #eef1f6; --muted: #a4adbd; --faint: #858fa1;
  --accent: #8b85ff; --accent-soft: #23224a; --ok: #3ccf82; --ok-soft: #12291e; --bad: #ff6b70; --bad-soft: #341a1c; --on-bad: #1a0607;
  --metal: #2dd4bf; --metal-soft: #0f2a28; --awx: #ff8a4c; --awx-soft: #33200f; --claude: #ef9a76; --claude-soft: #33221b;
  --a-sourcing: #60a5fa; --a-support: #c084fc; --a-treasury: #22d3ee; --shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 32px -12px rgba(0,0,0,.6); color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #0a0c11; --surface: #12151d; --sunken: #191d27; --border: #262b37; --text: #eef1f6; --muted: #a4adbd; --faint: #858fa1;
  --accent: #8b85ff; --accent-soft: #23224a; --ok: #3ccf82; --ok-soft: #12291e; --bad: #ff6b70; --bad-soft: #341a1c; --on-bad: #1a0607;
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
/* Words for screen readers and search engines only (a link's full name, a section's heading), not shown. */
.vh { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.i { flex: none; vertical-align: -3px; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 var(--gut); }
/* Header: brand, four tabs and "More" (a <details>, no script), nothing else. */
header.top { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px); border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }
header.top .wrap { display: flex; align-items: center; gap: 12px; height: 64px; }
.brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 750; font-size: 18px; letter-spacing: -.02em; text-decoration: none; }
.brand .mk { width: 30px; height: 30px; border-radius: 9px; background: var(--text); color: var(--bg); display: grid; place-items: center; }
nav.tabs { margin-left: auto; display: flex; align-items: center; gap: 2px; background: var(--sunken); border-radius: 999px; padding: 4px; }
nav.tabs > a { text-decoration: none; font-weight: 600; font-size: 15px; line-height: 1.2; color: var(--muted); padding: 7px 14px; border-radius: 999px; white-space: nowrap; }
nav.tabs > a.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
${MORE_CSS}
nav.tabs .pmore > summary { padding: 7px 12px 7px 14px; }
/* On a phone the five items stay on one line beside the brand (checked at 360 px): the items move closer together step
   by step, and at 420 px and under the brand shows its mark only, as before. */
@media (max-width: 520px) { header.top .wrap { gap: 8px; } nav.tabs > a { padding: 7px 10px; } nav.tabs .pmore > summary { padding: 7px 8px 7px 10px; } }
@media (max-width: 460px) { nav.tabs { gap: 0; } nav.tabs > a { padding: 7px 8px; font-size: 14.5px; } nav.tabs .pmore > summary { padding: 7px 6px 7px 8px; font-size: 14.5px; } }
@media (max-width: 420px) { .brand span.nm { display: none; } }
@media (max-width: 380px) { nav.tabs > a { padding: 7px 7px; } nav.tabs .pmore > summary { padding: 7px 5px 7px 7px; } }
@media (max-width: 340px) { nav.tabs > a { padding: 7px 5px; font-size: 14px; } nav.tabs .pmore > summary { padding: 7px 4px 7px 5px; font-size: 14px; gap: 2px; } }
@media (max-width: 430px) { .brand, nav.tabs > a, nav.tabs summary { display: inline-flex; align-items: center; min-height: 44px; } }
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
.pill.run { background: var(--accent-soft); color: var(--accent); white-space: normal; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); }
/* Agent avatar. */
.av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: #fff; flex: none; }
.av .i { width: 22px; height: 22px; }
.av.sourcing { background: var(--a-sourcing); } .av.support { background: var(--a-support); } .av.treasury { background: var(--a-treasury); }
/* The stage: three agents, two rails, the CFO's phone, all showing the same step. Text at least 14 px (1080p video). */
.stage { position: relative; padding: 18px; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr) 132px; grid-template-areas: "world world" "agents agents" "bubble bubble" "rails phone"; overflow: hidden; }
.st-world { grid-area: world; display: flex; align-items: flex-start; gap: 8px; min-height: 34px; font-size: 15.5px; font-weight: 600; color: var(--muted); min-width: 0; }
.st-world .tag { flex: none; }
.st-world .txt { min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; padding-top: 2px; }
.st-agents { grid-area: agents; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ag { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 10px 4px; border-radius: 16px; transition: background .3s, transform .3s; }
.ag .nm { font-weight: 700; font-size: 15.5px; line-height: 1.2; }
.ag.on { background: var(--sunken); transform: translateY(-2px); }
/* The agents not speaking step back: the avatar fades, the words turn grey but stay readable (contrast 4.5:1 or more). */
.stage.focus .ag:not(.on) .av { opacity: .45; }
.stage.focus .ag:not(.on) .nm { color: var(--muted); }
.stage.focus .ag:not(.on) .model { color: var(--muted); background: var(--sunken); }
.ag.on .av { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--text); }
.st-bubble { grid-area: bubble; position: relative; min-height: 104px; background: var(--sunken); border-radius: 16px; padding: 12px 14px; font-size: 16.5px; line-height: 1.45; --cx: 50%; }
.st-bubble::before { content: ""; position: absolute; top: -8px; left: calc(var(--cx) - 8px); border: 8px solid transparent; border-top: 0; border-bottom-color: var(--sunken); transition: left .35s, opacity .2s; }
.st-bubble.noone::before { opacity: 0; }
.st-bubble .who { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--muted); margin-bottom: 4px; }
.st-bubble .say { margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.st-bubble.quote .say::before { content: "“"; } .st-bubble.quote .say::after { content: "”"; }
.st-bubble.idle { color: var(--faint); }
.dots { display: inline-flex; gap: 4px; } .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); animation: blink 1s infinite; } .dots i:nth-child(2) { animation-delay: .15s; } .dots i:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
.st-rails { grid-area: rails; display: grid; gap: 14px; align-content: center; min-width: 0; }
/* The lane not in play turns grey instead of fading, so its words and coin stay readable. */
.lane { display: grid; gap: 6px; }
.lane.past .ln, .lane.past.metal .ln, .lane.past.awx .ln { color: var(--muted); }
.lane.past .verdict { background: var(--sunken); color: var(--muted); }
.lane.past.metal .track, .lane.past.awx .track { background: var(--sunken); }
.lane.past.metal .coin, .lane.past.awx .coin { background: var(--muted); }
.lane .ln { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; font-size: 15px; font-weight: 750; min-height: 26px; min-width: 0; }
/* The rail's line in full, on its own row under the name and the result (never cut off). */
.lane .ln small { order: 3; flex-basis: 100%; font-weight: 550; color: var(--faint); font-size: 14px; white-space: normal; }
.lane.metal .ln { color: var(--metal); } .lane.awx .ln { color: var(--awx); }
.lane .verdict { margin-left: auto; flex: none; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.lane .verdict:empty { display: none; }
.track { position: relative; height: 40px; border-radius: 999px; background: var(--sunken); }
.track::before { content: ""; position: absolute; left: 14px; right: 14px; top: 50%; height: 2px; margin-top: -1px; background-image: linear-gradient(90deg, color-mix(in srgb, var(--text) 18%, transparent) 50%, transparent 0); background-size: 10px 2px; }
.lane.metal .track { background: var(--metal-soft); } .lane.awx .track { background: var(--awx-soft); }
.coin { position: absolute; top: 6px; left: 6px; height: 28px; min-width: 28px; padding: 0 11px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font: 700 14px/1 Inter, system-ui, sans-serif; color: #fff; white-space: nowrap; box-shadow: 0 3px 8px -2px rgba(0,0,0,.25); }
.lane.metal .coin { background: var(--metal); } .lane.awx .coin { background: var(--awx); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .lane .coin { color: #06121a; } }
:root[data-theme="dark"] .lane .coin { color: #06121a; }
.coin.bad { background: var(--bad) !important; color: var(--on-bad) !important; }
.lane.past .coin.bad { background: var(--bad-soft) !important; color: var(--bad) !important; }
.coin.ghost { background: var(--surface) !important; color: var(--muted) !important; box-shadow: inset 0 0 0 1px var(--border); }
.wall { position: absolute; top: -5px; bottom: -5px; left: 58%; width: 5px; border-radius: 4px; background: var(--bad); opacity: 0; transition: opacity .2s; }
.wall.on { opacity: 1; }
/* One pill style everywhere: rounded, 14 px, a soft ground and its own colour. */
.pill, .model, .tool, .verdict, .tag, .sig { display: inline-flex; align-items: center; gap: 5px; font: 650 14px/1.35 Inter, system-ui, sans-serif; padding: 3px 10px; border-radius: 999px; background: var(--sunken); color: var(--muted); white-space: nowrap; }
.model { color: var(--claude); background: var(--claude-soft); }
.tool { background: var(--surface); border: 1px solid var(--border); padding: 2px 9px; }
/* D2: the Claude call behind a decision, from its trace. */
.call { display: inline-flex; align-items: center; gap: 5px; font: 600 14px/1.35 Inter, system-ui, sans-serif; color: var(--claude); background: var(--claude-soft); border-radius: 8px; padding: 3px 9px; white-space: normal; font-variant-numeric: tabular-nums; }
.tag { text-transform: none; letter-spacing: 0; color: var(--faint); }
.verdict.ok { background: var(--ok-soft); color: var(--ok); } .verdict.bad { background: var(--bad-soft); color: var(--bad); } .verdict.next { background: var(--surface); color: var(--faint); }
a.verdict:hover { text-decoration: underline; }
.st-world.shield .tag { background: var(--ok-soft); color: var(--ok); }
/* The CFO's phone: a light frame that lights only for its own step. */
.st-phone { grid-area: phone; align-self: end; justify-self: end; width: 128px; min-height: 212px; border-radius: 26px; border: 2px solid var(--border); background: var(--surface); position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; padding: 20px 8px 12px; transition: border-color .3s, background .3s; }
.st-phone::before { content: ""; position: absolute; top: 8px; width: 30px; height: 5px; border-radius: 5px; background: var(--border); }
.st-phone .fid { color: var(--faint); transition: color .3s; }
.st-phone b { font-size: 15px; line-height: 1.2; }
.st-phone small { font-size: 14px; color: var(--muted); line-height: 1.25; }
.st-phone .sig { display: none; background: var(--accent-soft); color: var(--accent); white-space: normal; text-align: center; justify-content: center; }
.st-phone .sig.on { display: inline-flex; }
.st-phone .who2 { display: none; font-size: 14px; color: var(--faint); line-height: 1.25; }
.st-phone .who2.on { display: block; }
.st-phone.lit { border-color: var(--accent); background: color-mix(in srgb, var(--accent-soft) 55%, var(--surface)); }
.st-phone.lit .fid { color: var(--accent); }
.st-phone.lit.no { border-color: var(--bad); } .st-phone.lit.no .fid { color: var(--bad); }
@media (max-width: 640px) {
  .stage { padding: 14px; gap: 12px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "world" "agents" "bubble" "rails" "phone"; }
  .st-phone { width: 100%; min-height: 0; flex-direction: row; flex-wrap: wrap; justify-content: flex-start; align-items: center; gap: 6px 10px; padding: 10px 14px; border-radius: 16px; text-align: left; }
  .st-phone::before { display: none; }
  .ag { padding: 8px 2px; } .ag .nm { font-size: 14.5px; } .av { width: 40px; height: 40px; }
  .st-bubble { font-size: 15.5px; min-height: 112px; }
  /* The rail's result on its own line under the name, in full (the Metal lane was cut off at 390 px). */
  .lane .verdict { order: 4; margin-left: 0; max-width: 100%; white-space: normal; overflow: visible; }
}
/* Number tile. */
.tile { display: flex; flex-direction: column; gap: 4px; padding: 22px; text-decoration: none; transition: transform .2s, border-color .2s; }
.tile:hover { transform: translateY(-2px); border-color: var(--accent); }
.tile .v { font-size: clamp(34px, 3.6vw, 46px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.tile .l { color: var(--text); font-size: 16px; font-weight: 650; line-height: 1.3; }
.tile .x { color: var(--muted); font-size: 15px; line-height: 1.45; margin: 4px 0 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.tile .parts { display: block; font-size: 15px; font-weight: 600; color: var(--muted); margin-top: 2px; line-height: 1.4; }
.tile .parts b { color: var(--text); }
.septest { margin: 10px 0 0; font-size: 14.5px; line-height: 1.4; color: var(--muted); border-left: 3px solid var(--border); padding: 2px 0 2px 10px; }
.septest b { color: var(--text); font-weight: 650; }
.tile .note { display: block; font-size: 14px; font-weight: 500; color: var(--muted); margin-top: 4px; line-height: 1.35; }
.tile .go { margin-top: auto; padding-top: 10px; font-size: 15px; font-weight: 650; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }
footer.foot { padding: 4px 0 20px; color: var(--faint); font-size: 14.5px; }
footer.foot .wrap { display: flex; flex-wrap: wrap; gap: 0 20px; align-items: center; }
details.real { position: relative; }
/* The fold's header is a 44 px target that looks as small as before: the pill is its padding box, inside a clear border. */
details.real > summary { list-style: none; cursor: pointer; border: solid transparent; border-width: 10px 0; background-clip: padding-box; } details.real > summary::-webkit-details-marker { display: none; }
details.real { flex-basis: 100%; }
footer.foot a.flink { color: var(--muted); display: inline-flex; align-items: center; min-height: 44px; }
footer.foot .builton { flex-basis: 100%; margin: 0; color: var(--muted); line-height: 1.9; }
footer.foot .builton b { color: var(--text); font-weight: 650; }
details.real .pop { margin: 0 0 10px; max-width: 640px; padding: 16px 18px; font-size: 15px; color: var(--text); }
details.real .pop ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`;

/** The one tagline (jury QA, 6 Nov, Q8: was "Agents spend. Limits hold." in og:title): Home's heading, the film's line. */
export const HEADLINE = TAGLINE_LINE;

/** The header: the four tabs, then "More". `current` is the page's own key; menuItemOf (src/ui/more.ts) says which item it marks. */
export function header(current: PageKey | null): string {
  const item = menuItemOf(current);
  return `<header class="top"><div class="wrap"><a class="brand" href="home" aria-label="Purser, home"><span class="mk">${icon("feather", 17)}</span><span class="nm">Purser</span></a>
<nav class="tabs" aria-label="Main">${TABS.map(([k, label, href]) => `<a href="${href}"${k === item ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("")}${moreHtml(current)}</nav></div></header>`;
}

/** What is real in the main run, the run the public pages play: test money, sandbox, what is simulated, the world set-up, the second approver. */
export const MAIN_RUN_REAL = [
  `Northwind Outdoor is ${NORTHWIND_LINE}: the example company.`,
  "Real Claude decisions, real Metal testnet and Airwallex sandbox calls. Test money only.",
  // The full list behind Home's one caveat line (jury review, 6 Nov, #7: CAVEAT_LINE).
  "Simulated: the customer and its agent, the supplier, the merchants' charges, the settlement (Purser moves the SWIFT transfer to SENT, then PAID, through the sandbox's simulation API) and the second approver.",
  WORLD_SETUP,
  SECOND_APPROVER,
];
/**
 * "What's real?", opened from the footer: the main run's lines on the pages that play it, or a page's own (final review,
 * 4 Nov: /try/sign, which calls no Airwallex, Metal or Claude, carried the main run's), then the page's source. After it,
 * the product pages under "More" (pricing, security, docs, status; src/ui/more.ts), then a page's own extra links.
 */
export function footer(source: string, real: string[] = MAIN_RUN_REAL, links: [string, string][] = [], builtOn = ""): string {
  return `<footer class="foot"><div class="wrap"><details class="real" id="real"><summary class="pill">${icon("info", 15)} What's real?</summary><div class="pop card"><ul>
${real.map((line) => `<li>${esc(line)}</li>`).join("\n")}
<li>${esc(source)}</li></ul></div></details>${builtOn}<span>Built for the Airwallex Agentic Banking Hackathon</span>${footerLinks().map((l) => `<a class="flink" href="${l.href}">${l.label}</a>`).join("")}${links.map(([href, label]) => `<a class="flink" href="${esc(href)}">${esc(label)}</a>`).join("")}</div></footer>`;
}

/** Each agent's avatar: an icon for its job (Sourcing buys, Support answers, Treasury holds the money). */
export const AVATAR: Record<string, string> = { sourcing: "package", support: "headphones", treasury: "landmark" };
export const avatarHtml = (id: string, size = 22) => `<span class="av ${esc(id)}" aria-hidden="true">${icon(AVATAR[id] ?? "bot", size)}</span>`;

/** The stage's markup; the script below plays events on it. */
export function stageHtml(agents: { id: string; short: string; family: string }[], start: string): string {
  return `<div class="stage card" data-stage role="group" aria-label="The agents at work, replayed from the recorded run">
<div class="st-world" aria-live="polite"><span class="tag">World</span><span class="txt">${esc(start)}</span></div>
<div class="st-agents">${agents.map((a) => `<div class="ag" data-agent="${esc(a.id)}">${avatarHtml(a.id)}<span class="nm">${esc(a.short)}</span><span class="model">${esc(a.family)}</span></div>`).join("")}</div>
<div class="st-bubble idle noone" aria-live="polite"><div class="who"></div><p class="say">The agents wait for the world to change.</p></div>
<div class="st-rails">
  <div class="lane metal"><div class="ln">Metal <small>stablecoin per query · x402</small><span class="verdict"></span></div><div class="track"><i class="wall"></i></div></div>
  <div class="lane awx"><div class="ln">Airwallex <small>card · FX · SWIFT</small><span class="verdict"></span></div><div class="track"><i class="wall"></i></div></div>
</div>
<div class="st-phone" role="img" aria-label="The CFO's phone">${icon("scan-face", 30).replace('class="i"', 'class="i fid"')}<b>CFO</b><small>Face ID</small><span class="sig"></span><span class="who2"></span></div>
</div>`;
}

/**
 * The stage player of the replay at /watch (the whole run with controls). Every part of the stage shows the same step:
 * the message, the lane of the money and the phone. It reads the run from the page's data block and sets only
 * textContent and attributes, so nothing from the record becomes markup. It shows no tool names and no proposal
 * numbers: those are in the page's fold, with every step.
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
    root.classList.toggle("focus", !!agent);
    root.querySelectorAll(".ag").forEach(function (el) { el.classList.toggle("on", el.getAttribute("data-agent") === agent); });
    bubble.classList.toggle("noone", !(agent && names[agent]));
    if (agent && names[agent]) bubble.style.setProperty("--cx", (names[agent].i * 2 + 1) / 6 * 100 + "%");
  }
  // Several payments of one amount say so, and their total (jury review, 7 Nov, #24): "3 × 0.05 test USD (0.15)".
  function amount(ev) {
    if (!ev.amount) return "";
    var one = ev.unit === "EUR" ? "EUR " + ev.amount : ev.unit === "USD" ? "USD " + ev.amount : ev.amount + " test USD";
    return ev.count > 1 ? ev.count + " × " + one + " (" + (Math.round(parseFloat(ev.amount) * 100) * ev.count / 100).toFixed(2) + ")" : one;
  }
  /** What happened to a payment, in plain words; the raw code goes into the tooltip. */
  function result(ev) {
    var r = ev.refused;
    if (!r) return ev.dir === "in" ? "received" : /refund/i.test(ev.what) ? "refunded" : "paid";
    if (r.by === "recorded") return "refused before signing, and recorded on chain";
    if (r.by === "metal") return "refused by Metal: " + r.reason;
    if (r.by === "airwallex-sandbox") return (ev.earlier ? "earlier attempt, nothing paid: " : "not paid: ") + "Airwallex's sandbox could not price the fee (not a limit)";
    if (r.by === "airwallex") return "declined by Airwallex: " + r.reason;
    return "refused before signing";
  }
  function verdictText(ev) {
    var r = ev.refused;
    if (!r) return "✓ " + result(ev);
    if (r.by === "recorded") return "✕ Refused · recorded on chain" + (ev.proof && ev.proof.href ? " ↗" : "");
    if (r.by === "metal") return "✕ Refused by Metal" + (ev.proof && ev.proof.href ? " · on chain ↗" : "");
    if (r.by === "airwallex-sandbox") return ev.earlier ? "✕ Earlier attempt · nothing paid" : "✕ Not paid · fee not priced";
    if (r.by === "airwallex") return "✕ Declined by Airwallex";
    return "✕ Refused before signing";
  }
  function tooltip(ev) {
    var r = ev.refused;
    if (!r) return ev.proof && ev.proof.label || "";
    return (r.by === "recorded" ? "Purser refused it before signing; Metal recorded the same refusal on chain" : r.reason) + (r.code ? " (" + r.code + ")" : "");
  }
  function speak(ev, sentences, instant) {
    focus(ev.agent);
    var who = bubble.querySelector(".who"), say = bubble.querySelector(".say");
    who.textContent = "";
    var n = names[ev.agent] || { short: ev.agent };
    var b = document.createElement("span"); b.textContent = n.short + (ev.k === "msg" ? " · message" : ev.by === "claude" ? " · decided by Claude" : " · fallback (code)"); who.appendChild(b);
    if (ev.badge) { var k = document.createElement("span"); k.className = "call"; k.textContent = ev.badge; k.title = ev.tip || ""; who.appendChild(k); }
    bubble.classList.remove("idle"); bubble.classList.add("quote");
    var text = first(ev.text, sentences);
    if (instant || reduce) { say.textContent = text; return; }
    say.textContent = ""; var d = document.createElement("span"); d.className = "dots"; d.appendChild(document.createElement("i")); d.appendChild(document.createElement("i")); d.appendChild(document.createElement("i")); say.appendChild(d);
    later(function () { say.textContent = text; }, 650);
  }
  /** The same step, said in the bubble when no agent speaks: what moved, who signed, what changed. */
  function caption(label, text, agent) {
    focus(agent || null);
    bubble.classList.remove("idle", "quote");
    var who = bubble.querySelector(".who"); who.textContent = "";
    var b = document.createElement("span"); b.textContent = label; who.appendChild(b);
    bubble.querySelector(".say").textContent = text;
  }
  function setVerdict(lane, ev, cls, href, title, text) {
    var old = lane.querySelector(".verdict"), v = document.createElement(href ? "a" : "span");
    v.className = "verdict" + (cls ? " " + cls : "");
    if (href) { v.href = href; v.target = "_blank"; v.rel = "noopener"; }
    if (title) v.title = title;
    v.textContent = text || "";
    old.replaceWith(v);
  }
  function move(ev, instant, ghost) {
    var lane = lanes[ev.rail || "metal"]; if (!lane) return;
    var track = lane.querySelector(".track"), wall = lane.querySelector(".wall");
    track.querySelectorAll(".coin").forEach(function (c) { c.remove(); });
    wall.classList.remove("on"); setVerdict(lane, null, "", null, "", "");
    var coin = document.createElement("span"); coin.className = "coin" + (ghost ? " ghost" : ""); coin.textContent = ev.label;
    track.appendChild(coin);
    var w = Math.max(0, track.clientWidth - coin.offsetWidth - 12);
    var stop = ev.refused ? Math.max(0, track.clientWidth * 0.58 - coin.offsetWidth - 8) : w;
    var from = ev.dir === "in" ? w : 0, to = ev.dir === "in" ? 0 : stop;
    function done() {
      coin.style.transform = "translateX(" + to + "px)";
      if (ghost) { setVerdict(lane, ev, "next", null, "", "later in this run"); return; }
      if (ev.k === "mandate") { setVerdict(lane, ev, "ok", ev.proof.href, "The new mandate, bound on chain", "✓ Replaced on chain ↗"); return; }
      if (ev.refused) { wall.classList.add("on"); coin.classList.add("bad"); }
      setVerdict(lane, ev, ev.refused ? "bad" : "ok", ev.refused && ev.proof && ev.proof.href ? ev.proof.href : null, tooltip(ev), verdictText(ev));
    }
    if (instant || ghost || reduce || !coin.animate) { done(); return; }
    var a = coin.animate([{ transform: "translateX(" + from + "px)" }, { transform: "translateX(" + to + "px)" }], { duration: 1150, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
    a.onfinish = done;
  }
  function lanesFor(ev) {
    var active = ev.k === "money" ? ev.rail : ev.k === "mandate" ? "metal" : null;
    ["metal", "airwallex"].forEach(function (k) { lanes[k].classList.toggle("past", k !== active); });
  }
  function setPhone(head, sub, sig, who2) {
    phone.querySelector("b").textContent = head; phone.querySelector("small").textContent = sub;
    var s = phone.querySelector(".sig"); s.textContent = sig || ""; s.classList.toggle("on", !!sig);
    var w = phone.querySelector(".who2"); w.textContent = who2 || ""; w.classList.toggle("on", !!who2);
  }
  function phoneIdle() { phone.classList.remove("lit", "no"); setPhone("CFO", "Face ID", "", ""); }
  function face(ev) {
    var n = ev.signers.length, rej = ev.status === "REJECTED", sub = ev.title;
    phone.classList.add("lit"); phone.classList.toggle("no", rej);
    if (ev.status === "COSIGNED") {
      setPhone("Signed", sub, "1 of 2 signatures", "waiting for the second approver");
      caption("CFO · Face ID", ev.signers[0] + " signed " + ev.title.toLowerCase() + " with Face ID: 1 of 2 signatures. It waits for the second approver.");
    } else if (n > 1) {
      setPhone(rej ? "Rejected" : "Approved", sub, n + " of " + n + " signatures", "second approver: labelled test passkey");
      caption("CFO · Face ID", (rej ? "Rejected" : "Approved") + " by " + ev.signers.join(" and ") + ": " + n + " of " + n + " signatures. The second approver is a labelled test passkey in this demo.");
    } else {
      setPhone(rej ? "Rejected" : "Approved", sub, "", "");
      caption("CFO · Face ID", ev.signers.join(" and ") + (rej ? " rejected " : " approved ") + ev.title.toLowerCase() + " with Face ID.");
    }
  }
  function show(ev, opts) {
    var instant = opts && opts.instant, sentences = (opts && opts.sentences) || 1;
    if (ev.k !== "face") phoneIdle();
    lanesFor(ev);
    if (ev.k === "world") { setWorld(ev.text); caption("The world changes", ev.text, null); return 2600; }
    if (ev.k === "shield") { setWorld(ev.text, true); caption("Blocked", ev.text, null); return 2400; }
    if (ev.k === "say" || ev.k === "msg") { speak(ev, sentences, instant); return Math.min(6500, 2600 + first(ev.text, sentences).length * 22); }
    if (ev.k === "money") {
      var rail = (ev.rail === "metal" ? "Metal · " + ev.via : "Airwallex · " + ev.via) + (ev.run ? " · " + ev.run : "");
      caption(rail, (amount(ev) ? amount(ev) + " · " : "") + ev.what + ": " + result(ev).replace(/[.]$/, "") + ".", ev.agent);
      move(ev, instant); return ev.refused ? 3200 : 2200;
    }
    if (ev.k === "mandate") {
      caption("Metal · new mandate", "Mandate replaced on chain: " + (names[ev.agent] ? names[ev.agent].short : ev.agent) + " agent, cap " + ev.cap + ", budget " + ev.budget + ".", ev.agent);
      move({ k: "mandate", rail: "metal", dir: "out", label: (names[ev.agent] ? names[ev.agent].short : ev.agent) + " cap " + ev.cap, refused: null, proof: ev.proof, what: "" }, instant);
      return 2400;
    }
    if (ev.k === "face") { face(ev); return 3000; }
    if (ev.k === "routine") { caption("Routine checks", ev.text + ".", null); return 1800; }
    return 1000;
  }
  /** Never an empty rail: each lane shows its latest movement before this point, or else the next one, marked as later. */
  function prime(events, at) {
    ["metal", "airwallex"].forEach(function (rail) {
      var past = null, next = null;
      for (var i = 0; i < events.length; i++) { var e = events[i]; if (e.k !== "money" || e.rail !== rail) continue; if (i < at) past = e; else if (!next) next = e; }
      if (past) move(past, true); else if (next) move(next, true, true);
      lanes[rail].classList.add("past");
    });
  }
  function reset() { clear(); focus(null); phoneIdle(); setWorld(world.getAttribute("data-start")); bubble.classList.add("idle"); bubble.classList.remove("quote"); bubble.querySelector(".who").textContent = ""; bubble.querySelector(".say").textContent = "The agents wait for the world to change."; }
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
main { max-width: 1200px !important; padding: 28px max(16px, min(32px, 4vw)) 64px !important; }
.step:not(.show) { display: none !important; }
.worlds { margin-top: 40px !important; padding-top: 28px !important; }
button.run { background: var(--text) !important; color: var(--bg) !important; }
.kicker { color: var(--muted) !important; }
</style>`);
}

/**
 * Opens the fold a link points into (D: /proof's "Policy and card side by side" → /airwallex#controls). When the page is
 * opened, or its #hash changes, to an element that is a <details> or sits inside one, every closed <details> around it
 * opens and the element is scrolled to. No browser does this for a <details> itself, and not all of them for what is
 * inside one, so it is a few lines of script, hashed into the page's CSP like every inline script here.
 */
export const OPEN_TARGET_JS = `(function () {
  function openTarget() {
    var id; try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    var t = id && document.getElementById(id);
    if (!t) return;
    var opened = false;
    for (var d = t.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) if (!d.open) { d.open = true; opened = true; }
    if (opened) t.scrollIntoView({ block: "start" });
  }
  openTarget();
  window.addEventListener("hashchange", openTarget);
})();`;

/** A page around a body: one style, one script, the run's data in a data block ("<" escaped). */
export function page(o: { title: string; description: string; tab: PageKey | null; css: string; body: string; data?: unknown; js?: string; stage?: boolean; source: string; real?: string[]; links?: [string, string][]; /** The partner pages' "Built on" strip (src/redesign/partners.ts builtOnHtml). */ builtOn?: string }): string {
  const script = o.js === undefined ? "" : `${o.data === undefined ? "" : `<script type="application/json" id="run-data">${JSON.stringify(o.data).replace(/</g, "\\u003c")}</script>\n`}<script>${o.stage === false ? "" : STAGE_JS}
${o.js}</script>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(o.description)}">
<meta name="theme-color" content="#0b1220">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Purser">
<meta property="og:title" content="${esc(ogTitle(o.title))}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<title>${esc(o.title)}</title>
<style>${CSS}
${o.css}</style>
</head>
<body>
${header(o.tab)}
${o.body}
${footer(o.source, o.real, o.links, o.builtOn)}
${script}
</body>
</html>`;
}
