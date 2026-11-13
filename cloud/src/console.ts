// Purser Cloud's console: the pages a company uses in the browser, served by the same Worker as the API. One page with
// one script (the response's nonce, no inline handlers, no 'unsafe-inline'), which talks to /v1 with the person's
// passkey session as a bearer token kept in the tab (sessionStorage): no cookie, so another site cannot ride on it,
// and the Worker refuses a state change whose Origin is not this one (app.ts). Every value from the API is put on the
// page as text (textContent), never as HTML; account numbers come masked from the runner. The console reads and
// manages; it never pays: a payment is approved on the CFO's phone with Face ID, through the runner's approval flow.

import { ICON_LINKS, PREVIEW_TAGS } from "./brand.js";
import { EVENT_LINE_JS } from "../../src/ui/engineEvents.js";
import { consoleKeys, DATA_NL, I18N_JS, keysUsedIn, MESSAGES, t as tr } from "../../src/ui/i18n.js";
import { escAttr, ICON_SET, PAYABLES_CSS, svg } from "../../src/ui/payablesKit.js";
import { fromB64 } from "./crypto.js";
import { INTER_WOFF2_B64 } from "./font.gen.js";
import { tryPageResponse } from "./tryPage.js";
import { SITE_HEADER_CSS, siteHeader } from "./siteHeader.js";
import type { CloudEnv } from "./app.js";

const ICONS = ["wallet", "calendar-range", "clock", "inbox", "octagon-x", "chevron-right", "circle-check", "triangle-alert", "circle-minus", "file-text",
  "download", "mail", "scan-face", "users", "key-round", "log-out", "arrow-left", "flask", "x", "arrow-down-left", "arrow-up-right", "shield-check", "copy",
  "bot", "credit-card", "link-2", "external-link", "receipt", "ban", "snowflake"];

const EXTRA_CSS = `
.pdfframe { display: block; width: 100%; max-width: 820px; height: 600px; border: 0; background: #fff; border-radius: 6px; box-shadow: 0 1px 2px rgba(16,24,40,.08), 0 8px 24px -8px rgba(16,24,40,.18); }
ul.plain { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
ul.plain li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 12 Nov: the site's header (cloud/src/siteHeader.ts) on top; the console's own bar under it, one thin row: its pages,
   the company, sign-out and test money. Its tabs look as the kit's nav.tabs did (src/ui/payablesKit.ts), under their
   own class so neither style reaches the other's. */
.appbar { border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); background: color-mix(in srgb, var(--bg) 84%, transparent); }
@media (min-width: 901px) { .appbar { position: sticky; top: 64px; z-index: 30; backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px); } }
.appbar .wrap { display: flex; align-items: center; gap: 12px; }
.apptabs { display: flex; gap: 4px; margin-left: -12px; overflow-x: auto; scrollbar-width: none; }
.apptabs::-webkit-scrollbar { display: none; }
.apptabs a { padding: 7px 12px; border-radius: 999px; text-decoration: none; color: var(--muted); font-weight: 650; font-size: 14px; white-space: nowrap; }
.apptabs a:hover { color: var(--text); }
.apptabs a[aria-current="page"] { color: var(--text); background: var(--sunken); }
.who-am-i { display: none; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; white-space: nowrap; }
/* The tabs never give way: the person and company line shrinks with an ellipsis instead (desktop cut "Instellingen" short). */
.appbar nav.apptabs { flex: none; }
.who-am-i { min-width: 0; flex: 1 1 auto; justify-content: flex-end; }
.who-am-i #who { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.who-am-i #who .wn { color: var(--text); font-weight: 600; }
.who-am-i #who .we { display: none; }
@media (min-width: 1500px) { .who-am-i #who .we { display: inline; } }
.signed-in .who-am-i { display: inline-flex; }
.who-am-i button { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 8px; display: inline-flex; }
.who-am-i button:hover { color: var(--text); background: var(--sunken); }
/* Signed out the bar keeps the test-money chip alone (the honesty label is on every console page); the pages and the person wait. */
.signed-out .appbar .apptabs, .signed-out .who-am-i { display: none; }
.signed-out .appbar .wrap { height: 44px; padding-top: 0; align-content: center; }
.appbar .test { margin-left: 12px; }
label.check { display: flex; gap: 8px; align-items: flex-start; margin: 12px 0; font-size: 14px; line-height: 1.45; }
label.check input { margin-top: 3px; }
.appbar .spacer { margin-left: auto; }
.auth { max-width: 460px; margin: 7vh auto 40px; padding: 28px; }
.auth h1 { font-size: 26px; letter-spacing: -.02em; margin: 0 0 6px; }
.auth p { color: var(--muted); margin: 0 0 18px; }
.auth label { display: block; font-weight: 650; font-size: 14px; margin: 14px 0 6px; }
.field { width: 100%; font: inherit; padding: 11px 13px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
.field:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.addr { display: flex; align-items: center; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
.addr .field { border: 0; border-radius: 0; min-width: 0; }
.addr span { padding: 0 12px; color: var(--muted); font-size: 14px; white-space: nowrap; }
.auth .btn.primary { width: 100%; justify-content: center; margin-top: 18px; }
.auth .alt { margin-top: 14px; font-size: 14px; text-align: center; }
.note-ok, .note-bad, .note-info { padding: 10px 13px; border-radius: 12px; font-size: 14px; font-weight: 550; margin: 12px 0 0; }
.note-ok { background: var(--ok-soft); color: var(--ok); }
.note-bad { background: var(--bad-soft); color: var(--bad); }
.note-info { background: var(--sunken); color: var(--muted); }
.auth .inbox { margin: 0 0 12px; }
.auth .btn + .btn, .auth .note-ok + .btn { margin-left: 8px; }
.auth p + .btn, .auth .once + p { margin-top: 12px; }
.cmd { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.55; background: var(--sunken); padding: 12px 14px; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 10px 0 0; }
.waits { margin-top: 22px; }
.form-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-top: 12px; }
.form-row > div { flex: 1 1 180px; min-width: 0; }
.form-row label { display: block; font-size: 13px; font-weight: 650; color: var(--muted); margin-bottom: 5px; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th { text-align: left; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; font-weight: 650; padding: 10px 14px; background: var(--sunken); }
.table td { padding: 11px 14px; border-top: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; }
.table td.r, .table th.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.scroll { overflow-x: auto; }
.pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 12.5px; font-weight: 650; background: var(--sunken); color: var(--muted); white-space: nowrap; }
/* A row's buttons wrap under each other rather than squeeze the role or status beside them (screenshot pass, 9 Nov). */
.table td.r.acts { white-space: normal; text-align: right; }
.table td.r.acts .btn { margin: 2px 0; }
.panel h2.sub-h { margin-top: 22px; }
.panel > .row2 { margin-top: 14px; }
.pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
.split2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
@media (max-width: 900px) { .split2 { grid-template-columns: minmax(0, 1fr); } }
.panel h2 { margin: 0 0 12px; font-size: 17px; }
.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.findings li { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; }
.findings li .ic { flex: none; margin-top: 2px; }
.findings li.block { color: var(--bad); } .findings li.review, .findings li.wait { color: var(--warn); } .findings li.ok { color: var(--ok); }
.timeline { list-style: none; margin: 0; padding: 0 0 0 4px; display: grid; gap: 12px; }
.timeline li { padding-left: 16px; border-left: 2px solid var(--border); font-size: 14px; }
.timeline li b { display: block; }
.timeline li span { color: var(--muted); }
.once { border: 1px dashed var(--warn); background: var(--warn-soft); color: var(--text); padding: 12px 14px; border-radius: 12px; margin-top: 12px; font-size: 14px; }
.once code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.once.invite { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.once.invite > div { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.once.invite p { margin: 0; }
.once.invite .row2 { display: flex; gap: 8px; }
img.qr { width: 180px; height: 180px; background: #fff; border-radius: 8px; padding: 6px; flex: none; }
.docv .bar2 .btn { margin-left: auto; }
.expired { max-width: 460px; margin: 10vh auto; text-align: center; }

/* The company this session is in and its Airwallex account (10 Nov: a platform runs several companies). */
.co { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 460px; flex: 0 1 auto; padding: 3px 11px 3px 3px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); text-decoration: none; color: var(--text); font: 600 13px/1.2 Inter, system-ui, sans-serif; }
.co:empty { display: none; }
.co:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.co .av { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #fff; font-weight: 700; font-size: 12px; }
.co .cn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co .aw { flex: none; display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-weight: 600; font-size: 12px; white-space: nowrap; padding-left: 8px; border-left: 1px solid var(--border); }
.co .aw i { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
.co .aw.active i { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
.co .aw.demo i { background: var(--warn); }
.co .aw.created i, .co .aw.pending i, .co .aw.action_required i, .co .aw.opening i { background: var(--warn); }
.co .aw.refused i, .co .aw.closed i, .co .aw.dormant i { background: var(--bad); }
.who-am-i { gap: 10px; }
.btn[hidden] { display: none; }
@media (max-width: 1499px) { .co .awl { display: none; } }
/* The person's name sits in the chip's title below 1500 px, so the company's name is never cut short. */
@media (max-width: 1499px) { .who-am-i #who { display: none; } }
code.idc { font: 500 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--sunken); color: var(--muted); padding: 1px 6px; border-radius: 6px; white-space: nowrap; }
/* A status chip stays on one line on a laptop: its column is wide enough for the longest words. */
@media (min-width: 861px) { .row { grid-template-columns: minmax(0, 2fr) minmax(0, 1.3fr) 104px 138px 248px minmax(0, 2fr) 18px; } .row .st { white-space: nowrap; } }
.tile { transition: border-color .15s; }
.card.list { border-radius: var(--r); }
.pft td .sub { display: block; color: var(--muted); font-size: 12.5px; margin-top: 3px; }
.pft td .pill + .sub { margin-top: 5px; }
@media (max-width: 900px) { .co .aw .aww { display: none; } .co .aw { padding-left: 6px; } }
@media (max-width: 640px) { .co { max-width: 50vw; padding-left: 10px; } .co .av { display: none; } .tiles.pf .tile:last-child { grid-column: auto; } }
/* Below 420 px the chip drops the name's bracketed part ("Northwind Outdoor (demo company)" → "Northwind Outdoor"; the
   ribbon under it says it is the demo), so the company's own name is read whole (review, 13 Nov). */
@media (max-width: 419px) { .co .cn .cx { display: none; } .co { max-width: 62vw; } }
/* A rail's name wraps rather than end in an ellipsis. */
.trow > .rail { white-space: normal; overflow-wrap: anywhere; line-height: 1.35; }
/* The platform's companies as cards on a phone: name and payouts, account and fees, last sync. */
@media (max-width: 640px) {
  .pfl .scroll { overflow: visible; }
  .pft thead { display: none; }
  .pft, .pft tbody { display: block; }
  .pft tr { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 16px; border-top: 1px solid var(--border); }
  .pft tr:first-child { border-top: 0; }
  .pft td, .pft td.r { border: 0; padding: 0; text-align: left; white-space: normal; overflow-wrap: normal; }
  .pft td[data-l] { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .pft td[data-l]::before { content: attr(data-l); color: var(--muted); font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; min-width: 9em; }
  .pft td[data-l] .sub { display: inline; margin: 0; }
  .pft td.pay[data-l] .pv { display: inline-flex; gap: 8px; align-items: baseline; }
  .pft td.pay[data-l] .meter { flex-basis: 100%; max-width: none; margin-top: 2px; }
  .trow > .what { white-space: normal; overflow-wrap: anywhere; }
}
/* A tile's label that wraps keeps its icon on its first line. */
.tile .l { align-items: flex-start; } .tile .l .ic { margin-top: 1px; }

/* Round 2 (10 Nov): denser pages, initials, one-hue bars from the store's own numbers. */
.appbar .wrap { height: 48px; }
.appbar .test { padding: 5px 9px; font-size: 12px; }
.av2 { flex: none; width: 28px; height: 28px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--accent-soft); color: var(--accent); font: 700 11px/1 Inter, system-ui, sans-serif; letter-spacing: .02em; }
.row > .sup { display: flex; align-items: center; gap: 10px; }
.row .sup .sn { min-width: 0; }
.row > .why { display: flex; align-items: center; gap: 6px; }
.row > .why .ic { flex: none; display: inline-flex; color: var(--faint); }
.trow > .what { display: flex; align-items: center; gap: 10px; }
.trow > .what .wt { min-width: 0; }
.seg { display: flex; gap: 2px; height: 10px; border-radius: 999px; overflow: hidden; background: var(--sunken); }
.seg span { height: 100%; }
.seg.empty { opacity: .6; }
.s0 { background: var(--accent); } .s1 { background: color-mix(in srgb, var(--accent) 64%, var(--surface)); } .s2 { background: color-mix(in srgb, var(--accent) 38%, var(--surface)); } .s3 { background: color-mix(in srgb, var(--accent) 18%, var(--surface)); }
ul.legend { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; }
ul.legend li { display: inline-flex; align-items: center; gap: 6px; }
ul.legend li i { width: 10px; height: 10px; border-radius: 3px; }
ul.legend li span { color: var(--muted); }
ul.legend li.zero { opacity: .55; }
.meter { display: block; width: 100%; max-width: 220px; height: 6px; border-radius: 999px; background: var(--sunken); overflow: hidden; margin-top: 6px; }
.meter > span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.ovtop { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 12px; margin-top: 18px; }
@media (max-width: 900px) { .ovtop { grid-template-columns: minmax(0, 1fr); } }
a.next { display: flex; align-items: center; gap: 14px; padding: 18px 20px; text-decoration: none; color: var(--text); }
a.next.act { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
a.next .nic { flex: none; width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
a.next:not(.act) .nic { background: var(--ok-soft); color: var(--ok); }
a.next > div { min-width: 0; flex: 1; }
a.next .nl { display: block; color: var(--muted); font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; }
a.next b { display: block; font-size: 17px; letter-spacing: -.01em; margin-top: 2px; }
a.next .ns { display: block; color: var(--muted); font-size: 14px; margin-top: 2px; }
a.next > .ic { color: var(--faint); }
.panel.due h2 { margin: 0 0 12px; }
p.fine { color: var(--muted); font-size: 12.5px; margin: 8px 0 0; }
.waits { margin-top: 18px; }
.inbox { margin: 14px 0 0; }
.tile.quiet .v { color: var(--muted); font-size: clamp(18px, 1.8vw, 22px); }
.tiles.pf { grid-template-columns: minmax(0, 1fr) minmax(0, 1.9fr) minmax(0, 1.1fr) minmax(0, 1fr); }
@media (max-width: 900px) { .tiles.pf { grid-template-columns: repeat(2, minmax(0, 1fr)); } .tiles.pf .tile.wide { grid-column: 1 / -1; } }
.pfgate { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.pfin { display: flex; gap: 8px; align-items: center; }
.pfin .field { width: 260px; padding: 9px 12px; }
.pfin .btn { white-space: nowrap; }
.pfgate p.fine { margin: 0; }
.pfchip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); font-size: 13px; font-weight: 600; color: var(--ok); }
.pfchip .dot { color: var(--faint); }
button.linkish { border: 0; background: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer; }
.pft td.pco { display: flex; align-items: center; gap: 10px; }
.pft td.pay .pv { display: block; }
.table.vat th.sh, .table.vat td.sh { width: 34%; }
.table.vat td.sh .meter { margin-top: 7px; max-width: none; }
.table.vat tr.tot td { background: color-mix(in srgb, var(--sunken) 55%, var(--surface)); }
.table tr.ln td { padding-top: 3px; padding-bottom: 3px; border-top: 0; font-size: 13.5px; color: var(--muted); }
.table tr.ln:last-child td, .table tr.ln + tr.en td { }
.table tr.en td { padding-top: 12px; padding-bottom: 4px; }
.table tr.ln td.r { color: var(--text); font-variant-numeric: tabular-nums; }
.table td.pn { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
@media (max-width: 640px) {
  .pfgate { align-items: stretch; width: 100%; } .pfin { flex-wrap: wrap; } .pfin .field { width: 100%; flex: 1 1 100%; }
  a.next { padding: 16px; } a.next b { font-size: 16px; }
  .table.vat th.sh, .table.vat td.sh { display: none; }
}
@media (max-width: 900px) {
  /* Two rows on a phone or a narrow window: who is signed in and the test-money label; then the pages. */
  .appbar .wrap { height: auto; flex-wrap: wrap; row-gap: 0; padding-top: 8px; }
  .appbar nav.apptabs { order: 9; flex: 1 0 100%; margin: 4px 0 0 -9px; padding-bottom: 6px; }
  .who-am-i #who { max-width: 46vw; overflow: hidden; text-overflow: ellipsis; }
}
@media (max-width: 640px) {
  .appbar .test .tl { display: none; }
  .who-am-i #who { max-width: 52vw; }
  .who-am-i #who .wc { display: none; }
  /* Five pages do not fit one row on a phone: the row scrolls sideways (review, 13 Nov: "Settings" wrapped onto a line of
     its own), the current page scrolled into view. */
  .appbar nav.apptabs { display: flex; flex-wrap: nowrap; gap: 2px; overflow-x: auto; overscroll-behavior-x: contain; scroll-padding-inline: 12px; margin-right: calc(-1 * var(--gut, 16px)); padding-right: 16px; }
  .appbar nav.apptabs a { padding: 6px 9px; font-size: 13.5px; flex: none; }
  .auth { margin-top: 3vh; padding: 20px; }
}
/* The engine (test money): the upload as one quiet row (the payables pages' drop zone), and the panel "At work". */
.drop.eng { position: relative; margin-top: 18px; padding: 12px 14px; }
.drop.eng .ic { width: 36px; height: 36px; border-radius: 10px; }
.work { margin-top: 14px; }
.work h2 { margin-bottom: 10px; }
.work ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.work li { display: grid; grid-template-columns: 4.6em minmax(0, 8.5em) minmax(0, 1fr); gap: 2px 12px; align-items: baseline; font-size: 14px; }
.work li time { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.work li b { font-weight: 650; overflow-wrap: anywhere; }
.work li b.claude { color: var(--accent); }
.work .we { color: var(--muted); font-size: 14px; margin: 0; }
.work details { margin-top: 10px; }
.work summary { cursor: pointer; color: var(--muted); font-size: 13px; font-weight: 600; }
.work details ol { margin-top: 8px; }
/* A phone: the drop zone is its words and its button, and a line flows as one sentence after its time and who. */
@media (max-width: 860px) { .drop.eng > .ic { display: none; } .drop.eng { gap: 10px; } }
@media (max-width: 640px) { .work li { display: block; line-height: 1.45; } .work li time, .work li b { margin-right: 8px; } }
/* The payment card on an invoice's page: one sentence or the terms, one button, the fingerprint folded. */
.note-warn { padding: 10px 13px; border-radius: 12px; font-size: 14px; font-weight: 550; margin: 12px 0 0; background: var(--warn-soft); color: var(--warn); }
.pay p.lead { margin: 0; font-size: 14px; }
.pay p { overflow-wrap: anywhere; }
.pay dl.read { margin-top: 14px; }
.pay .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.pay details { margin-top: 12px; }
.pay summary { cursor: pointer; color: var(--muted); font-size: 13px; font-weight: 600; }
.pay details dl.read { margin-top: 10px; }
.stack > .work { margin-top: 0; }
/* The proof on a paid invoice: paid, booked, archived, each a result line, its details folded, hashes last. */
.proof .pb { padding: 14px 0 0; margin-top: 14px; border-top: 1px solid var(--border); }
.proof .pb:first-of-type { padding-top: 0; margin-top: 0; border-top: 0; }
.proof p.pr { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; margin: 0; font-size: 14px; }
.proof p.pr > .ic { flex: none; color: var(--ok); }
.proof .pb.wait p.pr > .ic { color: var(--faint); }
.proof p.pr > b { font-weight: 650; }
.proof p.wt { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
.proof details, .archive details { margin-top: 10px; }
.proof summary, .archive summary { cursor: pointer; color: var(--muted); font-size: 13px; font-weight: 600; }
.proof details dl.read, .proof details .table { margin-top: 10px; }
.proof .table th, .proof .table td { padding: 6px 8px; }
.proof .table tr.en td { padding-top: 10px; font-size: 13px; color: var(--muted); }
ul.files { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }
ul.files li { min-width: 0; font-size: 14px; }
ul.files button.linkish { text-align: left; font-weight: 600; overflow-wrap: anywhere; }
ul.files button.linkish[aria-pressed="true"] { color: var(--text); }
ul.files .fd { display: block; color: var(--muted); font-size: 12.5px; overflow-wrap: anywhere; margin-top: 2px; }
.proof .pages { margin-top: 12px; }
.proof .pages:empty { display: none; }
.proof a.arch { margin-left: auto; font-size: 14px; font-weight: 600; color: var(--accent); text-decoration: none; white-space: nowrap; }
.proof .pb.wait a.arch { display: inline-block; margin: 8px 0 0; }
/* The archive's tree: one folder per line, collapsed below the year. */
.archive details { margin: 4px 0 0 0; }
.archive details details { margin-left: 14px; }
.archive summary { color: var(--text); font-size: 14px; }
.archive ul.files { margin: 6px 0 4px 14px; }
/* A phone: on an invoice's page what was done and what to do come before the document. */
@media (max-width: 980px) { .split.inv > .stack { order: -1; } }

/* The polish (12 Nov): a lighter first run and sign-in on the site's tokens: more air, the site's card radius and
   shadow, a step indicator, the brand colour on the one main button. (The Purser Cloud lockup gave way to the site's
   header the same day: cloud/src/siteHeader.ts.) */
.auth { max-width: 480px; margin: 9vh auto 48px; padding: 40px 40px 36px; border-radius: 22px; }
.auth h1 { font-size: 28px; line-height: 1.2; margin: 0 0 10px; }
.auth p { line-height: 1.6; margin: 0 0 22px; }
.auth label { font-weight: 600; margin: 18px 0 8px; }
.auth .btn.primary { margin-top: 24px; }
.auth p.hint { font-size: 13px; color: var(--muted); margin: 8px 2px 0; line-height: 1.5; }
.auth .alt { margin: 18px 0 0; color: var(--muted); }
.auth .alt a { color: var(--accent); font-weight: 600; text-decoration: none; }
.auth .alt a:hover { text-decoration: underline; }
.auth .note-ok, .auth .note-bad, .auth .note-info { font-weight: 500; line-height: 1.5; margin: 12px 0 0; }
.auth .stage > .note-ok:first-child { margin: 0 0 4px; }
.auth .stage > p { margin: 16px 0 0; }
ol.stepper { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; counter-reset: none; }
ol.stepper li { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--muted); font-size: 13.5px; font-weight: 600; }
ol.stepper li .n { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; line-height: 1; background: var(--sunken); color: var(--muted); font-size: 12.5px; font-weight: 700; }
ol.stepper li .sl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
ol.stepper li.now { color: var(--text); }
ol.stepper li.now .n { background: var(--accent); color: #fff; box-shadow: 0 0 0 4px var(--accent-soft); }
ol.stepper li.done .n { background: var(--ok-soft); color: var(--ok); }
ol.stepper li.done .n .ic { display: inline-flex; }
.auth p.stepsub { margin: 14px 0 6px; padding-top: 14px; border-top: 1px solid var(--border); font-size: 14px; }
/* The address field and its domain are one box: its focus ring goes round both, not a line inside. */
.addr:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
.addr .field:focus { outline: none; }
.auth .stage { animation: rise .28s ease-out both; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .auth .stage { animation: none; } }
@media (max-width: 640px) { .auth { margin-top: 4vh; padding: 28px 22px 24px; } .auth h1 { font-size: 24px; } }
/* Signed out (sign-in, first run, a passkey's enrolment): two zones, as /try's start. The illustration (cloud/src/scene.ts)
   in a band on the brand's tokens, the card, and the trust line under it. A phone: the band on top, the card below. A wide
   screen: the band left, the card right, centred. Signed in: neither. Since 13 Nov (owner: the console white and
   enterprise, clearly not the /try demo) the band is a calm panel, what Purser Cloud is in three lines, not /try's scene. */
.hero, .trust { display: none; }
.signed-out .hero { display: grid; flex: 1 0 auto; min-height: 34vh; min-height: 34svh; padding: 16px 12px 44px; }
.signed-out #foot { display: none; }
.signed-out { display: flex; flex-direction: column; min-height: 100vh; min-height: 100svh; }
.signed-out main { position: relative; z-index: 1; margin-top: -28px; padding: 0; }
.signed-out .auth { margin: 0 auto; border-radius: 16px; }
.signed-out .trust { display: grid; gap: 2px; margin: auto 0 0; padding: 16px var(--gut, 16px) 20px; text-align: center; color: var(--faint); font-size: 12.5px; line-height: 1.5; }
@media (min-width: 1024px) {
  .signed-out { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto auto 1fr auto auto 1fr; }
  .signed-out header.top { grid-column: 1 / -1; grid-row: 1; }
  .signed-out .appbar { grid-column: 1 / -1; grid-row: 2; }
  .signed-out .hero { grid-column: 1; grid-row: 3 / -1; min-height: 0; padding: 40px 48px; }
  .signed-out main { grid-column: 2; grid-row: 4; margin: 0; padding: 0 40px; }
  .signed-out .auth { max-width: 460px; }
  .signed-out .trust { grid-column: 2; grid-row: 5; margin: 0; padding: 18px 40px 0; }
}`;

