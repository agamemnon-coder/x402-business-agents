// Recording mode for the Demo Day walkthrough (docs/finals/demo-recording.md): /try?present=1. A flag only. The page is
// the normal /try (cloud/src/tryPage.ts) with this style and one more script; every step is the real one, on Purser's
// engine, with test money on a simulated bank. Nothing here calls the API, fakes an answer or skips a step.
//
// What it adds, for a 1920×1080 screen recording with a camera bubble in the bottom-right corner:
// - A frame: larger type (the page's column zoomed), high contrast, the column at the left, a lane at the right for the
//   presenter's mirrored phone, and the bottom-right 340×340 px kept clear for the camera bubble.
// - An opener card (5 s, or →): Before and After, in one screen.
// - The phone lane: on the approval and pay steps, a framed place where the mirrored phone sits, with a caption. On a
//   desktop the passkey can be the phone's (the browser shows a QR code for it); the lane is where the audience sees it.
// - The outcome card at the end: the run's own numbers, read from the API's answers to this page in this browser (the
//   page's own requests, read, never changed): the time from the start to paid, the steps the engine recorded and how
//   many were Claude's, the amount paid, and whether a changed term was refused (and by which layers). Each figure is
//   what came back, or "not in this run".
// - The app shell (sidebar, sections, Claude's usage); ?shell=0 turns it off, and in it &neg=1 keeps the negotiation.
// - ?phone=0: no phone lane, for a laptop that signs with its own passkey (Windows Hello); R keeps it.
// - Keys for the presenter: → the step's main button (the same click a person makes), R start again (a new test
//   company), O the outcome card, Escape closes a card.
// Every value from an answer is put on the page as text (textContent), never as HTML.

import { INVOICE } from "../tryCopy.js";

const NEG_HINT = INVOICE.hints.clean ?? "";

export const PRESENT_BEFORE = "An agent's invoice lands in a queue. An approve button anyone can click pays it, whatever was changed on the way.";
export const PRESENT_AFTER = "The CFO signs the exact terms with Face ID. Change one cent and the signature is refused: nothing moves.";
export const PRESENT_TRY = "kit11.max-31b.workers.dev/try";
export const PRESENT_MONEY = "Test money · simulated bank · nothing real is paid";
export const PRESENT_LANE = "The CFO's phone, mirrored: Face ID signs the exact terms";
/**
 * The app shell (15 Nov, Max: "it needs to look like the actual product"): in recording mode, the site's menu and the
 * step bar give way to a product's own frame: a sidebar with the workspace, the sections (the current one lit by the
 * screen shown) and Claude's usage in this run, call by call (model, time, cost, Anthropic's request id), read from the
 * engine's own events. ?shell=0 turns it off.
 */
export const PRESENT_SHELL = {
  workspace: "Your test company",
  tag: "Test money · sandbox",
  nav: ["Inbox", "Approvals", "Payments", "Books", "Agents"],
  usage: "Claude · this run",
  none: "No Claude call yet",
  calls: "calls",
  user: "CFO",
  userSub: "Signs with a passkey",
  reader: "Reader",
} as const;
/** The figures of the outcome card, by name; each is filled from an answer or says NOT_IN_RUN. */
export const PRESENT_OUTCOME = {
  heading: "What just happened",
  time: "From start to paid",
  steps: "Steps the engine recorded",
  claude: "of them by Claude (it reads the invoices when the switch is on)",
  paid: "Paid on the simulated bank",
  refused: "One cent changed after signing",
  refusedYes: "Refused by both layers: the signature and the payment check. Nothing moved.",
  refusedPart: "Refused. Nothing moved.",
  measured: "Measured in this browser, from this run's own answers.",
  try: "Try it yourself:",
  notInRun: "not in this run",
} as const;

