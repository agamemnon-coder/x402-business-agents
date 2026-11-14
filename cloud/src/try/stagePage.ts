// Stage mode for the finals (docs/finals/stage-mode.md): the presenter's screen at /try/stage, made for a projector at
// 1920×1080 and readable on a phone. A huge QR code to /try (the event pool's, when the presenter's link carries an
// event token in its fragment, #e=<token>), the headline, and a live wall that reads GET /v1/try/stage/stats every
// 2 seconds: five counts and a ticker of anonymous steps, all from the engine's own answers (./stage.ts). The test-money
// label is always on screen. When the counts cannot be read the wall says "Live counts paused" and the QR code, drawn
// into the page by the server, still works. "Recorded run" plays a real /try run recorded on 13 Nov
// (docs/video/recording-try-v10.json) from data inside the page, so it plays with no network at all.
//
// One page, one script under the console's nonce policy: every value from the API is put on the page as text
// (textContent), the QR code's path is set as an attribute after a check that it holds only path commands and numbers.
// The page itself sets nothing on the server: its controls (recorded run, count from now, full screen) change only
// this screen. The admin's switches stay with POST /v1/try/admin.
import { ICON_LINKS } from "../brand.js";
import { consoleCsp } from "../console.js";
import { TOKENS } from "../../../src/redesign/ui.js";
import { qrParts, stageJoinUrl } from "./stageRoutes.js";

export const STAGE_HEADLINE = "Take out your phone. Sign a real invoice with your own Face ID.";
export const STAGE_SUB = "Claude reads it, Purser's code checks it, you sign the exact terms with your passkey. Change one cent and the signature is refused.";
export const STAGE_MONEY = "Test money · simulated bank · nothing real is paid";
export const STAGE_PAUSED = "Live counts paused";
/** The five counts, in the order of the wall, by the key of GET /v1/try/stage/stats's counts. */
export const STAGE_TILES: readonly (readonly [key: string, label: string])[] = [
  ["started", "test companies started"],
  ["read_by_claude", "invoices read by Claude"],
  ["signed", "signed with a passkey"],
  ["paid", "paid on the simulated bank"],
  ["refused", "changed after signing: refused"],
];

/**
 * The recorded run: a real run of /try on 13 Nov 2026 (docs/video/recording-try-v10.json), its marks in seconds and,
 * for each step, words the page showed at that mark (test/try-stage.test.ts holds each line to the file's `said`).
 */
