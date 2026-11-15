// /try/negotiate (15 Nov): a page of its own, beside /try and never inside it, so it cannot break /try's flow. Purser's
// Sourcing agent (Claude) and a simulated supplier's agent (Claude, labelled so) negotiate an early-payment discount on
// a test invoice, turn by turn, inside the CFO's rails, which code enforces (src/negotiate/rails.ts). Then the visitor
// signs the agreed terms with a passkey on /try's own signing flow, unchanged: the agreed invoice is filed through the
// engine's compose route, its payment proposed (canonical JSON, SHA-256, the passkey's challenge), approved with the
// passkey, and paid on the test bank through the one pay route; one changed cent is refused by the same route. The
// passkey helpers are /try's own (cloud/src/tryPage.ts SIGN_JS), the bot check's solver is the start's own
// (./botCheck.ts BOT_SOLVER_JS): reused as they are, not copied.
//
// The visitor's test company: the one /try started in this tab (sessionStorage "purser.try"), else a new one, started
// with /try's own start route and its limits. One page, one script under the console's nonce policy; every value from
// the server goes on the page as text (textContent), never as markup.
import { ICON_LINKS } from "../brand.js";
import { consoleCsp } from "../console.js";
import { SITE_HEADER_CSS, siteHeader } from "../siteHeader.js";
import { SIGN_JS } from "../tryPage.js";
import { VERIFY_YOURSELF } from "../tryCopy.js";
import { TOKENS } from "../../../src/redesign/ui.js";
import { RECORDED_LABEL, SOURCING_LABEL, SUPPLIER_LABEL } from "../../../src/negotiate/negotiate.js";
import { BOT_SOLVER_JS } from "./botCheck.js";

export const NEGOTIATE_PATH = "/try/negotiate";
/** The link's words, on /try's finish and in the site's "More". */
export const NEGOTIATE_LINK = "Watch agents negotiate";

