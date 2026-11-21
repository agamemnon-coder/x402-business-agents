// Ask Purser's page (/ask) and its button (/ask/button.js); redesigned 21 Nov as an agent's panel. The page is the
// chat: a header with Ask Purser's mark and whether Claude answers here, a short welcome with at most three suggestions
// (gone after the first question), the conversation (each answer with the reads the agent made, "Read invoices · 12
// rows", its citations as chips and how it was answered), and a composer with a paperclip and a drop zone for one file.
// It streams POST /v1/ask and draws every value as text (textContent, DOM nodes), never as markup: no answer, file name
// or source title can ever become HTML. One script and one style under the page's nonce; no inline handler, no other
// origin. /ask?embed=1 is the same chat without the site's header, for the button's panel (frame-ancestors 'self').
// The button is a module any page of this origin (or of the site, which passes /ask through, worker/src/tryEngine.ts)
// includes with <script type="module" src="/ask/button.js" nonce="…">: a floating "Ask Purser" button that opens the
// chat in a dialog (a same-origin frame), closed with Escape or its close button, focus returned to the button.
import { header, TOKENS } from "../../../src/redesign/ui.js";
import { ICON_LINKS } from "../brand.js";
import { SITE_HEADER_CSS, TRY_HEADER_LINKS } from "../siteHeader.js";
import { ATTACH_MAX_BYTES, ATTACH_TYPES } from "./attach.js";
import { ASK_COPY, QUESTION_MAX, SUGGESTIONS } from "./core.js";
import { ASK_CONTEXT_KINDS, ASK_NAV, CONTEXT_ID, CONTEXT_JS, OPEN_APPROVAL, approvalHash, contextLabel, parseContext, quickActions, type AskContext } from "./context.js";

export const ASK_PATH = "/ask";
export const ASK_BUTTON_PATH = "/ask/button.js";

/** Every word of the page (tests and the browser check read them). */
export const ASK_PAGE_COPY = {
  title: "Ask Purser",
  lede: "An agent that answers questions about Purser from its public docs and reads the demo company's records, read-only, with a link to each source.",
  statusLive: "Agent · reads docs and demo data · read-only",
  statusDocs: "Docs-only mode: live AI answers aren't switched on here yet.",
  helloHead: "Ask anything about Purser",
  helloText: "It searches Purser's docs and reads the demo company's records (made-up data). Attach an invoice or a CSV to ask about it.",
  scope: "It can't pay, approve, change a limit or see a real company's data. If the sources don't say, it says so.",
  privacy: "Nothing you type or attach is stored: only hourly counts. Answers can be wrong; the linked sources are what counts.",
  placeholder: "Ask about Purser, or attach a file",
  label: "Your question",
  send: "Ask",
  sending: "Answering…",
  thinking: "Thinking…",
  newChat: "New chat",
  close: "Close Ask Purser",
  full: "Open in a new tab",
  suggestionsHead: "Suggestions",
  you: "You",
  purser: "Ask Purser",
  sources: "Sources",
  related: "Related in the docs",
  attach: "Attach a file",
  attachHint: "PDF, CSV, text or a picture, up to 5 MB",
  drop: "Drop the file to attach it",
  removeFile: "Remove the file",
  fileTooBig: "That file is larger than 5 MB.",
  fileType: "That kind of file can't be attached: a PDF, a CSV or text file, or a PNG, JPEG, WebP or GIF picture.",
  fileRead: "That file could not be read.",
  live: "Answered by Claude (Haiku) from Purser's docs and the demo company's records. Each claim links to its source.",
  docs: "Answered from Purser's docs without AI.",
  records: "Read by Purser's code from the demo company's records, without AI.",
  refused: "Answered by Purser's own code.",
  demo: "demo data",
  error: "The answer could not be fetched. Check your connection and ask again.",
  counter: "characters left",
  testMoney: ASK_COPY.testMoney,
  viewing: "Viewing",
  demoCompany: "demo company, made-up data",
  ownCompany: "your company: Ask Purser reads the demo company only",
  quick: "Quick actions",
  fab: "Ask Purser",
  fabHint: "Questions? Ask Purser",
} as const;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

// ---- Ask Purser's mark: Purser's feather on its ink square, with a small spark for "ask" ----

type El = [tag: string, attrs: Record<string, string>];
const FEATHER = ["M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z", "M16 8 2 22", "M17.5 15H9"];
/** The mark on a 32 grid, as elements: drawn as markup on the page and as DOM by the button (one source for both). */
export const ASK_MARK: El[] = [
  ["rect", { width: "32", height: "32", rx: "9", fill: "#0b1220" }],
  ["rect", { x: ".5", y: ".5", width: "31", height: "31", rx: "8.5", fill: "none", stroke: "#ffffff", "stroke-opacity": ".14" }],
  ...FEATHER.map((d): El => ["path", { d, transform: "translate(4.4 8) scale(.76)", fill: "none", stroke: "#ffffff", "stroke-width": "2.1", "stroke-linecap": "round", "stroke-linejoin": "round" }]),
  ["path", { d: "M24.5 4.2c.5 2.3 1.9 3.8 4.2 4.3-2.3.5-3.7 2-4.2 4.3-.5-2.3-1.9-3.8-4.2-4.3 2.3-.5 3.7-2 4.2-4.3Z", fill: "#a5a1ff" }],
];
const svgOf = (els: El[], size: number, viewBox: string, cls = "") =>
  `<svg${cls ? ` class="${cls}"` : ""} width="${size}" height="${size}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${els.map(([t, a]) => `<${t} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("")}</svg>`;
export const askMarkSvg = (size = 32, cls = "") => svgOf(ASK_MARK, size, "0 0 32 32", cls);

/** Small line icons (24 grid, stroke currentColor). */
const ICON: Record<string, string[]> = {
  plus: ["M12 5v14", "M5 12h14"],
  out: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  clip: ["m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"],
  up: ["M12 19V5", "m5 12 7-7 7 7"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"],
};
const icon = (name: string, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]!.map((d) => `<path d="${d}"/>`).join("")}</svg>`;

