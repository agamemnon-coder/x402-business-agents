// The negotiation's view (15 Nov), one script for both places it runs: /try/negotiate (./negotiatePage.ts) and /try's
// own flow, where a payable invoice from a supplier on file gets "Let Purser's agent negotiate an early-payment
// discount" before the passkey (cloud/src/tryPage.ts drawResult). Self-contained: its own helpers inside one object,
// NEG, so it shares no names with the page around it; every value from the server goes in as text, never as markup;
// bars move through the CSSOM (element.style), never through a style attribute, so the pages' nonce policy holds.
//
//   NEG.run({ box, body, auth, renew, say }) → { ok: true, n } | { ok: false, status, code, message }
//       POST /v1/try/negotiate?stream=1 (body: { invoice_id } or none), drawn into box as it comes: a thinking row at
//       once, a typing indicator on the side whose live Claude call runs, each turn as a bubble (Purser's Sourcing agent
//       left, the supplier's right), the deal meter and the four rail chips moving with every turn. A recorded
//       negotiation is replayed turn by turn, labelled, never with a typing indicator.
//   NEG.recorded({ box, why, say }) → the same, from GET /v1/try/negotiate/recorded (public): nothing to sign.
//   NEG.agreed(n, actions) → the "Agreed terms" card: the terms, the canonical JSON folded, the SHA-256 typed out,
//       then the caller's buttons.
import { RECORDED_LABEL, SOURCING_LABEL, SUPPLIER_LABEL } from "../../../src/negotiate/negotiate.js";

/** Every word the view shows (tests read them). */
export const NEG_COPY = {
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
  thinking: "Starting… Purser's agent is thinking",
  typing: "{who} is answering (Claude)…",
  simBadge: "simulated supplier",
  stamp: "Refused by code",
  reset: "Claude stopped answering, so the live turns are dropped; the recorded negotiation follows.",
  held: "Purser's code held the Sourcing agent to the supplier's best offer on record: it had asked to pay {asked}; the best offer on record is {floor} (turn {turn}), its bank change dropped.",
  accepts: "Accepts",
  agreedHead: "Agreed terms",
  noDealHead: "No deal: the invoice as issued",
  noDeal: "The agents did not agree within 4 turns, so the invoice stands as issued, by its due date.",
  agreement: { amount: "Pay", discount: "Discount", payBy: "By", payee: "To", ref: "Reference" },
  canonical: "Show the canonical JSON",
  sha: "SHA-256 of the agreement",
  shaNote: "The agreed invoice carries the first 8 characters of this hash as its reference, so the terms your passkey signs name this agreement and no other.",
  failed: "The negotiation could not finish. Nothing was paid.",
  noAnswer: "No answer from Purser's demo. Check your connection and try again.",
  /** /try's own flow (cloud/src/tryPage.ts drawResult): the step before the passkey. */
  inline: {
    head: "Let Purser's agent negotiate an early-payment discount",
    sub: "Purser's Sourcing agent (Claude) asks {supplier}'s agent (a simulated supplier, played by Claude) for a discount for paying early. Code holds the CFO's limits on every turn; you sign whatever is agreed, with your passkey.",
    button: "Negotiate an early-payment discount",
    signAgreed: "Sign the agreed terms with your passkey",
    payIssued: "Pay the invoice as issued",
    filing: "Filing the agreed invoice…",
    filedHeld: "The agreed invoice could not be filed as ready to pay. Pay the invoice as issued instead.",
    limit: "Today's live limit is reached; showing the recorded negotiation.",
    paused: "The live demo is paused right now; showing the recorded negotiation.",
    recordedPay: "A recording has nothing to sign: pay the invoice as issued, below.",
  },
} as const;

