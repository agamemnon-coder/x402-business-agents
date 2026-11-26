// The negotiation's view (15 Nov; 26 Nov, Max: "the page looked simple"), one script for both places it runs:
// /try/negotiate (./negotiatePage.ts) and /try's own flow, where a payable invoice from a supplier on file gets "Let
// Purser's agent negotiate an early-payment discount" before the passkey (cloud/src/tryPage.ts drawResult).
// Self-contained: its own helpers inside one object, NEG, so it shares no names with the page around it; every value
// from the server goes in as text, never as markup; bars and dots move through the CSSOM (element.style), never through
// a style attribute, so the pages' nonce policy holds.
//
// The colour system (cloud/src/consoleColor.ts): violet Purser and the CFO's approval (--accent), emerald agreed and
// within (--n-ok), amber what goes to the CFO and test money (--n-wait), rose refused (--n-bad); each agent its own hue
// (--n-p Purser's Sourcing agent, --n-s the simulated supplier). Laid out by the view's own width (container queries),
// so /try's narrow card and the page's wide one each get theirs: one column on a phone; the two agents in two columns
// from 600 px; the policy meter and the rails beside the chat from 900 px.
//
//   NEG.run({ box, body, auth, renew, say }) → { ok: true, n } | { ok: false, status, code, message }
//       POST /v1/try/negotiate?stream=1, drawn into box as it comes: each turn an offer card (amount, discount, pay-by,
//       payee, the rails' and the policy's verdict, its hash and signing key), the policy meter (every offer a dot against
//       the CFO's band) and the rail chips moving with every turn. A recorded negotiation is replayed turn by turn, labelled.
//   NEG.recorded({ box, why, say }) → the same, from GET /v1/try/negotiate/recorded (public): nothing to sign.
//   NEG.agreed(n, actions) → "The CFO signs the exact terms": the invoice as issued beside the deal, the saving
//       (computed from the invoice and the discount; test money), the reference, the hash, then the caller's buttons.
//   Each offer shows its SHA-256 and its signing key; the negotiation answers the agents' public keys, so whoever holds
//   the downloaded negotiation can check every signature, hash and link of the chain (src/negotiate/offers.ts verifyOffer,
//   chained). This view does not check them in the browser; the server does, when the agreed terms are filed (/agreed).
import { RECORDED_LABEL, SOURCING_LABEL, SUPPLIER_LABEL } from "../../../src/negotiate/negotiate.js";