export const STAGE_RECORDED = {
  date: "13 Nov 2026",
  how: "A real run of /try, recorded in headless Chromium with a virtual test passkey, not a person's Face ID. Test money on the simulated bank.",
  steps: [
    { mark: "start", at: 0.5, label: "Start", line: "Start with a test company" },
    { mark: "duplicate", at: 20.0, label: "Claude reads", line: "Caught: a copy of a filed invoice." },
    { mark: "checked", at: 35.9, label: "Checked", line: "An invoice of EUR 1,850.00 came in and was checked: ready to pay." },
    { mark: "approve-shown", at: 40.8, label: "Approve", line: "Approve the payment. EUR 1,850.00 Payee Bergtex Textil GmbH" },
    { mark: "paid", at: 54.2, label: "Signed and paid", line: "Paid, booked, filed." },
    { mark: "refused", at: 60.4, label: "Changed: refused", line: "This signature is over other terms than the ones on screen. Nothing was paid." },
  ],
  seconds: 64.4,
} as const;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const CSS = `${TOKENS.replace("url(assets/inter.woff2)", "url(/assets/inter.woff2)")}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 18px/1.45 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
.band { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 72px; border-bottom: 1px solid var(--border); }
.brand { font-weight: 750; font-size: 24px; letter-spacing: -.02em; }
.brand span { color: var(--muted); font-weight: 500; }
.money { display: inline-flex; align-items: center; gap: 10px; padding: 8px 18px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); font-weight: 650; font-size: 20px; white-space: nowrap; }
.money::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--ok); }
.stage { display: grid; grid-template-columns: 660px 1fr; gap: 72px; padding: 32px 72px 12px; align-items: start; }
.qr { background: #fff; border-radius: 28px; padding: 26px; box-shadow: var(--shadow); }
.qr svg { display: block; width: 100%; height: auto; }
.join { margin: 18px 0 0; font-size: 30px; font-weight: 650; letter-spacing: -.01em; text-align: center; overflow-wrap: anywhere; }
.scan { margin: 4px 0 0; color: var(--muted); font-size: 20px; text-align: center; }
h1 { margin: 0; font-size: 64px; line-height: 1.06; letter-spacing: -.03em; font-weight: 780; }
.sub { margin: 18px 0 0; color: var(--muted); font-size: 26px; max-width: 980px; }
.tiles { list-style: none; margin: 36px 0 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 20px 20px 18px; min-width: 0; }
.tile b { display: block; font-size: 76px; line-height: 1; font-weight: 760; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.tile span { display: block; margin-top: 10px; color: var(--muted); font-size: 19px; line-height: 1.25; }
.tile.refused b { color: var(--bad); }
.tile.paid b { color: var(--ok); }
.paused .tile b { color: var(--faint); }
.bump { animation: bump .9s ease-out; }
@keyframes bump { 0% { background: var(--accent-soft); } 100% { background: var(--surface); } }
.ticker { list-style: none; margin: 24px 0 0; padding: 0; display: grid; gap: 10px; }
.ticker li { display: flex; gap: 18px; align-items: baseline; font-size: 24px; padding: 10px 18px; border-radius: 16px; background: var(--sunken); }
.ticker li.new { animation: slide .6s ease-out; }
.ticker li time { flex: none; width: 110px; color: var(--faint); font-size: 18px; font-variant-numeric: tabular-nums; }
.ticker li.refused { background: var(--bad-soft); }
.ticker li.paid { background: var(--ok-soft); }
.ticker .empty { color: var(--muted); animation: none; }
@keyframes slide { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 72px 24px; color: var(--muted); font-size: 18px; flex-wrap: wrap; }
.status { display: inline-flex; align-items: center; gap: 10px; }
.status::before { content: ""; width: 12px; height: 12px; border-radius: 50%; background: var(--ok); }
.status.off::before { background: var(--faint); }
.status.bad::before { background: var(--bad); }
.status.bad { color: var(--bad); font-weight: 650; }
.controls { display: flex; gap: 10px; flex-wrap: wrap; }
button { font: inherit; font-size: 17px; font-weight: 600; padding: 10px 18px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; min-height: 44px; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.hint { margin: 10px 0 0; color: var(--faint); font-size: 16px; text-align: center; }
.rec { position: fixed; inset: 0; background: var(--bg); display: none; flex-direction: column; padding: 48px 72px; z-index: 10; overflow: auto; }
.rec.on { display: flex; }
.rec h2 { margin: 20px 0 0; font-size: 48px; letter-spacing: -.02em; }
.rec .how { margin: 10px 0 0; color: var(--muted); font-size: 22px; max-width: 1200px; }
.rec ol { list-style: none; margin: 32px 0 0; padding: 0; display: grid; gap: 14px; }
.rec li { display: grid; grid-template-columns: 120px 260px 1fr; gap: 20px; align-items: baseline; padding: 18px 22px; border-radius: 18px; background: var(--sunken); color: var(--faint); font-size: 26px; transition: background .4s, color .4s; }
.rec li.done { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
.rec li.done.bad { background: var(--bad-soft); }
.rec li b { font-weight: 700; }
.rec li time { font-variant-numeric: tabular-nums; font-size: 20px; }
.bar { height: 8px; border-radius: 99px; background: var(--sunken); margin-top: 28px; overflow: hidden; }
.bar i { display: block; height: 100%; width: 0; background: var(--accent); }
.rec .controls { margin-top: 24px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .bump, .ticker li.new { animation: none; } .rec li { transition: none; } }
@media (max-width: 1500px) { .stage { grid-template-columns: 520px 1fr; gap: 48px; } h1 { font-size: 52px; } .tile b { font-size: 60px; } }
@media (max-width: 1100px) {
  .band { padding: 14px var(--gut); flex-wrap: wrap; } .brand { font-size: 20px; } .money { font-size: 15px; padding: 6px 12px; white-space: normal; }
  .stage { grid-template-columns: 1fr; gap: 28px; padding: 20px var(--gut); }
  .qr { padding: 14px; border-radius: 20px; max-width: 520px; margin: 0 auto; width: 100%; }
  .join { font-size: 20px; } .scan { font-size: 16px; }
  h1 { font-size: 32px; } .sub { font-size: 18px; }
  .tiles { grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 22px; } .tile { padding: 14px; } .tile b { font-size: 40px; } .tile span { font-size: 15px; }
  .ticker li { font-size: 17px; padding: 10px 12px; gap: 10px; } .ticker li time { width: 72px; font-size: 14px; }
  .foot { padding: 12px var(--gut) 24px; font-size: 15px; }
  .rec { padding: 24px var(--gut); } .rec h2 { font-size: 28px; } .rec .how { font-size: 16px; }
  .rec li { grid-template-columns: 1fr; gap: 4px; font-size: 18px; padding: 12px 14px; } .rec li time { font-size: 14px; }
}
`;