// The page's frame in English (the default); the script re-words it in Dutch when the person chose Dutch.
const BODY = `
${siteHeader(null)}
<div class="appbar"><div class="wrap"><nav class="apptabs" id="tabs" aria-label="${tr("en", "app.pages")}"><a href="#/overview" data-tab="overview" data-t="cs.nav.overview">${tr("en", "cs.nav.overview")}</a><a href="#/agents" data-tab="agents" data-t="cs.nav.agents">${tr("en", "cs.nav.agents")}</a><a href="#/books" data-tab="books" data-t="cs.nav.books">${tr("en", "cs.nav.books")}</a><a href="#/transactions" data-tab="transactions" data-t="nav.transactions">${tr("en", "nav.transactions")}</a><a href="#/tokenisation" data-tab="tokenisation" data-t="cs.nav.tokens">${tr("en", "cs.nav.tokens")}</a><a href="#/settings" data-tab="settings" data-t="cs.nav.settings">${tr("en", "cs.nav.settings")}</a></nav>
<span class="spacer"></span>
<span class="who-am-i"><a class="co" id="co" href="#/settings"></a><span id="who"></span><button type="button" id="out" title="${tr("en", "cs.sign_out")}" aria-label="${tr("en", "cs.sign_out")}">${svg("log-out", 16)}</button></span>
<span class="test" title="${escAttr(tr("en", "test.title"))}">${svg("flask", 14)}<span class="tl" data-t="test.label"> ${tr("en", "test.label")}</span></span></div></div>
<div class="demo-ribbon" id="demo" hidden><div class="wrap">${svg("flask", 15)}<span data-t="cs.demo.ribbon">${tr("en", "cs.demo.ribbon")}</span><a href="#/sign-in" id="demo-out" data-t="cs.demo.leave">${tr("en", "cs.demo.leave")}</a></div></div>
<div class="hero"><div class="side"><h2 data-t="cs.side.title">${tr("en", "cs.side.title")}</h2><p data-t="cs.side.sub">${tr("en", "cs.side.sub")}</p><ul>${(["cs.side.1", "cs.side.2", "cs.side.3"] as const).map((k) => `<li>${svg("circle-check", 18)}<span data-t="${k}">${tr("en", k)}</span></li>`).join("")}</ul></div></div>
<main><div class="wrap" id="view" aria-live="polite"></div></main>
<p class="trust"><span data-t="cs.trust_works">${tr("en", "cs.trust_works")}</span><span data-t="cs.trust_test">${tr("en", "cs.trust_test")}</span></p>
<p class="foot wrap" id="foot">${tr("en", "cs.foot")}</p>`;

