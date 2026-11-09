// The payables pages (src/servers/payables.ts): the overview at / and one invoice at /invoices/:id. Built on the
// design system's tokens (src/redesign/ui.ts), light and dark. Each page carries one inline module script with the
// response's nonce (no 'unsafe-inline' scripts), renders every value from the JSON routes with textContent, never as
// HTML, and posts with this page's own token. The invoice's document is drawn by pdf.js from this origin
// (/assets/pdfjs.mjs, without eval): the supplier's file is never opened as a page here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOKENS } from "../redesign/ui.js";
import { ICONS, type Icon } from "../ui/icons.js";

/** Inter (OFL, src/ui/inter-LICENSE.txt). */
export const FONT = readFileSync(new URL("../ui/inter.woff2", import.meta.url));
/** pdf.js as unpdf ships it (the pinned dependency the inbox already reads documents with). */
export const PDFJS = readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")));

const MORE: Record<string, Icon> = {
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
const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const CSS = `${TOKENS.replace("url(assets/inter.woff2)", "url(/assets/inter.woff2)")}
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
.tile .x { color: var(--muted); font-size: 13px; margin-top: 6px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile.alert .v { color: var(--bad); } .tile.calm .v { color: var(--ok); }
.section { margin-top: 28px; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.bar h2 { margin-right: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); font: 600 13px/1 Inter, system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
.chip b { color: var(--text); font-weight: 700; }
.chip[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.chip[aria-pressed="true"] b { color: var(--bg); }
.list { overflow: hidden; }
.row { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(0, 1.3fr) 104px 138px 196px minmax(0, 2.4fr) 18px; align-items: center; gap: 14px; padding: 13px 18px; border-top: 1px solid var(--border); text-decoration: none; color: inherit; min-height: 58px; }
.row:first-child { border-top: 0; }
.row.th { min-height: 0; padding-top: 11px; padding-bottom: 11px; color: var(--muted); font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; background: var(--sunken); }
a.row:hover { background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface)); }
.row > * { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .sup { font-weight: 650; }
.row .sub { display: block; color: var(--muted); font-size: 12.5px; font-weight: 500; }
.row .amt { text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; }
.row .amt .c { color: var(--muted); font-weight: 600; font-size: 12.5px; margin-right: 4px; }
.row .why { color: var(--muted); font-size: 13.5px; }
.row .go { color: var(--faint); }
.row .due.late { color: var(--bad); font-weight: 600; }
.st { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 10px 4px 8px; border-radius: 999px; font: 650 12.5px/1.2 Inter, system-ui, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: var(--sunken); color: var(--muted); }
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
@media (max-width: 640px) { .brand .sec { display: none; } nav.tabs { margin-left: 6px; } nav.tabs a { padding: 7px 9px; font-size: 13.5px; } .test .tl { display: none; } }
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
.drawer .x { position: absolute; top: 14px; right: 14px; }
.drawer .kicker { color: var(--muted); font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
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

export const shell = (o: { title: string; csrf: string; nonce: string; body: string; script: string; page?: "invoices" | "transactions" }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf" content="${o.csrf}">
<meta name="color-scheme" content="light dark">
<title>${escAttr(o.title)}</title>
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a class="brand" href="/"><span class="mk">P</span><span>Purser</span><span class="sec">Payables</span></a>
<nav class="tabs" aria-label="Pages"><a href="/"${o.page === "transactions" ? "" : ' aria-current="page"'}>Invoices</a><a href="/transactions"${o.page === "transactions" ? ' aria-current="page"' : ""}>Transactions</a></nav>
<span class="test" title="This build pays only in the Airwallex sandbox">${svg("flask", 14)}<span class="tl"> Test money</span></span></div></header>
<main><div class="wrap">${o.body}</div></main>
<script type="module" nonce="${o.nonce}">${o.script}</script>
</body></html>`;

/** What the overview and the detail page share: helpers, formatting, posting with this page's token. */
export const COMMON = `
const csrf=document.querySelector('meta[name=csrf]').content;
const $=(s)=>document.querySelector(s);
const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
const ic=(name)=>{const s=document.createElement('span');s.className='ic';s.innerHTML=IC[name]||'';return s};
const group=(int)=>int.replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');
const amount=(v)=>{const m=/^(-?)(\\d+)\\.(\\d{2})$/.exec(String(v||''));return m?m[1]+group(m[2])+'.'+m[3]:String(v||'')};
const money=(cur,v)=>{const s=el('span','num');if(cur)s.append(el('small','',cur));s.append(amount(v));return s};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const day=(iso)=>{const m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(iso||'');return m?(+m[3])+' '+MONTHS[+m[2]-1]+' '+m[1]:''};
const stamp=(iso)=>{const d=new Date(iso);if(isNaN(d))return '';return day(iso)+', '+String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0')+' UTC'};
const today=new Date().toISOString().slice(0,10);
async function post(path,body,headers){const r=await fetch(path,{method:'POST',headers:Object.assign({'x-csrf':csrf},headers||{}),body});const j=await r.json().catch(()=>({error:r.statusText}));if(!r.ok)throw new Error(j.error||r.statusText);return j}
const chip=(status,words)=>el('span','st '+status,words||status.replace(/_/g,' '));
`;

const OVERVIEW_BODY = `
<div class="head"><div><h1>Payables</h1><p class="lede">Supplier invoices in, read and checked by Purser, paid only with the CFO's Face ID, and booked.</p></div>
<div class="tools"><button class="btn" id="sync" type="button">${svg("refresh-cw", 16)} Check payments</button>
<a class="btn" href="/api/payables/export/journal.csv">${svg("download", 16)} Journal</a><a class="btn" href="/api/payables/export/invoices.csv">${svg("download", 16)} Invoices</a></div></div>
<label class="drop" id="drop"><span class="ic">${svg("upload", 22)}</span><span><b>Drop PDF invoices or saved e-mails here</b><span class="sub">PDF or .eml, up to 16 MB <span class="sub2">· each file is read, checked and filed; nothing is paid without the CFO</span></span></span>
<span class="btn">Choose files</span><input type="file" id="file" multiple accept=".pdf,.eml,application/pdf,message/rfc822"></label>
<p id="msg" role="status"></p>
<div class="tiles" id="tiles"></div>
<section class="section"><div class="bar" id="filters"><h2>Invoices</h2></div>
<div class="card list" id="list"></div></section>
<section class="section"><div class="grid2" id="more"></div></section>
<p class="foot">Test money only: this build pays through the Airwallex sandbox. Every figure comes from the ledger on this computer.</p>`;

const OVERVIEW_SCRIPT = `
const IC=${ICON_SET(["triangle-alert", "clock", "circle-check", "octagon-x", "inbox", "wallet", "chevron-right", "calendar-range"])};
${COMMON}
const msg=(t,tone)=>{const m=$('#msg');m.textContent=t;m.className=tone||''};
const FILTERS=[['all','All',()=>true],['act','To act on',(i)=>['ready','needs_review','needs_vendor'].includes(i.status)],['waiting_cfo','Waits for Face ID',(i)=>i.status==='waiting_cfo'],['paid','Paid',(i)=>i.status==='paid'],['blocked','Blocked',(i)=>i.status==='blocked'],['rejected','Rejected',(i)=>i.status==='rejected']];
let filter='all';let all=[];
const REASON={possible_fraud:'possible fraud',duplicate:'a copy of an invoice on file',iban_invalid:'an invalid IBAN',sum_mismatch:'amounts that do not add up',bank_details_invalid:'invalid bank details',payee_blocked:'a blocked supplier'};
const sum=(a)=>a&&a.length?a:null;
function tile(label,icon,value,extra,tone){const t=el('div','card tile'+(tone?' '+tone:''));const l=el('div','l',[ic(icon),label]);const v=el('div','v num');if(value instanceof Node)v.append(value);else v.textContent=value;t.append(l,v);if(extra)t.append(el('div','x',extra));return t}
function amounts(a){if(!a)return null;const f=a[0];const s=el('span');s.append(el('small','',f.currency),amount(f.total));return s}
function rest(a,word){if(!a)return null;const others=a.slice(1).map(x=>x.currency+' '+amount(x.total));const n=a.reduce((k,x)=>k+x.count,0);return [n+' '+word+(n===1?'':'s'),...others].join(' · ')}
function why(i){if(i.status==='paid')return 'Paid'+(i.paid_at?' '+day(i.paid_at):'');if(i.status==='ready')return 'All checks passed';if(i.status==='waiting_cfo')return 'Filed for the CFO\\'s Face ID';const f=i.findings.filter(x=>x.level!=='warn')[0]||i.findings[0];return f?f.detail.charAt(0).toUpperCase()+f.detail.slice(1):''}
function rows(){
  const list=$('#list');list.replaceChildren();
  const shown=all.filter(FILTERS.find(f=>f[0]===filter)[2]).slice().reverse();
  if(!all.length){list.append(el('div','empty',[el('b','','No invoices yet'),'Drop a PDF invoice or a saved e-mail above, or forward it to the watched folder.']));return}
  list.append(el('div','row th',[el('span','','Supplier'),el('span','','Invoice'),el('span','','Due'),el('span','amt','Amount'),el('span','','Status'),el('span','','Why'),el('span','')]));
  if(!shown.length){list.append(el('div','empty',[el('b','','Nothing here'),'No invoice is in this state right now.']));return}
  for(const i of shown){
    const a=el('a','row');a.href='/invoices/'+encodeURIComponent(i.id);
    const sup=el('span','sup',[i.vendor||'Unknown supplier']);sup.title=i.vendor;
    const no=el('span','no',[i.invoice_no||'(no number)',el('span','sub',i.id)]);no.title=i.invoice_no;
    const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
    const due=el('span','due num'+(late?' late':''),i.due_date?day(i.due_date):'–');
    const amt=el('span','amt',[el('span','c',i.currency),amount(i.total)||'–']);
    const w=why(i);const wy=el('span','why',w);wy.title=w;
    const st=chip(i.status,i.status_words);st.title=i.status_words;
    a.append(sup,no,due,amt,el('span','stc',[st]),wy,ic('chevron-right'));a.lastChild.className='go';
    list.append(a)}
}
function filters(){const bar=$('#filters');bar.querySelectorAll('.chip').forEach(c=>c.remove());for(const [k,label,fn] of FILTERS){const n=all.filter(fn).length;if(k!=='all'&&!n&&k!=='act')continue;const b=el('button','chip',[label,' ',el('b','',String(n))]);b.type='button';b.setAttribute('aria-pressed',String(filter===k));b.onclick=()=>{filter=k;filters();rows()};bar.append(b)}}
function more(x){
  const box=$('#more');box.replaceChildren();
  const spend=el('div','card mini',[el('h3','','Spend per supplier, last 90 days')]);const kv=el('div','kv');
  for(const s of x.spend_90d.slice(0,5))kv.append(el('span','',s.vendor+' ('+s.count+')'),el('span','',s.currency+' '+amount(s.total)));
  if(!x.spend_90d.length)kv.append(el('span','','Nothing booked yet'),el('span',''));spend.append(kv);
  const cost=el('div','card mini',[el('h3','','What paying cost')]);const kv2=el('div','kv');
  kv2.append(el('span','','Transfer fees'),el('span','',x.costs.swift_fees.length?x.costs.swift_fees.map(f=>f.currency+' '+amount(f.total)).join(', '):'none'));
  kv2.append(el('span','','Currency conversions'),el('span','',String(x.costs.fx.conversions)));
  kv2.append(el('span','','Median time to pay'),el('span','',x.time_to_pay.median_hours===null?'–':x.time_to_pay.median_hours+' h'));
  kv2.append(el('span','','Paid invoices'),el('span','',String(x.time_to_pay.paid)));cost.append(kv2);
  const rise=el('div','card mini',[el('h3','','Price changes')]);const kv3=el('div','kv');
  for(const r of x.price_rises)kv3.append(el('span','',r.vendor),el('span','','+'+r.change_pct+'% ('+r.currency+' '+amount(r.last)+')'));
  if(!x.price_rises.length)kv3.append(el('span','','No supplier raised its price'),el('span',''));rise.append(kv3);
  box.append(spend,cost,rise)}
async function load(){
  const [list,x]=await Promise.all([fetch('/api/payables/invoices').then(r=>r.json()),fetch('/api/payables/insights').then(r=>r.json())]);
  all=list;
  const tiles=$('#tiles');tiles.replaceChildren();
  const wait=x.waiting.waiting_cfo+x.waiting.needs_review+x.waiting.needs_vendor;
  const top=x.blocked.reasons.slice().sort((a,b)=>b.count-a.count)[0];
  tiles.append(
    tile('Open','wallet',amounts(sum(x.open))||'None',rest(sum(x.open),'invoice')||'Nothing to pay'),
    tile('Due in 7 days','calendar-range',amounts(sum(x.due_7))||'None',sum(x.due_30)?'30 days: '+x.due_30.map(a=>a.currency+' '+amount(a.total)).join(' · '):'Nothing due in 30 days'),
    tile('Overdue','clock',amounts(sum(x.overdue))||'None',sum(x.overdue)?rest(sum(x.overdue),'invoice'):'Every open invoice is in time',sum(x.overdue)?'alert':'calm'),
    tile('Waits for you','inbox',String(wait),x.waiting.waiting_cfo+' Face ID · '+x.waiting.needs_review+' check · '+x.waiting.needs_vendor+' supplier'),
    tile('Blocked','octagon-x',String(x.blocked.count),top?'Most: '+(REASON[top.code]||top.code.replace(/_/g,' ')):'Nothing blocked',x.blocked.count?'alert':'calm'));
  filters();rows();more(x);
}
async function send(files){let n=0;for(const f of files){msg('Filing '+f.name+' …');try{const j=await post('/api/payables/documents',f,{'content-type':'application/octet-stream','x-filename':encodeURIComponent(f.name)});n++;msg(f.name+': '+(j.kind==='email'?j.results.length+' PDF(s) from the e-mail':j.kind==='duplicate_document'?'filed before, not again':j.invoice.id+', '+(j.invoice.status_words||j.invoice.status)),'ok')}catch(e){msg(f.name+': '+e.message,'bad')}}await load()}
$('#file').onchange=(e)=>send(e.target.files);
const drop=$('#drop');drop.ondragover=(e)=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=(e)=>{e.preventDefault();drop.classList.remove('over');send(e.dataTransfer.files)};
$('#sync').onclick=async()=>{try{const j=await post('/api/payables/sync');msg(j.changed.length?j.changed.length+' invoice(s) changed':'Nothing changed','ok');load()}catch(e){msg(e.message,'bad')}};
load().catch(e=>msg('Could not load the invoices: '+e.message,'bad'));
`;

/** The overview: upload, the figures, the invoices. */
export function overviewPage(csrf: string, nonce: string): string {
  return shell({ title: "Purser · Payables", csrf, nonce, body: OVERVIEW_BODY, script: OVERVIEW_SCRIPT });
}

const DETAIL_BODY = (id: string) => `
<a class="back" href="/">${svg("arrow-left", 16)} All invoices</a>
<div id="d" data-id="${escAttr(id)}"><p class="lede">Loading ${escAttr(id)} …</p></div>`;

const DETAIL_SCRIPT = `
const IC=${ICON_SET(["circle-check", "triangle-alert", "octagon-x", "clock", "circle-minus", "file-text", "external-link", "scan-face", "users", "ban", "sparkles", "bot", "info"])};
${COMMON}
const id=$('#d').dataset.id;
const RES={passed:['circle-check','Passed'],warn:['triangle-alert','Note'],wait:['clock','Waits'],review:['triangle-alert','Needs a person'],block:['octagon-x','Blocks payment'],not_checked:['circle-minus','Not checked']};
const SRC={upload:'Uploaded',email:'E-mail',folder:'Watched folder',api:'API'};
const dl=(pairs)=>{const d=el('dl','read');for(const [k,v,cls] of pairs){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k));const dd=el('dd',cls||'');if(v instanceof Node)dd.append(v);else dd.textContent=v;d.append(dd)}return d};
async function drawPdf(box){
  try{const {getDocument}=await import('/assets/pdfjs.mjs');
    const data=new Uint8Array(await (await fetch('/api/payables/invoices/'+encodeURIComponent(id)+'/document')).arrayBuffer());
    const doc=await getDocument({data,isEvalSupported:false,enableXfa:false,disableFontFace:false,useSystemFonts:false,stopAtErrors:false,verbosity:0}).promise;
    box.replaceChildren();
    for(let n=1;n<=Math.min(doc.numPages,6);n++){const page=await doc.getPage(n);const vp=page.getViewport({scale:2});const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;c.setAttribute('aria-label','Page '+n+' of the invoice');box.append(c);await page.render({canvasContext:c.getContext('2d'),viewport:vp,canvas:c}).promise}
    if(doc.numPages>6)box.append(el('p','wait',(doc.numPages-6)+' more page(s): open the PDF to see them'));
  }catch(e){box.replaceChildren(el('p','wait','The document could not be drawn here ('+e.message+'). Open the PDF instead.'))}
}
function render(d){
  const i=d.invoice,r=i.reading;
  const root=$('#d');root.replaceChildren();
  document.title='Purser · '+(i.vendor||'Invoice')+' '+(i.invoice_no||i.id);
  const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
  const head=el('div','dhead',[
    el('div','who',[el('h1','',i.vendor||'Unknown supplier'),el('div','meta',[chip(i.status,i.status_words),el('span','','Invoice '+(i.invoice_no||'(no number)')),el('span','','·'),el('span','',i.id),el('span','','·'),el('span','',(SRC[d.document.source]||d.document.source)+' '+day(i.received_at))])]),
    el('div','money',[el('div','big',[el('small','',i.currency),amount(i.total)||'–']),el('div','when',i.status==='paid'&&i.paid_at?'Paid '+day(i.paid_at):i.due_date?(late?'Was due ':'Due ')+day(i.due_date):'No due date')])]);
  // Actions
  const bar=el('div','card actions');
  const pay=el('button','btn primary big',[ic('scan-face'),'Pay with the CFO\\'s Face ID']);pay.type='button';pay.disabled=!d.actions.pay.allowed;
  const sup=el('button','btn big',[ic('users'),'Request supplier']);sup.type='button';sup.disabled=!d.actions.supplier_request.allowed;
  const rej=el('button','btn danger big',[ic('ban'),'Reject']);rej.type='button';rej.disabled=!d.actions.reject.allowed;
  const note=el('div','note');
  const closed=d.actions.pay.allowed?null:d.actions.pay.why;
  note.append(d.actions.pay.allowed?el('span','',['Files the payment; ',el('b','','nothing moves until the CFO approves it with Face ID'),' on the phone.']):el('span','',['Pay: ',closed.charAt(0).toUpperCase()+closed.slice(1)+'.']));
  const status=el('p','');status.setAttribute('role','status');status.style.cssText='margin:0;flex-basis:100%;font-size:14px';
  // A paid, rejected or filed invoice has nothing left to do here: the bar says where it stands instead of showing dead buttons.
  const done=['paid','rejected','waiting_cfo'].includes(i.status);
  if(done){note.replaceChildren(el('span','',[el('b','',i.status==='paid'?'Paid'+(i.paid_at?' on '+day(i.paid_at):''):i.status==='rejected'?'Rejected':'Waits for the CFO\\'s Face ID'),i.proposal_id?' · payment '+i.proposal_id:'',i.status==='paid'?' · paid through the Airwallex sandbox.':i.status==='waiting_cfo'?' · the CFO approves or rejects it on the phone.':' · it is never paid.']))}
  bar.append(...(done?[]:d.actions.supplier_request.allowed?[sup,pay,rej]:[pay,rej]),note,status);
  const box=el('div','card rejectbox');const ta=document.createElement('textarea');ta.placeholder='Why is this invoice rejected? (kept with the invoice and in the audit log)';ta.maxLength=300;
  const go=el('button','btn danger',['Reject this invoice']);go.type='button';const cancel=el('button','btn',['Cancel']);cancel.type='button';
  box.append(el('b','','Reject '+(i.invoice_no||i.id)+': it will never be paid.'),ta,el('div','row2',[go,cancel]));
  const say=(t,bad)=>{status.textContent=t;status.style.color=bad?'var(--bad)':'var(--ok)'};
  pay.onclick=async()=>{pay.disabled=true;try{const j=await post('/api/payables/invoices/'+encodeURIComponent(id)+'/pay');say(j.kind==='proposed'?'Filed as '+j.proposal_id+': it waits for the CFO\\'s Face ID on the phone.':'Not filed: '+j.reason,j.kind!=='proposed');setTimeout(load,900)}catch(e){say(e.message,true);pay.disabled=false}};
  sup.onclick=async()=>{sup.disabled=true;try{const j=await post('/api/payables/invoices/'+encodeURIComponent(id)+'/supplier-request');say(j.add_id+' requested: a person now verifies the bank details with the supplier on a number already on file (npm run payables -- supplier-verify).');setTimeout(load,900)}catch(e){say(e.message,true);sup.disabled=false}};
  rej.onclick=()=>{box.classList.toggle('open');ta.focus()};cancel.onclick=()=>box.classList.remove('open');
  go.onclick=async()=>{go.disabled=true;try{await post('/api/payables/invoices/'+encodeURIComponent(id)+'/reject',JSON.stringify({reason:ta.value}),{'content-type':'application/json'});await load()}catch(e){say(e.message,true);go.disabled=false}};
  // Document
  const pages=el('div','pages',[el('p','wait','Drawing the document …')]);
  const open=el('a','',[ic('external-link'),'Open PDF']);open.href='/api/payables/invoices/'+encodeURIComponent(id)+'/document';open.target='_blank';open.rel='noopener';
  const docv=el('div','card docv',[el('div','bar2',[ic('file-text'),el('span','fn',d.document.filename||'document.pdf'),open]),pages]);
  // What Purser read
  const line=d.total_line?el('span','',d.total_line):null;
  const payTo=r.iban?'IBAN '+r.iban+(r.bic?' · BIC '+r.bic:''):r.account_number?'Account '+r.account_number+(r.routing_value?' · '+r.routing_type.toUpperCase().replace('_',' ')+' '+r.routing_value:''):'';
  const read=el('div','card panel',[el('h2','',['What Purser read',el('span','cnt',i.read_by==='parser'?'Read by Purser\\'s code':'Read by '+i.read_by)]),dl([
    ['Supplier',i.vendor],['VAT ID',r.vat_id],['Invoice number',i.invoice_no],['Invoice date',day(i.issue_date)],['Due date',day(i.due_date)],
    ['Subtotal',i.subtotal?i.currency+' '+amount(i.subtotal):''],['VAT',i.tax?i.currency+' '+amount(i.tax):''],['Total',i.total?i.currency+' '+amount(i.total):''],
    ['On the invoice',line,'line'],['Pay to',payTo,'mono'],['Bank country',r.bank_country],['Reference',r.reference],['Booked to',i.gl_account?(i.gl_account+(i.gl_rule?' · '+i.gl_rule:'')):'']])]);
  // Checks
  const ul=el('ul','checks');let passed=0;
  for(const c of d.checks){const [icon,word]=RES[c.result];if(c.result==='passed')passed++;const li=el('li','',[el('span','ic res-'+c.result),el('span','t',c.title),el('span','r res-'+c.result,word)]);li.firstChild.innerHTML=IC[icon];for(const w of c.reasons)li.append(el('span','why',w.charAt(0).toUpperCase()+w.slice(1)));ul.append(li)}
  const checks=el('div','card panel',[el('h2','',['Checks',el('span','cnt',passed+' of '+d.checks.length+' passed')]),ul]);
  // Note
  const by=i.review_by||'';const noteCard=i.review_note?el('div','card notecard',[el('div','who',by.startsWith('claude:')?'Note by '+by.slice(7)+' (advisory, changes nothing)':'Note by Purser\\'s code'),el('p','',i.review_note)]):null;
  // Timeline
  const ol=el('ol','tl');for(const t of d.timeline)ol.append(el('li','',[el('div','',[el('span','w',t.what),el('span','at',stamp(t.at))]),t.detail?el('div','d',t.detail.charAt(0).toUpperCase()+t.detail.slice(1)):null]));
  const tl=el('div','card panel',[el('h2','','Timeline'),ol]);
  root.append(head,el('div','banner',[ic('info'),'Test money: this build pays only through the Airwallex sandbox. No real money moves.']),bar,box,el('div','split',[docv,el('div','stack',[read,checks,noteCard,tl])]));
  drawPdf(pages);
}
async function load(){const r=await fetch('/api/payables/invoices/'+encodeURIComponent(id)+'/detail');if(!r.ok){$('#d').replaceChildren(el('p','lede','No invoice '+id+'.'));return}render(await r.json())}
load().catch(e=>$('#d').replaceChildren(el('p','lede','Could not load '+id+': '+e.message)));
`;

/** One invoice: its document, what Purser read, every check, the note, the timeline and the actions. */
export function detailPage(csrf: string, nonce: string, id: string): string {
  return shell({ title: `Purser · ${id}`, csrf, nonce, body: DETAIL_BODY(id), script: DETAIL_SCRIPT });
}