const SCRIPT = `
const CFG=__CFG__;
const $=(id)=>document.getElementById(id);
const store=(kind)=>{try{return kind==='l'?localStorage:sessionStorage}catch(e){return null}};
const get=(kind,k)=>{try{const s=store(kind);return s?s.getItem(k):null}catch(e){return null}};
const put=(kind,k,v)=>{try{const s=store(kind);if(s)s.setItem(k,v)}catch(e){}};
const REDUCED=matchMedia('(prefers-reduced-motion: reduce)').matches;
// Since when the wall counts: kept on this screen; "Count from now" moves it.
let since=get('l','purser.stage.since');
if(!since||isNaN(Date.parse(since))){since=new Date().toISOString();put('l','purser.stage.since',since)}
// The presenter's event token, from the link's fragment only (never sent in a URL); taken off the address bar at once.
const TOKEN=(()=>{const m=/^#e=([A-Za-z0-9_.~-]{16,256})$/.exec(location.hash);if(location.hash)history.replaceState(null,'',location.pathname+location.search);if(m){put('s','purser.stage.e',m[1]);return m[1]}return get('s','purser.stage.e')})();
const say=(t)=>{$('say').textContent=t};
const fmtAgo=(s)=>s<5?'just now':s<60?Math.round(s)+' s ago':s<3600?Math.floor(s/60)+' min ago':Math.floor(s/3600)+' h ago';
const tiles={};
for(const [k,label] of CFG.tiles){const li=document.createElement('li');li.className='tile '+k;const b=document.createElement('b');b.textContent='0';const sp=document.createElement('span');sp.textContent=label;li.append(b,sp);$('tiles').append(li);tiles[k]=b}
let last=null;
function draw(j){
  $('wall').classList.remove('paused');
  for(const [k] of CFG.tiles){const v=Number(j.counts&&j.counts[k])||0;const b=tiles[k];const was=b.textContent;const now=v.toLocaleString('en-US');if(was!==now){b.textContent=now;if(last&&!REDUCED){const t=b.parentElement;t.classList.remove('bump');void t.offsetWidth;t.classList.add('bump')}}}
  const list=$('ticker');const at=Date.parse(j.counted_at)||Date.now();const rows=Array.isArray(j.ticker)?j.ticker.slice(0,CFG.rows):[];
  const key=rows.map((r)=>r.at+r.kind).join('|');
  {
    const seen=new Set(last?last.key.split('|'):[]);const items=rows.map((r)=>{const li=document.createElement('li');li.className=String(r.kind||'').replace(/[^a-z]/g,'')+(last&&!seen.has(r.at+r.kind)?' new':'');const t=document.createElement('time');t.textContent=fmtAgo(Math.max(0,(at-Date.parse(r.at))/1000));const s=document.createElement('span');s.textContent=String(r.text||'');li.append(t,s);return li});
    if(!items.length){const li=document.createElement('li');li.className='empty';li.textContent=j.live?CFG.empty:CFG.closed;items.push(li)}
    list.replaceChildren(...items);
  }
  const st=$('status');st.className='status'+(j.live?'':' off');st.textContent=j.live?CFG.liveLine:CFG.closedLine;
  if(last&&rows.length&&key!==last.key)say(rows[0].text);
  last={key};
}
function paused(){$('wall').classList.add('paused');const st=$('status');st.className='status bad';st.textContent=CFG.paused;}
let failures=0;
async function tick(){
  if(document.hidden){setTimeout(tick,CFG.every);return}
  const ac=new AbortController();const to=setTimeout(()=>ac.abort(),5000);
  try{
    const r=await fetch('/v1/try/stage/stats?since='+encodeURIComponent(since),{signal:ac.signal,cache:'no-store'});
    if(!r.ok)throw new Error(String(r.status));
    draw(await r.json());failures=0;
  }catch(e){failures++;paused()}
  finally{clearTimeout(to)}
  setTimeout(tick,failures?Math.min(CFG.every*failures,10000):CFG.every);
}
// The QR code with the event token: the server draws its path; the page sets it after checking it is only numbers.
async function tokenQr(){
  const note=$('qrnote');
  if(!TOKEN){note.textContent=CFG.noToken;return}
  try{
    const r=await fetch('/v1/try/stage/qr',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TOKEN})});
    const j=await r.json();
    if(!r.ok||!/^[Mhvz0-9 -]+$/.test(String(j.d))||!(j.size>20&&j.size<200)){note.textContent=CFG.badToken;return}
    const svg=$('qrsvg');svg.setAttribute('viewBox','0 0 '+j.size+' '+j.size);svg.querySelector('rect').setAttribute('width',String(j.size));svg.querySelector('rect').setAttribute('height',String(j.size));svg.querySelector('path').setAttribute('d',j.d);
    note.textContent=CFG.tokenOn+' '+new Date(j.until).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  }catch(e){note.textContent=CFG.badToken}
}
// The recorded run: played from data inside the page, at the pace it was recorded.
let recTimer=null,recStart=0;
function recDraw(){
  const t=(performance.now()-recStart)/1000;
  const lis=$('recsteps').children;
  CFG.rec.steps.forEach((s,i)=>{lis[i].classList.toggle('done',t>=s.at)});
  $('recbar').style.width=Math.min(100,t/CFG.rec.seconds*100)+'%';
  if(t>=CFG.rec.seconds+3){clearInterval(recTimer);recTimer=null}
}
function recPlay(){
  $('rec').classList.add('on');recStart=performance.now();
  if(recTimer)clearInterval(recTimer);recTimer=setInterval(recDraw,REDUCED?1000:250);recDraw();$('recclose').focus();
}
function recClose(){$('rec').classList.remove('on');if(recTimer)clearInterval(recTimer);recTimer=null;$('recbtn').focus()}
(function(){const ol=$('recsteps');for(const s of CFG.rec.steps){const li=document.createElement('li');if(s.mark==='refused')li.classList.add('bad');const t=document.createElement('time');t.textContent=s.at.toFixed(1)+' s';const b=document.createElement('b');b.textContent=s.label;const sp=document.createElement('span');sp.textContent=s.line;li.append(t,b,sp);ol.append(li)}})();
$('recbtn').addEventListener('click',recPlay);
$('recclose').addEventListener('click',recClose);
$('recagain').addEventListener('click',recPlay);
$('fromnow').addEventListener('click',()=>{since=new Date().toISOString();put('l','purser.stage.since',since);last=null;say(CFG.fromNow)});
$('full').addEventListener('click',()=>{if(document.fullscreenElement)document.exitFullscreen();else if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{})});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'){if($('rec').classList.contains('on'))recClose();return}if(e.target&&e.target.tagName==='BUTTON')return;if(e.key==='r'||e.key==='R')recPlay()});
tokenQr();tick();
`;

