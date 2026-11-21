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
import { WAVE_CANVAS_CSS, WAVE_CANVAS_HTML, waveScript } from "../../../src/ui/wave.js";
import { SITE_ORIGIN } from "../siteHeader.js";
import { SITE_HEADER_CSS, TRY_HEADER_LINKS } from "../siteHeader.js";
import { ATTACH_MAX_BYTES, ATTACH_TYPES } from "./attach.js";
import { ASK_COPY, QUESTION_MAX } from "./core.js";
import { ASK_CONTEXT_KINDS, ASK_NAV, CONTEXT_ID, CONTEXT_JS, OPEN_APPROVAL, approvalHash, contextLabel, parseContext, quickActions, type AskContext } from "./context.js";

export const ASK_PATH = "/ask";
export const ASK_BUTTON_PATH = "/ask/button.js";

/** Every word of the page (tests and the browser check read them). */
export const ASK_PAGE_COPY = {
  title: "Ask Purser",
  lede: "A read-only finance copilot: it answers from Purser's docs and the demo company's records, citing each source.",
  statusLive: "Claude · live",
  statusDocs: "Docs-only mode: live AI answers aren't switched on here yet.",
  helloHead: "Your read-only finance copilot",
  helloText: "Ask about Purser, or about the demo company's invoices, payments and books.",
  scope: "Read-only · test money · cites sources",
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
  helpHead: "How can Purser help today?",
  helpLine: "Ask about invoices, approvals, policy or evidence.",
  canRead: "I can work with",
  nav: "Ask Purser",
  navInvoices: "Invoices",
  navPayments: "Payments",
  navApprovals: "Approvals",
  navEvidence: "Evidence",
  convos: "Conversations",
  convosKept: "Kept in this browser only",
  convosEmpty: "Your questions appear here.",
  company: "Northwind Outdoor",
  companyDemo: "Demo company: made-up data from a simulated month, no real money.",
  companySignIn: "Sign in to your company",
  menu: "Menu",
  review: "Review",
  reviewApprove: "Review and approve",
  showChecks: "Show the checks",
  viewEvidence: "View evidence",
  detail: "Invoice",
  detailClose: "Close the invoice",
  due: "Due",
  payee: "Payee",
  account: "Account",
  method: "Method",
  methodDemo: "Simulated bank (demo company)",
  verification: "Verification",
  evidence: "Evidence",
  approve: "Approve with Face ID",
  approveNote: "Opens the invoice in Purser Cloud, where only the CFO signs with a passkey. Ask Purser never approves, pays or writes.",
  kbd: "⌘K",
  actionsLabel: "Actions",
  steps: { read: "Read", check: "Check", approve: "Approve", pay: "Pay" },
  stepSub: { readCode: "By Purser's code", readAgent: "By the agent", check: "Policy & risk", checkFlag: "Flagged for a person", approveNow: "Your sign-off", approveDone: "Approved", approveBlocked: "Not reached", pay: "Simulated bank", payDone: "Paid" },
  vRead: "Read", vCheck: "Checked (policy & risk)", vCheckFlag: "Checked: flagged", vApprove: "CFO approval (Face ID)", vApproveNow: "Requires the CFO's signature", vPay: "Execute payment",
  evInvoice: "The invoice and its audit trail, in Purser Cloud",
  evPolicy: "How the CFO's policy decides",
  evSigned: "Signed terms and the one-cent check",
  evRail: "Payments on the rails (sandbox records)",
  evVerify: "Verify it yourself",
  readNote: "Demo company data, made up · read only",
  recent: "Sources in this chat",
  recentEmpty: "The sources an answer cites appear here.",
  dropHere: "Attach an invoice or a CSV",
  viewing: "Viewing",
  demoCompany: "demo company, made-up data",
  ownCompany: "your company: Ask Purser reads the demo company only",
  quick: "Quick actions",
  fab: "Ask Purser",
  // 21 Nov (Max: "jury mode, so a jury can ask something"): the floating panel's empty state for a visitor, a juror or a
  // guest in the demo company; a person signed in to their own company keeps the four console actions (ASK_ACTIONS).
  // 21 Nov (Max: "the agent still looks like 2022 design: Claude-modern, enterprise, clean"): a soft greeting and one
  // muted line, the honesty kept (read-only, test money, cited).
  juryHead: "How can I help?",
  juryLine: "Read-only · test money · every answer cites its source",
} as const;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

// ---- Ask Purser's mark: Purser's feather on its ink square, with a small spark for "ask" ----

