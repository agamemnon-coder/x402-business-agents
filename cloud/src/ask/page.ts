// Ask Purser's page (/ask) and its button (/ask/button.js), 20 Nov. The page is the chat: suggested questions, the
// conversation, a box to ask in; it streams POST /v1/ask and draws every value as text (textContent), never as markup,
// so an answer can never become HTML. One script and one style under the page's nonce; no inline handler, no other
// origin. /ask?embed=1 is the same chat without the site's header, for the button's panel (frame-ancestors 'self').
// The button is a module any page of this origin (or of the site, which passes /ask through, worker/src/tryEngine.ts)
// includes with <script type="module" src="/ask/button.js" nonce="…">: a floating "Ask Purser" button that opens the
// chat in a dialog (a same-origin frame), closed with Escape or its close button, focus returned to the button.
import { header, TOKENS } from "../../../src/redesign/ui.js";
import { ICON_LINKS } from "../brand.js";
import { SITE_HEADER_CSS, TRY_HEADER_LINKS } from "../siteHeader.js";
import { ASK_COPY, QUESTION_MAX, SUGGESTIONS } from "./core.js";

export const ASK_PATH = "/ask";
export const ASK_BUTTON_PATH = "/ask/button.js";

/** Every word of the page (tests and the browser check read them). */
export const ASK_PAGE_COPY = {
  title: "Ask Purser",
  lede: "Questions about Purser, answered right away from its public docs, with a link to each source.",
  band: "Read-only · test money only · cites its sources",
  scope: "It can't pay, approve, change a limit or see any company's data. If the docs don't say, it says so.",
  privacy: "Nothing you type is stored: only hourly counts. Answers can be wrong; the linked docs are what counts.",
  placeholder: "Ask a question about Purser",
  label: "Your question",
  send: "Ask",
  sending: "Answering…",
  newChat: "New chat",
  close: "Close Ask Purser",
  full: "Open in a new tab",
  suggestionsHead: "Try asking",
  you: "You",
  purser: "Ask Purser",
  sources: "Sources",
  related: "Related in the docs",
  live: "Answered by Claude (Haiku) from Purser's docs. Each claim links to its source.",
  docs: "Answered from Purser's docs without AI.",
  refused: "Answered by Purser's own code.",
  error: "The answer could not be fetched. Check your connection and ask again.",
  counter: "characters left",
  testMoney: ASK_COPY.testMoney,
  fab: "Ask Purser",
  fabHint: "Questions? Ask Purser",
} as const;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const CSS = `${TOKENS.replace("url(assets/inter.woff2", "url(/assets/inter.woff2")}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; height: 100%; }
body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font: 400 16px/1.55 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; display: flex; flex-direction: column; }
body.embed { background: var(--surface); height: 100%; }
main { width: 100%; max-width: 760px; margin: 0 auto; padding: 0 var(--gut, 16px) 16px; display: flex; flex-direction: column; flex: 1; min-height: 0; }
body.embed main { padding: 0 14px 12px; max-width: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.skip { position: absolute; left: -9999px; } .skip:focus { left: 12px; top: 12px; z-index: 50; background: var(--surface); padding: 8px 12px; border-radius: 8px; }
.intro { padding: 20px 0 8px; }
body.embed .intro { padding: 4px 0 4px; }
h1 { font-size: 28px; line-height: 1.15; letter-spacing: -.02em; margin: 12px 0 8px; display: flex; align-items: center; gap: 10px; }
body.embed h1 { font-size: 17px; margin: 0; display: block; line-height: 1.2; }
.mk { width: 30px; height: 30px; border-radius: 9px; background: var(--accent); color: #fff; display: inline-grid; place-items: center; flex: none; }
body.embed .mk { width: 26px; height: 26px; border-radius: 8px; }
.lede { color: var(--muted); margin: 0 0 8px; }
.band { display: inline-flex; gap: 6px; align-items: center; margin: 12px 0 0; padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 13px; }
.band::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ok); }
.scope { font-size: 14px; color: var(--muted); margin: 0; }
.bar { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--surface); z-index: 2; }
.bar .grow { flex: 1; min-width: 0; }
.bar .sub { display: block; font-size: 12px; color: var(--muted); font-weight: 400; letter-spacing: 0; }
.iconbtn { min-width: 40px; min-height: 40px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); display: inline-grid; place-items: center; cursor: pointer; text-decoration: none; font: 600 13px/1 Inter, system-ui, sans-serif; padding: 0 10px; }
.iconbtn:hover { background: var(--sunken); }
.chat { flex: 1; min-height: 240px; overflow-y: auto; padding: 12px 0; display: flex; flex-direction: column; gap: 14px; }
body:not(.embed) .chat { min-height: 300px; }
.chat:empty { display: none; }
.msg { max-width: 92%; }
.msg.you { align-self: flex-end; background: var(--accent); color: #fff; border-radius: 16px 16px 4px 16px; padding: 9px 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.bot { align-self: flex-start; background: var(--sunken); border: 1px solid var(--border); border-radius: 16px 16px 16px 4px; padding: 10px 14px; overflow-wrap: anywhere; }
.msg.bot p { margin: 0 0 8px; } .msg.bot p:last-child { margin-bottom: 0; }
.msg.bot ul { margin: 0 0 8px; padding-left: 20px; }
.who { display: block; font-size: 12px; font-weight: 650; color: var(--muted); margin-bottom: 2px; }
.msg.you .who { color: rgba(255,255,255,.85); }
.cite { font-size: 11px; line-height: 1; font-weight: 650; text-decoration: none; color: var(--accent); background: var(--accent-soft); border-radius: 5px; padding: 2px 4px; margin-left: 2px; white-space: nowrap; vertical-align: 2px; }
.cite:hover, .msg.bot a:hover { text-decoration: underline; }
.msg.bot a { color: var(--accent); }
.meta { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 13px; color: var(--muted); }
.meta ol { margin: 4px 0 0; padding-left: 22px; }
.meta li { margin: 2px 0; }
.meta .how { display: block; margin-top: 6px; font-size: 12px; }
.note { font-size: 13px; color: var(--muted); font-style: italic; }
.typing { display: inline-flex; gap: 4px; padding: 4px 0; } .typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); opacity: .4; animation: blink 1.2s infinite; } .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .typing i { animation: none; opacity: .8; } }
.sugg h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 8px 0; font-weight: 650; }
.sugg ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.chip { min-height: 40px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 6px 14px; font: 500 14px/1.3 Inter, system-ui, sans-serif; cursor: pointer; text-align: left; }
.chip:hover { border-color: var(--accent); background: var(--accent-soft); }
form { display: flex; gap: 8px; align-items: flex-end; padding-top: 10px; border-top: 1px solid var(--border); position: sticky; bottom: 0; background: inherit; }
body:not(.embed) form { background: var(--bg); padding-bottom: 8px; }
.field { flex: 1; min-width: 0; }
textarea { width: 100%; resize: none; min-height: 48px; max-height: 160px; border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; font: 400 16px/1.4 Inter, system-ui, sans-serif; color: var(--text); background: var(--surface); }
textarea:focus { outline: 3px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 0; border-color: var(--accent); }
.count { display: block; font-size: 12px; color: var(--faint); margin-top: 4px; min-height: 16px; }
.btn { min-height: 48px; padding: 0 20px; border-radius: 14px; border: 1px solid var(--accent); background: var(--accent); color: #fff; font: 650 15px/1.2 Inter, system-ui, sans-serif; cursor: pointer; margin-bottom: 20px; }
.btn:disabled { opacity: .55; cursor: progress; }
.btn:focus-visible, .chip:focus-visible, .iconbtn:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.foot { font-size: 12px; color: var(--faint); margin: 4px 0 0; }
@media (max-width: 520px) { h1 { font-size: 24px; } .msg { max-width: 100%; } }
`;