/** The page, for a host: its QR code (drawn here) points at /try on that host, said to be the event's. */
export function stagePage(n: string, origin: string): string {
  const join = stageJoinUrl(origin);
  const qr = qrParts(join);
  const cfg = {
    tiles: STAGE_TILES, rows: 5, every: 2_000, paused: `${STAGE_PAUSED}: the QR code still works`,
    liveLine: "Live from Purser's engine · event pool only · no names, no addresses",
    closedLine: "The event pool is closed: the counts are 0 until it opens",
    empty: "Waiting for the first phone…", closed: "The counts start when the event pool opens.",
    noToken: "This link has no event token: phones join the public pool (see the runbook).",
    badToken: "This link's event token is not live: phones join the public pool.",
    tokenOn: "Event pool · until", fromNow: "Counting from now.",
    rec: STAGE_RECORDED,
  };
  const shown = join.replace(/^https?:\/\//, "").replace(/\?pool=event$/, "");
  return `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${ICON_LINKS}
<meta name="robots" content="noindex">
<title>Purser · stage</title>
<style nonce="${n}">${CSS}</style></head><body>
<header class="band"><div class="brand">Purser <span>· live at the finals</span></div><div class="money" id="money">${esc(STAGE_MONEY)}</div></header>
<main class="stage" id="wall">
<section aria-label="Join on your phone">
<div class="qr"><svg id="qrsvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size} ${qr.size}" shape-rendering="crispEdges" role="img" aria-label="QR code: ${esc(join)}"><rect width="${qr.size}" height="${qr.size}" fill="#fff"/><path fill="#000" d="${qr.d}"/></svg></div>
<p class="join">${esc(shown)}</p>
<p class="scan">Scan with your camera · your own test company, deleted after 24 h</p>
<p class="hint" id="qrnote"></p>
</section>
<section aria-label="What the room is doing">
<h1>${esc(STAGE_HEADLINE)}</h1>
<p class="sub">${esc(STAGE_SUB)}</p>
<ul class="tiles" id="tiles" aria-label="Counts from the event pool"></ul>
<ul class="ticker" id="ticker" aria-label="Latest steps, anonymous"><li class="empty">Reading the counts…</li></ul>
</section>
</main>
<footer class="foot"><span class="status off" id="status">Reading the counts…</span>
<span class="controls"><button class="primary" id="recbtn" type="button">Recorded run</button><button id="fromnow" type="button">Count from now</button><button id="full" type="button">Full screen</button></span></footer>
<section class="rec" id="rec" role="dialog" aria-modal="true" aria-labelledby="rech">
<div class="money">${esc(STAGE_MONEY)}</div>
<h2 id="rech">Recorded run · ${esc(STAGE_RECORDED.date)}</h2>
<p class="how">${esc(STAGE_RECORDED.how)}</p>
<ol id="recsteps"></ol>
<div class="bar"><i id="recbar"></i></div>
<div class="controls"><button class="primary" id="recagain" type="button">Play again</button><button id="recclose" type="button">Back to the live wall</button></div>
</section>
<p class="sr" id="say" role="status" aria-live="polite"></p>
<script type="module" nonce="${n}">${SCRIPT.replace("__CFG__", () => json(cfg))}</script>
</body></html>`;
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin", "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains", "x-frame-options": "DENY",
};

const nonce = (): string => {
  let s = "";
  for (const x of crypto.getRandomValues(new Uint8Array(18))) s += String.fromCharCode(x);
  return btoa(s);
};

/** GET /try/stage: the page under the console's policy, for the host it was asked on (purser-try's own or the site's). */
export function stagePageResponse(req: Request): Response {
  const n = nonce();
  return new Response(stagePage(n, new URL(req.url).origin), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": consoleCsp(n) } });
}
