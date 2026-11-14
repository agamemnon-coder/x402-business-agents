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
// - Keys for the presenter: → the step's main button (the same click a person makes), R start again (a new test
//   company), O the outcome card, Escape closes a card.
// Every value from an answer is put on the page as text (textContent), never as HTML.

export const PRESENT_BEFORE = "An agent's invoice lands in a queue. An approve button anyone can click pays it, whatever was changed on the way.";
export const PRESENT_AFTER = "The CFO signs the exact terms with Face ID. Change one cent and the signature is refused: nothing moves.";
export const PRESENT_TRY = "kit11.max-31b.workers.dev/try";
export const PRESENT_MONEY = "Test money · simulated bank · nothing real is paid";
export const PRESENT_LANE = "The CFO's phone, mirrored: Face ID signs the exact terms";
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
  body.present .screen.books > :nth-child(1) { grid-column: 1 / -1; }
  body.present .screen.books > :nth-child(2) { grid-column: 1; grid-row: 2; }
  body.present .screen.books > :nth-child(3) { grid-column: 2; grid-row: 2 / 5; }
  body.present .screen.books > :nth-child(4) { grid-column: 1; grid-row: 3; }
  body.present .screen.books > :nth-child(5) { grid-column: 1; grid-row: 4; }
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
const RUN={startAt:null,paidAt:null,seqs:new Set(),claude:new Set(),paid:null,refused:null};
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
        if(p==='/v1/try/start'){RUN.startAt=at;RUN.paidAt=null;RUN.paid=null;RUN.refused=null;RUN.seqs.clear();RUN.claude.clear()}
        else if(p==='/v1/engine/events'){for(const e of Array.isArray(j.items)?j.items:[]){if(e&&typeof e.seq==='number'){RUN.seqs.add(e.seq);const f=e.fields&&typeof e.fields==='object'?e.fields:{};if(e.event==='claude.read'||(/^ap\.(checker_decided|coded|payer_proposed)$/.test(String(e.event))&&f.source==='claude'))RUN.claude.add(e.seq)}}}
        else{
          let sent=null;try{sent=JSON.parse(String(init&&init.body||'null'))}catch(e){}
          const t=sent&&sent.terms||{};
          if(j.outcome==='paid'&&!RUN.paidAt){RUN.paidAt=at;RUN.paid=AMT.test(String(t.amount))&&CUR.test(String(t.currency))?money(String(t.amount),String(t.currency)):''}
          if(j.outcome==='refused'&&Array.isArray(j.changed)&&j.changed.length){const L=j.layers||{};RUN.refused={both:!!(L.signature&&L.signature.verified===false&&L.executor&&L.executor.accepted===false),changed:j.changed.filter((k)=>/^[a-z_0-9]{1,32}$/.test(k))}}
        }
        keep();drawOutcome();
      }).catch(()=>{});
    }
  }catch(e){}
  return res;
};
// The test-money label, always on screen.
document.body.append(mk('div','pv-money',PC.money));
// The phone lane.
document.body.append(mk('aside','pv-lane',[mk('div','pv-phone',mk('span','',PC.laneSpot)),mk('p','',PC.lane)]));
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
  else if(e.key==='r'||e.key==='R'){try{sessionStorage.removeItem('purser.try');sessionStorage.removeItem('purser.present')}catch(x){}location.href=location.pathname+'?present=1'+POOLTAG;location.reload()}
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
    out: PRESENT_OUTCOME,
  };
  return { css: CSS, script: SCRIPT.replace("__PRESENT_CFG__", () => json(cfg)) };
}