/** Every word the view shows (tests read them). */
export const NEG_COPY = {
  live: "Live · Claude",
  recorded: "Recorded",
  recordedLabel: RECORDED_LABEL,
  why: "Why: {reason}",
  sourcing: SOURCING_LABEL,
  supplier: SUPPLIER_LABEL,
  terms: { amount: "Amount", discount: "Discount", payBy: "Pay by", account: "Pay to" },
  onFile: "Account on file",
  within: "Within the rails and the policy",
  outside: "Outside the policy: to the CFO",
  refused: "Refused by the rails",
  heldRule: "The rule that held:",
  scripted: "The simulation added this bank change (the model left it out) so the rails can refuse it.",
  meter: { head: "Policy meter", invoice: "Invoice", current: "Current offer", best: "Best offer on record", discount: "Discount", none: "—", band: "Policy: {min}–{max}% off, paid from {from}" },
  railChips: { max_amount: "Max EUR {max}", pay_by_window: "Pay by {to}", invoice_only: "Invoice only", payee_unchanged: "Payee unchanged" },
  railChipsLabel: "The rails, checked on every turn",
  sig: { offer: "Offer", by: "signed by" },
  thinking: "Starting… Purser's agent is thinking",
  typing: "{who} is answering (Claude)…",
  simBadge: "simulated supplier",
  stamp: "Refused by code",
  reset: "Claude stopped answering, so the live turns are dropped; the recorded negotiation follows.",
  held: "Code held the Sourcing agent to the supplier's best offer on record, {floor} (turn {turn}), its bank change dropped: it had asked to pay {asked}.",
  heldPolicy: "Code held it to the CFO's policy: it had asked {asked} by {by}.",
  accepts: "Accepts",
  agreedHead: "The CFO signs the exact terms",
  escHead: "Outside the CFO's policy: the CFO decides",
  esc: "Outside your policy ({rules}): Purser's agent could not accept these terms. Sign them yourself, or leave the invoice as issued.",
  noDealHead: "No deal: the invoice as issued",
  noDeal: "The agents did not agree within 4 turns, so the invoice stands as issued, by its due date.",
  was: "Invoice as issued",
  now: "The deal you sign",
  due: "due {d}",
  saving: "Saving",
  yearly: "{days} days early for {pct}% off: {rate}% a year on the cash paid early (simple rate).",
  testMoney: "Test money: not a real saving",
  agreement: { payee: "To", ref: "Reference", chain: "Offer chain" },
  canonical: "Show the canonical JSON",
  sha: "SHA-256 of the agreement",
  shaNote: "The agreed invoice's reference carries its first 8 characters: your passkey signs this agreement and its offer chain, no other.",
  failed: "The negotiation could not finish. Nothing was paid.",
  noAnswer: "No answer from Purser's demo. Check your connection and try again.",
  inline: {
    head: "Let Purser's agent negotiate an early-payment discount",
    sub: "Purser's Sourcing agent (Claude) asks {supplier}'s agent (a simulated supplier, played by Claude) for a discount for paying early. Code holds the CFO's limits on every turn; you sign whatever is agreed, with your passkey.",
    button: "Negotiate an early-payment discount",
    signAgreed: "Sign the agreed terms with your passkey",
    filing: "Filing the agreed invoice…",
    filedHeld: "The agreed invoice could not be filed as ready to pay. Pay the invoice as issued instead.",
    limit: "Today's live limit is reached; showing the recorded negotiation.",
    paused: "The live demo is paused right now; showing the recorded negotiation.",
    recordedPay: "A recording has nothing to sign: pay the invoice as issued, below.",
  },
} as const;

const DARK = "--n-ok:#34d399;--n-wait:#fbbf24;--n-bad:#fb7185;--n-p:#a5b4fc;--n-s:#5eead4";
// Each hue's tint (12% on the surface) and its ink (82% into the text colour: at least 5.2:1 in both themes, as the console's).
const MIX = ["ok", "wait", "bad"].map((h) => `--t-${h}:color-mix(in srgb,var(--n-${h}) 12%,var(--surface));--i-${h}:color-mix(in srgb,var(--n-${h}) 82%,var(--text))`).join(";");