const CSS = `${TOKENS.replace("url(assets/", "url(/assets/")}
:root { --warn: #b45309; --bubble: var(--text); --on-bubble: var(--bg); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --warn: #fbbf24; --bubble: #2a2f3d; --on-bubble: #eef1f6; } }
:root[data-theme="dark"] { --warn: #fbbf24; --bubble: #2a2f3d; --on-bubble: #eef1f6; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; height: 100%; }
body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font: 400 15px/1.55 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; display: flex; flex-direction: column; }
body.embed { background: var(--surface); height: 100%; overflow: hidden; }
.sr { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; padding: 0; border: 0; }
.skip { position: absolute; left: -9999px; } .skip:focus { left: 12px; top: 12px; z-index: 50; background: var(--surface); padding: 8px 12px; border-radius: 8px; }
.app { position: relative; width: 100%; max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; flex: 1; min-height: 0; }
body.page .app { padding: 0 var(--gut, 16px); }
body.page .shell { border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow); margin: 16px 0 24px; display: flex; flex-direction: column; height: max(480px, min(820px, calc(100dvh - 170px))); overflow: hidden; }
body.embed .shell { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; }
/* Header */
.bar { display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 14px; border-bottom: 1px solid var(--border); background: var(--surface); }
.bar .logo { flex: none; display: block; border-radius: 9px; }
.bar .grow { flex: 1; min-width: 0; }
h1 { font-size: 15px; line-height: 1.25; letter-spacing: -.01em; margin: 0; font-weight: 700; }
.status { display: flex; align-items: center; gap: 6px; margin: 1px 0 0; font-size: 12.5px; line-height: 1.35; color: var(--muted); min-width: 0; }
.status span:last-child { overflow-wrap: anywhere; }
.dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 18%, transparent); }
.dot.docs { background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 18%, transparent); }
.ib { flex: none; width: 36px; height: 36px; border-radius: 10px; border: 0; background: transparent; color: var(--muted); display: inline-grid; place-items: center; cursor: pointer; text-decoration: none; padding: 0; }
.ib:hover { background: var(--sunken); color: var(--text); }
/* The conversation */
.scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 16px 12px; scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { .scroll { scroll-behavior: auto; } }
.hello { padding: 28px 4px 8px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.hello h2 { font-size: 20px; line-height: 1.25; letter-spacing: -.015em; margin: 10px 0 0; font-weight: 700; }
.hello p { margin: 0; color: var(--muted); font-size: 14.5px; max-width: 54ch; }
.hello .scope { font-size: 13px; color: var(--faint); }
.sugg { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; width: 100%; }
.chip { width: 100%; min-height: 40px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 12px; padding: 8px 12px; font: 500 14px/1.35 Inter, system-ui, sans-serif; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.chip::after { content: "→"; margin-left: auto; color: var(--faint); flex: none; }
.chip:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: var(--accent-soft); }
.chat { display: flex; flex-direction: column; gap: 18px; padding-top: 14px; }
.chat:empty { display: none; }
.msg { min-width: 0; overflow-wrap: anywhere; }
.msg.you { align-self: flex-end; max-width: 86%; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.msg.you .txt { background: var(--bubble); color: var(--on-bubble); border-radius: 18px 18px 6px 18px; padding: 9px 14px; white-space: pre-wrap; }
.msg.bot { align-self: stretch; display: grid; grid-template-columns: 26px minmax(0, 1fr); column-gap: 10px; }
.msg.bot > .av { grid-row: 1 / span 4; padding-top: 1px; }
.msg.bot > :not(.av) { grid-column: 2; min-width: 0; }
.who { font-size: 12px; font-weight: 650; color: var(--muted); margin: 2px 0 4px; display: block; }
.msg.you .who { display: none; }
.body p { margin: 0 0 8px; } .body p:last-child { margin-bottom: 0; }
.body ul, .body ol { margin: 0 0 8px; padding-left: 20px; } .body li { margin: 2px 0; } .body li::marker { color: var(--faint); }
.body strong { font-weight: 650; }
.body code { font: 500 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--sunken); border-radius: 5px; padding: 1px 4px; }
.body a { color: var(--accent); }
.nw { white-space: nowrap; }
.cite { display: inline-grid; place-items: center; min-width: 17px; height: 17px; padding: 0 4px; margin: 0 1px; border-radius: 6px; font: 650 10.5px/1 Inter, system-ui, sans-serif; text-decoration: none; color: var(--accent); background: var(--accent-soft); vertical-align: 2px; }
.cite.data { color: var(--muted); background: var(--sunken); }
a.cite:hover { background: var(--accent); color: #fff; }
.thinking { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13.5px; }
.typing { display: inline-flex; gap: 4px; } .typing i { width: 5px; height: 5px; border-radius: 50%; background: var(--faint); animation: blink 1.2s infinite; } .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
/* The agent's reads */
.steps { list-style: none; margin: 0 0 8px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--sunken); display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; line-height: 1.4; color: var(--muted); }
.steps:empty { display: none; }
.step { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }
.step .si { flex: none; width: 14px; height: 14px; margin-top: 2px; border-radius: 50%; display: inline-grid; place-items: center; }
.step.done .si { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
.step.done .si::before { content: ""; width: 6px; height: 3px; border-left: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-1px) rotate(-45deg); }
.step.err .si { background: color-mix(in srgb, var(--warn) 18%, transparent); }
.step.err .si::before { content: ""; width: 6px; height: 1.5px; background: var(--warn); }
.step.run .si { border: 1.5px solid var(--border); border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .typing i, .step.run .si { animation: none; } .typing i { opacity: .8; } }
.step .sl { color: var(--text); font-weight: 550; }
.step .sd { color: var(--faint); }
.step .tx { min-width: 0; overflow-wrap: anywhere; }
/* Sources and how it was answered */
.meta { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.mh { font-size: 11.5px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--faint); }
.meta ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.meta li { min-width: 0; max-width: 100%; }
.src { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 28px; padding: 3px 10px 3px 4px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); text-decoration: none; font-size: 12.5px; line-height: 1.3; }
.src b { flex: none; display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11px; }
.src.data b { background: var(--sunken); color: var(--muted); }
.src span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
a.src:hover { border-color: var(--accent); }
.how { font-size: 12px; color: var(--faint); }
.note { font-size: 12.5px; color: var(--muted); margin: 0; }
.msg.err .body { color: var(--bad); }
/* The composer */
.composer { position: relative; padding: 10px 12px 10px; border-top: 1px solid var(--border); background: var(--surface); }
.box { border: 1px solid var(--border); border-radius: 16px; background: var(--bg); padding: 6px 6px 6px 12px; display: flex; flex-direction: column; gap: 4px; transition: border-color .15s, box-shadow .15s; }
.box:focus-within { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
textarea { width: 100%; resize: none; min-height: 24px; max-height: 160px; border: 0; outline: 0; padding: 6px 0 2px; font: 400 16px/1.45 Inter, system-ui, sans-serif; color: var(--text); background: transparent; }
textarea::placeholder { color: var(--faint); }
.row { display: flex; align-items: center; gap: 6px; }
.row .grow { flex: 1; min-width: 0; }
.count { font-size: 12px; color: var(--faint); }
.send { flex: none; width: 36px; height: 36px; border-radius: 11px; border: 0; background: var(--text); color: var(--bg); display: inline-grid; place-items: center; cursor: pointer; }
.send:disabled { opacity: .35; cursor: default; }
.clip { margin-left: -8px; }
.att { align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; max-width: 100%; margin: 4px 0 2px; padding: 5px 4px 5px 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font-size: 13px; }
.att .fn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.att .fs { flex: none; color: var(--faint); font-size: 12px; }
.att .ib { width: 26px; height: 26px; border-radius: 7px; }
.fileline { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; font-size: 12.5px; color: var(--muted); }
.fileline span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ferr { font-size: 12.5px; color: var(--bad); margin: 4px 2px 0; }
.drop { position: absolute; inset: 6px; z-index: 5; border: 2px dashed var(--accent); border-radius: 18px; background: color-mix(in srgb, var(--surface) 88%, var(--accent-soft)); display: grid; place-items: center; font-weight: 650; color: var(--accent); pointer-events: none; text-align: center; padding: 12px; }
.foot { font-size: 11.5px; line-height: 1.4; color: var(--faint); margin: 7px 2px 0; }
.btn-focus, .chip:focus-visible, .ib:focus-visible, .send:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.lede { color: var(--muted); margin: 18px 0 0; font-size: 15px; }
/* In context (./context.ts): what the person views, three quick actions for it, and the page where the CFO approves. */
.ctxbar { padding: 10px 12px 0; border-top: 1px solid var(--border); background: var(--surface); display: grid; gap: 8px; }
.ctx-now { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12.5px; color: var(--muted); min-width: 0; }
.ctx-now .ctx-k { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
.ctx-now b { color: var(--text); font-weight: 650; overflow-wrap: anywhere; }
.ctx-now .ctx-d { color: var(--faint); }
.qa { display: flex; flex-wrap: wrap; gap: 6px; }
.qa button, .qa a { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font: 600 13px/1.2 Inter, system-ui, sans-serif; cursor: pointer; text-decoration: none; }
.qa button:hover, .qa a:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); background: var(--accent-soft); }
.qa button:disabled { opacity: .5; cursor: default; }
.qa .qa-go { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); color: var(--accent); }
.qa .qa-go::after { content: "→"; }
body.has-ctx .sugg { display: none; }
@media (max-width: 520px) { .msg.you { max-width: 92%; } .hello { padding-top: 18px; } body.page .lede { display: none; } body.page .shell { margin: 10px 0 12px; border-radius: 16px; height: max(460px, calc(100dvh - 96px)); } }
`;