const CSS = `
/* Recording mode (cloud/src/try/presentMode.ts). */
:root { --present-cam: 340px; }
body.present { font-size: 18px; }
@media (min-width: 1200px) {
  body.present main { zoom: 1.22; max-width: 600px; margin: 0 0 0 max(48px, calc(50vw - 820px)); }
  body.present:has(.screen.start) main { zoom: 1.1; }
  body.present .trust { zoom: 1.2; }
  body.present #main h1 { letter-spacing: -.02em; }
  /* Paid, booked, filed: two columns, so the step fits 1080p without a scroll. */
  body.present:has(.screen.books) main { max-width: 1160px; }
  body.present .screen.books { display: grid; grid-template-columns: 1fr 1fr; column-gap: 22px; align-items: start; }
  /* The stamp, then the slot of the Airwallex sandbox transfer (empty unless awx_payout made one), then paid, booked,
     filed and the way on: placed by what they are, so the slot never moves the others (14 Nov). */
  /* Each block placed by what it is (15 Nov: the visual strip, prepended, had moved every child one place on): the stamp
     and the strip on top, the ledger's lines in the right column, the rest down the left. */
  body.present .screen.books > * { grid-column: 1; }
  body.present .screen.books > .paidstamp { grid-row: 1; }
  body.present .screen.books > .vflow { grid-column: 2; grid-row: 1; align-self: center; margin: 0; }
  body.present .screen.books > .slot:has(.booked) { grid-column: 2; grid-row: 2 / span 5; }
  /* The transfer card, compact for 1080p: its heading, the transfer id and the status; the rest stays in normal mode. */
  body.present .slot.payout .awx { padding: 10px 14px; margin: 0; }
  body.present .slot.payout .awx dl > :nth-child(n+5), body.present .slot.payout .awx > p { display: none; }
  /* "Try to change it" (15 Nov), recorded: the amount and the payee only; the attacks are for visitors. */
  body.present .screen.pay .tryform > .two, body.present .screen.pay .attacks, body.present .screen.pay > p:has(> .link), body.present .screen.pay .why p:has(> .proofdl) { display: none; }
}
/* A card over the page: the page behind it does not scroll. */
html:has(.pv-card.on) { overflow: hidden; }
body.present { --muted: color-mix(in srgb, var(--text) 78%, var(--bg)); --faint: color-mix(in srgb, var(--text) 64%, var(--bg)); }
.pv-money { position: fixed; top: 76px; right: 24px; z-index: 30; display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); font: 650 15px/1.2 Inter, system-ui, sans-serif; }
.pv-money::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.pv-lane { position: fixed; z-index: 20; top: 130px; right: calc(var(--present-cam) + 40px); width: 360px; display: none; flex-direction: column; align-items: center; gap: 14px; }
body.present:has(.screen.approve) .pv-lane, body.present:has(.screen.pay) .pv-lane { display: flex; }
.pv-phone { width: 300px; height: 620px; border-radius: 46px; border: 3px solid var(--border); background: var(--sunken); box-shadow: var(--shadow); display: grid; place-items: center; padding: 18px; position: relative; }
.pv-phone::before { content: ""; position: absolute; top: 14px; left: 50%; width: 90px; height: 24px; margin-left: -45px; border-radius: 99px; background: var(--border); }
.pv-phone span { color: var(--faint); font: 500 16px/1.4 Inter, system-ui, sans-serif; text-align: center; }
.pv-lane p { margin: 0; text-align: center; font: 600 18px/1.35 Inter, system-ui, sans-serif; color: var(--text); max-width: 340px; }
.pv-card { position: fixed; inset: 0; z-index: 60; display: none; place-items: center; background: var(--bg); padding: 48px calc(var(--present-cam) + 48px) 48px 96px; }
.pv-card.on { display: grid; }
.pv-card .in { width: 100%; max-width: 1240px; }
.pv-card h2 { margin: 0 0 28px; font: 780 56px/1.05 Inter, system-ui, sans-serif; letter-spacing: -.03em; color: var(--text); }
.pv-ba { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.pv-ba div { border-radius: 26px; padding: 34px 34px 38px; border: 1px solid var(--border); background: var(--surface); }
.pv-ba b { display: block; font: 700 22px/1.2 Inter, system-ui, sans-serif; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 14px; }
.pv-ba .before b { color: var(--bad); }
.pv-ba .after { border-color: color-mix(in srgb, var(--ok) 50%, var(--border)); }
.pv-ba .after b { color: var(--ok); }
.pv-ba p { margin: 0; font: 600 34px/1.25 Inter, system-ui, sans-serif; color: var(--text); letter-spacing: -.01em; }
.pv-sub { margin: 26px 0 0; color: var(--muted); font: 500 22px/1.4 Inter, system-ui, sans-serif; }
.pv-figs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
.pv-figs li { border-radius: 22px; padding: 24px 28px; background: var(--surface); border: 1px solid var(--border); min-width: 0; }
.pv-figs b { display: block; font: 760 54px/1.05 Inter, system-ui, sans-serif; letter-spacing: -.02em; color: var(--text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.pv-figs b.word { font-size: 28px; line-height: 1.25; letter-spacing: 0; }
.pv-figs b.none { color: var(--faint); font-size: 28px; }
.pv-figs span { display: block; margin-top: 8px; color: var(--muted); font: 500 20px/1.3 Inter, system-ui, sans-serif; }
.pv-figs li.ok b { color: var(--ok); }
.pv-try { margin: 28px 0 0; font: 700 34px/1.2 Inter, system-ui, sans-serif; color: var(--text); }
.pv-try span { color: var(--accent); }
.pv-card .pv-money { position: static; margin-bottom: 26px; }
.pv-card .pv-go { margin-top: 26px; color: var(--faint); font: 500 16px/1.2 Inter, system-ui, sans-serif; }
@media (max-width: 1199px) { .pv-lane { display: none !important; } .pv-card { padding: 24px 16px; } .pv-ba, .pv-figs { grid-template-columns: 1fr; } .pv-ba p { font-size: 22px; } .pv-card h2 { font-size: 32px; } .pv-figs b { font-size: 36px; } .pv-try { font-size: 22px; } .pv-money { top: auto; bottom: 12px; right: 12px; } }
@media (prefers-reduced-motion: no-preference) { .pv-card.on .in { animation: pvin .5s ease-out; } }
@keyframes pvin { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
/* The app shell (?shell=0 turns it off): the site's menu and step bar give way to a product frame. */
@media (min-width: 1200px) {
  body.present.pv-shell { padding-left: 276px; }
  body.present.pv-shell header.top, body.present.pv-shell .progw { display: none !important; }
  body.present.pv-shell .pv-money { top: 22px; }
  body.present.pv-shell .acts.pdfl { display: flex !important; }
  body.present.pv-shell .acts.pdfl .btn:not(.proofdl) { display: none; }
  body.present.pv-noneg .negcard { display: none !important; }
  body.present.pv-noneg .payrow { justify-content: flex-start; gap: 16px; }
}
.pv-side { display: none; }
@media (min-width: 1200px) {
  body.present.pv-shell .pv-side { display: flex; position: fixed; z-index: 40; left: 0; top: 0; bottom: 0; width: 252px; flex-direction: column; gap: 18px; padding: 22px 16px; background: color-mix(in srgb, var(--bg) 82%, #000); border-right: 1px solid var(--border); font: 500 14px/1.35 Inter, system-ui, sans-serif; color: var(--text); }
}
.pv-side .brand { display: flex; align-items: center; gap: 10px; font-weight: 750; font-size: 19px; color: var(--text); text-decoration: none; }
.pv-side .brand .mk { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--text); color: var(--bg); }
.pv-ws { padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; }
.pv-ws b { display: block; font-weight: 650; }
.pv-ws span { display: inline-block; margin-top: 4px; font-size: 12px; font-weight: 650; color: var(--ok); }
.pv-nav { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.pv-nav li { padding: 9px 12px; border-radius: 9px; color: var(--muted); font-weight: 600; }
body.present:has(.screen.invoice, .screen.work, .screen.start) .pv-nav li:nth-child(1),
body.present:has(.screen.approve) .pv-nav li:nth-child(2),
body.present:has(.screen.books, .screen.pay) .pv-nav li:nth-child(3),
body.present:has(.screen.company, .screen.did) .pv-nav li:nth-child(4) { background: color-mix(in srgb, var(--text) 10%, transparent); color: var(--text); }
.pv-use { margin-top: auto; padding: 12px; border: 1px solid var(--border); border-radius: 12px; }
.pv-use h3 { margin: 0 0 6px; font: 700 11px/1.2 Inter, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.pv-use .tot { font: 750 24px/1.15 Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.pv-use .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
.pv-use ol { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 7px; }
.pv-use li { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; font-size: 12.5px; }
.pv-use li b { font-weight: 650; }
.pv-use li .c { font-variant-numeric: tabular-nums; font-weight: 650; }
.pv-use li .m { grid-column: 1 / -1; color: var(--muted); font: 500 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
.pv-me { display: flex; align-items: center; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border); }
.pv-me .av { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--text); color: var(--bg); font: 750 12px/1 Inter, system-ui, sans-serif; }
.pv-me small { display: block; color: var(--muted); font-size: 12px; }

`;