/** Every word of the page (tests read them). */
export const NEGOTIATE_COPY = {
  title: "Purser · agents negotiate",
  band: "Test money · test passkey · simulated bank · nothing real moves",
  head: "Two agents negotiate. Code holds the limits. You sign the deal.",
  lede: "Purser's Sourcing agent (Claude) negotiates an early-payment discount with the supplier's agent (a simulated supplier, played by Claude). Every turn passes the CFO's rails in code before it counts. Then you sign the agreed terms with your passkey, exactly as on /try.",
  invoiceHead: "The invoice",
  invoiceLine: "Bergtex Textil GmbH · EUR 1,850.00 · net 30",
  invoiceNote: "A seeded test supplier in your test company, with a published test IBAN.",
  railsHead: "The CFO's rails (code, not a prompt)",
  rails: {
    max_amount: "Pays at most EUR {max}",
    pay_by_window: "Pays between {from} and {to}",
    invoice_only: "Nothing beyond the invoice {no}",
    payee_unchanged: "Only to the account on file (ending {last4})",
  },
  start: "Start the negotiation",
  starting: "Starting a test company…",
  talking: "The agents are negotiating…",
  live: "Live · Claude",
  recorded: "Recorded",
  recordedLabel: RECORDED_LABEL,
  why: "Why: {reason}",
  sourcing: SOURCING_LABEL,
  supplier: SUPPLIER_LABEL,
  terms: { amount: "Amount", discount: "Discount", payBy: "Pay by", account: "Account" },
  within: "Within the rails",
  refused: "Refused by the rails",
  heldRule: "The rule that held:",
  scripted: "The simulation added this bank change (the model left it out), so you can see the rails refuse it.",
  meter: { invoice: "Invoice", current: "Current offer", best: "Best offer on record", discount: "Discount", none: "—" },
  railChips: { max_amount: "Max EUR {max}", pay_by_window: "Pay by {to}", invoice_only: "Invoice only", payee_unchanged: "Payee unchanged" },
  railChipsLabel: "The rails, checked on every turn",
  typing: "{who} is answering (Claude)…",
  simBadge: "simulated supplier",
  stamp: "Refused by code",
  replay: "Replaying the recorded turns",
  reset: "Claude stopped answering, so the live turns are dropped; the recorded negotiation follows.",
  held: "Purser's code held the Sourcing agent to Bergtex's best offer on record: it had asked to pay {asked}; the best offer on record is {floor} (turn {turn}), its bank change dropped.",
  accepts: "Accepts",
  agreedHead: "Agreed terms",
  noDealHead: "No deal: the invoice as issued",
  noDeal: "The agents did not agree within 4 turns, so the invoice stands as issued, by its due date.",
  agreement: { amount: "Pay", discount: "Discount", payBy: "By", payee: "To", ref: "Reference" },
  canonical: "Show the canonical JSON",
  sha: "SHA-256 of the agreement",
  shaNote: "The agreed invoice carries the first 8 characters of this hash as its reference, so the terms your passkey signs name this agreement and no other.",
  sign: "Sign the agreed terms with your passkey",
  makeKey: "Make your test passkey",
  steps: {
    file: "The agreed invoice is filed in your test company",
    propose: "Purser proposes the payment: canonical JSON, SHA-256, the passkey's challenge",
    signed: "You signed the exact terms",
    tamper: "The same signature with EUR 0.01 more",
    paid: "Paid as signed, on the test bank",
  },
  tamperRefused: "Refused: the signature covers the exact terms, and one cent changed them.",
  tamperOther: "The changed terms were not paid.",
  signsSha: "Your passkey signs SHA-256 {sha}…",
  waiting: "Waiting for your passkey…",
  paidHead: "Paid as signed, with test money.",
  download: VERIFY_YOURSELF.download,
  downloadDeal: "Download the negotiation (JSON)",
  verify: VERIFY_YOURSELF.verify,
  back: "Back to /try",
  again: "Watch them negotiate again",
  noPasskey: "This browser can't make a passkey here. Open this page in Safari or Chrome to sign.",
  cancelled: "The passkey was not used. Nothing was signed or paid.",
  failed: "Something went wrong. Nothing was paid.",
  limit: "Purser's demo is busy or paused right now. Please try again later.",
} as const;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const CSS = `${TOKENS.replace("url(assets/inter.woff2)", "url(/assets/inter.woff2)")}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; scroll-padding-top: 84px; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 16px/1.5 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
main { max-width: 680px; margin: 0 auto; padding: 0 var(--gut, 16px) 64px; overflow-x: clip; }
h1 { font-size: 28px; line-height: 1.15; letter-spacing: -.02em; margin: 20px 0 12px; }
h2 { font-size: 18px; margin: 28px 0 10px; }
h1:focus, h2:focus { outline: none; }
p { margin: 0 0 12px; }
.lede, .muted { color: var(--muted); }
.band { display: inline-flex; gap: 6px; align-items: center; margin: 12px 0 0; padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 13px; }
.band::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.card { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 16px; margin: 0 0 12px; }
/* 15 Nov (Max, 1440 px): a card's first heading sits at the card's own padding, as on its sides. */
.card > h2:first-child { margin-top: 0; }
.rails { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.rails li { display: flex; gap: 8px; align-items: baseline; font-size: 15px; }
.rails li::before { content: "■"; color: var(--accent); font-size: 10px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 18px; border-radius: 999px; font: 650 15px/1.2 Inter, system-ui, sans-serif; text-decoration: none; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn:disabled { opacity: .55; cursor: progress; }
.btn:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0; }
/* The chat (15 Nov): Purser's Sourcing agent on the left, the supplier's agent on the right, each with an avatar. */
.turns { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.turn { display: flex; gap: 10px; align-items: flex-start; max-width: 100%; }
.turn.sourcing { margin-right: 18%; }
.turn.supplier { flex-direction: row-reverse; margin-left: 18%; }
.av { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font: 700 14px/1 Inter, system-ui, sans-serif; color: #fff; background: var(--accent); }
.turn.supplier .av { background: var(--muted); }
.bubble { position: relative; min-width: 0; flex: 1 1 auto; border: 1px solid var(--border); border-radius: 16px; border-top-left-radius: 4px; background: var(--surface); padding: 12px 14px; overflow: hidden; }
.turn.supplier .bubble { border-radius: 16px; border-top-right-radius: 4px; border-style: dashed; }
.turn.refused .bubble { border-color: var(--bad); border-style: solid; }
.turn .who { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; font-size: 12.5px; color: var(--muted); margin: 0 0 6px; }
.turn .who b { color: var(--text); }
.pill { display: inline-block; padding: 0 8px; border-radius: 999px; border: 1px solid var(--border); font-size: 12px; line-height: 20px; }
.pill.rec { border-style: dashed; }
.pill.sim { border-color: var(--muted); border-style: dashed; color: var(--text); }
.stamp { display: inline-block; margin: 0 0 8px; padding: 2px 10px; border: 2px solid var(--bad); border-radius: 6px; color: var(--bad); font: 800 12px/1.4 Inter, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; transform: rotate(-3deg); }
.msg { margin: 0 0 8px; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; padding: 0; list-style: none; }
.chips li { font-size: 13px; padding: 2px 8px; border-radius: 8px; background: var(--sunken); overflow-wrap: anywhere; }
.verdict { font-size: 14px; margin: 0; padding: 6px 10px; border-radius: 10px; }
.verdict.ok { background: var(--ok-soft); color: var(--text); }
.verdict.no { background: var(--bad-soft); color: var(--text); border: 1px solid var(--bad); }
.verdict .rule { display: block; font-weight: 600; margin-top: 2px; }
/* The typing indicator: shown while a live call runs, on the side that is answering. */
.typing .bubble { flex: 0 1 auto; display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
.dots { display: inline-flex; gap: 4px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); opacity: .5; }
/* The deal meter: the invoice, the current offer and the best offer on record, on one bar. */
.meter { margin: 12px 0; }
.mrow { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; font-size: 13px; color: var(--muted); }
.mrow b { color: var(--text); font-variant-numeric: tabular-nums; }
.track { position: relative; height: 12px; margin: 10px 0 8px; border-radius: 999px; background: var(--sunken); overflow: hidden; }
.track .fill { position: absolute; top: 0; bottom: 0; left: 0; width: 0; border-radius: 999px; background: var(--accent); }
.track .mk { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1px; left: 0; background: var(--ok); }
.track .mk.cur { background: var(--text); }
.disc { margin: 0; font-size: 15px; }
.disc b { font-variant-numeric: tabular-nums; }
/* The rails as chips, flashed on every turn. */
.railchips { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.railchips li { font-size: 12.5px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); }
.railchips li.ok { border-color: var(--ok); background: var(--ok-soft); }
.railchips li.no { border-color: var(--bad); background: var(--bad-soft); font-weight: 650; }
.sha.typing-out::after { content: "▍"; }
ol.steps li.stop { color: var(--text); border-left: 3px solid var(--bad); padding-left: 8px; }
ol.steps li.stop::marker { color: var(--bad); }
.note { font-size: 14px; color: var(--muted); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow-wrap: anywhere; }
pre.mono { white-space: pre-wrap; background: var(--sunken); padding: 10px; border-radius: 10px; margin: 8px 0 0; }
dl.deal { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0 0 10px; }
dl.deal dt { color: var(--muted); }
dl.deal dd { margin: 0; overflow-wrap: anywhere; }
ol.steps { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 6px; }
ol.steps li.done::marker { color: var(--ok); }
ol.steps li.bad::marker { color: var(--bad); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) {
  .turn { animation: rise .35s ease-out both; }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .dots i { animation: blink 1.1s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: .18s; } .dots i:nth-child(3) { animation-delay: .36s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
  .track .fill, .track .mk { transition: width .6s ease, left .6s ease; }
  .railchips li.flash { animation: flash .9s ease-out; }
  @keyframes flash { 0% { transform: scale(1.08); } 100% { transform: none; } }
  .stamp { animation: stamp .45s cubic-bezier(.2, 1.6, .4, 1) both; }
  @keyframes stamp { from { opacity: 0; transform: rotate(-3deg) scale(1.8); } to { opacity: 1; transform: rotate(-3deg) scale(1); } }
  .shake { animation: shake .45s ease-in-out; }
  @keyframes shake { 0%, 100% { transform: none; } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
}
`;

