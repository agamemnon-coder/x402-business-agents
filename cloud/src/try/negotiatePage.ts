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
import { NEG_COPY, NEG_CSS, negKitJs } from "./negotiateKit.js";
import { BOT_SOLVER_JS } from "./botCheck.js";

export const NEGOTIATE_PATH = "/try/negotiate";
/** The link's words, on /try's finish and in the site's "More". */
export const NEGOTIATE_LINK = "Watch agents negotiate";

/** Every word of the page (tests read them). */
export const NEGOTIATE_COPY = {
  ...NEG_COPY,
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
  starting: "Starting… Purser's agent is thinking",
  talking: "The agents are negotiating…",
  again: "Start again",
  limitRecorded: "Today's live limit is reached; showing the recorded negotiation.",
  pausedRecorded: "The live demo is paused right now; showing the recorded negotiation.",
  startFailed: "A test company could not be started ({status}); showing the recorded negotiation.",
  companyLimit: "This test company has negotiated 3 times, its limit; showing the recorded negotiation. Start again for a new test company.",
  gone: "Your test company has ended; starting a new one.",
  nothingToSign: "A recording has nothing to sign. Start again to watch the agents live.",
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
.spin { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; vertical-align: -2px; }
@media (prefers-reduced-motion: no-preference) { .spin { animation: spin .8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } } }
${NEG_CSS}
`;

const SCRIPT = String.raw`
const C=__COPY__;const CFG=__CFG__;
__SIGN__
__SOLVER__
__NEG__
const {fromB64u,registrationOf,signedOf}=signKit;
const $=(id)=>document.getElementById(id);
const el=(tag,cls,kids)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(kids!==undefined&&kids!==null)for(const k of [].concat(kids))if(k!==null&&k!==undefined&&k!==false)n.append(typeof k==='string'?document.createTextNode(k):k);return n};
const fill=(s,o)=>String(s).replace(/\{(\w+)\}/g,(m,k)=>o[k]===undefined?m:String(o[k]));
const say=(s)=>{$('say').textContent=s};
const eur=(s)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(s));if(!m)return String(s);return 'EUR '+m[1].replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+m[2]};

// The company: /try's own in this tab (its key), else one this page started (its own key). Read only from storage;
// written back only to the key it came from (a renewed session).
const KEYS=['purser.try','purser.negotiate'];
// After Start again (or a company that ended), /try's company in this tab is not used again: a fresh one is started.
const FRESH=()=>{try{return sessionStorage.getItem('purser.negotiate.fresh')==='1'}catch(e){return false}};
let S=null,FROM=null;
for(const k of KEYS){if(k==='purser.try'&&FRESH())continue;try{const o=JSON.parse(sessionStorage.getItem(k)||'null');if(o&&o.session&&o.visitor_token&&o.tenant){S=o;FROM=k;break}}catch(e){}}
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
  if(S&&S.expires_at&&Date.parse(S.expires_at)>Date.now()+60000)return {ok:true};
  if(S&&await renew())return {ok:true};
  S=null;FROM=null;
  let proof;
  const ch=await call('POST','/v1/try/challenge');
  if(ch.status===200&&ch.json.required===true){const p=solveProof(String(ch.json.challenge),Number(ch.json.difficulty));if(!p)return {ok:false,status:0};proof={challenge:String(ch.json.challenge),nonce:p.nonce}}
  const r=await call('POST','/v1/try/start',proof?{proof}:{});
  if((r.status===201||r.status===200)&&typeof r.json.session==='string'){
    S={tenant:r.json.tenant,session:r.json.session,visitor_token:r.json.visitor_token,expires_at:r.json.expires_at||null};FROM='purser.negotiate';
    try{sessionStorage.setItem(FROM,JSON.stringify(S))}catch(e){}
    return {ok:true};
  }
  return {ok:false,status:r.status,code:r.json&&r.json.code,message:r.json&&typeof r.json.message==='string'?r.json.message:''};
}