// The page's script: plain JavaScript, raw (no TS escapes), with the copy and the settings put in where it says so.
const SCRIPT = String.raw`
const C = __COPY__, CFG = __CFG__;
__CONTEXT__
const $ = (id) => document.getElementById(id);
const chat = $('chat'), form = $('ask'), q = $('q'), send = $('send'), say = $('say'), count = $('count'), hello = $('hello'), scroller = $('scroll');
const fileIn = $('file'), att = $('att'), fname = $('fname'), fsize = $('fsize'), unatt = $('unatt'), ferr = $('ferr'), drop = $('drop'), statusDot = $('sdot'), statusText = $('stext');
const KEY = 'purser.ask';
let history = [];
let busy = false;
let pending = null;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const okHost = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && CFG.hosts.some((h) => (x.host + x.pathname).startsWith(h)); } catch (e) { return false; } };
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-12))); } catch (e) {} }
function setLive(live) { statusDot.className = 'dot' + (live ? '' : ' docs'); statusText.textContent = live ? C.statusLive : C.statusDocs; }
const kb = (n) => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

// A citation [n]: a chip linking to its passage (a record of the demo company is a chip, not a link).
function cite(n, sources) {
  const s = sources[n - 1];
  if (!s) return document.createTextNode('[' + n + ']');
  const docLink = s.kind !== 'data' && okHost(s.url);
  const a = el(docLink ? 'a' : 'span', 'cite' + (s.kind === 'data' ? ' data' : ''), String(n));
  if (docLink) { a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Source ' + n + ': ' + s.title + ' (opens in a new tab)'); }
  else { a.setAttribute('role', 'note'); a.setAttribute('aria-label', 'Source ' + n + ': ' + s.title); }
  a.title = s.title;
  return a;
}
// One line of an answer as text: citations [n] as chips, **bold**, ` + "`code`" + String.raw`, and links to Purser's own sites as links.
function inline(parent, text, sources) {
  const re = /\[(\d{1,2})\]|\*\*([^*\n]{1,120})\*\*|` + "`([^`\\n]{1,80})`" + String.raw`|https?:\/\/[^\s)<>\]]+/g;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) parent.append(text.slice(at, m.index));
    if (m[1]) {
      // A citation keeps the punctuation after it on its line ("code [1]." never breaks before the full stop).
      const punct = /^[.,;:!?)]+/.exec(text.slice(m.index + m[0].length));
      const nw = el('span', 'nw'); nw.append(cite(Number(m[1]), sources));
      if (punct) { nw.append(punct[0]); re.lastIndex += punct[0].length; }
      parent.append(nw);
      at = re.lastIndex; continue;
    }
    else if (m[2]) parent.append(el('strong', null, m[2]));
    else if (m[3]) parent.append(el('code', null, m[3]));
    else {
      const u = m[0].replace(/[.,;:]+$/, ''); const tail = m[0].slice(u.length);
      if (okHost(u)) { const a = el('a', null, u); a.href = u; a.target = '_blank'; a.rel = 'noopener'; parent.append(a); } else parent.append(u);
      if (tail) parent.append(tail);
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) parent.append(text.slice(at));
}
// The answer's text as paragraphs, "- " lists and "1. " steps.
function draw(box, text, sources) {
  box.textContent = '';
  let list = null, kind = '';
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s+/.exec(line), num = /^\d{1,2}[.)]\s+/.exec(line);
    const item = bullet || num;
    if (item) {
      const k = bullet ? 'ul' : 'ol';
      if (!list || kind !== k) { list = el(k); kind = k; box.append(list); }
      const li = el('li'); inline(li, line.slice(item[0].length), sources); list.append(li);
    } else { list = null; const p = el('p'); inline(p, line, sources); box.append(p); }
  }
}
function avatar() { const t = $('mark'); const s = t.content.firstElementChild.cloneNode(true); s.setAttribute('width', '26'); s.setAttribute('height', '26'); const d = el('div', 'av'); d.append(s); return d; }
function fileLine(name) { const f = el('span', 'fileline'); const ic = $('fileicon').content.firstElementChild.cloneNode(true); f.append(ic, el('span', null, name)); return f; }
function bubble(role, text, file) {
  const m = el('div', 'msg ' + (role === 'user' ? 'you' : 'bot'));
  if (role === 'user') {
    m.append(el('span', 'who', C.you));
    if (file) m.append(fileLine(file));
    m.append(el('div', 'txt', text));
  } else { m.append(avatar(), el('span', 'who', C.purser)); const b = el('div', 'body'); m.append(b); draw(b, text, []); }
  chat.append(m);
  return m;
}
function meta(m, sources, cited, mode, note, reason) {
  const box = el('div', 'meta');
  const shown = cited.length ? cited.map((n) => sources[n - 1]).filter(Boolean) : sources.filter((s) => s.kind !== 'data').slice(0, 3);
  if (shown.length) {
    box.append(el('span', 'mh', cited.length ? C.sources : C.related));
    const ol = el('ol');
    for (const s of shown) {
      const li = el('li');
      const link = s.kind !== 'data' && okHost(s.url);
      const a = el(link ? 'a' : 'span', 'src' + (s.kind === 'data' ? ' data' : ''));
      if (link) { a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; }
      a.title = s.title;
      a.append(el('b', null, String(s.n)), el('span', null, s.title + (s.kind === 'data' ? ' (' + C.demo + ')' : '')));
      li.append(a); ol.append(li);
    }
    box.append(ol);
  }
  if (note) box.append(el('p', 'note', note));
  box.append(el('span', 'how', (mode === 'live' ? C.live : mode === 'refused' ? C.refused : mode === 'records' ? C.records : C.docs) + (reason && mode !== 'live' && mode !== 'refused' ? ' ' + reason : '')));
  m.append(box);
}
function step(list, ev) {
  let li = list.querySelector('[data-id="' + ev.id + '"]');
  if (!li) { li = el('li', 'step'); li.dataset.id = ev.id; li.append(el('span', 'si'), el('span', 'tx')); list.append(li); }
  li.className = 'step ' + (ev.state === 'run' ? 'run' : ev.ok ? 'done' : 'err');
  const tx = li.querySelector('.tx'); tx.textContent = '';
  tx.append(el('span', 'sl', ev.label || C.thinking));
  if (ev.detail) tx.append(el('span', 'sd', ' · ' + ev.detail));
}
function scroll() { scroller.scrollTop = scroller.scrollHeight; }
function counter() { const left = CFG.max - q.value.length; count.textContent = left < 120 ? left + ' ' + C.counter : ''; }
function grow() { q.style.height = ''; if (q.value) q.style.height = Math.min(q.scrollHeight, 160) + 'px'; }
function ready() { send.disabled = busy || (!q.value.trim()); for (const b of document.querySelectorAll('#qa button[data-q]')) b.disabled = busy; }

// One file, checked here first (the server checks again): its type, its size, then read as base64 in this tab only.
const EXT = { pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
function clearFile() { pending = null; att.hidden = true; fname.textContent = ''; fsize.textContent = ''; fileIn.value = ''; }
function fileError(msg) { ferr.textContent = msg; ferr.hidden = !msg; }
function take(f) {
  fileError('');
  if (!f) return;
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const type = CFG.types.includes(f.type) ? f.type : EXT[ext];
  if (!type) { clearFile(); fileError(C.fileType); return; }
  if (f.size > CFG.maxBytes) { clearFile(); fileError(C.fileTooBig); return; }
  const r = new FileReader();
  r.onload = () => {
    const s = String(r.result || ''); const i = s.indexOf(',');
    if (i < 0) { fileError(C.fileRead); return; }
    pending = { name: f.name, type, data: s.slice(i + 1) };
    fname.textContent = f.name; fsize.textContent = kb(f.size); att.hidden = false; ready(); q.focus();
  };
  r.onerror = () => fileError(C.fileRead);
  r.readAsDataURL(f);
}

async function ask(question) {
  question = question.trim();
  if (!question || busy) return;
  const file = pending;
  busy = true; ready(); q.value = ''; counter(); grow(); clearFile(); fileError('');
  hello.hidden = true;
  bubble('user', question, file && file.name);
  const m = el('div', 'msg bot'); m.setAttribute('aria-busy', 'true');
  m.append(avatar(), el('span', 'who', C.purser));
  const steps = el('ol', 'steps'); steps.setAttribute('aria-label', 'What the agent read');
  const body = el('div', 'body');
  const wait = el('span', 'thinking'); const dots = el('span', 'typing'); dots.setAttribute('aria-hidden', 'true'); dots.append(el('i'), el('i'), el('i')); wait.append(dots, el('span', null, C.thinking)); body.append(wait);
  m.append(steps, body);
  chat.append(m); scroll();
  say.textContent = C.sending;
  let text = '', sources = [], done = null, settled = false;
  try {
    const payload = { question, history: history.slice(-6).map((t) => ({ role: t.role, text: t.text })) };
    if (CTX) payload.context = CTX;
    if (file) payload.attachment = { name: file.name, type: file.type, data: file.data };
    const r = await fetch('/v1/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok || !r.body) {
      let msg = C.error; try { const j = await r.json(); if (j && (j.message || j.error)) msg = j.message || j.error; } catch (e) {}
      throw new Error(msg);
    }
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done: end } = await rd.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'meta') { sources = ev.sources || []; if (typeof ev.live === 'boolean') setLive(ev.live); }
        else if (ev.type === 'source' && ev.source) sources.push(ev.source);
        else if (ev.type === 'step') { step(steps, ev); if (!text) { body.textContent = ''; body.append(wait); } scroll(); }
        else if (ev.type === 'delta') { text += ev.text; draw(body, text, sources); scroll(); }
        else if (ev.type === 'reset') { text = ev.text; if (text) draw(body, text, sources); else { body.textContent = ''; body.append(wait); } }
        else if (ev.type === 'done') done = ev;
      }
    }
    if (!done) throw new Error(C.error);
    draw(body, text, sources);
    meta(m, sources, done.cited || [], done.mode, done.note, done.reason);
    history.push({ role: 'user', text: question, file: file ? file.name : null }, { role: 'assistant', text: text.slice(0, 1200) });
    save();
    say.textContent = C.purser + ': ' + text.replace(/\[(\d{1,2})\]/g, '').replace(/\*\*/g, '');
    // A long answer: its question at the top of the view, so it reads from its start.
    if (m.offsetHeight > scroller.clientHeight * 0.8 && m.previousElementSibling) { m.previousElementSibling.scrollIntoView({ block: 'start' }); settled = true; }
  } catch (e) {
    draw(body, (e && e.message) || C.error, []);
    m.classList.add('err');
    say.textContent = (e && e.message) || C.error;
  } finally {
    m.removeAttribute('aria-busy');
    busy = false; ready(); if (!settled) scroll(); q.focus({ preventScroll: true });
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); ask(q.value); });
q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(q.value); } });
q.addEventListener('input', () => { counter(); grow(); ready(); });
fileIn.addEventListener('change', () => take(fileIn.files && fileIn.files[0]));
$('clip').addEventListener('click', () => fileIn.click());
unatt.addEventListener('click', () => { clearFile(); fileError(''); q.focus(); });
// A file dropped anywhere on the chat.
let depth = 0;
const hasFile = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
document.addEventListener('dragenter', (e) => { if (!hasFile(e)) return; e.preventDefault(); depth++; drop.hidden = false; });
document.addEventListener('dragover', (e) => { if (hasFile(e)) e.preventDefault(); });
document.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.hidden = true; });
document.addEventListener('drop', (e) => { if (!hasFile(e)) return; e.preventDefault(); depth = 0; drop.hidden = true; take(e.dataTransfer.files[0]); });
for (const b of hello.querySelectorAll('button[data-q]')) b.addEventListener('click', () => ask(b.dataset.q));
// The page Ask Purser is open on (./context.ts): from the address on load, then from the console's button as the person
// moves (a message from the frame's own parent, this origin only). Three quick actions fit it; an approval is the CFO's,
// on its own page: the panel can open that page, never act.
let CTX = parseCtx(CFG.ctx);
const ctxbar = $('ctxbar');
function drawCtx() {
  document.body.classList.toggle('has-ctx', !!CTX);
  if (!ctxbar) return;
  ctxbar.hidden = !CTX; if (!CTX) return;
  $('ctxl').textContent = ctxLabel(CTX); $('ctxd').textContent = '· ' + (CTX.demo ? C.demoCompany : C.ownCompany);
  const qa = $('qa'); qa.textContent = '';
  for (const x of quickOf(CTX)) { const b = el('button', null, x.label); b.type = 'button'; b.dataset.q = x.q; b.dataset.k = x.key; b.addEventListener('click', () => ask(x.q)); qa.append(b); }
  const hash = CFG.embed ? approvalOf(CTX) : null;
  if (hash) { const a = el('button', 'qa-go', QUICK.open); a.type = 'button'; a.addEventListener('click', () => { try { parent.postMessage({ type: 'purser-ask:navigate', hash }, location.origin); } catch (e) {} }); qa.append(a); }
}
drawCtx();
addEventListener('message', (e) => { if (e.origin !== location.origin || e.source !== parent || !e.data || e.data.type !== 'purser-ask:context') return; CTX = parseCtx(e.data.ctx); drawCtx(); });
const reset = $('reset');
if (reset) reset.addEventListener('click', () => { history = []; save(); chat.textContent = ''; hello.hidden = false; say.textContent = ''; clearFile(); fileError(''); q.focus(); });
const close = $('close');
const bye = () => { try { parent.postMessage({ type: 'purser-ask:close' }, location.origin); } catch (e) {} };
if (close) close.addEventListener('click', bye);
if (CFG.embed) document.addEventListener('keydown', (e) => { if (e.key === 'Escape') bye(); });
// The conversation of this tab, if it had one.
try { const old = JSON.parse(sessionStorage.getItem(KEY) || '[]'); if (Array.isArray(old)) for (const t of old) if (t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string') { history.push(t); bubble(t.role, t.text, typeof t.file === 'string' ? t.file : null); } } catch (e) {}
if (history.length) { hello.hidden = true; scroll(); }
ready();
const pre = new URLSearchParams(location.search).get('q');
if (pre && pre.length <= CFG.max) ask(pre);
if (CFG.embed) q.focus();
`;

