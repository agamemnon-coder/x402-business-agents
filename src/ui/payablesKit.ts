// The payables pages' look, without anything Node-only: the stylesheet on the design system's tokens, the icons and
// attribute escaping. The local pages (src/servers/payablesPage.ts) and Purser Cloud's console (cloud/src/console.ts)
// both use it, so the two look the same.

import { TOKENS } from "../redesign/ui.js";
import { ICONS, type Icon } from "./icons.js";

export const MORE: Record<string, Icon> = {
  mail: [["rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }], ["path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" }]],
  upload: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["polyline", { points: "17 8 12 3 7 8" }], ["line", { x1: "12", y1: "3", x2: "12", y2: "15" }]],
  "arrow-left": [["path", { d: "m12 19-7-7 7-7" }], ["path", { d: "M19 12H5" }]],
  "file-text": [["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }], ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }], ["path", { d: "M16 13H8" }], ["path", { d: "M16 17H8" }], ["path", { d: "M10 9H8" }]],
  "refresh-cw": [["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }], ["path", { d: "M21 3v5h-5" }], ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }], ["path", { d: "M8 16H3v5" }]],
  download: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["polyline", { points: "7 10 12 15 17 10" }], ["line", { x1: "12", y1: "15", x2: "12", y2: "3" }]],
  inbox: [["polyline", { points: "22 12 16 12 14 15 10 15 8 12 2 12" }], ["path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }]],
  "circle-minus": [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M8 12h8" }]],
  "circle-x": [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "m15 9-6 6" }], ["path", { d: "m9 9 6 6" }]],
  "circle-pause": [["circle", { cx: "12", cy: "12", r: "10" }], ["line", { x1: "10", y1: "15", x2: "10", y2: "9" }], ["line", { x1: "14", y1: "15", x2: "14", y2: "9" }]],
  "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
  "arrow-down-left": [["path", { d: "M17 7 7 17" }], ["path", { d: "M17 17H7V7" }]],
  "arrow-up-right": [["path", { d: "M7 7h10v10" }], ["path", { d: "M7 17 17 7" }]],
  x: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
  "key-round": [["path", { d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" }], ["circle", { cx: "16.5", cy: "7.5", r: ".5", fill: "currentColor" }]],
  "log-out": [["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }], ["polyline", { points: "16 17 21 12 16 7" }], ["line", { x1: "21", y1: "12", x2: "9", y2: "12" }]],
  copy: [["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }], ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]],
  "flask": [["path", { d: "M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" }], ["path", { d: "M8.5 2h7" }], ["path", { d: "M7 16h10" }]],
};
const attr = (a: Record<string, string>) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ");
/** An inline icon in currentColor (markup built here, never from data). */
export function svg(name: string, size = 18): string {
  const shapes = ICONS[name] ?? MORE[name];
  if (!shapes) throw new Error(`no icon ${name}`);
  return `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes.map(([s, a]) => `<${s} ${attr(a)}/>`).join("")}</svg>`;
}
export const ICON_SET = (names: string[]) => JSON.stringify(Object.fromEntries(names.map((n) => [n, svg(n, 16)])));
export const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const PAYABLES_CSS = `${TOKENS.replace("url(assets/inter.woff2)", "url(/assets/inter.woff2)")}
:root { --warn: #a15c00; --warn-soft: #fff4e0; --r: 18px; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --warn: #ffb547; --warn-soft: #33260f; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 15px/1.5 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
a { color: inherit; }
.i { flex: none; vertical-align: -3px; }
.num { font-variant-numeric: tabular-nums; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 0 var(--gut); }
@media (min-width: 720px) { :root { --gut: 28px; } }
header.top { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 84%, transparent); backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px); border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }
header.top .wrap { display: flex; align-items: center; gap: 12px; height: 60px; }
.brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 750; font-size: 17px; letter-spacing: -.02em; text-decoration: none; }
.brand .mk { width: 28px; height: 28px; border-radius: 8px; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 15px; }
.brand .sec { color: var(--muted); font-weight: 600; }
.lang { margin-left: auto; color: var(--muted); font: 600 13px/1 Inter, system-ui, sans-serif; text-decoration: none; padding: 7px 9px; border-radius: 9px; white-space: nowrap; }
.lang:hover { color: var(--text); background: var(--sunken); }
.lang + .test { margin-left: 0; }
.lang .ls { display: none; }
@media (max-width: 640px) { .lang .ll { display: none; } .lang .ls { display: inline; } .lang { padding: 7px 6px; } .test .tl { display: none; } }
.test { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font: 650 13px/1 Inter, system-ui, sans-serif; color: var(--warn); background: var(--warn-soft); padding: 7px 11px; border-radius: 999px; white-space: nowrap; }
main { padding: 24px 0 64px; }
h1, h2, h3 { margin: 0; letter-spacing: -.02em; line-height: 1.15; }
h1 { font-size: clamp(26px, 3.2vw, 34px); font-weight: 760; }
h2 { font-size: 17px; font-weight: 700; }
.lede { color: var(--muted); margin: 6px 0 0; max-width: 60ch; }
.head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; justify-content: space-between; }
.tools { display: flex; flex-wrap: wrap; gap: 8px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 40px; padding: 0 16px; border-radius: 999px; font: 650 14px/1 Inter, system-ui, sans-serif; text-decoration: none; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; white-space: nowrap; }
.btn:hover:not(:disabled) { border-color: color-mix(in srgb, var(--text) 30%, var(--border)); }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn.danger { color: var(--bad); }
.btn.big { height: 48px; padding: 0 22px; font-size: 15px; }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn:focus-visible, a:focus-visible, button:focus-visible, textarea:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); }
.inbox { margin: 14px 0 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 14px; }
.inbox b { color: var(--text); overflow-wrap: anywhere; }
.drop { margin-top: 20px; display: flex; align-items: center; gap: 16px; padding: 18px 20px; border: 1.5px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: var(--r); background: color-mix(in srgb, var(--accent-soft) 55%, var(--surface)); }
.drop.over { border-color: var(--accent); background: var(--accent-soft); }
.drop .ic { width: 44px; height: 44px; border-radius: 12px; background: var(--surface); color: var(--accent); display: grid; place-items: center; border: 1px solid var(--border); flex: none; }
.drop b { display: block; font-weight: 650; }
.drop span.sub { color: var(--muted); font-size: 14px; }
.drop .btn { margin-left: auto; }
.drop input { position: absolute; width: 1px; height: 1px; opacity: 0; }
#msg { min-height: 22px; margin: 8px 2px 0; color: var(--muted); font-size: 14px; }
#msg.bad { color: var(--bad); } #msg.ok { color: var(--ok); }
.tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
@media (max-width: 1100px) { .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } }
.tile { padding: 16px 18px; min-width: 0; }
.tile .l { color: var(--muted); font-size: 13px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; display: flex; align-items: center; gap: 6px; }
.tile .v { margin-top: 6px; font-size: clamp(22px, 2.3vw, 28px); font-weight: 760; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile .v small { font-size: .62em; font-weight: 650; color: var(--muted); margin-right: 4px; }
.tile .x { color: var(--muted); font-size: 13px; margin-top: 6px; line-height: 1.35; overflow-wrap: anywhere; }
.tile.alert .v { color: var(--bad); } .tile.calm .v { color: var(--ok); }
.section { margin-top: 28px; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.bar h2 { margin-right: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); font: 600 13px/1 Inter, system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
.chip b { color: var(--text); font-weight: 700; }
.chip[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.chip[aria-pressed="true"] b { color: var(--bg); }
.list { overflow: hidden; }
.pick { width: 18px; height: 18px; margin: 0 10px 0 0; vertical-align: -3px; accent-color: var(--accent); cursor: pointer; }
.batchbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px 16px; margin: 0 0 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.batchbar[hidden] { display: none; }
.batchbar .what { flex: 1 1 220px; color: var(--muted); }
.batchbar .what b { color: var(--text); }
.row { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(0, 1.3fr) 104px 138px 196px minmax(0, 2.4fr) 18px; align-items: center; gap: 14px; padding: 13px 18px; border-top: 1px solid var(--border); text-decoration: none; color: inherit; min-height: 58px; }
.row:first-child { border-top: 0; }
.row.th { min-height: 0; padding-top: 11px; padding-bottom: 11px; color: var(--muted); font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; background: var(--sunken); }
a.row:hover { background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface)); }
.row > * { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .sup { font-weight: 650; }
/* A supplier's name and the reason wrap onto a second line rather than end in an ellipsis (screenshot pass, 9 Nov). */
.row > .sup, .row > .why { white-space: normal; overflow-wrap: anywhere; line-height: 1.35; }
.row .sub { display: block; color: var(--muted); font-size: 12.5px; font-weight: 500; }
.row .amt { text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; }
.row .amt .c { color: var(--muted); font-weight: 600; font-size: 12.5px; margin-right: 4px; }
.row .why { color: var(--muted); font-size: 13.5px; }
.row .go { color: var(--faint); }
.row .due.late { color: var(--bad); font-weight: 600; }
.st { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 10px 4px 8px; border-radius: 14px; font: 650 12.5px/1.25 Inter, system-ui, sans-serif; white-space: normal; overflow-wrap: anywhere; background: var(--sunken); color: var(--muted); }
.st::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.st.ready { background: var(--accent-soft); color: var(--accent); }
.st.paid { background: var(--ok-soft); color: var(--ok); }
.st.blocked, .st.rejected { background: var(--bad-soft); color: var(--bad); }
.st.needs_review, .st.needs_vendor, .st.waiting_cfo { background: var(--warn-soft); color: var(--warn); }
.empty { padding: 44px 20px; text-align: center; color: var(--muted); }
.empty b { display: block; color: var(--text); font-size: 16px; margin-bottom: 4px; }
@media (max-width: 860px) {
  .row.th { display: none; }
  .row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "sup amt" "st no" "why why"; gap: 5px 12px; padding: 14px 16px; }
  .row .sup { grid-area: sup; } .row .amt { grid-area: amt; } .row .no { grid-area: no; color: var(--muted); font-size: 13px; text-align: right; }
  .row .no .sub { display: inline; margin-left: 6px; } .row > .stc { grid-area: st; } .row .why { grid-area: why; } .row .due, .row .go { display: none; }
  .drop { flex-wrap: wrap; } .drop .btn { margin-left: 0; width: 100%; } .drop .sub2 { display: none; }
  .tools .btn { height: 36px; padding: 0 13px; font-size: 13px; }
}
@media (max-width: 640px) { .tiles .tile:last-child { grid-column: span 2; } }
.grid2 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
.mini { padding: 16px 18px; min-width: 0; }
.mini h3 { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
.kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; font-size: 14px; }
.kv > span:nth-child(odd) { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kv > span:nth-child(even) { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.foot { margin-top: 26px; color: var(--faint); font-size: 13px; }
/* Detail */
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); text-decoration: none; font-weight: 600; font-size: 14px; }
.back:hover { color: var(--text); }
.dhead { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 16px 28px; align-items: flex-start; justify-content: space-between; }
.dhead .who { min-width: 0; }
.dhead .meta { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; color: var(--muted); font-size: 14px; }
.dhead .money { text-align: right; }
.dhead .money .big { font-size: clamp(30px, 3.6vw, 42px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; white-space: nowrap; }
.dhead .money .big small { font-size: .5em; color: var(--muted); font-weight: 650; margin-right: 6px; letter-spacing: 0; }
.dhead .money .when { color: var(--muted); font-size: 14px; margin-top: 4px; }
.actions { margin-top: 18px; padding: 14px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.actions .note { color: var(--muted); font-size: 13.5px; flex: 1 1 260px; min-width: 0; }
.actions .note b { color: var(--text); font-weight: 650; }
.actions p:empty { display: none; }
.rejectbox { margin-top: 10px; padding: 14px 16px; display: none; gap: 10px; flex-direction: column; }
.rejectbox.open { display: flex; }
.rejectbox textarea { font: inherit; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: var(--text); min-height: 72px; resize: vertical; }
.rejectbox .row2 { display: flex; gap: 8px; flex-wrap: wrap; }
.split { margin-top: 18px; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 980px) { .split { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .dhead .money { text-align: left; } }
.docv { position: sticky; top: 76px; overflow: hidden; }
@media (max-width: 980px) { .docv { position: static; } }
.docv .bar2 { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 14px; }
.docv .bar2 .fn { font-weight: 650; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.docv .bar2 a { margin-left: auto; color: var(--accent); text-decoration: none; font-weight: 650; white-space: nowrap; display: inline-flex; gap: 5px; align-items: center; }
.pages { background: var(--sunken); padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 14px; max-height: calc(100vh - 170px); overflow: auto; }
@media (max-width: 980px) { .pages { max-height: none; } .pages canvas { max-height: none; width: 100%; } }
.pages canvas { display: block; width: auto; height: auto; max-width: 100%; max-height: calc(100vh - 230px); background: #fff; border-radius: 6px; box-shadow: 0 1px 2px rgba(16,24,40,.08), 0 8px 24px -8px rgba(16,24,40,.18); }
.pages .wait { color: var(--muted); padding: 60px 0; font-size: 14px; }
.stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.panel { padding: 18px 20px; min-width: 0; }
.panel h2 { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.panel h2 .cnt { margin-left: auto; color: var(--muted); font-size: 13px; font-weight: 600; }
dl.read { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 9px 16px; margin: 0; font-size: 14px; }
dl.read dt { color: var(--muted); }
dl.read dd { margin: 0; font-weight: 550; min-width: 0; overflow-wrap: anywhere; }
dl.read dd.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; font-weight: 500; }
dl.read dd.line { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; background: var(--sunken); padding: 6px 9px; border-radius: 8px; }
@media (max-width: 520px) { dl.read { grid-template-columns: 1fr; gap: 2px; } dl.read dd { margin-bottom: 8px; } }
ul.checks { list-style: none; margin: 0; padding: 0; }
ul.checks li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 4px 10px; padding: 9px 0; border-top: 1px solid var(--border); font-size: 14px; align-items: start; }
ul.checks li:first-child { border-top: 0; padding-top: 2px; }
ul.checks .ic { padding-top: 1px; }
ul.checks .t { font-weight: 600; }
ul.checks .r { font-size: 12.5px; font-weight: 650; white-space: nowrap; }
ul.checks .why { grid-column: 2 / 4; color: var(--muted); font-size: 13.5px; }
.res-passed { color: var(--ok); } .res-block { color: var(--bad); } .res-review, .res-wait, .res-warn { color: var(--warn); } .res-not_checked { color: var(--faint); }
.notecard { padding: 16px 20px; border-left: 4px solid var(--warn); }
.notecard .who { font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--warn); }
.notecard p { margin: 6px 0 0; font-size: 14.5px; }
ol.tl { list-style: none; margin: 0; padding: 0; position: relative; }
ol.tl li { position: relative; padding: 0 0 14px 22px; font-size: 14px; }
ol.tl li::before { content: ""; position: absolute; left: 4px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
ol.tl li::after { content: ""; position: absolute; left: 8px; top: 18px; bottom: 0; width: 1px; background: var(--border); }
ol.tl li:last-child::after { display: none; } ol.tl li:last-child { padding-bottom: 0; }
ol.tl .w { font-weight: 650; } ol.tl .at { color: var(--faint); font-size: 12.5px; margin-left: 6px; font-variant-numeric: tabular-nums; }
ol.tl .d { color: var(--muted); font-size: 13.5px; overflow-wrap: anywhere; }
.banner { margin-top: 14px; display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-radius: 12px; background: var(--warn-soft); color: var(--warn); font-size: 13.5px; font-weight: 600; }
/* Navigation between the pages */
nav.tabs { display: flex; gap: 4px; margin-left: 14px; }
nav.tabs a { text-decoration: none; color: var(--muted); font-weight: 650; font-size: 14px; padding: 7px 12px; border-radius: 999px; white-space: nowrap; }
nav.tabs a:hover { color: var(--text); }
nav.tabs a[aria-current="page"] { background: var(--sunken); color: var(--text); }
@media (max-width: 640px) { .brand > span:not(.mk) { display: none; } nav.tabs { margin-left: 2px; } nav.tabs a { padding: 7px 9px; font-size: 13.5px; } .test { padding: 7px 9px; font-size: 12.5px; } }
/* Transactions */
.sel { display: inline-flex; align-items: center; height: 32px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 600 13px/1 Inter, system-ui, sans-serif; padding: 0 10px; }
.bar .grow { flex: 1 1 auto; }
.search { height: 32px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 500 13px/1 Inter, system-ui, sans-serif; padding: 0 12px; min-width: 0; width: 200px; }
.trow { display: grid; grid-template-columns: 112px minmax(0, 2.6fr) minmax(0, 1.2fr) 150px 170px 178px 18px; align-items: center; gap: 14px; padding: 12px 18px; border-top: 1px solid var(--border); color: inherit; min-height: 56px; cursor: pointer; text-align: left; width: 100%; background: none; border-left: 0; border-right: 0; border-bottom: 0; font: inherit; }
.trow:first-child { border-top: 0; }
.trow.th { cursor: default; min-height: 0; padding-top: 11px; padding-bottom: 11px; color: var(--muted); font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; background: var(--sunken); }
button.trow:hover { background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface)); }
.trow > * { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trow .when { color: var(--muted); font-size: 13.5px; font-variant-numeric: tabular-nums; }
.trow .what { font-weight: 650; }
.trow .what .sub, .trow .rail .sub { display: block; color: var(--muted); font-size: 12.5px; font-weight: 500; }
.trow .rail { font-size: 13.5px; }
.trow .amt { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.trow .amt .c { color: var(--muted); font-weight: 600; font-size: 12.5px; margin-right: 4px; }
.trow .amt.in { color: var(--ok); } .trow .amt.void { color: var(--faint); text-decoration: line-through; font-weight: 600; }
.trow .go { color: var(--faint); }
.dir { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; margin-right: 8px; vertical-align: -6px; background: var(--sunken); color: var(--muted); }
.dir.in { background: var(--ok-soft); color: var(--ok); } .dir.out { background: var(--sunken); color: var(--text); }
.st.moved { background: var(--ok-soft); color: var(--ok); }
.st.void { background: var(--bad-soft); color: var(--bad); }
.st.idle { background: var(--sunken); color: var(--muted); }
.st.matched { background: var(--ok-soft); color: var(--ok); }
.st.not_applicable { background: var(--sunken); color: var(--faint); }
.st.missing_booking, .st.missing_rail_record { background: var(--warn-soft); color: var(--warn); }
.st.amount_mismatch { background: var(--bad-soft); color: var(--bad); }
@media (max-width: 960px) {
  .trow.th { display: none; }
  .trow { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "what amt" "when rail" "st rec"; gap: 6px 12px; padding: 14px 16px; }
  .trow .what { grid-area: what; } .trow .amt { grid-area: amt; } .trow .when { grid-area: when; } .trow .rail { grid-area: rail; text-align: right; color: var(--muted); }
  .trow .rail .sub { display: none; } .trow > .stc { grid-area: st; } .trow > .recc { grid-area: rec; text-align: right; } .trow .go { display: none; }
  .search { width: 100%; order: 10; }
}
.scrim { position: fixed; inset: 0; background: rgba(10, 14, 22, .38); z-index: 40; display: none; }
.scrim.open { display: block; }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(520px, 100vw); z-index: 41; background: var(--surface); border-left: 1px solid var(--border); box-shadow: -24px 0 48px -24px rgba(16,24,40,.3); transform: translateX(105%); transition: transform .18s ease; overflow-y: auto; padding: 20px 22px 40px; }
.drawer.open { transform: none; }
.drawer .x { position: absolute; top: 14px; right: 14px; width: 40px; padding: 0; }
.drawer .x:focus-visible { outline-offset: -3px; }
.drawer .kicker { margin-right: 52px; color: var(--muted); font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.drawer h2 { font-size: 20px; margin: 6px 40px 0 0; }
.drawer .big { margin-top: 10px; font-size: 32px; font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.drawer .big small { font-size: .5em; color: var(--muted); font-weight: 650; margin-right: 6px; }
.drawer .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.drawer section { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border); }
.drawer section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; margin-bottom: 10px; }
.drawer dl.read { grid-template-columns: 130px minmax(0, 1fr); }
.drawer .flag { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; background: var(--warn-soft); color: var(--warn); font-size: 13.5px; font-weight: 600; margin-top: 8px; }
.drawer .flag.ok { background: var(--ok-soft); color: var(--ok); }
`;