/** The view's style: every selector under .neg, .negagreed or .negcard, or a class only the view uses; after the page's own. */
export const NEG_CSS = `
:root{--n-ok:#047857;--n-wait:#b45309;--n-bad:#be123c;--n-p:#4338ca;--n-s:#0f766e}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}:root[data-theme="dark"]{${DARK}}
.neg,.negagreed,.neg-err{${MIX}}
.neg{container-type:inline-size;display:grid;gap:12px}.ngrid,.nside{display:grid;gap:12px;align-content:start;min-width:0}.nchat{min-width:0}
.neg .av{flex:0 0 30px;height:30px;border-radius:10px;display:grid;place-items:center;font-weight:700;font-size:13px;color:var(--bg);background:var(--c)}
.neg .turns{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.neg .turn{--c:var(--n-p);display:flex;gap:10px;align-items:flex-start;min-width:0}.neg .turn.supplier{--c:var(--n-s)}
.neg .bubble{min-width:0;flex:1;border:1px solid color-mix(in srgb,var(--c) 32%,var(--border));border-radius:5px 18px 18px;background:color-mix(in srgb,var(--c) 7%,var(--surface));padding:12px 14px}
.neg .supplier .bubble{border-style:dashed}.neg .refused .bubble{border:1px solid var(--n-bad);background:var(--t-bad)}.neg .out .bubble{border:1px solid var(--n-wait)}
.neg .who{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12px;color:var(--muted);margin:0 0 6px}.neg .who b{color:var(--text)}
.neg .pill{padding:0 8px;border-radius:99px;border:1px dashed var(--border);font-size:11.5px;line-height:20px}.neg .pill.rec{border-color:var(--n-wait);color:var(--i-wait)}.neg .pill.sim{border-color:var(--n-s)}
.neg .stamp{display:inline-block;margin:0 0 8px;padding:2px 10px;border:2px solid var(--n-bad);border-radius:6px;color:var(--i-bad);font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase;transform:rotate(-3deg)}
.neg .msg{margin:0 0 10px;overflow-wrap:anywhere}
.chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:6px;margin:0 0 10px;padding:0;list-style:none}
.chips li{padding:5px 9px;border-radius:10px;background:var(--sunken);font-weight:650;overflow-wrap:anywhere}.chips small{display:block;font-weight:400;font-size:11px;color:var(--muted)}
.chips .x{background:var(--t-bad);color:var(--i-bad)}.chips .acc{background:var(--t-ok);color:var(--i-ok)}
.neg .verdict{font-size:14px;margin:0;padding:6px 10px;border-radius:10px;background:var(--t-ok)}.neg .verdict.no{background:var(--t-bad);border:1px solid var(--n-bad)}.neg .verdict.out{background:var(--t-wait);border:1px solid var(--n-wait)}.neg .rule{display:block;font-weight:600}
.neg .sig{display:flex;flex-wrap:wrap;gap:2px 8px;margin:8px 0 0;font-size:11.5px;color:var(--muted)}
.neg .mono,.negagreed .mono{font-family:var(--mono,monospace);font-size:12px;overflow-wrap:anywhere}
.neg .nnote{font-size:13.5px;color:var(--muted);margin:8px 0 0}
.neg .rec-label{border:1px dashed var(--n-wait);background:var(--t-wait);border-radius:12px;padding:10px 12px;margin:0;font-size:14px;color:var(--muted)}
.neg .typing .bubble,.neg .thinking .bubble{flex:0 1 auto;display:flex;gap:8px;align-items:center;color:var(--muted);font-size:13px}
.neg .dots{display:inline-flex;gap:4px}.neg .dots i{width:7px;height:7px;border-radius:50%;background:var(--c);opacity:.5}
.meter{border:1px solid var(--border);border-radius:16px;background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 11%,var(--surface)),var(--surface) 70%);padding:12px 14px}
.mt{margin:0 0 8px;font-size:11.5px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.mrow{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;font-size:12.5px;color:var(--muted)}.mrow b{display:block;color:var(--text);font-size:14px}
.neg .track{position:relative;height:12px;margin:20px 0 30px;border-radius:99px;background:var(--sunken)}.neg .track i{position:absolute;border-radius:99px}
.neg .band{top:0;bottom:0;background:color-mix(in srgb,var(--accent) 34%,transparent)}.neg .fill{top:3px;bottom:3px;left:0;background:var(--n-ok)}.neg .mk{top:-4px;bottom:-4px;width:3px;margin-left:-1px;background:var(--text)}
.od{top:-13px;width:9px;height:9px;margin-left:-4.5px;background:var(--n-ok);box-shadow:0 0 0 2px var(--surface)}.od.s{top:auto;bottom:-13px}.od.no{background:var(--n-bad)}.od.out{background:var(--n-wait)}
.tk{position:absolute;top:27px;font-size:10.5px;color:var(--faint);transform:translateX(-50%)}
.disc{margin:0;font-size:14px}.disc b{color:var(--i-ok)}.bandnote{margin:6px 0 0;font-size:12px;color:var(--muted)}
.railchips{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}.railchips li{font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid var(--border)}
.railchips .ok{border-color:var(--n-ok);background:var(--t-ok)}.railchips .no{border-color:var(--n-bad);background:var(--t-bad);font-weight:650}
@container (min-width:600px){.neg .turn{width:68%}.neg .turn.supplier{margin-left:auto;flex-direction:row-reverse}.neg .supplier .bubble{border-radius:18px 5px 18px 18px}}
@container (min-width:900px){.ngrid{grid-template-columns:minmax(0,1fr) 290px}.nside{grid-area:1/2;position:sticky;top:84px}.nchat{grid-area:1/1}}
.negagreed{border:1px solid var(--accent);border-radius:22px;background:radial-gradient(120% 90% at 100% 0,color-mix(in srgb,var(--accent) 17%,transparent),transparent 62%),var(--surface);padding:18px;margin:16px 0 0;box-shadow:0 30px 70px -40px var(--glow)}
.negagreed.esc{border-color:var(--n-wait)}.negagreed h3{margin:0 0 6px;font-size:20px}
.negagreed .cmp{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;margin:12px 0}
.negagreed .col{border:1px solid var(--border);border-radius:14px;padding:12px;background:var(--sunken)}.negagreed .now{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--surface))}
.negagreed .col p{margin:0;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.negagreed .col b{display:block;font-size:24px;margin:4px 0}
.negagreed .arr{align-self:center;color:var(--accent);font-size:20px}
.negagreed .save{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;padding:12px 14px;border-radius:14px;background:var(--t-ok);border:1px solid var(--n-ok)}
.negagreed .save p{margin:0}.negagreed .save b{color:var(--i-ok);font-size:20px}.negagreed .save .nnote{flex-basis:100%;margin:0}
.negagreed .tag{padding:1px 9px;border-radius:99px;font-size:12px;font-weight:650;background:var(--t-wait);color:var(--i-wait)}
.negagreed dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 14px;margin:12px 0}.negagreed dt,.negagreed .nnote{color:var(--muted)}.negagreed dd{margin:0;overflow-wrap:anywhere}
.negagreed pre{white-space:pre-wrap;background:var(--sunken);padding:10px;border-radius:10px}.negagreed summary{cursor:pointer}
.negagreed .shal{margin:14px 0 0}.negagreed .sha.typing-out::after{content:"▍"}.negagreed .nnote{font-size:14px;margin:6px 0}.negacts{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.negagreed .negacts{margin:14px 0 0}
.negspin{display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;vertical-align:-2px}
.payrow .btn[hidden]{display:none!important}
.negcard{border:1px solid var(--accent);border-radius:16px;background:var(--surface);padding:16px;margin:14px 0}.negcard>h3{margin:0 0 6px;font-size:18px}.negcard>.nnote{font-size:14px;color:var(--muted);margin:0 0 12px}.negcard .negbox:not(:empty){margin-top:14px}
.neg-err{border:1px solid var(--n-bad);background:var(--t-bad);border-radius:12px;padding:10px 12px;margin:10px 0}
@media (max-width:560px){.neg .bubble{padding:10px 12px}.negagreed{padding:14px}.negagreed .cmp,.negagreed dl{grid-template-columns:1fr}.negagreed .arr{justify-self:center;transform:rotate(90deg)}.negagreed dd{margin-bottom:6px}}
@media (prefers-reduced-motion:no-preference){
.negspin{animation:negspin .8s linear infinite}@keyframes negspin{to{transform:rotate(360deg)}}
.neg .turn{animation:negrise .35s ease-out both}@keyframes negrise{from{opacity:0;transform:translateY(8px)}}
.neg .dots i{animation:negblink 1.1s infinite}.neg .dots i:nth-child(2){animation-delay:.18s}.neg .dots i:nth-child(3){animation-delay:.36s}@keyframes negblink{40%{opacity:1}}
.neg .fill,.neg .mk{transition:width .6s,left .6s}.railchips .flash{animation:negflash .9s ease-out}@keyframes negflash{0%{box-shadow:0 0 0 4px currentColor}}
.neg .stamp{animation:negstamp .45s cubic-bezier(.2,1.6,.4,1) both}@keyframes negstamp{from{opacity:0;transform:rotate(-3deg) scale(1.8)}}
.negshake{animation:negshake .45s}@keyframes negshake{20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}}
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
const tone=(t)=>!(t.rails&&t.rails.ok)?'no':t.policy&&t.policy.inside===false?'out':'ok';

const scale=(P)=>P?P.max_discount_bp/100+1:4;
const at=(P,pct)=>Math.max(0,Math.min(100,pct/scale(P)*100))+'%';
function band(P){const b=el('i','band');if(P){b.style.left=at(P,P.min_discount_bp/100);b.style.width=((P.max_discount_bp-P.min_discount_bp)/100/scale(P)*100)+'%'}return b}
function bubble(t,mode,V){
  const T=NC.terms;const sup=t.who==='supplier';const tn=tone(t);
  const name=typeof t.label==='string'&&t.label?t.label:(sup?NC.supplier:NC.sourcing);
  const who=el('p','who',[el('b','',name),sup?el('span','pill sim',NC.simBadge):null,el('span','pill'+(mode==='recorded'?' rec':''),mode==='recorded'?NC.recorded:NC.live+(t.model?' · '+t.model:'')),t.ms>=100?el('span','',(t.ms/1000).toFixed(1)+' s'):null,el('span','','Turn '+t.n)]);
  const p=t.proposed||{};const c=(k,v,cls)=>el('li',cls||'',[el('small','',k),v]);
  const chips=el('ul','chips',[c(T.amount,eur(p.amount)),c(T.discount,p.discount==='—'?'—':eur(p.discount)+' ('+p.discount_pct+')'),c(T.payBy,p.pay_by),c(T.account,p.iban||NC.onFile,p.iban?'x':''),t.accept?el('li','acc',NC.accepts):null]);
  const refs=(t.rails&&t.rails.refusals)||[];const brs=(t.policy&&t.policy.breaches)||[];
  const v=tn==='ok'?el('p','verdict ok',NC.within):tn==='out'?el('p','verdict out',[el('b','',NC.outside+': '),brs.map((r)=>r.detail).join('; '),...brs.map((r)=>el('span','rule',r.says))]):el('p','verdict no',[el('b','',NC.refused+': '),refs.map((r)=>r.detail).join('; '),...refs.map((r)=>el('span','rule',NC.heldRule+' '+r.says))]);
  const stamp=refs.some((r)=>r.rule==='payee_unchanged')?el('span','stamp',NC.stamp):null;
  let sig=null;
  if(t.signature&&t.offer_sha256)sig=el('p','sig mono',NC.sig.offer+' '+t.offer_sha256.slice(0,16)+'… · '+NC.sig.by+' '+t.signature.key_id);
  const h=t.held_to_best_offer,hp=t.held_to_policy;
  const bub=el('div','bubble',[who,stamp,el('p','msg',t.message),chips,v,t.scripted_bank_change?el('p','nnote',NC.scripted):null,h?el('p','nnote held',fill(NC.held,{asked:eur(h.asked),floor:eur(h.floor),turn:h.floor_turn})):null,hp?el('p','nnote held',fill(NC.heldPolicy,{asked:eur(hp.asked_amount),by:hp.asked_pay_by})):null,sig]);
  const card=el('li','turn '+t.who+(tn==='no'?' refused':tn==='out'?' out':''),[el('span','av',sup?name.charAt(0).toUpperCase():'P'),bub]);
  card.setAttribute('aria-label','Turn '+t.n+', '+name);card.querySelector('.av').setAttribute('aria-hidden','true');
  return card;
}
function waitRow(who,words,kind){
  const r=el('li','turn '+(kind||'typing')+' '+who,[el('span','av',who==='supplier'?'S':'P'),el('div','bubble',[el('span','dots',[el('i'),el('i'),el('i')]),el('span','',words)])]);
  r.querySelector('.av').setAttribute('aria-hidden','true');return r;
}
function board(bounds,P){
  const M=NC.meter,inv=bounds.max_pay_cents;
  const B={inv,cur:inv,P,curB:el('b','',M.none),bestB:el('b','',M.none),disc:el('b','','EUR 0.00'),pct:el('span','','0.0%'),fill:el('i','fill'),mkCur:el('i','mk cur'),chips:{}};
  B.mkCur.hidden=true;
  B.track=el('div','track',[band(P),B.fill,B.mkCur]);B.track.setAttribute('aria-hidden','true');
  if(P)for(const v of [0,P.min_discount_bp/100,P.max_discount_bp/100]){const k=el('span','tk',v+'%');k.style.left=at(P,v);B.track.append(k)}
  B.meter=el('div','meter',[el('p','mt',M.head),el('div','mrow',[el('span','',[M.invoice+' ',el('b','',money(inv))]),el('span','',[M.current+' ',B.curB]),el('span','',[M.best+' ',B.bestB])]),B.track,el('p','disc',[M.discount+' ',B.disc,' (',B.pct,')']),P?el('p','bandnote',fill(M.band,{min:P.min_discount_bp/100,max:P.max_discount_bp/100,from:P.earliest_pay_by})):null]);
  B.meter.id='meter';
  const R=NC.railChips;
  const lab={max_amount:fill(R.max_amount,{max:money(inv).slice(4)}),pay_by_window:fill(R.pay_by_window,{to:bounds.latest_pay_by}),invoice_only:R.invoice_only,payee_unchanged:R.payee_unchanged};
  B.chipsEl=el('ul','railchips',Object.keys(lab).map((k)=>{const li=el('li','',lab[k]);li.dataset.rule=k;B.chips[k]=li;return li}));
  B.chipsEl.id='railchips';B.chipsEl.setAttribute('aria-label',NC.railChipsLabel);
  return B;
}
function move(B,t,best){
  const bad=new Set(((t.rails&&t.rails.refusals)||[]).map((r)=>r.rule));
  for(const k of Object.keys(B.chips)){const li=B.chips[k];li.classList.remove('ok','no','flash');void li.offsetWidth;li.classList.add(bad.has(k)?'no':'ok','flash')}
  const c=centsOf(t.proposed&&t.proposed.amount);
  if(isFinite(c)&&c<=B.inv){const od=el('i','od '+(t.who==='supplier'?'s ':'')+tone(t));od.style.left=at(B.P,(B.inv-c)/B.inv*100);B.track.append(od)}
  if(t.rails&&t.rails.ok&&isFinite(c)){
    B.cur=c;B.curB.textContent=eur(t.proposed.amount);B.mkCur.hidden=false;
    const x=at(B.P,(B.inv-c)/B.inv*100);B.mkCur.style.left=x;B.fill.style.width=x;
    B.disc.textContent=money(B.inv-c);B.pct.textContent=((B.inv-c)/B.inv*100).toFixed(1)+'%';
  }
  if(best&&isFinite(centsOf(best.amount)))B.bestB.textContent=eur(best.amount);
}
function bestOf(turns){let b=null;for(const t of turns){if(t.who!=='supplier')continue;const r=(t.rails&&t.rails.refusals)||[];if(!(t.rails&&t.rails.ok)&&!r.every((x)=>x.rule==='payee_unchanged'))continue;const c=centsOf(t.proposed.amount);if(isFinite(c)&&(!b||c<centsOf(b.amount)))b={amount:t.proposed.amount,turn:t.n}}return b}
async function* lines(reader){
  const dec=new TextDecoder();let buf='';
  for(;;){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(l){try{yield JSON.parse(l)}catch(e){}}}}
  if(buf.trim()){try{yield JSON.parse(buf)}catch(e){}}
}
function view(box){
  const V={box,list:el('ol','turns'),side:el('div','nside'),wait:null,B:null,P:null,root:el('div','neg')};
  V.root.append(el('div','ngrid',[V.side,el('div','nchat',[V.list])]));box.replaceChildren(V.root);
  V.waiting=(who,words,kind)=>{if(V.wait){V.wait.remove();V.wait=null}if(who){V.wait=waitRow(who,words,kind);V.list.append(V.wait)}};
  V.boardFor=(bounds,P)=>{if(V.B)return;V.P=P||null;V.B=board(bounds,V.P);V.side.append(V.B.meter,V.B.chipsEl)};
  V.add=(t,mode,best)=>{V.list.append(bubble(t,mode,V));if(V.B)move(V.B,t,best)};
  return V;
}
async function replay(V,n,say){
  V.waiting(null);V.boardFor(n.bounds,n.policy);
  if(n.mode==='recorded'&&!V.root.querySelector('.rec-label'))V.root.prepend(el('p','rec-label',[el('b','',n.label||NC.recordedLabel),n.reason?el('span','',' '+fill(NC.why,{reason:n.reason})):null]));
  V.list.replaceChildren();const seen=[];
  for(const t of n.turns){seen.push(t);V.add(t,n.mode,bestOf(seen));if(say)say('Turn '+t.n);if(!calm)await sleep(650)}

}
const errOf=(status,j)=>({ok:false,status,code:j&&typeof j.code==='string'?j.code:'',message:j&&typeof j.message==='string'&&j.message?j.message:j&&typeof j.error==='string'&&j.error?j.error:(status?NC.failed:NC.noAnswer)});
async function run(o){
  const V=view(o.box);const say=o.say||(()=>{});
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
    if(ev.type==='start'&&ev.bounds){V.boardFor(ev.bounds,ev.policy);if(ev.live===true)V.waiting('sourcing',fill(NC.typing,{who:NC.sourcing.split(' · ')[0]}))}
    else if(ev.type==='turn'&&ev.turn){const t=ev.turn;V.waiting(null);V.add(t,'live',ev.best);shown++;say('Turn '+t.n);
      if(t.n<4)V.waiting(t.who==='sourcing'?'supplier':'sourcing',fill(NC.typing,{who:t.who==='sourcing'?String(t.label||NC.supplier).split(' · ')[0]:NC.sourcing.split(' · ')[0]}))}
    else if(ev.type==='reset'){V.waiting(null);shown=0;V.list.replaceChildren(el('li','nnote',NC.reset))}
    else if(ev.type==='done'&&ev.negotiation)n=ev.negotiation;
    else if(ev.type==='error'){V.waiting(null);return errOf(500,{message:ev.message})}
  }
  V.waiting(null);
  if(!n||!Array.isArray(n.turns))return errOf(500,null);
  V.boardFor(n.bounds,n.policy);
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
  const A=NC.agreement,a=n.agreement,o=n.outcome,deal=o!=='no_deal',s=n.saving;
  const h=el('h3','',o==='agreed'?NC.agreedHead:o==='escalated'?NC.escHead:NC.noDealHead);h.tabIndex=-1;
  const col=(c,head,amt,sub)=>el('div','col '+c,[el('p','',head),el('b','',eur(amt)),el('span','',sub)]);
  const sv=s&&deal?el('div','save',[el('p','',[NC.saving+' ',el('b','',eur(s.amount)),' ('+s.pct+'%)']),el('span','tag',NC.testMoney),s.yearly_pct?el('p','nnote',fill(NC.yearly,{days:s.days_early,pct:s.pct,rate:s.yearly_pct})):null]):null;

  const ch=n.transcript_sha256;const dl=el('dl','',[el('dt','',A.payee),el('dd','',a.supplier+' · account ending '+a.payee_iban_last4),el('dt','',A.ref),el('dd','mono',n.compose.invoice_no),...(ch?[el('dt','',A.chain),el('dd','mono',ch)]:[])]);
  const shaV=el('span','mono sha','');
  const esc=o==='escalated'?el('p','nnote',fill(NC.esc,{rules:((n.escalation&&n.escalation.breaches)||[]).map((b)=>b.detail).join('; ')})):null;
  const card=el('section','negagreed'+(o==='escalated'?' esc':''),[h,esc,deal?null:el('p','nnote',NC.noDeal),el('div','cmp',[col('was',NC.was,a.invoice_amount,(a.invoice_terms||'')+' · '+fill(NC.due,{d:a.invoice_due||''})),el('span','arr','→'),col('now',NC.now,a.amount,a.early_payment||a.pay_by)]),sv,
    el('p','shal',[el('span','nnote',NC.sha+': '),shaV]),el('p','nnote',NC.shaNote),dl,
    el('details','',[el('summary','',NC.canonical),el('pre','mono',n.canonical)]),
    el('div','negacts',actions||[])]);
  card.id='negagreed';
  setTimeout(()=>typeOut(shaV,n.sha256),0);
  return {card,heading:h};
}
function thinking(box){const V=view(box);V.waiting('sourcing',NC.thinking,'thinking');return V}
return {copy:NC,run,recorded,agreed,thinking,el,eur,fill,calm:()=>calm,shake:(node)=>{if(!calm){node.classList.remove('negshake');void node.offsetWidth;node.classList.add('negshake')}}};
})();
`;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
/** The script with its words in it. */
export const negKitJs = (): string => NEG_KIT_JS.replace("__NEGCOPY__", () => json(NEG_COPY));

