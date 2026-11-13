// The hands-on page at /try: a visitor starts a test company of their own on Purser's real engine, files an invoice
// and watches the engine work. One page with one script under the console's nonce policy (cloud/src/console.ts): no
// inline handlers, no 'unsafe-inline', every value from the API put on the page as text (textContent through el()),
// never as HTML. English only; every word is in cloud/src/tryCopy.ts.
//
// The script, for whoever adds screens 3 to 6:
// - State lives in one object, S ({tenant, session, visitor_token, expires_at, pool, mode, screen, after}), kept in
//   sessionStorage under one key (try/catch: when storage throws it stays in memory only).
// - Screens are registered with screen(name, {heading, band?, draw(box, arg)}) and shown with show(name, arg), which
//   draws the band (after the start), the heading, then the screen, and moves focus to the heading.
// - api(method, path, body) carries the session and renews it once on a 401; renew() is the one renewal
//   (POST /v1/try/session), single-flight; a 410 shows the "gone" screen.
// - The poller (pollStart, pollDone) reads GET /v1/engine/events every 1,000 ms while a request is in flight and once
//   more 1 s after it returned; never while the page is hidden; it stops at its first 401 and renews once; a 429
//   slow_down waits retry_ms.
// - Timers exist for three things only (a test holds this): pollTimer, renewTimer (two minutes before the session
//   ends) and askTimer (the running time of an open Claude call). A request still out after 30 s is seen by the poller's
//   own tick (pollStart's onSlow), which adds one calm line; no other timer.
// - Screens 3 (approve) and 4 (pay) sign and pay: the pure helpers are SIGN_JS (below, tested in Node). Screen 3 pays
//   as signed in the approval's own tap; screen 4 (after paid, from screen 5's link) lets the visitor change the terms.
//   S also keeps the proposal ({id, challenge, terms_sha256, invoice}) and the approval's credential (cred) for screen
//   4, and the pay route's settled answer for screen 5.
// - Screen 5 (books) draws three blocks, each when its own reads return: the payment, this invoice's journal lines and
//   its files (pure helpers: BOOKS_JS, tested in Node); not fed (settled.fed false), the books say they are not in yet;
//   settled.error shows the engine's words and the retry route on the visitor's button. Files fetched with the session
//   open from blob URLs (BLOBS), revoked on the next screen. Screen 6 (company): the export, start again, the runs.
// - Icons are SVG elements made one by one with createElementNS from shape data (src/ui/icons.ts), never from markup.
import { ICON_LINKS, PREVIEW_TAGS } from "./brand.js";
import { consoleCsp } from "./console.js";
import { SITE_HEADER_CSS, SITE_ORIGIN, siteHeader } from "./siteHeader.js";
import { APPROVE, BAND, BOOKS, COMPANY, ENDED, GONE, INVOICE, INVOICE_FIELDS, LIVE, METHOD, PAY, PROPOSAL_FIELDS, RECORDED, START, STEPS, WORK } from "./tryCopy.js";
import { EVENT_LINE_JS } from "./tryEvents.js";
import { AMOUNT_JS } from "./try/amount.js";
import { DID_CSS, DID_KIT_JS, DID_SCREEN_JS, didGlobals } from "./try/books.js";
import { SCENE_CSS, sceneSvg } from "./scene.js";
import { TOKENS } from "../../src/redesign/ui.js";
import { ICONS } from "../../src/ui/icons.js";
import { MORE } from "../../src/ui/payablesKit.js";
import type { CloudEnv } from "./app.js";

/**
 * Recorded real runs on the site (kit11, package.json's homepage): its /runs, for when the demo is busy or paused, and
 * screen 6's dated links to single runs (/runs#<key>, keys and dates from src/redesign/runs.ts, held there by a test).
 */
export const RUNS_URL = `${SITE_ORIGIN}/runs`;
/** The site's proof page (src/redesign/proof.ts, served at /proof on the same origin): screen 6's last link. */
export const PROOF_URL = new URL("/proof", RUNS_URL).href;