/** What the person views and its three quick actions, drawn as markup for the first paint (the script redraws it). */
function ctxBar(c: AskContext | null, embed: boolean): string {
  const C = ASK_PAGE_COPY;
  const hash = embed ? approvalHash(c) : null;
  const ASK_NAV_OK = hash ? ASK_NAV.test(hash) : false;
  return `<div class="ctxbar" id="ctxbar"${c ? "" : " hidden"}><p class="ctx-now"><span class="ctx-k">${esc(C.viewing)}</span><b id="ctxl">${c ? esc(contextLabel(c)) : ""}</b><span class="ctx-d" id="ctxd">${c ? esc(`· ${c.demo ? C.demoCompany : C.ownCompany}`) : ""}</span></p>`
    + `<div class="qa" id="qa" role="group" aria-label="${esc(C.quick)}">${c ? quickActions(c).map((x) => `<button type="button" data-q="${esc(x.q)}" data-k="${x.key}">${esc(x.label)}</button>`).join("") + (ASK_NAV_OK ? `<button type="button" class="qa-go">${esc(OPEN_APPROVAL)}</button>` : "") : ""}</div></div>`;
}

/** The page: the chat, standalone (the site's header) or embedded (?embed=1, a bar with a close button). `live`: Claude answers here now. */
export function askPage(n: string, o: { embed: boolean; live?: boolean; context?: AskContext | null }): string {
  const C = ASK_PAGE_COPY;
  const live = o.live ?? false;
  const ctx = o.context ?? null;
  const script = SCRIPT.replace("__CONTEXT__", () => CONTEXT_JS).replace("__COPY__", () => json(C)).replace("__CFG__", () => json({ embed: o.embed, ctx, max: QUESTION_MAX, maxBytes: ATTACH_MAX_BYTES, types: ATTACH_TYPES, hosts: ["github.com/agamemnon-coder/x402-business-agents", "kit11.max-31b.workers.dev", "purser-try.max-31b.workers.dev", "youtu.be/"] }));
  const bar = `<header class="bar">${askMarkSvg(32, "logo")}<div class="grow"><h1>${esc(C.title)}</h1><p class="status"><span class="dot${live ? "" : " docs"}" id="sdot" aria-hidden="true"></span><span id="stext">${esc(live ? C.statusLive : C.statusDocs)}</span></p></div>`
    + `<button class="ib" id="reset" type="button" aria-label="${esc(C.newChat)}" title="${esc(C.newChat)}">${icon("plus")}</button>`
    + (o.embed ? `<a class="ib" href="${ASK_PATH}" target="_blank" rel="noopener" aria-label="${esc(C.full)}" title="${esc(C.full)}">${icon("out", 17)}</a><button class="ib" id="close" type="button" aria-label="${esc(C.close)}" title="${esc(C.close)}">${icon("x")}</button>` : "")
    + `</header>`;
  const helloBlock = `<section class="hello" id="hello" aria-labelledby="hh">${askMarkSvg(44)}<h2 id="hh">${esc(C.helloHead)}</h2><p>${esc(C.helloText)}</p><p class="scope">${esc(C.scope)}${o.embed ? "" : ` ${esc(C.testMoney)}`}</p>`
    + `<h3 class="sr">${esc(C.suggestionsHead)}</h3><ul class="sugg">${SUGGESTIONS.slice(0, 3).map((s) => `<li><button class="chip" type="button" data-q="${esc(s)}">${esc(s)}</button></li>`).join("")}</ul></section>`;
  const composer = `<form class="composer" id="ask" autocomplete="off"><div class="drop" id="drop" hidden>${esc(C.drop)}</div><div class="box">`
    + `<div class="att" id="att" hidden>${icon("file", 16)}<span class="fn" id="fname"></span><span class="fs" id="fsize"></span><button class="ib" id="unatt" type="button" aria-label="${esc(C.removeFile)}" title="${esc(C.removeFile)}">${icon("x", 14)}</button></div>`
    + `<label class="sr" for="q">${esc(C.label)}</label><textarea id="q" name="q" rows="1" maxlength="${QUESTION_MAX}" placeholder="${esc(C.placeholder)}" aria-describedby="foot"></textarea>`
    + `<div class="row"><button class="ib clip" id="clip" type="button" aria-label="${esc(`${C.attach} (${C.attachHint})`)}" title="${esc(`${C.attach}: ${C.attachHint}`)}">${icon("clip", 18)}</button><input class="sr" type="file" id="file" accept=".pdf,.csv,.txt,${ATTACH_TYPES.join(",")}" tabindex="-1" aria-hidden="true">`
    + `<span class="grow"><span class="count" id="count" aria-live="polite"></span></span><button class="send" id="send" type="submit" aria-label="${esc(C.send)}" title="${esc(C.send)}">${icon("up", 18)}</button></div></div>`
    + `<p class="ferr" id="ferr" role="alert" hidden></p><p class="foot" id="foot">${esc(C.privacy)}</p></form>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${ICON_LINKS}
<meta name="color-scheme" content="light dark">
<meta name="description" content="${esc(C.lede)}">
<title>${esc(C.title)} · Purser</title>
<style nonce="${n}">${CSS}${o.embed ? "" : SITE_HEADER_CSS}</style></head><body class="${o.embed ? "embed" : "page"}${ctx ? " has-ctx" : ""}">
${o.embed ? "" : `<a class="skip" href="#q">Skip to the question box</a>${header(null, TRY_HEADER_LINKS)}`}
<main id="main" class="app">${o.embed ? "" : `<p class="lede">${esc(C.lede)}</p>`}
<div class="shell">${bar}
<div class="scroll" id="scroll">${helloBlock}<div class="chat" id="chat" role="log" aria-label="Conversation"></div></div>
${ctxBar(ctx, o.embed)}
${composer}</div>
</main>
<template id="mark">${askMarkSvg(26)}</template><template id="fileicon">${icon("file", 14)}</template>
<p class="sr" id="say" role="status" aria-live="polite"></p>
<script type="module" nonce="${n}">${script}</script>
</body></html>`;
}