const SCRIPT = `
const C = __COPY__, CFG = __CFG__;
const $ = (id) => document.getElementById(id);
const chat = $('chat'), form = $('ask'), q = $('q'), send = $('send'), say = $('say'), count = $('count'), sugg = $('sugg');
const KEY = 'purser.ask';
let history = [];
let busy = false;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const okHost = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && CFG.hosts.some((h) => (x.host + x.pathname).startsWith(h)); } catch (e) { return false; } };
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-12))); } catch (e) {} }

// One line of an answer as text, citations [n] as links to their source, links to Purser's own sites as links.
function inline(parent, text, sources) {
  const re = /\\[(\\d{1,2})\\]|https?:\\/\\/[^\\s)<>\\]]+/g;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) parent.append(text.slice(at, m.index));
    if (m[1]) {
      const s = sources[Number(m[1]) - 1];
      if (s) { const a = el('a', 'cite', '[' + m[1] + ']'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Source ' + m[1] + ': ' + s.title + ' (opens in a new tab)'); parent.append(a); }
      else parent.append(m[0]);
    } else {
      let u = m[0].replace(/[.,;:]+$/, ''); const tail = m[0].slice(u.length);
      if (okHost(u)) { const a = el('a', null, u); a.href = u; a.target = '_blank'; a.rel = 'noopener'; parent.append(a); } else parent.append(u);
      if (tail) parent.append(tail);
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) parent.append(text.slice(at));
}
// The answer's text as paragraphs and "- " lists.
function draw(box, text, sources) {
  box.textContent = '';
  let list = null;
  for (const raw of text.split(/\\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^[-•*]\\s+/.exec(line);
    if (item) { if (!list) { list = el('ul'); box.append(list); } const li = el('li'); inline(li, line.slice(item[0].length), sources); list.append(li); }
    else { list = null; const p = el('p'); inline(p, line, sources); box.append(p); }
  }
}
function bubble(role, text) {
  const m = el('div', 'msg ' + (role === 'user' ? 'you' : 'bot'));
  m.append(el('span', 'who', role === 'user' ? C.you : C.purser));
  if (role === 'user') m.append(text); else { const b = el('div', 'body'); m.append(b); draw(b, text, []); }
  chat.append(m);
  return m;
}
function meta(m, sources, cited, mode, note, reason) {
  const box = el('div', 'meta');
  const shown = cited.length ? cited.map((n) => sources[n - 1]).filter(Boolean) : sources.slice(0, 3);
  if (shown.length) {
    box.append(el('span', null, cited.length ? C.sources : C.related));
    const ol = el('ol');
    for (const s of shown) { const li = el('li'); const a = el('a', null, s.title); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; li.append(a); ol.append(li); }
    box.append(ol);
  }
  if (note) box.append(el('p', 'note', note));
  box.append(el('span', 'how', (mode === 'live' ? C.live : mode === 'refused' ? C.refused : C.docs) + (reason && mode === 'docs' ? ' ' + reason : '')));
  m.append(box);
}
function scroll() { chat.scrollTop = chat.scrollHeight; }
function counter() { const left = CFG.max - q.value.length; count.textContent = left < 120 ? left + ' ' + C.counter : ''; }
function grow() { q.style.height = ''; if (q.value) q.style.height = Math.min(Math.max(q.scrollHeight + 2, 48), 160) + 'px'; }

async function ask(question) {
  question = question.trim();
  if (!question || busy) return;
  busy = true; send.disabled = true; send.textContent = C.sending; q.value = ''; counter(); grow();
  sugg.hidden = true;
  bubble('user', question);
  const m = el('div', 'msg bot'); m.setAttribute('aria-busy', 'true');
  m.append(el('span', 'who', C.purser));
  const body = el('div', 'body'); const dots = el('span', 'typing'); dots.setAttribute('aria-hidden', 'true'); dots.append(el('i'), el('i'), el('i')); body.append(dots); m.append(body);
  chat.append(m); scroll();
  say.textContent = C.sending;
  let text = '', sources = [], done = null;
  try {
    const r = await fetch('/v1/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, history: history.slice(-6) }) });
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
      while ((i = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'meta') sources = ev.sources || [];
        else if (ev.type === 'delta') { text += ev.text; draw(body, text, sources); scroll(); }
        else if (ev.type === 'reset') { text = ev.text; draw(body, text, sources); }
        else if (ev.type === 'done') done = ev;
      }
    }
    if (!done) throw new Error(C.error);
    draw(body, text, sources);
    meta(m, sources, done.cited || [], done.mode, done.note, done.reason);
    history.push({ role: 'user', text: question }, { role: 'assistant', text: text.slice(0, 1200) });
    save();
    say.textContent = C.purser + ': ' + text.replace(/\\[(\\d{1,2})\\]/g, '');
  } catch (e) {
    draw(body, (e && e.message) || C.error, []);
    m.classList.add('err');
    say.textContent = (e && e.message) || C.error;
  } finally {
    m.removeAttribute('aria-busy');
    busy = false; send.disabled = false; send.textContent = C.send; scroll(); q.focus();
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); ask(q.value); });
q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(q.value); } });
q.addEventListener('input', () => { counter(); grow(); });
for (const b of sugg.querySelectorAll('button[data-q]')) b.addEventListener('click', () => ask(b.dataset.q));
const reset = $('reset');
if (reset) reset.addEventListener('click', () => { history = []; save(); chat.textContent = ''; sugg.hidden = false; say.textContent = ''; q.focus(); });
const close = $('close');
const bye = () => { try { parent.postMessage({ type: 'purser-ask:close' }, location.origin); } catch (e) {} };
if (close) close.addEventListener('click', bye);
if (CFG.embed) document.addEventListener('keydown', (e) => { if (e.key === 'Escape') bye(); });
// The conversation of this tab, if it had one.
try { const old = JSON.parse(sessionStorage.getItem(KEY) || '[]'); if (Array.isArray(old)) for (const t of old) if (t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string') { history.push(t); bubble(t.role, t.text); } } catch (e) {}
if (history.length) { sugg.hidden = true; scroll(); }
const pre = new URLSearchParams(location.search).get('q');
if (pre && pre.length <= CFG.max) ask(pre);
if (CFG.embed) q.focus();
`;