// The client: plain JS (no template literals in it, so it can sit in this file as a raw string).
const SCRIPT = String.raw`
const LS=__CATALOGUES__;
// English unless Dutch was chosen on purpose: the person's own language (on their account), else a choice made in this
// page (kept in this browser). The company's language is not a reason: the cloud stores Dutch for every new company
// by default, so it cannot tell a choice from the default. The key older pages wrote (on their own, not on a
// choice) is not read: this page keeps its own.
const langOf=(saved,person)=>person==='nl'||person==='en'?person:saved==='nl'?'nl':'en';
const PREF=(()=>{try{return localStorage.getItem('purser.cloud.language')}catch(e){return null}})();
const L=LS[langOf(PREF,null)];
__I18N__
__EVENT_LINE__
document.documentElement.lang=L.lang;
for(const a of document.querySelectorAll('[data-t]'))a.textContent=(a.classList.contains('tl')?' ':'')+t(a.dataset.t);
document.querySelector('#foot').textContent=t('cs.foot');
for(const b of [document.querySelector('#out')]){b.title=t('cs.sign_out');b.setAttribute('aria-label',t('cs.sign_out'))}
document.querySelector('.appbar .test').title=t('test.title');
const IC=__ICONS__;
const CFG=JSON.parse(document.querySelector('meta[name=purser-cloud]').content);
const $=(s)=>document.querySelector(s);
const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
const ic=(name)=>{const s=document.createElement('span');s.className='ic';s.innerHTML=IC[name]||'';return s};
const btn=(label,cls,icon)=>{const b=el('button','btn'+(cls?' '+cls:''),[icon?ic(icon):null,label]);b.type='button';return b};
const today=new Date().toISOString().slice(0,10);
const view=()=>$('#view');
const note=(text,tone)=>el('p','note-'+(tone||'info'),text);
const chip=(status,words)=>el('span','st '+String(status||'').replace(/[^a-z_]/g,''),statusWords(status,words));
const dl=(pairs)=>{const d=el('dl','read');for(const [k,v,cls] of pairs){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k));const dd=el('dd',cls||'');if(v instanceof Node)dd.append(v);else dd.textContent=String(v);d.append(dd)}return d};

// Base64url and the passkey: WebAuthn hands out ArrayBuffers; the API takes base64url.
const b64u=(buf)=>{let s='';for(const b of new Uint8Array(buf))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const fromB64u=(s)=>{const n=s.replace(/-/g,'+').replace(/_/g,'/');const bin=atob(n+'==='.slice((n.length+3)%4));return Uint8Array.from(bin,(c)=>c.charCodeAt(0))};
const assertionOf=(cred)=>({authenticatorData:b64u(cred.response.authenticatorData),clientDataJSON:b64u(cred.response.clientDataJSON),signature:b64u(cred.response.signature)});
const hasPasskeys=()=>!!(window.PublicKeyCredential&&navigator.credentials);

// The session: in this tab only, gone when it closes or after 15 minutes.
const KEY='purser.cloud.session';
const load=()=>{try{const s=JSON.parse(sessionStorage.getItem(KEY)||'null');return s&&s.exp>Date.now()?s:null}catch(e){return null}};
const save=(s)=>{try{sessionStorage.setItem(KEY,JSON.stringify(s))}catch(e){}};
const forget=()=>{try{sessionStorage.removeItem(KEY)}catch(e){}};
let S=load();let ME=null;let notice=null;let connNote=null;

class Expired extends Error{}
async function api(path,o){
  o=o||{};const token=o.token||(S&&S.token);
  const headers={};if(token)headers.authorization='Bearer '+token;if(o.body!==undefined)headers['content-type']='application/json';
  const r=await fetch(path,{method:o.method||'GET',headers,body:o.body===undefined?undefined:JSON.stringify(o.body)});
  if(r.status===401&&!o.token&&S){forget();S=null;ME=null;notice=t('cs.session_ended');go('#/sign-in');throw new Expired('signed out')}
  if(o.raw){if(!r.ok){const j=await r.json().catch(()=>({error:r.statusText}));throw new Error(j.error||r.statusText)}return r}
  const j=await r.json().catch(()=>({error:r.statusText}));
  if(!r.ok)throw new Error(j.error||r.statusText);
  return j}
async function download(path,name){const r=await api(path,{raw:true});const url=URL.createObjectURL(await r.blob());const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
const go=(h)=>{if(location.hash===h)route();else location.hash=h};

function shell(){
  document.body.className=S?'signed-in':'signed-out';
  if(S){const left=Math.max(0,Math.round((S.exp-Date.now())/60000));const n=ME&&ME.user&&ME.user.display_name?ME.user.display_name:'',c=ME&&ME.tenant?ME.tenant.name:'',e=t('cs.ends_in',{n:left});const w=$('#who');
    // Who, the company and the session's time left; a narrow header drops the company, then the time (both stay in the title).
    w.replaceChildren(el('span','wn',n),el('span','we',(n?' · ':'')+e));w.title=[n,c,e].filter(Boolean).join(' · ');
    // The company this session is in, and its Airwallex account as Airwallex last reported it (a platform runs several).
    const co=$('#co'),aw=ME&&ME.airwallex;co.replaceChildren();if(c){const cx=/^(.+?)(\s+\([^)]*\))$/.exec(c);co.append(el('span','av',c.trim().charAt(0).toUpperCase()),el('span','cn',cx?[cx[1],el('span','cx',cx[2])]:c));
      // The demo company has no account of its own: its chip says what its rows are (jury, 13 Nov: "No Airwallex account
      // yet" read against rows paid on Airwallex rails).
      co.append(ME&&ME.demo?el('span','aw demo',[el('i',''),el('span','aww',t('cs.demo.chip'))]):aw?el('span','aw '+String(aw.status).replace(/[^a-z_]/g,''),[el('i',''),el('span','aww',[el('span','awl','Airwallex · '),tk('cs.awx.status.'+aw.status,aw.status)])]):el('span','aw none',[el('i',''),el('span','aww',t('cs.awx.none'))]));
      co.title=[n,c,aw?'Airwallex '+(aw.account_id||'')+' · '+tk('cs.awx.status.'+aw.status,aw.status):''].filter(Boolean).join(' · ')}}
  // The demo company (Try as guest): one ribbon on every page says what it is, and offers the way out.
  const dm=$('#demo');if(dm){const on=!!(S&&ME&&ME.demo);dm.hidden=!on;document.body.classList.toggle('demo',on)}
  // An invoice belongs to the Books tab (Invoices & books, 13 Nov): the old Invoices route and an invoice's page light it.
  const tab0=(location.hash.split('/')[1]||'').split('?')[0];const tab=tab0==='invoices'?'books':tab0;
  for(const a of document.querySelectorAll('#tabs a'))if(a.dataset.tab===tab){a.setAttribute('aria-current','page');if(a.parentElement.scrollWidth>a.parentElement.clientWidth)a.scrollIntoView({block:'nearest',inline:'nearest'})}else a.removeAttribute('aria-current');
}
// A language chosen in the page (the person's own, or the company's for an owner who follows it): remember it in this
// browser and load the page again when it is not the page's. Signed in, the person's own language decides (langOf).
function useLanguage(lang){if(lang!=='nl'&&lang!=='en')return;try{localStorage.setItem('purser.cloud.language',lang)}catch(e){}if(lang!==L.lang)location.reload()}
async function me(){if(!ME){ME=await api('/v1/me');const want=langOf(PREF,ME.user&&ME.user.language);if(want!==L.lang)useLanguage(want)}return ME}
const title=(t)=>{document.title=t?'Purser Cloud · '+t:'Purser Cloud'};
const head=(h,sub,tools)=>el('div','head',[el('div','',[el('h1','',h),sub?el('p','lede',sub):null]),tools?el('div','tools',tools):null]);

// --- Signing in -------------------------------------------------------------------------------------------------
async function signIn(slug,status){
  status.replaceChildren(note(t('cs.waiting_passkey')));
  const ch=await api('/v1/auth/challenge',{method:'POST',body:{tenant:slug},token:'-'});
  const cred=await navigator.credentials.get({publicKey:{challenge:fromB64u(ch.challenge),rpId:CFG.rpId,userVerification:'required',timeout:60000}});
  const r=await api('/v1/auth/login',{method:'POST',token:'-',body:{tenant:slug,challenge_id:ch.challenge_id,credential_id:b64u(cred.rawId),assertion:assertionOf(cred)}});
  S={token:r.session,exp:Date.now()+r.expires_in*1000-5000,slug:slug};save(S);ME=null;
}
function signInView(){
  title(t('cs.sign_in'));
  const slug=el('input','field');slug.id='slug';slug.autocomplete='organization';slug.placeholder='your-company';slug.spellcheck=false;
  try{slug.value=localStorage.getItem('purser.cloud.slug')||''}catch(e){}
  const status=el('div','');status.setAttribute('role','status');
  const b=btn(t('cs.sign_in_passkey'),'primary big','scan-face');
  // What Purser Cloud is (13 Nov), as the card's own lede: one line, so the card and the trust line still fit a phone.
  const card=el('div','card auth',[el('h1','',t('cs.sign_in')),el('p','what',t('cs.what_cloud')),
    el('label','',t('cs.company_address')),el('div','addr',[slug,el('span','',CFG.mailDomain?'@'+CFG.mailDomain:'.purser')]),b,status,
    el('p','alt',[t('cs.new_company'),(()=>{const a=el('a','',t('cs.set_it_up'));a.href='#/start';return a})()])]);
  // Try as guest: the demo company, read only, no passkey and no e-mail (POST /v1/auth/guest). Its data is demo data.
  const gb=btn(t('cs.guest.button'),'ghost big','arrow-up-right');gb.id='guest';
  const gs=el('div','');gs.setAttribute('role','status');
  gb.onclick=async()=>{gb.disabled=true;gs.replaceChildren(note(t('cs.guest.opening')));
    try{await guestIn(true)}
    catch(e){gs.replaceChildren(note(t('cs.guest.failed',{error:e.message}),'bad'));gb.disabled=false}};
  card.append(el('div','guest',[el('div','or',[el('span','',t('cs.guest.or'))]),gb,el('p','gsub',t('cs.guest.sub')),gs]));
  if(notice){status.append(note(notice,'bad'));notice=null}
  if(!hasPasskeys()){b.disabled=true;status.append(note(t('cs.no_passkeys'),'bad'))}
  b.onclick=async()=>{const s=slug.value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,40}$/.test(s)){status.replaceChildren(note(t('cs.slug_rule'),'bad'));return}
    b.disabled=true;try{await signIn(s,status);try{localStorage.setItem('purser.cloud.slug',s)}catch(e){}go('#/overview')}catch(e){if(!(e instanceof Expired))status.replaceChildren(note(e.name==='NotAllowedError'?t('cs.passkey_cancelled'):e.message,'bad'))}finally{b.disabled=false}};
  slug.onkeydown=(e)=>{if(e.key==='Enter')b.click()};
  view().replaceChildren(card);slug.focus();
}

// --- A passkey made and enrolled: two prompts, one to make it, one to prove it by signing the enrolment's secret ----
async function enrolPasskey(o){
  const userId=crypto.getRandomValues(new Uint8Array(16));
  const made=await navigator.credentials.create({publicKey:{rp:{id:CFG.rpId,name:'Purser Cloud'},user:{id:userId,name:o.name,displayName:o.name},challenge:crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{userVerification:'required',residentKey:'required'},attestation:'none',timeout:120000}});
  const spki=new Uint8Array(made.response.getPublicKey());
  // A P-256 key in SPKI ends with 0x04, x (32 bytes), y (32 bytes).
  const pt=spki.slice(spki.length-65);if(pt[0]!==4)throw new Error(t('cs.not_p256'));
  const signed=await navigator.credentials.get({publicKey:{challenge:fromB64u(o.token),rpId:CFG.rpId,allowCredentials:[{type:'public-key',id:made.rawId}],userVerification:'required',timeout:120000}});
  await api('/v1/auth/enrol',{method:'POST',token:'-',body:{tenant:o.slug,enrolment_id:o.enrolment_id,token:o.token,credential_id:b64u(made.rawId),x:b64u(pt.slice(1,33)),y:b64u(pt.slice(33,65)),assertion:assertionOf(signed)}});
}

// --- First run: a new company, with the owner key Purser handed over ------------------------------------------------
function startView(){
  title(t('cs.setup'));
  let key='',slug='',info=null,sync=null;
  const box=el('div','card auth start');
  // The three steps in one row: numbered, the current one marked, done ones ticked; the current one's line below.
  const steps=el('ol','stepper');const sub=el('p','stepsub');const status=el('div','');status.setAttribute('role','status');
  function stepItem(n,label,state){const li=el('li',state||'',[el('span','n',state==='done'?ic('circle-check'):String(n)),el('span','sl',label)]);if(state==='now')li.setAttribute('aria-current','step');return li}
  function draw(stage){
    steps.replaceChildren(
      stepItem(1,t('cs.step1'),stage>1?'done':'now'),
      stepItem(2,t('cs.step2'),stage>2?'done':stage===2?'now':''),
      stepItem(3,t('cs.step3'),stage===3?'now':''));
    sub.textContent=[t('cs.step1_sub'),t('cs.step2_sub'),t('cs.step3_sub')][stage-1];
  }
  // Each stage in a fresh block, so it fades in (CSS only, off for those who ask for less motion).
  const body=el('div','');const stageOf=(kids)=>body.replaceChildren(el('div','stage',kids));
  function stage1(){
    draw(1);
    const s=el('input','field');s.placeholder='your-company';s.spellcheck=false;s.id='start-slug';
    const k=el('input','field');k.type='password';k.placeholder='pck_…';k.autocomplete='off';k.id='start-key';
    const b=btn(t('cs.continue'),'primary big');
    stageOf([el('label','',t('cs.company_address')),el('div','addr',[s,el('span','',CFG.mailDomain?'@'+CFG.mailDomain:'.purser')]),el('label','',t('cs.starter_key')),k,
      el('p','hint',t('cs.starter_note')),b]);
    b.onclick=async()=>{slug=s.value.trim().toLowerCase();key=k.value.trim();
      try{info=await api('/v1/me',{token:key});if(info.tenant.slug!==slug)throw new Error(t('cs.other_company_key'));if(!info.user)throw new Error(t('cs.not_owner_key'));stage2()}catch(e){status.replaceChildren(note(e.message,'bad'))}};
  }
  function stage2(){
    draw(2);status.replaceChildren();
    const name=el('input','field');name.value=info.tenant.name||'';name.id='start-name';
    const b=btn(t('cs.make_passkey'),'primary big','scan-face');
    stageOf([el('label','',t('cs.company_name')),name,info.owner_has_passkey?note(t('cs.owner_has_passkey'),'bad'):null,b]);
    if(info.owner_has_passkey)b.disabled=true;
    if(!hasPasskeys()){b.disabled=true;status.append(note(t('cs.no_passkeys_short'),'bad'))}
    b.onclick=async()=>{b.disabled=true;try{
      if(name.value.trim()&&name.value.trim()!==info.tenant.name)await api('/v1/company',{method:'POST',token:key,body:{name:name.value.trim()}});
      status.replaceChildren(note(t('cs.follow_device')));
      const e=await api('/v1/users/'+encodeURIComponent(info.user.id)+'/enrolment',{method:'POST',token:key});
      await enrolPasskey({slug,name:(info.user.display_name||t('cs.owner'))+' · '+slug,enrolment_id:e.enrolment_id,token:e.token});
      status.replaceChildren(note(t('cs.passkey_saved'),'ok'));
      await signIn(slug,status);
      stage3()}catch(e){if(!(e instanceof Expired))status.replaceChildren(note(e.name==='NotAllowedError'?t('cs.passkey_cancelled'):e.message,'bad'));b.disabled=false}};
  }
  async function stage3(){
    draw(3);status.replaceChildren();
    ME=null;const m=await me();
    const inbox=m.inbox?el('p','inbox',[ic('mail'),t('cs.mail_to'),el('b','mono',m.inbox)]):note(t('cs.inbox_later'));
    const make=btn(t('cs.make_runner_key'),'primary','key-round');
    const out=el('div','');
    stageOf([note(t('cs.starter_gone'),'ok'),inbox,el('p','',[t('cs.connect_runner')]),make,out,
      el('p','alt',[(()=>{const a=el('a','',t('cs.open_console'));a.href='#/overview';return a})()])]);
    make.onclick=async()=>{make.disabled=true;try{sync=await api('/v1/keys',{method:'POST',body:{name:t('cs.runner_key_name'),scopes:['sync'],expires_in_days:90}});
      out.replaceChildren(el('div','once',[el('b','',t('cs.shown_once')),t('cs.run_this'),
        el('code','cmd','PURSER_CLOUD_URL='+CFG.origin+' PURSER_CLOUD_KEY='+sync.api_key+' npm run cloud -- push')]))}catch(e){out.replaceChildren(note(e.message,'bad'));make.disabled=false}};
    key='';
  }
  box.append(el('h1','',t('cs.setup')),el('p','',t('cs.setup_lede')),steps,sub,body,status);
  view().replaceChildren(box);stage1();
}

// --- An invited person makes their passkey (the owner shares the link; its secret is in the fragment, never sent) ---
function enrolView(q){
  // The secret leaves the address bar and the history at once (red team round 5); the page keeps it in memory only.
  const e=q.get('e')||'',k=q.get('k')||'';
  history.replaceState(null,'','#/enrol');
  title(t('cs.enrol_title'));
  const status=el('div','');status.setAttribute('role','status');
  const b=btn(t('cs.make_passkey'),'primary big','scan-face');b.disabled=true;
  const who=el('p','',t('cs.checking_invite'));
  const card=el('div','card auth',[el('h1','',t('cs.enrol_title')),who,b,status]);
  view().replaceChildren(card);
  if(!e||!k){who.replaceChildren(note(t('cs.link_used'),'bad'));return}
  if(!hasPasskeys()){status.append(note(t('cs.no_passkeys_short'),'bad'))}
  // Which company and person the secret is for comes from the server, never from the link (red team round 5).
  api('/v1/auth/invite',{method:'POST',token:'-',body:{enrolment_id:e,token:k}}).then((inv)=>{
    who.replaceChildren(t('cs.enrol_added'),el('b','',inv.company),' (',el('span','mono',inv.tenant),')',t('cs.enrol_as'),el('b','',inv.person),t('cs.enrol_no_password'));
    if(hasPasskeys())b.disabled=false;
    b.onclick=async()=>{b.disabled=true;try{status.replaceChildren(note(t('cs.follow_device')));
      await enrolPasskey({slug:inv.tenant,name:inv.person+' · '+inv.tenant,enrolment_id:e,token:k});
      history.replaceState(null,'','#/sign-in');try{localStorage.setItem('purser.cloud.slug',inv.tenant)}catch(x){}
      status.replaceChildren(note(t('cs.enrol_done'),'ok'));setTimeout(()=>go('#/sign-in'),900)}catch(x){status.replaceChildren(note(x.name==='NotAllowedError'?t('cs.passkey_cancelled'):x.message,'bad'));b.disabled=false}};
  },(x)=>{who.replaceChildren(note(x.message,'bad'))});
}

// --- Overview ------------------------------------------------------------------------------------------------------
const byCur=(m)=>Object.entries(m||{}).filter(([,v])=>v!==0).sort(([a],[b])=>a.localeCompare(b));
function money(m,emptyWord){const e=byCur(m);if(!e.length)return emptyWord||t('none');const s=el('span','');s.append(el('small','',cur(e[0][0])),'\u00a0'+cents(e[0][1]));return s}
function others(m){const e=byCur(m).slice(1);return e.length?e.map(([c,v])=>cur(c)+' '+cents(v)).join(' · '):''}
function tile(label,icon,value,extra,tone){const t=el('div','card tile'+(tone?' '+tone:''));const v=el('div','v num');if(value instanceof Node)v.append(value);else v.textContent=value;t.append(el('div','l',[ic(icon),label]),v);if(extra)t.append(el('div','x',extra));return t}
const initials=(n)=>{const w=String(n||'?').replace(/\([^)]*\)/g,' ').replace(/[^\p{L}\p{N} ]/gu,' ').trim().split(/\s+/).filter(Boolean);return (((w[0]||'?')[0]||'?')+((w[1]||'')[0]||'')).toUpperCase()};
const av=(n)=>{const a=el('span','av2',initials(n));a.setAttribute('aria-hidden','true');return a};
// A labelled bar in one hue (dataviz rule: one hue, light to dark, every part named with its value, never colour alone).
function segbar(parts,label){const tot=parts.reduce((n,p)=>n+Math.max(0,p.v),0);const bar=el('div','seg');bar.setAttribute('role','img');bar.setAttribute('aria-label',label+': '+parts.map(p=>p.l+' '+p.t).join(', '));
  parts.forEach((p,i)=>{if(p.v<=0||!tot)return;const s=el('span','s'+i);s.style.width=(p.v/tot*100).toFixed(2)+'%';s.title=p.l+': '+p.t;bar.append(s)});
  if(!tot)bar.classList.add('empty');
  return el('div','segwrap',[bar,el('ul','legend',parts.map((p,i)=>el('li',p.v>0?'':'zero',[el('i','s'+i),el('span','',p.l),el('b','num',p.t)])))])}
const meter=(v,max)=>{const m=el('span','meter');const f=el('span','');f.style.width=(max>0&&v>0?Math.max(2,v/max*100):0).toFixed(1)+'%';m.append(f);m.setAttribute('aria-hidden','true');return m};
const toCents=(v)=>{const m=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(v||''));if(!m)return 0;const c=Number(m[2])*100+Number((m[3]||'').padEnd(2,'0'));return m[1]?-c:c};
// --- The start screen's dashboard (GET /v1/dashboard): every figure counted by the cloud from the company's own rows.
// Charts are SVG and DOM built here (no library, no inline style markup: the page's nonce policy), drawn at the card's
// own width so their words stay legible on a phone. Numbers count up and parts rise in once they are in view; with
// reduced motion everything simply stands.
const SVGNS='http://www.w3.org/2000/svg';
const sv=(tag,attrs,kids)=>{const e=document.createElementNS(SVGNS,tag);for(const k in attrs||{})e.setAttribute(k,String(attrs[k]));for(const c of [].concat(kids??[]))if(c)e.append(c);return e};
const RM=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function whenSeen(node,fn){if(RM()||!('IntersectionObserver' in window)){fn(true);return}const io=new IntersectionObserver((es)=>{if(es.some(e=>e.isIntersecting)){io.disconnect();fn(false)}},{threshold:.25});io.observe(node)}
function countUp(node,target,fmt){node.textContent=fmt(target);whenSeen(node,(still)=>{if(still)return;const t0=performance.now();const step=(now)=>{const k=Math.min(1,(now-t0)/700);node.textContent=fmt(k<1?target*(1-Math.pow(1-k,3)):target);if(k<1)requestAnimationFrame(step)};node.textContent=fmt(0);requestAnimationFrame(step)})}
const dday=(iso)=>new Date(String(iso).slice(0,10)+'T12:00:00Z').toLocaleDateString(L.lang==='nl'?'nl-NL':'en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const kfmt=(c)=>{const a=Math.abs(c)/100;return (c<0?'-':'')+(a>=1000?(a/1000).toFixed(a>=10000?0:1).replace('.',L.lang==='nl'?',':'.')+'k':String(Math.round(a)))};
const amt=(D,c)=>cur(D.currency)+' '+cents(Math.round(c));
function dcard(cls,title,sub,body){return el('section','card dcard rise '+cls,[el('div','dh',[el('h2','',title),sub?el('p','',sub):null]),body])}
function kpi(D,label,icon,c,sub,tone,plain){const v=el('b','num');countUp(v,c,plain?(x)=>String(Math.round(x)):(x)=>amt(D,x));return el('div','card kpi rise'+(tone?' '+tone:''),[el('span','kl',[ic(icon),label]),v,sub?el('span','ks',sub):null])}
// Net cash, day by day: one line, its area to zero, three gridlines, the first, middle and last day, the end value.
function cashChart(D,W){
  const pts=D.cash.map(p=>({d:p.day,v:toCents(p.net),i:toCents(p.in),o:toCents(p.out)}));const H=Math.max(190,Math.min(300,Math.round(W*0.46))),l=48,r=14,tp=14,b=26;
  const min=Math.min(0,...pts.map(p=>p.v)),max=Math.max(1,...pts.map(p=>p.v));const X=(k)=>l+(pts.length<2?0:k/(pts.length-1))*(W-l-r),Y=(v)=>tp+(max-v)/(max-min||1)*(H-tp-b);
  const g=sv('svg',{viewBox:'0 0 '+W+' '+H,width:W,height:H,class:'chart',role:'img','aria-label':t('cs.dash.cash_title')+': '+amt(D,pts.length?pts[pts.length-1].v:0)});
  g.append(sv('defs',{},[sv('linearGradient',{id:'cashfill',x1:0,y1:0,x2:0,y2:1},[sv('stop',{offset:'0%','stop-color':'var(--accent)','stop-opacity':.22}),sv('stop',{offset:'100%','stop-color':'var(--accent)','stop-opacity':0})])]));
  // Gridlines at zero, half the top and the top; the lowest point only when cash went clearly below zero.
  const ticks=[0,max/2,max].concat(min<-max*0.08?[min]:[]);
  for(const v of ticks){const y=Y(v);g.append(sv('line',{x1:l,x2:W-r,y1:y,y2:y,class:v===0?'zero':'grid'}),sv('text',{x:l-8,y:y+4,class:'ax','text-anchor':'end'},[document.createTextNode(v===0?'0':kfmt(v))]))}
  const line=pts.map((p,k)=>(k?'L':'M')+X(k).toFixed(1)+' '+Y(p.v).toFixed(1)).join(' ');
  g.append(sv('path',{d:line+' L'+X(pts.length-1).toFixed(1)+' '+Y(0).toFixed(1)+' L'+X(0).toFixed(1)+' '+Y(0).toFixed(1)+' Z',class:'area',fill:'url(#cashfill)'}),sv('path',{d:line,class:'line',pathLength:1}));
  for(const k of [0,Math.floor((pts.length-1)/2),pts.length-1])if(pts[k])g.append(sv('text',{x:X(k),y:H-6,class:'ax','text-anchor':k===0?'start':k===pts.length-1?'end':'middle'},[document.createTextNode(dday(pts[k].d))]));
  // One hover target per day, its words in a title (the day, what came in and went out, where cash stood).
  pts.forEach((p,k)=>{const w=(W-l-r)/Math.max(1,pts.length-1);g.append(sv('rect',{x:X(k)-w/2,y:tp,width:w,height:H-tp-b,class:'hit'},[sv('title',{},[document.createTextNode(dday(p.d)+': '+t('cs.dash.in')+' '+amt(D,p.i)+' · '+t('cs.dash.out')+' '+amt(D,p.o)+' · '+t('cs.dash.net')+' '+amt(D,p.v))])]))});
  const e=pts[pts.length-1];if(e)g.append(sv('circle',{cx:X(pts.length-1),cy:Y(e.v),r:4.5,class:'end'}));
  return g}
// Payments per week: CFO-approved and within an agent's own limit, as counts (the amounts differ too much to share a scale).
function weekChart(D,W){
  const ws=D.approvals.weeks;const H=200,l=10,b=26,tp=18;const max=Math.max(1,...ws.map(w=>w.cfo+w.alone));const bw=Math.min(46,(W-l*2)/Math.max(1,ws.length)*0.6),step=(W-l*2)/Math.max(1,ws.length);
  const g=sv('svg',{viewBox:'0 0 '+W+' '+H,width:W,height:H,class:'chart',role:'img','aria-label':t('cs.dash.appr_title')});
  ws.forEach((w,k)=>{const x=l+step*k+(step-bw)/2,h=(n)=>n/max*(H-tp-b);const yc=H-b-h(w.cfo),ya=yc-h(w.alone);
    const tip=dday(w.week)+': '+w.cfo+' '+t('cs.dash.appr_cfo')+' ('+amt(D,toCents(w.cfo_amount))+') · '+w.alone+' '+t('cs.dash.appr_alone')+' ('+amt(D,toCents(w.alone_amount))+')';
    const col=sv('g',{class:'col'},[sv('title',{},[document.createTextNode(tip)])]);
    if(w.cfo)col.append(sv('rect',{x,y:yc,width:bw,height:h(w.cfo),rx:3,class:'b cfo'}));
    if(w.alone)col.append(sv('rect',{x,y:ya,width:bw,height:h(w.alone),rx:3,class:'b alone'}));
    col.append(sv('text',{x:x+bw/2,y:ya-5,class:'val','text-anchor':'middle'},[document.createTextNode(String(w.cfo+w.alone))]),sv('text',{x:x+bw/2,y:H-8,class:'ax','text-anchor':'middle'},[document.createTextNode(dday(w.week))]));
    g.append(col)});
  return g}
// Invoices by state: a ring of their counts, the total in its middle, and a legend with each count and amount.
function invoiceRing(D){
  const I=D.invoices;const parts=[['paid','cs.dash.inv_paid'],['waiting_cfo','cs.dash.inv_waiting'],['needs_vendor','cs.dash.inv_vendor'],['open','cs.dash.inv_open'],['stopped','cs.dash.inv_stopped']].filter(([k])=>I[k]&&I[k].count);
  const tot=parts.reduce((n,[k])=>n+I[k].count,0);const g=sv('svg',{viewBox:'0 0 120 120',width:132,height:132,class:'ring',role:'img','aria-label':t('cs.dash.inv_title')+': '+parts.map(([k,l])=>t(l)+' '+I[k].count).join(', ')});
  g.append(sv('circle',{cx:60,cy:60,r:46,class:'track'}));let off=0;
  parts.forEach(([k],i)=>{const f=I[k].count/(tot||1)*100;g.append(sv('circle',{cx:60,cy:60,r:46,pathLength:100,class:'seg r'+i,'stroke-dasharray':(f-1.2).toFixed(2)+' '+(100-f+1.2).toFixed(2),'stroke-dashoffset':(25-off).toFixed(2)}));off+=f});
  g.append(sv('text',{x:60,y:60,class:'rt','text-anchor':'middle'},[document.createTextNode(String(tot))]),sv('text',{x:60,y:78,class:'rs','text-anchor':'middle'},[document.createTextNode(t('cs.dash.inv_count'))]));
  const lg=el('ul','rlegend',parts.map(([k,l],i)=>el('li','',[el('i','r'+i),el('span','',t(l)),el('b','num',String(I[k].count)),el('small','num',amt(D,toCents(I[k].amount)))])));
  return el('div','ringwrap',[g,el('div','',[lg,I.duplicates_stopped?el('p','fine',t('cs.dash.inv_dup',{n:I.duplicates_stopped})):null])])}
// Spend by who started it: one bar each, its amount and how many payments; Airwallex's declines said, never counted.
// The demo company's declines are its demo data's, so a guest reads "declined (simulated)" (judge run, 13 Nov).
function spendBars(D){
  const max=Math.max(1,...D.spend.map(s=>toCents(s.amount)));
  return el('ul','sbars',D.spend.map((s,i)=>{const f=el('span','sf');f.style.width=Math.max(1.5,toCents(s.amount)/max*100).toFixed(1)+'%';
    return el('li','',[el('div','sl',[el('span','',tk('cs.dash.spend.'+s.key,s.label)),el('b','num',amt(D,toCents(s.amount)))]),el('span','strk',[f]),el('span','ss',[t('cs.dash.n_payments',{n:s.count}),s.declined?el('span','dec',' · '+t(S&&S.guest?'cs.dash.declined_sim':'cs.dash.declined',{n:s.declined})):null])])}))}
function feedList(D){
  return el('ol','feed',D.feed.map(f=>el('li','f-'+f.tone,[el('span','fd'),el('div','',[el('div','fw',[el('b','',f.who),el('time','',dday(f.at))]),el('p','',f.text)])])))}
function dashBlock(D){
  if(!D||!D.cash||!D.cash.length)return null;
  const wide=innerWidth>=980,full=view().clientWidth||960;
  const cashW=Math.round(wide?full*0.64-40:full-40),weekW=Math.round(wide?full*0.5-44:full-40);
  const k=el('div','kpis',[
    kpi(D,t('cs.dash.in'),'arrow-down-left',toCents(D.money.in),t('cs.dash.in_sub'),'pos'),
    kpi(D,t('cs.dash.out'),'arrow-up-right',toCents(D.money.out),t('cs.dash.out_sub')),
    kpi(D,t('cs.dash.net'),'wallet',toCents(D.money.net),t('cs.dash.net_sub',{date:dday(D.since)}),toCents(D.money.net)>=0?'pos':'neg'),
    kpi(D,t('cs.dash.decisions'),'shield-check',D.agents.decisions,D.agents.by_fallback?t('cs.dash.decisions_fallback',{n:D.agents.by_fallback}):t('cs.dash.decisions_sub'),'',true)]);
  const g1=el('div','dgrid g1',[dcard('cash',t('cs.dash.cash_title'),t('cs.dash.cash_sub',{cur:cur(D.currency),date:dday(D.since)}),el('div','cv',[cashChart(D,cashW)])),
    dcard('inv',t('cs.dash.inv_title'),t('cs.dash.inv_sub',{cur:cur(D.currency)}),invoiceRing(D))]);
  const g2=el('div','dgrid g2',[dcard('spend',t('cs.dash.spend_title'),t('cs.dash.spend_sub',{cur:cur(D.currency)}),spendBars(D)),
    dcard('weeks',t('cs.dash.appr_title'),t('cs.dash.appr_sub'),el('div','',[el('div','cv',[weekChart(D,weekW)]),el('ul','klegend',[el('li','',[el('i','cfo'),t('cs.dash.appr_cfo')]),el('li','',[el('i','alone'),t('cs.dash.appr_alone')])])]))]);
  const g3=dcard('feedc',t('cs.dash.feed_title'),t('cs.dash.feed_sub'),feedList(D));
  const box=el('div','dash',[k,g1,g2,g3]);
  // Every card rises in on the next frame (bars grow, the line draws itself), whether or not it is on the screen yet
  // (review, 13 Nov: cards waiting to be scrolled to left an empty band of about 850 px between the charts and "Next" at
  // 1440 px, in a page read whole). Reduced motion: the CSS shows all at once.
  requestAnimationFrame(()=>{for(const n of box.querySelectorAll('.rise'))n.classList.add('in')});
  return box}
async function overviewView(){
  title(t('cs.nav.overview'));
  const [m,x,all,D]=await Promise.all([me(),api('/v1/insights'),api('/v1/invoices?limit=200'),api('/v1/dashboard').catch((e)=>{if(e instanceof Expired)throw e;return null})]);shell();
  const items=all.items||[];
  const blocked=Object.entries(x.blocked_by_reason||{}).sort((a,b)=>b[1]-a[1]);const nb=blocked.reduce((n,[,c])=>n+c,0);
  const waits=x.waiting.for_cfo+x.waiting.for_supplier_check+x.waiting.for_a_person;
  const tiles=el('div','tiles',[
    tile(t('cs.t.open'),'wallet',money(x.open_net_cents,t('cs.nothing_open')),others(x.open_net_cents)||null),
    tile(t('cs.t.due7'),'calendar-range',money(x.due_7_days_cents),byCur(x.due_30_days_cents).length?t('cs.x.due30',{amount:byCur(x.due_30_days_cents).map(([c,v])=>cur(c)+' '+cents(v)).join(' · ')}):null),
    tile(t('cs.t.overdue'),'clock',money(x.overdue_cents),byCur(x.overdue_cents).length?t('cs.x.pay_first'):t('cs.x.in_time'),byCur(x.overdue_cents).length?'alert':'calm'),
    tile(t('cs.t.waits'),'inbox',String(waits),t('cs.x.waits',{faceid:x.waiting.for_cfo,other:x.waiting.for_a_person+x.waiting.for_supplier_check})),
    tile(t('cs.t.blocked'),'octagon-x',String(nb),blocked.length?tk('cs.w.f.'+blocked[0][0],t('cs.w.blocked')):t('cs.x.none_blocked'),nb?'alert':'calm')]);
  // The next thing to do, from the same invoices: the CFO's Face ID first, then what needs a person.
  const faceid=items.filter(i=>i.status==='waiting_cfo').length,todo=items.filter(i=>['ready','needs_review','needs_vendor'].includes(i.status)).length;
  const nx=el('a','card next'+(faceid||todo?' act':''));nx.href=faceid?'#/invoices?f=waiting_cfo':'#/invoices?f=act';
  nx.append(el('span','nic',ic(faceid?'scan-face':todo?'triangle-alert':'circle-check')),el('div','',[el('span','nl',t('cs.next.label')),el('b','',faceid?t(faceid===1?'cs.next.faceid_1':'cs.next.faceid_n',{n:faceid}):todo?t(todo===1?'cs.next.todo_1':'cs.next.todo_n',{n:todo}):t('cs.next.done')),
    el('span','ns',faceid?t('cs.next.faceid_go'):todo?t('cs.next.todo_go'):t('cs.next.done_sub'))]),faceid||todo?ic('chevron-right'):null);
  // When the open invoices fall due, in their main currency (other currencies are said, not mixed in).
  const open=items.filter(i=>!['paid','rejected'].includes(i.status));const per={};for(const i of open)per[i.currency]=(per[i.currency]||0)+toCents(i.total);
  const main=Object.entries(per).sort((a,b)=>b[1]-a[1])[0];const days=(d)=>Math.round((Date.parse(d)-Date.parse(today))/86400000);
  const b=[0,0,0,0];for(const i of open){if(!main||i.currency!==main[0])continue;const n=i.due_date?days(i.due_date):99999;b[n<=0?0:n<=7?1:n<=30?2:3]+=toCents(i.total)}
  const lab=['cs.due.late','cs.due.d7','cs.due.d30','cs.due.later'];
  const due=el('div','card panel due',[el('h2','',t('cs.due.title')),main?segbar(b.map((v,k)=>({l:t(lab[k]),v,t:cur(main[0])+' '+cents(v)})),t('cs.due.title')):el('p','lede',t('cs.due.none')),
    Object.keys(per).length>1?el('p','fine',t('cs.due.other_cur')):null]);
  const inbox=m.inbox?el('p','inbox',[ic('mail'),t('cs.mail_to'),el('b','mono',m.inbox)]):null;
  const w=items.filter(i=>i.status==='waiting_cfo');
  const wl=el('div','card list');
  if(!w.length)wl.append(el('div','empty',[el('b','',t('cs.nothing_waits')),t('cs.nothing_waits_sub')]));
  else{wl.append(rowHead());for(const i of w)wl.append(invoiceRow(i))}
  view().replaceChildren(...[whatCloud(m),head(t('cs.nav.overview'),t('cs.overview_lede',{name:m.tenant.name||''})),dashBlock(D),el('div','ovtop',[nx,due]),tiles,inbox,
    el('section','section waits',[el('div','bar',[el('h2','',t('cs.waits_head'))]),wl])].filter(Boolean));
}

// --- The engine (test money, on its stand-in bank) -----------------------------------------------------------------
// Only a page whose config says engine true asks /v1/engine: a cloud with no engine answers 404 there, so its page never
// asks and looks as it always did. The answer is kept for the signed-in session; engineStale() has it asked again.
const ENG={token:null,p:null};
function engineStatus(){
  // The demo company has no engine (its guests only read): it is never asked, so no 404 lands in the browser's console.
  if(!CFG.engine||!S||S.guest)return Promise.resolve(null);
  if(ENG.token!==S.token){ENG.token=S.token;ENG.p=null}
  if(!ENG.p)ENG.p=api('/v1/engine').catch((e)=>{if(e instanceof Expired)throw e;return null});
  return ENG.p}
const engineStale=()=>{ENG.p=null};
// The header's one test-money chip says the engine is there, and in its title what that means.
function engineChip(on){const c=$('.appbar .test');c.querySelector('.tl').textContent=' '+(on?t('cs.eng.chip'):t('test.label'));c.title=on?t('cs.eng.chip_title'):t('test.title');$('#foot').textContent=on?t('cs.eng.foot'):t('cs.foot')}

// The panel "At work": the engine's events as lines (src/ui/engineEvents.ts), newest first, six in view and the rest
// folded. Its state belongs to the page, not to a view, so any view can mount it (workPanel()): the seq read up to, the
// lines so far, and one timer. It asks GET /v1/engine/events once when mounted, then every 800 ms while one of this
// page's engine requests is under way (engineCall) and for 10 s after the last one ended; never while the page is hidden,
// after the session ended, or once its view is gone.
const lineOf=eventLineOf(L.m,ma);
const WORK={token:null,seq:0,lines:[],busy:0,until:0,timer:null,polling:null,box:null,ui:null,caught:false,onEvents:null};
const WORK_SHOWN=6,WORK_KEPT=200,WORK_EVERY=800,WORK_AFTER=10000;
function workStop(){clearTimeout(WORK.timer);WORK.timer=null;WORK.box=null;WORK.ui=null;WORK.onEvents=null}
const workOn=()=>!!(S&&WORK.box&&WORK.box.isConnected&&document.visibilityState!=='hidden');
function workNext(ms){clearTimeout(WORK.timer);WORK.timer=null;if(workOn()&&(WORK.busy>0||Date.now()<WORK.until))WORK.timer=setTimeout(workTick,ms)}
async function workTick(){WORK.timer=null;await workPoll();workNext(WORK_EVERY)}
function workPoll(){
  if(WORK.polling||!S||!WORK.box)return WORK.polling||Promise.resolve();
  const token=S.token;
  WORK.polling=(async()=>{const fresh=[];
    try{for(;;){const r=await api('/v1/engine/events?after='+WORK.seq+'&limit=200');if(WORK.token!==token)return;const items=r.items||[];const next=Number(r.next)||0;
      fresh.push(...items);const moved=next>WORK.seq;if(moved)WORK.seq=next;if(items.length<200||!moved)break}}
    catch(e){/* an ended session has gone to sign-in; anything else is asked again on the next tick */}
    finally{WORK.polling=null}
    if(WORK.token!==token)return;
    if(fresh.length){const add=fresh.map((e)=>({n:Number(e.seq)||0,ts:e.ts,l:lineOf(e)}));WORK.lines=WORK.lines.concat(add).slice(-WORK_KEPT);workAdd(add);if(WORK.caught&&WORK.onEvents)WORK.onEvents(fresh)}
    WORK.caught=true})();
  return WORK.polling}
const workItem=(x)=>{const d=new Date(x.ts);const tm=el('time','',isNaN(d)?'':d.toLocaleTimeString(NL?'nl-NL':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));tm.dateTime=String(x.ts||'');tm.title=stamp(x.ts);
  const li=el('li','',[tm,el('b',x.l.tag||'',cap(x.l.who)),el('span','',x.l.text)]);li.dataset.n=String(x.n);return li};
// New lines go on top of the live list; a line pushed out of the newest six moves into the fold, newest first there too.
// A step with no words of its own (the neutral line) goes straight into the fold: in view, every line says something.
const foldIn=(older,li)=>{const n=Number(li.dataset.n);let at=older.firstElementChild;while(at&&Number(at.dataset.n)>n)at=at.nextElementSibling;older.insertBefore(li,at)};
function workAdd(add){const u=WORK.ui;if(!u)return;
  for(const x of add){if(x.l.text===L.m['cs.eng.step']){foldIn(u.older,workItem(x));continue}
    u.live.prepend(workItem(x));if(u.live.children.length>WORK_SHOWN)foldIn(u.older,u.live.lastElementChild)}
  const n=u.older.children.length;u.empty.hidden=!!u.live.children.length;u.live.hidden=!u.live.children.length;u.fold.hidden=!n;u.sum.textContent=t('cs.eng.work_earlier',{n})}
function workPanel(){
  const box=el('section','card panel work');box.id='work';
  if(!S)return box;
  if(WORK.token!==S.token){clearTimeout(WORK.timer);WORK.timer=null;WORK.token=S.token;WORK.seq=0;WORK.lines=[];WORK.busy=0;WORK.until=0}
  const live=el('ol','');live.setAttribute('aria-live','polite');const older=el('ol','');const sum=el('summary','');const fold=el('details','',[sum,older]);const empty=el('p','we',t('cs.eng.work_empty'));
  box.append(el('h2','',t('cs.eng.work')),empty,live,fold);
  WORK.box=box;WORK.ui={live,older,sum,fold,empty};WORK.caught=false;WORK.onEvents=null;
  workAdd(WORK.lines);
  // Catch up once; the view is in the page by then.
  setTimeout(()=>{workPoll().then(()=>workNext(WORK_EVERY))},0);
  return box}
// A request of this page to the engine: polling runs while it is under way and for a while after.
async function engineCall(path,o){WORK.busy++;workNext(0);
  try{return await api(path,o)}finally{WORK.busy=Math.max(0,WORK.busy-1);WORK.until=Date.now()+WORK_AFTER;workNext(WORK_EVERY)}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(WORK.timer);WORK.timer=null}else workNext(0)});

// An upload: PDF, JPEG or PNG, one file, at most 15 MB, refused here in words before anything is sent.
const ENG_MAX=15*1024*1024;
const ENG_TYPES={'application/pdf':/\.pdf$/i,'image/jpeg':/\.jpe?g$/i,'image/png':/\.png$/i};
const fileType=(f)=>{if(f.type)return ENG_TYPES[f.type]?f.type:'';for(const k in ENG_TYPES)if(ENG_TYPES[k].test(f.name||''))return k;return ''};
const readBase64=(f)=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>{const s=String(r.result||'');ok(s.slice(s.indexOf(',')+1))};r.onerror=()=>no(r.error);r.readAsDataURL(f)});
function uploadRow(o){
  const said=el('div','');said.setAttribute('role','status');
  const file=el('input','');file.type='file';file.id='eng-file';file.accept='application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';file.tabIndex=-1;file.setAttribute('aria-hidden','true');
  const up=btn(t('cs.eng.upload'),'primary');
  const drop=el('div','drop eng',[ic('file-text'),el('span','sub',t('cs.eng.upload_sub')),up,file]);
  const busy=(on)=>{up.disabled=on;up.textContent=on?t('cs.eng.uploading'):t('cs.eng.upload')};
  async function send(fs){
    if(!fs.length||up.disabled)return;
    const f=fs[0],mime=fs.length===1?fileType(f):'';
    const no=fs.length>1?t('cs.eng.one_file'):!mime?t('cs.eng.wrong_type'):f.size>ENG_MAX?t('cs.eng.too_big'):!f.size?t('cs.eng.unreadable'):'';
    if(no){said.replaceChildren(note(no,'bad'));return}
    busy(true);said.replaceChildren();
    try{
      let base64;try{base64=await readBase64(f)}catch(e){said.replaceChildren(note(t('cs.eng.unreadable'),'bad'));return}
      const name=String(f.name||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200)||'upload';
      const r=await engineCall('/v1/engine/documents',{method:'POST',body:{filename:name,mime,base64}});
      const inv=r.invoice&&r.invoice.id?r.invoice:null;
      const open=()=>{const a=el('a','',t('cs.eng.open_invoice'));a.href='#/invoices/'+encodeURIComponent(inv.id);return a};
      if(r.kind==='duplicate_document'){said.replaceChildren(el('p','note-info',[t('cs.eng.duplicate'),inv?' ':null,inv?open():null]));return}
      // The upload filed it in the engine; the list reads the cloud's copy, which the engine feeds on a sync.
      const s=await engineCall('/v1/engine/sync',{method:'POST'});engineStale();
      await o.filed();
      said.replaceChildren(note(inv?t('cs.eng.filed',{id:inv.id}):t('cs.eng.filed_other'),'ok'));
      if(s&&s.error)said.append(note(s.error,'bad'));
    }catch(e){if(!(e instanceof Expired))said.replaceChildren(note(e.message,'bad'))}
    finally{busy(false)}
  }
  up.onclick=()=>{if(!up.disabled)file.click()};
  file.onchange=()=>{const fs=[...(file.files||[])];file.value='';send(fs)};
  drop.ondragover=(e)=>{e.preventDefault();if(!up.disabled)drop.classList.add('over')};
  drop.ondragleave=()=>drop.classList.remove('over');
  drop.ondrop=(e)=>{e.preventDefault();drop.classList.remove('over');send([...((e.dataTransfer&&e.dataTransfer.files)||[])])};
  return el('div','',[drop,said])}

// --- Invoices ------------------------------------------------------------------------------------------------------
// Why, in two or three words with an icon; the whole finding stays in the row's title and on the invoice's page.
function why(i){const fs=i.findings||[];const f=fs.filter(x=>x.level!=='warn')[0]||fs[0];const full=f?cap(finding(f)):'';
  if(i.status==='paid')return ['circle-check',i.paid_at?t('cs.w.paid',{date:day(i.paid_at)}):t('paid'),''];if(i.status==='ready')return ['circle-check',t('cs.w.ready'),t('all_checks_passed')];
  if(i.status==='waiting_cfo')return ['scan-face',t('cs.w.phone'),t('cs.why_on_phone')];if(i.status==='rejected')return ['circle-minus',t('cs.w.rejected'),full];
  if(i.status==='needs_vendor')return ['clock',t('cs.w.vendor'),full];if(i.status==='blocked')return ['octagon-x',f?tk('cs.w.f.'+f.code,t('cs.w.blocked')):t('cs.w.blocked'),full];
  return ['triangle-alert',f?tk('cs.w.f.'+f.code,t('cs.w.review')):t('cs.w.review'),full]}
const rowHead=()=>el('div','row th',[el('span','',t('supplier')),el('span','',t('invoice')),el('span','',t('due')),el('span','amt',t('amount')),el('span','',t('status')),el('span','',t('why')),el('span','')]);
function invoiceRow(i){
  const a=el('a','row');a.href='#/invoices/'+encodeURIComponent(i.id);
  const sup=el('span','sup',[av(i.vendor),el('span','sn',i.vendor||t('unknown_supplier'))]);sup.title=i.vendor||'';
  const no=el('span','no',[i.invoice_no||t('no_number'),el('span','sub',[el('code','idc',i.id)])]);no.title=i.invoice_no||'';
  const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
  const w=why(i);const wy=el('span','why',[ic(w[0]),el('span','',w[1])]);wy.title=w[2]||w[1];
  a.append(sup,no,el('span','due num'+(late?' late':''),i.due_date?day(i.due_date):'–'),el('span','amt',[el('span','c',cur(i.currency)),'\u00a0'+(amount(i.total)||'–')]),el('span','stc',[chip(i.status,i.status_words)]),wy);
  const g=ic('chevron-right');g.className='go';a.append(g);return a}
// Which invoices the ledger books (GET /v1/books/bookings), for the Booked filter; read with the list.
let BOOKED={};
const FILTERS=[['all',t('filter.all'),()=>true],['open',t('cs.filter.open'),(i)=>!['paid','rejected','blocked'].includes(i.status)],['act',t('filter.act'),(i)=>['ready','needs_review','needs_vendor'].includes(i.status)],['waiting_cfo',t('filter.waiting_cfo'),(i)=>i.status==='waiting_cfo'],['paid',t('filter.paid'),(i)=>i.status==='paid'],['booked',t('cs.filter.booked'),(i)=>!!(BOOKED[i.id]&&BOOKED[i.id].length)],['blocked',t('filter.blocked'),(i)=>i.status==='blocked'],['rejected',t('filter.rejected'),(i)=>i.status==='rejected']];
async function invoicesView(q,embed){
  if(!embed)title(t('nav.invoices'));
  // With an engine: the panel "At work" for everyone, the upload for who may manage the company (an owner).
  const eng=await engineStatus();const write=!!eng&&(await me()).scopes.includes('admin');
  let all=[];let cursor=null;let filter=q&&FILTERS.some(f=>f[0]===q.get('f'))?q.get('f'):'all';
  const list=el('div','card list');const bar=el('div','bar',[el('h2','',t('nav.invoices'))]);const more=btn(t('cs.load_more'));more.hidden=true;
  function draw(){
    bar.querySelectorAll('.chip').forEach(c=>c.remove());
    for(const [k,label,fn] of FILTERS){const n=all.filter(fn).length;if(k!=='all'&&!n&&k!=='act')continue;const b=el('button','chip',[label,' ',el('b','',String(n))]);b.type='button';b.setAttribute('aria-pressed',String(filter===k));b.onclick=()=>{filter=k;draw()};bar.append(b)}
    list.replaceChildren();
    if(!all.length){list.append(el('div','empty',[el('b','',t('no_invoices_yet')),write?t('cs.eng.empty_sub'):t('cs.invoices_empty_sub')]));return}
    const shown=all.filter(FILTERS.find(f=>f[0]===filter)[2]).slice().reverse();
    list.append(rowHead());if(!shown.length)list.append(el('div','empty',[el('b','',t('nothing_here')),t('no_invoice_in_state')]));
    for(const i of shown)list.append(invoiceRow(i));
  }
  let gen=0;
  async function page(){const g=gen;const p=await api('/v1/invoices?limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(g!==gen)return;all=all.concat(p.items);cursor=p.next_cursor;more.hidden=!cursor;draw()}
  more.onclick=()=>page();
  // The first page again, drawn once it has come (no empty list in between); one reload at a time, and one more if asked meanwhile.
  let reloading=null,again=false;
  function reload(){if(reloading){again=true;return reloading}
    reloading=(async()=>{try{do{again=false;gen++;const p=await api('/v1/invoices?limit=200');all=p.items;cursor=p.next_cursor;more.hidden=!cursor;draw()}while(again)}
      catch(e){if(!(e instanceof Expired))list.before(note(e.message,'bad'))}finally{reloading=null}})();
    return reloading}
  const nodes=[embed?null:head(t('nav.invoices'),write?t('cs.eng.invoices_lede'):ME&&ME.demo?t('cs.demo.invoices_lede'):t('cs.invoices_lede')),write?uploadRow({filed:reload}):null,eng?workPanel():null,el('section','section',[bar,list,more])].filter(Boolean);
  if(embed)embed.replaceChildren(...nodes);else view().replaceChildren(...nodes);
  // An invoice that arrived, was paid or was filed in the archive: the list is read again.
  if(eng)WORK.onEvents=(evs)=>{if(evs.some((e)=>e.event==='ap.received'||e.event==='vault.filed'||(e.event==='ap.status'&&e.fields&&e.fields.status==='paid')))reload()};
  await page();
}
const RES={block:['octagon-x',t('res.block')],review:['triangle-alert',t('res.review')],wait:['clock',t('res.wait')],warn:['triangle-alert',t('res.warn')]};
// The invoice's head (who, its status chip, the amount, when it is due or was paid) and its timeline, from the read model.
function detailTop(i){
  const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
  return el('div','dhead',[el('div','who',[el('h1','',i.vendor||t('unknown_supplier')),el('div','meta',[chip(i.status,i.status_words),el('span','',t('dt.invoice',{no:i.invoice_no||t('no_number')})),el('span','','·'),el('span','',i.id),el('span','','·'),el('span','',t('cs.received_on',{date:day(i.received_at)}))])]),
    el('div','money',[el('div','big',[el('small','',cur(i.currency)),'\u00a0'+(amount(i.total)||'–')]),el('div','when',i.status==='paid'&&i.paid_at?t('paid_on',{date:day(i.paid_at)}):i.due_date?t(late?'dt.was_due':'dt.due',{date:day(i.due_date)}):t('dt.no_due'))])])}
function timelineOf(i){
  const tl=el('ul','timeline');
  tl.append(el('li','',[el('b','',t('tl.received')),el('span','',stamp(i.received_at))]));
  for(const v of i.earlier_versions||[])tl.append(el('li','',[el('b','',t('cs.changed_version',{n:v.version})),el('span','',stamp(v.replaced_at))]));
  if(i.status==='waiting_cfo')tl.append(el('li','',[el('b','',t('filed_for_face_id')),el('span','',i.proposal_id?t('cs.payment',{id:i.proposal_id}):'')]));
  if(i.paid_at)tl.append(el('li','',[el('b','',t('paid')),el('span','',stamp(i.paid_at))]));
  tl.append(el('li','',[el('b','',t('cs.last_update')),el('span','',stamp(i.updated_at))]));
  return tl}
async function invoiceView(id){
  title(t('cs.invoice'));
  // With an engine, its own view of this invoice too: what it can do with it is the engine's to say, not the read model's.
  const eng=await engineStatus();
  const [i,ev]=await Promise.all([api('/v1/invoices/'+encodeURIComponent(id)),eng?api('/v1/engine/invoices').catch((e)=>{if(e instanceof Expired)throw e;return null}):null]);
  const r=i.reading||{};
  title((i.vendor||t('cs.invoice'))+' '+(i.invoice_no||i.id));
  const back=el('a','back',[ic('arrow-left'),' '+t('dt.all')]);back.href='#/books';
  let top=detailTop(i),tl=timelineOf(i);
  // With an engine, a paid invoice shows its proof (paid, booked, archived) where the payment card was: first.
  let proof=eng&&i.status==='paid'?proofCard(i):null;let stack=null;
  // The read model again, once the engine filed or paid it: the head (its status chip), the timeline and the proof follow.
  const again=async()=>{const j=await api('/v1/invoices/'+encodeURIComponent(id));if(!top.isConnected)return;const nt=detailTop(j),nl=timelineOf(j);top.replaceWith(nt);tl.replaceWith(nl);top=nt;tl=nl;
    if(!eng||j.status!=='paid')return;
    if(pay)for(const x of pay.querySelectorAll('.acts'))x.remove();
    if(proof){await proof.refresh(j);return}
    proof=proofCard(j);if(pay&&pay.isConnected)pay.after(proof);else stack.prepend(proof)};
  const mine=ev&&(ev.items||[]).find((x)=>x.id===id);
  const pay=mine?payCard({inv:mine,eng,write:(await me()).scopes.includes('admin'),moved:again}):null;
  const acct=r.iban?'IBAN …'+String(r.iban).slice(-4):r.account_number?t('dt.account')+' …'+String(r.account_number).slice(-4):(i.iban_last4?'…'+i.iban_last4:'');
  const rc=r.currency||i.currency||'';
  const read=el('div','card panel',[el('h2','',t('dt.read')),dl([[t('supplier'),r.vendor||i.vendor],[t('cs.vat_number'),r.vat_id],[t('dt.invoice_number'),r.invoice_no||i.invoice_no],[t('dt.invoice_date'),day(r.issue_date||i.issue_date)],[t('dt.due_date'),day(r.due_date||i.due_date)],
    [t('dt.subtotal'),r.subtotal?ma(rc,r.subtotal):''],[t('dt.vat'),r.tax?ma(rc,r.tax):''],[t('dt.total'),ma(rc,r.total||i.total)],
    [t('dt.pay_to'),[acct,r.bic?'BIC '+r.bic:''].filter(Boolean).join(' · '),'mono'],[t('dt.bank_country'),r.bank_country],[t('dt.reference'),r.reference],[t('dt.booked_to'),i.gl_account?(i.gl_account+(i.cost_centre?' · '+i.cost_centre:'')):'']])]);
  const fs=i.findings||[];const fl=el('ul','findings');
  if(!fs.length)fl.append(el('li','ok',[ic('circle-check'),el('span','',t('cs.all_passed'))]));
  for(const f of fs){const m=RES[f.level]||['circle-minus',f.level];fl.append(el('li',f.level,[ic(m[0]),el('span','',[el('b','',m[1]+': '),finding(f)])]))}
  const checks=el('div','card panel',[el('h2','',t('dt.checks')),fl]);
  const getDoc=btn(t('cs.download'),'','download');
  getDoc.onclick=async()=>{getDoc.disabled=true;try{await download('/v1/invoices/'+encodeURIComponent(id)+'/document',(i.invoice_no||i.id).replace(/[^\w.-]+/g,'_')+'.pdf')}catch(e){if(!(e instanceof Expired))getDoc.after(note(e.message,'bad'))}finally{getDoc.disabled=false}};
  const pages=el('div','pages',[el('p','wait',t('drawing_document'))]);
  const doc=el('div','card docv',[el('div','bar2',[ic('file-text'),el('span','fn',t('cs.as_received')+(i.doc_sha256?' · SHA-256 '+String(i.doc_sha256).slice(0,12)+'…':'')),getDoc]),pages]);
  // The payment card where the person acts, or the proof once paid, first; the panel "At work" last; without an engine,
  // the note that the phone approves. On a phone this column comes before the document (.split.inv).
  const jr=el('div','card panel journal-for',[el('h2','',t('cs.books.journal_for')),el('p','sub',t('loading'))]);
  api('/v1/books/invoices/'+encodeURIComponent(id)+'/journal').then((j)=>jr.replaceChildren(el('h2','',t('cs.books.journal_for')),journalTable(j.items||[],t('cs.books.no_journal'))),(e)=>{if(!(e instanceof Expired))jr.replaceChildren(el('h2','',t('cs.books.journal_for')),note(e.message,'bad'))});
  stack=el('div','stack',[pay,proof,read,checks,jr,el('div','card panel',[el('h2','',t('dt.timeline')),tl]),pay||proof?workPanel():note(t('cs.approved_on_phone'))]);
  view().replaceChildren(back,top,el('div','split inv',[doc,stack]));
  if(pay||proof)WORK.onEvents=(evs)=>{if(evs.some((e)=>e.event==='vault.filed'||(e.event==='ap.status'&&e.fields&&e.fields.status==='paid')))again().catch(()=>{})};
  drawPdf('/v1/invoices/'+encodeURIComponent(id)+'/document',pages,t('cs.invoice_drawn'));
}

// --- The proof on a paid invoice (engine only): paid, booked, archived, each from what the read model and the archive say --
// Every page of a list route (limit 200, its cursor), so nothing is missed on a busy company.
async function everyPage(path){let out=[],cursor=null;for(let n=0;n<50;n++){const r=await api(path+(path.includes('?')?'&':'?')+'limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):''));out=out.concat(r.items||[]);cursor=r.next_cursor;if(!cursor)break}return out}
// A path segment as the archive names it (src/vault/layout.ts safeSegment), to find this invoice's receipt by its name.
const seg=(s)=>{let v=String(s||'').normalize('NFC').replace(/\p{Cf}/gu,'').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g,' ').replace(/\.{2,}/g,' ').replace(/\s+/g,' ').trim().replace(/^[.\s]+|[.\s]+$/g,'');if(v.length>120)v=v.slice(0,120).replace(/[.\s]+$/g,'');return v||'_'};
const fileName=(p)=>String(p).slice(String(p).lastIndexOf('/')+1);
// A file's folder as a person reads it: below the company's own root folder, the steps spaced so it wraps between them.
const folderWords=(p)=>String(p).split('/').slice(1,-1).join(' / ');
const kb=(n)=>t('cs.eng.kb',{n:(Math.max(0,Number(n)||0)/1024).toFixed(1)});
// This invoice's files: the original by its own hash (the invoice's doc_sha256), the receipt by the name the archive gives it
// (Betalingen/ or, for an English company, Payments/<date> <supplier> <invoice no>.pdf, or that name with a correction or id beside it).
// The archive cleans the receipt's whole name as one piece (src/vault/layout.ts paymentPath and safeSegment), so it is
// cleaned here the same way, from the file's own date; a correction or an id stands in brackets before .pdf.
function filesOf(i,files){
  const ours=files.filter((f)=>{if(f.kind==='invoice')return !!i.doc_sha256&&f.sha256===i.doc_sha256;if(f.kind!=='receipt')return false;
    const n=fileName(f.path),d=n.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;
    const want=seg(d+' '+i.vendor+' '+i.invoice_no+'.pdf');return n===want||n.replace(/ \([^()]*\)(\.pdf)$/i,'$1')===want});
  return ours.sort((a,b)=>(a.kind===b.kind?a.path.localeCompare(b.path):a.kind==='invoice'?-1:1))}
// A file's name to open it in the viewer, its folder small beneath.
function fileItem(f,open){const b=el('button','linkish',fileName(f.path));b.type='button';b.setAttribute('aria-pressed','false');b.onclick=()=>open(f,b);
  return el('li','',[b,el('span','fd',folderWords(f.path))])}
// One file of the archive in the sandboxed frame; the button that opened it is marked.
function vaultOpener(box,list){return (f,b)=>{for(const x of list.querySelectorAll('button[aria-pressed]'))x.setAttribute('aria-pressed','false');b.setAttribute('aria-pressed','true');
  box.replaceChildren(el('p','wait',t('drawing_document')));drawPdf('/v1/engine/vault/file?path='+encodeURIComponent(f.path),box,fileName(f.path))}}
function proofCard(i0){
  const box=el('section','card panel proof');box.id='proof';
  box.append(el('h2','',t('cs.eng.proof_h')),el('p','lede',t('loading')));
  const block=(name,icon,head,line,kids)=>el('div','pb '+name,[el('p','pr',[ic(icon),el('b','',head),line?el('span','',line):null]),...kids.filter(Boolean)]);
  const waiting=(name,head,words)=>{const b=block(name+' wait','clock',head,'',[el('p','wt',words)]);return b};
  const failed=(e)=>e&&e.message?note(e.message,'bad'):null;
  // Each source on its own: one that fails leaves the others standing.
  const get=(p)=>p.then((v)=>({v}),(e)=>{if(e instanceof Expired)throw e;return {e}});
  // This invoice's payment. The read model links a payment to its invoice by "<invoice no> · <supplier>" (src/cloudsync/client.ts
  // batchesFor), which two invoices can share; the transactions register names the invoice's own id (invoice.ap_id), so that
  // decides first. Without it only a single PAID payment of this invoice's amount counts; anything less certain waits.
  function paymentOf(i,ps,txs){
    const same=(ps.v||[]).filter((x)=>x.invoice_no===i.invoice_no+' · '+i.vendor);
    const tx=(x)=>txs.v?txs.v.find((y)=>y.id==='transfer:'+x.id):null;
    const byId=same.filter((x)=>{const y=tx(x);return y&&y.invoice&&y.invoice.ap_id===i.id}).sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at)));
    if(byId.length)return byId.pop();
    const sure=same.filter((x)=>x.status==='PAID'&&x.currency===i.currency&&toCents(x.amount)===toCents(i.total));
    return sure.length===1?sure[0]:null}
  function paid(i,ps,txs){
    if(ps.e)return block('paid wait','clock',t('cs.eng.paid_h'),'',[failed(ps.e)]);
    const p=paymentOf(i,ps,txs);
    if(!p)return waiting('paid',t('cs.eng.paid_h'),t('cs.eng.paid_wait'));
    const tx=txs.v?txs.v.find((x)=>x.id==='transfer:'+p.id):null;
    const fm=/^([A-Z]{3,4}) (\d+\.\d{2})$/.exec(String(p.fee_actual||''));const fee=fm?ma(fm[1],fm[2]):tx&&tx.fee?ma(tx.fee.currency,tx.fee.amount):'';
    const b=block('paid','circle-check',t('cs.eng.paid_h'),t('cs.eng.paid_line',{money:ma(p.currency,p.amount),date:day(p.updated_at)}),[]);
    b.firstChild.append(el('span','pill ok',String(p.status||'')),el('span','pill warn',t('cs.eng.test_bank')));
    b.append(el('details','',[el('summary','',t('cs.eng.paid_fold')),dl([[t('status'),String(p.status||'')],[t('amount'),ma(p.currency,p.amount)],[t('cs.eng.fee'),fee],[t('cs.eng.method'),p.method],
      [t('cs.eng.transfer_ref'),p.transfer_id||(tx&&tx.proof)||'','mono'],[t('cs.eng.payment_id'),p.id,'mono']])]));
    if(txs.e)b.append(failed(txs.e));
    return b}
  function booked(i,ps,txs,es){
    if(es.e)return block('booked wait','clock',t('cs.eng.booked_h'),'',[failed(es.e)]);
    const p=ps.v?paymentOf(i,ps,txs):null;
    const tx=p&&txs.v?txs.v.find((x)=>x.id==='transfer:'+p.id):null;
    // This invoice's entries: its accrual on receipt (source ap-accrual|<id>, any version), the payment's entries as the
    // transactions register books them, and any entry that reverses one of these.
    const ids=new Set(tx&&tx.booking?tx.booking.entry_ids:[]);
    const mine=es.v.filter((e)=>String(e.source_key||'').split('@')[0]==='ap-accrual|'+i.id||ids.has(e.entry_id));
    const have=new Set(mine.map((e)=>e.entry_id));
    for(const e of es.v)if(e.reverses!==null&&e.reverses!==undefined&&have.has(e.reverses)&&!have.has(e.entry_id)){mine.push(e);have.add(e.entry_id)}
    mine.sort((a,b)=>a.entry_id-b.entry_id);
    if(!mine.length)return waiting('booked',t('cs.eng.booked_h'),t('cs.eng.booked_wait'));
    const dr={},cr={};for(const e of mine)for(const l of e.lines||[]){dr[l.currency]=(dr[l.currency]||0)+(Number(l.debit_cents)||0);cr[l.currency]=(cr[l.currency]||0)+(Number(l.credit_cents)||0)}
    const even=Object.keys({...dr,...cr}).every((c)=>(dr[c]||0)===(cr[c]||0));
    const tb=el('tbody','');
    for(const e of mine){const h=el('td','','#'+e.entry_id+' · '+day(e.posting_date)+' · '+data('journal',e.description||''));h.colSpan=3;tb.append(el('tr','en',[h]));
      for(const l of e.lines||[])tb.append(el('tr','ln',[el('td','',l.account+(l.vat_code?' · '+t('cs.vat_code',{code:l.vat_code}):'')),el('td','r',l.debit_cents?cur(l.currency)+' '+cents(l.debit_cents):''),el('td','r',l.credit_cents?cur(l.currency)+' '+cents(l.credit_cents):'')]))}
    const tbl=el('table','table',[el('thead','',[el('tr','',[el('th','',t('cs.eng.account')),el('th','r',t('cs.debit')),el('th','r',t('cs.credit'))])]),tb]);
    // The head of the ledger chain: the newest entry's own hash, as the read model holds it (a session may not ask /v1/sync/state).
    const head=es.v[es.v.length-1];
    return block('booked',even?'circle-check':'triangle-alert',t('cs.eng.booked_h'),even?t('cs.eng.booked_line',{n:mine.length}):t('cs.eng.booked_uneven',{n:mine.length}),
      [el('details','',[el('summary','',t('cs.eng.booked_fold')),el('div','scroll',tbl),head?dl([[t('cs.eng.chain_head',{n:head.entry_id}),head.entry_hash,'mono']]):null])])}
  function archived(i,vs){
    if(vs.e)return block('archived wait','clock',t('cs.eng.archived_h'),'',[failed(vs.e)]);
    const fs=filesOf(i,vs.v.files||[]);
    const arch=el('a','arch',t('cs.eng.open_archive'));arch.href='#/archive';
    if(!fs.length)return block('archived wait','clock',t('cs.eng.archived_h'),'',[el('p','wt',t('cs.eng.archived_wait')),arch]);
    const list=el('ul','files');const viewer=el('div','pages');const open=vaultOpener(viewer,list);
    for(const f of fs)list.append(fileItem(f,open));
    const b=block('archived','circle-check',t('cs.eng.archived_h'),t('cs.eng.archived_line',{n:fs.length}),
      [list,viewer,el('details','',[el('summary','',t('cs.eng.archived_fold')),dl(fs.map((f)=>[fileName(f.path),f.sha256,'mono']))])]);
    b.firstChild.append(arch);return b}
  // One read at a time; one more if asked meanwhile.
  let busy=null,more=false,inv=i0,seen='';
  async function load(){
    const [ps,txs,es,vs]=await Promise.all([get(everyPage('/v1/payments')),get(everyPage('/v1/transactions?rail=airwallex_transfer')),get(everyPage('/v1/ledger/entries')),get(api('/v1/engine/vault'))]);
    if(seen&&!box.isConnected)return;
    // Drawn again only when an answer changed, so an open fold or file stays open while the engine carries on.
    const sig=JSON.stringify([inv.status,inv.invoice_no,inv.vendor,inv.doc_sha256,ps,txs,es,vs]);if(sig===seen)return;seen=sig;
    box.replaceChildren(el('h2','',t('cs.eng.proof_h')),paid(inv,ps,txs),booked(inv,ps,txs,es),archived(inv,vs))}
  box.refresh=(j)=>{if(j)inv=j;if(busy){more=true;return busy}
    busy=(async()=>{try{do{more=false;await load()}while(more)}catch(e){if(!(e instanceof Expired))box.append(note(e.message,'bad'))}finally{busy=null}})();return busy};
  box.refresh();
  return box}

// --- The payment card (engine only): pay, set up the approval passkey on this device, approve the exact terms ------------
// What a passkey made or signed, as @simplewebauthn/server reads it (src/approve/client.ts serializeRegistration and
// serializeAssertion, in this page's form).
const credOf=(c,response)=>({id:c.id,rawId:b64u(c.rawId),type:c.type,response,clientExtensionResults:c.getClientExtensionResults(),...(c.authenticatorAttachment?{authenticatorAttachment:c.authenticatorAttachment}:{})});
const registrationOf=(c)=>{const r=c.response;return credOf(c,{clientDataJSON:b64u(r.clientDataJSON),attestationObject:b64u(r.attestationObject),transports:typeof r.getTransports==='function'?r.getTransports():[]})};
const signedOf=(c)=>{const r=c.response;return credOf(c,{clientDataJSON:b64u(r.clientDataJSON),authenticatorData:b64u(r.authenticatorData),signature:b64u(r.signature),...(r.userHandle?{userHandle:b64u(r.userHandle)}:{})})};
// The approval passkey of the signed-in person, made on this device for the engine's enrolment window; the engine checks it.
async function approvalPasskey(){
  const s=await engineCall('/v1/engine/passkey/start',{method:'POST'});
  const made=await navigator.credentials.create({publicKey:{rp:{id:s.rp.id,name:s.rp.name},user:{id:new TextEncoder().encode(s.user.id),name:s.user.name,displayName:s.user.displayName},challenge:fromB64u(s.challenge),
    pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],excludeCredentials:(s.exclude||[]).map((id)=>({type:'public-key',id:fromB64u(id)})),
    authenticatorSelection:{userVerification:'required',residentKey:'discouraged'},attestation:'none',timeout:120000}});
  await engineCall('/v1/engine/passkey/finish',{method:'POST',body:{code:s.code,credential:registrationOf(made)}});
  engineStale()}
// The engine's own view of the invoice (o.inv, from GET /v1/engine/invoices) decides what the card offers; o.write: an owner;
// o.moved(): the read model is read again. Nothing shows as done before its answer is in: the one button is off and says
// it is working while a request or a passkey prompt is open; a cancelled prompt leaves the card as it was.
function payCard(o){
  const i=o.inv;let eng=o.eng;
  // A paid or rejected invoice has nothing to act on here.
  if(['paid','rejected'].includes(i.status))return null;
  const box=el('section','card panel pay');box.id='pay';
  const said=el('div','');said.setAttribute('role','status');
  const draw=(kids)=>box.replaceChildren(el('h2','',t('cs.eng.pay_h')),...kids.filter(Boolean));
  const act=(b,run)=>{const kids=[...b.childNodes];b.onclick=async()=>{if(b.disabled)return;b.disabled=true;b.textContent=t('cs.eng.working');said.replaceChildren();
    try{await run()}catch(e){if(!(e instanceof Expired))said.replaceChildren(note(e&&(e.name==='NotAllowedError'||e.name==='AbortError')?t('cs.eng.cancelled'):e.message,'bad'))}
    finally{if(b.isConnected){b.disabled=false;b.replaceChildren(...kids)}}}};
  // The terms as the engine gives them (the phone page's facts): the first four in view and the rest in a fold, as the
  // phone page shows first and details; the stand-in bank beside them; the fingerprint (hash and request id) last.
  const factsDl=(fs)=>{const d=dl(fs);d.classList.add('facts');return d};
  const terms=(p)=>{const fs=p.facts||[];return [...(p.warnings||[]).map((w)=>note(w,'warn')),note(t('cs.eng.stand_in')),factsDl(fs.slice(0,4)),
    fs.length>4?el('details','',[el('summary','',t('cs.eng.more_terms',{n:fs.length-4})),factsDl(fs.slice(4))]):null]};
  const print=(p)=>el('details','',[el('summary','',t('cs.eng.terms_fold')),dl([[t('cs.eng.terms_hash'),p.terms_sha256,'mono'],[t('cs.eng.proposal_id'),p.id,'mono']])]);
  function proposal(p){
    if(!o.write||p.status!=='PENDING_APPROVAL'){draw([...terms(p),print(p)]);return}
    if(!hasPasskeys()){draw([...terms(p),note(t('cs.no_passkeys'),'bad'),print(p)]);return}
    const b=eng&&eng.passkey?btn(t('cs.eng.approve'),'primary','scan-face'):btn(t('cs.eng.setup'),'primary','key-round');
    if(eng&&eng.passkey)act(b,()=>approve(p));
    else act(b,async()=>{await approvalPasskey();eng=await engineStatus();proposal(p);said.replaceChildren(note(t('cs.eng.set_up'),'ok'))});
    draw([...terms(p),el('p','fine',t('cs.eng.signs')),el('div','acts',[b]),eng&&eng.passkey?el('p','fine',t('cs.eng.holder',{name:eng.passkey.label})):null,said,print(p)])}
  async function approve(p){
    let c;
    try{c=await navigator.credentials.get({publicKey:{challenge:fromB64u(p.challenge),rpId:CFG.rpId,allowCredentials:[{type:'public-key',id:fromB64u(eng.passkey.credential_id)}],userVerification:'required',timeout:120000}})}
    catch(e){if(e&&e.name==='NotAllowedError')throw new Error(t('cs.eng.cancelled')+' '+t('cs.eng.other_device',{name:eng.passkey.label}));throw e}
    const r=await engineCall('/v1/engine/proposals/'+encodeURIComponent(p.id)+'/approve',{method:'POST',body:{terms_sha256:p.terms_sha256,credential:signedOf(c)}});
    // The engine's own words, for a refusal as for an approval.
    if(r.status!=='approved'){said.replaceChildren(note(r.message,'bad'));return}
    const s=r.settled||{};
    draw([note(r.message,'ok'),s.error?note(s.error+' '+t('cs.eng.approval_stays'),'warn'):null,el('details','',[el('summary','',t('cs.eng.approved_terms')),...terms(p),print(p)]),said]);
    await o.moved()}
  if(i.status==='waiting_cfo'&&i.proposal)proposal(i.proposal);
  else if(i.payable){
    const b=o.write?btn(t('cs.eng.pay'),'primary'):null;
    // Filed: the proposal shows; the engine then feeds the read model, so the head says what the engine says.
    if(b)act(b,async()=>{const r=await engineCall('/v1/engine/invoices/'+encodeURIComponent(i.id)+'/pay',{method:'POST'});proposal(r.proposal);await engineCall('/v1/engine/sync',{method:'POST'});await o.moved()});
    draw([el('p','lead',t('cs.eng.ready')),b?el('div','acts',[b]):null,said])}
  // Not ready: the checks further down say why (the pay route's 409 is never asked just to learn it); where the reason is
  // not a check, the rule the engine's payable comes from (src/ap/detail.ts actionsFor) says it.
  else{const why=i.status==='needs_vendor'?t('action.needs_vendor'):i.status==='ready'?t('action.currency_not_paid',{currency:i.currency||''}):'';
    draw([el('p','lead',why?t('cs.eng.not_yet_why',{why}):t('cs.eng.not_yet'))])}
  return box}
// The supplier's PDF is drawn in a sandboxed frame with an opaque origin (red team round 5): pdf.js parses it there, in
// a worker, under its own policy and time limit; the frame cannot reach this page, its session or the API. This page
// fetches the bytes (it holds the session) and hands them over; if the frame cannot draw them, the download stays.
// src: this origin's API path that answers the PDF (an invoice's document, a file of the archive); name: the frame's title.
const PDF_MAX_BYTES=16*1024*1024;
async function drawPdf(src,box,name){
  // The box's latest request only: a slow answer for a file opened earlier never replaces the one opened since.
  const mine={};box._pdf=mine;
  try{
    const r=await api(src,{raw:true});
    const buf=await r.arrayBuffer();
    if(box._pdf!==mine)return;
    if(buf.byteLength>PDF_MAX_BYTES){box.replaceChildren(el('p','wait',t('cs.too_large')));return}
    const f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.src='/pdfview';f.className='pdfframe';f.title=name||t('cs.invoice_drawn');f.setAttribute('referrerpolicy','no-referrer');
    let sent=false;
    const onMsg=(ev)=>{if(!f.isConnected){window.removeEventListener('message',onMsg);return}if(ev.source!==f.contentWindow||ev.origin!=='null')return;const d=ev.data||{};
      if(d.type==='ready'&&!sent){sent=true;f.contentWindow.postMessage({type:'pdf',data:buf},'*',[buf])}
      else if(d.type==='size'&&typeof d.h==='number')f.style.height=Math.max(120,Math.min(20000,Math.round(d.h)))+'px';
      else if(d.type==='failed'){window.removeEventListener('message',onMsg);box.replaceChildren(el('p','wait',t('cs.not_drawn')))}};
    window.addEventListener('message',onMsg);
    box.replaceChildren(f);
  }catch(e){if(e instanceof Expired||box._pdf!==mine)return;box.replaceChildren(el('p','wait',t('cs.not_drawn')))}
}

// --- Transactions --------------------------------------------------------------------------------------------------
const RAILS=[['',t('cs.every_rail')],...['airwallex_transfer','airwallex_fx','airwallex_card','airwallex_airi','airwallex_receipt','metal','metal_clearing'].map(k=>[k,t('tx.rail.'+k)])];
const RECS=[['',t('tx.every_state')],['matched',t('rec.matched')],['missing_booking',t('rec.missing_booking')],['missing_rail_record',t('cs.no_rail_record')],['amount_mismatch',t('cs.amounts_differ')]];
async function transactionsView(){
  title(t('nav.transactions'));
  const q=new URLSearchParams();
  const sel=(opts,key)=>{const s=el('select','field');for(const [v,l] of opts){const o=el('option','',l);o.value=v;s.append(o)}s.onchange=()=>{if(s.value)q.set(key,s.value);else q.delete(key);load()};return s};
  const curIn=el('input','field');curIn.placeholder='EUR';curIn.maxLength=4;curIn.onchange=()=>{const v=curIn.value.trim().toUpperCase();if(/^[A-Z]{3,4}$/.test(v))q.set('currency',v);else q.delete('currency');load()};
  const from=el('input','field');from.type='date';from.onchange=()=>{if(from.value)q.set('from',from.value);else q.delete('from');load()};
  const to=el('input','field');to.type='date';to.onchange=()=>{if(to.value)q.set('to',to.value);else q.delete('to');load()};
  const csv=btn('CSV','','download');csv.onclick=()=>download('/v1/transactions/export.csv?'+q.toString(),'transactions.csv').catch(e=>{if(!(e instanceof Expired))list.before(note(e.message,'bad'))});
  const tiles=el('div','tiles');const list=el('div','card list');
  const filters=el('div','form-row',[el('div','',[el('label','',t('rail')),sel(RAILS,'rail')]),el('div','',[el('label','',t('tx.state')),sel(RECS,'reconciliation')]),el('div','',[el('label','',t('tx.currency')),curIn]),el('div','',[el('label','',t('cs.from')),from]),el('div','',[el('label','',t('cs.to')),to])]);
  view().replaceChildren(head(t('nav.transactions'),t('cs.tx_lede'),[csv]),tiles,filters,el('section','section',[list]));
  async function load(){
    const [s,p]=await Promise.all([api('/v1/transactions/summary?'+q.toString()),api('/v1/transactions?limit=200&'+q.toString())]);
    const tot=s.totals||[];const inn={},out={},fee={};for(const t of tot){inn[t.currency]=Math.round(Number(t.in||0)*100);out[t.currency]=Math.round(Number(t.out||0)*100);if(t.fees)fee[t.currency]=Math.round(Number(t.fees)*100)}
    tiles.replaceChildren(tile(t('cs.tile.in'),'arrow-down-left',money(inn),others(inn)||null),tile(t('cs.tile.out'),'arrow-up-right',money(out),others(out)||null),tile(t('cs.tile.fees'),'wallet',money(fee),t('cs.x.rails')),
      tile(t('tx.tile.unreconciled'),'shield-check',String(s.check.unreconciled),s.check.unreconciled?t('cs.x.look'):t('cs.x.all_match'),s.check.unreconciled?'alert':'calm'),
      tile(t('tx.tile.no_approval'),'octagon-x',String(s.check.without_approval.length),s.check.without_approval.length?t('cs.x.look'):t('cs.x.all_approved'),s.check.without_approval.length?'alert':'calm'));
    list.replaceChildren(el('div','trow th',[el('span','',t('date')),el('span','',t('what')),el('span','',t('rail')),el('span','amt',t('amount')),el('span','',t('status')),el('span','',t('books')),el('span','')]));
    if(!p.items.length)list.append(el('div','empty',[el('b','',t('cs.no_movements')),t('cs.nothing_matches')]));
    for(const r of p.items){const b=el('div','trow');
      const amt=el('span','amt'+(r.flow==='in'?' in':''),[el('span','c',cur(r.currency)),'\u00a0'+(r.flow==='in'?'+':'−')+amount(r.amount)]);if(!r.moved)amt.classList.add('not');
      b.append(el('span','when',day(r.at)),el('span','what',[av(r.counterparty||'?'),el('span','wt',[el('b','',data('counterparty',r.counterparty||'')),el('span','sub',data('description',r.description||''))])]),el('span','rail',[tk('rail.'+r.rail,r.rail_label||r.rail),el('span','sub',r.proof?el('code','idc',String(r.proof).slice(0,18)):t('tx.no_proof_short'))]),amt,
        el('span','',[el('span','pill '+(r.moved?'ok':'bad'),data('status',r.status_words||r.status))]),el('span','',[el('span','pill '+(r.reconciliation==='matched'?'ok':r.reconciliation==='not_applicable'?'':'warn'),tk('rec.'+r.reconciliation,r.reconciliation_words||r.reconciliation))]),el('span',''));
      list.append(b)}
    if(p.next_cursor)list.append(note(t('cs.newest_200')));
  }
  await load();
}

// --- The archive (engine only): the vault's folder tree as its indexes list it, each file in the same sandboxed frame -----
async function archiveView(){
  title(t('cs.eng.archive'));
  // Review, 13 Nov: without an engine (a guest, a cloud with none) /v1/engine/vault answers 404, which showed "Could not
  // load this page" and an error in the browser's console. The page asks the engine first, as its links do, and says why.
  if(!(await engineStatus())){const back=el('a','btn',t('cs.eng.archive_back'));back.href='#/overview';view().replaceChildren(head(t('cs.eng.archive')),el('div','card panel',[note(t('cs.eng.archive_off')),back]));return}
  const v=await api('/v1/engine/vault');const files=v.files||[];
  // The tree from the paths: the product's own (Dutch) folder names, as they are.
  const root={dirs:new Map(),files:[]};
  for(const f of files){let n=root;const parts=String(f.path).split('/');for(const p of parts.slice(0,-1)){if(!n.dirs.has(p))n.dirs.set(p,{dirs:new Map(),files:[]});n=n.dirs.get(p)}n.files.push(f)}
  const count=(n)=>n.files.length+[...n.dirs.values()].reduce((s,d)=>s+count(d),0);
  const pages=el('div','pages',[el('p','wait',t('cs.eng.archive_pick'))]);const fn=el('span','fn',t('cs.eng.archive'));
  const viewer=el('div','card docv',[el('div','bar2',[ic('file-text'),fn]),pages]);
  const tree=el('div','card panel archive');
  const draw=vaultOpener(pages,tree);
  const open=(f,b)=>{fn.textContent=fileName(f.path);draw(f,b);viewer.scrollIntoView({block:'nearest'})};
  const items=(fs)=>{const u=el('ul','files');for(const f of fs.slice().sort((a,b)=>a.path.localeCompare(b.path))){const li=fileItem(f,open);li.querySelector('.fd').textContent=kb(f.bytes)+' · '+day(f.added_at);u.append(li)}return u};
  // Folders as native folds: the company and its years open, everything below the year folded.
  const folder=(name,n,depth)=>{const d=el('details','',[el('summary','',name+' ('+count(n)+')'),...[...n.dirs.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,c])=>folder(k,c,depth+1)),n.files.length?items(n.files):null]);d.open=depth<2;return d};
  if(!files.length)tree.append(el('p','lede',t('cs.eng.archive_empty')));
  for(const [k,c] of [...root.dirs.entries()].sort((a,b)=>a[0].localeCompare(b[0])))tree.append(folder(k,c,0));
  if(root.files.length)tree.append(items(root.files));
  view().replaceChildren(head(t('cs.eng.archive'),t('cs.eng.archive_lede')),el('div','split',[tree,viewer]));
}

// --- Books ---------------------------------------------------------------------------------------------------------
const RUBRIC=(k)=>tk('cs.rubric.'+k,k);
async function booksView(q){
  title(t('cs.nav.books'));
  try{BOOKED=(await api('/v1/books/bookings')).bookings||{}}catch(e){if(e instanceof Expired)throw e;BOOKED={}}
  const now=new Date();const qs=[];for(let k=0;k<6;k++){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-3*k,1));qs.push(d.getUTCFullYear()+'Q'+(Math.floor(d.getUTCMonth()/3)+1))}
  const pick=el('select','field');for(const v of qs){const o=el('option','',v);o.value=v;pick.append(o)}
  const vat=el('div','card panel');const journal=el('div','card panel');
  // With an engine, its archive is one link away from the books.
  const arch=(await engineStatus())?(()=>{const a=el('a','btn',[ic('file-text'),t('cs.eng.open_archive')]);a.href='#/archive';return a})():null;
  const inv=el('div','books-invoices');
  const bal=el('div','card panel balance',[el('h2','',t('cs.books.balance')),el('p','sub',t('loading'))]);
  view().replaceChildren(head(t('cs.nav.books'),ME&&ME.demo?t('cs.books.demo_lede'):t('cs.books.lede'),arch?[arch]:null),inv,el('h2','section-h',t('cs.books.ledger')),el('div','split2',[el('div','stack',[bal,vat]),journal]),exportsCard());
  // The balance sheet from the ledger (GET /v1/reports/balance), per currency: what the company owns, owes and is worth.
  api('/v1/reports/balance').then((b)=>{const rows=[];for(const [c,v] of Object.entries(b.by_currency||{})){rows.push(el('tr','',[el('td','',el('b','',c)),el('td','r',cur(c)+' '+cents(v.assets_cents||0)),el('td','r',cur(c)+' '+cents(v.liabilities_cents||0)),el('td','r',cur(c)+' '+cents(v.equity_cents||0)),el('td','',v.balanced?el('span','ast active',t('cs.books.balanced')):el('span','ast revoked',t('cs.books.not_balanced')))]))}
    bal.replaceChildren(el('h2','',t('cs.books.balance')),el('p','sub',t('cs.books.balance_at',{day:day(b.to)})),el('div','scroll',el('table','table',[el('thead','',el('tr','',[el('th','',''),el('th','r',t('cs.books.assets')),el('th','r',t('cs.books.liabilities')),el('th','r',t('cs.books.equity')),el('th','','')])),el('tbody','',rows.length?rows:[el('tr','',el('td','',t('cs.no_entries')))])])))},
    (e)=>{if(!(e instanceof Expired))bal.replaceChildren(el('h2','',t('cs.books.balance')),note(e.message,'bad'))});
  await invoicesView(q,inv);
  async function drawVat(){
    const v=await api('/v1/reports/vat?quarter='+encodeURIComponent(pick.value));
    const tbl=el('table','table vat',[el('thead','',[el('tr','',[el('th','',t('cs.rubric')),el('th','sh',t('cs.vat.share')),el('th','r',t('cs.base')),el('th','r',t('dt.vat'))])])]);const tb=el('tbody','');
    const maxBase=Math.max(0,...Object.values(v.rubrics||{}).map(r=>Math.abs(r.base_cents||0)));
    const eur=(c)=>cur('EUR')+' '+cents(c);
    for(const [k,r] of Object.entries(v.rubrics||{})){if(!r.base_cents&&!r.vat_cents)continue;tb.append(el('tr','',[el('td','',RUBRIC(k)),el('td','sh',meter(Math.abs(r.base_cents||0),maxBase)),el('td','r',eur(r.base_cents)),el('td','r',eur(r.vat_cents))]))}
    // VAT a supplier abroad charged (13 Nov: German 19%): its own row, outside the Dutch return's boxes and not in 5b.
    const fv=v.foreign_vat;if(fv&&fv.lines)tb.append(el('tr','',[el('td','',t('cs.vat_foreign',{n:fv.lines})),el('td',''),el('td','r',eur(fv.base_cents)),el('td','r',eur(fv.vat_cents))]));
    // No rubric row: the quarter may still hold input VAT (5b), so "nothing" is said only when 5a and 5b are nil too.
    if(!tb.children.length)tb.append(el('tr','',[el('td','',t(v.owed_5a_cents||v.input_5b_cents?'cs.no_rubrics':'cs.nothing_quarter')),el('td',''),el('td',''),el('td','')]));
    tb.append(el('tr','tot',[el('td','',el('b','',t('cs.owed_5a'))),el('td',''),el('td',''),el('td','r',eur(v.owed_5a_cents))]),el('tr','tot',[el('td','',el('b','',t('cs.input_5b'))),el('td',''),el('td',''),el('td','r',eur(v.input_5b_cents))]),el('tr','tot',[el('td','',el('b','',t('cs.balance_5c'))),el('td',''),el('td',''),el('td','r',el('b','',eur(v.balance_5c_cents)))]));
    tbl.append(tb);
    vat.replaceChildren(el('h2','',t('cs.vat_overview')),el('div','form-row',[el('div','',[el('label','',t('cs.quarter')),pick])]),el('div','scroll',tbl),
      v.uncoded_lines?note(t('cs.uncoded',{n:v.uncoded_lines}),'warn'):null,note(NL?t('cs.vat_notice'):(v.notice||t('cs.vat_notice'))));
  }
  pick.onchange=()=>drawVat().catch(e=>{if(!(e instanceof Expired))vat.append(note(e.message,'bad'))});
  const j=await api('/v1/ledger/entries?limit=30');
  const tbl=el('table','table',[el('thead','',[el('tr','',[el('th','',t('date')),el('th','',t('cs.entry')),el('th','r',t('cs.debit')),el('th','r',t('cs.credit'))])])]);const tb=el('tbody','');
  for(const e of j.items.slice().reverse()){tb.append(el('tr','en',[el('td','',day(e.posting_date)),el('td','',[el('b','','#'+e.entry_id+' '),data('journal',e.description||'')]),el('td',''),el('td','')]));
    for(const l of e.lines||[])tb.append(el('tr','ln',[el('td',''),el('td','',l.account+(l.vat_code?' · '+t('cs.vat_code',{code:l.vat_code}):'')),el('td','r',l.debit_cents?cur(l.currency)+' '+cents(l.debit_cents):''),el('td','r',l.credit_cents?cur(l.currency)+' '+cents(l.credit_cents):'')]))}
  if(!j.items.length)tb.append(el('tr','',[el('td','',t('cs.no_entries')),el('td',''),el('td',''),el('td','')]));
  tbl.append(tb);journal.replaceChildren(el('h2','',t('cs.journal')),el('div','scroll',tbl),note(t('cs.journal_note')));
  await drawVat();
}

// --- Shared pieces of the enterprise pass (13 Nov) -------------------------------------------------------------------
// What Purser Cloud is, in one line, on the sign-in and at the top of the overview; the demo company says what its data is.
function whatCloud(m){return el('div','what-cloud',[el('p','',t('cs.what_cloud')),m&&m.demo?el('p','demo-label',[ic('flask'),' '+t('cs.demo.label')]):null])}
// A ledger entry's lines as a table (date, entry, account, debit, credit), oldest first.
function journalTable(items,empty){
  const tbl=el('table','table',[el('thead','',[el('tr','',[el('th','',t('date')),el('th','',t('cs.entry')),el('th','r',t('cs.debit')),el('th','r',t('cs.credit'))])])]);const tb=el('tbody','');
  const es=items.slice().sort((a,b)=>String(a.posting_date).localeCompare(String(b.posting_date))||a.entry_id-b.entry_id);
  for(const e of es){tb.append(el('tr','en',[el('td','',day(e.posting_date)),el('td','',[el('b','','#'+e.entry_id+' '),data('journal',e.description||'')]),el('td',''),el('td','')]));
    for(const l of e.lines||[])tb.append(el('tr','ln',[el('td',''),el('td','',l.account+(l.vat_code?' · '+t('cs.vat_code',{code:l.vat_code}):'')),el('td','r',l.debit_cents?cur(l.currency)+' '+cents(l.debit_cents):''),el('td','r',l.credit_cents?cur(l.currency)+' '+cents(l.credit_cents):'')]))}
  if(!es.length)tb.append(el('tr','',[el('td','',empty),el('td',''),el('td',''),el('td','')]));
  tbl.append(tb);return el('div','scroll',tbl)}
// The accounting exports (GET /v1/export/csv/{format}/{kind}): files, labelled format exports.
function exportsCard(){
  const box=el('div','card panel exports');const out=el('div','');out.setAttribute('role','status');
  const files=[['xero','bills','Xero · bills'],['xero','journals','Xero · journals'],['quickbooks','bills','QuickBooks Online · bills'],['exact','bills','Exact Online · inkoop'],['exact','journals','Exact Online · memoriaal']];
  const row=el('div','row2 wrap-row');
  for(const [f,k,label] of files){const b=btn(label,'','download');b.onclick=async()=>{b.disabled=true;try{await download('/v1/export/csv/'+f+'/'+k,'purser-'+k+'-'+f+'.csv')}catch(e){if(!(e instanceof Expired))out.replaceChildren(note(e.message,'bad'))}finally{b.disabled=false}};row.append(b)}
  box.append(el('h2','',t('cs.books.exports')),el('p','sub',t('cs.books.exports_sub')),row,out);return box}
const ext=(href,label)=>{const a=el('a','ext',[label,' ',ic('external-link')]);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a};
const shortHash=(h)=>String(h||'').slice(0,10)+'…'+String(h||'').slice(-6);

// --- Agents (13 Nov) -------------------------------------------------------------------------------------------------
async function agentsView(){
  title(t('cs.nav.agents'));
  const [m,r]=await Promise.all([me(),api('/v1/agents')]);shell();
  const cards=(r.agents||[]).map((a)=>{
    const st=el('span','ast '+String(a.status).replace(/[^a-z]/g,''),[ic(a.status==='active'?'circle-check':a.status==='paused'?'snowflake':'ban'),' '+tk('cs.agents.status.'+a.status,a.status)]);
    const since=a.status_since?el('span','sub',' '+t('cs.agents.since',{day:day(a.status_since)})):null;
    const hd=el('div','ah',[el('span','av',ic('bot')),el('div','',[el('h2','',a.name),el('p','sub',a.role+' · '+a.job)]),el('div','ast-wrap',[st,since])]);
    const lim=a.card?el('ul','pl',[el('li','',[ic('credit-card'),' '+t('cs.agents.card',{last4:a.card.last4})]),a.card.per_purchase?el('li','',t('cs.agents.per_purchase',{amount:cur(a.card.currency)+' '+a.card.per_purchase})):null,a.card.per_month?el('li','',t('cs.agents.per_month',{amount:cur(a.card.currency)+' '+a.card.per_month})):null,a.card.pays_for?el('li','',t('cs.agents.pays_for',{what:a.card.pays_for})):null]):el('p','sub',t('cs.agents.no_card'));
    const facts=el('div','agrid',[
      el('div','',[el('h3','',t('cs.agents.model')),a.models.length?el('p','mono',a.models.join(', ')):el('p','sub',t('cs.agents.no_model')),a.runs&&a.runs.total?el('p','sub',t('cs.agents.runs',{n:a.runs.total,k:a.runs.without_model})):null]),
      el('div','',[el('h3','',t('cs.agents.limits')),lim]),
      el('div','',[el('h3','',t('cs.agents.rails')),a.rails.length?el('p','',a.rails.join(', ')):el('p','sub',t('cs.agents.no_rail')),a.spent||a.declined?el('p','sub',t('cs.agents.moved',{n:a.spent,k:a.declined})):null]),
      el('div','',[el('h3','',t('cs.agents.may')),el('ul','can',a.may.map((x)=>el('li','',[ic('circle-check'),el('span','',x)])))]),
      el('div','',[el('h3','',t('cs.agents.may_not')),el('ul','cannot',a.may_not.map((x)=>el('li','',[ic('ban'),el('span','',x)])))])]);
    const dec=el('div','adec',[el('h3','',t('cs.agents.decisions')),a.decisions.length?el('ul','feed',a.decisions.map((d)=>el('li','',[el('span','when num',day(d.at)),el('span','',[d.text,d.decided_by&&!/fallback/.test(d.text)?el('small','by',' · '+t('cs.agents.decided_by',{who:d.decided_by})):null])]))):el('p','sub',t('cs.agents.no_decisions'))]);
    return el('section','card agent',[hd,facts,dec])});
  view().replaceChildren(...[whatCloud(m),head(t('cs.nav.agents'),t('cs.agents.lede')+(m.demo?' '+t('cs.agents.read_only'):'')),
    cards.length?el('div','agents',cards):el('div','card empty',[el('b','',t('cs.agents.none'))]),note(t('cs.agents.controls'))]);
}

// --- Tokenisation (13 Nov) -------------------------------------------------------------------------------------------
async function tokensView(){
  title(t('cs.nav.tokens'));
  const [m,r]=await Promise.all([me(),api('/v1/tokenisation')]);shell();
  const lbl=(s)=>el('span','rlabel',s);
  const tok=r.invoice_token;const it=tok.invoice;
  const steps=el('ol','tsteps',tok.steps.map((s)=>el('li','',[el('b','',tk('cs.tok.step.'+s.step,s.step)),el('span','sub',' '+s.label),el('ul','txs',s.txs.map((x)=>el('li','',[el('span',x.status==='success'?'ok':'bad',[ic(x.status==='success'?'circle-check':'triangle-alert')]),el('span','',x.what+' · '+day(x.at)+' · '),x.explorer?ext(x.explorer,el('code','',shortHash(x.hash))):el('code','',shortHash(x.hash))])))])));
  const invoice=el('section','card panel tok',[el('div','th',[el('h2','',[ic('receipt'),' '+t('cs.tok.invoice')]),lbl(tok.label)]),
    el('p','',t('cs.tok.invoice_sub',{no:it.invoice_no,amount:cur(it.currency)+' '+it.amount,pid:it.proposal_id})),
    dl([[t('cs.tok.contract'),el('code','',tok.contract),'mono'],[t('cs.tok.token_id'),el('code','',shortHash(tok.token_id)),'mono'],[t('cs.tok.face_value'),tok.face_value],[t('cs.tok.discount'),tok.discount]]),
    steps,tok.verified?note(t('cs.tok.verified'),'ok'):null,el('p','links',[ext(tok.record,t('cs.tok.record')),' ',ext(tok.story,t('cs.tok.story'))])]);
  const c=r.agent_cards;
  const cards=el('section','card panel tok',[el('div','th',[el('h2','',[ic('credit-card'),' '+t('cs.tok.cards')]),lbl(c.label)]),el('p','sub',t('cs.tok.cards_sub',{day:day(c.read_at)})),
    el('div','scroll',el('table','table',[el('thead','',el('tr','',[el('th','',t('cs.tok.card')),el('th','',t('cs.tok.holder')),el('th','',t('cs.tok.limits')),el('th','',t('cs.tok.status'))])),el('tbody','',c.cards.map((x)=>el('tr','',[el('td','',[el('b','',x.brand+' ••'+x.last4),el('span','sub',' '+x.form.toLowerCase())]),el('td','',x.holder),el('td','',x.limits.join(' · ')),el('td','',[el('span','ast '+(x.status==='ACTIVE'?'active':'paused'),x.status.charAt(0)+x.status.slice(1).toLowerCase()),x.merchant_categories.length?el('span','sub',' '+t('cs.tok.categories',{list:x.merchant_categories.join(', ')})):null])])))])),
    el('p','links',[ext(c.record,t('cs.tok.record'))])]);
  const v=r.visa_credential;
  const vic=el('section','card panel tok',[el('div','th',[el('h2','',[ic('shield-check'),' '+t('cs.tok.vic')]),lbl(v.label)]),el('p','sub',t('cs.tok.vic_sub',{run:v.run})),
    el('ul','viclist',v.purchases.map((p)=>el('li','',[el('b','',p.step),el('span','',' '+p.what+' · '+p.amount),p.outcome?el('span',p.outcome==='succeeded'?'ok':'sub',' · '+p.outcome+(p.reason?': '+p.reason:'')):null]))),
    v.credential_deleted?note(t('cs.tok.deleted')):null,el('p','links',[ext(v.record,t('cs.tok.record')),' ',ext(v.story,t('cs.tok.story'))])]);
  view().replaceChildren(whatCloud(m),head(t('cs.nav.tokens'),t('cs.tok.lede')),invoice,cards,vic);
}

// --- Settings ------------------------------------------------------------------------------------------------------
// Connect Claude (docs/connect-claude.md): the company's own Claude account reads its books through /mcp and, with a
// token that allows it, proposes an invoice's payment; it never approves or pays. Owners make and revoke tokens here
// (each shown once); the demo company shows its public read-only token; anyone else sees the steps.
async function claudeCard(m,owner){
  const card=el('div','card panel claude');card.id='claude';
  const url=location.origin+'/mcp';
  const copyBtn=(text)=>{const b=btn(t('cs.claude.copy'),'','copy');b.onclick=async()=>{try{await navigator.clipboard.writeText(text);b.replaceChildren(ic('circle-check'),t('cs.copied'))}catch(x){}};return b};
  const codeCmd=(token)=>'claude mcp add --transport http purser '+url+' --header "Authorization: Bearer '+token+'"';
  const steps=el('ol','steps',[el('li','',t('cs.claude.step1')),el('li','',t('cs.claude.step2')),el('li','',t('cs.claude.step3'))]);
  const urlRow=el('div','once',[el('b','',t('cs.claude.url')),el('code','cmd',url),el('div','row2',[copyBtn(url)])]);
  const guide=el('a','',t('cs.claude.guide')+' ↗');guide.href='/connect-ai';guide.target='_blank';guide.rel='noopener';
  const kids=[el('h2','',t('cs.claude.title')),el('p','',t('cs.claude.lede')),urlRow,steps,el('p','sub others',[t('cs.claude.others'),' ',guide])];
  if(m.demo){
    const tok='purser-demo-read-only';
    kids.push(note(t('cs.claude.demo')),el('div','once',[el('b','',t('cs.claude.demo_token')),el('code','cmd',tok),el('b','',t('cs.claude.code')),el('code','cmd',codeCmd(tok)),el('div','row2',[copyBtn(codeCmd(tok))])]));
    card.replaceChildren(...kids);return card;
  }
  if(!owner){kids.push(note(t('cs.claude.owner_only',{name:m.tenant.name})));card.replaceChildren(...kids);return card}
  const list=el('div','');const out=el('div','');
  async function draw(){
    const r=await api('/v1/claude/connectors');
    const live=r.items.filter(x=>!x.revoked_at&&x.expires_at>new Date().toISOString());
    if(!live.length){list.replaceChildren(el('p','sub',t('cs.claude.none')));return}
    const ul=el('ul','plain tokens');
    for(const x of live){const rv=btn(t('cs.revoke'),'danger','x');
      rv.onclick=async()=>{if(!confirm(t('cs.claude.revoke_q',{name:x.name})))return;rv.disabled=true;try{await api('/v1/claude/connectors/'+encodeURIComponent(x.id),{method:'DELETE'});out.replaceChildren();await draw()}catch(e){if(!(e instanceof Expired)){rv.disabled=false;out.replaceChildren(note(e.message,'bad'))}}};
      ul.append(el('li','',[el('b','',data('key',x.name)),' ',el('span','pill'+(x.can_propose?' warn':''),x.can_propose?t('cs.claude.proposes'):t('cs.claude.reads')),el('span','sub',' '+t('cs.expires')+' '+day(x.expires_at)+(x.last_used_at?' · '+t('cs.claude.last_used',{when:stamp(x.last_used_at)}):'')),' ',rv]))}
    list.replaceChildren(ul);
  }
  const name=el('input','field');name.placeholder=t('cs.claude.name_placeholder');name.maxLength=60;name.id='claude-name';
  const prop=el('input','');prop.type='checkbox';prop.id='claude-propose';
  const lab=el('label','check',[prop,' ',t('cs.claude.propose')]);lab.htmlFor='claude-propose';
  const mk=btn(t('cs.claude.make'),'primary','key-round');mk.id='claude-make';
  mk.onclick=async()=>{if(!name.value.trim())return;mk.disabled=true;
    try{const r=await api('/v1/claude/connectors',{method:'POST',body:{name:name.value.trim(),propose:prop.checked}});name.value='';prop.checked=false;await draw();
      out.replaceChildren(el('div','once',[el('b','',t('cs.shown_once')),t('cs.copy_now'),el('code','cmd',r.token),el('div','row2',[copyBtn(r.token)]),el('b','',t('cs.claude.code')),el('code','cmd',codeCmd(r.token)),el('div','row2',[copyBtn(codeCmd(r.token))])]))}
    catch(e){if(!(e instanceof Expired))out.replaceChildren(note(e.message,'bad'))}finally{mk.disabled=false}};
  kids.push(el('h2','sub-h',t('cs.claude.tokens')),list,el('div','form-row',[el('div','',[el('label','',t('cs.name')),name]),el('div','',[mk])]),lab,out,note(t('cs.claude.keeps')));
  card.replaceChildren(...kids);
  try{await draw()}catch(e){if(!(e instanceof Expired))list.replaceChildren(note(e.message,'bad'))}
  return card;
}

async function settingsView(){
  title(t('cs.nav.settings'));
  const m=await me();
  const owner=m.scopes.includes('admin');
  // The pages' language: an owner sets the company's; a signed-in person may choose their own (or follow the company).
  const langSel=(opts,value)=>{const s=el('select','field');for(const [v,l] of opts){const o=el('option','',l);o.value=v;if(v===value)o.selected=true;s.append(o)}return s};
  const langNames=[['nl','Nederlands'],['en','English']];
  const langBox=el('div','form-row');const langMsg=el('div','');
  if(owner){const c=langSel(langNames,m.tenant.language||'nl');c.onchange=async()=>{try{await api('/v1/company',{method:'POST',body:{language:c.value}});ME=null;langMsg.replaceChildren(note(t('cs.language_saved'),'ok'));if(!m.user||!m.user.language)useLanguage(c.value)}catch(e){if(!(e instanceof Expired))langMsg.replaceChildren(note(e.message,'bad'))}};langBox.append(el('div','',[el('label','',t('cs.language_company')),c]))}
  if(m.kind==='session'&&m.user){const p=langSel([['',t('cs.language_follow')],...langNames],m.user.language||'');p.onchange=async()=>{try{const r=await api('/v1/me/language',{method:'POST',body:{language:p.value||null}});ME=null;langMsg.replaceChildren(note(t('cs.language_saved'),'ok'));useLanguage(r.language||m.tenant.language||'en')}catch(e){if(!(e instanceof Expired))langMsg.replaceChildren(note(e.message,'bad'))}};langBox.append(el('div','',[el('label','',t('cs.language_mine')),p]))}
  const company=el('div','card panel',[el('h2','',t('cs.company')),dl([[t('cs.name'),m.tenant.name],[t('cs.address'),m.tenant.slug],[t('cs.inbox'),m.inbox||t('cs.not_routed'),'mono']]),langBox.children.length?el('h2','sub-h',t('cs.language')):null,langBox.children.length?langBox:null,langMsg]);
  if(!owner){const cc=await claudeCard(m,false);view().replaceChildren(head(t('cs.nav.settings')),company,note(t('cs.only_owner',{name:m.tenant.name})),cc);return}
  const people=el('div','card panel');const keys=el('div','card panel');const dataCard=el('div','card panel');const awx=el('div','card panel');awx.id='awx';awx.hidden=true;
  const ints=el('div','card panel');ints.id='integrations';const conn=el('div','card panel');conn.id='connect';conn.hidden=true;
  const claude=await claudeCard(m,true);
  view().replaceChildren(head(t('cs.nav.settings'),t('cs.settings_lede')),company,claude,awx,conn,ints,el('div','split2',[people,keys]),dataCard);
  // Accounts the company already has, connected by OAuth (docs/real-customers.md): only when the cloud offers it. The
  // owner signs in at Airwallex or Moneybird and agrees there; Purser keeps the tokens sealed and never shows them.
  async function drawConn(){
    const r=await api('/v1/connect');
    const offered=(r.connections||[]).filter(x=>x.offered);
    if(!r.switched_on||!offered.length){conn.hidden=true;return}
    conn.hidden=false;const msg=el('div','');const kids=[el('h2','',t('cs.conn.title')),el('p','',t('cs.conn.lede'))];
    for(const x of offered){
      const rows=[[t('cs.conn.status'),el('span','pill'+(x.status==='connected'?' ok':x.ended_reason==='refused'?' warn':''),tk('cs.conn.status.'+x.status,x.status))]];
      if(x.account)rows.push([t('cs.awx.account'),x.account,'mono']);
      if(x.connected_at&&x.status==='connected')rows.push([t('cs.awx.since'),stamp(x.connected_at)]);
      kids.push(el('h2','sub-h',tk('cs.conn.name.'+x.provider,x.provider)),dl(rows));
      if(x.status==='connected'){const d=btn(t('cs.conn.disconnect'),'','x');d.onclick=async()=>{d.disabled=true;try{const o=await api('/v1/connect/'+x.provider,{method:'DELETE'});await drawConn();if(o.note)conn.append(note(o.note))}catch(e){if(!(e instanceof Expired))msg.replaceChildren(note(e.message,'bad'));d.disabled=false}};kids.push(el('div','row2',[d]))}
      else{const g=btn(tk('cs.conn.connect.'+x.provider,x.provider),'primary','shield-check');g.onclick=async()=>{g.disabled=true;try{const o=await api('/v1/connect/'+x.provider+'/start',{method:'POST'});location.assign(o.url)}catch(e){if(!(e instanceof Expired))msg.replaceChildren(note(e.message,'bad'));g.disabled=false}};kids.push(el('div','row2',[g]))}
    }
    if(connNote){msg.replaceChildren(note(connNote[0],connNote[1]));connNote=null}
    kids.push(note(t('cs.conn.keeps')),msg);conn.replaceChildren(...kids);
  }
  // Koppelingen: where the accounting link stands (GET /v1/integrations), from the results the runner's ERP sync wrote
  // in the audit log. The cloud holds no Moneybird token and calls no ERP; a person connects it on the runner.
  async function drawInts(){
    const r=await api('/v1/integrations');
    const kids=[el('h2','',t('cs.int.title')),el('p','',t('cs.int.lede'))];
    for(const x of r.connectors){
      const tone={connected:'ok',attention:'warn'}[x.status]||'';
      const rows=[[tk('cs.int.'+x.connector,x.connector),el('span','pill'+(tone?' '+tone:''),tk('cs.int.status.'+x.status,x.status))]];
      if(x.last_sync_at)rows.push([t('cs.int.last_sync'),stamp(x.last_sync_at)]);
      if(x.status!=='not_connected')rows.push([t('cs.int.sent'),String(x.sent)],[t('cs.int.failed'),String(x.failed)],[t('cs.int.to_check'),String(x.to_check)]);
      if(x.last_error)rows.push([t('cs.int.last_error'),x.last_error,'mono']);
      kids.push(dl(rows));
      if(x.status==='not_connected')kids.push(note(t('cs.int.how')));
    }
    ints.replaceChildren(...kids);
  }
  // The company's own Airwallex account, opened through Purser as a platform (docs/airwallex-platform.md): only when the
  // cloud offers it. The owner agrees to Airwallex's terms before anything is sent; Airwallex checks the company in its
  // own hosted pages; the status follows Airwallex's messages. Payments are still approved on the CFO's phone.
  async function drawAwx(){
    const r=await api('/v1/airwallex/account');
    if(!r.switched_on){awx.hidden=true;return}
    awx.hidden=false;
    const msg=el('div','');
    const a=r.account;
    if(a){
      const tone={active:'ok',refused:'bad',closed:'bad',action_required:'warn',dormant:'warn'}[a.status]||'';
      const kids=[el('h2','',t('cs.awx.title')),dl([[t('cs.awx.business'),a.business_name],[t('cs.awx.account'),a.account_id||'…','mono'],[t('cs.awx.status'),el('span','pill'+(tone?' '+tone:''),tk('cs.awx.status.'+a.status,a.status))],[t('cs.awx.since'),stamp(a.updated_at)]])];
      if(a.account_id&&!['active','refused','closed'].includes(a.status)){
        const go=btn(t('cs.awx.verify'),'primary','shield-check');
        go.onclick=async()=>{go.disabled=true;try{const l=await api('/v1/airwallex/onboarding-link',{method:'POST'});location.assign(l.url)}catch(e){if(!(e instanceof Expired))msg.replaceChildren(note(e.message,'bad'))}finally{go.disabled=false}};
        kids.push(el('div','row2',[go]));
      }
      kids.push(note(t(a.status==='active'?'cs.awx.active_note':'cs.awx.status_note')),msg);
      awx.replaceChildren(...kids);return;
    }
    const name=el('input','field');name.value=m.tenant.name||'';name.maxLength=200;
    const country=el('select','field');for(const c of ['NL','DE','BE','FR','GB','US']){const o=el('option','',tk('cs.awx.country.'+c,c));o.value=c;country.append(o)}
    const email=el('input','field');email.type='email';email.maxLength=200;email.placeholder='finance@…';
    const agree=el('input','');agree.type='checkbox';agree.id='awx-agree';
    const lab=el('label','check',[agree,' ',t('cs.awx.agree')]);lab.htmlFor='awx-agree';
    const open=btn(t('cs.awx.open'),'primary','wallet');open.disabled=true;agree.onchange=()=>{open.disabled=!agree.checked};
    open.onclick=async()=>{if(!agree.checked||!name.value.trim()||!email.value.trim())return;open.disabled=true;
      try{await api('/v1/airwallex/account',{method:'POST',body:{business_name:name.value.trim(),country_code:country.value,email:email.value.trim(),agreed:true}});await drawAwx()}catch(e){if(!(e instanceof Expired)){msg.replaceChildren(note(e.message,'bad'));open.disabled=false}}};
    awx.replaceChildren(el('h2','',t('cs.awx.title')),el('p','',t('cs.awx.lede')),
      el('div','form-row',[el('div','',[el('label','',t('cs.awx.business')),name]),el('div','',[el('label','',t('cs.awx.country')),country]),el('div','',[el('label','',t('cs.awx.email')),email])]),
      lab,el('div','row2',[open]),note(t('cs.awx.keeps')),msg);
  }
  // An invite: a one-time link to this console (the secret after the #, so opening it sends it to no server) and its
  // QR code, for 30 minutes and one passkey. The owner passes it on; nothing is mailed.
  const invites=el('div','');
  async function invite(p){
    const e=await api('/v1/users/'+encodeURIComponent(p.id)+'/enrolment',{method:'POST'});
    const qr=el('img','qr');qr.alt=t('cs.qr_alt',{name:p.display_name});qr.width=180;qr.height=180;qr.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(e.qr_svg);
    const link=el('code','cmd',e.link);link.id='invite-link';
    const copy=btn(t('cs.copy_link'),'primary','copy');copy.onclick=async()=>{try{await navigator.clipboard.writeText(e.link);copy.replaceChildren(ic('circle-check'),t('cs.copied'))}catch(x){const r=document.createRange();r.selectNodeContents(link);const sel=getSelection();sel.removeAllRanges();sel.addRange(r)}};
    invites.replaceChildren(el('div','once invite',[qr,el('div','',[el('b','',t('cs.invite_for',{name:p.display_name})),el('p','',t('cs.invite_until',{when:stamp(e.expires_at)})),link,el('div','row2',[copy])])]));
    invites.scrollIntoView({block:'nearest'});
  }
  // A person's passkeys, each removable by an owner (red team round 5: a passkey planted with a leaked starter key was
  // invisible). Removing one ends that person's sessions; the company's last owner passkey cannot go.
  const keysOf=el('div','');keysOf.id='passkeys';
  async function passkeys(p){
    const r=await api('/v1/users/'+encodeURIComponent(p.id)+'/passkeys');
    const list=el('ul','plain');
    for(const k of r.items){const rm=btn(t('cs.remove'),'danger','x');
      rm.onclick=async()=>{if(!confirm(t('cs.remove_passkey_q',{name:p.display_name})))return;rm.disabled=true;
        try{await api('/v1/users/'+encodeURIComponent(p.id)+'/passkeys/'+encodeURIComponent(k.credential_id),{method:'DELETE'});await passkeys(p)}catch(e){if(!(e instanceof Expired)){rm.disabled=false;keysOf.append(note(e.message,'bad'))}}};
      list.append(el('li','',[el('span','mono',k.credential_id.slice(0,10)+'…'),' '+t('cs.enrolled',{when:stamp(k.created_at)})+' ',rm]))}
    keysOf.replaceChildren(el('div','once',[el('b','',t('cs.passkeys_of',{name:p.display_name})),r.items.length?list:el('p','',t('cs.no_passkey_yet'))]));
    keysOf.scrollIntoView({block:'nearest'});
  }
  async function drawPeople(){
    const u=await api('/v1/users?limit=200');
    const tbl=el('table','table',[el('thead','',[el('tr','',[el('th','',t('cs.person')),el('th','',t('cs.role')),el('th','')])])]);const tb=el('tbody','');
    for(const p of u.items){const acts=el('td','r acts');
      if(!p.erased_at){const inv=btn(t('cs.invite'),'','key-round');inv.onclick=async()=>{inv.disabled=true;try{await invite(p)}catch(e){if(!(e instanceof Expired))people.append(note(e.message,'bad'))}finally{inv.disabled=false}};
        const er=btn(t('cs.erase'),'danger','x');er.onclick=async()=>{const typed=prompt(t('cs.erase_prompt',{name:p.display_name}));if(typed===null)return;if(typed.trim()!==p.display_name){people.append(note(t('cs.name_mismatch'),'bad'));return}
          try{await api('/v1/users/'+encodeURIComponent(p.id)+'/erase',{method:'POST'});await drawPeople()}catch(e){if(!(e instanceof Expired))people.append(note(e.message,'bad'))}};
        const pks=btn(t('cs.passkeys'),'','scan-face');pks.onclick=async()=>{pks.disabled=true;try{await passkeys(p)}catch(e){if(!(e instanceof Expired))people.append(note(e.message,'bad'))}finally{pks.disabled=false}};
        acts.append(inv,' ',pks,' ',er)}
      tb.append(el('tr','',[el('td','pn',[p.erased_at?null:av(p.display_name),el('b','',p.erased_at?t('cs.erased'):p.display_name),p.email?el('span','sub',' '+p.email):null]),el('td','',[el('span','pill'+(p.role==='owner'?' warn':''),tk('cs.role.'+p.role,p.role))]),acts]))}
    tbl.append(tb);
    const name=el('input','field');name.placeholder=t('cs.name');const role=el('select','field');for(const r of ['cfo','accountant','viewer','owner']){const o=el('option','',tk('cs.role.'+r,r));o.value=r;role.append(o)}
    const add=btn(t('cs.add_invite'),'primary');add.onclick=async()=>{const n=name.value.trim();if(!n)return;add.disabled=true;try{const u=await api('/v1/users',{method:'POST',body:{display_name:n,role:role.value}});await drawPeople();await invite({id:u.id,display_name:n})}catch(e){if(!(e instanceof Expired))people.append(note(e.message,'bad'))}finally{add.disabled=false}};
    people.replaceChildren(el('h2','',t('cs.people')),el('div','scroll',tbl),el('div','form-row',[el('div','',[el('label','',t('cs.name')),name]),el('div','',[el('label','',t('cs.role')),role]),el('div','',[add])]),
      note(t('cs.people_note')),invites,keysOf);
  }
  async function drawKeys(){
    const k=await api('/v1/keys?limit=200');
    const tbl=el('table','table',[el('thead','',[el('tr','',[el('th','',t('cs.key')),el('th','',t('cs.may')),el('th','',t('cs.expires')),el('th','')])])]);const tb=el('tbody','');
    for(const x of k.items.filter(y=>!/^claude/.test(y.purpose||''))){const live=!x.revoked_at&&x.expires_at>new Date().toISOString();const acts=el('td','r acts');
      if(live){const rv=btn(t('cs.revoke'),'danger','x');rv.onclick=async()=>{if(!confirm(t('cs.revoke_confirm',{name:data('key',x.name)})))return;try{await api('/v1/keys/'+encodeURIComponent(x.id),{method:'DELETE'});await drawKeys()}catch(e){if(!(e instanceof Expired))keys.append(note(e.message,'bad'))}};acts.append(rv)}
      tb.append(el('tr','',[el('td','',[el('b','',data('key',x.name)),el('span','sub',' '+x.id)]),el('td','',String(x.scopes||'').split(/[ ,]+/).filter(Boolean).map(sc=>tk('cs.scope.'+sc,sc)).join(', ')),el('td','',live?day(x.expires_at):[el('span','pill bad',x.revoked_at?t('cs.revoked'):t('cs.expired'))]),acts]))}
    tbl.append(tb);
    const name=el('input','field');name.placeholder=t('cs.key_placeholder');const scope=el('select','field');for(const [v,l] of [['read',t('cs.scope.read')],['sync',t('cs.scope.sync')],['read sync',t('cs.scope.read_sync')]]){const o=el('option','',l);o.value=v;scope.append(o)}
    const days=el('input','field');days.type='number';days.min='1';days.max='365';days.value='90';
    const out=el('div','');
    const mk=btn(t('cs.make_key'),'primary','key-round');mk.onclick=async()=>{if(!name.value.trim())return;mk.disabled=true;try{const r=await api('/v1/keys',{method:'POST',body:{name:name.value.trim(),scopes:scope.value.split(' '),expires_in_days:Math.max(1,Math.min(365,Number(days.value)||90))}});
        await drawKeys();keys.append(el('div','once',[el('b','',t('cs.shown_once')),t('cs.copy_now'),el('code','cmd',r.api_key)]))}catch(e){if(!(e instanceof Expired))keys.append(note(e.message,'bad'))}finally{mk.disabled=false}};
    keys.replaceChildren(el('h2','',t('cs.api_keys')),el('div','scroll',tbl),el('div','form-row',[el('div','',[el('label','',t('cs.name')),name]),el('div','',[el('label','',t('cs.may')),scope]),el('div','',[el('label','',t('cs.days')),days]),el('div','',[mk])]),out,
      note(t('cs.keys_note')));
  }
  const exp=btn(t('cs.download_all'),'','download');exp.onclick=()=>download('/v1/export','purser-cloud-export.json').catch(e=>{if(!(e instanceof Expired))dataCard.append(note(e.message,'bad'))});
  dataCard.replaceChildren(el('h2','',t('cs.your_data')),el('p','',t('cs.data_lede',{name:m.tenant.name})),exp);
  await Promise.all([drawPeople(),drawKeys(),drawAwx().catch(e=>{if(!(e instanceof Expired)){awx.hidden=false;awx.replaceChildren(note(e.message,'bad'))}}),drawInts().catch(e=>{if(!(e instanceof Expired))ints.replaceChildren(el('h2','',t('cs.int.title')),note(e.message,'bad'))}),drawConn().catch(e=>{if(!(e instanceof Expired)){conn.hidden=false;conn.replaceChildren(note(e.message,'bad'))}})]);
}

// --- The router ----------------------------------------------------------------------------------------------------
// --- The platform's companies: for Purser's operator, with the platform admin token (kept in this page only) ---------
function platformView(){
  title(t('cs.pf.title'));
  const tok=el('input','field');tok.type='password';tok.autocomplete='off';tok.id='pf-token';tok.placeholder=t('cs.pf.token');tok.setAttribute('aria-label',t('cs.pf.token'));
  const b=btn(t('cs.pf.show'),'primary','users');const out=el('div','');const status=el('div','');status.setAttribute('role','status');
  const sum=(m)=>{const e=Object.entries(m||{});return e.length?e.map(([c,v])=>cur(c)+' '+amount(v)).join(' · '):''};
  const lab=(td,l)=>{td.dataset.l=l;return td};
  // The token lives in this closure only: never in storage, gone when the page is left or the person signs out here.
  let token='';
  const gate=el('div','pfgate',[el('div','pfin',[tok,b]),el('p','fine',t('cs.pf.token_note')),status]);
  function signOut(){token='';tok.value='';out.replaceChildren();gate.replaceChildren(el('div','pfin',[tok,b]),el('p','fine',t('cs.pf.token_note')),status);tok.focus()}
  b.onclick=async()=>{b.disabled=true;status.replaceChildren();token=tok.value.trim();
    try{const r=await fetch('/v1/admin/companies',{headers:{authorization:'Bearer '+token}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.statusText);
      tok.value='';const so=el('button','linkish',t('cs.pf.sign_out'));so.type='button';so.onclick=signOut;
      gate.replaceChildren(el('span','pfchip',[ic('shield-check'),el('span','',t('cs.pf.admin')),el('span','dot','·'),so]));
      const tt=j.totals,cs=j.companies;const act=cs.filter(c=>c.airwallex&&c.airwallex.status==='active').length,none=cs.filter(c=>!c.airwallex).length,chk=cs.length-act-none;
      const fees=sum(tt.fees);
      const split=el('div','card tile wide',[el('div','l',[ic('shield-check'),t('cs.pf.split')]),segbar([{l:t('cs.pf.s.active'),v:act,t:String(act)},{l:t('cs.pf.s.checking'),v:chk,t:String(chk)},{l:t('cs.pf.s.none'),v:none,t:String(none)}],t('cs.pf.split'))]);
      const tiles=el('div','tiles pf',[tile(t('cs.pf.companies'),'users',String(tt.companies),null),split,tile(t('cs.pf.payouts'),'arrow-up-right',sum(tt.payouts)||t('none'),null),tile(t('cs.pf.fees'),'wallet',fees||t('cs.pf.no_fees'),null,fees?null:'quiet')]);
      // Each company's bar is its payouts in the cloud's main currency, against the largest: one hue, the amount beside it.
      const mainCur=Object.entries(tt.payouts||{}).sort((x,y)=>toCents(y[1])-toCents(x[1]))[0];const maxP=mainCur?Math.max(...cs.map(c=>toCents((c.payouts.totals||{})[mainCur[0]]))):0;
      const tbl=el('table','table pft',[el('thead','',[el('tr','',[el('th','',t('cs.pf.company')),el('th','',t('cs.pf.account')),el('th','',t('cs.pf.payouts')),el('th','r',t('cs.pf.fees')),el('th','',t('cs.pf.last_push'))])])]);const tb=el('tbody','');
      for(const c of cs){const aw=c.airwallex;const pc=mainCur?toCents((c.payouts.totals||{})[mainCur[0]]):0;
        tb.append(el('tr','',[el('td','pco',[av(c.name),el('span','',[el('b','',c.name),el('span','sub',[el('code','idc',c.slug),c.closed?' · '+t('cs.pf.closed'):''])])]),
          el('td','',aw?[el('span','pill '+(aw.status==='active'?'ok':['refused','closed'].includes(aw.status)?'bad':'warn'),tk('cs.awx.status.'+aw.status,aw.status)),aw.account_id?el('span','sub',[el('code','idc',aw.account_id)]):null]:el('span','pill',t('cs.awx.none'))),
          lab(el('td','pay',[el('span','pv',[el('b','num',sum(c.payouts.totals)||'–'),el('span','sub',[t('cs.pf.paid',{n:c.payouts.count}),c.waiting?' · '+t('cs.pf.waiting',{n:c.waiting}):''])]),mainCur?meter(pc,maxP):null]),t('cs.pf.payouts')),
          lab(el('td','r',sum(c.fees)||t('cs.pf.no_fees')),t('cs.pf.fees')),lab(el('td','',c.last_push?stamp(c.last_push):t('cs.pf.never')),t('cs.pf.last_push'))]))}
      if(!cs.length)tb.append(el('tr','',[el('td','',t('cs.pf.none')),el('td',''),el('td',''),el('td',''),el('td','')]));
      tbl.append(tb);out.replaceChildren(tiles,el('section','section',[el('div','card list pfl',[el('div','scroll',tbl)])]))}
    catch(e){token='';status.replaceChildren(note(e.message,'bad'))}finally{b.disabled=false}};
  tok.onkeydown=(e)=>{if(e.key==='Enter')b.click()};
  view().replaceChildren(el('div','head',[el('div','',[el('h1','',t('cs.pf.title')),el('p','lede',t('cs.pf.lede'))]),el('div','tools',[gate])]),out);
}

/** Try as guest: a read-only session for the demo company (POST /v1/auth/guest), then its overview. From a link, a failure is said on the sign-in. */
async function guestIn(fromButton){
  try{const r=await api('/v1/auth/guest',{method:'POST',token:'-'});S={token:r.session,exp:Date.now()+r.expires_in*1000-5000,slug:r.tenant,guest:true};save(S);ME=null;go('#/overview')}
  catch(e){if(fromButton)throw e;notice=t('cs.guest.failed',{error:e.message});go('#/sign-in')}
}
async function route(){
  const h=location.hash||'#/';const [path,qs]=h.slice(1).split('?');const q=new URLSearchParams(qs||'');
  S=load();shell();
  // No timer of the panel "At work" outlives the view it was mounted in.
  workStop();
  if(CFG.engine){engineChip(true);if(S)engineStatus().then((st)=>engineChip(!!st),()=>{})}
  const open={'/sign-in':signInView,'/start':startView,'/platform':platformView};
  try{
    if(path==='/enrol')return enrolView(q);
    if(open[path])return open[path]();
    // Try as guest from a link (the hands-on demo's last step, 13 Nov): the demo company opens read only, as the sign-in's
    // button does; a session already open is kept.
    if(path==='/guest'){if(S)return go('#/overview');view().replaceChildren(el('p','lede',t('cs.guest.opening')));return guestIn()}
    // A provider's code in the address is spent or useless without a session: it leaves the browser's history at once.
    if(path==='/connect'&&!S){history.replaceState(null,'','#/settings');return go('#/sign-in')}
    if(!S)return go('#/sign-in');
    if(path==='/'||path==='')return go('#/overview');
    // Back from Airwallex's or Moneybird's consent screen (GET /v1/connect/{provider}/callback put the code here, in the
    // fragment, which no server sees): the signed-in owner who started it finishes the connection.
    if(path==='/connect'){const p=q.get('provider');if(p!=='airwallex'&&p!=='moneybird')return go('#/settings');
      if(q.get('error')||!q.get('code')){connNote=[t('cs.conn.declined'),'bad'];return go('#/settings')}
      history.replaceState(null,'','#/settings');
      try{await api('/v1/connect/'+p+'/finish',{method:'POST',body:{code:q.get('code'),state:q.get('state')}});connNote=[t('cs.conn.done'),'ok']}catch(e){if(e instanceof Expired)return;connNote=[e.message,'bad']}
      return route()}
    view().replaceChildren(el('p','lede',t('loading')));
    const m=/^\/invoices\/([^/]+)$/.exec(path);
    if(m)return await invoiceView(decodeURIComponent(m[1]));
    // The Invoices tab is part of Books now (13 Nov): its old route keeps its filter and lands there.
    if(path==='/invoices'){history.replaceState(null,'','#/books'+(qs?'?'+qs:''));return route()}
    const pages={'/overview':overviewView,'/agents':agentsView,'/books':booksView,'/transactions':transactionsView,'/tokenisation':tokensView,'/settings':settingsView,...(CFG.engine?{'/archive':archiveView}:{})};
    if(!pages[path])return view().replaceChildren(el('div','expired',[el('h1','',t('cs.not_here')),(()=>{const a=el('a','btn',t('cs.back_overview'));a.href='#/overview';return a})()]));
    await pages[path](q);shell();
  }catch(e){if(e instanceof Expired)return;view().replaceChildren(note(t('cs.load_failed',{error:e.message}),'bad'))}
}
$('#demo-out').onclick=(e)=>{e.preventDefault();$('#out').click()};
$('#out').onclick=async()=>{workStop();try{await api('/v1/auth/logout',{method:'POST'})}catch(e){}forget();S=null;ME=null;go('#/sign-in')};
window.addEventListener('hashchange',route);
setInterval(()=>{if(S&&S.exp<=Date.now()){forget();S=null;ME=null;notice=t('cs.session_ended');go('#/sign-in')}else shell()},30000);
route();
`;