const CSS = `${TOKENS.replace("url(assets/inter.woff2)", "url(/assets/inter.woff2)")}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 16px/1.5 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
main { max-width: 560px; margin: 0 auto; padding: 0 var(--gut); }
/* 12 Nov: the page's own brand line gave way to the site's header (cloud/src/siteHeader.ts, its style after this one). */
main { padding-bottom: 56px; overflow-x: clip; }
/* Screen 0 in two zones (the console's sign-in has the same): the illustration (cloud/src/scene.ts) in a band on the
   brand's tokens, the card with the words and the button, the trust line under it. A phone: the site's header, the band,
   the card below. A wide screen: the header across, the band left, the card right, centred. Other screens: neither. */
.hero, .trust { display: none; }
body:has(.screen.start) .hero { display: grid; }
body:has(.screen.start) .trust { display: block; margin: 0 auto; padding: 14px var(--gut) 18px; max-width: 560px; width: 100%; text-align: center; color: var(--faint); font-size: 12.5px; line-height: 1.5; }
body:has(.screen.start) main { width: calc(100% - 2 * var(--gut)); max-width: 560px; margin: -28px auto 0; position: relative; z-index: 1; padding: 22px 22px 22px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); }
body:has(.screen.start) h1 { margin-top: 0; }
body:has(.screen.start) { display: flex; flex-direction: column; min-height: 100vh; min-height: 100svh; }
body:has(.screen.start) .hero { flex: 1 0 auto; min-height: 40vh; min-height: 40svh; padding: 16px 12px 40px; }
body:has(.screen.start) .trust { margin-top: auto; }
.start .lede { margin: 0 0 18px; font-size: 16.5px; }
.start .btn.big { margin-top: 0; width: 100%; }
.start .btn .i { vertical-align: 0; }
.start .fine { margin: 12px 0 0; font-size: 13px; color: var(--muted); text-align: center; }
@media (min-width: 1024px) {
  body:has(.screen.start) { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr auto auto 1fr; }
  body:has(.screen.start) header.top { grid-column: 1 / -1; grid-row: 1; }
  body:has(.screen.start) .hero { grid-column: 1; grid-row: 2 / -1; height: calc(100vh - 65px); position: sticky; top: 65px; padding: 40px 48px 48px; }
  body:has(.screen.start) main { grid-column: 2; grid-row: 3; width: calc(100% - 96px); max-width: 500px; margin: 0 auto; padding: 36px 36px 32px; }
  body:has(.screen.start) .trust { grid-column: 2; grid-row: 4; max-width: 500px; padding: 18px 0 0; margin: 0 auto; }
  body:has(.screen.start) h1 { font-size: 32px; }
}
h1 { font-size: 28px; line-height: 1.15; letter-spacing: -.02em; margin: 20px 0 12px; }
h1:focus { outline: none; }
p { margin: 0 0 12px; }
.lede { color: var(--muted); font-size: 17px; }
.muted { color: var(--muted); }
.band { display: flex; flex-wrap: wrap; gap: 2px 8px; margin: 8px 0 0; padding: 8px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--muted); font-size: 13px; }
.band .mode { color: var(--text); font-weight: 600; }
.band .mode.live { color: var(--claude); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 16px; border-radius: 999px; font: 650 15px/1.2 Inter, system-ui, sans-serif; text-decoration: none; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn.big { min-height: 52px; padding: 0 24px; font-size: 16px; margin-top: 8px; }
.btn:disabled, .btn[aria-disabled="true"] { opacity: .55; cursor: progress; }
.btn.skel { min-height: 46px; border-radius: 14px; border-color: transparent; background: linear-gradient(90deg, var(--sunken) 0%, var(--border) 50%, var(--sunken) 100%) 0 0 / 200% 100%; animation: shimmer 1.3s linear infinite; }
.btn:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.link { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
a { color: var(--accent); }
main .tabs { display: flex; gap: 4px; padding: 4px; margin: 4px 0 16px; background: var(--sunken); border-radius: 999px; }
main .tabs button { flex: 1; min-height: 40px; border: 0; border-radius: 999px; background: none; color: var(--muted); font: 600 15px/1.2 Inter, system-ui, sans-serif; cursor: pointer; }
main .tabs button[aria-selected="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
.samples { display: grid; gap: 8px; }
.samples .btn { justify-content: flex-start; text-align: left; border-radius: 14px; padding: 12px 16px; font-weight: 600; }
.samples .btn[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
.panel + .panel + .btn.big { margin-top: 16px; }
form { display: grid; gap: 12px; }
.f { display: grid; gap: 4px; min-width: 0; align-content: start; }
.f label { font-size: 13px; font-weight: 600; color: var(--muted); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
input, select { width: 100%; min-width: 0; height: 46px; padding: 0 12px; font: 400 16px/1.2 Inter, system-ui, sans-serif; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .02em; }
.hint { font-size: 14px; color: var(--muted); margin: 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); padding: 16px; }
.live { list-style: none; margin: 0; padding: 0; }
.live li { display: grid; grid-template-columns: 1fr auto; gap: 0 12px; padding: 8px 0; border-top: 1px solid var(--border); font-size: 14px; line-height: 1.4; }
.live li:first-child { border-top: 0; }
.live:not(.open) li.fold, .live:not(.open) li.past { display: none; }
.live .who { font-weight: 650; }
.live .claude .who { color: var(--claude); }
.live .money .who { color: var(--ok); }
.live .sign .who { color: var(--accent); }
.live .what { grid-column: 1; color: var(--muted); overflow-wrap: anywhere; }
.live .agent .what { color: var(--text); }
.live .own { color: var(--muted); font-style: italic; }
.live .ownw, .live .enf { color: var(--faint); font-size: 12.5px; }
.live .enf { grid-column: 1; }
.live .t { grid-column: 2; grid-row: 1 / span 2; color: var(--faint); font-variant-numeric: tabular-nums; font-size: 13px; }
.steps { margin-top: 4px; font-size: 14px; }
.result { margin-top: 20px; }
.card[hidden]:first-child + .result { margin-top: 0; }
.result .big { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
.result .ok { color: var(--ok); }
.result .bad { color: var(--bad); }
.result ul { margin: 0 0 12px; padding-left: 20px; }
.note { padding: 12px 14px; border-radius: 12px; background: var(--bad-soft); color: var(--text); }
details { margin: 12px 0; }
details summary { cursor: pointer; color: var(--muted); font-size: 14px; }
dl.read { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 8px 0 0; font-size: 14px; }
dl.read dt { color: var(--muted); }
dl.read dd { margin: 0; overflow-wrap: anywhere; }
/* The rail of the seven steps, on top of every screen after the start: a dot per step on one line, the steps done
   filled, the current one lit with a halo and its name beside the rail. */
.progw { display: flex; align-items: center; gap: 12px; margin: 6px 0 10px; }
.prog { flex: 1; display: flex; list-style: none; margin: 0; padding: 0; }
.prog li { flex: 1; display: grid; place-items: center; height: 16px; background: linear-gradient(var(--border), var(--border)) center / 100% 2px no-repeat; }
.prog li:first-child { background-size: 50% 2px; background-position: right center; }
.prog li:last-child { background-size: 50% 2px; background-position: left center; }
.prog li::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border); }
.prog li.done { background-image: linear-gradient(var(--accent), var(--accent)); }
.prog li.done::before { background: var(--accent); border-color: var(--accent); }
.prog li.on::before { width: 13px; height: 13px; background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 22%, transparent); }
.stepname { font-size: 12.5px; font-weight: 700; color: var(--accent); white-space: nowrap; }
/* Screens 1 to 6 in the start's look: the brand's band behind the top of the page, each screen in a soft card that
   slides in; a card inside it is a quiet panel. */
body:not(:has(.screen.start)) { background: radial-gradient(70% 300px at 8% 0, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%) no-repeat, linear-gradient(180deg, var(--accent-soft), var(--bg) 360px) no-repeat, var(--bg); }
.screen:not(.start) { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); padding: 20px; }
.screen:not(.start) .card { background: var(--bg); box-shadow: none; border-radius: 14px; }
main > h1 { animation: slide .34s cubic-bezier(.2,.7,.2,1) both; }
.screen { animation: slide .34s cubic-bezier(.2,.7,.2,1) .04s both; }
@keyframes slide { from { opacity: .01; transform: translateX(18px); } }
@keyframes rise { from { opacity: .01; transform: translateY(6px); } }
@keyframes litrow { 0% { opacity: .01; background: transparent; } 35% { opacity: 1; background: var(--accent-soft); } 100% { background: transparent; } }
@keyframes ring { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent); } 100% { box-shadow: 0 0 0 16px transparent; } }
@keyframes shake { 0%, 100% { transform: none; } 20% { transform: translateX(-7px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(2px); } }
@keyframes glow { from { box-shadow: 0 0 0 3px color-mix(in srgb, var(--bad) 14%, transparent); } to { box-shadow: 0 0 0 6px color-mix(in srgb, var(--bad) 24%, transparent); } }
@keyframes stampin { 0% { opacity: .01; transform: scale(1.18) rotate(-4deg); } 100% { opacity: 1; transform: none; } }
@keyframes slidein { from { opacity: .01; transform: translateX(-10px); } }
/* Screen 2: the invoice as the engine's answer has it, its rows lit one by one once the answer is in. */
.inv { margin: 14px 0 4px; padding: 14px 16px; }
/* Screen 2 while the request is in flight: who reads (with the open call's running time), and the card's skeleton. */
.reading { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--muted); font-size: 15px; }
.reading .n { color: var(--faint); font-variant-numeric: tabular-nums; font-size: 13px; }
.reading .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
.inv.skel .rows > div { animation: none; }
.inv.skel .sk { display: inline-block; width: 7.5em; max-width: 100%; height: .9em; border-radius: 6px; vertical-align: middle;
  background: linear-gradient(90deg, var(--sunken) 0%, var(--border) 50%, var(--sunken) 100%) 0 0 / 200% 100%; animation: shimmer 1.3s linear infinite; }
.inv.skel .rows > div:nth-child(2) .sk { width: 5em; } .inv.skel .rows > div:nth-child(3) .sk { width: 6em; } .inv.skel .rows > div:nth-child(4) .sk { width: 5.5em; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@keyframes pulse { 50% { opacity: .35; } }
/* A calm word under a field or the form: the danger tone, muted, never a red box. */
/* The supplier and the IBAN while the suppliers load: a shimmering field, nothing in it. */
.f.loading input, .f.loading select { color: transparent; background: linear-gradient(90deg, var(--sunken) 0%, var(--border) 50%, var(--sunken) 100%) 0 0 / 200% 100%; animation: shimmer 1.3s linear infinite; }
.hint.calm { margin: 6px 0 0; color: color-mix(in srgb, var(--bad) 70%, var(--muted)); font-size: 13.5px; }
.inv .ih { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 6px; font-weight: 650; font-size: 15px; }
.inv .ih .i { color: var(--accent); }
.inv .rows { margin: 0; }
.inv .rows > div { display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 7px 8px; margin: 0 -8px; border-radius: 8px; font-size: 14px; animation: litrow .9s ease-out both; }
.inv .rows dt { color: var(--muted); }
.inv .rows dd { margin: 0; text-align: right; font-weight: 600; overflow-wrap: anywhere; }
.inv .rows > div:nth-child(2) { animation-delay: .18s; } .inv .rows > div:nth-child(3) { animation-delay: .36s; } .inv .rows > div:nth-child(4) { animation-delay: .54s; } .inv .rows > div:nth-child(5) { animation-delay: .72s; }
.chip { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 650; background: var(--claude-soft); color: var(--claude); animation: rise .3s ease-out both; }
.chip .mono { font-weight: 500; opacity: .85; }
/* Screen 3: the terms as a receipt, the hash in a mono pill; a ring round the button while a step runs (the passkey
   prompt, saving it, the approval; screen 4's pay too), a tick as soon as the approval is back. */
.receipt { margin: 4px 0 12px; padding: 16px; border-radius: 14px; background: var(--bg); border: 1px solid var(--border); }
.receipt .amount { margin: 0 0 8px; }
.receipt dl.read { gap: 0; margin: 0; }
.receipt dl.read dt, .receipt dl.read dd { padding: 8px 0; border-top: 1px dashed var(--border); }
.receipt dl.read dd { text-align: right; font-weight: 600; }
.hashpill { display: inline-block; margin: 10px 0 0; padding: 3px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; }
.btn.asking { animation: ring 1.3s ease-out infinite; }
.tick { display: flex; align-items: center; gap: 8px; color: var(--ok); font-weight: 700; }
.tick .i { animation: pop .5s ease-out both; }
/* Screen 4: a field that differs from the signed value glows; the refusal shakes once and says the transfers in big type. */
.f.changed input { border-color: var(--bad); animation: glow 1.2s ease-in-out infinite alternate; }
.refusal.shake { animation: shake .5s ease-in-out both; }
.proof.xfer { margin: 6px 0 4px; font-size: 26px; line-height: 1.2; font-weight: 750; color: var(--text); font-variant-numeric: tabular-nums; }
/* Screen 5: a calm stamp, the terms' hash, the books' lines sliding in. */
.paidstamp { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 2px 0 6px; }
.paidstamp .ring { display: inline-grid; place-items: center; width: 60px; height: 60px; border-radius: 50%; border: 2.5px solid var(--ok); background: var(--ok-soft); color: var(--ok); animation: stampin .45s cubic-bezier(.2,.9,.3,1.15) both; }
/* The stamp is the first thing screen 5 shows once the pay answer is in: the screen does not slide, the stamp lands. */
.screen:has(> .paidstamp) { animation: none; }
.paidstamp .hashpill { margin: 0; }
table.lines tbody tr { animation: slidein .4s ease-out both; }
table.lines tbody tr:nth-child(2) { animation-delay: .08s; } table.lines tbody tr:nth-child(3) { animation-delay: .16s; } table.lines tbody tr:nth-child(4) { animation-delay: .24s; }
table.lines tbody tr:nth-child(5) { animation-delay: .32s; } table.lines tbody tr:nth-child(6) { animation-delay: .4s; } table.lines tbody tr:nth-child(n+7) { animation-delay: .48s; }
/* Screen 6: what the visit did, three icons; the site's proof page. */
ul.did { list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 0 0 14px; padding: 0; }
ul.did li { display: grid; justify-items: center; gap: 6px; padding: 14px 6px; border-radius: 14px; background: var(--bg); border: 1px solid var(--border); font-weight: 650; font-size: 14px; animation: rise .4s ease-out both; }
ul.did li:nth-child(2) { animation-delay: .12s; } ul.did li:nth-child(3) { animation-delay: .24s; }
ul.did .dic { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: var(--ok-soft); color: var(--ok); }
a.proofl { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; text-decoration: none; }
.i { flex: none; vertical-align: -3px; }
.art { display: inline-grid; place-items: center; width: 56px; height: 56px; border-radius: 18px; background: var(--accent-soft); color: var(--accent); margin: 4px 0 8px; }
.art.ok { background: var(--ok-soft); color: var(--ok); }
.art.pop { animation: pop .5s ease-out; }
@keyframes pop { 0% { transform: scale(.6); opacity: .01; } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
.amount { font-size: 40px; line-height: 1.1; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; margin: 4px 0 12px; overflow-wrap: anywhere; }
.short { margin: 12px 0 0; font-size: 13px; color: var(--muted); }
pre.terms { margin: 8px 0 0; padding: 12px; border-radius: 12px; background: var(--sunken); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.f.big input { height: 60px; font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.outcome { margin-top: 16px; }
.stamp { display: inline-block; margin: 0 0 10px; padding: 2px 10px; border: 2px solid var(--bad); border-radius: 8px; color: var(--bad); font-weight: 750; font-size: 17px; letter-spacing: .02em; }
.layer { margin: 0 0 6px; font-size: 15px; }
.hash { margin: 0; font-size: 12px; line-height: 1.6; color: var(--faint); overflow-wrap: anywhere; }
.hash .hl { display: inline-block; min-width: 52px; color: var(--muted); font-family: Inter, system-ui, sans-serif; font-weight: 600; }
.hash mark { background: none; color: var(--text); font-weight: 600; }
.verdict { margin: 12px 0 8px; font-weight: 650; }
.proof { margin: 0; font-size: 14px; color: var(--muted); }
pre.raw { margin: 8px 0 0; padding: 12px; border-radius: 12px; background: var(--sunken); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.slot:empty { display: none; }
.blk { margin: 12px 0 0; animation: rise .24s ease-out; }
.blk .bh { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-weight: 650; font-size: 15px; }
.blk .bh.ok .i { color: var(--ok); }
.blk .bh.bad .i { color: var(--bad); }
.blk .amount { margin: 4px 0 6px; }
.pill { display: inline-block; padding: 1px 10px; border-radius: 999px; font-size: 13px; font-weight: 650; letter-spacing: .02em; background: var(--sunken); color: var(--muted); }
.pill.ok { background: var(--ok-soft); color: var(--ok); }
.pill.bad { background: var(--bad-soft); color: var(--bad); }
.wait { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; color: var(--muted); font-size: 15px; }
.scroll { overflow-x: auto; }
table.lines { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
table.lines th { text-align: left; font-size: 12px; font-weight: 600; color: var(--muted); padding: 4px 0; }
table.lines td { padding: 4px 0; border-top: 1px solid var(--border); white-space: nowrap; }
table.lines td.en { padding-top: 10px; color: var(--muted); font-size: 13px; white-space: normal; overflow-wrap: anywhere; }
table.lines .r { text-align: right; padding-left: 12px; }
.bal { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; font-weight: 650; font-size: 14px; }
.bal.ok { color: var(--ok); }
.bal.bad { color: var(--bad); }
ul.files, ul.runs { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 8px; }
a.file { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; text-decoration: none; color: var(--text); }
a.file .i { grid-row: 1 / span 2; color: var(--accent); }
a.file .fl { font-weight: 650; }
a.file .fn { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 16px; }
.acts .btn.big { margin-top: 0; }
ul.runs a { display: grid; padding: 8px 0; text-decoration: none; }
ul.runs .rt { color: var(--text); font-weight: 600; }
ul.runs .rd { font-size: 13px; color: var(--muted); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 520px) { .btn.big { width: 100%; } h1 { font-size: 26px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
`;

/**
 * The page's pure helpers for signing and paying (screens 3 and 4), as plain script: the page carries this text as it
 * is, and test/try-page.test.ts runs the same text in Node. No DOM, no clock, no network.
 * - b64u, fromB64u: base64url, as WebAuthn's ArrayBuffers go to the API and come back.
 * - registrationOf, signedOf: a new passkey and a passkey's signature as @simplewebauthn/server reads them (copied from
 *   the console's credOf, registrationOf and signedOf, the same as src/approve/client.ts serializeRegistration and
 *   serializeAssertion).
 * - hashDiff(a, b): each hash as runs of [text, differs], every character where the two differ marked.
 * - normAmount(raw, like?): an amount as people write it (10k, 10.000, € 10.000,00, 1850,01 ...), in like's format,
 *   or null: normaliseAmount, cloud/src/try/amount.ts, embedded by its own source (one implementation for screens 1
 *   and 4 and the compose route).
 * - payBody(terms, values, credential): the pay route's body: the stored terms with the three fields' values written in,
 *   and the kept credential; nothing else.
 * - changedFields, verdict: what changed, from the signed and the sent values (the route's `changed` is lane C's: an
 *   array of field names or of {field, from, to}; only its field names are read, the values are the page's own).
 * - methodOf(M, ua): the device's word for its passkey, by a simple guess from the platform.
 */