let N=null;
const rails=(b)=>{
  const R=C.rails;const last4=String(b.payee_iban||'').slice(-4);
  return el('ul','rails',[el('li','',fill(R.max_amount,{max:NEG.eur((b.max_pay_cents/100).toFixed(2)).slice(4)})),el('li','',fill(R.pay_by_window,{from:b.earliest_pay_by,to:b.latest_pay_by})),el('li','',fill(R.invoice_only,{no:b.invoice_no})),el('li','',fill(R.payee_unchanged,{last4}))]);
};
const busy=(btn,words)=>{btn.disabled=true;btn.hidden=false;btn.replaceChildren(el('span','spin'),document.createTextNode(' '+words))};
const errBox=(words)=>el('p','neg-err',words);
function againRow(){
  const b=el('button','btn',C.again);b.type='button';b.id='again';
  b.addEventListener('click',()=>{
    // A clean slate: this tab's negotiate company forgotten, /try's not reused, the page's state cleared.
    try{sessionStorage.removeItem('purser.negotiate');sessionStorage.setItem('purser.negotiate.fresh','1')}catch(e){}
    S=null;FROM=null;N=null;F.inv=null;F.p=null;F.eng=null;F.cred=null;
    $('deal').replaceChildren();$('end').replaceChildren();$('talk').replaceChildren();$('more').replaceChildren();
    const go=$('go');go.hidden=false;negotiate(go);
  });
  return el('div','row',[b]);
}
// The recording, played at once, when the live path turned the visitor away; nothing to sign in it.
async function fallback(words,why){
  const talk=$('talk');const box=el('div','');talk.replaceChildren(errBox(words),box);
  await NEG.recorded({box,why,say});
  $('more').replaceChildren(el('p','note',C.nothingToSign),againRow());
}
async function negotiate(btn){
  $('deal').replaceChildren();$('end').replaceChildren();$('more').replaceChildren();
  busy(btn,C.starting);say(C.starting);
  const talk=$('talk');
  NEG.thinking(talk);
  let okc=await company();
  if(!okc.ok){btn.hidden=true;
    if(okc.status===429)return fallback(C.limitRecorded,'limit');
    if(okc.status===503)return fallback(C.pausedRecorded,'paused');
    return fallback(fill(C.startFailed,{status:okc.status||'no answer'}),'start')}
  busy(btn,C.talking);say(C.talking);
  let res=await NEG.run({box:talk,auth:()=>S&&S.session,renew,say});
  if(!res.ok&&(res.status===410||res.status===401)){
    // The company this tab held has ended: a new one, once.
    try{sessionStorage.removeItem('purser.negotiate');sessionStorage.setItem('purser.negotiate.fresh','1')}catch(e){}
    S=null;FROM=null;say(C.gone);okc=await company();
    if(okc.ok)res=await NEG.run({box:talk,auth:()=>S&&S.session,renew,say});
  }
  btn.hidden=true;
  if(!res.ok){
    if(res.status===429)return fallback(res.code==='limit'?C.companyLimit:C.limitRecorded,'limit');
    if(res.status===503)return fallback(C.pausedRecorded,'paused');
    talk.prepend(errBox(res.message||C.failed));$('more').replaceChildren(againRow());return;
  }
  N=res.n;$('rails').replaceChildren(rails(N.bounds));deal();
}
function deal(){
  const go=el('button','btn primary',C.sign);go.type='button';go.id='sign';
  const {card,heading}=NEG.agreed(N,[go]);
  const steps=el('ol','steps');steps.id='steps';
  const out=el('div','');out.id='out';out.setAttribute('role','status');
  $('deal').replaceChildren(card,steps,out);heading.focus();
  $('more').replaceChildren(againRow());
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
    {const li=step([C.steps.tamper+' ('+eur(terms.amount)+' → '+eur(cent)+'): ',el('b','',refused?C.tamperRefused:C.tamperOther)],refused?'stop':'bad');if(refused)NEG.shake(li)}
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
    .replace("__SIGN__", () => SIGN_JS).replace("__SOLVER__", () => BOT_SOLVER_JS).replace("__NEG__", () => negKitJs());
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
<section id="more"></section>
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