const SCRIPT = String.raw`
const C=__COPY__;const CFG=__CFG__;
__SIGN__
__SOLVER__
const {fromB64u,registrationOf,signedOf}=signKit;
const $=(id)=>document.getElementById(id);
const el=(tag,cls,kids)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(kids!==undefined&&kids!==null)for(const k of [].concat(kids))if(k!==null&&k!==undefined&&k!==false)n.append(typeof k==='string'?document.createTextNode(k):k);return n};
const fill=(s,o)=>String(s).replace(/\{(\w+)\}/g,(m,k)=>o[k]===undefined?m:String(o[k]));
const say=(s)=>{$('say').textContent=s};
const eur=(s)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(s));if(!m)return String(s);return 'EUR '+m[1].replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+m[2]};

// The company: /try's own in this tab (its key), else one this page started (its own key). Read only from storage;
// written back only to the key it came from (a renewed session).
const KEYS=['purser.try','purser.negotiate'];
let S=null,FROM=null;
for(const k of KEYS){try{const o=JSON.parse(sessionStorage.getItem(k)||'null');if(o&&o.session&&o.visitor_token&&o.tenant){S=o;FROM=k;break}}catch(e){}}
const save=()=>{if(!S||!FROM)return;try{const o=JSON.parse(sessionStorage.getItem(FROM)||'{}')||{};o.session=S.session;o.expires_at=S.expires_at;if(FROM==='purser.negotiate'){o.tenant=S.tenant;o.visitor_token=S.visitor_token}sessionStorage.setItem(FROM,JSON.stringify(o))}catch(e){}};
const tenantId=()=>S&&(typeof S.tenant==='string'?S.tenant:S.tenant&&S.tenant.id);

async function call(method,path,body){
  const headers={};if(S&&S.session)headers.authorization='Bearer '+S.session;if(body!==undefined)headers['content-type']='application/json';
  let r;try{r=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})}catch(e){return {status:0,json:{}}}
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,json:j&&typeof j==='object'?j:{}};
}
async function renew(){
  if(!tenantId()||!S.visitor_token)return false;
  const r=await call('POST','/v1/try/session',{tenant_id:tenantId(),visitor_token:S.visitor_token});
  if(r.status===200&&typeof r.json.session==='string'){S.session=r.json.session;S.expires_at=r.json.expires_at||null;save();return true}
  return false;
}
async function api(method,path,body){
  const r=await call(method,path,body);
  if(r.status!==401||!S)return r;
  return (await renew())?call(method,path,body):r;
}
// A company of the visitor's own: /try's, or a new one through /try's start route (its bot check and its limits).
async function company(){
  if(S&&S.expires_at&&Date.parse(S.expires_at)>Date.now()+60000)return true;
  if(S&&await renew())return true;
  S=null;FROM=null;
  let proof;
  const ch=await call('POST','/v1/try/challenge');
  if(ch.status===200&&ch.json.required===true){const p=solveProof(String(ch.json.challenge),Number(ch.json.difficulty));if(!p)return false;proof={challenge:String(ch.json.challenge),nonce:p.nonce}}
  const r=await call('POST','/v1/try/start',proof?{proof}:{});
  if((r.status===201||r.status===200)&&typeof r.json.session==='string'){
    S={tenant:r.json.tenant,session:r.json.session,visitor_token:r.json.visitor_token,expires_at:r.json.expires_at||null};FROM='purser.negotiate';
    try{sessionStorage.setItem(FROM,JSON.stringify(S))}catch(e){}
    return true;
  }
  return r.json&&typeof r.json.message==='string'?r.json.message:false;
}

const box=$('flow');
const rails=(b)=>{
  const R=C.rails;const last4=String(b.payee_iban||'').slice(-4);
  return el('ul','rails',[el('li','',fill(R.max_amount,{max:eur((b.max_pay_cents/100).toFixed(2)).slice(4)})),el('li','',fill(R.pay_by_window,{from:b.earliest_pay_by,to:b.latest_pay_by})),el('li','',fill(R.invoice_only,{no:b.invoice_no})),el('li','',fill(R.payee_unchanged,{last4}))]);
};
let calm=false;try{calm=matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}
const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
const centsOf=(s)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(s));return m?Number(m[1])*100+Number(m[2]):NaN};
// A number counting up (or down) to its value; at once under reduced motion.
function countTo(node,from,to,fmt){
  if(calm||!isFinite(from)||from===to){node.textContent=fmt(to);return}
  const t0=performance.now(),d=600;
  const tick=(t)=>{const k=Math.min(1,(t-t0)/d);node.textContent=fmt(from+(to-from)*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(tick)};requestAnimationFrame(tick);
}
function bubble(t,mode){
  const T=C.terms;const sup=t.who==='supplier';
  const who=el('p','who',[el('b','',sup?C.supplier:C.sourcing),sup?el('span','pill sim',C.simBadge):null,el('span','pill'+(mode==='recorded'?' rec':''),mode==='recorded'?C.recorded:C.live+(t.model?' · '+t.model:'')),t.ms>=100?el('span','',(t.ms/1000).toFixed(1)+' s'):null,el('span','','Turn '+t.n)]);
  const p=t.proposed||{};
  const chips=el('ul','chips',[el('li','',T.amount+': '+eur(p.amount)),el('li','',T.discount+': '+(p.discount==='—'?'—':eur(p.discount)+' ('+p.discount_pct+')')),el('li','',T.payBy+': '+p.pay_by),p.iban?el('li','',T.account+': '+p.iban):null,t.accept?el('li','',C.accepts):null]);
  const refs=(t.rails&&t.rails.refusals)||[];
  const ok=!!(t.rails&&t.rails.ok);
  const v=ok?el('p','verdict ok',C.within):el('p','verdict no',[el('b','',C.refused+': '),refs.map((r)=>r.detail).join('; '),...refs.map((r)=>el('span','rule',C.heldRule+' '+r.says))]);
  const stamp=refs.some((r)=>r.rule==='payee_unchanged')?el('span','stamp',C.stamp):null;
  const bub=el('div','bubble',[who,stamp,el('p','msg',t.message),chips,v,t.scripted_bank_change?el('p','note',C.scripted):null,t.held_to_best_offer?el('p','note held',fill(C.held,{asked:eur(t.held_to_best_offer.asked),floor:eur(t.held_to_best_offer.floor),turn:t.held_to_best_offer.floor_turn})):null]);
  const card=el('li','turn '+t.who+(ok?'':' refused'),[el('span','av',sup?'B':'P'),bub]);
  card.setAttribute('aria-label','Turn '+t.n+', '+(sup?C.supplier:C.sourcing));
  card.querySelector('.av').setAttribute('aria-hidden','true');
  return card;
}
function typingRow(who){
  const sup=who==='supplier';
  const r=el('li','turn typing '+who,[el('span','av',sup?'B':'P'),el('div','bubble',[el('span','dots',[el('i'),el('i'),el('i')]),el('span','',fill(C.typing,{who:sup?'Bergtex\'s agent':'Purser\'s Sourcing agent'}))])]);
  r.querySelector('.av').setAttribute('aria-hidden','true');return r;
}
// The deal meter and the rail chips: built once, moved on every turn.
const UI={};
function board(bounds){
  const M=C.meter;const inv=bounds.max_pay_cents;UI.inv=inv;UI.cur=inv;UI.lo=Math.round(inv*0.95);
  UI.curB=el('b','',M.none);UI.bestB=el('b','',M.none);UI.disc=el('b','','EUR 0.00');UI.pct=el('span','','0.0%');
  UI.fill=el('i','fill');UI.mkCur=el('i','mk cur');UI.mkBest=el('i','mk best');UI.mkBest.hidden=true;UI.mkCur.hidden=true;
  const meter=el('div','card meter',[el('div','mrow',[el('span','',[M.invoice+' ',el('b','',eur((inv/100).toFixed(2)))]),el('span','',[M.current+' ',UI.curB]),el('span','',[M.best+' ',UI.bestB])]),el('div','track',[UI.fill,UI.mkBest,UI.mkCur]),el('p','disc',[M.discount+' ',UI.disc,' (',UI.pct,')'])]);
  meter.id='meter';meter.setAttribute('aria-label',C.railChipsLabel);
  const R=C.railChips;UI.chips={};
  const lab={max_amount:fill(R.max_amount,{max:eur((inv/100).toFixed(2)).slice(4)}),pay_by_window:fill(R.pay_by_window,{to:bounds.latest_pay_by}),invoice_only:R.invoice_only,payee_unchanged:R.payee_unchanged};
  const chips=el('ul','railchips',Object.keys(lab).map((k)=>{const li=el('li','',lab[k]);li.dataset.rule=k;UI.chips[k]=li;return li}));
  chips.setAttribute('aria-label',C.railChipsLabel);chips.id='railchips';
  return [meter,chips];
}
const pos=(c)=>Math.max(0,Math.min(100,(UI.inv-c)/(UI.inv-UI.lo)*100));
function move(t,best){
  // The chips: every rule passed flashes green; a refused one red, with its name.
  const bad=new Set(((t.rails&&t.rails.refusals)||[]).map((r)=>r.rule));
  for(const [k,li] of Object.entries(UI.chips)){li.classList.remove('ok','no','flash');void li.offsetWidth;li.classList.add(bad.has(k)?'no':'ok','flash')}
  // The meter: a turn's terms count only when the rails let them stand.
  const c=centsOf(t.proposed&&t.proposed.amount);
  if(t.rails&&t.rails.ok&&isFinite(c)){
    const from=UI.inv-UI.cur;UI.cur=c;
    UI.curB.textContent=eur(t.proposed.amount);UI.mkCur.hidden=false;
    UI.mkCur.style.left=pos(c)+'%';UI.fill.style.width=pos(c)+'%';
    countTo(UI.disc,from,UI.inv-c,(v)=>'EUR '+(Math.round(v)/100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','));
    countTo(UI.pct,from/UI.inv*100,(UI.inv-c)/UI.inv*100,(v)=>v.toFixed(1)+'%');
  }
  if(best&&isFinite(centsOf(best.amount))){UI.bestB.textContent=eur(best.amount);UI.mkBest.hidden=false;UI.mkBest.style.left=pos(centsOf(best.amount))+'%'}
}
// The supplier's best offer on record, as the server reckons it (src/negotiate/negotiate.ts bestOfferOf), for turns that came in one answer.
function bestOf(turns){let b=null;for(const t of turns){if(t.who!=='supplier')continue;const r=(t.rails&&t.rails.refusals)||[];if(!(t.rails&&t.rails.ok)&&!r.every((x)=>x.rule==='payee_unchanged'))continue;const c=centsOf(t.proposed.amount);if(isFinite(c)&&(!b||c<centsOf(b.amount)))b={amount:t.proposed.amount,turn:t.n}}return b}
let N=null;

// One request, read as it comes: a line a turn while Claude answers (?stream=1), else the whole answer at once.
async function negotiateCall(){
  const go=async()=>{const h={};if(S&&S.session)h.authorization='Bearer '+S.session;try{return await fetch('/v1/try/negotiate?stream=1',{method:'POST',headers:h})}catch(e){return null}};
  let r=await go();if(r&&r.status===401&&await renew())r=await go();
  if(!r)return {status:0,json:{}};
  if(r.status===200&&r.body&&/ndjson/.test(r.headers.get('content-type')||''))return {status:200,reader:r.body.getReader()};
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,json:j&&typeof j==='object'?j:{}};
}
async function* lines(reader){
  const dec=new TextDecoder();let buf='';
  for(;;){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(l){try{yield JSON.parse(l)}catch(e){}}}}
  if(buf.trim()){try{yield JSON.parse(buf)}catch(e){}}
}

async function negotiate(btn){
  btn.disabled=true;btn.textContent=C.starting;say(C.starting);
  const okc=await company();
  if(okc!==true){btn.disabled=false;btn.textContent=C.start;$('talk').replaceChildren(el('p','note',typeof okc==='string'?okc:C.limit));return}
  btn.textContent=C.talking;say(C.talking);
  const talk=$('talk');
  const list=el('ol','turns');let typing=null;let shown=[];
  const setTyping=(who)=>{if(typing){typing.remove();typing=null}if(who){typing=typingRow(who);list.append(typing)}};
  const r=await negotiateCall();
  if(r.status!==200){btn.disabled=false;btn.textContent=C.start;talk.replaceChildren(el('p','note',typeof r.json.message==='string'?r.json.message:C.failed));return}
  btn.hidden=true;
  let started=false;
  const start=(bounds,head)=>{if(started)return;started=true;$('rails').replaceChildren(rails(bounds));talk.replaceChildren(...[head].concat(board(bounds),[list]).filter(Boolean))};
  if(r.reader){
    for await (const ev of lines(r.reader)){
      if(ev.type==='start'&&ev.bounds){start(ev.bounds,null);if(ev.live===true)setTyping('sourcing')}
      else if(ev.type==='turn'&&ev.turn){setTyping(null);list.append(bubble(ev.turn,'live'));shown.push(ev.turn);move(ev.turn,ev.best);say('Turn '+ev.turn.n);setTyping(ev.turn.n<4?(ev.turn.who==='sourcing'?'supplier':'sourcing'):null)}
      else if(ev.type==='reset'){setTyping(null);shown=[];list.replaceChildren(el('li','note',C.reset))}
      else if(ev.type==='done'&&ev.negotiation)N=ev.negotiation;
      else if(ev.type==='error'){setTyping(null);talk.append(el('p','note',ev.message||C.failed));return}
    }
    setTyping(null);
    if(!N||!Array.isArray(N.turns)){talk.append(el('p','note',C.failed));return}
  }else{
    N=r.json;if(!Array.isArray(N.turns)){talk.replaceChildren(el('p','note',C.failed));return}
  }
  // The real bounds, now known: the chips' words and the rails' card.
  if(!started)start(N.bounds,null);
  $('rails').replaceChildren(rails(N.bounds));
  const R=C.railChips;UI.chips.pay_by_window.textContent=fill(R.pay_by_window,{to:N.bounds.latest_pay_by});
  if(N.mode==='recorded'||!shown.length){
    // Recorded (or Claude failed mid-way): labelled, and replayed turn by turn, never with a typing indicator.
    if(N.mode==='recorded')talk.prepend(el('p','card note',[el('b','',N.label||C.recordedLabel),N.reason?el('span','',' '+fill(C.why,{reason:N.reason})):null]));
    list.replaceChildren();
    const seen=[];
    for(const t of N.turns){seen.push(t);list.append(bubble(t,N.mode));move(t,bestOf(seen));say('Turn '+t.n);if(!calm)await sleep(700)}
  }
  deal();
}

// The SHA-256, typed out (at once under reduced motion).
function typeOut(node,text){
  if(calm){node.textContent=text;node.classList.add('done');return}
  node.classList.add('typing-out');let i=0;
  const t=setInterval(()=>{i=Math.min(text.length,i+2);node.textContent=text.slice(0,i);if(i>=text.length){clearInterval(t);node.classList.remove('typing-out');node.classList.add('done')}},16);
}
function deal(){
  const A=C.agreement,a=N.agreement;const d=$('deal');
  const h=el('h2','',N.outcome==='agreed'?C.agreedHead:C.noDealHead);h.tabIndex=-1;
  const dl=el('dl','deal',[el('dt','',A.amount),el('dd','',eur(a.amount)),el('dt','',A.discount),el('dd','',eur(a.discount)+' off '+eur(a.invoice_amount)),el('dt','',A.payBy),el('dd','',a.pay_by),el('dt','',A.payee),el('dd','',a.supplier+' · account ending '+a.payee_iban_last4),el('dt','',A.ref),el('dd','mono',N.compose.invoice_no)]);
  const det=el('details','',[el('summary','',C.canonical),el('pre','mono',N.canonical)]);
  const shaV=el('span','mono sha','');
  const sha=el('p','',[el('span','muted',C.sha+': '),shaV]);
  const go=el('button','btn primary',C.sign);go.type='button';go.id='sign';
  const steps=el('ol','steps');steps.id='steps';
  const out=el('div','');out.id='out';out.setAttribute('role','status');
  d.replaceChildren(...[h,N.outcome==='agreed'?null:el('p','note',C.noDeal),el('div','card',[dl,det,sha,el('p','note',C.shaNote),el('div','row',[go])]),steps,out].filter(Boolean));
  h.focus();typeOut(shaV,N.sha256);
  go.addEventListener('click',()=>sign(go));
}

const step=(text,state)=>{const li=el('li',state||'',text);$('steps').append(li);return li};
const hasPasskeys=()=>!!(window.PublicKeyCredential&&navigator.credentials);
const cancelled=(e)=>e&&typeof e.name==='string'&&/^(NotAllowedError|AbortError|InvalidStateError|SecurityError|NotSupportedError)$/.test(e.name);
async function withTimeout(fn){const ac=new AbortController();const t=setTimeout(()=>ac.abort(),30000);try{return await fn(ac.signal)}finally{clearTimeout(t)}}
const words=(j,fb)=>j&&typeof j.message==='string'&&j.message?j.message:j&&typeof j.error==='string'&&j.error?j.error:fb;
// What the flow has done so far, so a cancelled passkey picks up where it stopped.
const F={inv:null,p:null,eng:null,cred:null};

async function sign(go){
  const out=$('out');out.replaceChildren();
  if(!hasPasskeys()){out.append(el('p','note',C.noPasskey));return}
  go.disabled=true;
  try{
    if(!F.inv){
      const f=await api('POST','/v1/engine/compose',N.compose);
      const inv=f.json&&f.json.invoice;
      if(f.status!==200||!inv||!inv.id){out.append(el('p','note',words(f.json,C.failed)));go.disabled=false;return}
      F.inv=inv;step(C.steps.file+' ('+N.compose.invoice_no+')','done');
    }
    if(!F.p){
      const pr=await api('POST','/v1/engine/invoices/'+encodeURIComponent(F.inv.id)+'/pay');
      const p=pr.json&&pr.json.proposal;
      if(pr.status!==200||!p||!p.id){out.append(el('p','note',words(pr.json,C.failed)));go.disabled=false;return}
      F.p=p;step([C.steps.propose,el('br'),el('span','mono',fill(C.signsSha,{sha:String(p.terms_sha256||'').slice(0,16)}))],'done');
    }
    if(!F.eng||!F.eng.passkey){const st=await api('GET','/v1/engine');F.eng=st.status===200?st.json:{}}
    if(!F.eng.passkey||!F.eng.passkey.credential_id){
      const s=await api('POST','/v1/engine/passkey/start');
      if(s.status!==200||!s.json.user){out.append(el('p','note',words(s.json,C.failed)));go.disabled=false;return}
      say(C.waiting);
      const made=await withTimeout((signal)=>navigator.credentials.create({signal,publicKey:{rp:{id:s.json.rp.id,name:s.json.rp.name},user:{id:new TextEncoder().encode(s.json.user.id),name:s.json.user.name,displayName:s.json.user.displayName},
        challenge:fromB64u(s.json.challenge),pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],excludeCredentials:(s.json.exclude||[]).map((id)=>({type:'public-key',id:fromB64u(id)})),
        authenticatorSelection:{userVerification:'required',residentKey:'discouraged'},attestation:'none',timeout:30000}}));
      const fin=await api('POST','/v1/engine/passkey/finish',{code:s.json.code,credential:registrationOf(made)});
      if(fin.status!==200||typeof fin.json.credential_id!=='string'){out.append(el('p','note',words(fin.json,C.failed)));go.disabled=false;return}
      F.eng=Object.assign({},F.eng,{passkey:{credential_id:fin.json.credential_id}});
      // Safari keeps one prompt to a tap: the signature is the next tap.
      go.textContent=C.sign;go.disabled=false;say(C.sign);return;
    }
    say(C.waiting);
    const c=await withTimeout((signal)=>navigator.credentials.get({signal,publicKey:{challenge:fromB64u(F.p.challenge),rpId:CFG.rpId,allowCredentials:[{type:'public-key',id:fromB64u(F.eng.passkey.credential_id)}],userVerification:'required',timeout:30000}}));
    const cred=signedOf(c);
    const ap=await api('POST','/v1/engine/proposals/'+encodeURIComponent(F.p.id)+'/approve',{terms_sha256:F.p.terms_sha256,credential:cred});
    if(ap.status!==200||ap.json.status!=='approved'){out.append(el('p','note',words(ap.json,C.failed)));go.disabled=false;return}
    F.cred=cred;step(C.steps.signed,'done');go.hidden=true;
    const t=await api('GET','/v1/engine/proposals/'+encodeURIComponent(F.p.id)+'/terms');
    if(t.status!==200||!t.json.terms){out.append(el('p','note',words(t.json,C.failed)));return}
    const terms=t.json.terms;
    // One cent more, with the same signature: the one pay route answers, both layers.
    const m=/^(\d+)\.(\d{2})$/.exec(String(terms.amount));const v=m?Number(m[1])*100+Number(m[2])+1:1;
    const cent=Math.floor(v/100)+'.'+String(v%100).padStart(2,'0');
    const bad=await api('POST','/v1/engine/proposals/'+encodeURIComponent(F.p.id)+'/pay',signKit.payBody(terms,Object.assign({},terms,{amount:cent}),cred));
    const refused=bad.status===200&&bad.json.outcome!=='paid'&&bad.json.outcome!=='paid_once';
    {const li=step([C.steps.tamper+' ('+eur(terms.amount)+' → '+eur(cent)+'): ',el('b','',refused?C.tamperRefused:C.tamperOther)],refused?'stop':'bad');if(refused&&!calm)li.classList.add('shake')}
    const good=await api('POST','/v1/engine/proposals/'+encodeURIComponent(F.p.id)+'/pay',signKit.payBody(terms,terms,cred));
    if(good.status!==200||(good.json.outcome!=='paid'&&good.json.outcome!=='paid_once')){out.append(el('p','note',words(good.json,C.failed)));return}
    step(C.steps.paid+' ('+eur(terms.amount)+')','done');
    done(good.json.proof||null,terms);
  }catch(e){
    out.append(el('p','note',cancelled(e)?C.cancelled:C.failed));go.disabled=false;
  }
}

function download(name,obj){const a=el('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json'}));a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove()}
function done(proof,terms){
  const end=$('end');const h=el('h2','',C.paidHead);h.tabIndex=-1;
  const row=el('div','row');
  if(proof){const b=el('button','btn primary',C.download);b.type='button';b.addEventListener('click',()=>download(CFG.proofFile,proof));row.append(b)}
  const d=el('button','btn',C.downloadDeal);d.type='button';d.addEventListener('click',()=>download('purser-negotiation.json',{note:'A negotiation on Purser\'s demo: test money, a simulated supplier played by Claude.',mode:N.mode,label:N.label,reason:N.reason,turns:N.turns,agreement:N.agreement,canonical:N.canonical,sha256:N.sha256,signed_terms:terms,terms_sha256:F.p&&F.p.terms_sha256}));row.append(d);
  const v=el('a','btn',C.verify);v.href=CFG.verify;v.rel='noopener';row.append(v);
  const back=el('a','btn',C.back);back.href='/try';row.append(back);
  end.replaceChildren(h,row);h.focus();say(C.paidHead);
}

const b=$('go');b.addEventListener('click',()=>negotiate(b));
`;