/** The view's style: every selector under .neg, appended after the page's own. */
export const NEG_CSS = `
.neg { display: grid; gap: 0; }
.neg .turns { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.neg .turn { display: flex; gap: 10px; align-items: flex-start; max-width: 100%; }
.neg .turn.sourcing { margin-right: 18%; }
.neg .turn.supplier { flex-direction: row-reverse; margin-left: 18%; }
.neg .av { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font: 700 14px/1 Inter, system-ui, sans-serif; color: #fff; background: var(--accent); }
.neg .turn.supplier .av { background: var(--muted); }
.neg .bubble { position: relative; min-width: 0; flex: 1 1 auto; border: 1px solid var(--border); border-radius: 16px; border-top-left-radius: 4px; background: var(--surface); padding: 12px 14px; overflow: hidden; }
.neg .turn.supplier .bubble { border-radius: 16px; border-top-right-radius: 4px; border-style: dashed; }
.neg .turn.refused .bubble { border-color: var(--bad); border-style: solid; }
.neg .who { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; font-size: 12.5px; color: var(--muted); margin: 0 0 6px; }
.neg .who b { color: var(--text); }
.neg .pill { display: inline-block; padding: 0 8px; border-radius: 999px; border: 1px solid var(--border); font-size: 12px; line-height: 20px; }
.neg .pill.rec { border-style: dashed; }
.neg .pill.sim { border-color: var(--muted); border-style: dashed; color: var(--text); }
.neg .stamp { display: inline-block; margin: 0 0 8px; padding: 2px 10px; border: 2px solid var(--bad); border-radius: 6px; color: var(--bad); font: 800 12px/1.4 Inter, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; transform: rotate(-3deg); }
.neg .msg { margin: 0 0 8px; overflow-wrap: anywhere; }
.neg .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; padding: 0; list-style: none; }
.neg .chips li { font-size: 13px; padding: 2px 8px; border-radius: 8px; background: var(--sunken); overflow-wrap: anywhere; }
.neg .verdict { font-size: 14px; margin: 0; padding: 6px 10px; border-radius: 10px; }
.neg .verdict.ok { background: var(--ok-soft); color: var(--text); }
.neg .verdict.no { background: var(--bad-soft); color: var(--text); border: 1px solid var(--bad); }
.neg .verdict .rule { display: block; font-weight: 600; margin-top: 2px; }
.neg .nnote { font-size: 14px; color: var(--muted); margin: 8px 0 0; }
.neg .rec-label { border: 1px dashed var(--border); border-radius: 12px; padding: 10px 12px; margin: 0 0 12px; font-size: 14px; color: var(--muted); }
.neg .typing .bubble, .neg .thinking .bubble { flex: 0 1 auto; display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
.neg .dots { display: inline-flex; gap: 4px; }
.neg .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); opacity: .5; }
.neg .meter { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 12px 14px; margin: 0 0 10px; }
.neg .mrow { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; font-size: 13px; color: var(--muted); }
.neg .mrow b { color: var(--text); font-variant-numeric: tabular-nums; }
.neg .track { position: relative; height: 12px; margin: 10px 0 8px; border-radius: 999px; background: var(--sunken); overflow: hidden; }
.neg .track .fill { position: absolute; top: 0; bottom: 0; left: 0; width: 0; border-radius: 999px; background: var(--accent); }
.neg .track .mk { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1px; left: 0; background: var(--ok); }
.neg .track .mk.cur { background: var(--text); }
.neg .disc { margin: 0; font-size: 15px; }
.neg .disc b { font-variant-numeric: tabular-nums; }
.neg .railchips { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.neg .railchips li { font-size: 12.5px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); }
.neg .railchips li.ok { border-color: var(--ok); background: var(--ok-soft); }
.neg .railchips li.no { border-color: var(--bad); background: var(--bad-soft); font-weight: 650; }
.negagreed { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 16px; margin: 14px 0 0; }
.negagreed h3 { margin: 0 0 10px; font-size: 17px; }
.negagreed dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0 0 10px; }
.negagreed dt { color: var(--muted); }
.negagreed dd { margin: 0; overflow-wrap: anywhere; }
.negagreed .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow-wrap: anywhere; }
.negagreed pre.mono { white-space: pre-wrap; background: var(--sunken); padding: 10px; border-radius: 10px; margin: 8px 0 0; }
.negagreed .sha.typing-out::after { content: "▍"; }
.negagreed .nnote { font-size: 14px; color: var(--muted); }
.negagreed .negacts { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0 0; }
.negspin { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; vertical-align: -2px; }
.negcard { border: 1px solid var(--accent); border-radius: 16px; background: var(--surface); padding: 16px; margin: 14px 0; }
.negcard > h3 { margin: 0 0 6px; font-size: 18px; line-height: 1.25; }
.negcard > .nnote { font-size: 14px; color: var(--muted); margin: 0 0 12px; }
.negcard .negacts { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.negcard .negbox:not(:empty) { margin-top: 14px; }
.neg-err { border: 1px solid var(--bad); background: var(--bad-soft); border-radius: 12px; padding: 10px 12px; margin: 10px 0; }
@media (prefers-reduced-motion: no-preference) {
  .negspin { animation: negspin .8s linear infinite; }
  @keyframes negspin { to { transform: rotate(360deg); } }
  .neg .turn { animation: negrise .35s ease-out both; }
  @keyframes negrise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .neg .dots i { animation: negblink 1.1s infinite ease-in-out; }
  .neg .dots i:nth-child(2) { animation-delay: .18s; } .neg .dots i:nth-child(3) { animation-delay: .36s; }
  @keyframes negblink { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
  .neg .track .fill, .neg .track .mk { transition: width .6s ease, left .6s ease; }
  .neg .railchips li.flash { animation: negflash .9s ease-out; }
  @keyframes negflash { 0% { transform: scale(1.08); } 100% { transform: none; } }
  .neg .stamp { animation: negstamp .45s cubic-bezier(.2, 1.6, .4, 1) both; }
  @keyframes negstamp { from { opacity: 0; transform: rotate(-3deg) scale(1.8); } to { opacity: 1; transform: rotate(-3deg) scale(1); } }
  .negshake { animation: negshake .45s ease-in-out; }
  @keyframes negshake { 0%, 100% { transform: none; } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
}
`;