/** The chat mark: a speech bubble with a question mark, its paths drawn as markup on the page and as DOM by the button. */
const MARK_PATHS = ["M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z", "M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3", "M12 16.5h.01"];
const MARK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MARK_PATHS.map((d) => `<path d="${d}"/>`).join("")}</svg>`;

/** The page: the chat, standalone (the site's header) or embedded (?embed=1, a bar with a close button). */
export function askPage(n: string, o: { embed: boolean }): string {
  const C = ASK_PAGE_COPY;
  const script = SCRIPT.replace("__COPY__", () => json(C)).replace("__CFG__", () => json({ embed: o.embed, max: QUESTION_MAX, hosts: ["github.com/agamemnon-coder/x402-business-agents", "kit11.max-31b.workers.dev", "purser-try.max-31b.workers.dev", "youtu.be/"] }));
  const top = o.embed
    ? `<div class="bar"><span class="mk">${MARK}</span><h1 class="grow">${esc(C.title)}<span class="sub">${esc(C.band)}</span></h1><button class="iconbtn" id="reset" type="button">${esc(C.newChat)}</button><a class="iconbtn" href="${ASK_PATH}" target="_blank" rel="noopener" aria-label="${esc(C.full)}" title="${esc(C.full)}">↗</a><button class="iconbtn" id="close" type="button" aria-label="${esc(C.close)}" title="${esc(C.close)}">✕</button></div>