export const SIGN_JS = String.raw`
const signKit=(()=>{
  const b64u=(buf)=>{let s='';for(const b of new Uint8Array(buf))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
  const fromB64u=(s)=>{const n=String(s).replace(/-/g,'+').replace(/_/g,'/');const bin=atob(n+'==='.slice((n.length+3)%4));return Uint8Array.from(bin,(c)=>c.charCodeAt(0))};
  const credOf=(c,response)=>Object.assign({id:c.id,rawId:b64u(c.rawId),type:c.type,response:response,clientExtensionResults:c.getClientExtensionResults()},c.authenticatorAttachment?{authenticatorAttachment:c.authenticatorAttachment}:{});
  const registrationOf=(c)=>{const r=c.response;return credOf(c,{clientDataJSON:b64u(r.clientDataJSON),attestationObject:b64u(r.attestationObject),transports:typeof r.getTransports==='function'?r.getTransports():[]})};
  const signedOf=(c)=>{const r=c.response;return credOf(c,Object.assign({clientDataJSON:b64u(r.clientDataJSON),authenticatorData:b64u(r.authenticatorData),signature:b64u(r.signature)},r.userHandle?{userHandle:b64u(r.userHandle)}:{}))};
  const hashDiff=(a,b)=>{
    const runs=(s,o)=>{const out=[];for(let i=0;i<s.length;i++){const d=s[i]!==o[i];const last=out[out.length-1];if(last&&last[1]===d)last[0]+=s[i];else out.push([s[i],d])}return out};
    a=String(a);b=String(b);return {a:runs(a,b),b:runs(b,a)};
  };
  ${AMOUNT_JS}
  const normAmount=normaliseAmount;
  const FIELDS=['amount','beneficiary_name','iban_last4'];
  const payBody=(terms,v,credential)=>{const t=Object.assign({},terms);for(const k of FIELDS)t[k]=v[k];return {terms:t,credential:credential}};
  const changedFields=(signed,sent,changed)=>{
    const named=Array.isArray(changed)?changed.map((x)=>typeof x==='string'?x:x&&typeof x.field==='string'?x.field:'').filter(Boolean):null;
    const differ=FIELDS.filter((k)=>String(signed[k])!==String(sent[k]));
    return named?FIELDS.filter((k)=>named.indexOf(k)>=0&&differ.indexOf(k)>=0):differ;
  };
  const cents=(s)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(s));return m?Number(m[1])*100+Number(m[2]):null};
  const verdict=(W,signed,sent,changed)=>{
    const out=[];
    for(const k of changedFields(signed,sent,changed)){
      if(k==='amount'){const a=cents(signed.amount),b=cents(sent.amount);out.push(a!==null&&b!==null&&Math.abs(a-b)===1?W.vAmountCent:W.vAmount.replace('{from}',String(signed.amount)).replace('{to}',String(sent.amount)))}
      else if(k==='beneficiary_name')out.push(W.vPayee);else out.push(W.vAccount);
    }
    if(!out.length)out.push(W.vOther);
    return out.join(' ')+' '+W.vCover;
  };
  const methodOf=(M,ua)=>/iPhone|iPad|iPod/.test(ua)?M.ios:/Android/.test(ua)?M.android:/Macintosh|Mac OS X/.test(ua)?M.mac:/Windows/.test(ua)?M.windows:M.other;
  return {b64u,fromB64u,registrationOf,signedOf,hashDiff,normAmount,payBody,changedFields,verdict,methodOf};
})();
`;

/**
 * The page's pure helpers for screen 5, as plain script (the page carries this text as it is; test/try-page.test.ts runs
 * the same text in Node). This invoice's part of what the read model and the archive hold, by the console's rules
 * (engine-console-1112, cloud/src/console.ts paymentOf, booked and filesOf), ported here:
 * - paymentOf(i, payments, txs): the payment the transactions register links to this invoice's own id (its row
 *   'transfer:<payment id>' with invoice.ap_id), a PAID one first; else the single PAID payment of this invoice's
 *   number, supplier, currency and amount; else null. Two invoices may share a number and a supplier; the read model
 *   links a payment by "<invoice no> · <supplier>", so only the register's id tells them apart.
 * - isPaid(p): its status is PAID (a FAILED payment is never shown as paid). feeOf(p, tx): the fee the payment reports,
 *   else the register's.
 * - entriesOf(i, p, txs, entries): the accrual on receipt (source_key 'ap-accrual|<id>', any version '@v<n>'), the
 *   payment's entries as the register books them (booking.entry_ids) and every entry that reverses one of those.
 * - balance(entries): debits equal credits per currency, summed from the lines. headOf(entries): the newest entry of
 *   the whole ledger (its own entry_hash is the chain's head; a session cannot ask /v1/sync/state).
 * - filesOf(i, files, invoices): the original by its own hash (doc_sha256), and the receipt by the name the archive
 *   gives it: '<date> <supplier> <invoice no>.pdf' cleaned as one piece (src/vault/layout.ts paymentPath, safeSegment;
 *   seg here), a correction beside it ' (correctie[ n])', or this invoice's own id beside it when another document had
 *   the name first (layout.ts withId). The plain name is taken as this invoice's only when no other paid invoice of the
 *   same number and supplier could have it.
 * - money(currency, amount), fromCents(n): amounts as the page shows them.
 */
export const BOOKS_JS = String.raw`
const booksKit=(()=>{
  const seg=(s)=>{let v=String(s||'').normalize('NFC').replace(/\p{Cf}/gu,'').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g,' ').replace(/\.{2,}/g,' ').replace(/\s+/g,' ').trim().replace(/^[.\s]+|[.\s]+$/g,'');if(v.length>120)v=v.slice(0,120).replace(/[.\s]+$/g,'');return v||'_'};
  const fileName=(p)=>String(p).slice(String(p).lastIndexOf('/')+1);
  const toCents=(s)=>{const m=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(s==null?'':s).trim());return m?(m[1]?-1:1)*(Number(m[2])*100+Number((m[3]||'').padEnd(2,'0'))):null};
  const fromCents=(n)=>{const c=Math.round(Number(n)||0),a=Math.abs(c);return (c<0?'-':'')+Math.floor(a/100)+'.'+String(a%100).padStart(2,'0')};
  const money=(cur,amount)=>{const c=toCents(amount);if(c===null)return [cur,amount].filter(Boolean).join(' ');const s=fromCents(c),neg=s[0]==='-',t=neg?s.slice(1):s,dot=t.indexOf('.');
    return [cur,(neg?'-':'')+t.slice(0,dot).replace(/\B(?=(\d{3})+(?!\d))/g,',')+t.slice(dot)].filter(Boolean).join(' ')};
  const isPaid=(p)=>!!p&&String(p.status||'').toUpperCase()==='PAID';
  const txOf=(p,txs)=>p?(txs||[]).find((y)=>y&&y.id==='transfer:'+p.id)||null:null;
  const paymentOf=(i,ps,txs)=>{
    if(!i)return null;
    const same=(ps||[]).filter((x)=>x&&x.invoice_no===i.invoice_no+' · '+i.vendor);
    const byId=same.filter((x)=>{const y=txOf(x,txs);return !!(y&&y.invoice&&y.invoice.ap_id===i.id)}).sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at)));
    if(byId.length){const ok=byId.filter(isPaid);return (ok.length?ok:byId)[(ok.length?ok:byId).length-1]}
    const sure=same.filter((x)=>isPaid(x)&&x.currency===i.currency&&toCents(x.amount)!==null&&toCents(x.amount)===toCents(i.total));
    return sure.length===1?sure[0]:null;
  };
  const feeOf=(p,tx)=>{const m=/^([A-Z]{3,4}) (-?\d+\.\d{2})$/.exec(String(p&&p.fee_actual||''));if(m)return {currency:m[1],amount:m[2]};
    return tx&&tx.fee&&typeof tx.fee.amount==='string'?{currency:String(tx.fee.currency||''),amount:tx.fee.amount}:null};
  const entriesOf=(i,p,txs,es)=>{
    const tx=txOf(p,txs);const ids=new Set(tx&&tx.booking&&Array.isArray(tx.booking.entry_ids)?tx.booking.entry_ids:[]);
    const all=(es||[]).filter(Boolean);
    const mine=all.filter((e)=>String(e.source_key||'').split('@')[0]==='ap-accrual|'+i.id||ids.has(e.entry_id));
    const have=new Set(mine.map((e)=>e.entry_id));
    for(const e of all)if(e.reverses!==null&&e.reverses!==undefined&&have.has(e.reverses)&&!have.has(e.entry_id)){mine.push(e);have.add(e.entry_id)}
    return mine.sort((a,b)=>a.entry_id-b.entry_id);
  };
  const balance=(es)=>{const dr={},cr={};let lines=0;
    for(const e of es||[])for(const l of e.lines||[]){lines++;dr[l.currency]=(dr[l.currency]||0)+(Number(l.debit_cents)||0);cr[l.currency]=(cr[l.currency]||0)+(Number(l.credit_cents)||0)}
    return {even:lines>0&&Object.keys(Object.assign({},dr,cr)).every((c)=>(dr[c]||0)===(cr[c]||0)),lines}};
  const headOf=(es)=>(es||[]).reduce((h,e)=>e&&(!h||e.entry_id>h.entry_id)?e:h,null);
  const filesOf=(i,files,invoices)=>{
    const fs=(files||[]).filter((f)=>f&&typeof f.path==='string');
    const original=fs.find((f)=>f.kind==='invoice'&&!!i.doc_sha256&&f.sha256===i.doc_sha256)||null;
    const own=[],plain=[];
    for(const f of fs){if(f.kind!=='receipt')continue;
      const n=fileName(f.path),d=n.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d))continue;
      const want=seg(d+' '+i.vendor+' '+i.invoice_no+'.pdf');const base=/\.pdf$/.test(want)?want.slice(0,-4):null;
      if(base!==null&&n===base+' ('+seg(i.id)+').pdf')own.push(f);
      else if(n===want||(base!==null&&n.indexOf(base)===0&&/^ \(correctie(?: \d+)?\)\.pdf$/.test(n.slice(base.length))))plain.push(f)}
    // Another paid invoice of this number and supplier, without a receipt of its own id: the plain name may be its.
    const rival=(invoices||[]).some((o)=>o&&o.id!==i.id&&o.vendor===i.vendor&&o.invoice_no===i.invoice_no&&String(o.status)==='paid'
      &&!fs.some((f)=>f.kind==='receipt'&&fileName(f.path).endsWith(' ('+seg(o.id)+').pdf')));
    const receipts=(own.length?own:rival?[]:plain).sort((a,b)=>a.path.localeCompare(b.path));
    return {original,receipts};
  };
  return {seg,fileName,toCents,fromCents,money,isPaid,txOf,paymentOf,feeOf,entriesOf,balance,headOf,filesOf};
})();
`;