/** The view's script: defines NEG. Plain script inside a page's module; no backticks and no "${" in it. */
export const NEG_KIT_JS = String.raw`
const NEG=(()=>{
const NC=__NEGCOPY__;
let calm=false;try{calm=matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}
const el=(tag,cls,kids)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(kids!==undefined&&kids!==null)for(const k of [].concat(kids))if(k!==null&&k!==undefined&&k!==false)n.append(typeof k==='string'?document.createTextNode(k):k);return n};
const fill=(s,o)=>String(s).replace(/\{(\w+)\}/g,(m,k)=>o[k]===undefined?m:String(o[k]));
const eur=(s)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(s));if(!m)return String(s);return 'EUR '+m[1].replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+m[2]};
const centsOf=(s)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(s));return m?Number(m[1])*100+Number(m[2]):NaN};
const money=(c)=>eur((Math.round(c)/100).toFixed(2));
const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
function countTo(node,from,to,fmt){
  if(calm||!isFinite(from)||from===to){node.textContent=fmt(to);return}
  const t0=performance.now(),d=600;
  const tick=(t)=>{const k=Math.min(1,(t-t0)/d);node.textContent=fmt(from+(to-from)*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(tick)};requestAnimationFrame(tick);
}
function bubble(t,mode){
  const T=NC.terms;const sup=t.who==='supplier';
  const name=typeof t.label==='string'&&t.label?t.label:(sup?NC.supplier:NC.sourcing);
  const who=el('p','who',[el('b','',name),sup?el('span','pill sim',NC.simBadge):null,el('span','pill'+(mode==='recorded'?' rec':''),mode==='recorded'?NC.recorded:NC.live+(t.model?' · '+t.model:'')),t.ms>=100?el('span','',(t.ms/1000).toFixed(1)+' s'):null,el('span','','Turn '+t.n)]);
  const p=t.proposed||{};
  const chips=el('ul','chips',[el('li','',T.amount+': '+eur(p.amount)),el('li','',T.discount+': '+(p.discount==='—'?'—':eur(p.discount)+' ('+p.discount_pct+')')),el('li','',T.payBy+': '+p.pay_by),p.iban?el('li','',T.account+': '+p.iban):null,t.accept?el('li','',NC.accepts):null]);
  const refs=(t.rails&&t.rails.refusals)||[];const ok=!!(t.rails&&t.rails.ok);
  const v=ok?el('p','verdict ok',NC.within):el('p','verdict no',[el('b','',NC.refused+': '),refs.map((r)=>r.detail).join('; '),...refs.map((r)=>el('span','rule',NC.heldRule+' '+r.says))]);
  const stamp=refs.some((r)=>r.rule==='payee_unchanged')?el('span','stamp',NC.stamp):null;
  const h=t.held_to_best_offer;
  const bub=el('div','bubble',[who,stamp,el('p','msg',t.message),chips,v,t.scripted_bank_change?el('p','nnote',NC.scripted):null,h?el('p','nnote held',fill(NC.held,{asked:eur(h.asked),floor:eur(h.floor),turn:h.floor_turn})):null]);
  const card=el('li','turn '+t.who+(ok?'':' refused'),[el('span','av',sup?name.charAt(0).toUpperCase():'P'),bub]);
  card.setAttribute('aria-label','Turn '+t.n+', '+name);card.querySelector('.av').setAttribute('aria-hidden','true');
  return card;
}
function waitRow(who,words,kind){
  const r=el('li','turn '+(kind||'typing')+' '+who,[el('span','av',who==='supplier'?'S':'P'),el('div','bubble',[el('span','dots',[el('i'),el('i'),el('i')]),el('span','',words)])]);
  r.querySelector('.av').setAttribute('aria-hidden','true');return r;
}
// The board: the deal meter and the rail chips, moved on every turn.
function board(bounds){
  const M=NC.meter,inv=bounds.max_pay_cents;
  const B={inv,cur:inv,lo:Math.round(inv*0.95),curB:el('b','',M.none),bestB:el('b','',M.none),disc:el('b','','EUR 0.00'),pct:el('span','','0.0%'),fill:el('i','fill'),mkCur:el('i','mk cur'),mkBest:el('i','mk best'),chips:{}};
  B.mkCur.hidden=true;B.mkBest.hidden=true;
  B.meter=el('div','meter',[el('div','mrow',[el('span','',[M.invoice+' ',el('b','',money(inv))]),el('span','',[M.current+' ',B.curB]),el('span','',[M.best+' ',B.bestB])]),el('div','track',[B.fill,B.mkBest,B.mkCur]),el('p','disc',[M.discount+' ',B.disc,' (',B.pct,')'])]);
  B.meter.id='meter';
  const R=NC.railChips;
  const lab={max_amount:fill(R.max_amount,{max:money(inv).slice(4)}),pay_by_window:fill(R.pay_by_window,{to:bounds.latest_pay_by}),invoice_only:R.invoice_only,payee_unchanged:R.payee_unchanged};
  B.chipsEl=el('ul','railchips',Object.keys(lab).map((k)=>{const li=el('li','',lab[k]);li.dataset.rule=k;B.chips[k]=li;return li}));
  B.chipsEl.id='railchips';B.chipsEl.setAttribute('aria-label',NC.railChipsLabel);
  B.pos=(c)=>Math.max(0,Math.min(100,(B.inv-c)/(B.inv-B.lo)*100));
  return B;
}
function move(B,t,best){
  const bad=new Set(((t.rails&&t.rails.refusals)||[]).map((r)=>r.rule));
  for(const k of Object.keys(B.chips)){const li=B.chips[k];li.classList.remove('ok','no','flash');void li.offsetWidth;li.classList.add(bad.has(k)?'no':'ok','flash')}
  const c=centsOf(t.proposed&&t.proposed.amount);
  if(t.rails&&t.rails.ok&&isFinite(c)){
    const from=B.inv-B.cur;B.cur=c;B.curB.textContent=eur(t.proposed.amount);B.mkCur.hidden=false;
    B.mkCur.style.left=B.pos(c)+'%';B.fill.style.width=B.pos(c)+'%';
    countTo(B.disc,from,B.inv-c,(v)=>money(v));countTo(B.pct,from/B.inv*100,(B.inv-c)/B.inv*100,(v)=>v.toFixed(1)+'%');
  }
  if(best&&isFinite(centsOf(best.amount))){B.bestB.textContent=eur(best.amount);B.mkBest.hidden=false;B.mkBest.style.left=B.pos(centsOf(best.amount))+'%'}
}
function bestOf(turns){let b=null;for(const t of turns){if(t.who!=='supplier')continue;const r=(t.rails&&t.rails.refusals)||[];if(!(t.rails&&t.rails.ok)&&!r.every((x)=>x.rule==='payee_unchanged'))continue;const c=centsOf(t.proposed.amount);if(isFinite(c)&&(!b||c<centsOf(b.amount)))b={amount:t.proposed.amount,turn:t.n}}return b}
async function* lines(reader){
  const dec=new TextDecoder();let buf='';
  for(;;){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(l){try{yield JSON.parse(l)}catch(e){}}}}
  if(buf.trim()){try{yield JSON.parse(buf)}catch(e){}}
}
// The view in a box: the board above the chat once the bounds are known.
function view(box){
  const V={box,list:el('ol','turns'),wait:null,B:null,root:el('div','neg')};
  V.root.append(V.list);box.replaceChildren(V.root);
  V.waiting=(who,words,kind)=>{if(V.wait){V.wait.remove();V.wait=null}if(who){V.wait=waitRow(who,words,kind);V.list.append(V.wait)}};
  V.boardFor=(bounds)=>{if(V.B)return;V.B=board(bounds);V.root.prepend(V.B.meter,V.B.chipsEl)};
  return V;
}
async function replay(V,n,say){
  V.waiting(null);V.boardFor(n.bounds);
  if(n.mode==='recorded'&&!V.root.querySelector('.rec-label'))V.root.prepend(el('p','rec-label',[el('b','',n.label||NC.recordedLabel),n.reason?el('span','',' '+fill(NC.why,{reason:n.reason})):null]));
  V.list.replaceChildren();const seen=[];
  for(const t of n.turns){seen.push(t);V.list.append(bubble(t,n.mode));move(V.B,t,bestOf(seen));if(say)say('Turn '+t.n);if(!calm)await sleep(650)}
}
const errOf=(status,j)=>({ok:false,status,code:j&&typeof j.code==='string'?j.code:'',message:j&&typeof j.message==='string'&&j.message?j.message:j&&typeof j.error==='string'&&j.error?j.error:(status?NC.failed:NC.noAnswer)});
async function run(o){
  const V=view(o.box);const say=o.say||(()=>{});
  // At once, before any answer: a thinking row on Purser's side (not yet a model call).
  V.waiting('sourcing',NC.thinking,'thinking');say(NC.thinking);
  const go=async()=>{const h={};const s=o.auth&&o.auth();if(s)h.authorization='Bearer '+s;if(o.body){h['content-type']='application/json'}
    try{return await fetch('/v1/try/negotiate?stream=1',{method:'POST',headers:h,body:o.body?JSON.stringify(o.body):undefined})}catch(e){return null}};
  let r=await go();if(r&&r.status===401&&o.renew&&await o.renew())r=await go();
  if(!r){V.waiting(null);return errOf(0,null)}
  if(r.status!==200||!r.body||!/ndjson/.test(r.headers.get('content-type')||'')){let j={};try{j=await r.json()}catch(e){}V.waiting(null);
    if(r.status===200&&Array.isArray(j.turns)){await replay(V,j,say);return {ok:true,n:j}}
    return errOf(r.status,j)}
  let n=null,shown=0;
  for await (const ev of lines(r.body.getReader())){
    if(ev.type==='start'&&ev.bounds){V.boardFor(ev.bounds);if(ev.live===true)V.waiting('sourcing',fill(NC.typing,{who:NC.sourcing.split(' · ')[0]}))}
    else if(ev.type==='turn'&&ev.turn){const t=ev.turn;V.waiting(null);V.list.append(bubble(t,'live'));shown++;if(V.B)move(V.B,t,ev.best);say('Turn '+t.n);
      if(t.n<4)V.waiting(t.who==='sourcing'?'supplier':'sourcing',fill(NC.typing,{who:t.who==='sourcing'?String(t.label||NC.supplier).split(' · ')[0]:NC.sourcing.split(' · ')[0]}))}
    else if(ev.type==='reset'){V.waiting(null);shown=0;V.list.replaceChildren(el('li','nnote',NC.reset))}
    else if(ev.type==='done'&&ev.negotiation)n=ev.negotiation;
    else if(ev.type==='error'){V.waiting(null);return errOf(500,{message:ev.message})}
  }
  V.waiting(null);
  if(!n||!Array.isArray(n.turns))return errOf(500,null);
  V.boardFor(n.bounds);
  if(V.B)V.B.chips.pay_by_window.textContent=fill(NC.railChips.pay_by_window,{to:n.bounds.latest_pay_by});
  if(n.mode==='recorded'||!shown)await replay(V,n,say);
  return {ok:true,n};
}
async function recorded(o){
  const V=view(o.box);
  let r=null;try{r=await fetch('/v1/try/negotiate/recorded?why='+encodeURIComponent(o.why||'start'))}catch(e){}
  let j={};if(r){try{j=await r.json()}catch(e){}}
  if(!r||r.status!==200||!Array.isArray(j.turns))return errOf(r?r.status:0,j);
  await replay(V,j,o.say);return {ok:true,n:j};
}
function typeOut(node,text){
  if(calm){node.textContent=text;node.classList.add('done');return}
  node.classList.add('typing-out');let i=0;
  const t=setInterval(()=>{i=Math.min(text.length,i+2);node.textContent=text.slice(0,i);if(i>=text.length){clearInterval(t);node.classList.remove('typing-out');node.classList.add('done')}},16);
}
function agreed(n,actions){
  const A=NC.agreement,a=n.agreement;
  const h=el('h3','',n.outcome==='agreed'?NC.agreedHead:NC.noDealHead);h.tabIndex=-1;
  const dl=el('dl','',[el('dt','',A.amount),el('dd','',eur(a.amount)),el('dt','',A.discount),el('dd','',eur(a.discount)+' off '+eur(a.invoice_amount)),el('dt','',A.payBy),el('dd','',a.pay_by),el('dt','',A.payee),el('dd','',a.supplier+' · account ending '+a.payee_iban_last4),el('dt','',A.ref),el('dd','mono',n.compose.invoice_no)]);
  const shaV=el('span','mono sha','');
  const card=el('section','negagreed',[h,n.outcome==='agreed'?null:el('p','nnote',NC.noDeal),dl,el('details','',[el('summary','',NC.canonical),el('pre','mono',n.canonical)]),el('p','',[el('span','nnote',NC.sha+': '),shaV]),el('p','nnote',NC.shaNote),el('div','negacts',actions||[])]);
  card.id='negagreed';
  setTimeout(()=>typeOut(shaV,n.sha256),0);
  return {card,heading:h};
}
function thinking(box){const V=view(box);V.waiting('sourcing',NC.thinking,'thinking');return V}
return {copy:NC,run,recorded,agreed,thinking,el,eur,calm:()=>calm,shake:(node)=>{if(!calm){node.classList.remove('negshake');void node.offsetWidth;node.classList.add('negshake')}}};
})();
`;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
/** The script with its words in it. */
export const negKitJs = (): string => NEG_KIT_JS.replace("__NEGCOPY__", () => json(NEG_COPY));