type El = [tag: string, attrs: Record<string, string>];
/** The mark on a 32 grid, as elements: drawn as markup on the page and as DOM by the button (one source for both). */
export const ASK_MARK: El[] = [
  // 21 Nov (Max: "the company's own Purser logo, the same mark as in the site header, in a rounded tile"): the feather on
  // the header's tile, in the theme's mark colours (classes, so the page's CSP needs no style attribute).
  ["rect", { class: "mk-bg", width: "32", height: "32", rx: "9", fill: "#000000" }],
  ...[
    "M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z", "M16 8 2 22", "M17.5 15H9",
  ].map((d): El => ["path", { class: "mk-ink", d, transform: "translate(5.6 5.6) scale(.86)", fill: "none", stroke: "#ffffff", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" }]),
];
/** The mark's colours from the theme (the site header's --mk-bg and --mk-ink), on every page that draws it. */
export const ASK_MARK_CSS = ".mk-bg{fill:var(--mk-bg,#000)}.mk-ink{stroke:var(--mk-ink,#fff)}";
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
  docs: ["M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"],
  swap: ["M8 3 4 7l4 4", "M4 7h16", "m16 21 4-4-4-4", "M20 17H4"],
  books: ["M3 3v18h18", "M7 16l4-4 3 3 5-6"],
  wallet: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  clock: ["M12 6v6l4 2", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"],
  shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"],
  bot: ["M12 8V4H8", "M4 8h16v12H4z", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2"],
  trail: ["M3 12h4l3-9 4 18 3-9h4"],
  chain: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
  upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"],
  chat: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],
  check: ["M21.8 10A10 10 0 1 1 17 3.3", "m9 11 3 3L22 4"],
  layers: ["m12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8Z", "m2 12 8.6 3.9a2 2 0 0 0 1.6 0L21 12", "m2 17 8.6 3.9a2 2 0 0 0 1.6 0L21 17"],
  face: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M8 14s1.5 2 4 2 4-2 4-2", "M9 9h.01", "M15 9h.01"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  spark: ["M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"],
  eye: ["M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  down: ["m6 9 6 6 6-6"],
  ext: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  // Purser's feather alone (the mark's strokes without its tile), monochrome in currentColor (21 Nov, Max: "Claude-modern").
  feather: ["M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z", "M16 8 2 22", "M17.5 15H9"],
  arrow: ["M5 12h14", "m12 5 7 7-7 7"],
};
/** The empty state's four actions (21 Nov, Max's mockups): each asks one question the agent answers from its reads. */
export const ASK_ACTIONS: { icon: string; label: string; q: string }[] = [
  { icon: "file", label: "Which invoices wait for the CFO?", q: "Which invoices wait for the CFO's Face ID?" },
  { icon: "check", label: "Check an invoice against policy", q: "How is an invoice checked against the CFO's policy?" },
  { icon: "layers", label: "Show invoice evidence", q: "What evidence does Purser keep for a paid invoice?" },
  { icon: "spark", label: "Explain a policy or approval rule", q: "When may an agent pay alone, and when must the CFO approve?" },
];
/**
 * The floating panel's questions for a visitor or a juror (21 Nov, Max: "jury mode"), each answerable from the knowledge
 * pack (test/cloud-ask.test.ts checks that retrieval finds passages on it). Asked as written.
 */
export const ASK_JURY: { icon: string; q: string }[] = [
  { icon: "spark", q: "What does Purser do, in 30 seconds?" },
  { icon: "layers", q: "What is live and what is simulated?" },
  { icon: "face", q: "How does the CFO's Face ID approval work?" },
  { icon: "shield", q: "What stops an agent from overpaying?" },
  { icon: "check", q: "Show me the proof for a payment" },
  { icon: "chain", q: "Which partners does Purser use, and how?" },
];
/** What the agent can read (./tools.ts), as the rail shows it: an icon and a few words each. */
const READS: [string, string][] = [["docs", "Purser's docs"], ["file", "Invoices"], ["swap", "Payments"], ["books", "Books & VAT"], ["wallet", "Cash"], ["clock", "Waiting for the CFO"], ["shield", "CFO's policy"], ["bot", "Agents & limits"], ["trail", "Audit trails"], ["chain", "Run records"]];
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
/* 21 Nov (Max: "a rich, premium copilot, not a generic chatbot; less text"): a compact header with a live chip, the
   conversation left and, on a wide screen, a rail of what the agent can read, the sources cited so far and a drop zone. */
.bar { padding: 10px 12px 10px 14px; gap: 12px; }
.bar h1 { font-size: 15.5px; }
.status { display: inline-flex; width: fit-content; margin: 3px 0 0; padding: 2px 9px 2px 7px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); font-size: 12px; font-weight: 600; }
.dot { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
@media (prefers-reduced-motion: no-preference) { .dot:not(.docs) { animation: live 2.4s ease-in-out infinite; } }
@keyframes live { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 6%, transparent); } }
.convo { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.hello { padding: 22px 4px 6px; gap: 8px; }
.hello h2 { font-size: 22px; letter-spacing: -.02em; margin: 6px 0 0; }
.hello .scope { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); color: var(--muted); font-size: 12px; font-weight: 600; }
.sugg { flex-direction: row; flex-wrap: wrap; }
.sugg li { flex: 1 1 200px; min-width: 0; }
.chip { min-height: 44px; border-radius: 12px; font-weight: 550; }
.msg.bot > .body, .msg.bot > .steps, .msg.bot > .meta { padding-left: 2px; }
.steps { position: relative; background: transparent; border: 0; border-left: 2px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 0; padding: 2px 0 2px 12px; }
.detail .rnote { margin: 8px 0 0; font-size: 12px; color: var(--faint); }
.detail ol.rsrc { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.detail ol.rsrc li.empty { font-size: 12.5px; color: var(--faint); }
.detail .dz { width: 100%; display: grid; justify-items: center; gap: 4px; padding: 16px 12px; border: 1.5px dashed color-mix(in srgb, var(--accent) 40%, var(--border)); border-radius: 14px; background: var(--surface); color: var(--text); font: 600 13.5px/1.3 Inter, system-ui, sans-serif; cursor: pointer; text-align: center; }
.detail .dz svg { color: var(--accent); }
.detail .dz small { font-weight: 500; font-size: 12px; color: var(--faint); }
.detail .dz:hover { border-color: var(--accent); background: var(--accent-soft); }
@media (min-width: 1024px) {
  body.page .app { max-width: 1180px; }
}
@media (max-width: 520px) { .msg.you { max-width: 92%; } .hello { padding-top: 18px; } body.page .lede { display: none; } body.page .shell { margin: 10px 0 12px; border-radius: 16px; height: max(460px, calc(100dvh - 96px)); } }
`;

/**
 * The page as an agent app (21 Nov, Max's mockups: "make Purser agent like this"): on a wide screen a sidebar (New
 * chat, the pages, the conversations kept in this browser, the company), the conversation, and a detail panel that
 * shows what the agent can read until an invoice is opened from an answer. Light and dark from the site's tokens; the
 * site's wave behind it, quieter in light.
 */
const APP_CSS = `${WAVE_CANVAS_CSS}
@media (prefers-color-scheme: light) { canvas.pw-wave { opacity: .4; } } :root[data-theme="light"] canvas.pw-wave { opacity: .4; }
body.page main.app { position: relative; z-index: 1; max-width: 1480px; padding: 0 var(--gut, 16px); }
body.page .shell { display: grid; grid-template-columns: minmax(0, 1fr); background: var(--glass, var(--surface)); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); border-color: var(--glass-line, var(--border)); }
.side, .detail { display: none; }
.side { flex-direction: column; gap: 6px; padding: 14px 12px; border-right: 1px solid var(--border); min-height: 0; overflow-y: auto; }
.newchat { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--btn-bg, var(--accent)); color: var(--btn-ink, #fff); font: 650 14.5px/1 Inter, system-ui, sans-serif; cursor: pointer; margin-bottom: 8px; }
.side ul.nav { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.side ul.nav a { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 12px; border-radius: 10px; color: var(--text); text-decoration: none; font-size: 14.5px; font-weight: 550; }
.side ul.nav a svg { color: var(--muted); flex: none; }
.side ul.nav a:hover { background: var(--sunken); }
.side ul.nav a.on { background: var(--accent-soft); color: var(--accent); } .side ul.nav a.on svg { color: var(--accent); }
.side .badge { margin-left: auto; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; display: inline-grid; place-items: center; background: var(--accent); color: var(--btn-ink, #fff); font-size: 12px; font-weight: 750; font-variant-numeric: tabular-nums; }
.side .convos { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); flex: 1; min-height: 0; }
.side .convos h2 { margin: 0 4px; font-size: 13px; font-weight: 700; color: var(--text); }
.side .convos .kept { margin: 2px 4px 8px; font-size: 11.5px; color: var(--faint); }
.side ol.cv { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.side { min-width: 0; overflow-x: hidden; }
.side ol.cv li { min-width: 0; }
.side ol.cv button { display: block; width: 100%; max-width: 100%; text-align: left; min-height: 38px; padding: 6px 10px; border: 0; border-radius: 9px; background: transparent; color: var(--muted); font: 500 13.5px/1.35 Inter, system-ui, sans-serif; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side ol.cv button:hover, .side ol.cv button[aria-current="true"] { background: var(--sunken); color: var(--text); }
.side ol.cv li.none { padding: 6px 10px; font-size: 12.5px; color: var(--faint); }
.side details.co { margin-top: auto; border-top: 1px solid var(--border); padding-top: 10px; }
.side details.co summary { list-style: none; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 8px; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 650; }
.side details.co summary::-webkit-details-marker { display: none; }
.side details.co summary .av { width: 28px; height: 28px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-size: 13px; font-weight: 750; flex: none; }
.side details.co summary .down { margin-left: auto; color: var(--faint); }
.side details.co p { margin: 6px 8px 0; font-size: 12.5px; line-height: 1.45; color: var(--muted); }
.side details.co a { color: var(--accent); font-weight: 600; }
/* The empty state. */
.hello.app { align-items: center; text-align: center; padding: 6vh 8px 10px; }
.hello.app .lg { padding: 10px; border-radius: 18px; background: var(--accent-soft); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 18px 40px -20px var(--glow, transparent); }
.hello.app h2 { font-size: clamp(24px, 2.6vw, 34px); letter-spacing: -.025em; margin: 14px 0 0; }
.hello.app p { max-width: 48ch; }
.acts { list-style: none; margin: 18px 0 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.acts button, .fups button { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); font: 600 14px/1.2 Inter, system-ui, sans-serif; cursor: pointer; }
.acts button svg, .fups button svg { color: var(--accent); }
.acts button:hover, .fups button:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); background: var(--accent-soft); }
.acts li:first-child button, .fups li:first-child button { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: var(--accent-soft); color: var(--accent); }
/* An answer's card: the invoices the agent read, each with Review. */
.icard { margin: 10px 0 4px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
.icard .ih { margin: 0; padding: 8px 14px; border-bottom: 1px solid var(--border); font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
.icard ul { list-style: none; margin: 0; padding: 0; }
.icard li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 12px 14px; }
.icard li + li { border-top: 1px solid var(--border); }
.icard .fi { width: 36px; height: 36px; border-radius: 10px; display: inline-grid; place-items: center; background: var(--sunken); color: var(--muted); }
.icard .who { margin: 0; display: grid; gap: 1px; min-width: 0; }
.icard .who b { font-size: 14.5px; font-weight: 650; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icard .who span { font-size: 12.5px; color: var(--muted); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icard .amt { font-size: 15px; font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
.icard .rv { min-height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); background: var(--accent-soft); color: var(--accent); font: 650 13px/1 Inter, system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
.icard .rv:hover { background: var(--accent); color: var(--btn-ink, #fff); }
.icard .st { grid-column: 2 / -1; margin: -4px 0 0; font-size: 12px; color: var(--muted); }
@media (max-width: 520px) { .icard li { grid-template-columns: auto minmax(0, 1fr) auto; } .icard .amt { grid-column: 2; grid-row: 2; } .icard .rv { grid-row: 1 / span 2; grid-column: 3; } .icard .st { grid-column: 2 / -1; } }
/* The step tracker: Read, Check, Approve, Pay, each in its real state. */
.track { list-style: none; margin: 10px 0 4px; padding: 14px 10px 12px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.track li { position: relative; display: grid; justify-items: center; gap: 3px; text-align: center; font-size: 13px; font-weight: 650; color: var(--text); min-width: 0; }
.track li::before { content: ""; position: absolute; top: 14px; right: 50%; width: 100%; height: 2px; background: var(--border); z-index: 0; }
.track li:first-child::before { display: none; }
.track li.done::before, .track li.now::before { background: color-mix(in srgb, var(--ok) 55%, var(--border)); }
.track .dot2 { position: relative; z-index: 1; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--surface); border: 2px solid var(--border); color: var(--faint); font-size: 12px; font-weight: 750; }
.track li.done .dot2 { background: var(--ok); border-color: var(--ok); color: #fff; }
.track li.now .dot2 { border-color: var(--accent); color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent); }
.track li.now { color: var(--accent); }
.track li.warn .dot2, .track li.blocked .dot2 { border-color: var(--warn); color: var(--warn); }
.track small { font-size: 11.5px; font-weight: 500; color: var(--muted); line-height: 1.3; }
.fups { list-style: none; margin: 10px 0 2px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.fups p { width: 100%; margin: 0; font-size: 13.5px; color: var(--muted); }
/* The detail panel. */
.detail { flex-direction: column; min-height: 0; overflow-y: auto; border-left: 1px solid var(--border); padding: 18px; gap: 16px; }
.detail .dh { display: flex; align-items: flex-start; gap: 10px; }
.detail .dh .fi { width: 40px; height: 40px; border-radius: 11px; display: inline-grid; place-items: center; background: var(--sunken); color: var(--muted); flex: none; }
.detail .dh .grow { min-width: 0; } .detail .dh b { display: block; font-size: 16px; } .detail .dh span { font-size: 12.5px; color: var(--muted); }
.detail .pill { align-self: flex-start; display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 650; }
.detail .big { margin: 0; font-size: 32px; font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.detail dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 13.5px; }
.detail dt { color: var(--muted); } .detail dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.detail h3 { margin: 0 0 8px; font-size: 14px; font-weight: 700; }
.detail ol.vs { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.detail ol.vs li { display: grid; grid-template-columns: 22px 1fr; gap: 2px 10px; font-size: 13.5px; font-weight: 600; }
.detail ol.vs .vd { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--border); }
.detail ol.vs li.done .vd { background: var(--ok); border-color: var(--ok); }
.detail ol.vs li.now .vd { border-color: var(--accent); box-shadow: inset 0 0 0 4px var(--surface), inset 0 0 0 10px var(--accent); }
.detail ol.vs li.warn .vd { border-color: var(--warn); }
.detail ol.vs small { grid-column: 2; font-weight: 500; color: var(--muted); font-size: 12.5px; }
.detail ul.ev { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.detail ul.ev a { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px; padding: 0 4px; border-radius: 8px; color: var(--text); text-decoration: none; font-size: 13.5px; font-weight: 550; }
.detail ul.ev a:hover { background: var(--sunken); } .detail ul.ev svg { color: var(--faint); flex: none; }
.detail .approve { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; border-radius: 12px; background: var(--btn-bg, var(--accent)); color: var(--btn-ink, #fff); font-weight: 700; font-size: 15px; text-decoration: none; border: 0; cursor: pointer; width: 100%; }
.detail .anote { margin: -8px 0 0; font-size: 12px; line-height: 1.45; color: var(--faint); }
.detail .xb { margin-left: auto; }
.detail .reads2 { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.detail .reads2 li { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); font-size: 13.5px; font-weight: 600; }
.detail .reads2 svg { color: var(--accent); }
.kbd { flex: none; display: inline-grid; place-items: center; min-width: 34px; height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 8px; color: var(--faint); font: 600 12px/1 Inter, system-ui, sans-serif; }
.menu-b { display: inline-grid; }
@media (min-width: 900px) {
  body.page .shell { grid-template-columns: 248px minmax(0, 1fr); height: max(600px, calc(100dvh - 92px)); margin: 12px 0 16px; }
  body.page .side { display: flex; }
  .menu-b { display: none; }
}
/* 21 Nov (Max): the panel of what the agent can read opens only when asked (the header's toggle, remembered in this
   browser); an invoice opened from an answer opens it too. Closed, the conversation takes the whole width. */
@media (min-width: 1240px) {
  body.page.panel .shell, body.page:has(.detail.open) .shell { grid-template-columns: 248px minmax(0, 1fr) 340px; }
  body.page.panel .detail, body.page .detail.open { display: flex; position: static; width: auto; box-shadow: none; }
  @media (prefers-reduced-motion: no-preference) { body.page .detail { animation: pslide .28s cubic-bezier(.2,.7,.2,1); } }
}
@keyframes pslide { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
.ib.pt[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent); }
@media (max-width: 1239px) { body.page.panel .detail { display: flex; position: fixed; inset: 0 0 0 auto; width: min(400px, 100%); z-index: 41; background: var(--surface); box-shadow: var(--shadow); } }
/* Narrower: the sidebar and the detail open over the conversation. */
@media (max-width: 899px) { body.page .side.open { display: flex; position: fixed; inset: 0 30% 0 0; z-index: 40; background: var(--surface); box-shadow: var(--shadow); } }
@media (max-width: 1239px) { body.page .detail.open { display: flex; position: fixed; inset: 0 0 0 auto; width: min(400px, 100%); z-index: 41; background: var(--surface); box-shadow: var(--shadow); } }
@media (prefers-reduced-motion: reduce) { canvas.pw-wave { display: none; } }
/* 21 Nov (Max, mockup 180): the empty state on the wave at good strength (no detail panel, the question box centred under
   the four cards); once a conversation exists, the wave quiet behind it and the box at the foot. */
body.page.empty .detail { display: none !important; }
@media (min-width: 1240px) { body.page.empty .shell { grid-template-columns: 248px minmax(0, 1fr); } }
body.page.empty .shell { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; border-color: transparent; box-shadow: none; }
body.page.empty .side { background: var(--glass, var(--surface)); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); border: 1px solid var(--glass-line, var(--border)); border-radius: 18px; }
body.page.empty .convo > .bar { background: transparent; border-bottom-color: transparent; }
body.page.empty .convo > .scroll { flex: none; overflow: visible; margin-top: auto; }
body.page.empty .convo > .composer { width: 100%; max-width: 720px; margin: 0 auto auto; border-top: 0; background: transparent; }
body.page.empty .composer .box { background: var(--glass, var(--surface)); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
body.page.empty canvas.pw-wave { opacity: 1; -webkit-mask-image: none; mask-image: none; }
body.page:not(.empty) canvas.pw-wave { opacity: .28; transition: opacity .5s; }
.hello .acts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 100%; max-width: 660px; margin-top: 22px; }
.hello .acts button { width: 100%; min-height: 56px; justify-content: flex-start; text-align: left; padding: 0 16px; border-radius: 14px; background: color-mix(in srgb, var(--surface) 80%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.hello .acts li:first-child button { background: color-mix(in srgb, var(--surface) 80%, transparent); color: var(--text); border-color: var(--border); }
.hello .acts button svg { flex: none; }
@media (max-width: 560px) { .hello .acts { grid-template-columns: minmax(0, 1fr); } }
.hello .lg svg { width: 52px; height: 52px; }
`;

/**
 * The floating panel's empty state (/ask?embed=1). The panel has none of the app's style (APP_CSS), so its welcome and
 * its questions are styled here. 21 Nov (Max: "the agent still looks like 2022 design: make it look Claude-modern,
 * enterprise, clean"): no logo tile, a soft greeting and one muted line, the questions as one quiet list (a monochrome
 * icon and the words, a hairline frame, a hover tint and an arrow), no purple tiles or chunky cards. Jury mode shows the
 * questions about Purser (.jury), a person in their own company the console's four actions (.co).
 */
const EMBED_CSS = `
body.embed .hello { align-items: stretch; gap: 4px; padding: 32px 4px 8px; }
body.embed .hello h2 { font-size: 22px; line-height: 1.3; letter-spacing: -.02em; margin: 0; font-weight: 600; color: var(--text); }
body.embed .hello p { font-size: 13.5px; line-height: 1.5; color: var(--muted); }
body.embed .hello .scope { align-self: flex-start; padding: 0; border: 0; background: none; font-size: 12.5px; font-weight: 500; color: var(--faint); }
body.embed:not(.own-co) .co-only, body.embed:not(.own-co) .acts.co, body.embed.own-co .acts.jury { display: none; }
body.embed .acts { list-style: none; margin: 24px 0 0; padding: 4px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; width: 100%; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
body.embed .acts li { margin: 0; min-width: 0; list-style: none; }
body.embed .acts button { width: 100%; min-height: 44px; display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 0; border-radius: 12px; background: transparent; color: var(--text); font: 450 14px/1.4 Inter, system-ui, -apple-system, sans-serif; letter-spacing: -.005em; text-align: left; cursor: pointer; overflow-wrap: anywhere; transition: background-color .15s ease, color .15s ease; }
body.embed .acts button svg { flex: none; color: var(--faint); transition: color .15s ease; }
body.embed .acts button span { min-width: 0; flex: 1; }
body.embed .acts button::after { content: "→"; flex: none; color: var(--faint); opacity: 0; transform: translateX(-4px); transition: opacity .15s ease, transform .15s ease; }
body.embed .acts button:hover, body.embed .acts button:focus-visible { background: var(--hover); }
body.embed .acts button:hover svg { color: var(--text); }
body.embed .acts button:hover::after, body.embed .acts button:focus-visible::after { opacity: 1; transform: none; }
body.embed .acts button:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { body.embed .acts button, body.embed .acts button svg, body.embed .acts button::after { transition: none; } body.embed .acts button::after { transform: none; } }
body.embed .composer { padding: 8px 12px 12px; }
body.embed .foot { text-align: center; }
`;

/**
 * The calm assistant look (21 Nov, Max: "Claude-modern, enterprise, clean"), on the panel and the app alike, after their
 * own style: a slim header (the feather alone, the name in medium weight, the status as a dot and a few muted words, ghost
 * icon buttons of 32 px), the answers as plain text with their sources as small chips, the question as a quiet bubble,
 * and one refined composer (a hairline box with a focus ring, the paperclip inside on the left, a round send button in
 * the accent only once there is something to send). Inter, an 8 px rhythm, the site's tokens light and dark; transitions
 * short and none for a reduced-motion preference.
 */
const MODERN_CSS = `
:root { --line: color-mix(in srgb, var(--border) 75%, transparent); --hover: color-mix(in srgb, var(--text) 5%, transparent); --ring: color-mix(in srgb, var(--accent) 55%, transparent); --bubble: color-mix(in srgb, var(--text) 6%, var(--surface)); --on-bubble: var(--text); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --line: color-mix(in srgb, var(--border) 80%, transparent); --hover: color-mix(in srgb, var(--text) 7%, transparent); --bubble: color-mix(in srgb, var(--text) 9%, var(--surface)); --on-bubble: var(--text); } }
:root[data-theme="dark"] { --line: color-mix(in srgb, var(--border) 80%, transparent); --hover: color-mix(in srgb, var(--text) 7%, transparent); --bubble: color-mix(in srgb, var(--text) 9%, var(--surface)); --on-bubble: var(--text); }
/* Header */
.bar { min-height: 52px; padding: 8px 8px 8px 16px; gap: 8px; border-bottom: 1px solid var(--line); }
.bar .logo { flex: none; display: inline-grid; place-items: center; width: 24px; height: 24px; color: var(--text); border-radius: 0; }
.bar .grow { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 10px; row-gap: 0; }
.bar h1, h1 { font-size: 15px; line-height: 1.3; letter-spacing: -.01em; font-weight: 600; }
.status { display: inline-flex; align-items: center; gap: 6px; width: auto; margin: 0; padding: 0; border: 0; border-radius: 0; background: none; font-size: 12px; font-weight: 450; line-height: 1.3; color: var(--muted); }
.dot, .dot:not(.docs) { width: 6px; height: 6px; background: var(--ok); box-shadow: none; animation: none; }
.dot.docs { background: var(--warn); box-shadow: none; }
.ib { width: 32px; height: 32px; border-radius: 8px; color: var(--muted); transition: background-color .15s ease, color .15s ease; }
.ib:hover { background: var(--hover); color: var(--text); }
.ib svg { width: 16px; height: 16px; }
.ib:focus-visible, .send:focus-visible, .chip:focus-visible, a:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
/* The conversation */
.scroll { padding: 8px 16px 16px; }
.chat { gap: 24px; padding-top: 16px; }
.msg.you { max-width: 85%; }
.msg.you .txt { background: var(--bubble); color: var(--on-bubble); border-radius: 18px 18px 6px 18px; padding: 8px 14px; font-size: 14.5px; line-height: 1.5; }
.msg.bot { grid-template-columns: 24px minmax(0, 1fr); column-gap: 12px; }
.msg.bot > .av { display: grid; place-items: center; width: 24px; height: 24px; margin-top: 1px; border: 1px solid var(--line); border-radius: 50%; color: var(--text); padding: 0; }
.msg.bot > .who { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; }
.body { font-size: 14.5px; line-height: 1.6; color: var(--text); }
.body p { margin: 0 0 12px; } .body ul, .body ol { margin: 0 0 12px; padding-left: 20px; } .body li { margin: 4px 0; }
.body strong { font-weight: 600; }
.body a { color: var(--text); text-decoration: underline; text-decoration-color: var(--ring); text-underline-offset: 2px; }
.cite { min-width: 16px; height: 16px; border-radius: 5px; font-weight: 600; font-size: 10px; color: var(--muted); background: var(--hover); border: 1px solid var(--line); transition: background-color .15s ease, color .15s ease; }
.body a.cite { text-decoration: none; color: var(--muted); }
.body a.cite:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
.thinking { font-size: 13.5px; }
.steps, .msg.bot > .steps { border: 0; border-left: 1px solid var(--line); border-radius: 0; background: none; padding: 0 0 0 12px; margin: 2px 0 12px; font-size: 12.5px; gap: 4px; }
.step .sl { font-weight: 500; }
.meta { margin-top: 12px; gap: 8px; }
.mh { font-size: 11px; font-weight: 600; letter-spacing: .04em; color: var(--faint); }
.meta ol { gap: 6px; }
.src { min-height: 26px; padding: 2px 10px 2px 3px; gap: 6px; border: 1px solid var(--line); border-radius: 8px; background: transparent; font-size: 12px; color: var(--muted); transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
.src b { min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px; background: var(--hover); color: var(--muted); font-size: 10.5px; font-weight: 600; }
a.src:hover { border-color: color-mix(in srgb, var(--text) 25%, var(--line)); background: var(--hover); color: var(--text); }
.how, .note { font-size: 12px; color: var(--faint); }
/* The composer */
.composer { padding: 8px 16px 12px; border-top: 0; background: transparent; }
.box { gap: 4px; padding: 10px 8px 8px 14px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); box-shadow: 0 1px 2px rgba(15, 12, 30, .04), 0 4px 16px -8px rgba(15, 12, 30, .10); transition: border-color .15s ease, box-shadow .15s ease; }
.box:focus-within { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent), 0 4px 16px -8px rgba(15, 12, 30, .10); }
textarea { padding: 2px 0 4px; font: 400 15px/1.5 Inter, system-ui, -apple-system, sans-serif; }
@media (pointer: coarse) { textarea { font-size: 16px; } }
.row { gap: 4px; }
.clip { margin-left: -6px; }
.send { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #fff; transition: background-color .15s ease, color .15s ease, transform .15s ease; }
.send svg { width: 16px; height: 16px; }
.send:not(:disabled):hover { background: color-mix(in srgb, var(--accent) 86%, #000); }
.send:disabled { opacity: 1; background: var(--hover); color: var(--faint); }
.att { border-color: var(--line); border-radius: 10px; }
.foot { margin: 8px 4px 0; font-size: 11px; line-height: 1.45; color: var(--faint); }
.ctxbar { border-top: 1px solid var(--line); padding: 8px 16px 0; }
.qa button, .qa a { min-height: 32px; border-color: var(--line); border-radius: 999px; background: transparent; font-weight: 500; transition: background-color .15s ease, border-color .15s ease; }
.qa button:hover, .qa a:hover { background: var(--hover); border-color: var(--border); }
.qa .qa-go { border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
/* The app's welcome: the feather alone, no glowing tile. */
.hello.app .lg { display: inline-grid; place-items: center; width: 48px; height: 48px; padding: 0; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); box-shadow: none; color: var(--text); }
.hello.app .lg svg { width: 24px; height: 24px; }
.hello.app h2 { font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .ib, .send, .box, .src, .cite, .qa button, .qa a { transition: none; } }
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
function avatar() { const t = $('mark'); const s = t.content.firstElementChild.cloneNode(true); const d = el('div', 'av'); d.append(s); return d; }
function fileLine(name) { const f = el('span', 'fileline'); const ic = $('fileicon').content.firstElementChild.cloneNode(true); f.append(ic, el('span', null, name)); return f; }
function bubble(role, text, file, cards) {
  const m = el('div', 'msg ' + (role === 'user' ? 'you' : 'bot'));
  if (role === 'user') {
    m.append(el('span', 'who', C.you));
    if (file) m.append(fileLine(file));
    m.append(el('div', 'txt', text));
  } else { m.append(avatar(), el('span', 'who', C.purser)); const b = el('div', 'body'); m.append(b); draw(b, text, []); if (Array.isArray(cards) && cards.length) { const box = el('div', 'cards'); for (const c of cards) box.append(renderCard(c)); m.append(box); } }
  chat.append(m);
  return m;
}
// The first question (21 Nov, Max: the hero goes, the thread grows from the question box as it moves to the foot): the
// empty state fades and slides up, the box glides from the centre to its place, the thread rises in. Reduced motion: at once.
function leaveEmpty() {
  const b = document.body;
  if (!b.classList.contains('empty')) { hello.hidden = true; return; }
  let calm = true; try { calm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  const comp = form, before = comp.getBoundingClientRect().top;
  const swap = () => {
    hello.hidden = true; b.classList.remove('empty'); hello.classList.remove('leaving');
    if (calm || !comp.animate) return;
    const after = comp.getBoundingClientRect().top;
    comp.animate([{ transform: 'translateY(' + (before - after) + 'px)' }, { transform: 'none' }], { duration: 350, easing: 'cubic-bezier(.2,.7,.2,1)' });
    chat.animate([{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: 'cubic-bezier(.2,.7,.2,1)' });
  };
  if (calm || !hello.animate) { swap(); return; }
  hello.classList.add('leaving');
  hello.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-18px)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished.then(swap, swap);
}
// ---- 21 Nov (Max's mockups): the answer's cards, the step tracker, the follow-ups and the invoice's detail panel ----
// Every value is the demo company's record as the agent's read returned it (./cards.ts), put on the page as text.
const mk = (tag, cls, kids) => { const e = el(tag, cls); for (const k of kids) if (k != null) e.append(k); return e; };
const ico = (id) => { const t = $('ic-' + id); const n = t ? t.content.firstElementChild.cloneNode(true) : el('span'); return n; };
function money(cur, v) { const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v || '')); if (!m) return (cur ? cur + ' ' : '') + String(v || ''); return (cur ? cur + ' ' : '') + m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + ((m[3] || '') + '00').slice(0, 2); }
function day(iso) { const d = new Date(String(iso || '').slice(0, 10) + 'T12:00:00Z'); return isNaN(d) ? String(iso || '') : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
// How far an invoice got, from its own record: read, checked, approved (the CFO's Face ID), paid (the demo's simulated bank).
function stepsOf(r) {
  const S2 = C.stepSub, paid = !!r.paid_at || r.status === 'paid', waits = r.status === 'waiting_cfo';
  return [
    { k: C.steps.read, sub: r.read_by === 'claude' ? S2.readAgent : S2.readCode, st: 'done' },
    { k: C.steps.check, sub: r.findings ? S2.checkFlag : S2.check, st: r.findings ? 'warn' : 'done' },
    { k: C.steps.approve, sub: paid ? S2.approveDone : waits ? S2.approveNow : S2.approveBlocked, st: paid ? 'done' : waits ? 'now' : 'blocked' },
    { k: C.steps.pay, sub: paid ? S2.payDone + ' ' + day(r.paid_at) : S2.pay, st: paid ? 'done' : 'todo' },
  ];
}
function tracker(r) {
  const ol = el('ol', 'track'); ol.setAttribute('aria-label', r.vendor + ' ' + r.invoice_no);
  stepsOf(r).forEach((x, i) => { const d = el('span', 'dot2'); if (x.st === 'done') d.append(ico('check')); else d.textContent = String(i + 1); ol.append(mk('li', x.st, [d, el('span', null, x.k), el('small', null, x.sub)])); });
  return ol;
}
let DETAIL_OPEN = null;
function renderCard(card) {
  const wrap = el('div', 'cardset');
  if (!card || card.kind !== 'invoices' || !Array.isArray(card.items)) return wrap;
  const box = el('div', 'icard'); box.append(el('p', 'ih', card.title || ''));
  const ul = el('ul');
  for (const r of card.items) {
    const rv = el('button', 'rv', C.review + ' →'); rv.type = 'button'; rv.addEventListener('click', () => openDetail(r));
    const fi = el('span', 'fi'); fi.append(ico('file'));
    const li = mk('li', null, [fi, mk('p', 'who', [el('b', null, r.vendor), el('span', null, r.invoice_no + ' · ' + C.due + ' ' + day(r.due_date))]), el('span', 'amt', money(r.currency, r.total)), rv]);
    if (r.status_words) li.append(el('p', 'st', r.status_words));
    ul.append(li);
  }
  box.append(ul); wrap.append(box);
  const first = card.items.find((x) => x.status === 'waiting_cfo') || (card.items.length === 1 ? card.items[0] : null);
  if (first) {
    wrap.append(tracker(first));
    const f = el('ul', 'fups');
    const chip = (icon, label, fn) => { const b = el('button', null); b.type = 'button'; b.append(ico(icon), label); b.addEventListener('click', fn); const li = el('li'); li.append(b); return li; };
    f.append(chip('check', C.reviewApprove, () => openDetail(first)), chip('eye', C.showChecks, () => ask('Show the checks on invoice ' + first.id + '.')), chip('layers', C.viewEvidence, () => openDetail(first, true)));
    wrap.append(f);
  }
  return wrap;
}
const detail = $('detail'), detailHome = detail ? [...detail.childNodes] : [];
function closeDetail() { if (!detail) return; detail.replaceChildren(...detailHome); detail.classList.remove('open'); DETAIL_OPEN = null; }
function openDetail(r, evidenceFirst) {
  if (!detail) { const hash = '#/invoices/' + r.id; try { parent.postMessage({ type: 'purser-ask:navigate', hash }, location.origin); } catch (e) {} return; }
  DETAIL_OPEN = r.id;
  const x = el('button', 'ib xb'); x.type = 'button'; x.setAttribute('aria-label', C.detailClose); x.title = C.detailClose; x.append(ico('x')); x.addEventListener('click', closeDetail);
  const fi = el('span', 'fi'); fi.append(ico('file'));
  const head = mk('div', 'dh', [fi, mk('div', 'grow', [el('b', null, r.vendor), el('span', null, r.invoice_no)]), x]);
  const dl = el('dl'); const row = (k, v) => { if (v) dl.append(el('dt', null, k), el('dd', null, v)); };
  row(C.due, day(r.due_date)); row(C.payee, r.vendor); row(C.account, r.account); row(C.method, C.methodDemo);
  const vs = el('ol', 'vs'); const S3 = stepsOf(r);
  const vrow = (st, label, sub) => { const li = el('li', st); li.append(el('span', 'vd'), el('span', null, label)); if (sub) li.append(el('small', null, sub)); vs.append(li); };
  vrow('done', C.vRead, S3[0].sub); vrow(S3[1].st, r.findings ? C.vCheckFlag : C.vCheck, r.review_note || ''); vrow(S3[2].st, C.vApprove, S3[2].st === 'now' ? C.vApproveNow : S3[2].sub); vrow(S3[3].st, C.vPay, S3[3].sub);
  const ev = el('ul', 'ev');
  const link = (href, label) => { const a = el('a', null, label); a.href = href; if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } a.append(ico('ext')); const li = el('li'); li.append(a); ev.append(li); };
  link('/#/invoices/' + encodeURIComponent(r.id), C.evInvoice); link(CFG.site + '/proof#pf-policy', C.evPolicy); link(CFG.site + '/proof#pf-passkey', C.evSigned); link(CFG.site + '/proof#pf-rail', C.evRail); link(CFG.site + '/proof#pf-verify', C.evVerify);
  const parts = [head, el('p', 'big', money(r.currency, r.total))];
  if (r.status_words) parts.push(el('span', 'pill', r.status_words));
  parts.push(dl, mk('section', null, [el('h3', null, C.verification), vs]));
  const evs = el('section'); evs.append(el('h3', null, C.evidence), ev);
  if (evidenceFirst) parts.splice(2, 0, evs); else parts.push(evs);
  if (r.status === 'waiting_cfo') {
    // Only the CFO approves, on the invoice's own page in Purser Cloud, with a passkey: this opens that page, never acts.
    const a = el('a', 'approve'); a.href = '/#/invoices/' + encodeURIComponent(r.id); a.append(ico('face'), C.approve);
    parts.push(a, el('p', 'anote', C.approveNote));
  }
  detail.replaceChildren(...parts);
  detail.classList.add('open'); detail.scrollTop = 0; x.focus({ preventScroll: true });
}
// ---- The conversations, kept in this browser only (localStorage; no server keeps them) ----
const CKEY = 'purser.ask.convos';
let CONVO = (() => { try { return sessionStorage.getItem('purser.ask.convo') || ''; } catch (e) { return ''; } })();
function convos() { try { const a = JSON.parse(localStorage.getItem(CKEY) || '[]'); return Array.isArray(a) ? a.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.turns)) : []; } catch (e) { return []; } }
function keepConvo() {
  if (!history.length) return;
  if (!CONVO) { CONVO = 'c' + Date.now().toString(36); try { sessionStorage.setItem('purser.ask.convo', CONVO); } catch (e) {} }
  const all = convos().filter((c) => c.id !== CONVO);
  const first = history.find((t) => t.role === 'user');
  all.unshift({ id: CONVO, title: first ? first.text.slice(0, 60) : '', at: Date.now(), turns: history.slice(-12) });
  try { localStorage.setItem(CKEY, JSON.stringify(all.slice(0, 12))); } catch (e) {}
  drawConvos();
}
function drawConvos() {
  const ol = $('convos'); if (!ol) return; ol.textContent = '';
  const all = convos();
  if (!all.length) { ol.append(el('li', 'none', C.convosEmpty)); return; }
  for (const c of all) { const b = el('button', null, c.title || '…'); b.type = 'button'; if (c.id === CONVO) b.setAttribute('aria-current', 'true'); b.addEventListener('click', () => loadConvo(c)); const li = el('li'); li.append(b); ol.append(li); }
}
function loadConvo(c) {
  history = c.turns.filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string');
  CONVO = c.id; try { sessionStorage.setItem('purser.ask.convo', CONVO); } catch (e) {}
  chat.textContent = ''; closeDetail();
  for (const t of history) bubble(t.role, t.text, typeof t.file === 'string' ? t.file : null, t.cards);
  hello.hidden = history.length > 0; document.body.classList.toggle('empty', !history.length && !CFG.embed); save(); drawConvos(); $('side') && $('side').classList.remove('open'); scroll();
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
  railSources(shown);
  box.append(el('span', 'how', (mode === 'live' ? C.live : mode === 'refused' ? C.refused : mode === 'records' ? C.records : C.docs) + (reason && mode !== 'live' && mode !== 'refused' ? ' ' + reason : '')));
  m.append(box);
}
// The rail's sources: each source an answer cited, once, newest first (the page on a wide screen).
const RAIL = new Set();
function railSources(list) {
  const ol = $('rsrc'); if (!ol) return;
  for (const s of list) {
    if (RAIL.has(s.title)) continue; RAIL.add(s.title);
    const empty = ol.querySelector('.empty'); if (empty) empty.remove();
    const link = s.kind !== 'data' && okHost(s.url);
    const a = el(link ? 'a' : 'span', 'src' + (s.kind === 'data' ? ' data' : ''));
    if (link) { a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; }
    a.title = s.title; a.append(el('span', null, s.title + (s.kind === 'data' ? ' (' + C.demo + ')' : '')));
    const li = el('li'); li.append(a); ol.prepend(li);
  }
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
  leaveEmpty();
  bubble('user', question, file && file.name);
  const m = el('div', 'msg bot'); m.setAttribute('aria-busy', 'true');
  m.append(avatar(), el('span', 'who', C.purser));
  const steps = el('ol', 'steps'); steps.setAttribute('aria-label', 'What the agent read');
  const body = el('div', 'body');
  const wait = el('span', 'thinking'); const dots = el('span', 'typing'); dots.setAttribute('aria-hidden', 'true'); dots.append(el('i'), el('i'), el('i')); wait.append(dots, el('span', null, C.thinking)); body.append(wait);
  m.append(steps, body);
  chat.append(m); scroll();
  say.textContent = C.sending;
  let text = '', sources = [], done = null, settled = false; const cards = [], cardBox = el('div', 'cards');
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
        else if (ev.type === 'card' && ev.card) { cards.push(ev.card); if (!cardBox.isConnected) body.after(cardBox); cardBox.append(renderCard(ev.card)); scroll(); }
        else if (ev.type === 'done') done = ev;
      }
    }
    if (!done) throw new Error(C.error);
    draw(body, text, sources);
    meta(m, sources, done.cited || [], done.mode, done.note, done.reason);
    history.push({ role: 'user', text: question, file: file ? file.name : null }, { role: 'assistant', text: text.slice(0, 1200), ...(cards.length ? { cards } : {}) });
    save(); keepConvo();
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
if ($('dz')) $('dz').addEventListener('click', () => fileIn.click());
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
  // Jury mode (the floating panel): a visitor or a guest in the demo company sees the questions about Purser; a person in
  // their own company sees the console's four actions.
  if (CFG.embed) { const own = !!CTX && !CTX.demo; document.body.classList.toggle('own-co', own); $('hh').textContent = own ? C.helpHead : C.juryHead; $('hl').textContent = own ? C.helpLine : C.juryLine; }
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
if (reset) reset.addEventListener('click', () => { history = []; save(); CONVO = ''; try { sessionStorage.removeItem('purser.ask.convo'); } catch (e) {} chat.textContent = ''; hello.hidden = false; if (!CFG.embed) document.body.classList.add('empty'); say.textContent = ''; clearFile(); fileError(''); closeDetail(); drawConvos(); q.focus(); });
drawConvos();
// The panel of what the agent can read: closed unless asked; the choice kept in this browser (it may refuse: then not kept).
const ptog = $('ptog');
const panelOn = (on) => { document.body.classList.toggle('panel', on); if (ptog) ptog.setAttribute('aria-expanded', on ? 'true' : 'false'); };
try { panelOn(localStorage.getItem('purser.ask.panel') === '1'); } catch (e) { panelOn(false); }
if (ptog) ptog.addEventListener('click', () => { const on = !document.body.classList.contains('panel'); panelOn(on); try { localStorage.setItem('purser.ask.panel', on ? '1' : '0'); } catch (e) {} });
// The menu on a narrow screen; ⌘K (Ctrl+K) to the question box; the composer's plus opens the four actions.
const side = $('side'), menuB = $('menu-b');
if (menuB && side) menuB.addEventListener('click', () => { const on = side.classList.toggle('open'); menuB.setAttribute('aria-expanded', on ? 'true' : 'false'); });
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); q.focus(); } if (e.key === 'Escape' && detail && detail.classList.contains('open')) closeDetail(); });
const plus = $('plus'), actMenu = $('actmenu');
if (plus && actMenu) plus.addEventListener('click', () => { const on = actMenu.hidden; actMenu.hidden = !on; plus.setAttribute('aria-expanded', on ? 'true' : 'false'); });
for (const b of document.querySelectorAll('#actmenu button[data-q]')) b.addEventListener('click', () => { actMenu.hidden = true; plus.setAttribute('aria-expanded', 'false'); ask(b.dataset.q); });
const close = $('close');
const bye = () => { try { parent.postMessage({ type: 'purser-ask:close' }, location.origin); } catch (e) {} };
if (close) close.addEventListener('click', bye);
if (CFG.embed) document.addEventListener('keydown', (e) => { if (e.key === 'Escape') bye(); });
// The conversation of this tab, if it had one.
try { const old = JSON.parse(sessionStorage.getItem(KEY) || '[]'); if (Array.isArray(old)) for (const t of old) if (t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string') { history.push(t); bubble(t.role, t.text, typeof t.file === 'string' ? t.file : null, t.cards); } } catch (e) {}
if (history.length) { hello.hidden = true; document.body.classList.remove('empty'); scroll(); }
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
export function askPage(n: string, o: { embed: boolean; live?: boolean; context?: AskContext | null; waiting?: number | null }): string {
  const C = ASK_PAGE_COPY;
  const live = o.live ?? false;
  const ctx = o.context ?? null;
  const app = !o.embed;
  const script = SCRIPT.replace("__CONTEXT__", () => CONTEXT_JS).replace("__COPY__", () => json(C)).replace("__CFG__", () => json({ embed: o.embed, ctx, site: SITE_ORIGIN, max: QUESTION_MAX, maxBytes: ATTACH_MAX_BYTES, types: ATTACH_TYPES, hosts: ["github.com/agamemnon-coder/x402-business-agents", "kit11.max-31b.workers.dev", "purser-try.max-31b.workers.dev", "youtu.be/"] }));
  // The status: "Claude connected · live" only when Claude answers here now; else docs-only mode, said as plainly.
  const bar = `<header class="bar">${app ? `<button class="ib menu-b" id="menu-b" type="button" aria-label="${esc(C.menu)}" aria-controls="side" aria-expanded="false">${icon("menu")}</button>` : ""}<span class="logo" aria-hidden="true">${icon("feather", 18)}</span><div class="grow"><h1>${esc(C.title)}</h1><p class="status"><span class="dot${live ? "" : " docs"}" id="sdot" aria-hidden="true"></span><span id="stext">${esc(live ? C.statusLive : C.statusDocs)}</span></p></div>`
    + (app ? `<button class="ib pt" id="ptog" type="button" aria-controls="detail" aria-expanded="false" aria-label="${esc(C.canRead)}" title="${esc(C.canRead)}">${icon("layers", 18)}</button>` : `<button class="ib" id="reset" type="button" aria-label="${esc(C.newChat)}" title="${esc(C.newChat)}">${icon("plus")}</button>`)
    + (o.embed ? `<a class="ib" href="${ASK_PATH}" target="_blank" rel="noopener" aria-label="${esc(C.full)}" title="${esc(C.full)}">${icon("out", 17)}</a><button class="ib" id="close" type="button" aria-label="${esc(C.close)}" title="${esc(C.close)}">${icon("x")}</button>` : "")
    + `</header>`;
  // The empty state (21 Nov, Max's mockups): the mark, one question, one line, the read-only chip and four actions.
  const actButtons = ASK_ACTIONS.map((x) => `<li><button class="act" type="button" data-q="${esc(x.q)}">${icon(x.icon, 16)}<span>${esc(x.label)}</span></button></li>`).join("");
  // In the floating panel (embed), jury mode (21 Nov, Max): six questions about Purser for a visitor, a juror or a guest
  // in the demo company; signed in to their own company, the four actions above. The script switches on the context.
  const own = o.embed && !!ctx && !ctx.demo;
  const juryButtons = ASK_JURY.map((x) => `<li><button class="act" type="button" data-q="${esc(x.q)}">${icon(x.icon, 16)}<span>${esc(x.q)}</span></button></li>`).join("");
  const helloBlock = o.embed
    ? `<section class="hello app" id="hello" aria-labelledby="hh"><h2 id="hh">${esc(own ? C.helpHead : C.juryHead)}</h2><p id="hl">${esc(own ? C.helpLine : C.juryLine)}</p><p class="scope co-only">${esc(C.scope)}</p>`
      + `<h3 class="sr">${esc(C.suggestionsHead)}</h3><ul class="acts jury">${juryButtons}</ul><ul class="acts co">${actButtons}</ul></section>`
    : `<section class="hello app" id="hello" aria-labelledby="hh"><span class="lg">${icon("feather", 26)}</span><h2 id="hh">${esc(C.helpHead)}</h2><p>${esc(C.helpLine)}</p><p class="scope">${esc(C.scope)}</p>`
      + `<h3 class="sr">${esc(C.suggestionsHead)}</h3><ul class="acts">${actButtons}</ul></section>`;
  // The sidebar (a wide screen; a menu on a narrow one): New chat, the pages, the conversations kept in this browser only,
  // and the company: the demo company, said once and quietly.
  const nav: [string, string, string, string][] = [["chat", C.nav, ASK_PATH, ""], ["file", C.navInvoices, "/#/invoices", ""], ["swap", C.navPayments, "/#/transactions", ""], ["check", C.navApprovals, "/#/invoices?f=waiting_cfo", o.waiting ? String(o.waiting) : ""], ["layers", C.navEvidence, `${SITE_ORIGIN}/proof`, ""]];
  const side = `<nav class="side" id="side" aria-label="${esc(C.title)}"><button class="newchat" id="reset" type="button">${icon("plus")}${esc(C.newChat)}</button>`
    + `<ul class="nav">${nav.map(([i, w, h, badge], k) => `<li><a href="${esc(h)}"${k === 0 ? ' class="on" aria-current="page"' : ""}>${icon(i, 18)}${esc(w)}${badge ? `<span class="badge" aria-label="${esc(`${badge} waiting`)}">${esc(badge)}</span>` : ""}</a></li>`).join("")}</ul>`
    + `<section class="convos" aria-labelledby="cvh"><h2 id="cvh">${esc(C.convos)}</h2><p class="kept">${esc(C.convosKept)}</p><ol class="cv" id="convos"></ol></section>`
    + `<details class="co"><summary><span class="av" aria-hidden="true">N</span>${esc(C.company)}${icon("down", 16).replace("<svg", '<svg class="down"')}</summary><p>${esc(C.companyDemo)} <a href="/#/sign-in">${esc(C.companySignIn)}</a></p></details></nav>`;
  // The detail panel: what the agent can read, the sources cited so far and a drop zone, until an invoice is opened.
  const detailPanel = `<aside class="detail" id="detail" aria-label="${esc(C.detail)}"><section><h3>${esc(C.canRead)}</h3><ul class="reads2">${READS.map(([i, w]) => `<li>${icon(i, 16)}${esc(w)}</li>`).join("")}</ul><p class="rnote">${esc(C.readNote)}</p></section>`
    + `<section><h3>${esc(C.recent)}</h3><ol class="rsrc" id="rsrc"><li class="empty">${esc(C.recentEmpty)}</li></ol></section>`
    + `<section><button class="dz" id="dz" type="button">${icon("upload", 22)}<span>${esc(C.dropHere)}</span><small>${esc(C.attachHint)}</small></button></section></aside>`;
  const composer = `<form class="composer" id="ask" autocomplete="off"><div class="drop" id="drop" hidden>${esc(C.drop)}</div>`
    + (app ? `<ul class="acts actmenu" id="actmenu" hidden aria-label="${esc(C.actionsLabel)}">${actButtons}</ul>` : "")
    + `<div class="box">`
    + `<div class="att" id="att" hidden>${icon("file", 16)}<span class="fn" id="fname"></span><span class="fs" id="fsize"></span><button class="ib" id="unatt" type="button" aria-label="${esc(C.removeFile)}" title="${esc(C.removeFile)}">${icon("x", 14)}</button></div>`
    + `<label class="sr" for="q">${esc(C.label)}</label><textarea id="q" name="q" rows="1" maxlength="${QUESTION_MAX}" placeholder="${esc(C.placeholder)}" aria-describedby="foot"></textarea>`
    + `<div class="row">${app ? `<button class="ib" id="plus" type="button" aria-label="${esc(C.actionsLabel)}" aria-controls="actmenu" aria-expanded="false">${icon("plus", 18)}</button>` : ""}<button class="ib clip" id="clip" type="button" aria-label="${esc(`${C.attach} (${C.attachHint})`)}" title="${esc(`${C.attach}: ${C.attachHint}`)}">${icon("clip", 18)}</button><input class="sr" type="file" id="file" accept=".pdf,.csv,.txt,${ATTACH_TYPES.join(",")}" tabindex="-1" aria-hidden="true">`
    + `<span class="grow"><span class="count" id="count" aria-live="polite"></span></span>${app ? `<kbd class="kbd" title="⌘K / Ctrl+K">${esc(C.kbd)}</kbd>` : ""}<button class="send" id="send" type="submit" aria-label="${esc(C.send)}" title="${esc(C.send)}">${icon("up", 18)}</button></div></div>`
    + `<p class="ferr" id="ferr" role="alert" hidden></p><p class="foot" id="foot">${esc(C.privacy)}</p></form>`;
  const icons = (["file", "check", "face", "ext", "x", "eye", "layers"] as const).map((k) => `<template id="ic-${k}">${icon(k, k === "check" ? 14 : 16)}</template>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${ICON_LINKS}
<meta name="color-scheme" content="light dark">
<meta name="description" content="${esc(C.lede)}">
<title>${esc(C.title)} · Purser</title>
<style nonce="${n}">${CSS}${ASK_MARK_CSS}${o.embed ? EMBED_CSS : SITE_HEADER_CSS + APP_CSS}${MODERN_CSS}</style></head><body class="${o.embed ? "embed" : "page empty"}${ctx ? " has-ctx" : ""}${own ? " own-co" : ""}">
${o.embed ? "" : `${WAVE_CANVAS_HTML}<a class="skip" href="#q">Skip to the question box</a>${header("cloud", TRY_HEADER_LINKS)}`}
<main id="main" class="app">
<div class="shell">${app ? side : ""}
<section class="convo">${bar}
<div class="scroll" id="scroll">${helloBlock}<div class="chat" id="chat" role="log" aria-label="Conversation"></div></div>
${ctxBar(ctx, o.embed)}
${composer}</section>${app ? detailPanel : ""}</div>
</main>
<template id="mark">${icon("feather", 14)}</template><template id="fileicon">${icon("file", 14)}</template>${icons}
<p class="sr" id="say" role="status" aria-live="polite"></p>
<script type="module" nonce="${n}">${script}${app ? `\n${ASK_WAVE_JS}` : ""}</script>
</body></html>`;
}
const ASK_WAVE_JS = waveScript({ selector: "canvas.pw-wave", placement: "hero", intensity: 1.15 });

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
const C = ${json({ fab: ASK_PAGE_COPY.fab, close: ASK_PAGE_COPY.close, title: ASK_PAGE_COPY.title })};
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
#pask-fab{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483000;box-sizing:border-box;display:inline-grid;place-items:center;width:46px;height:46px;padding:0;margin:0;border-radius:50%;border:1px solid rgba(167,139,250,.5);background:radial-gradient(120% 120% at 30% 20%,#2b2457 0%,#120f26 58%,#0a0915 100%);color:#fff;cursor:pointer;box-shadow:0 0 0 4px rgba(129,95,250,.12),0 10px 28px -8px rgba(129,95,250,.65),inset 0 1px rgba(255,255,255,.16);transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease;-webkit-tap-highlight-color:transparent}
#pask-fab:hover{transform:translateY(-1px);border-color:rgba(196,184,255,.8);box-shadow:0 0 0 5px rgba(129,95,250,.18),0 14px 34px -8px rgba(129,95,250,.8),inset 0 1px rgba(255,255,255,.2)}
#pask-fab:focus-visible{outline:3px solid #a78bfa;outline-offset:3px}
#pask-fab svg{flex:none;display:block}
body>#pask-fab svg{width:30px;height:30px}
body>#pask-fab .mk-bg{fill:transparent}body>#pask-fab .mk-ink{stroke:#fff}
#pask-fab[aria-expanded="true"]{border-color:rgba(196,184,255,.85);box-shadow:0 0 0 5px rgba(129,95,250,.22),0 10px 28px -8px rgba(129,95,250,.7)}
body>#pask-fab::after{content:attr(data-tip);position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%);padding:6px 10px;border-radius:8px;background:#0d0b1a;color:#eef1f6;border:1px solid rgba(167,139,250,.35);font:600 12.5px/1.2 Inter,system-ui,-apple-system,sans-serif;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s ease}
@media (hover:hover){body>#pask-fab:hover::after{opacity:1}}body>#pask-fab:focus-visible::after{opacity:1}
body>#pask-fab[aria-expanded="true"]::after{opacity:0}
#pask-panel{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(74px,calc(env(safe-area-inset-bottom) + 74px));z-index:2147483001;width:min(440px,calc(100vw - 32px));height:min(680px,calc(100vh - 106px));border-radius:16px;overflow:hidden;border:1px solid rgba(14,11,26,.1);background:#fff;box-shadow:0 24px 64px -16px rgba(14,11,26,.28),0 2px 8px rgba(14,11,26,.08)}
#pask-panel iframe{display:block;width:100%;height:100%;border:0;background:transparent}
@media (prefers-color-scheme: dark){#pask-panel{background:#100e18;border-color:rgba(255,255,255,.09);box-shadow:0 24px 64px -16px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.3)}}
@media (max-width:560px){#pask-panel{inset:0;width:100%;height:100%;border-radius:0;border:0}#pask-fab{width:44px;height:44px;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom))}body>#pask-fab svg{width:28px;height:28px}}
@media (prefers-reduced-motion: reduce){#pask-fab,#pask-fab::after{transition:none}#pask-fab:hover{transform:none}}
#pask-space{display:block;height:calc(64px + env(safe-area-inset-bottom));pointer-events:none}
@media (max-width:1023px){.signed-in>#pask-space{display:none}}
@media print{#pask-fab,#pask-panel,#pask-space{display:none}}${ASK_MARK_CSS}\`;
  document.head.append(st);
  const fab = document.createElement('button');
  fab.id = 'pask-fab'; fab.type = 'button';
  fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'pask-panel');
  fab.dataset.tip = C.fab;
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of [['width', '32'], ['height', '32'], ['viewBox', '0 0 32 32'], ['aria-hidden', 'true'], ['focusable', 'false']]) svg.setAttribute(k, v);
  for (const [tag, a] of ${json(ASK_MARK)}) { const e = document.createElementNS(NS, tag); for (const k of Object.keys(a)) e.setAttribute(k, a[k]); svg.append(e); }
  // 21 Nov (Max: "keep Purser very small, only the logo in the bottom right"): a round button with the feather alone; its
  // name is "Ask Purser" (aria-label), its hover tip the same words.
  fab.append(svg);
  fab.setAttribute('aria-label', C.fab);
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
  // Room at the page's foot, so the button never covers its last line (the footer's "Test money only" on a phone).
  const space = document.createElement('div'); space.id = 'pask-space'; space.setAttribute('aria-hidden', 'true');
  document.body.append(space, fab);
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
export function askPageResponse(url: URL, live = false, waiting: number | null = null): Response {
  const n = nonce();
  const p = url.searchParams;
  // The console's page, from the button's address (?ctx=invoice&id=…&demo=1): checked, or none.
  const context = parseContext({ kind: p.get("ctx"), id: p.get("id") ?? undefined, demo: p.get("demo") === "1" });
  return new Response(askPage(n, { embed: p.get("embed") === "1", live, context, waiting }), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": askCsp(n) } });
}

/** GET /ask/button.js: the module, cached an hour, loadable by this origin's pages. */
export function askButtonResponse(): Response {
  return new Response(ASK_BUTTON_JS, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin", "strict-transport-security": "max-age=31536000; includeSubDomains" } });
}