export interface NegotiatePageCfg { rpId: string; verify: string }

export function negotiatePage(n: string, cfg: NegotiatePageCfg): string {
  const C = NEGOTIATE_COPY;
  const script = SCRIPT.replace("__COPY__", () => json(C)).replace("__CFG__", () => json({ ...cfg, proofFile: VERIFY_YOURSELF.file }))
    .replace("__SIGN__", () => SIGN_JS).replace("__SOLVER__", () => BOT_SOLVER_JS);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${ICON_LINKS}
<meta name="color-scheme" content="light dark">
<meta name="description" content="${esc(C.lede)}">
<meta name="robots" content="noindex">
<title>${esc(C.title)}</title>
<style nonce="${n}">${CSS}${SITE_HEADER_CSS}</style></head><body>
${siteHeader("try")}
<main id="main">
<p class="band">${esc(C.band)}</p>
<h1>${esc(C.head)}</h1>
<p class="lede">${esc(C.lede)}</p>
<section class="card" aria-labelledby="invh"><h2 id="invh">${esc(C.invoiceHead)}</h2><p><b>${esc(C.invoiceLine)}</b></p><p class="note">${esc(C.invoiceNote)}</p></section>
<section class="card" aria-labelledby="railsh"><h2 id="railsh">${esc(C.railsHead)}</h2><div id="rails"><ul class="rails"><li>${esc(C.rails.max_amount.replace("{max}", "1,850.00"))}</li><li>${esc(C.rails.pay_by_window.replace("{from}", "today").replace("{to}", "the due date"))}</li><li>${esc(C.rails.invoice_only.replace(" {no}", ""))}</li><li>${esc(C.rails.payee_unchanged.replace(" (ending {last4})", ""))}</li></ul></div></section>
<div class="row"><button class="btn primary" id="go" type="button">${esc(C.start)}</button></div>
<section id="talk" aria-live="polite"></section>
<section id="deal"></section>
<section id="end"></section>
</main>
<p class="sr" id="say" role="status" aria-live="polite"></p>
<script type="module" nonce="${n}">${script}</script>
</body></html>`;
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin", "permissions-policy": "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains", "x-frame-options": "DENY",
};

const nonce = (): string => {
  let s = "";
  for (const x of crypto.getRandomValues(new Uint8Array(18))) s += String.fromCharCode(x);
  return btoa(s);
};

/** GET /try/negotiate: the page under the console's policy, with a fresh nonce, for the host it was asked on. */
export function negotiatePageResponse(env: { rpId: string }, verify: string): Response {
  const n = nonce();
  return new Response(negotiatePage(n, { rpId: env.rpId, verify }), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": consoleCsp(n) } });
}