/**
 * /try's step before the passkey (cloud/src/tryPage.ts drawResult, the "Ready to pay" branch): NEGI.card(inv, pay)
 * for a payable EUR invoice not yet due. It uses /try's own api, show, renew, say and session (S): the same company.
 * The negotiation runs inline; agreed (or escalated to the CFO, who decides by signing), the agreed invoice is filed
 * (POST /v1/engine/compose) and /try's own approve screen signs it; no deal, the invoice as issued goes to the approve
 * screen. A limit or a pause plays the recording, labelled, and the invoice can still be paid as invoiced. The server
 * decides what can be negotiated (409, said).
 */
export const NEG_TRY_JS = String.raw`
const NEGI=(()=>{
  const NC=NEG.copy,I=NC.inline,el=NEG.el;
  const today=()=>new Date().toISOString().slice(0,10);
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
      if(n.outcome==='no_deal'){
        const a=NEG.agreed(n,[]);box.append(a.card);pay.className='btn primary big';a.heading.focus();return}
      if(n.outcome==='agreed'){pay.hidden=true;pay.disabled=true}
      const sign=el('button','btn primary big',I.signAgreed);sign.type='button';sign.id='negsign';
      const a=NEG.agreed(n,[sign]);box.append(a.card);a.heading.focus();
      sign.addEventListener('click',async()=>{
        spin(sign,I.filing);
        const f=await api('POST','/v1/try/negotiate/agreed',{invoice_id:inv.id,agreement_sha256:n.sha256,compose:n.compose,turns:n.turns.length,agreement:n.agreement,keys:n.keys,offers:n.turns.map((t)=>({offer:t.offer,signature:t.signature}))});
        const ni=f.json&&f.json.invoice;
        if(f.status===200&&ni&&ni.id&&ni.status==='ready'){PREP.delete(inv.id);show('approve',{invoice:ni});return}
        sign.disabled=false;sign.textContent=I.signAgreed;a.card.append(el('p','neg-err',(f.json&&(f.json.message||f.json.error))||I.filedHeld));
        pay.hidden=false;pay.disabled=false;
      });
    });
    return sec;
  }
  return {eligible,card};
})();
`;
