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
import { sceneOf } from "../../../src/negotiate/negotiate.js";
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
  lede: "Purser's Sourcing agent (Claude) negotiates an early-payment discount with the supplier's agent (a simulated supplier, played by Claude). Every offer is signed and hashed, and passes the CFO's limits in code before it counts. Then you sign the exact terms with your passkey, as on /try.",
  simTag: "Simulated supplier, played by Claude",
  invoiceHead: "The invoice",
  invoice: [["Supplier", "Bergtex Textil GmbH"], ["Amount", "EUR 1,850.00"], ["Terms", "Net 30"], ["Pay to", "The account on file"]],
  invoiceNote: "A seeded test supplier in your test company, with a published test IBAN.",
  railsHead: "The CFO's limits (code, not a prompt)",
  railsSub: "Rails: never crossed",
  policySub: "Policy: outside it, the CFO decides",
  rails: {
    max_amount: "Pays at most EUR {max}",
    pay_by_window: "Pays between {from} and {to}",
    invoice_only: "Nothing beyond the invoice {no}",
    payee_unchanged: "Only to the account on file (ending {last4})",
  },
  policy: ["Asks for at most 3% off", "Accepts only 1% off or more", "Pays no sooner than 2 days from today"],
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
  signEsc: "Sign these terms yourself, with your passkey",
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
} as const;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// 26 Nov (Max: "the page looked simple"): Purser's look, dark first: a violet glow behind the head, the agents' hues,
// the colour system of ./negotiateKit.ts. A card's first heading sits at the card's own padding (15 Nov, Max, 1440 px).
const CSS = `${TOKENS.replace("url(assets/inter.woff2", "url(/assets/inter.woff2")}
*{box-sizing:border-box}[hidden]{display:none!important}html{-webkit-text-size-adjust:100%;scroll-padding-top:84px}
body{margin:0;color:var(--text);font:400 16px/1.5 Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;background:radial-gradient(70% 560px at 80% -120px,color-mix(in srgb,var(--accent) 26%,transparent),transparent 72%) no-repeat,radial-gradient(45% 420px at 0 300px,color-mix(in srgb,var(--n-p) 12%,transparent),transparent 70%) no-repeat,var(--bg)}
main{max-width:1200px;margin:0 auto;padding:0 var(--gut,16px) 64px;overflow-x:clip}
.hero{max-width:820px;padding:30px 0 6px}
h1{font-size:clamp(31px,4.4vw,50px);line-height:1.05;letter-spacing:-.035em;font-weight:760;margin:16px 0 14px;text-wrap:balance}
h1 span{background:var(--grad-text,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
h2{font-size:17px;margin:0 0 10px}h1:focus,h2:focus,h3:focus{outline:none}p{margin:0 0 12px}
.lede,.note{color:var(--muted)}.lede{font-size:clamp(16px,1.4vw,18px)}.note{font-size:14px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:0}
.tag{--c:var(--n-wait);display:inline-flex;gap:7px;align-items:center;padding:4px 12px;border-radius:99px;font-size:13px;font-weight:600;border:1px solid color-mix(in srgb,var(--c) 40%,transparent);background:color-mix(in srgb,var(--c) 12%,transparent);color:color-mix(in srgb,var(--c) 82%,var(--text))}
.tag::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--c)}.tag.s{--c:var(--n-s)}
.setup{display:grid;gap:12px;margin:18px 0 0}
.card{border:1px solid var(--border);border-radius:18px;background:linear-gradient(170deg,color-mix(in srgb,var(--accent) 6%,var(--surface)),var(--surface));padding:16px;box-shadow:var(--shadow)}.card>h2:first-child{margin-top:0}
dl.inv{display:grid;grid-template-columns:max-content 1fr;gap:5px 16px;margin:0 0 10px}dl.inv dt{color:var(--muted)}dl.inv dd{margin:0;font-weight:600}
.lims{display:grid;gap:12px}.lims h3{margin:0 0 7px;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.rails{list-style:none;margin:0;padding:0;display:grid;gap:6px}.rails li{display:flex;gap:9px;align-items:baseline;font-size:14.5px}
.rails li::before{content:"";flex:none;width:8px;height:8px;border-radius:2px;background:var(--c,var(--n-bad))}.rails.pol li{--c:var(--accent)}
@media (min-width:560px){.lims{grid-template-columns:1fr 1fr}}@media (min-width:860px){.setup{grid-template-columns:minmax(0,5fr) minmax(0,8fr)}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:46px;padding:0 20px;border-radius:99px;font:650 15px/1.2 Inter,system-ui,sans-serif;text-decoration:none;border:1px solid var(--glass-line,var(--border));background:var(--glass,var(--surface));color:var(--text);cursor:pointer}
.btn.primary{background:var(--btn-bg,var(--accent));color:#fff;border-color:transparent;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 12px 32px -12px var(--glow)}
.btn:disabled{opacity:.55;cursor:progress}.btn:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0}#talk:not(:empty){margin-top:22px}
.mono{font-family:var(--mono,ui-monospace,Menlo,monospace);font-size:13px;overflow-wrap:anywhere}
ol.steps{margin:12px 0 0;padding-left:22px;display:grid;gap:6px}ol.steps li.done::marker{color:var(--n-ok)}ol.steps li.bad::marker,ol.steps li.stop::marker{color:var(--n-bad)}
ol.steps li.stop{border-left:3px solid var(--n-bad);padding-left:8px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
${NEG_CSS}
`;