// The client: plain JS (no template literals in it, so it sits in this file as a raw string).
const SCRIPT = String.raw`
const C=__COPY__;
const W=C.live;
__EVENT_LINE__
__SIGN__
__BOOKS__
const {fromB64u,registrationOf,signedOf,hashDiff,normAmount,payBody,verdict,methodOf}=signKit;
const IC=__ICONS__;
const lineOf=eventLineOf(W);
const CFG=JSON.parse(document.querySelector('meta[name=purser-try]').content);
const RUNS=__RUNS__;
const PROOF=__PROOF__;
const $=(s)=>document.querySelector(s);
const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
const btn=(label,main)=>{const b=el('button','btn'+(main?' primary big':''),label);b.type='button';return b};
const fill=(s,v)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??''));
const secs=(ms)=>(Math.max(0,ms)/1000).toFixed(1);
const say=(text)=>{$('#say').textContent=text};
const note=(text)=>el('p','note',text);
const words=(j,fallback)=>typeof j.message==='string'&&j.message?j.message:typeof j.error==='string'&&j.error?j.error:fallback;
// An icon: an SVG element made here from shape data, one element at a time.
function icon(name,size){
  const s=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [k,v] of [['viewBox','0 0 24 24'],['width',size],['height',size],['fill','none'],['stroke','currentColor'],['stroke-width','1.75'],['stroke-linecap','round'],['stroke-linejoin','round'],['aria-hidden','true'],['class','i']])s.setAttribute(k,String(v));
  for(const [tag,a] of IC[name]||[]){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const k of Object.keys(a))e.setAttribute(k,a[k]);s.append(e)}
  return s;
}

// The brand's mark comes with the site's header (cloud/src/siteHeader.ts, 12 Nov), drawn on the server.

// The token from the link (#e=… or #j=…): read once, taken out of the address bar at once, and sent only in the start
// request's body.
const TOKEN=(()=>{const m=/^#([ej])=([A-Za-z0-9_.~-]{1,256})$/.exec(location.hash);if(location.hash)history.replaceState(null,'',location.pathname+location.search);return m?m[2]:null})();

// The state: one object, kept in this tab (sessionStorage), or in memory only where storage throws.
const KEY='purser.try';
const KEEP=['tenant','session','visitor_token','expires_at','pool','mode','screen','after','proposal','cred','settled'];
const S={tenant:null,session:null,visitor_token:null,expires_at:null,pool:null,mode:null,screen:null,after:0,proposal:null,cred:null,settled:null};
const save=()=>{const o={};for(const k of KEEP)o[k]=S[k];try{sessionStorage.setItem(KEY,JSON.stringify(o))}catch(e){}};
const restore=()=>{try{const o=JSON.parse(sessionStorage.getItem(KEY)||'null');if(o&&typeof o==='object')for(const k of KEEP)if(o[k]!==undefined)S[k]=o[k]}catch(e){}};
const forget=()=>{for(const k of KEEP)S[k]=k==='after'?0:null;try{sessionStorage.removeItem(KEY)}catch(e){}};
const tenantId=()=>typeof S.tenant==='string'?S.tenant:S.tenant&&S.tenant.id;

// One request with the session. Status 0: no answer came. text: the answer exactly as it came (the raw answer's fold).
async function call(method,path,body){
  const headers={};if(S.session)headers.authorization='Bearer '+S.session;if(body!==undefined)headers['content-type']='application/json';
  let r;try{r=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})}catch(e){return {status:0,json:{},text:''}}
  let text='';try{text=await r.text()}catch(e){}
  let json={};try{json=JSON.parse(text)}catch(e){}
  return {status:r.status,json:json&&typeof json==='object'?json:{},text};
}
// The same, renewing the session once when it answers 401.
async function api(method,path,body){
  const r=await call(method,path,body);
  if(r.status!==401||!S.session)return r;
  return (await renew())?call(method,path,body):r;
}

// The session: renewed two minutes before it ends, and when the page comes back into view (before any poll).
let renewTimer=null;let renewing=null;
const due=()=>!!S.expires_at&&Date.parse(S.expires_at)-Date.now()<120000;
function armRenewal(){clearTimeout(renewTimer);renewTimer=null;if(!S.expires_at)return;
  renewTimer=setTimeout(()=>{renewTimer=null;if(!document.hidden)renew()},Math.min(2147483000,Math.max(0,Date.parse(S.expires_at)-Date.now()-120000)))}
function renew(){if(!renewing)renewing=renewOnce().finally(()=>{renewing=null});return renewing}
async function renewOnce(){
  if(!tenantId()||!S.visitor_token){ended('ended');return false}
  const r=await call('POST','/v1/try/session',{tenant_id:tenantId(),visitor_token:S.visitor_token});
  if(r.status===200&&typeof r.json.session==='string'){S.session=r.json.session;S.expires_at=r.json.expires_at||null;save();armRenewal();return true}
  if(r.status===0)return false;
  ended(r.status===410?'gone':'ended');return false;
}
function ended(name){pollStop();clearTimeout(renewTimer);renewTimer=null;forget();show(name)}

// The live panel's polling: every second while a request is in flight, once more a second after it returned.
let pollTimer=null;
const P={on:false,inflight:false,final:false,busy:false,waiting:false,renewed:false,onEvents:null,onSlow:null,t0:0};
const SLOW_MS=30000;
function pollLater(ms){clearTimeout(pollTimer);pollTimer=setTimeout(pollTick,ms)}
// onSlow (optional): called once, from a poll's tick, when the request is still out after SLOW_MS.
function pollStart(onEvents,onSlow){P.on=true;P.inflight=true;P.final=false;P.renewed=false;P.waiting=false;P.onEvents=onEvents;P.onSlow=onSlow||null;P.t0=performance.now();pollLater(1000)}
function pollDone(){P.inflight=false;P.final=true;if(P.on&&!P.busy&&!P.waiting)pollLater(1000)}
function pollStop(){P.on=false;P.waiting=false;clearTimeout(pollTimer);pollTimer=null}
async function pollTick(){
  pollTimer=null;
  if(!P.on)return;
  if(document.hidden){P.waiting=true;return}
  P.waiting=false;
  if(P.inflight&&P.onSlow&&performance.now()-P.t0>=SLOW_MS){const f=P.onSlow;P.onSlow=null;f()}
  const last=!P.inflight;if(last)P.final=false;
  P.busy=true;
  const r=await call('GET','/v1/engine/events?after='+encodeURIComponent(S.after||0)+'&limit=200');
  P.busy=false;
  if(!P.on)return;
  if(r.status===401){
    // Stop at the first 401 and renew once; a second 401 after that ends the visit.
    P.on=false;
    if(P.renewed){ended('ended');return}
    P.renewed=true;
    if(!(await renew()))return;
    P.on=true;pollLater(0);return;
  }
  if(r.status===429&&r.json.code==='slow_down'){pollLater(Math.min(30000,Math.max(250,Number(r.json.retry_ms)||1000)));return}
  if(r.status===200&&Array.isArray(r.json.items)){
    const items=r.json.items.filter((e)=>e&&typeof e.seq==='number'&&e.seq>(S.after||0));
    if(typeof r.json.next==='number'&&r.json.next>=(S.after||0))S.after=r.json.next;else if(items.length)S.after=items[items.length-1].seq;
    save();
    if(items.length&&P.onEvents)P.onEvents(items);
  }
  if(P.inflight||P.final)pollLater(1000);else if(last)pollStop();
}
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden||!S.session)return;
  if(due()&&!(await renew()))return;
  if(P.on&&P.waiting){P.waiting=false;pollLater(0)}
});

// The running time of an open Claude call, counted in the browser from the moment its row arrived.
let askTimer=null;const OPEN=new Map();
function askTick(){const now=performance.now();for(const o of OPEN.values())o.span.textContent=secs(now-o.t0)+' s'}
function askOpen(key,span){OPEN.set(key,{span,t0:performance.now()});askTick();if(!askTimer)askTimer=setInterval(askTick,200)}
function askClose(key){if(OPEN.has(key)){askTick();OPEN.delete(key)}if(!OPEN.size&&askTimer){clearInterval(askTimer);askTimer=null}}
function askCloseAll(){for(const k of [...OPEN.keys()])askClose(k)}

// The screens: a registry, one shown at a time.
const SCREENS={};
function screen(name,def){SCREENS[name]=def}
function band(){const live=!!(S.mode&&S.mode.claude==='live');return el('p','band',[el('span','',C.band.line),el('span','mode'+(live?' live':''),live?C.band.claudeLive:C.band.claudeCode)])}
// Where the visit stands: one segment per step, and the current step's name.
function steps(name){
  const order=C.steps.order,at=order.indexOf(name);if(at<1)return null;
  const ol=el('ol','prog');ol.setAttribute('aria-label',fill(C.steps.where,{n:at+1,of:order.length}));
  for(let i=0;i<order.length;i++){const li=el('li',i<at?'done':i===at?'on':'');if(i===at)li.setAttribute('aria-current','step');ol.append(li)}
  return el('div','progw',[ol,el('span','stepname',C.steps.names[name])]);
}
// The rail moved on without a new screen (screen 3 lights Pay when its pay call starts).
function rail(name){const o=$('#main .progw'),n=steps(name);if(o&&n)o.replaceWith(n)}
function show(name,arg){
  const d=SCREENS[name];if(!d)return false;
  pollStop();askCloseAll();revokeAll();
  S.screen=name;save();
  const h=el('h1','',typeof d.heading==='function'?d.heading(arg):d.heading);h.tabIndex=-1;
  const box=el('div','screen');
  const top=d.band===false||!S.session?[]:[steps(name),band()].filter(Boolean);
  $('#main').replaceChildren(...top,h,box);
  d.draw(box,arg);
  window.scrollTo(0,0);h.focus();
  return true;
}

// 0 Start.
// In two zones with the illustration (static in the page, cloud/src/scene.ts) and the trust line under the card (CSS).
screen('start',{heading:C.start.heading,band:false,draw(box){
  box.classList.add('start');
  const text=el('p','lede',C.start.text);const b=btn(C.start.button,true);
  const label=(words,glyph)=>b.replaceChildren(...[words,glyph?icon('arrow-right',18):null].filter(Boolean));label(C.start.button,true);
  box.append(text,b,el('p','fine',C.start.fine));
  b.addEventListener('click',async()=>{
    b.disabled=true;label(C.start.starting,false);
    const r=await call('POST','/v1/try/start',TOKEN?{token:TOKEN}:{});
    if((r.status===201||r.status===200)&&typeof r.json.session==='string'){
      for(const k of ['tenant','session','visitor_token','expires_at','pool','mode'])S[k]=r.json[k]??null;
      // Warm the company's engine while screen 1 is read: its status (which loads the engine object) and the samples, in
      // parallel and not awaited, so the engine is warm when the visitor files an invoice. Only here, after the click:
      // never on load or on hover, which would start a company for every crawler and spend the start limits.
      S.after=0;save();armRenewal();WARM.engine=api('GET','/v1/engine');WARM.samples=api('GET','/v1/engine/samples');show('invoice');return;
    }
    b.disabled=false;label(C.start.button,true);
    const said=typeof r.json.message==='string'&&r.json.message?r.json.message:C.start.failed;
    const why=el('div','',[el('p','note',said)]);
    if(r.status===429||r.status===503){const a=el('a','',C.start.runs);a.href=RUNS;a.rel='noopener';why.append(el('p','',a))}
    text.replaceWith(why);
  });
}});

// The warm-up's answers, taken once by the screen that needs them (screen 1 takes the samples).
const WARM={engine:null,samples:null};

// 1 Invoice: a sample, or one written here.
function today(plus){const d=new Date(Date.now()+(plus||0)*86400000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function field(label,input,id){input.id=id;const l=el('label','',label);l.htmlFor=id;return el('div','f',[l,input])}
function input(type,value){const i=el('input');i.type=type;if(value!==undefined)i.value=value;return i}
async function catchUp(){for(let i=0;i<20;i++){const r=await call('GET','/v1/engine/events?after='+encodeURIComponent(S.after||0)+'&limit=200');if(r.status!==200||!Array.isArray(r.json.items))return;if(typeof r.json.next==='number')S.after=r.json.next;save();if(r.json.items.length<200)return}}
screen('invoice',{heading:C.invoice.heading,draw(box,arg){
  // arg.draft: the invoice written here, back from a compose the server refused (arg.said: its words, under the form).
  const draft=arg&&arg.draft&&typeof arg.draft==='object'?arg.draft:null;
  // Two tabs and one main button under both: it files the sample picked, or the invoice written.
  const tabs=el('div','tabs');tabs.setAttribute('role','tablist');
  const pick=el('div','panel'),write=el('div','panel');pick.setAttribute('role','tabpanel');write.setAttribute('role','tabpanel');
  const tA=el('button','',C.invoice.tabSample),tB=el('button','',C.invoice.tabWrite);
  for(const [t,p,id] of [[tA,pick,'tab-pick'],[tB,write,'tab-write']]){t.type='button';t.id=id;t.setAttribute('role','tab');p.setAttribute('aria-labelledby',id)}
  let writing=false;
  // Write your own needs the suppliers on file (the supplier and its IBAN): until they are in, the button is off and
  // both fields are a skeleton, so a quick click cannot meet empty required fields.
  let ready=false;let gateFields=[];
  // The samples (H3, 12 Nov): until they are in, the button is off (aria-disabled, so a tap still lands) and the cards
  // are a skeleton; a tap meanwhile is kept and files the first sample once they arrive.
  let samplesIn=false,queued=false;
  const gate=()=>{send.disabled=writing&&!ready;const off=!writing&&!samplesIn;if(off)send.setAttribute('aria-disabled','true');else send.removeAttribute('aria-disabled');send.classList.toggle('queued',off&&queued);for(const f of gateFields)f.classList.toggle('loading',!ready)};
  const choose=(w)=>{writing=w;tA.setAttribute('aria-selected',String(!w));tB.setAttribute('aria-selected',String(w));pick.hidden=w;write.hidden=!w;gate()};
  tA.addEventListener('click',()=>choose(false));tB.addEventListener('click',()=>choose(true));
  const send=btn(C.invoice.send,true);
  tabs.append(tA,tB);box.append(tabs,pick,write,send);choose(false);
  // Where the events stand now, so the live panel shows only what this invoice's request does.
  catchUp();
  // Pick a sample: one button per sample, the title only; the first is picked.
  let picked=null;
  // The samples' read: the warm-up's, fired with the start (in parallel with GET /v1/engine), or a fresh one.
  const loadSamples=(r0)=>{
    samplesIn=false;gate();
    const sk=el('div','samples');sk.setAttribute('aria-hidden','true');
    for(let i=0;i<3;i++)sk.append(el('span','btn skel'));
    pick.replaceChildren(el('p','muted',C.invoice.loading),sk);
    (r0||api('GET','/v1/engine/samples')).then((r)=>{
      if(S.screen!=='invoice')return;
      const items=r.status===200&&Array.isArray(r.json.items)?r.json.items.filter((s)=>s&&typeof s.key==='string'):[];
      if(!items.length){
        // Calmly, with a retry that reads them again; a kept tap is dropped, the button stays off.
        queued=false;gate();
        const again=el('button','link',C.invoice.retry);again.type='button';
        again.addEventListener('click',()=>loadSamples());
        pick.replaceChildren(el('p','hint calm',[C.invoice.failed,' ',again]));return}
      const list=el('div','samples');list.setAttribute('role','group');
      for(const s of items){
        const b=btn(String(s.title??s.key));b.setAttribute('aria-pressed','false');
        b.addEventListener('click',()=>{picked=s;for(const x of list.children)x.setAttribute('aria-pressed',String(x===b))});
        list.append(b);if(!picked){picked=s;b.setAttribute('aria-pressed','true')}}
      pick.replaceChildren(list);samplesIn=true;gate();
      if(queued){queued=false;gate();file()}
    });
  };
  loadSamples(WARM.samples);WARM.samples=null;
  // Write your own: a supplier on file, the number, the amount, the dates and the IBAN (prefilled, editable).
  const sup=el('select');const no=input('text','INV-'+String(1000+crypto.getRandomValues(new Uint16Array(1))[0]%9000));no.required=true;no.maxLength=40;
  const amt=input('text');amt.inputMode='decimal';amt.required=true;amt.autocomplete='off';amt.placeholder='1,850.00';
  // A calm hint under the amount when it cannot be read (normAmount, shared with screen 4); nothing is sent then.
  const amtHint=el('p','hint calm',C.invoice.amountBad);amtHint.id='f-amt-hint';amtHint.hidden=true;amtHint.setAttribute('aria-live','polite');
  amt.setAttribute('aria-describedby','f-amt-hint');
  // Outside the demo's range (100.00 to 5000.00: the simulated bank's USD floor, and a flat fee in proportion): the range's words.
  const amtRead=()=>{const v=normAmount(amt.value);if(v!==null)amt.value=v;const out=v!==null&&(Number(v)>5000||Number(v)<100);
    amtHint.textContent=out?C.invoice.amountCap:C.invoice.amountBad;
    const ok=v!==null&&!out;amtHint.hidden=ok;amt.setAttribute('aria-invalid',String(!ok));return ok?v:null};
  const iss=input('date',today(0)),dueOn=input('date',today(14));iss.required=true;dueOn.required=true;
  const iban=input('text');iban.className='mono';iban.required=true;iban.autocomplete='off';iban.spellcheck=false;iban.setAttribute('autocapitalize','characters');
  const msg=el('div','');
  const amtField=field(C.invoice.amount,amt,'f-amt');amtField.append(amtHint);
  const said=el('p','hint calm');said.setAttribute('role','status');said.hidden=true;
  const supField=field(C.invoice.supplier,sup,'f-sup'),ibanField=field(C.invoice.iban,iban,'f-iban');gateFields=[supField,ibanField];
  const form=el('form','',[supField,el('div','two',[field(C.invoice.invoiceNo,no,'f-no'),amtField]),
    el('div','two',[field(C.invoice.issued,iss,'f-iss'),field(C.invoice.due,dueOn,'f-due')]),ibanField,el('p','hint',C.invoice.ibanHint),said,msg]);
  write.append(form);gate();
  if(draft){
    // Back from a refused compose: the form as it was sent, and the server's words, calmly, under it.
    for(const [i,k] of [[no,'invoice_no'],[amt,'amount'],[iss,'issue_date'],[dueOn,'due_date'],[iban,'iban']])if(typeof draft[k]==='string')i.value=draft[k];
    if(typeof arg.said==='string'&&arg.said){said.textContent=arg.said;said.hidden=false}
    choose(true);
  }
  let suppliers=[];
  sup.addEventListener('change',()=>{const s=suppliers.find((x)=>x.key===sup.value);if(s)iban.value=String(s.iban??'')});
  amt.addEventListener('input',()=>{amtHint.hidden=true;amt.removeAttribute('aria-invalid')});
  amt.addEventListener('blur',()=>{if(amt.value.trim())amtRead()});
  const loadSuppliers=()=>api('GET','/v1/engine/suppliers').then((r)=>{
    if(S.screen!=='invoice')return;
    if(r.status!==200||!Array.isArray(r.json.items)){
      // Calmly, with a retry that reads them again; the button stays off.
      const again=el('button','link',C.invoice.retry);again.type='button';
      again.addEventListener('click',()=>{msg.replaceChildren();loadSuppliers()});
      msg.replaceChildren(el('p','hint calm',[C.invoice.suppliersFailed,' ',again]));return}
    suppliers=r.json.items.filter((s)=>s&&typeof s.key==='string');
    ready=suppliers.length>0;gate();
    sup.replaceChildren(...suppliers.map((s)=>{const o=el('option','',String(s.name??s.key));o.value=s.key;return o}));
    if(draft&&suppliers.some((s)=>s.key===draft.supplier_key))sup.value=draft.supplier_key;
    else if(suppliers[0])iban.value=String(suppliers[0].iban??'');
  });
  loadSuppliers();
  function file(){
    if(!writing){
      // Not in yet: keep the tap, it files the first sample when they arrive.
      if(!samplesIn||!picked){queued=true;gate();return}
      show('work',{kind:'sample',key:picked.key,title:String(picked.title??'')});return}
    const v=amtRead();
    if(v===null){amt.focus();return}
    if(!form.reportValidity())return;
    show('work',{kind:'compose',body:{supplier_key:sup.value,invoice_no:no.value.trim(),amount:v,issue_date:iss.value,due_date:dueOn.value,iban:iban.value.replace(/\s/g,'').toUpperCase()}});
  }
  send.addEventListener('click',file);
  form.addEventListener('submit',(ev)=>{ev.preventDefault();file()});
}});

// 2 At work: the live panel while the request is in flight, then the invoice's status from the answer.
// A reader's key (its agent, or the reader), and whether a row is a reader's (it closes that reader's open call).
const keyOf=(e)=>{const a=e.fields&&typeof e.fields.agent==='string'&&/^[A-Za-z_-]{1,32}$/.test(e.fields.agent)?e.fields.agent.toLowerCase():'reader';return a};
const agentRow=(e)=>typeof e.event==='string'&&(e.event.indexOf('claude.')===0||e.event.indexOf('agent.')===0||!!(e.fields&&e.fields.agent));
// Shown at once: the last three rows that are not an agent's working steps; the rest, and every working step (a tool
// call, its words, its run), in the "All steps" fold. An agent's decision: its lead, its reason marked as its own words,
// and what Purser's code enforced on a muted line under it.
function livePanel(){
  const list=el('ol','live');list.setAttribute('aria-live','off');
  const more=el('button','link steps',C.live.allSteps);more.type='button';more.hidden=true;more.setAttribute('aria-expanded','false');
  more.addEventListener('click',()=>{const open=!list.classList.contains('open');list.classList.toggle('open',open);more.setAttribute('aria-expanded',String(open))});
  const node=el('div','card',[list,more]);node.hidden=true;
  function add(items,t0){
    for(const e of items){
      if(agentRow(e))askClose(keyOf(e));
      const l=lineOf(e);
      const t=el('span','t',t0===undefined?'':fill(W.at,{s:secs(performance.now()-t0)}));
      const what=l.lead?el('span','what',[l.lead,...(l.own?[' ',el('q','own',l.own),' ',el('span','ownw','('+W.ownWords+')')]:[])]):el('span','what',l.text);
      list.append(el('li',[l.tag||'',l.fold?'fold':'',l.lead?'agent':''].filter(Boolean).join(' '),[el('span','who',l.who),what,l.enforced?el('span','enf',l.enforced):null,t]));
      if(l.asking)askOpen(keyOf(e),t);
      if(!l.fold)say(l.who+' · '+l.text);
    }
    // The last three rows outside the fold stay in view; every other row waits behind "All steps".
    let seen=0;
    for(let i=list.children.length-1;i>=0;i--){const li=list.children[i];if(li.classList.contains('fold'))continue;seen++;li.classList.toggle('past',seen>3)}
    node.hidden=!list.children.length;more.hidden=!list.querySelector('.fold,.past');
  }
  return {node,add};
}
// The invoice as the answer has it, in a card whose rows light one by one (CSS, drawn only once the answer is in), and a
// slot for the chip that says Claude read it (filled only from a claude.read event whose source is Claude).
function invoiceCard(inv){
  const d=el('dl','rows');
  for(const [k,v] of [[C.fields.vendor,inv.vendor],[C.fields.number,inv.invoice_no],[C.fields.total,[inv.currency,inv.total].filter(Boolean).join(' ')],[C.fields.due,inv.due_date],[C.fields.status,inv.status_words]]){if(v===null||v===undefined||v==='')continue;d.append(el('div','',[el('dt','',k),el('dd','',String(v))]))}
  const chip=el('span','slot');
  return {node:el('section','card inv',[el('p','ih',[icon('file-text',18),el('span','',C.work.invoiceFold),chip]),d]),chip};
}
// While the request is in flight: the invoice card's skeleton (the five row labels, shimmering placeholders, no value:
// nothing of the outcome before its answer) under a line that says who reads, by the band's mode. Claude's line
// carries the open call's running time (askOpen on an asking row, askClose on the reader's next row, the same count
// as the live panel's).
function skeleton(){
  const live=!!(S.mode&&S.mode.claude==='live');
  const n=el('span','n');const line=el('p','reading',[el('span','dot'),el('span','',live?C.work.reading:C.work.readingCode),live?n:null]);
  const d=el('dl','rows');
  for(const k of [C.fields.vendor,C.fields.number,C.fields.total,C.fields.due,C.fields.status])d.append(el('div','',[el('dt','',k),el('dd','',[el('span','sk')])]));
  const card=el('section','card inv skel',[el('p','ih',[icon('file-text',18),el('span','',C.work.invoiceFold)]),d]);card.setAttribute('aria-busy','true');
  const see=(items)=>{if(!live)return;for(const e of items){if(agentRow(e))askClose('skeleton');if(lineOf(e).asking)askOpen('skeleton',n)}};
  return {node:el('div','',[line,card]),see};
}
// Whether this request's events say Claude read the invoice, and that call's request id.
const CLAUDE={on:false,req:null,slot:null};
function claudeSeen(items){for(const e of items){const f=e&&e.fields;if(e&&e.event==='claude.read'&&f&&f.source==='claude'){CLAUDE.on=true;CLAUDE.req=typeof f.request_id==='string'&&/^[\w-]{1,80}$/.test(f.request_id)?f.request_id:null}}chipFill()}
function chipFill(){if(!CLAUDE.on||!CLAUDE.slot||!CLAUDE.slot.isConnected||CLAUDE.slot.children.length)return;
  CLAUDE.slot.append(el('span','chip',[icon('sparkles',13),el('span','',C.work.claudeChip),CLAUDE.req?el('span','mono',CLAUDE.req):null]))}
function drawResult(box,r,ms){
  const took=ms===null?null:el('p','muted',fill(C.work.took,{s:secs(ms)}));
  const inv=r.json&&r.json.invoice&&typeof r.json.invoice==='object'?r.json.invoice:null;
  let main;
  if((r.status===200||r.status===201)&&inv){
    if(r.json.kind==='duplicate_document')box.append(el('p','big',C.work.duplicate));
    if(inv.payable===true){
      box.append(el('p','big ok',C.work.ready),el('p','muted',C.work.readySub));
      main=btn(C.work.pay,true);main.addEventListener('click',()=>show('approve',{invoice:inv}));
    }else{
      box.append(el('p','big bad',[C.work.notReady,' ',String(inv.status_words||inv.status||'')]));
      const fs=Array.isArray(inv.findings)?inv.findings.filter((f)=>f&&typeof f.message==='string'):[];
      if(fs.length)box.append(el('ul','',fs.map((f)=>el('li','',f.message))));
      main=btn(C.work.another,true);main.addEventListener('click',()=>show('invoice'));
    }
    const card=invoiceCard(inv);CLAUDE.slot=card.chip;
    box.append(...(took?[took]:[]),card.node,main);chipFill();
    return;
  }
  if(r.status===200||r.status===201)box.append(el('p','big',C.work.noInvoice),...(took?[took]:[]));
  else box.append(el('p','note',typeof r.json.message==='string'&&r.json.message?r.json.message:C.work.failed));
  main=btn(C.work.another,true);main.addEventListener('click',()=>show('invoice'));
  box.append(main);
}
screen('work',{heading:C.work.heading,draw(box,arg){
  const live=livePanel();const result=el('div','result');
  CLAUDE.on=false;CLAUDE.req=null;CLAUDE.slot=null;
  box.append(live.node,result);
  if(arg&&arg.kind==='reload'){
    // After a reload: the newest invoice as the server has it, and its steps so far (no times: they were not measured here).
    call('GET','/v1/engine/events?after=0&limit=200').then((r)=>{if(r.status===200&&Array.isArray(r.json.items)){live.add(r.json.items);claudeSeen(r.json.items)}});
    drawResult(result,{status:200,json:{invoice:arg.invoice}},null);
    return;
  }
  const sk=skeleton();result.append(sk.node);
  const t0=performance.now();
  pollStart((items)=>{live.add(items,t0);claudeSeen(items);sk.see(items)});
  const req=arg.kind==='sample'?api('POST','/v1/engine/samples/'+encodeURIComponent(arg.key)):api('POST','/v1/engine/compose',arg.body);
  req.then((r)=>{
    const ms=performance.now()-t0;
    pollDone();askClose('skeleton');
    if(S.screen!=='work')return;
    // A compose the server refused (400): back to the form as it was sent, its words calmly under it.
    if(arg.kind==='compose'&&r.status===400){show('invoice',{draft:arg.body,said:typeof r.json.message==='string'&&r.json.message?r.json.message:typeof r.json.error==='string'?r.json.error:C.work.failed});return}
    result.replaceChildren();drawResult(result,r,ms);
    const b=result.querySelector('.btn.primary');if(b)b.focus();
  });
}});

// The passkey: whether this device can make one, and its word for it (a guess from the platform, never proven).
const hasPasskeys=()=>!!(window.PublicKeyCredential&&navigator.credentials);
const method=()=>methodOf(C.method,navigator.userAgent||'');
// The engine's approval passkey signs the proposal's challenge (the SHA-256 of its exact terms).
async function signTerms(challenge,credentialId){
  const c=await navigator.credentials.get({publicKey:{challenge:fromB64u(challenge),rpId:CFG.rpId,allowCredentials:[{type:'public-key',id:fromB64u(credentialId)}],userVerification:'required',timeout:120000}});
  return signedOf(c);
}
// The one pay request (screen 3's pay as signed, screen 4's fields): POST .../pay with payBody's {terms, credential}.
const payCall=(pid,body)=>api('POST','/v1/engine/proposals/'+encodeURIComponent(pid)+'/pay',body);
// The engine's retry route, on the visitor's button only (screens 3 and 4).
const retryCall=(pid)=>api('POST','/v1/engine/proposals/'+encodeURIComponent(pid)+'/retry');
const cancelled=(e)=>e&&typeof e.name==='string'&&/^(NotAllowedError|AbortError|InvalidStateError|SecurityError|NotSupportedError)$/.test(e.name);
// One main button whose label and action change with the step; it is off while a request or a prompt is open.
function mainButton(){
  const b=btn('',true);let act=null;
  b.addEventListener('click',async()=>{if(b.disabled||!act)return;b.disabled=true;try{await act()}finally{if(b.isConnected)b.disabled=false}});
  return {node:b,set(label,fn){b.textContent=label;act=fn;b.hidden=false;b.disabled=false},off(label){b.textContent=label;act=null;b.disabled=true}};
}

// 3 Approve: the proposal's facts, its short hash and the exact terms in a fold; one button in two labelled stages.
function factRows(p,inv){
  const facts=Array.isArray(p.facts)?p.facts.filter((f)=>Array.isArray(f)&&f.length===2):[];
  const amount=facts[0]?String(facts[0][1]):'';
  const payee=facts.find((f)=>f[0]==='Payee')||facts[1];
  const m=payee?/^(.*), IBAN \S*?(\w{2,8})$/.exec(String(payee[1])):null;
  const pairs=[];
  if(payee)pairs.push(m?[String(payee[0]),m[1]]:[String(payee[0]),String(payee[1])]);
  if(m)pairs.push([C.proposal.account,'…'+m[2]]);
  if(inv&&inv.due_date)pairs.push([C.proposal.due,String(inv.due_date)]);
  const d=el('dl','read');for(const [k,v] of pairs)d.append(el('dt','',k),el('dd','',v));
  return {amount,list:d};
}
function termsFold(p){
  const pre=el('pre','terms mono');const f=el('details','',[el('summary','',C.approve.terms),pre]);
  let asked=false;
  f.addEventListener('toggle',()=>{if(!f.open||asked)return;asked=true;
    api('GET','/v1/engine/proposals/'+encodeURIComponent(p.id)+'/terms').then((r)=>{
      if(r.status===200&&typeof r.json.canonical==='string')pre.textContent=r.json.canonical;else{asked=false;pre.replaceWith(note(words(r.json,C.approve.failed)))}})});
  return f;
}
screen('approve',{heading:C.approve.heading,draw(box,arg){
  const A=C.approve;const inv=arg&&arg.invoice||null;
  const top=el('div','');const said=el('div','');said.setAttribute('role','status');
  const main=mainButton();main.off(A.filing);
  const live=livePanel();
  box.append(top,said,main.node,live.node);
  let p=null,eng=null;
  const saves=el('span','',' '+fill(A.saves,{host:CFG.rpId}));
  // A request still out after 30 s: one calm line under the button (from the poller's tick), gone when it returns.
  const slow=el('p','hint',A.slow);
  const track=(req)=>{const t0=performance.now();pollStart((items)=>live.add(items,t0),()=>{if(!slow.isConnected)said.append(slow)});return req.then((r)=>{pollDone();slow.remove();return r})};
  // The button while a step runs: its own label, and the ring.
  const busy=(label)=>{main.node.textContent=label;main.node.classList.add('asking')};
  const idle=()=>main.node.classList.remove('asking');
  async function file(){
    said.replaceChildren();main.off(A.filing);
    const ready=inv&&inv.proposal&&inv.proposal.status==='PENDING_APPROVAL'&&!arg.again?inv.proposal:null;
    // The engine's status (is there a passkey?) is read beside the proposal, not after it.
    const stq=api('GET','/v1/engine');
    const r=ready?{status:200,json:{proposal:ready}}
      :inv&&inv.id?await track(api('POST','/v1/engine/invoices/'+encodeURIComponent(inv.id)+'/pay'))
      :S.proposal?await api('GET','/v1/engine/proposals/'+encodeURIComponent(S.proposal.id)):{status:0,json:{}};
    const st=await stq;
    if(S.screen!=='approve')return;
    if(r.status!==200||!r.json.proposal||typeof r.json.proposal.id!=='string'){said.replaceChildren(note(words(r.json,A.failed)));main.set(A.fileAgain,()=>{arg=Object.assign({},arg,{again:true});return file()});return}
    p=r.json.proposal;eng=st.status===200?st.json:{passkey:null};
    S.proposal={id:p.id,challenge:p.challenge,terms_sha256:p.terms_sha256,invoice:inv&&inv.id||(S.proposal&&S.proposal.invoice)||null};S.cred=null;save();
    const f=factRows(p,inv);
    top.replaceChildren(el('div','receipt',[el('p','amount',f.amount),f.list,el('p','short mono hashpill',String(p.terms_sha256||'').slice(0,12)+'…')]),
      termsFold(p),el('p','muted',[A.signs,saves]));
    stage();
  }
  function stage(){
    if(!hasPasskeys()){main.node.hidden=true;said.replaceChildren(note(A.noPasskey));return}
    saves.hidden=!!(eng&&eng.passkey);
    if(!eng||!eng.passkey){main.set(A.create,createPasskey);return}
    main.set(fill(A.approve,{amount:factRows(p,inv).amount,method:method()}),approve);
  }
  // Two taps, each opening its own prompt: create (it uses up the tap's user activation, so Safari would refuse a
  // second prompt in the same tap), then approve. Labels say what runs: the start request keeps the button's own label
  // (off), "Waiting for your passkey…" only while the browser's prompt is open, "Saving your passkey…" while finish runs.
  async function createPasskey(){
    said.replaceChildren();
    const s=await api('POST','/v1/engine/passkey/start');
    if(s.status!==200||!s.json.user){said.replaceChildren(note(words(s.json,A.failed)));stage();return}
    let made;busy(A.waiting);
    try{made=await navigator.credentials.create({publicKey:{rp:{id:s.json.rp.id,name:s.json.rp.name},user:{id:new TextEncoder().encode(s.json.user.id),name:s.json.user.name,displayName:s.json.user.displayName},
      challenge:fromB64u(s.json.challenge),pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],excludeCredentials:(s.json.exclude||[]).map((id)=>({type:'public-key',id:fromB64u(id)})),
      authenticatorSelection:{userVerification:'required',residentKey:'discouraged'},attestation:'none',timeout:120000}})}
    catch(e){idle();said.replaceChildren(note(cancelled(e)?A.cancelled:A.failed));stage();return}
    busy(A.saving);saves.hidden=true;
    const f=await track(api('POST','/v1/engine/passkey/finish',{code:s.json.code,credential:registrationOf(made)}));
    idle();
    if(S.screen!=='approve')return;
    if(f.status!==200){said.replaceChildren(note(words(f.json,A.failed)));stage();return}
    if(typeof f.json.credential_id==='string'&&f.json.credential_id){
      // The answer names the passkey: drawn at once. The status is read again in the background, and a later answer
      // never takes the passkey away.
      const pk={credential_id:f.json.credential_id};
      eng=Object.assign({},eng,{passkey:pk});stage();
      api('GET','/v1/engine').then((st)=>{if(st.status===200&&st.json&&typeof st.json==='object')eng=Object.assign({},st.json,{passkey:st.json.passkey||(eng&&eng.passkey)||pk})});
      return;
    }
    const st=await api('GET','/v1/engine');if(st.status===200)eng=st.json;
    stage();
  }
  // The passkey's prompt opens on the tap itself: nothing is asked of the server before navigator.credentials.get.
  async function approve(){
    said.replaceChildren();busy(A.waiting);
    let signed;
    try{signed=await signTerms(p.challenge,eng.passkey.credential_id)}catch(e){idle();said.replaceChildren(note(A.cancelled));stage();return}
    // The ring stays while the approval is sent; the tick shows as soon as its answer is in.
    busy(A.approving);
    const r=await track(api('POST','/v1/engine/proposals/'+encodeURIComponent(p.id)+'/approve',{terms_sha256:p.terms_sha256,credential:signed}));
    idle();
    if(S.screen!=='approve')return;
    if(r.status===200&&r.json.status==='approved'&&r.json.held===true){
      // Held: the approval is stored and nothing is paid (drawn from its answer); the signature is kept for screen 4,
      // and the pay call starts at once, in the same tap.
      S.cred=signed;save();
      said.replaceChildren(el('p','big ok tick',[icon('circle-check',24),el('span','',A.approved)]));
      return pay(signed);
    }
    if(r.status===200&&r.json.status==='approved'){S.settled=r.json.settled||null;save();show('books',{settled:S.settled});return}
    said.replaceChildren(note(words(r.json,A.failed)));
    if(r.json.status==='expired')main.set(A.fileAgain,()=>{arg=Object.assign({},arg,{again:true});return file()});else stage();
  }
  // Pay as signed, in the approval's tap: the terms from GET .../terms unchanged and the kept signature, to the one pay
  // route. "Paying…" with the ring and the rail on Pay while it runs; nothing of the outcome before its answer.
  async function pay(cred){
    const Y=C.pay;
    busy(Y.paying);rail('pay');
    const t=await api('GET','/v1/engine/proposals/'+encodeURIComponent(p.id)+'/terms');
    if(S.screen!=='approve')return;
    if(t.status!==200||!t.json.terms||typeof t.json.terms!=='object'){idle();said.append(note(words(t.json,Y.failed)));main.set(Y.retry,()=>pay(cred));return}
    const signedBody=payBody(t.json.terms,t.json.terms,cred);
    const r=await track(payCall(p.id,signedBody));
    idle();
    if(S.screen!=='approve')return;
    const j=r.json,o=r.status===200?j.outcome:null;
    if(o==='paid'){S.settled=j.settled||null;save();show('books',{settled:S.settled});return}
    // Any other answer: the engine's words, calmly, with the button for that outcome (as screen 4 has them).
    const sig=j.layers&&j.layers.signature&&typeof j.layers.signature.reason==='string'&&j.layers.signature.reason?j.layers.signature.reason:null;
    if(o==='paid_once'){said.replaceChildren(el('p','big',Y.paidOnce));main.set(C.books.next,()=>show('did'));return}
    if(o==='expired'){said.replaceChildren(note(words(j,Y.failed)));main.set(A.fileAgain,()=>{arg=Object.assign({},arg,{again:true});return file()});return}
    if(o==='failed'){said.replaceChildren(note(words(j,j.settled&&j.settled.error||Y.failed)));main.set(Y.retry,retry);return}
    if(o==='not_signed'||o==='refused'){if(o==='not_signed'){S.cred=null;save()}said.replaceChildren(note(words(j,sig||Y.failed)));stage();return}
    said.replaceChildren(note(words(j,Y.failed)));main.set(Y.retry,()=>pay(cred));
  }
  async function retry(){
    const r=await retryCall(p.id);
    if(S.screen!=='approve')return;
    if(r.status===200&&r.json.settled&&!r.json.settled.error){S.settled=r.json.settled;save();show('books',{settled:S.settled});return}
    said.replaceChildren(note(words(r.json,r.json.settled&&r.json.settled.error||C.pay.failed)));
  }
  file();
}});

// 4 Pay with your signature, reached after paid from screen 5's quiet link: the signed terms in three fields; the one
// button sends the fields' terms with the kept signature to the one pay route, and only the answer, once back, is drawn.
screen('pay',{heading:C.pay.heading,draw(box){
  const Y=C.pay;const pid=S.proposal&&S.proposal.id;
  const top=el('div','',[el('p','muted',Y.loading)]);const out=el('div','outcome');out.setAttribute('role','status');
  const main=mainButton();main.off(Y.button);
  const live=livePanel();
  // Back to screen 5, a quiet link (the payment is already made).
  const back=el('button','link',Y.back);back.type='button';back.addEventListener('click',()=>show('books',{settled:S.settled}));
  box.append(top,main.node,out,el('p','',back),live.node);
  if(!pid){top.replaceChildren(note(Y.failed));return}
  let T=null;const F={};
  const field4=(label,key,cls)=>{const i=input('text');i.autocomplete='off';i.spellcheck=false;F[key]=i;return el('div','f'+(cls?' '+cls:''),[el('label','',label),i])};
  // A field that differs from the signed value glows (compared as the pay route would send it).
  const mark=()=>{for(const k of ['amount','beneficiary_name','iban_last4']){const v=k==='amount'?normAmount(F.amount.value,T.terms.amount):F[k].value.trim();F[k].parentNode.classList.toggle('changed',String(v)!==String(T.terms[k]))}};
  const reset=()=>{F.amount.value=String(T.terms.amount);F.beneficiary_name.value=String(T.terms.beneficiary_name);F.iban_last4.value=String(T.terms.iban_last4);F.amount.setCustomValidity('');mark()};
  const values=()=>({amount:normAmount(F.amount.value,T.terms.amount),beneficiary_name:F.beneficiary_name.value.trim(),iban_last4:F.iban_last4.value.trim()});
  api('GET','/v1/engine/proposals/'+encodeURIComponent(pid)+'/terms').then((r)=>{
    if(S.screen!=='pay')return;
    if(r.status!==200||!r.json.terms||typeof r.json.terms!=='object'){top.replaceChildren(note(words(r.json,Y.failed)));return}
    T=r.json;
    const form=el('form','',[field4(C.proposal.amount,'amount','big'),field4(C.proposal.payee,'beneficiary_name'),field4(C.proposal.account,'iban_last4')]);
    for(const [k,id] of [['amount','p-amt'],['beneficiary_name','p-payee'],['iban_last4','p-acct']]){F[k].id=id;F[k].parentNode.firstChild.htmlFor=id}
    F.amount.inputMode='decimal';F.amount.classList.add('mono');F.iban_last4.classList.add('mono');F.amount.addEventListener('input',()=>F.amount.setCustomValidity(''));
    for(const k of ['amount','beneficiary_name','iban_last4'])F[k].addEventListener('input',mark);
    form.addEventListener('submit',(ev)=>{ev.preventDefault();if(!main.node.disabled)main.node.click()});
    const intro=el('div','',[el('p','muted',Y.line),el('p','hint',Y.already)]);
    top.replaceChildren(form,intro);reset();
    main.set(Y.button,()=>send(intro));
  });
  async function send(intro){
    const v=values();
    if(v.amount===null){F.amount.setCustomValidity(Y.amountBad);F.amount.reportValidity();return}
    let cred=S.cred;
    if(!cred){
      // After a reload without the kept signature: the passkey again, for the same terms (the challenge is their hash).
      const st=await api('GET','/v1/engine');
      main.node.textContent=C.approve.waiting;
      try{cred=await signTerms(S.proposal.challenge,st.json.passkey&&st.json.passkey.credential_id)}catch(e){main.set(Y.button,()=>send(intro));out.replaceChildren(note(C.approve.cancelled));return}
      S.cred=cred;save();
    }
    // While the request runs: "Paying…" with the ring; the answer is drawn the moment it is in (paid: screen 5's stamp).
    main.node.textContent=Y.paying;main.node.classList.add('asking');out.replaceChildren();
    const slow=el('p','hint',C.approve.slow);
    const body=payBody(T.terms,v,cred);
    const t0=performance.now();
    pollStart((items)=>live.add(items,t0),()=>{if(!slow.isConnected)out.append(slow)});
    const r=await payCall(pid,body);
    const ms=performance.now()-t0;
    pollDone();main.node.classList.remove('asking');slow.remove();
    if(S.screen!=='pay')return;
    main.set(Y.button,()=>send(intro));
    outcome(r,ms,body.terms,intro);
  }
  function outcome(r,ms,sent,intro){
    const j=r.json,o=r.status===200?j.outcome:null;
    if(o==='paid'){S.settled=j.settled||null;save();show('books',{settled:S.settled});return}
    if(o==='not_signed'){S.cred=null;save();show('approve',{});return}
    if(o==='refused'){intro.hidden=true;out.replaceChildren(refused(r,ms,sent));return}
    if(o==='paid_once'){out.replaceChildren(el('p','big',Y.paidOnce));return}
    if(o==='expired'){out.replaceChildren(note(words(j,Y.failed)));main.set(Y.fileAgain,()=>show('approve',{invoice:S.proposal.invoice?{id:S.proposal.invoice}:null,again:true}));return}
    if(o==='failed'){out.replaceChildren(note(words(j,j.settled&&j.settled.error||Y.failed)));main.set(Y.retry,retry);return}
    out.replaceChildren(note(words(j,Y.failed)));
  }
  async function retry(){
    const r=await retryCall(pid);
    if(S.screen!=='pay')return;
    if(r.status===200&&r.json.settled&&!r.json.settled.error){S.settled=r.json.settled;save();show('books',{settled:S.settled});return}
    out.replaceChildren(note(words(r.json,r.json.settled&&r.json.settled.error||Y.failed)));
  }
  function refused(r,ms,sent){
    const j=r.json,L=j.layers&&typeof j.layers==='object'?j.layers:{};const sig=L.signature||{},ex=L.executor||{};
    const card=el('div','card refusal shake',[el('p','stamp',Y.stamp)]);
    if(sig.verified===false){const why=typeof sig.reason==='string'&&/\s/.test(sig.reason.trim())?sig.reason.trim():Y.signatureOff;card.append(el('p','layer',fill(Y.signature,{reason:why})))}
    if(ex.accepted===false){card.append(el('p','layer',Y.executor));
      if(typeof ex.said==='string'&&ex.said)card.append(el('details','',[el('summary','',Y.executorFold),el('p','',ex.said),el('p','hint',Y.executorNote)]))}
    const d=hashDiff(typeof j.signed_sha256==='string'?j.signed_sha256:'',typeof j.sent_sha256==='string'?j.sent_sha256:'');
    const line=(label,runs)=>el('p','hash mono',[el('span','hl',label),...runs.map((x)=>x[1]?el('mark','',x[0]):x[0])]);
    card.append(line(Y.signed,d.a),line(Y.sent,d.b));
    card.append(el('p','verdict',verdict(Y,T.terms,sent,j.changed)));
    card.append(el('p','proof',fill(Y.roundTrip,{n:Math.round(ms)})));
    const made=Number(j.transfers_after)-Number(j.transfers_before);
    if(isFinite(made))card.append(el('p','proof xfer',fill(Y.transfers,{n:made})));
    if(S.mode&&S.mode.rail_awx==='on'&&typeof j.sandbox_calls==='number')card.append(el('p','proof',fill(Y.sandbox,{n:j.sandbox_calls})));
    const raw=el('pre','raw mono');raw.textContent=r.text;
    card.append(el('details','',[el('summary','',Y.raw),raw]));
    const back=el('button','link',Y.putBack);back.type='button';back.addEventListener('click',()=>{reset();F.amount.focus()});
    card.append(el('p','',back));
    return card;
  }
}});

// Files fetched with the session are opened from blob URLs; each is revoked when the screen changes or the page goes.
const BLOBS=[];
function revokeAll(){for(const u of BLOBS.splice(0))URL.revokeObjectURL(u)}
window.addEventListener('pagehide',revokeAll);
// A file with the session: a 401 renews once. {status, blob, name} (name from the answer's content-disposition).
async function fetchFile(path){
  const once=async()=>{try{const r=await fetch(path,{headers:S.session?{authorization:'Bearer '+S.session}:{}});return r}catch(e){return null}};
  let r=await once();
  if(r&&r.status===401&&S.session&&(await renew()))r=await once();
  if(!r)return {status:0,blob:null,json:{}};
  if(r.status!==200){let json={};try{json=await r.json()}catch(e){}return {status:r.status,blob:null,json:json&&typeof json==='object'?json:{}}}
  const m=/filename="([^"]+)"/.exec(r.headers.get('content-disposition')||'');
  return {status:200,blob:await r.blob(),name:m?m[1].replace(/[^\w. -]+/g,'_'):null,json:{}};
}
const blobUrl=(blob)=>{const u=URL.createObjectURL(blob);BLOBS.push(u);return u};
// Every page of a list route of the read model (limit 200, its cursor): {status, items}.
async function everyPage(path){let items=[],cursor=null;
  for(let n=0;n<50;n++){const r=await api('GET',path+(path.indexOf('?')>=0?'&':'?')+'limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    if(r.status!==200||!Array.isArray(r.json.items))return {status:r.status||0,items:null,json:r.json};
    items=items.concat(r.json.items);cursor=typeof r.json.next_cursor==='string'&&r.json.next_cursor?r.json.next_cursor:null;if(!cursor)break}
  return {status:200,items};
}

// 5 Paid, booked, filed: from the pay route's settled answer, then each block from its own reads, drawn when they return.
const {paymentOf,isPaid,txOf,feeOf,entriesOf,balance,headOf,filesOf,money,fromCents,fileName}=booksKit;
const settledErr=(arg)=>{const s=arg&&arg.settled;return s&&typeof s.error==='string'&&s.error?s.error:null};
screen('books',{heading:(arg)=>settledErr(arg)?C.books.headingError:C.books.heading,draw(box,arg){
  const B=C.books;const s=arg&&arg.settled&&typeof arg.settled==='object'?arg.settled:{};
  const pid=S.proposal&&S.proposal.id,invId=S.proposal&&S.proposal.invoice;
  const main=mainButton();
  const err=settledErr(arg);
  if(err){
    // What failed, in the engine's words as they came; the engine's retry route runs only when the visitor asks.
    const said=el('div','',[note(err)]);said.setAttribute('role','status');
    const next=btn(B.what);next.addEventListener('click',()=>show('did'));
    main.set(B.retry,async()=>{
      main.off(B.retry);
      const r=await api('POST','/v1/engine/proposals/'+encodeURIComponent(pid)+'/retry');
      if(S.screen!=='books')return;
      if(r.status===200&&r.json.settled&&typeof r.json.settled==='object'){S.settled=r.json.settled;save();show('books',{settled:S.settled});return}
      said.replaceChildren(note(words(r.json,B.failed)));next.remove();main.set(B.what,()=>show('did'));
    });
    box.append(said,el('div','acts',[main.node,next]));
    return;
  }
  // The main step on: Purser Cloud's guest dashboard, in a new tab (a link, so its address is there to read); this visit's
  // own record (screen 5b) one quiet button below.
  main.node.remove();
  const cloud=el('a','btn primary big go-cloud',[el('span','',B.next),icon('external-link',16)]);cloud.href=DIDURL.cloud;cloud.target='_blank';cloud.rel='noopener';
  const what=btn(B.what);what.addEventListener('click',()=>show('did'));
  const slot=()=>el('div','slot');
  const paid=slot(),booked=slot(),filed=slot();
  // A calm stamp, and the hash of the terms that were signed and paid (the proposal's own, kept from screen 3).
  const sha=S.proposal&&typeof S.proposal.terms_sha256==='string'?S.proposal.terms_sha256:'';
  // The try-to-cheat story, after paid: a quiet link to screen 4's fields, prefilled with the signed terms.
  const cheat=pid?el('button','link cheat',B.cheat):null;if(cheat){cheat.type='button';cheat.addEventListener('click',()=>show('pay'))}
  box.append(el('div','paidstamp',[el('span','ring',icon('circle-check',30)),sha?el('span','hashpill mono',[icon('key-round',13),' '+sha.slice(0,12)+'…']):null]),paid,booked,filed,el('div','acts',[cloud,what]),...(cheat?[el('p','',cheat)]:[]));
  // A block: its icon and heading, then what its read returned.
  const block=(name,head,kids,tone)=>el('section','card blk '+name,[el('p','bh'+(tone?' '+tone:''),[icon(name==='paid'?'landmark':name==='booked'?'database':'file-lock-2',20),el('span','',head)]),...kids.filter(Boolean)]);
  const wait=(words)=>el('p','wait',[icon('clock',18),el('span','',words)]);
  const failedOf=(r)=>note(words(r.json||{},B.failed));
  const inv=api('GET','/v1/engine/invoices').then((r)=>{const items=r.status===200&&Array.isArray(r.json.items)?r.json.items:[];return {r,items,i:items.find((x)=>x&&x.id===invId)||null}});
  if(s.fed===false){
    // The read model is fed by the engine during pay: not fed, nothing of the books is shown.
    paid.replaceChildren(wait(B.notIn));
  }else{
    const reads=Promise.all([inv,everyPage('/v1/payments'),everyPage('/v1/transactions')]);
    reads.then(([v,ps,txs])=>{
      if(S.screen!=='books')return;
      if(ps.status!==200){paid.replaceChildren(failedOf(ps));return}
      const p=v.i?paymentOf(v.i,ps.items,txs.items||[]):null;
      if(!p){paid.replaceChildren(wait(B.noPayment));return}
      const tx=txOf(p,txs.items||[]);const fee=feeOf(p,tx);const ok=isPaid(p);
      const d=el('dl','read');d.append(el('dt','',B.fee),el('dd','',fee?[money(fee.currency,fee.amount),' ',el('small','muted',B.feeWhy)]:'—'));
      paid.replaceChildren(block('paid',ok?B.paid:B.payment,[el('p','amount',money(p.currency,p.amount)),el('p','',el('span','pill'+(ok?' ok':' bad'),String(p.status||''))),d],ok?'ok':'bad'));
    });
    Promise.all([reads,everyPage('/v1/ledger/entries')]).then(([[v,ps,txs],es])=>{
      if(S.screen!=='books')return;
      if(es.status!==200){booked.replaceChildren(failedOf(es));return}
      const p=v.i&&ps.items?paymentOf(v.i,ps.items,txs.items||[]):null;
      const mine=v.i?entriesOf(v.i,p,txs.items||[],es.items):[];
      if(!mine.length){booked.replaceChildren(wait(B.noLines));return}
      const bal=balance(mine);const head=headOf(es.items);
      const tb=el('tbody');
      for(const e of mine){const h=el('td','en',String(e.description||''));h.colSpan=3;tb.append(el('tr','',[h]));
        // Each account with its role (expense, VAT, creditors, bank: the chart's, cloud/src/try/books.ts), so the VAT line reads as the invoice's VAT line.
        for(const l of e.lines||[]){const ac=DIDACC[String(l.account||'')]||{};const role=ac.role?DIDC.roles[ac.role]:(ac.name||'');
          tb.append(el('tr',ac.role==='vat'?'vatl':'',[el('td','',[el('span','mono',String(l.account||'')),role?el('span','role',' · '+role):null]),el('td','r',l.debit_cents?money(l.currency,fromCents(l.debit_cents)):''),el('td','r',l.credit_cents?money(l.currency,fromCents(l.credit_cents)):'')]))}}
      const table=el('table','lines',[el('thead','',[el('tr','',[el('th','',B.account),el('th','r',B.debit),el('th','r',B.credit)])]),tb]);
      booked.replaceChildren(block('booked',B.booked,[el('div','scroll',table),el('p','bal '+(bal.even?'ok':'bad'),[icon(bal.even?'check':'triangle-alert',16),el('span','',bal.even?B.even:B.uneven)]),
        head?el('details','',[el('summary','',B.head),el('p','hash mono',[el('span','hl','#'+head.entry_id),' ',String(head.entry_hash||'')])]):null],bal.even?'ok':'bad'));
    });
  }
  // The archive is the engine's own (not the read model): read whether or not the books are in.
  Promise.all([inv,api('GET','/v1/engine/vault')]).then(async ([v,r])=>{
    if(S.screen!=='books')return;
    if(r.status!==200||!Array.isArray(r.json.files)){filed.replaceChildren(failedOf(r));return}
    const fs=v.i?filesOf(v.i,r.json.files,v.items):{original:null,receipts:[]};
    const want=[...(fs.original?[[B.original,fs.original]]:[]),...fs.receipts.map((f)=>[B.receipt,f])];
    if(!want.length){filed.replaceChildren(wait(B.noFiles));return}
    // Each file fetched with the session, then a link to its blob URL that opens it in a new tab.
    const got=await Promise.all(want.map(([,f])=>fetchFile('/v1/engine/vault/file?path='+encodeURIComponent(f.path))));
    if(S.screen!=='books')return;
    const list=el('ul','files');
    want.forEach(([label,f],k)=>{const g=got[k];
      if(g.status!==200||!g.blob){list.append(el('li','',[el('span','fl',label),note(words(g.json||{},B.failed))]));return}
      const a=el('a','file',[icon('file-text',20),el('span','fl',label),el('span','fn',fileName(f.path))]);a.href=blobUrl(g.blob);a.target='_blank';
      list.append(el('li','',a))});
    filed.replaceChildren(block('filed',B.filed,[list],'ok'));
  });
}});

// 6 Your company: the export as a file, start again, and the recorded real runs (links to the site's /runs, dated).
screen('company',{heading:C.company.heading,draw(box){
  const Y=C.company;const main=mainButton();main.set(Y.download,download);
  const line=el('p','muted',Y.line);
  // A new company: this one is forgotten in this tab (the server deletes it after 24 hours), and the start shown.
  const again=btn(Y.again);again.addEventListener('click',()=>{clearTimeout(renewTimer);renewTimer=null;forget();show('start')});
  const runs=el('ul','runs');
  for(const r of C.recorded){const a=el('a','',[el('span','rt',r.title),el('span','rd',fill(Y.recorded,{date:r.date}))]);a.href=RUNS+'#'+r.key;a.rel='noopener';a.target='_blank';runs.append(el('li','',a))}
  // What this visit did: filed, signed, paid (three icons, named for screen readers as one list).
  const did=el('ul','did',[['file-check',Y.didFiled],['scan-face',Y.didSigned],['circle-check',Y.didPaid]].map(([n,w])=>el('li','',[el('span','dic',icon(n,22)),el('span','',w)])));did.setAttribute('aria-label',Y.did);
  const proof=el('a','proofl',[el('span','',Y.proof),icon('external-link',14)]);proof.href=PROOF;proof.rel='noopener';proof.target='_blank';
  box.append(did,line,el('div','acts',[main.node,again,proof]),el('details','',[el('summary','',Y.runs),runs]));
  async function download(){
    main.off(Y.downloading);
    const g=await fetchFile('/v1/engine/export');
    if(S.screen!=='company')return;
    main.set(Y.download,download);
    if(g.status!==200||!g.blob){line.replaceChildren(el('span','note',words(g.json||{},Y.failed)));return}
    line.textContent=Y.line;
    const a=el('a');a.href=blobUrl(g.blob);a.download=g.name||'purser-test-company.json';a.hidden=true;box.append(a);a.click();a.remove();
  }
}});

// 5b What Purser did with it (cloud/src/try/books.ts): filed, booked, matched, then what next.
__DID__

// The visit is over: the company is gone, or the session could not be renewed.
for(const [name,words] of [['gone',C.gone],['ended',C.ended]])screen(name,{heading:words.heading,band:false,draw(box){
  const b=btn(words.button,true);b.addEventListener('click',()=>{forget();show('start')});box.append(b);
}});

// A reload returns to the screen the server's state calls for.
async function boot(){
  restore();
  if(!S.session){show('start');return}
  if(due()&&!(await renew()))return;
  armRenewal();
  const r=await api('GET','/v1/engine/invoices');
  if(!S.session)return;
  const items=r.status===200&&Array.isArray(r.json.items)?r.json.items:[];
  const last=items[items.length-1];
  // Signing and paying return where they were: the proposal and the kept signature are in this tab's state.
  if(S.screen==='company'){show('company');return}
  if(S.screen==='did'){show('did');return}
  if(S.screen==='books'&&S.settled){show('books',{settled:S.settled});return}
  if(S.screen==='pay'&&S.proposal){show('pay');return}
  if(S.screen==='approve'&&last){show('approve',{invoice:last});return}
  if(last)show('work',{kind:'reload',invoice:last});else show('invoice');
}
boot();
`;