/** The page's policy: its own nonce, this origin only, and framed only by this origin (the button's panel). */
export const askCsp = (n: string) =>
  `default-src 'none'; script-src 'nonce-${n}'; style-src 'nonce-${n}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`;

/**
 * The button (/ask/button.js, and inlined at the end of the console's one script): a floating button and the dialog
 * that holds the chat. One block, so it shares no name with a script it is added to. As a module of its own:
 *   <script type="module" src="/ask/button.js" nonce="..."></script>
 * Its style carries the page's nonce (read from its own tag, else from the page's nonce'd script).
 */
export const ASK_BUTTON_JS = `{ // Ask Purser's button (cloud/src/ask/page.ts): one floating button; the chat opens in a dialog, framed from this page's own origin (the site passes /ask through).
const C = ${json({ fab: ASK_PAGE_COPY.fab, hint: ASK_PAGE_COPY.fabHint, close: ASK_PAGE_COPY.close, title: ASK_PAGE_COPY.title })};
const ORIGIN = location.origin;
const NAV = ${ASK_NAV.toString()}, KINDS = ${json(ASK_CONTEXT_KINDS)}, CID = ${CONTEXT_ID.toString()};
// The page the person views, as the host page says it (data-ask-kind, data-ask-id, data-ask-demo on <body>), checked.
const ctxNow = () => { const d = document.body.dataset; if (!d.askKind || !KINDS.includes(d.askKind)) return null; const c = { kind: d.askKind }; if (d.askId && CID.test(d.askId)) c.id = d.askId; if (d.askDemo === '1') c.demo = true; return c; };
if (!document.getElementById('pask-fab')) {
  const me = document.querySelector('script[src*="/ask/button.js"]') || document.querySelector('script[nonce]');
  const nonce = (me && me.nonce) || '';
  const st = document.createElement('style');
  if (nonce) st.nonce = nonce;
  st.textContent = \`
#pask-fab{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483000;display:inline-flex;align-items:center;gap:9px;min-height:46px;padding:0 16px 0 7px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:#0b1220;color:#fff;font:650 14.5px/1.2 Inter,system-ui,-apple-system,sans-serif;letter-spacing:-.005em;box-shadow:0 10px 28px -8px rgba(11,18,32,.45),0 2px 6px rgba(11,18,32,.18);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease}
#pask-fab:hover{transform:translateY(-1px);box-shadow:0 14px 32px -8px rgba(11,18,32,.5),0 2px 6px rgba(11,18,32,.2)}#pask-fab:focus-visible{outline:3px solid #8b85ff;outline-offset:3px}
#pask-fab svg{flex:none;display:block}
#pask-fab[aria-expanded="true"]{background:#1d2333}
#pask-panel{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(74px,calc(env(safe-area-inset-bottom) + 74px));z-index:2147483001;width:min(440px,calc(100vw - 32px));height:min(680px,calc(100vh - 106px));border-radius:20px;overflow:hidden;border:1px solid rgba(127,127,127,.22);background:#fff;box-shadow:0 28px 72px -16px rgba(11,18,32,.45),0 4px 14px rgba(11,18,32,.12)}
#pask-panel iframe{display:block;width:100%;height:100%;border:0;background:transparent}
@media (prefers-color-scheme: dark){#pask-panel{background:#12151d;border-color:#262b37}#pask-fab{background:#1b2030;border-color:#2c3242}}
@media (max-width:560px){#pask-panel{inset:0;width:100%;height:100%;border-radius:0;border:0}#pask-fab .pask-t{display:none}#pask-fab{padding:0 7px}}
@media (prefers-reduced-motion: reduce){#pask-fab{transition:none}#pask-fab:hover{transform:none}}
@media print{#pask-fab,#pask-panel{display:none}}\`;
  document.head.append(st);
  const fab = document.createElement('button');
  fab.id = 'pask-fab'; fab.type = 'button';
  fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'pask-panel');
  fab.title = C.hint;
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of [['width', '32'], ['height', '32'], ['viewBox', '0 0 32 32'], ['aria-hidden', 'true'], ['focusable', 'false']]) svg.setAttribute(k, v);
  for (const [tag, a] of ${json(ASK_MARK)}) { const e = document.createElementNS(NS, tag); for (const k of Object.keys(a)) e.setAttribute(k, a[k]); svg.append(e); }
  fab.append(svg);
  const t = document.createElement('span'); t.className = 'pask-t'; t.textContent = C.fab; fab.append(t);
  fab.setAttribute('aria-label', C.hint);
  let panel = null;
  const close = () => {
    if (!panel || panel.hidden) return;
    panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.hidden = false; fab.focus();
  };
  const open = () => {
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'pask-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', C.title);
      const f = document.createElement('iframe');
      const cx = ctxNow(), qs = cx ? '&ctx=' + encodeURIComponent(cx.kind) + (cx.id ? '&id=' + encodeURIComponent(cx.id) : '') + (cx.demo ? '&demo=1' : '') : '';
      f.src = ORIGIN + '/ask?embed=1' + qs; f.title = C.title; f.setAttribute('allow', 'clipboard-write');
      panel.append(f);
      document.body.append(panel);
      f.addEventListener('load', () => { try { f.contentWindow.focus(); } catch (e) {} });
    } else {
      panel.hidden = false;
      const f = panel.querySelector('iframe'); try { f.contentWindow.postMessage({ type: 'purser-ask:context', ctx: ctxNow() }, ORIGIN); f.contentWindow.focus(); } catch (e) {}
    }
    fab.setAttribute('aria-expanded', 'true');
    if (matchMedia('(max-width: 560px)').matches) fab.hidden = true;
  };
  fab.addEventListener('click', () => (panel && !panel.hidden ? close() : open()));
  addEventListener('message', (e) => {
    if (e.origin !== ORIGIN || !e.data) return;
    if (e.data.type === 'purser-ask:close') close();
    // The page where the CFO approves (a hash of this console, checked): the person acts there, with their own passkey.
    const f = panel && panel.querySelector('iframe');
    if (e.data.type === 'purser-ask:navigate' && f && e.source === f.contentWindow && typeof e.data.hash === 'string' && NAV.test(e.data.hash)) { close(); location.hash = e.data.hash; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.append(fab);
}
}
`;

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin", "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains", "x-frame-options": "SAMEORIGIN",
};

const nonce = () => {
  const b = crypto.getRandomValues(new Uint8Array(18));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

/** GET /ask (and ?embed=1). `live`: Claude answers on this deployment now (its model is set and its switches are on). */
export function askPageResponse(url: URL, live = false): Response {
  const n = nonce();
  const p = url.searchParams;
  // The console's page, from the button's address (?ctx=invoice&id=…&demo=1): checked, or none.
  const context = parseContext({ kind: p.get("ctx"), id: p.get("id") ?? undefined, demo: p.get("demo") === "1" });
  return new Response(askPage(n, { embed: p.get("embed") === "1", live, context }), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": askCsp(n) } });
}

/** GET /ask/button.js: the module, cached an hour, loadable by this origin's pages. */
export function askButtonResponse(): Response {
  return new Response(ASK_BUTTON_JS, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin", "strict-transport-security": "max-age=31536000; includeSubDomains" } });
}