const SCRIPT = String.raw`
const C=__COPY__;const CFG=__CFG__;
__SIGN__
__SOLVER__
__NEG__
const {fromB64u,registrationOf,signedOf}=signKit;
const $=(id)=>document.getElementById(id);const {el,fill,eur}=NEG;
const say=(s)=>{$('say').textContent=s};

const KEYS=['purser.try','purser.negotiate'];
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
const busy=(btn,words)=>{btn.disabled=true;btn.hidden=false;btn.replaceChildren(el('span','negspin'),document.createTextNode(' '+words))};
const errBox=(words)=>el('p','neg-err',words);
function againRow(){
  const b=el('button','btn',C.again);b.type='button';b.id='again';
  b.addEventListener('click',()=>{
    try{sessionStorage.removeItem('purser.negotiate');sessionStorage.setItem('purser.negotiate.fresh','1')}catch(e){}
    S=null;FROM=null;N=null;F.inv=null;F.p=null;F.eng=null;F.cred=null;
    $('deal').replaceChildren();$('end').replaceChildren();$('talk').replaceChildren();$('more').replaceChildren();
    const go=$('go');go.hidden=false;negotiate(go);
  });
  return el('div','row',[b]);
}
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
  N=res.n;deal();
}
function deal(){
  const go=N.outcome==='no_deal'?null:el('button','btn primary',N.outcome==='escalated'?C.signEsc:C.sign);if(go){go.type='button';go.id='sign'}
  const {card,heading}=NEG.agreed(N,go?[go]:[]);
  const steps=el('ol','steps');steps.id='steps';
  const out=el('div','');out.id='out';out.setAttribute('role','status');
  $('deal').replaceChildren(card,steps,out);heading.focus();
  $('more').replaceChildren(againRow());
  if(go)go.addEventListener('click',()=>sign(go));
}

const step=(text,state)=>{const li=el('li',state||'',text);$('steps').append(li);return li};
const hasPasskeys=()=>!!(window.PublicKeyCredential&&navigator.credentials);
const cancelled=(e)=>e&&typeof e.name==='string'&&/^(NotAllowedError|AbortError|InvalidStateError|SecurityError|NotSupportedError)$/.test(e.name);
async function withTimeout(fn){const ac=new AbortController();const t=setTimeout(()=>ac.abort(),30000);try{return await fn(ac.signal)}finally{clearTimeout(t)}}
const words=(j,fb)=>j&&typeof j.message==='string'&&j.message?j.message:j&&typeof j.error==='string'&&j.error?j.error:fb;
const F={inv:null,p:null,eng:null,cred:null};

async function sign(go){
  const out=$('out');out.replaceChildren();
  if(!hasPasskeys()){out.append(el('p','note',C.noPasskey));return}
  go.disabled=true;
  try{
    if(!F.inv){
      const f=await api('POST','/v1/try/negotiate/agreed',{agreement_sha256:N.sha256,compose:N.compose,turns:N.turns.length,agreement:N.agreement,keys:N.keys,offers:N.turns.map((t)=>({offer:t.offer,signature:t.signature}))});
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
  const d=el('button','btn',C.downloadDeal);d.type='button';d.addEventListener('click',()=>download('purser-negotiation.json',{note:'A negotiation on Purser\'s demo: test money, a simulated supplier played by Claude.',mode:N.mode,label:N.label,reason:N.reason,id:N.id,keys:N.keys,policy:N.policy,turns:N.turns,outcome:N.outcome,escalation:N.escalation,agreement:N.agreement,canonical:N.canonical,sha256:N.sha256,transcript_sha256:N.transcript_sha256,saving:N.saving,signed_terms:terms,terms_sha256:F.p&&F.p.terms_sha256}));row.append(d);
  const v=el('a','btn',C.verify);v.href=CFG.verify;v.rel='noopener';row.append(v);
  const back=el('a','btn',C.back);back.href='/try';row.append(back);
  end.replaceChildren(h,row);h.focus();say(C.paidHead);
}

const b=$('go');b.addEventListener('click',()=>negotiate(b));
`;

export interface NegotiatePageCfg { rpId: string; verify: string }

export function negotiatePage(n: string, cfg: NegotiatePageCfg): string {
  const C = NEGOTIATE_COPY;
  // The rails with the seeded scene's own figures, as the negotiation will check them (today, as the route's today).
  const today = new Date().toISOString().slice(0, 10), sc = sceneOf(today);
  const script =SCRIPT.replace("__COPY__", () => json(C)).replace("__CFG__", () => json({ ...cfg, proofFile: VERIFY_YOURSELF.file }))
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
<section class="hero"><p class="tags"><span class="tag">${esc(C.band)}</span><span class="tag s">${esc(C.simTag)}</span></p>
<h1>${esc(C.head).replace("You sign the deal.", "<span>You sign the deal.</span>")}</h1>
<p class="lede">${esc(C.lede)}</p>
<div class="row"><button class="btn primary" id="go" type="button">${esc(C.start)}</button></div></section>
<div class="setup"><section class="card" aria-labelledby="invh"><h2 id="invh">${esc(C.invoiceHead)}</h2><dl class="inv">${C.invoice.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl><p class="note">${esc(C.invoiceNote)}</p></section>
<section class="card" aria-labelledby="railsh"><h2 id="railsh">${esc(C.railsHead)}</h2><div class="lims"><div><h3>${esc(C.railsSub)}</h3><ul class="rails"><li>${esc(C.rails.max_amount.replace("{max}", "1,850.00"))}</li><li>${esc(C.rails.pay_by_window.replace("{from}", today).replace("{to}", sc.due_date))}</li><li>${esc(C.rails.invoice_only.replace("{no}", sc.invoice_no))}</li><li>${esc(C.rails.payee_unchanged.replace("{last4}", sc.supplier.iban.slice(-4)))}</li></ul></div>
<div><h3>${esc(C.policySub)}</h3><ul class="rails pol">${C.policy.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div></div></section></div>
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