/**
 * The script: runs before the page's own (both are modules, in order), so it can read the page's API answers. It wraps
 * fetch to read a copy of each answer to /v1/try/start, /v1/engine/events and the pay route, and changes nothing.
 * PRESENT_CFG is filled in by presentExtra().
 */
const SCRIPT = String.raw`
const PC=__PRESENT_CFG__;
document.body.classList.add('present');
// An event or jury token in the link (#e= or #j=, read by the page's own script): kept in this tab only, so R starts
// again in the same pool (retakes do not run into the public pool's per-address limit).
const POOLTAG=(()=>{const m=/^#([ej])=([A-Za-z0-9_.~-]{1,256})$/.exec(location.hash);try{if(m)sessionStorage.setItem('purser.present.pool',m[0]);return m?m[0]:sessionStorage.getItem('purser.present.pool')||''}catch(e){return m?m[0]:''}})();
const mk=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids==null?[]:kids))e.append(k instanceof Node?k:document.createTextNode(String(k)));return e};
// The run's own numbers, from the answers this page gets.
const RUN={startAt:null,paidAt:null,seqs:new Set(),claude:new Set(),paid:null,refused:null,calls:new Map()};
try{const o=JSON.parse(sessionStorage.getItem('purser.present')||'null');if(o&&typeof o==='object'){RUN.startAt=o.startAt??null;RUN.paidAt=o.paidAt??null;RUN.paid=o.paid??null;RUN.refused=o.refused??null;for(const s of o.seqs||[])RUN.seqs.add(s);for(const s of o.claude||[])RUN.claude.add(s)}}catch(e){}
const keep=()=>{try{sessionStorage.setItem('purser.present',JSON.stringify({startAt:RUN.startAt,paidAt:RUN.paidAt,paid:RUN.paid,refused:RUN.refused,seqs:[...RUN.seqs],claude:[...RUN.claude]}))}catch(e){}};
const AMT=/^\d{1,9}\.\d{2}$/,CUR=/^[A-Z]{3}$/;
const money=(a,c)=>{const [w,d]=a.split('.');return c+' '+w.replace(/\B(?=(\d{3})+$)/g,',')+'.'+d};
const real=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const res=await real(input,init);
  try{
    const url=new URL(typeof input==='string'?input:input.url,location.href);const p=url.pathname;
    if(res.ok&&(p==='/v1/try/start'||p==='/v1/engine/events'||/^\/v1\/engine\/proposals\/[^/]+\/pay$/.test(p))){
      const at=Date.now();
      res.clone().json().then((j)=>{
        if(!j||typeof j!=='object')return;
        if(p==='/v1/try/start'){RUN.startAt=at;RUN.paidAt=null;RUN.paid=null;RUN.refused=null;RUN.seqs.clear();RUN.claude.clear();RUN.calls.clear()}
        else if(p==='/v1/engine/events'){for(const e of Array.isArray(j.items)?j.items:[]){if(e&&typeof e.seq==='number'){RUN.seqs.add(e.seq);const f=e.fields&&typeof e.fields==='object'?e.fields:{};if(e.event==='claude.read'||(/^ap\.(checker_decided|coded|payer_proposed)$/.test(String(e.event))&&f.source==='claude'))RUN.claude.add(e.seq);if((e.event==='claude.read'||e.event==='agent.run')&&!RUN.calls.has(e.seq)){const c=Number(f.cost_usd_micros);if(isFinite(c)&&c>=0)RUN.calls.set(e.seq,{who:e.event==='claude.read'?PC.shell.reader:title(f.agent),model:modelName(f.model),cost:c,ms:Number(f.latency_ms)||0,req:typeof f.request_id==='string'&&/^req_[A-Za-z0-9]{6,64}$/.test(f.request_id)?f.request_id:''})}}}}
        else{
          let sent=null;try{sent=JSON.parse(String(init&&init.body||'null'))}catch(e){}
          const t=sent&&sent.terms||{};
          if(j.outcome==='paid'&&!RUN.paidAt){RUN.paidAt=at;RUN.paid=AMT.test(String(t.amount))&&CUR.test(String(t.currency))?money(String(t.amount),String(t.currency)):''}
          if(j.outcome==='refused'&&Array.isArray(j.changed)&&j.changed.length){const L=j.layers||{};RUN.refused={both:!!(L.signature&&L.signature.verified===false&&L.executor&&L.executor.accepted===false),changed:j.changed.filter((k)=>/^[a-z_0-9]{1,32}$/.test(k))}}
        }
        keep();drawOutcome();drawUse();
      }).catch(()=>{});
    }
  }catch(e){}
  return res;
};
// The test-money label, always on screen.
document.body.append(mk('div','pv-money',PC.money));
// The phone lane, unless ?phone=0 (a recording on a laptop that signs with its own passkey, e.g. Windows Hello).
const NOPHONE=new URLSearchParams(location.search).get('phone')==='0';
if(!NOPHONE)document.body.append(mk('aside','pv-lane',[mk('div','pv-phone',mk('span','',PC.laneSpot)),mk('p','',PC.lane)]));
// The app shell, unless ?shell=0: a sidebar with the workspace, the sections and Claude's usage in this run.
const SHELL=new URLSearchParams(location.search).get('shell')!=='0';
const SH=PC.shell;let useBox=null;
if(SHELL){
  document.body.classList.add('pv-shell');
  const hb=document.querySelector('header.top .brand');const brand=hb?hb.cloneNode(true):mk('span','brand','Purser');
  useBox=mk('section','pv-use');
  document.body.append(mk('aside','pv-side',[brand,mk('div','pv-ws',[mk('b','',SH.workspace),mk('span','',SH.tag)]),mk('ul','pv-nav',SH.nav.map((n)=>mk('li','',n))),useBox,mk('div','pv-me',[mk('span','av',SH.user),mk('span','',[SH.user,mk('small','',SH.userSub)])])]));
}
// In the app shell the negotiation is left out unless &neg=1: "Pay this invoice" becomes the step's main button (→ clicks it).
if(SHELL&&new URLSearchParams(location.search).get('neg')!=='1'){
  document.body.classList.add('pv-noneg');
  const promote=()=>{for(const b of document.querySelectorAll('#main .payrow > button.btn:not(.primary)'))b.classList.add('primary','big');for(const el of document.querySelectorAll('#main *'))if(el.childElementCount===0&&el.textContent===PC.negHint)el.textContent=PC.negHintShort};
  promote();new MutationObserver(promote).observe(document.body,{childList:true,subtree:true});
}
const usd=(m)=>'$'+(m/1e6).toFixed(4);
const title=(s)=>String(s||'').replace(/[^a-z0-9 _-]/gi,'').replace(/[_-]+/g,' ').replace(/\b\w/g,(c)=>c.toUpperCase());
const modelName=(m)=>{const x=/^claude-([a-z]+)-(\d+)-(\d+)/.exec(String(m||''));return x?title(x[1])+' '+x[2]+'.'+x[3]:''};
function drawUse(){
  if(!useBox)return;
  const calls=[...RUN.calls.values()];const tot=calls.reduce((a,c)=>a+c.cost,0);
  const rows=calls.slice(-5).reverse().map((c)=>mk('li','',[mk('b','',c.who+(c.model?' · '+c.model:'')),mk('span','c',usd(c.cost)),mk('span','m',[c.ms?(c.ms/1000).toFixed(1)+' s':'',c.ms&&c.req?' · ':'',c.req?c.req.slice(0,8)+'…'+c.req.slice(-5):''].join(''))]));
  useBox.replaceChildren(mk('h3','',SH.usage),mk('div','tot',calls.length?usd(tot):'$0.0000'),mk('div','sub',calls.length?calls.length+' '+SH.calls:SH.none),mk('ol','',rows));
}
drawUse();
// The opener: Before and After.
const opener=mk('section','pv-card',mk('div','in',[mk('div','pv-money',PC.money),mk('h2','',PC.openerHeading),mk('div','pv-ba',[mk('div','before',[mk('b','',PC.beforeLabel),mk('p','',PC.before)]),mk('div','after',[mk('b','',PC.afterLabel),mk('p','',PC.after)])]),mk('p','pv-go',PC.go)]));
opener.setAttribute('role','dialog');opener.setAttribute('aria-label',PC.openerHeading);
document.body.append(opener);
// The outcome.
const outcome=mk('section','pv-card pv-out');outcome.setAttribute('role','dialog');outcome.setAttribute('aria-label',PC.out.heading);
document.body.append(outcome);
const secs=(ms)=>{const s=Math.round(ms/1000);return s<60?s+' s':Math.floor(s/60)+' min '+(s%60)+' s'};
function fig(value,label,cls){const b=mk('b',value==null?'none':(cls||''),value==null?PC.out.notInRun:value);return mk('li',cls==='word'||cls==='ok'?cls:'',[b,mk('span','',label)])}
function drawOutcome(){
  const O=PC.out;
  const r=RUN.refused;
  const figs=mk('ul','pv-figs',[
    fig(RUN.startAt&&RUN.paidAt?secs(RUN.paidAt-RUN.startAt):null,O.time),
    fig(RUN.paid?RUN.paid:null,O.paid),
    fig(RUN.seqs.size?String(RUN.seqs.size):null,RUN.seqs.size?O.steps+' · '+RUN.claude.size+' '+O.claude:O.steps),
    fig(r?(r.both?O.refusedYes:O.refusedPart):null,O.refused,r?'ok':null),
  ]);
  figs.lastChild.querySelector('b').classList.add('word');
  outcome.replaceChildren(mk('div','in',[mk('div','pv-money',PC.money),mk('h2','',O.heading),figs,mk('p','pv-sub',O.measured),mk('p','pv-try',[O.try+' ',mk('span','',PC.tryUrl)])]));
}
drawOutcome();
// Fit: a step taller than the screen is drawn a little smaller (never under 80% of the frame's size), so nothing
// scrolls at 1080p. Wide screens only; a phone scrolls as ever.
let fitting=0;
function fit(){
  fitting=0;const m=document.getElementById('main');if(!m||innerWidth<1200)return;
  m.style.zoom='';
  const base=parseFloat(getComputedStyle(m).zoom)||1;let z=base;
  for(let k=0;k<4;k++){
    const sh=document.documentElement.scrollHeight;if(sh<=innerHeight)break;
    const top=m.getBoundingClientRect().top+scrollY;
    z=Math.max(base*0.8,z*(innerHeight-top)/(sh-top)-0.005);m.style.zoom=String(z);
    if(z<=base*0.8)break;
  }
}
new MutationObserver(()=>{if(!fitting)fitting=requestAnimationFrame(fit)}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open','class']});
addEventListener('resize',()=>{if(!fitting)fitting=requestAnimationFrame(fit)});
const close=(c)=>c.classList.remove('on');
const isOn=(c)=>c.classList.contains('on');
let openerTimer=null;
function showOpener(){opener.classList.add('on');clearTimeout(openerTimer);openerTimer=setTimeout(()=>close(opener),PC.openerMs)}
// The opener at a fresh start only (not after a reload in the middle of a run).
let st=null;try{st=JSON.parse(sessionStorage.getItem('purser.try')||'null')}catch(e){}
if(!st||!st.session)showOpener();
opener.addEventListener('click',()=>close(opener));
outcome.addEventListener('click',()=>close(outcome));
// → : the step's own main button, the same click a person makes. On the invoice step with nothing chosen, the first sample.
function next(){
  if(isOn(opener)){close(opener);return}
  if(isOn(outcome)){close(outcome);return}
  const main=document.getElementById('main');if(!main)return;
  if(main.querySelector('.screen.invoice')){const picked=main.querySelector('.screen.invoice [aria-pressed="true"]');if(!picked){const first=main.querySelector('.screen.invoice button[aria-pressed]');if(first){first.click();return}}}
  // After paid, the next step is the one-cent change (screen 5's own quiet link); after the refusal, the outcome.
  if(RUN.refused&&(main.querySelector('.screen.pay .why')||main.querySelector('.screen.books, .screen.company, .screen.did'))){outcome.classList.add('on');return}
  if(RUN.paidAt&&!RUN.refused){const cheat=main.querySelector('.screen.books button.cheat');if(cheat){cheat.click();return}}
  const b=[...main.querySelectorAll('.btn.primary')].find((x)=>!x.disabled&&x.offsetParent!==null);
  if(b)b.click();
}
document.addEventListener('keydown',(e)=>{
  if(e.altKey||e.ctrlKey||e.metaKey)return;
  const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
  if(e.key==='ArrowRight'){e.preventDefault();next()}
  else if(e.key==='r'||e.key==='R'){try{sessionStorage.removeItem('purser.try');sessionStorage.removeItem('purser.present')}catch(x){}location.href=location.pathname+'?present=1'+(NOPHONE?'&phone=0':'')+POOLTAG;location.reload()}
  else if(e.key==='o'||e.key==='O'){drawOutcome();outcome.classList.add('on')}
  else if(e.key==='Escape'){close(opener);close(outcome)}
});
`;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** The style and the script /try adds with ?present=1. */
export function presentExtra(): { css: string; script: string } {
  const cfg = {
    money: PRESENT_MONEY, lane: PRESENT_LANE, laneSpot: "Mirrored phone", tryUrl: PRESENT_TRY,
    openerHeading: "Paying suppliers, with AI agents", beforeLabel: "Before", afterLabel: "After with Purser",
    before: PRESENT_BEFORE, after: PRESENT_AFTER, go: "Press → to start", openerMs: 5_000,
    out: PRESENT_OUTCOME, shell: PRESENT_SHELL,
    // Without the negotiation the Clean sample's hint keeps only its first part ("Ready to pay").
    negHint: NEG_HINT, negHintShort: NEG_HINT.split(" · ")[0],
  };
  return { css: CSS, script: SCRIPT.replace("__PRESENT_CFG__", () => json(cfg)) };
}