/**
 * /try's step before the passkey (cloud/src/tryPage.ts drawResult, the "Ready to pay" branch): NEGI.card(inv, pay)
 * for a payable EUR invoice not yet due. It uses /try's own api, show, renew, say and session (S): the same company.
 * The negotiation runs inline; agreed, the agreed invoice is filed (POST /v1/engine/compose) and /try's own approve
 * screen signs it; no deal, the invoice as issued goes to the approve screen. A limit or a pause plays the recording,
 * labelled, and the invoice can still be paid as invoiced. The server decides what can be negotiated (409, said).
 */
export const NEG_TRY_JS = String.raw`
const NEGI=(()=>{
  const NC=NEG.copy,I=NC.inline,el=NEG.el;
  const today=()=>new Date().toISOString().slice(0,10);
  // The guided tour (?tour=1, cloud/src/try/run.ts) walks the plain payment: no card there.
  const touring=()=>{try{return new URLSearchParams(location.search).get('tour')==='1'}catch(e){return false}};
  const eligible=(inv)=>!touring()&&!!inv&&inv.currency==='EUR'&&inv.payable!==false&&inv.status==='ready'&&typeof inv.due_date==='string'&&inv.due_date>today()&&!(inv.proposal&&inv.proposal.status&&inv.proposal.status!=='PENDING_APPROVAL');
  const spin=(b,words)=>{b.disabled=true;b.replaceChildren(el('span','negspin'),document.createTextNode(' '+words))};
  function card(inv,pay){
    pay.className='btn';
    const go=el('button','btn primary big',I.button);go.type='button';go.id='negotiate';
    const box=el('div','negbox');const said=el('div','');said.setAttribute('role','status');
    const sup=String(inv.vendor||'').split(/\s+/)[0]||'The supplier';
    const sec=el('section','negcard',[el('h3','',I.head),el('p','nnote',I.sub.replace('{supplier}',sup)),el('div','negacts',[go]),said,box]);
    go.addEventListener('click',async()=>{
      spin(go,NC.thinking);said.replaceChildren();
      const res=await NEG.run({box,body:{invoice_id:inv.id},auth:()=>S.session,renew,say});
      go.remove();
      if(!res.ok){
        if(res.status===429||res.status===503){said.replaceChildren(el('p','neg-err',res.status===503?I.paused:I.limit));await NEG.recorded({box,why:res.status===503?'paused':'limit',say});box.append(el('p','nnote',I.recordedPay));return}
        said.replaceChildren(el('p','neg-err',res.message||NC.failed));return}
      const n=res.n;
      const sign=el('button','btn primary big',n.outcome==='agreed'?I.signAgreed:I.payIssued);sign.type='button';sign.id='negsign';
      const a=NEG.agreed(n,[sign]);box.append(a.card);a.heading.focus();
      sign.addEventListener('click',async()=>{
        if(n.outcome!=='agreed'){show('approve',{invoice:inv});return}
        spin(sign,I.filing);
        const f=await api('POST','/v1/engine/compose',n.compose);
        const ni=f.json&&f.json.invoice;
        if(f.status===200&&ni&&ni.id&&ni.status==='ready'){show('approve',{invoice:ni});return}
        sign.disabled=false;sign.textContent=I.signAgreed;a.card.append(el('p','neg-err',(f.json&&(f.json.message||f.json.error))||I.filedHeld));
      });
    });
    return sec;
  }
  return {eligible,card};
})();
`;