<p class="scope">${esc(C.scope)}</p>`
    : `<div class="intro"><p class="band">${esc(C.band)}</p><h1><span class="mk">${MARK}</span>${esc(C.title)}</h1><p class="lede">${esc(C.lede)}</p><p class="scope">${esc(C.scope)} ${esc(C.testMoney)}</p></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${ICON_LINKS}
<meta name="color-scheme" content="light dark">
<meta name="description" content="${esc(C.lede)}">
<title>${esc(C.title)} · Purser</title>
<style nonce="${n}">${CSS}${o.embed ? "" : SITE_HEADER_CSS}</style></head><body class="${o.embed ? "embed" : "page"}">
${o.embed ? "" : `<a class="skip" href="#q">Skip to the question box</a>${header(null, TRY_HEADER_LINKS)}`}
<main id="main">
${top}
<div class="chat" id="chat" aria-label="Conversation"></div>
<section class="sugg" id="sugg" aria-labelledby="suggh"><h2 id="suggh">${esc(C.suggestionsHead)}</h2><ul>${SUGGESTIONS.map((s) => `<li><button class="chip" type="button" data-q="${esc(s)}">${esc(s)}</button></li>`).join("")}</ul></section>
<form id="ask" autocomplete="off"><div class="field"><label class="sr" for="q">${esc(C.label)}</label><textarea id="q" name="q" rows="1" maxlength="${QUESTION_MAX}" placeholder="${esc(C.placeholder)}" aria-describedby="foot"></textarea><span class="count" id="count" aria-live="polite"></span></div><button class="btn" id="send" type="submit">${esc(C.send)}</button></form>
<p class="foot" id="foot">${esc(C.privacy)}</p>
</main>
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
if (!document.getElementById('pask-fab')) {
  const me = document.querySelector('script[src*="/ask/button.js"]') || document.querySelector('script[nonce]');
  const nonce = (me && me.nonce) || '';
  const st = document.createElement('style');
  if (nonce) st.nonce = nonce;
  st.textContent = \`
#pask-fab{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483000;display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 18px 0 14px;border-radius:999px;border:0;background:linear-gradient(125deg,#b4a8ff,#8275f4);color:#120d2f;font:650 15px/1.2 Inter,system-ui,-apple-system,sans-serif;box-shadow:0 10px 36px -8px rgba(129,95,250,.45),inset 0 1px rgba(255,255,255,.42);cursor:pointer}
#pask-fab:hover{background:linear-gradient(125deg,#c7beff,#9488ff)}#pask-fab:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}
#pask-fab svg{flex:none}
#pask-panel{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(76px,calc(env(safe-area-inset-bottom) + 76px));z-index:2147483001;width:min(420px,calc(100vw - 32px));height:min(640px,calc(100vh - 110px));border-radius:20px;overflow:hidden;border:1px solid rgba(162,145,253,.45);background:#fff;box-shadow:0 26px 80px -18px rgba(76,46,179,.56)}
#pask-panel iframe{display:block;width:100%;height:100%;border:0;background:transparent}
@media (prefers-color-scheme: dark){#pask-panel{background:#101321}#pask-fab{background:linear-gradient(125deg,#b4a8ff,#8275f4)}}
@media (max-width:560px){#pask-panel{inset:0;width:100%;height:100%;border-radius:0;border:0}#pask-fab .pask-t{display:none}#pask-fab{padding:0 14px}}
@media print{#pask-fab,#pask-panel{display:none}}\`;
  document.head.append(st);
  const fab = document.createElement('button');
  fab.id = 'pask-fab'; fab.type = 'button';
  fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'pask-panel');
  fab.title = C.hint;
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of [['width', '18'], ['height', '18'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
  for (const d of ${json(MARK_PATHS)}) { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.append(path); }
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
      f.src = ORIGIN + '/ask?embed=1'; f.title = C.title; f.setAttribute('allow', 'clipboard-write');
      panel.append(f);
      document.body.append(panel);
      f.addEventListener('load', () => { try { f.contentWindow.focus(); } catch (e) {} });
    } else {
      panel.hidden = false;
      const f = panel.querySelector('iframe'); try { f.contentWindow.focus(); } catch (e) {}
    }
    fab.setAttribute('aria-expanded', 'true');
    if (matchMedia('(max-width: 560px)').matches) fab.hidden = true;
  };
  fab.addEventListener('click', () => (panel && !panel.hidden ? close() : open()));
  addEventListener('message', (e) => { if (e.origin === ORIGIN && e.data && e.data.type === 'purser-ask:close') close(); });
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

/** GET /ask (and ?embed=1). */
export function askPageResponse(url: URL): Response {
  const n = nonce();
  return new Response(askPage(n, { embed: url.searchParams.get("embed") === "1" }), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": askCsp(n) } });
}

/** GET /ask/button.js: the module, cached an hour, loadable by this origin's pages. */
export function askButtonResponse(): Response {
  return new Response(ASK_BUTTON_JS, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin", "strict-transport-security": "max-age=31536000; includeSubDomains" } });
}