/**
 * Purser Cloud's own look (13 Nov, owner: "white and enterprise, clearly not the /try demo"): always light (the page
 * sets data-theme="light", so the tokens' dark block never applies), white surfaces with hairline borders, a neutral
 * page, calmer type and spacing, square-ish corners. Last in the one style, so it settles what the shared kit leaves.
 */
const CLOUD_CSS = `
:root[data-theme="light"] { --bg: #ffffff; --surface: #ffffff; --sunken: #f4f5f7; --border: #e4e7ec; --muted: #5b6472; --faint: #8a93a1; --r: 12px; }
body { background: #ffffff; font-size: 15px; letter-spacing: -.005em; }
header.top, .appbar { background: #ffffff; border-bottom: 1px solid var(--border); backdrop-filter: none; -webkit-backdrop-filter: none; }
.appbar .wrap { min-height: 52px; }
.apptabs a { border-radius: 8px; font-weight: 600; color: var(--muted); }
.apptabs a[aria-current="page"] { background: var(--sunken); color: var(--text); box-shadow: inset 0 -2px 0 var(--text); border-radius: 8px 8px 0 0; }
main { padding: 32px 0 72px; }
#view h1 { font-size: 28px; font-weight: 700; letter-spacing: -.02em; margin-bottom: 4px; }
#view h2 { font-weight: 650; letter-spacing: -.01em; }
.card, .auth { border: 1px solid var(--border); border-radius: 12px; background: #ffffff; box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
table thead th, .tbl thead th { background: #f9fafb; color: var(--muted); font-weight: 600; letter-spacing: .02em; }
.test { background: #fff7e6; border: 1px solid #f3dfb5; }
#foot { color: var(--faint); border-top: 1px solid var(--border); padding-top: 18px; }
/* Signed out: a neutral panel beside the card, the Purser mark's colours only. */
.signed-out { background: #ffffff; }
.signed-out .hero { background: #f8f9fb; border-right: 1px solid var(--border); align-content: center; justify-items: center; }
.side { max-width: 420px; margin: 0 auto; padding: 8px 4px; }
.side h2 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -.02em; color: var(--text); }
.side p { margin: 8px 0 20px; color: var(--muted); font-size: 16px; line-height: 1.5; }
.side ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.side li { display: flex; gap: 10px; align-items: flex-start; color: var(--text); font-size: 15px; line-height: 1.45; }
.side li .i { color: var(--accent); margin-top: 1px; }
.signed-out main { margin-top: 0; padding: 24px 0; }
.signed-out .auth { box-shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 12px 32px -16px rgba(16, 24, 40, .12); }
.auth h1 { font-weight: 700; }
@media (max-width: 1023px) { .signed-out .hero { flex: none; min-height: 0; padding: 20px; border-right: 0; border-bottom: 1px solid var(--border); justify-items: start; } .side { margin: 0; } .side h2 { font-size: 22px; } .side p { margin: 4px 0 0; font-size: 15px; } }
/* A phone keeps the card and the trust line in the first screen (test/browser/console.check.ts): the panel's list waits for a wider screen. */
@media (max-width: 640px) { .side ul, .side p { display: none; } .auth .guest { margin-top: 14px; } .auth .guest .gsub { font-size: 12.5px; }
  /* 13 Nov: the card's lede says what Purser Cloud is (three short lines on a phone); the card is a little tighter to keep the trust line in view. */
  .auth p.what { font-size: 14.5px; line-height: 1.45; margin-bottom: 12px; } .card.auth { padding-top: 20px; padding-bottom: 18px; } .auth h1 { margin-bottom: 6px; } }
/* Try as guest: under the passkey, after a quiet "or". */
.auth .guest { margin-top: 18px; display: grid; gap: 8px; }
.auth .guest .or { display: flex; align-items: center; gap: 12px; color: var(--faint); font-size: 13px; }
.auth .guest .or::before, .auth .guest .or::after { content: ""; flex: 1; height: 1px; background: var(--border); }
.btn.ghost { background: #fff; border-color: var(--border); width: 100%; }
.btn.ghost:hover { border-color: var(--text); }
.auth .guest .gsub { margin: 0; font-size: 13px; color: var(--muted); text-align: center; }
/* The demo company's ribbon: on every page while a guest looks around. */
.claude ol.steps { margin: 12px 0 4px; padding-left: 22px; color: var(--text); font-size: 14px; }
.claude ol.steps li { margin: 6px 0; }
.claude .once.url, .claude .once { display: flex; flex-direction: column; gap: 8px; }
.claude .once b { font-size: 13px; }
.claude code.cmd { display: block; white-space: pre-wrap; overflow-wrap: anywhere; }
.claude ul.tokens li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 10px 0; border-bottom: 1px solid var(--line, #e5e7eb); }
.claude ul.tokens li .btn { margin-left: auto; }
.claude p.others { margin-top: 10px; } .claude p.others a { display: inline-block; padding: 12px 0; font-weight: 600; }
.demo-ribbon { background: #fff7e6; border-bottom: 1px solid #f3dfb5; color: #7a4a00; font-size: 13.5px; }
.demo-ribbon .wrap { display: flex; align-items: center; gap: 10px; min-height: 40px; padding-top: 6px; padding-bottom: 6px; }
.demo-ribbon span { flex: 1; line-height: 1.4; }
.demo-ribbon a { font-weight: 650; color: #7a4a00; white-space: nowrap; }
.signed-out .demo-ribbon { display: none; }
/* The start screen's dashboard (GET /v1/dashboard). */
.dash { display: grid; gap: 16px; margin: 4px 0 32px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 980px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } }
.kpi { padding: 16px 18px; display: grid; gap: 6px; align-content: start; }
.kpi .kl { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
.kpi .kl .ic { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--sunken); color: var(--muted); }
.kpi b { font-size: 26px; line-height: 1.15; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi.pos .kl .ic { background: var(--ok-soft); color: var(--ok); } .kpi.neg .kl .ic { background: var(--bad-soft); color: var(--bad); }
.kpi .ks { font-size: 12.5px; color: var(--faint); line-height: 1.35; }
@media (max-width: 520px) { .kpi { padding: 14px; } .kpi b { font-size: 20px; } }
.dgrid { display: grid; gap: 16px; }
@media (min-width: 980px) { .dgrid.g1 { grid-template-columns: minmax(0, 1.8fr) minmax(0, 1fr); } .dgrid.g2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.dcard { padding: 18px 20px 16px; min-width: 0; }
.dcard .dh h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
.dcard .dh p { margin: 2px 0 14px; font-size: 13px; color: var(--muted); }
.cv { overflow: hidden; }
svg.chart { display: block; max-width: 100%; height: auto; overflow: visible; }
svg.chart .grid { stroke: var(--border); stroke-width: 1; }
svg.chart .zero { stroke: #c9ced6; stroke-width: 1; stroke-dasharray: 3 3; }
svg.chart .ax { font: 500 11.5px Inter, system-ui, sans-serif; fill: var(--faint); }
svg.chart .val { font: 650 12px Inter, system-ui, sans-serif; fill: var(--text); }
svg.chart .line { fill: none; stroke: var(--accent); stroke-width: 2.25; stroke-linejoin: round; stroke-linecap: round; }
svg.chart .end { fill: #fff; stroke: var(--accent); stroke-width: 2.5; }
svg.chart .hit { fill: transparent; } svg.chart .hit:hover { fill: rgba(16, 24, 40, .04); }
svg.chart .b.cfo { fill: var(--accent); } svg.chart .b.alone { fill: color-mix(in srgb, var(--accent) 30%, #fff); }
.klegend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; padding: 0; font-size: 12.5px; color: var(--muted); }
.klegend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.klegend i.cfo { background: var(--accent); } .klegend i.alone { background: color-mix(in srgb, var(--accent) 30%, #fff); }
.ringwrap { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
svg.ring { flex: none; transform: rotate(-90deg); }
svg.ring .track, svg.ring .seg { fill: none; stroke-width: 13; }
svg.ring .track { stroke: var(--sunken); }
svg.ring text { transform: rotate(90deg); transform-origin: 60px 60px; }
svg.ring .rt { font: 700 26px Inter, system-ui, sans-serif; fill: var(--text); }
svg.ring .rs { font: 500 10.5px Inter, system-ui, sans-serif; fill: var(--faint); }
.r0 { stroke: var(--ok); } .r1 { stroke: var(--accent); } .r2 { stroke: #d08a1c; } .r3 { stroke: #98a1ae; } .r4 { stroke: var(--bad); }
.rlegend { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; min-width: 0; }
.rlegend li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; column-gap: 8px; align-items: baseline; font-size: 13.5px; }
.rlegend li i { width: 10px; height: 10px; border-radius: 3px; align-self: center; }
.rlegend li i.r0 { background: var(--ok); } .rlegend li i.r1 { background: var(--accent); } .rlegend li i.r2 { background: #d08a1c; } .rlegend li i.r3 { background: #98a1ae; } .rlegend li i.r4 { background: var(--bad); }
.rlegend li small { grid-column: 2 / -1; color: var(--faint); font-size: 12.5px; }
.dcard .fine { margin: 10px 0 0; font-size: 12.5px; color: var(--muted); }
.sbars { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.sbars .sl { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.sbars .sl b { font-variant-numeric: tabular-nums; }
.sbars .strk { display: block; height: 10px; margin: 6px 0 4px; border-radius: 999px; background: var(--sunken); overflow: hidden; }
.sbars .sf { display: block; height: 100%; border-radius: 999px; background: var(--accent); transform-origin: left center; }
.sbars li:first-child .sf { background: var(--text); }
.sbars .ss { font-size: 12.5px; color: var(--faint); } .sbars .dec { color: var(--bad); }
.feed { list-style: none; margin: 0; padding: 0; display: grid; gap: 0 28px; }
@media (min-width: 980px) { .feed { grid-template-columns: 1fr 1fr; } }
.feed li { display: grid; grid-template-columns: 12px minmax(0, 1fr); column-gap: 10px; padding: 10px 0; border-top: 1px solid var(--border); }
.feed .fd { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: #98a1ae; }
.feed .f-ok .fd { background: var(--ok); } .feed .f-bad .fd { background: var(--bad); } .feed .f-wait .fd { background: #d08a1c; } .feed .f-info .fd { background: var(--accent); }
.feed .fw { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.feed .fw time { color: var(--faint); white-space: nowrap; }
.feed p { margin: 2px 0 0; font-size: 14px; line-height: 1.45; color: var(--text); overflow-wrap: anywhere; }
@media (max-width: 979px) { .feed li:nth-child(n+9) { display: none; } }
/* Every part is in place within 800 ms of coming into view (jury, 13 Nov: still moving after 2.5 s at 390 px). */
@media (prefers-reduced-motion: no-preference) {
  .rise { opacity: 0; transform: translateY(8px); transition: opacity .35s ease, transform .35s ease; }
  .rise.in { opacity: 1; transform: none; }
  .kpis .kpi:nth-child(2) { transition-delay: .04s; } .kpis .kpi:nth-child(3) { transition-delay: .08s; } .kpis .kpi:nth-child(4) { transition-delay: .12s; }
  .rise .sf { transform: scaleX(0); transition: transform .5s cubic-bezier(.2, .7, .2, 1) .1s; }
  .rise.in .sf { transform: scaleX(1); }
  .rise svg.chart .line { stroke-dasharray: 1; stroke-dashoffset: 1; }
  .rise.in svg.chart .line { animation: drawline .6s ease-out .1s forwards; }
  .rise svg.chart .area, .rise svg.chart .end { opacity: 0; transition: opacity .3s ease .45s; }
  .rise.in svg.chart .area, .rise.in svg.chart .end { opacity: 1; }
  .rise svg.chart .b { transform-box: fill-box; transform-origin: center bottom; transform: scaleY(0); transition: transform .5s cubic-bezier(.2, .7, .2, 1) .1s; }
  .rise.in svg.chart .b { transform: scaleY(1); }
  .rise svg.ring .seg { opacity: 0; transition: opacity .4s ease .1s; }
  .rise.in svg.ring .seg { opacity: 1; }
  @keyframes drawline { to { stroke-dashoffset: 0; } }
}
/* Enterprise pass (13 Nov): what Purser Cloud is, the Agents and Tokenisation tabs, Invoices & books. */
.what-cloud { margin: 0 0 18px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--sunken); }
.what-cloud p { margin: 0; font-weight: 600; color: var(--text); }
.what-cloud .demo-label { margin-top: 4px; font-weight: 500; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.auth p.what { color: var(--text); }
.agents { display: grid; gap: 16px; margin: 0 0 16px; }
.card.agent { padding: 20px; }
.agent .ah { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: start; margin-bottom: 14px; }
.agent .ah h2 { margin: 0; font-size: 18px; }
.agent .ah p.sub { margin: 2px 0 0; }
.agent .av { width: 40px; height: 40px; border-radius: 10px; background: var(--sunken); display: grid; place-items: center; color: var(--text); }
.ast-wrap { text-align: right; }
.ast { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; font-weight: 650; font-size: 13px; border: 1px solid var(--border); }
.ast.active { color: var(--ok); background: var(--ok-soft); border-color: transparent; }
.ast.paused { color: var(--warn); background: var(--warn-soft); border-color: transparent; }
.ast.revoked { color: var(--bad); background: var(--bad-soft); border-color: transparent; }
.agrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 20px; padding: 14px 0; border-top: 1px solid var(--border); }
.agrid h3, .adec h3 { font-size: 12.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 6px; font-weight: 650; }
.agrid p, .agrid ul { margin: 0; }
.agrid ul.can, .agrid ul.cannot, .agrid ul.pl { list-style: none; padding: 0; display: grid; gap: 6px; }
.agrid ul.can li, .agrid ul.cannot li { display: grid; grid-template-columns: 18px 1fr; gap: 6px; }
.agrid ul.can .ic { color: var(--ok); } .agrid ul.cannot .ic { color: var(--bad); }
.adec { border-top: 1px solid var(--border); padding-top: 14px; }
.adec ul.feed { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.adec ul.feed li { display: grid; grid-template-columns: 96px 1fr; gap: 10px; }
.adec .when { color: var(--muted); } .adec small.by { color: var(--muted); }
.tok { margin: 0 0 16px; }
.tok .th { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.tok .th h2 { margin: 0; display: flex; align-items: center; gap: 6px; }
.rlabel { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-weight: 650; font-size: 12.5px; }
ol.tsteps { margin: 12px 0; padding-left: 20px; display: grid; gap: 10px; }
ol.tsteps ul.txs { list-style: none; padding: 0; margin: 6px 0 0; display: grid; gap: 4px; font-size: 14px; }
ol.tsteps ul.txs li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.tok .ok { color: var(--ok); } .tok .bad { color: var(--bad); }
.tok code { font-size: 13px; word-break: break-all; }
.tok ul.viclist { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 6px; overflow-wrap: anywhere; }
.tok .links { display: flex; flex-wrap: wrap; gap: 12px; margin: 10px 0 0; }
a.ext { display: inline-flex; align-items: center; gap: 4px; }
a.ext .ic svg { width: 13px; height: 13px; }
h2.section-h { margin: 28px 0 12px; font-size: 20px; }
.exports { margin-top: 16px; }
.exports .wrap-row { display: flex; flex-wrap: wrap; gap: 8px; }
.journal-for table td.r, .journal-for table th.r { white-space: nowrap; }
a:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
@media (max-width: 760px) {
  .agrid { grid-template-columns: 1fr; }
  .agent .ah { grid-template-columns: 40px 1fr; }
  .ast-wrap { grid-column: 1 / -1; text-align: left; }
  .adec ul.feed li { grid-template-columns: 1fr; gap: 0; }
}
`;