const nonce = () => {
  const b = crypto.getRandomValues(new Uint8Array(18));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** The page: one document, its config in a meta tag (the origin and the passkey RP id, for the screens that sign). */
export function tryPage(n: string, cfg: { origin: string; rpId: string }): string {
  const copy = { band: BAND, steps: STEPS, start: START, invoice: INVOICE, work: WORK, fields: INVOICE_FIELDS, approve: APPROVE, proposal: PROPOSAL_FIELDS, method: METHOD, pay: PAY, books: BOOKS, company: COMPANY, recorded: RECORDED, gone: GONE, ended: ENDED, live: LIVE };
  const icons = { "key-round": MORE["key-round"], "circle-check": ICONS["circle-check"], landmark: ICONS.landmark, database: ICONS.database, "file-lock-2": ICONS["file-lock-2"],
    clock: ICONS.clock, check: ICONS.check, "triangle-alert": ICONS["triangle-alert"], "file-text": MORE["file-text"], download: MORE.download,
    feather: ICONS.feather, "arrow-right": ICONS["arrow-right"], sparkles: ICONS.sparkles, "scan-face": ICONS["scan-face"], "file-check": ICONS["file-check"],
    "external-link": ICONS["external-link"] };
  const script = SCRIPT.replace("__COPY__", () => json(copy)).replace("__EVENT_LINE__", () => EVENT_LINE_JS).replace("__SIGN__", () => SIGN_JS).replace("__BOOKS__", () => BOOKS_JS)
    .replace("__DID__", () => `${didGlobals(json)}\n${DID_KIT_JS}\n${DID_SCREEN_JS}`)
    .replace("__ICONS__", () => json(icons)).replace("__RUNS__", () => json(RUNS_URL)).replace("__PROOF__", () => json(PROOF_URL));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${ICON_LINKS}${PREVIEW_TAGS}
<meta name="color-scheme" content="light dark">
<meta name="purser-try" content="${escAttr(JSON.stringify(cfg))}">
<title>Purser · hands-on</title>
<style nonce="${n}">${CSS}${SCENE_CSS}${DID_CSS}${SITE_HEADER_CSS}</style></head><body>
${siteHeader("try")}
<div class="hero">${sceneSvg()}</div>
<main id="main"></main>
<p class="trust">${escAttr(START.trust)}</p>
<p class="sr" id="say" role="status" aria-live="polite"></p>
<script type="module" nonce="${n}">${script}</script>
</body></html>`;
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin", "permissions-policy": "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
};

/** GET /try: the page under the console's policy, with a fresh nonce. */
export function tryPageResponse(_req: Request, _url: URL, env: CloudEnv): Response {
  const n = nonce();
  return new Response(tryPage(n, { origin: env.origin, rpId: env.rpId }), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": consoleCsp(n) } });
}