const nonce = () => {
  const b = crypto.getRandomValues(new Uint8Array(18));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

/** The keys the console's script and HTML ask for by name: always in its catalogue, whatever the prefix rules say. */
const USED = keysUsedIn(SCRIPT + BODY);

/** The console's page: one document, its config in a meta tag (the origin, the passkey RP id, the mail domain, whether the cloud runs an engine). */
export function consolePage(n: string, cfg: { origin: string; rpId: string; mailDomain: string; engine?: boolean }): string {
  // Both languages' words (the console's only) as JSON: the script picks English unless the person chose Dutch.
  const keep = (k: string) => consoleKeys(k as keyof typeof MESSAGES.en) || USED.has(k);
  const cat = (lang: "nl" | "en") => ({ lang, m: Object.fromEntries(Object.entries(MESSAGES[lang]).filter(([k]) => keep(k))), data: lang === "nl" ? DATA_NL : {} });
  const catalogues = JSON.stringify({ nl: cat("nl"), en: cat("en") }).replace(/</g, "\\u003c");
  const script = SCRIPT.replace("__CATALOGUES__", () => catalogues).replace("__I18N__", () => I18N_JS).replace("__EVENT_LINE__", () => EVENT_LINE_JS).replace("__ICONS__", ICON_SET(ICONS));
  return `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${ICON_LINKS}${PREVIEW_TAGS}
<meta name="color-scheme" content="light">
<meta name="purser-cloud" content="${escAttr(JSON.stringify(cfg))}">
<title>Purser Cloud</title>
<style nonce="${n}">${PAYABLES_CSS}${EXTRA_CSS}${SITE_HEADER_CSS}${CLOUD_CSS}</style></head><body class="signed-out">
${BODY}
<script type="module" nonce="${n}">${script}</script>
</body></html>`;
}

/**
 * The frame an invoice's PDF is drawn in (red team round 5): served sandboxed (opaque origin, by its own policy too, so
 * even opened on its own it reaches nothing of this origin), it takes the bytes from the console by postMessage, parses
 * them with pdf.js in a worker (a blob worker that imports this origin's pdf.js; a module worker does not start in an
 * opaque origin), draws up to six pages, and stops
 * after 15 seconds. It has no session and no network but pdf.js itself.
 */
export function pdfViewPage(n: string, origin: string): string {
  const lib = JSON.stringify(`${origin}/assets/pdfjs.mjs`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${n}">html,body{margin:0;background:#fff}canvas{display:block;width:100%;height:auto;margin:0 0 8px}p{font:14px system-ui,sans-serif;color:#555;margin:8px}</style></head><body>
<script type="module" nonce="${n}">
import {getDocument,GlobalWorkerOptions} from ${lib};
const LIMIT_MS=15000,MAX_PAGES=6;
let worker=null,task=null,timer=null,done=false;
const size=()=>parent.postMessage({type:'size',h:document.documentElement.scrollHeight},'*');
function fail(){if(done)return;done=true;try{task&&task.destroy()}catch(e){}try{worker&&worker.terminate()}catch(e){}document.body.textContent='';parent.postMessage({type:'failed'},'*')}
addEventListener('message',async(ev)=>{
  if(ev.source!==parent||done)return;const d=ev.data||{};if(d.type!=='pdf'||!(d.data instanceof ArrayBuffer))return;
  timer=setTimeout(fail,LIMIT_MS);
  worker=new Worker(URL.createObjectURL(new Blob(['import('+JSON.stringify(${lib})+');'],{type:'text/javascript'})));
  try{
    // pdf.js in the worker says it is ready once its import has run; anything sent before that would be lost.
    await new Promise((ok,no)=>{worker.addEventListener('message',ok,{once:true});worker.addEventListener('error',no,{once:true})});
    GlobalWorkerOptions.workerPort=worker;
    task=getDocument({data:new Uint8Array(d.data),isEvalSupported:false,enableXfa:false,useSystemFonts:false,stopAtErrors:false,verbosity:0});
    const doc=await task.promise;
    for(let i=1;i<=Math.min(doc.numPages,MAX_PAGES)&&!done;i++){const page=await doc.getPage(i);const vp=page.getViewport({scale:2});const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;c.setAttribute('aria-label','Page '+i+' of the invoice');document.body.append(c);await page.render({canvasContext:c.getContext('2d'),viewport:vp,canvas:c}).promise;size()}
    if(doc.numPages>MAX_PAGES){const p=document.createElement('p');p.textContent=(doc.numPages-MAX_PAGES)+' more page(s): download the PDF to see them';document.body.append(p)}
    clearTimeout(timer);done=true;size();
  }catch(e){clearTimeout(timer);fail()}
});
parent.postMessage({type:'ready'},'*');
</script></body></html>`;
}

export const pdfViewCsp = (n: string, origin: string) =>
  `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${n}' ${origin}/assets/pdfjs.mjs; worker-src blob:; style-src 'nonce-${n}'; img-src blob: data:; font-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`;

export const consoleCsp = (n: string) =>
  `default-src 'none'; script-src 'nonce-${n}' 'self'; style-src 'nonce-${n}'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`;

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin", "permissions-policy": "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
};

/** Paths people type for the console, and the console route each one opens. */
export const CONSOLE_PATHS: Record<string, string> = { "/sign-in": "#/sign-in", "/signin": "#/sign-in", "/login": "#/sign-in", "/console": "#/sign-in", "/start": "#/start", "/overview": "#/overview" };

let font: Uint8Array | null = null;

/** Everything outside /v1: the console page at /, its font, pdf.js from the bundle's assets, and a plain 404. Only GET and HEAD. */
export async function consoleResponse(req: Request, url: URL, env: CloudEnv): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" } });
  if (url.pathname === "/") {
    const n = nonce();
    return new Response(consolePage(n, { origin: env.origin, rpId: env.rpId, mailDomain: env.mailDomain ?? "", engine: !!env.engine }), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": consoleCsp(n) } });
  }
  if (url.pathname === "/try") return tryPageResponse(req, url, env);
  // The console's pages are routes after "#" (#/sign-in, #/start); a typed or bookmarked path (/sign-in, /login,
  // /console) went to a plain 404 (13 Nov). It goes to the console's own route instead.
  const route = CONSOLE_PATHS[url.pathname.replace(/\/+$/, "") || "/"];
  if (route !== undefined) return new Response(null, { status: 302, headers: { location: `/${route}`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  if (url.pathname === "/pdfview") {
    const n = nonce();
    return new Response(pdfViewPage(n, env.origin), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": pdfViewCsp(n, env.origin) } });
  }
  if (url.pathname === "/assets/inter.woff2") {
    font ??= fromB64(INTER_WOFF2_B64);
    return new Response(new Uint8Array(font), { status: 200, headers: { "content-type": "font/woff2", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  }
  // pdf.js, to draw a supplier's PDF on a canvas in the invoice's page (eval off; the PDF is data, never a page). Only this
  // one path is asked of the assets, whatever the bundle holds.
  if (url.pathname === "/assets/pdfjs.mjs" && env.asset) {
    const r = await env.asset("/assets/pdfjs.mjs");
    if (r && r.ok) return new Response(r.body, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff",
      // Loaded by the sandboxed PDF frame (an opaque origin) and its worker, so it is a CORS fetch: the library is public.
      "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin" } });
  }
  return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
}
